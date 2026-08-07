import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, getOrder } from '@/server/orders';
import { NotFoundError } from '@/domain/errors';

setupTestDb();

// createOrder now takes an injectable `now`, matching every other function in
// this layer (getOrder already did). NOW is fixed and before dueDate, so
// "starts as pending" is deterministic rather than drifting with the wall clock.
const NOW = new Date('2026-01-05T12:00:00Z');
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date('2026-01-12T00:00:00Z'),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }],
};

describe('createOrder', () => {
  it('computes totals server-side and starts as pending', async () => {
    const view = await createOrder(new ObjectId(), input, NOW);
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
    expect((await createOrder(alice, input, NOW)).ref).toBe('ORD-1001');
    expect((await createOrder(alice, input, NOW)).ref).toBe('ORD-1002');
    // Sequences are per user, so Bob does not continue Alice's numbering.
    expect((await createOrder(bob, input, NOW)).ref).toBe('ORD-1001');
  });

  it('never issues the same reference twice under concurrent creation', async () => {
    const userId = new ObjectId();
    const created = await Promise.all(Array.from({ length: 10 }, () => createOrder(userId, input, NOW)));
    expect(new Set(created.map((o) => o.ref)).size).toBe(10);
  });

  it('writes an order.created audit record', async () => {
    const userId = new ObjectId();
    const view = await createOrder(userId, input, NOW);
    const { audit } = await import('@/server/db');
    const record = await (await audit()).findOne({ userId, orderId: new ObjectId(view.id) });
    expect(record?.event).toBe('order.created');
  });

  // Not in the brief. The order insert and the audit insert are two writes
  // without atomicity; if the audit write throws, createOrder must still
  // resolve with the order it already persisted, not reject and tell the
  // client creation failed when it did not.
  //
  // Spying on `(await audit()).insertOne` directly does not work here: the
  // mongodb driver's `Db.collection()` returns a fresh wrapper object on every
  // call, so a spy installed on the instance obtained in the test never
  // touches the instance `recordAudit` obtains internally. Spying on the
  // `recordAudit` export itself is the level at which createOrder actually
  // depends on it, so that's what's stubbed to reject.
  //
  // Mutation: remove the `.catch(...)` from the recordAudit call in
  // createOrder. This test then fails because createOrder rejects with the
  // stubbed audit error instead of resolving.
  it('resolves with the created order even when the audit write fails', async () => {
    const auditModule = await import('@/server/audit');
    const recordAudit = vi.spyOn(auditModule, 'recordAudit').mockRejectedValueOnce(new Error('audit db down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const userId = new ObjectId();

    const view = await createOrder(userId, input, NOW);

    expect(view.ref).toBe('ORD-1001');
    const { orders } = await import('@/server/db');
    const stored = await (await orders()).findOne({ _id: new ObjectId(view.id) });
    expect(stored).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();

    recordAudit.mockRestore();
    consoleError.mockRestore();
  });
});

describe('getOrder', () => {
  it('returns an order to its owner', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
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
    const created = await createOrder(alice, input, NOW);
    await expect(getOrder(bob, created.id, NOW)).rejects.toThrow(NotFoundError);
  });
});
