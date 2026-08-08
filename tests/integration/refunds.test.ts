import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { listEntries } from '@/server/ledger';

setupTestDb();

const NOW = new Date('2026-01-05T12:00:00Z');
const PAST_DUE = new Date('2026-01-20T12:00:00Z');
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date('2026-01-12T00:00:00Z'),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }],
};
const pay = (amountMinor: number) => ({ kind: 'payment' as const, amountMinor, occurredAt: NOW });
const refund = (amountMinor: number) => ({ kind: 'refund' as const, amountMinor, occurredAt: NOW });

async function paidOrder() {
  const userId = new ObjectId();
  const order = await createOrder(userId, input, NOW);
  await appendEntry(userId, order.id, pay(100000), NOW);
  return { userId, orderId: order.id };
}

describe('refunds', () => {
  it('walks a paid order back to partially_paid', async () => {
    const { userId, orderId } = await paidOrder();
    const result = await appendEntry(userId, orderId, refund(40000), NOW);
    expect(result.view.status).toBe('partially_paid');
    expect(result.view.refundedMinor).toBe(40000);
    expect(result.view.netPaidMinor).toBe(60000);
    expect(result.view.dueMinor).toBe(40000);
  });

  it('sends a refunded order overdue when past its due date', async () => {
    // Status is non-monotonic once refunds exist. Deriving it handles that for
    // free; a stored status field would need every refund path to recompute.
    const { userId, orderId } = await paidOrder();
    const result = await appendEntry(userId, orderId, refund(40000), PAST_DUE);
    expect(result.view.status).toBe('overdue');
  });

  it('refuses to refund more than was received', async () => {
    const { userId, orderId } = await paidOrder();
    await expect(appendEntry(userId, orderId, refund(100001), NOW))
      .rejects.toMatchObject({ code: 'EXCESS_REFUND', httpStatus: 409, details: { maxAllowedMinor: 100000 } });
  });

  it('refuses any refund on an unpaid order', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    await expect(appendEntry(userId, order.id, refund(1), NOW))
      .rejects.toMatchObject({ code: 'EXCESS_REFUND', details: { maxAllowedMinor: 0 } });
  });

  it('re-opens room for payment after a refund', async () => {
    const { userId, orderId } = await paidOrder();
    await appendEntry(userId, orderId, refund(40000), NOW);
    const result = await appendEntry(userId, orderId, pay(40000), NOW);
    expect(result.view.status).toBe('paid');
    expect(result.view.dueMinor).toBe(0);
  });

  it('shares one sequence with payments', async () => {
    const { userId, orderId } = await paidOrder();
    await appendEntry(userId, orderId, refund(40000), NOW);
    const entries = await listEntries(new ObjectId(orderId));
    expect(entries.map((e) => [e.seq, e.kind])).toEqual([[1, 'payment'], [2, 'refund']]);
  });

  it('holds the invariant when payments and refunds race', async () => {
    const { userId, orderId } = await paidOrder();
    const results = await Promise.allSettled([
      appendEntry(userId, orderId, refund(100000), NOW),
      appendEntry(userId, orderId, refund(100000), NOW),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const entries = await listEntries(new ObjectId(orderId));
    expect(entries.at(-1)!.balanceAfter.refundedMinor).toBe(100000);
  });

  // Pinning test beyond the brief: the test above uses two refunds of the FULL
  // amount, where only one can ever succeed regardless of whether a seq
  // collision is retried or just rejected outright — so it cannot tell a
  // working retry loop apart from one that gives up on the first collision.
  // Three partial refunds where exactly two fit discriminates: a correct
  // retry lets the second writer re-read and land at seq=3, and only the
  // third is rejected on the money guard. A broken retry (collision treated
  // as fatal instead of "re-read and try again") would let only one succeed.
  it('lets exactly as many concurrent partial refunds succeed as the balance allows', async () => {
    const { userId, orderId } = await paidOrder(); // paid 100000, total 100000
    const results = await Promise.allSettled([
      appendEntry(userId, orderId, refund(40000), NOW),
      appendEntry(userId, orderId, refund(40000), NOW),
      appendEntry(userId, orderId, refund(40000), NOW),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'EXCESS_REFUND' });

    const entries = await listEntries(new ObjectId(orderId));
    expect(entries).toHaveLength(3); // 1 payment + 2 successful refunds
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries.at(-1)!.balanceAfter.refundedMinor).toBe(80000);
  });

  // Pinning test beyond the brief: mixed payment/refund history, verify the
  // exact maxAllowedMinor value on the rejection, not just that it rejected.
  it('computes maxAllowedMinor correctly on a mixed payment/refund history', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    // total is 100000. Pay 70000, refund 20000 -> paid=70000, refunded=20000.
    // maxAllowedMinor for a refund = paidMinor - refundedMinor = 50000.
    await appendEntry(userId, order.id, pay(70000), NOW);
    await appendEntry(userId, order.id, refund(20000), NOW);
    await expect(appendEntry(userId, order.id, refund(50001), NOW))
      .rejects.toMatchObject({ code: 'EXCESS_REFUND', details: { maxAllowedMinor: 50000 } });
    // Exactly the ceiling succeeds.
    const result = await appendEntry(userId, order.id, refund(50000), NOW);
    expect(result.view.refundedMinor).toBe(70000);
    expect(result.view.netPaidMinor).toBe(0);
  });

  // Pinning test beyond the brief: full refund walks status all the way back
  // to pending, not just down to partially_paid.
  it('returns a fully refunded order to pending', async () => {
    const { userId, orderId } = await paidOrder();
    const result = await appendEntry(userId, orderId, refund(100000), NOW);
    expect(result.view.status).toBe('pending');
    expect(result.view.netPaidMinor).toBe(0);
    expect(result.view.dueMinor).toBe(100000);
  });

  // Pinning test beyond the brief: after a refund re-opens room, a payment for
  // exactly the reopened room succeeds and one minor unit more is rejected.
  it('accepts a payment for exactly the reopened room and rejects one minor unit more', async () => {
    const { userId, orderId } = await paidOrder();
    await appendEntry(userId, orderId, refund(40000), NOW);
    // maxAllowedMinor for payment = totalMinor - netPaid = 100000 - 60000 = 40000.
    await expect(appendEntry(userId, orderId, pay(40001), NOW))
      .rejects.toMatchObject({ code: 'OVERPAYMENT', details: { maxAllowedMinor: 40000 } });
    const result = await appendEntry(userId, orderId, pay(40000), NOW);
    expect(result.view.status).toBe('paid');
    expect(result.view.dueMinor).toBe(0);
  });

  // Pinning test beyond the brief: an idempotency key recorded for a payment
  // must not be silently honored for a refund replaying under the same key.
  it('rejects a refund replaying a payment idempotency key', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const key = 'shared-key-across-kinds';
    await appendEntry(userId, order.id, { ...pay(50000), idempotencyKey: key }, NOW);
    await expect(appendEntry(userId, order.id, { ...refund(50000), idempotencyKey: key }, NOW))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 409 });
  });
});
