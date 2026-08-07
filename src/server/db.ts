import { MongoClient, MongoServerError, ObjectId, type Collection, type Db } from 'mongodb';
import type { Balance, LedgerKind, LineItem, OrderStatus } from '@/domain/types';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface OrderDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** Human-readable per-user reference, e.g. "ORD-1042". Shown on every screen. */
  ref: string;
  customer: string;
  dueDate: Date;
  lines: LineItem[];
  subtotalMinor: number;
  totalMinor: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Append-only. Never updated, never deleted — the only write is insertOne. */
export interface LedgerEntryDoc {
  _id: ObjectId;
  orderId: ObjectId;
  userId: ObjectId;
  seq: number;
  kind: LedgerKind;
  amountMinor: number;
  occurredAt: Date;
  recordedAt: Date;
  note: string | null;
  balanceAfter: Balance;
  statusBefore: OrderStatus;
  statusAfter: OrderStatus;
  idempotencyKey: string | null;
}

export interface AuditDoc {
  _id: ObjectId;
  userId: ObjectId;
  orderId: ObjectId | null;
  event: 'order.created' | 'order.updated' | 'order.deleted' | 'payment.rejected' | 'refund.rejected';
  at: Date;
  payload: Record<string, unknown>;
}

/**
 * One document per user, keyed by userId, holding the order-reference sequence.
 * $inc on a single document is atomic, so concurrent order creation cannot issue
 * the same reference twice — the same reasoning as the ledger's seq, one level up.
 */
export interface CounterDoc {
  _id: ObjectId;
  orderSeq: number;
}

declare global {
  var __mongoClient: Promise<MongoClient> | undefined;
  var __mongoIndexes: Promise<void> | undefined;
}

/**
 * Cached on globalThis so serverless invocations and dev hot reloads reuse one
 * pool. Without this, each cold start opens a fresh pool and Atlas connection
 * limits are exhausted under trivial load.
 */
function clientPromise(): Promise<MongoClient> {
  if (!globalThis.__mongoClient) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set.');
    globalThis.__mongoClient = new MongoClient(uri).connect();
  }
  return globalThis.__mongoClient;
}

export async function getDb(): Promise<Db> {
  return (await clientPromise()).db(process.env.MONGODB_DB ?? 'orders_settlements');
}

export async function users(): Promise<Collection<UserDoc>> {
  return (await getDb()).collection<UserDoc>('users');
}
export async function orders(): Promise<Collection<OrderDoc>> {
  return (await getDb()).collection<OrderDoc>('orders');
}
export async function ledger(): Promise<Collection<LedgerEntryDoc>> {
  return (await getDb()).collection<LedgerEntryDoc>('ledgerEntries');
}
export async function audit(): Promise<Collection<AuditDoc>> {
  return (await getDb()).collection<AuditDoc>('auditLog');
}
export async function counters(): Promise<Collection<CounterDoc>> {
  return (await getDb()).collection<CounterDoc>('counters');
}

export function ensureIndexes(): Promise<void> {
  globalThis.__mongoIndexes ??= (async () => {
    await (await users()).createIndexes([
      { key: { email: 1 }, unique: true, name: 'email_unique' },
    ]);
    await (await orders()).createIndexes([
      { key: { userId: 1, createdAt: -1 }, name: 'user_created' },
      { key: { userId: 1, dueDate: 1 }, name: 'user_due' },
    ]);
    await (await ledger()).createIndexes([
      // Two jobs from one index: the uniqueness constraint is the concurrency
      // guard, and the descending seq serves the latest-entry lookup.
      { key: { orderId: 1, seq: -1 }, unique: true, name: 'order_seq_unique' },
      {
        key: { userId: 1, idempotencyKey: 1 },
        unique: true,
        name: 'user_idem_unique',
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
    ]);
    await (await audit()).createIndexes([
      { key: { userId: 1, orderId: 1, at: -1 }, name: 'user_order_at' },
    ]);
  })();
  return globalThis.__mongoIndexes;
}

export function isDuplicateKey(error: unknown, indexName: string): boolean {
  return error instanceof MongoServerError
    && error.code === 11000
    && String(error.errmsg ?? error.message).includes(indexName);
}

export async function closeDb(): Promise<void> {
  const existing = globalThis.__mongoClient;
  globalThis.__mongoClient = undefined;
  globalThis.__mongoIndexes = undefined;
  if (existing) await (await existing).close();
}
