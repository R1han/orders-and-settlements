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

export async function latestSeq(orderId: ObjectId): Promise<number> {
  const entry = await (await ledger()).findOne({ orderId }, { sort: { seq: -1 }, projection: { seq: 1 } });
  return entry?.seq ?? 0;
}

export async function entryCount(orderId: ObjectId): Promise<number> {
  return (await ledger()).countDocuments({ orderId });
}

export async function listEntries(orderId: ObjectId): Promise<LedgerEntryDoc[]> {
  return (await ledger()).find({ orderId }).sort({ seq: 1 }).toArray();
}
