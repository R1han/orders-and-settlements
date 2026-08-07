import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { ledger, users, isDuplicateKey } from '@/server/db';

setupTestDb();

const entry = (orderId: ObjectId, userId: ObjectId, seq: number, idempotencyKey: string | null = null) => ({
  orderId, userId, seq, kind: 'payment' as const, amountMinor: 100,
  occurredAt: new Date(), recordedAt: new Date(), note: null, idempotencyKey,
  balanceAfter: { paidMinor: 100, refundedMinor: 0, netPaidMinor: 100 },
  statusBefore: 'pending' as const, statusAfter: 'partially_paid' as const,
});

describe('indexes', () => {
  it('rejects a duplicate email', async () => {
    const collection = await users();
    await collection.insertOne({ email: 'a@b.com', passwordHash: 'x', createdAt: new Date() } as never);
    await expect(
      collection.insertOne({ email: 'a@b.com', passwordHash: 'y', createdAt: new Date() } as never),
    ).rejects.toSatisfy((error: unknown) => isDuplicateKey(error, 'email_unique'));
  });

  it('rejects a duplicate (orderId, seq) — the concurrency guard', async () => {
    const collection = await ledger();
    const orderId = new ObjectId();
    const userId = new ObjectId();
    await collection.insertOne(entry(orderId, userId, 1) as never);
    await expect(collection.insertOne(entry(orderId, userId, 1) as never))
      .rejects.toSatisfy((error: unknown) => isDuplicateKey(error, 'order_seq_unique'));
  });

  it('allows the same seq on different orders', async () => {
    const collection = await ledger();
    const userId = new ObjectId();
    await collection.insertOne(entry(new ObjectId(), userId, 1) as never);
    await expect(collection.insertOne(entry(new ObjectId(), userId, 1) as never)).resolves.toBeTruthy();
  });

  it('rejects a duplicate idempotency key for one user', async () => {
    const collection = await ledger();
    const userId = new ObjectId();
    await collection.insertOne(entry(new ObjectId(), userId, 1, 'key-1') as never);
    await expect(collection.insertOne(entry(new ObjectId(), userId, 1, 'key-1') as never))
      .rejects.toSatisfy((error: unknown) => isDuplicateKey(error, 'user_idem_unique'));
  });

  it('does not collide on absent idempotency keys', async () => {
    // The partial index covers string keys only, so many nulls coexist.
    const collection = await ledger();
    const userId = new ObjectId();
    await collection.insertOne(entry(new ObjectId(), userId, 1, null) as never);
    await expect(collection.insertOne(entry(new ObjectId(), userId, 1, null) as never)).resolves.toBeTruthy();
  });

  it('scopes idempotency keys per user', async () => {
    const collection = await ledger();
    await collection.insertOne(entry(new ObjectId(), new ObjectId(), 1, 'key-1') as never);
    await expect(collection.insertOne(entry(new ObjectId(), new ObjectId(), 1, 'key-1') as never)).resolves.toBeTruthy();
  });
});
