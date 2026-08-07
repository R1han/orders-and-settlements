import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, getOrder } from '@/server/orders';
import { NotFoundError } from '@/domain/errors';

setupTestDb();

const NOW = new Date('2026-01-05T12:00:00Z');
// createOrder always uses the real wall clock internally (it takes no `now`
// parameter), so a hardcoded due date drifts into the past as real time moves
// on. A future-relative date keeps the "starts as pending" assertion
// deterministic regardless of when the suite runs.
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }],
};

describe('createOrder', () => {
  it('computes totals server-side and starts as pending', async () => {
    const view = await createOrder(new ObjectId(), input);
    expect(view.subtotalMinor).toBe(100000);
    expect(view.totalMinor).toBe(100000);
    expect(view.lines[0].lineTotalMinor).toBe(100000);
    expect(view.netPaidMinor).toBe(0);
    expect(view.dueMinor).toBe(100000);
    expect(view.status).toBe('pending');
  });

  it('issues sequential per-user references', async () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    expect((await createOrder(alice, input)).ref).toBe('ORD-1001');
    expect((await createOrder(alice, input)).ref).toBe('ORD-1002');
    // Sequences are per user, so Bob does not continue Alice's numbering.
    expect((await createOrder(bob, input)).ref).toBe('ORD-1001');
  });

  it('never issues the same reference twice under concurrent creation', async () => {
    const userId = new ObjectId();
    const created = await Promise.all(Array.from({ length: 10 }, () => createOrder(userId, input)));
    expect(new Set(created.map((o) => o.ref)).size).toBe(10);
  });

  it('writes an order.created audit record', async () => {
    const userId = new ObjectId();
    const view = await createOrder(userId, input);
    const { audit } = await import('@/server/db');
    const record = await (await audit()).findOne({ userId, orderId: new ObjectId(view.id) });
    expect(record?.event).toBe('order.created');
  });
});

describe('getOrder', () => {
  it('returns an order to its owner', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input);
    expect((await getOrder(userId, created.id, NOW)).id).toBe(created.id);
  });

  it('rejects a malformed id as not found rather than throwing', async () => {
    await expect(getOrder(new ObjectId(), 'not-an-object-id', NOW)).rejects.toThrow(NotFoundError);
  });

  it('does not leak an order belonging to another user', async () => {
    // Cross-user isolation. userId is a query predicate, so the wrong owner
    // sees exactly what a non-existent id sees: 404, never 403.
    const alice = new ObjectId();
    const bob = new ObjectId();
    const created = await createOrder(alice, input);
    await expect(getOrder(bob, created.id, NOW)).rejects.toThrow(NotFoundError);
  });
});
