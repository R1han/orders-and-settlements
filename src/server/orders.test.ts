import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { toObjectId, toView } from './orders';
import { ZERO_BALANCE } from '@/domain/types';
import type { OrderDoc } from './db';

// Not in the brief. toObjectId and toView are pure enough to unit test without
// a database, and the task instructions specifically flag both as places where
// a one-line regression (throwing instead of returning null; leaking an
// internal field into the API response) would slip past orders.test.ts, which
// only ever calls these functions with well-formed data through the happy path.

describe('toObjectId', () => {
  it('accepts a valid 24-character hex id', () => {
    const hex = new ObjectId().toHexString();
    expect(toObjectId(hex)?.toHexString()).toBe(hex);
  });

  it('returns null, not a thrown BSONError, for a 24-character non-hex string', () => {
    expect(toObjectId('zzzzzzzzzzzzzzzzzzzzzzzz')).toBeNull();
  });

  it('returns null for a string shorter than 24 characters', () => {
    expect(toObjectId('not-an-object-id')).toBeNull();
  });

  it('returns null for a 12-character string (the legacy 12-byte ObjectId form)', () => {
    // mongodb's ObjectId historically accepted any 12-byte string as valid.
    // Confirms this driver version's isValid still rejects it for our purposes.
    expect(toObjectId('123456789012')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(toObjectId('')).toBeNull();
  });
});

describe('toView', () => {
  // Mutation: add `userId: order.userId` (or spread `...order`) into toView's
  // return object. This test fails because 'userId' (and '_id', 'deletedAt',
  // 'updatedAt') would then appear in Object.keys(view).
  it('exposes only the documented OrderView fields, never userId or other internal document fields', () => {
    const order: OrderDoc = {
      _id: new ObjectId(),
      userId: new ObjectId(),
      ref: 'ORD-1001',
      customer: 'Acme FZ-LLC',
      dueDate: new Date('2026-02-01T00:00:00Z'),
      lines: [{ description: 'Consulting', quantity: 1, unitPriceMinor: 1000, lineTotalMinor: 1000 }],
      subtotalMinor: 1000,
      totalMinor: 1000,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: null,
    };
    const view = toView(order, ZERO_BALANCE, new Date('2026-01-15T00:00:00Z'));
    expect(Object.keys(view).sort()).toEqual([
      'createdAt', 'customer', 'dueDate', 'dueMinor', 'id', 'lines', 'netPaidMinor',
      'paidMinor', 'ref', 'refundedMinor', 'status', 'subtotalMinor', 'totalMinor',
    ]);
    expect(JSON.stringify(view)).not.toContain(order.userId.toHexString());
  });
});
