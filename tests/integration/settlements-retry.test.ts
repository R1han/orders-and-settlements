import { describe, it, expect, vi, afterEach } from 'vitest';
import { Collection, MongoServerError, ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, softDeleteOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { listEntries } from '@/server/ledger';
import { ledger, audit, type LedgerEntryDoc } from '@/server/db';

/**
 * The brief's own concurrency tests (settlements.test.ts) rely on two real
 * appendEntry calls actually racing at the database layer. On this machine that
 * race is reliable for "both fit" (any interleaving needs a real seq collision
 * to explain a rejection) but is NOT reliable for "$400 paid, two $600s racing" or
 * "ten $150s racing" — in an in-memory single-node replica set, one call's full
 * read+validate+insert cycle routinely completes before the other call's read
 * even returns, so those two scenarios pass even against a broken (non-retrying)
 * implementation purely because the sequential outcome happens to equal the
 * correct concurrent outcome. That was confirmed directly: a version of
 * appendEntry with the seq-collision `continue` replaced by an immediate rethrow
 * still passed both of those tests in 15/15 samples.
 *
 * These tests remove timing from the equation entirely by mocking
 * Collection.prototype.insertOne to *force* the collision, retry-exhaustion, and
 * concurrent-delete scenarios deterministically, so the retry loop's behaviour is
 * pinned regardless of how fast or slow the underlying database happens to be.
 */

setupTestDb();

const NOW = new Date('2026-01-05T12:00:00Z');
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date('2026-01-12T00:00:00Z'),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }], // $1,000.00
};
const pay = (amountMinor: number) => ({ kind: 'payment' as const, amountMinor, occurredAt: NOW });

function seqCollisionError(): MongoServerError {
  return new MongoServerError({
    message: 'E11000 duplicate key error collection: test.ledgerEntries index: order_seq_unique dup key: { orderId: 1, seq: 1 }',
    code: 11000,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retry loop edge cases (deterministic — mocked, not timing-dependent)', () => {
  it('gives up and throws ConcurrencyError after exhausting retries under sustained seq collisions', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const insertSpy = vi.spyOn(Collection.prototype, 'insertOne').mockRejectedValue(seqCollisionError());

    await expect(appendEntry(userId, order.id, pay(1000), NOW))
      .rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', httpStatus: 409 });

    // MAX_ATTEMPTS is 5 in src/server/settlements.ts: one insert attempt per loop iteration.
    expect(insertSpy).toHaveBeenCalledTimes(5);
    expect(await (await ledger()).countDocuments({ orderId: new ObjectId(order.id) })).toBe(0);
  });

  it('recovers from a genuine seq collision and succeeds on retry, independent of real timing', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const real = Collection.prototype.insertOne;
    let calls = 0;
    const insertSpy = vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(function (
      this: Collection, ...args: Parameters<Collection['insertOne']>
    ) {
      calls += 1;
      if (calls === 1) throw seqCollisionError();
      return real.apply(this, args);
    });

    const result = await appendEntry(userId, order.id, pay(40000), NOW);
    expect(result.replayed).toBe(false);
    expect(insertSpy).toHaveBeenCalledTimes(2);

    const entries = await listEntries(new ObjectId(order.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].seq).toBe(1);
    expect(entries[0].balanceAfter.netPaidMinor).toBe(40000);
  });

  it('propagates NotFoundError, not a further retry, when the order is soft-deleted between attempts', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);

    vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (this: Collection) {
      // Simulate a concurrent request deleting the order right after this attempt's
      // insert collides, but before the retry loop re-reads the order.
      await softDeleteOrder(userId, order.id);
      throw seqCollisionError();
    });

    await expect(appendEntry(userId, order.id, pay(1000), NOW))
      .rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('writes exactly one rejection audit row when a retry precedes the final rejection', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const orderId = new ObjectId(order.id);
    const real = Collection.prototype.insertOne;
    let calls = 0;

    vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
      this: Collection, ...args: Parameters<Collection['insertOne']>
    ) {
      calls += 1;
      if (calls === 1) {
        // Simulate another writer winning seq 1 with a $600 payment, concurrently
        // with our own $500 payment attempt — a real balance change the retry
        // must observe, not a no-op collision.
        const shadow: LedgerEntryDoc = {
          _id: new ObjectId(),
          orderId,
          userId,
          seq: 1,
          kind: 'payment',
          amountMinor: 60000,
          occurredAt: NOW,
          recordedAt: NOW,
          note: null,
          balanceAfter: { paidMinor: 60000, refundedMinor: 0, netPaidMinor: 60000 },
          statusBefore: 'pending',
          statusAfter: 'partially_paid',
          idempotencyKey: null,
        };
        await real.call(this, shadow);
        throw seqCollisionError();
      }
      return real.apply(this, args);
    });

    // Our own $500 payment: fits against the original $1,000 total in isolation,
    // but not after the shadow $600 payment lands — attempt 2 must reject it.
    await expect(appendEntry(userId, order.id, pay(50000), NOW))
      .rejects.toMatchObject({ code: 'OVERPAYMENT' });

    const auditCount = await (await audit())
      .countDocuments({ orderId, event: 'payment.rejected' });
    expect(auditCount).toBe(1);

    const entries = await listEntries(orderId);
    expect(entries).toHaveLength(1); // only the shadow entry; our own payment never inserted
  });
});
