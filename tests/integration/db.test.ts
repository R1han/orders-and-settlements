import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { useTestDb } from './helpers';
import { ledger, users, ensureIndexes, isDuplicateKey, closeDb, getDb } from '@/server/db';

useTestDb();

const entry = (orderId: ObjectId, userId: ObjectId, seq: number, idempotencyKey: string | null = null) => ({
  orderId, userId, seq, kind: 'payment' as const, amountMinor: 100,
  occurredAt: new Date(), recordedAt: new Date(), note: null, idempotencyKey,
  balanceAfter: { paidMinor: 100, refundedMinor: 0, netPaidMinor: 100 },
  statusBefore: 'pending' as const, statusAfter: 'partially_paid' as const,
});

describe('db module', () => {
  // The brief's tests only ever check that isDuplicateKey(error, <correct name>)
  // is true. A version that ignores `indexName` entirely and just checks
  // error.code === 11000 would pass every one of those tests. Task 10 relies on
  // the negative direction too: a seq collision must NOT be mistaken for an
  // idempotency collision, or the retry-vs-return-original branch picks wrong.
  it('does not match a seq collision against the idempotency index name', async () => {
    const collection = await ledger();
    const orderId = new ObjectId();
    const userId = new ObjectId();
    await collection.insertOne(entry(orderId, userId, 1) as never);
    await expect(collection.insertOne(entry(orderId, userId, 1) as never)).rejects.toSatisfy((error: unknown) => {
      expect(isDuplicateKey(error, 'order_seq_unique')).toBe(true);
      expect(isDuplicateKey(error, 'user_idem_unique')).toBe(false);
      return true;
    });
  });

  it('does not match an idempotency collision against the seq index name', async () => {
    const collection = await ledger();
    const userId = new ObjectId();
    await collection.insertOne(entry(new ObjectId(), userId, 1, 'key-1') as never);
    await expect(collection.insertOne(entry(new ObjectId(), userId, 1, 'key-1') as never)).rejects.toSatisfy(
      (error: unknown) => {
        expect(isDuplicateKey(error, 'user_idem_unique')).toBe(true);
        expect(isDuplicateKey(error, 'order_seq_unique')).toBe(false);
        return true;
      },
    );
  });

  it('does not match a duplicate email against either ledger index name', async () => {
    const collection = await users();
    await collection.insertOne({ email: 'dup@b.com', passwordHash: 'x', createdAt: new Date() } as never);
    await expect(
      collection.insertOne({ email: 'dup@b.com', passwordHash: 'y', createdAt: new Date() } as never),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isDuplicateKey(error, 'email_unique')).toBe(true);
      expect(isDuplicateKey(error, 'order_seq_unique')).toBe(false);
      expect(isDuplicateKey(error, 'user_idem_unique')).toBe(false);
      return true;
    });
  });

  it('returns false for a non-Mongo error regardless of index name', () => {
    expect(isDuplicateKey(new Error('boom'), 'order_seq_unique')).toBe(false);
    expect(isDuplicateKey('not an error', 'email_unique')).toBe(false);
    expect(isDuplicateKey(undefined, 'user_idem_unique')).toBe(false);
  });

  // ensureIndexes is called once already in beforeAll (helpers.ts). Calling it
  // again here must not throw — createIndexes on an identical spec is a no-op,
  // but if a future edit ever races two ensureIndexes() calls, or changes an
  // index in a way Mongo considers a conflict, this is what would catch it.
  it('is idempotent: calling ensureIndexes twice does not throw', async () => {
    await expect(ensureIndexes()).resolves.toBeUndefined();
    await expect(ensureIndexes()).resolves.toBeUndefined();
  });

  // closeDb must reset the cached client, not just close it — otherwise the
  // next getDb() call would await an already-closed MongoClient promise and
  // every subsequent database call in the process would fail.
  it('closeDb resets the cache so a later getDb reconnects and stays usable', async () => {
    const db = await getDb();
    await db.command({ ping: 1 });

    await closeDb();

    const reconnected = await getDb();
    await expect(reconnected.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });

    const collection = await users();
    await expect(
      collection.insertOne({ email: `reconnect-${Date.now()}@b.com`, passwordHash: 'x', createdAt: new Date() } as never),
    ).resolves.toBeTruthy();

    // Indexes still need to exist post-reconnect for later tests/tasks relying
    // on them; ensureIndexes' own cache was cleared by closeDb too.
    await ensureIndexes();
  });
});
