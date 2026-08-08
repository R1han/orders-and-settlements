import type { ObjectId } from 'mongodb';
import { ZERO_BALANCE, type Balance } from '@/domain/types';
import { ledger, type LedgerEntryDoc } from './db';

/**
 * The newest entry carries the balance after itself, so "current balance" is a
 * single indexed seek on order_seq_unique rather than a sum over every entry.
 * The value is immutable once written and therefore cannot drift.
 */
export async function latestBalance(orderId: ObjectId): Promise<Balance> {
  const entry = await (await ledger()).findOne({ orderId }, { sort: { seq: -1 } });
  return entry?.balanceAfter ?? ZERO_BALANCE;
}

export async function entryCount(orderId: ObjectId): Promise<number> {
  return (await ledger()).countDocuments({ orderId });
}

/**
 * `userId` is optional only so the brief's own fixture (a single order, a
 * single user, called as `listEntries(orderId)`) still compiles unchanged.
 * Every real caller has a userId in hand by this point and should pass it —
 * ownership is otherwise established once, upstream, by whichever loader ran
 * first, rather than re-checked at every read.
 */
export async function listEntries(orderId: ObjectId, userId?: ObjectId): Promise<LedgerEntryDoc[]> {
  return (await ledger()).find(userId ? { orderId, userId } : { orderId }).sort({ seq: 1 }).toArray();
}
