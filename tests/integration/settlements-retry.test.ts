import { describe, it, expect, vi, afterEach } from 'vitest';
import { Collection, MongoServerError, ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, softDeleteOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { listEntries } from '@/server/ledger';
import { ledger, audit, type LedgerEntryDoc } from '@/server/db';

/**
 * settlements.test.ts's concurrency tests race two *real* appendEntry calls and
 * rely on them genuinely overlapping at the database layer. That is reliable
 * once the harness warms the connection pool (see helpers.ts) — verified
 * directly: with the pool cold, a build with the seq-collision retry stripped
 * out still passed "lets exactly one of two racing payments through" 10/10
 * times, because the second call's read routinely trailed the first call's
 * whole read+insert cycle rather than overlapping it, so the ordinary
 * overpayment check produced the same observable result the retry would have.
 * Warming the pool made the same broken build fail that test 10/10 times.
 *
 * These tests are additional, not a replacement for that real race: they
 * remove timing from the equation entirely by mocking
 * `Collection.prototype.insertOne`/`findOne` to force specific interleavings —
 * retry-exhaustion, a concurrent delete, a concurrent balance change — that a
 * real race would only produce by luck of scheduling. The mock is scoped to
 * the `ledgerEntries` collection only (checked via `this.collectionName`), so
 * it never intercepts the `orders` or `auditLog` writes the code under test
 * also performs — those go straight to the real driver, uncounted and
 * unaffected, avoiding both re-entrancy surprises and miscounted call totals.
 */

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

function seqCollisionError(): MongoServerError {
  return new MongoServerError({
    message: 'E11000 duplicate key error collection: test.ledgerEntries index: order_seq_unique dup key: { orderId: 1, seq: 1 }',
    code: 11000,
  });
}

function idemCollisionError(): MongoServerError {
  return new MongoServerError({
    message: "E11000 duplicate key error collection: test.ledgerEntries index: user_idem_unique dup key: { userId: 1, idempotencyKey: 'x' }",
    code: 11000,
  });
}

/**
 * Spies on Collection.prototype.insertOne, but only *acts* on inserts into
 * ledgerEntries — every other collection's insert goes straight to the real
 * driver, untouched and uncounted. `handler` receives the document, a
 * `insertReal` callback bound to the right collection instance so it can
 * still perform a genuine insert when needed, and a 1-based call number
 * scoped to ledgerEntries alone.
 */
function spyLedgerInserts(
  handler: (
    doc: LedgerEntryDoc,
    insertReal: (doc: LedgerEntryDoc) => ReturnType<Collection<LedgerEntryDoc>['insertOne']>,
    callNumber: number,
  ) => ReturnType<Collection<LedgerEntryDoc>['insertOne']>,
): { count: number } {
  const real = Collection.prototype.insertOne;
  const counter = { count: 0 };
  vi.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
    this: Collection, ...args: Parameters<Collection['insertOne']>
  ) {
    if (this.collectionName !== 'ledgerEntries') return real.apply(this, args);
    counter.count += 1;
    const insertReal = (doc: LedgerEntryDoc) => real.call(this, doc as never) as ReturnType<Collection<LedgerEntryDoc>['insertOne']>;
    return handler(args[0] as unknown as LedgerEntryDoc, insertReal, counter.count);
  });
  return counter;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retry loop edge cases (deterministic — mocked, not timing-dependent)', () => {
  it('gives up and throws ConcurrencyError after exhausting retries under sustained seq collisions, and audits it', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const orderId = new ObjectId(order.id);
    const counter = spyLedgerInserts(async () => { throw seqCollisionError(); });

    await expect(appendEntry(userId, order.id, pay(1000), NOW))
      .rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', httpStatus: 409 });

    // MAX_ATTEMPTS is 5 in src/server/settlements.ts: one insert attempt per loop iteration.
    expect(counter.count).toBe(5);
    expect(await (await ledger()).countDocuments({ orderId })).toBe(0);
    // Exhausting retries writes no ledger entry, so the audit row is the only
    // trace of the attempt that will ever exist.
    const record = await (await audit()).findOne({ orderId, event: 'payment.rejected' });
    expect(record?.payload).toMatchObject({ code: 'CONCURRENT_UPDATE', amountMinor: 1000 });
  });

  it('recovers from a genuine seq collision and succeeds on retry, independent of real timing', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const counter = spyLedgerInserts((doc, insertReal, callNumber) => (
      callNumber === 1 ? Promise.reject(seqCollisionError()) : insertReal(doc)
    ));

    const result = await appendEntry(userId, order.id, pay(40000), NOW);
    expect(result.replayed).toBe(false);
    expect(counter.count).toBe(2);

    const entries = await listEntries(new ObjectId(order.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].seq).toBe(1);
    expect(entries[0].balanceAfter.netPaidMinor).toBe(40000);
  });

  it('propagates NotFoundError, not a further retry, when the order is soft-deleted between attempts', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);

    spyLedgerInserts(async (_doc, _insertReal, callNumber) => {
      if (callNumber === 1) {
        // Simulate a concurrent request deleting the order right after this
        // attempt's insert collides, but before the retry loop re-reads it. This
        // real softDeleteOrder call touches `orders` and `auditLog`, not
        // `ledgerEntries`, so it passes straight through the scoped mock above —
        // no re-entrancy into this handler, no effect on the call count.
        await softDeleteOrder(userId, order.id);
        throw seqCollisionError();
      }
      throw new Error('should not reach a second ledger insert: loadOwnedOrder should have thrown NotFoundError first');
    });

    await expect(appendEntry(userId, order.id, pay(1000), NOW))
      .rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('writes exactly one rejection audit row when a retry precedes the final rejection', async () => {
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);
    const orderId = new ObjectId(order.id);

    spyLedgerInserts(async (doc, insertReal, callNumber) => {
      if (callNumber === 1) {
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
        await insertReal(shadow);
        throw seqCollisionError();
      }
      return insertReal(doc);
    });

    // Our own $500 payment: fits against the original $1,000 total in isolation,
    // but not after the shadow $600 payment lands — attempt 2 must reject it.
    await expect(appendEntry(userId, order.id, pay(50000), NOW))
      .rejects.toMatchObject({ code: 'OVERPAYMENT' });

    const auditCount = await (await audit()).countDocuments({ orderId, event: 'payment.rejected' });
    expect(auditCount).toBe(1);

    const entries = await listEntries(orderId);
    expect(entries).toHaveLength(1); // only the shadow entry; our own payment never inserted
  });

  it('translates a duplicate idempotency-key error to ConcurrencyError instead of letting it escape untranslated', async () => {
    // Guards the fallthrough M-1 fixed: if user_idem_unique fires but the row it
    // names cannot be found (e.g. it vanished between the failed insert and this
    // read), the old code fell through to the seq check, which also didn't
    // match, and rethrew the raw MongoServerError as an unhandled 500.
    const userId = new ObjectId();
    const order = await createOrder(userId, input, NOW);

    spyLedgerInserts(async () => { throw idemCollisionError(); });

    const realFindOne = Collection.prototype.findOne;
    vi.spyOn(Collection.prototype, 'findOne').mockImplementation(function (
      this: Collection, ...args: Parameters<Collection['findOne']>
    ) {
      const filter = args[0] as Record<string, unknown> | undefined;
      if (this.collectionName === 'ledgerEntries' && filter && 'idempotencyKey' in filter) {
        return Promise.resolve(null) as ReturnType<Collection['findOne']>;
      }
      return realFindOne.apply(this, args);
    });

    await expect(appendEntry(userId, order.id, pay(1000, 'vanished-key'), NOW))
      .rejects.toMatchObject({ code: 'CONCURRENT_UPDATE', httpStatus: 409 });
  });
});
