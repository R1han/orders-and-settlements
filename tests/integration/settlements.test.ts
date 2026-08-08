import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { listEntries } from '@/server/ledger';
import { ledger, audit } from '@/server/db';
import { DomainError } from '@/domain/errors';

setupTestDb();

const NOW = new Date('2026-01-05T12:00:00Z');
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date('2026-01-12T00:00:00Z'),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }], // $1,000.00
};
const pay = (amountMinor: number, idempotencyKey?: string) => ({
  kind: 'payment' as const, amountMinor, occurredAt: NOW, idempotencyKey,
});

async function newOrder() {
  const userId = new ObjectId();
  const order = await createOrder(userId, input, NOW);
  return { userId, orderId: order.id };
}

describe('the brief sample scenario', () => {
  it('walks pending to partially_paid to paid, then rejects the extra dollar', async () => {
    const { userId, orderId } = await newOrder();

    const first = await appendEntry(userId, orderId, pay(40000), NOW);
    expect(first.view.status).toBe('partially_paid');
    expect(first.view.dueMinor).toBe(60000);

    const second = await appendEntry(userId, orderId, pay(60000), NOW);
    expect(second.view.status).toBe('paid');
    expect(second.view.dueMinor).toBe(0);

    await expect(appendEntry(userId, orderId, pay(100), NOW))
      .rejects.toMatchObject({ code: 'OVERPAYMENT', httpStatus: 409, details: { maxAllowedMinor: 0 } });
  });

  it('numbers entries from 1 and records the running balance on each', async () => {
    const { userId, orderId } = await newOrder();
    await appendEntry(userId, orderId, pay(40000), NOW);
    await appendEntry(userId, orderId, pay(60000), NOW);

    const entries = await listEntries(new ObjectId(orderId));
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(entries.map((e) => e.balanceAfter.netPaidMinor)).toEqual([40000, 100000]);
    expect(entries.map((e) => e.statusAfter)).toEqual(['partially_paid', 'paid']);
  });

  it('audits a rejection, which writes no ledger entry', async () => {
    const { userId, orderId } = await newOrder();
    await appendEntry(userId, orderId, pay(100000), NOW);
    await expect(appendEntry(userId, orderId, pay(100), NOW)).rejects.toThrow();

    expect(await (await ledger()).countDocuments({ orderId: new ObjectId(orderId) })).toBe(1);
    const record = await (await audit()).findOne({ orderId: new ObjectId(orderId), event: 'payment.rejected' });
    expect(record?.payload).toMatchObject({ amountMinor: 100, code: 'OVERPAYMENT' });
  });
});

describe('concurrency', () => {
  // This is the test that actually proves order_seq_unique is the conflict point.
  // Both payments fit the order regardless of which one lands first, so the ONLY
  // way either one can be rejected is a genuine collision on seq — nothing about
  // the payment amounts explains a rejection here. The mocked tests in
  // settlements-retry.test.ts prove the handler responds correctly to a
  // duplicate-key error; this test proves the collision is actually reachable.
  // If this test ever shows a rejection, either the unique index or the retry
  // that recovers from it is broken.
  it('lets both through and orders them when both fit', async () => {
    const { userId, orderId } = await newOrder();
    const results = await Promise.allSettled([
      appendEntry(userId, orderId, pay(30000), NOW),
      appendEntry(userId, orderId, pay(30000), NOW),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const entries = await listEntries(new ObjectId(orderId));
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(entries.at(-1)!.balanceAfter.netPaidMinor).toBe(60000);
  });

  it('lets exactly one of two racing payments through when only one fits', async () => {
    // $1,000 order, $400 already paid, two $600 payments at once. Each passes
    // in isolation; together they over-pay. A transaction alone would NOT stop
    // this — snapshot isolation permits write skew across different documents.
    // The unique index on (orderId, seq) is what forces the conflict.
    //
    // This only proves anything if the two calls actually race at the database
    // layer. The driver opens sockets lazily, so on a cold pool the second call's
    // read can trail the first call's whole read+insert cycle, making the two
    // calls serialise instead of overlap — the rejection would then come from the
    // ordinary overpayment check regardless of whether the retry logic exists at
    // all. setupTestDb() warms the pool for exactly this reason.
    const { userId, orderId } = await newOrder();
    await appendEntry(userId, orderId, pay(40000), NOW);

    const results = await Promise.allSettled([
      appendEntry(userId, orderId, pay(60000), NOW),
      appendEntry(userId, orderId, pay(60000), NOW),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('OVERPAYMENT');

    const entries = await listEntries(new ObjectId(orderId));
    expect(entries).toHaveLength(2);
    expect(entries.at(-1)!.balanceAfter.netPaidMinor).toBe(100000);
    expect(entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('never lets ten racing payments exceed the total', async () => {
    const { userId, orderId } = await newOrder();
    const attempts = Array.from({ length: 10 }, () => appendEntry(userId, orderId, pay(15000), NOW));
    const results = await Promise.allSettled(attempts);

    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    expect(accepted).toBeLessThanOrEqual(6); // floor(1000 / 150)

    // Bounds alone (accepted <= 6, summed <= total) are satisfied just as well by
    // a pile of raw, untranslated driver errors as by correct rejections — a
    // broken handler that lets E11000 escape would pass those checks too. Every
    // rejection must be a domain error the handler actually produced.
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(DomainError);
      expect(['OVERPAYMENT', 'CONCURRENT_UPDATE']).toContain((r.reason as DomainError).code);
    }

    const entries = await listEntries(new ObjectId(orderId));
    const summed = entries.reduce((total, e) => total + e.amountMinor, 0);
    expect(summed).toBeLessThanOrEqual(100000);
    expect(entries.at(-1)!.balanceAfter.netPaidMinor).toBe(summed);
  });
});

describe('idempotency', () => {
  it('records one entry for a replayed key and reports the replay', async () => {
    const { userId, orderId } = await newOrder();
    const first = await appendEntry(userId, orderId, pay(40000, 'key-1'), NOW);
    const second = await appendEntry(userId, orderId, pay(40000, 'key-1'), NOW);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.entry._id.toHexString()).toBe(first.entry._id.toHexString());
    expect(await (await ledger()).countDocuments({ orderId: new ObjectId(orderId) })).toBe(1);
  });

  it('does not double-charge when a replay races the original', async () => {
    const { userId, orderId } = await newOrder();
    const results = await Promise.allSettled([
      appendEntry(userId, orderId, pay(40000, 'key-2'), NOW),
      appendEntry(userId, orderId, pay(40000, 'key-2'), NOW),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await (await ledger()).countDocuments({ orderId: new ObjectId(orderId) })).toBe(1);
  });

  it('keys are scoped per user, not globally', async () => {
    const a = await newOrder();
    const b = await newOrder();
    await appendEntry(a.userId, a.orderId, pay(1000, 'shared'), NOW);
    await expect(appendEntry(b.userId, b.orderId, pay(1000, 'shared'), NOW)).resolves.toMatchObject({ replayed: false });
  });
});

describe('idempotency key reuse', () => {
  // user_idem_unique is {userId, idempotencyKey} — scoped to the user, not to an
  // order, a kind, or an amount. So a matching row under a reused key is not
  // automatically "the same request replayed"; it can be a different order, a
  // different amount, or (once refunds exist) a different kind entirely. Any of
  // those must be refused, not silently answered with whatever the key already
  // points to.
  it('rejects a replayed key when the target order differs from the one it was recorded against', async () => {
    const userId = new ObjectId();
    const orderA = await createOrder(userId, input, NOW);
    const orderB = await createOrder(userId, input, NOW);

    const first = await appendEntry(userId, orderA.id, pay(10000, 'cross-order-key'), NOW);
    expect(first.replayed).toBe(false);

    await expect(appendEntry(userId, orderB.id, pay(70000, 'cross-order-key'), NOW))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 409 });

    expect(await listEntries(new ObjectId(orderB.id))).toHaveLength(0);
    expect(await listEntries(new ObjectId(orderA.id))).toHaveLength(1);
  });

  it('rejects a replayed key when the amount differs from the one it was recorded against', async () => {
    const { userId, orderId } = await newOrder();

    const first = await appendEntry(userId, orderId, pay(40000, 'amount-mismatch-key'), NOW);
    expect(first.replayed).toBe(false);

    await expect(appendEntry(userId, orderId, pay(50000, 'amount-mismatch-key'), NOW))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', httpStatus: 409 });

    const entries = await listEntries(new ObjectId(orderId));
    expect(entries).toHaveLength(1);
    expect(entries[0].amountMinor).toBe(40000);
  });
});
