import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';

let server: MongoMemoryReplSet;

/**
 * Replica-set mode, not standalone. Atlas is a replica set, so retryable writes
 * and duplicate-key behaviour under concurrency are exercised against the same
 * topology the app actually meets in production.
 */
export function useTestDb() {
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    process.env.MONGODB_URI = server.getUri();
    process.env.MONGODB_DB = 'test';
    const { ensureIndexes } = await import('@/server/db');
    await ensureIndexes();
  }, 120_000);

  beforeEach(async () => {
    const { users, orders, ledger, audit } = await import('@/server/db');
    for (const collection of [await users(), await orders(), await ledger(), await audit()]) {
      await collection.deleteMany({});
    }
  });

  afterAll(async () => {
    const { closeDb } = await import('@/server/db');
    await closeDb();
    await server.stop();
  });
}
