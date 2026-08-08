import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, patchOrder, softDeleteOrder, getOrder } from '@/server/orders';
import { NotFoundError, OrderLockedError } from '@/domain/errors';
import { ledger } from '@/server/db';

setupTestDb();

const NOW = new Date('2026-01-05T12:00:00Z');
const input = {
  customer: 'Acme FZ-LLC',
  dueDate: new Date('2026-01-12T00:00:00Z'),
  lines: [{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }],
};

async function addEntry(orderId: ObjectId, userId: ObjectId) {
  await (await ledger()).insertOne({
    _id: new ObjectId(), orderId, userId, seq: 1, kind: 'payment', amountMinor: 40000,
    occurredAt: NOW, recordedAt: NOW, note: null, idempotencyKey: null,
    balanceAfter: { paidMinor: 40000, refundedMinor: 0, netPaidMinor: 40000 },
    statusBefore: 'pending', statusAfter: 'partially_paid',
  });
}

describe('while unlocked', () => {
  it('updates metadata', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    const patched = await patchOrder(userId, created.id, { customer: 'Acme Holdings' }, NOW);
    expect(patched.customer).toBe('Acme Holdings');
  });

  it('soft deletes and then reports not found', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await softDeleteOrder(userId, created.id);
    await expect(getOrder(userId, created.id, NOW)).rejects.toThrow(NotFoundError);

    // Soft, not hard: the document survives so the trail is intact.
    const { orders } = await import('@/server/db');
    const doc = await (await orders()).findOne({ _id: new ObjectId(created.id) });
    expect(doc?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('once a ledger entry exists', () => {
  it('rejects a metadata update', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await addEntry(new ObjectId(created.id), userId);
    await expect(patchOrder(userId, created.id, { customer: 'Nope' }, NOW)).rejects.toThrow(OrderLockedError);
  });

  it('rejects a delete', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await addEntry(new ObjectId(created.id), userId);
    await expect(softDeleteOrder(userId, created.id)).rejects.toThrow(OrderLockedError);
  });

  it('reports the entry count in the error details', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await addEntry(new ObjectId(created.id), userId);
    await expect(patchOrder(userId, created.id, { customer: 'Nope' }, NOW))
      .rejects.toMatchObject({ code: 'ORDER_LOCKED', httpStatus: 409, details: { entryCount: 1 } });
  });
});

describe('cross-user isolation on writes', () => {
  it('will not let another user patch or delete', async () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    const created = await createOrder(alice, input, NOW);
    await expect(patchOrder(bob, created.id, { customer: 'Hijacked' }, NOW)).rejects.toThrow(NotFoundError);
    await expect(softDeleteOrder(bob, created.id)).rejects.toThrow(NotFoundError);
  });
});

describe('soft-deleted orders stay locked out', () => {
  it('rejects patching an already-deleted order rather than succeeding twice', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await softDeleteOrder(userId, created.id);
    await expect(patchOrder(userId, created.id, { customer: 'Zombie' }, NOW)).rejects.toThrow(NotFoundError);
  });

  it('rejects deleting an already-deleted order a second time', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    await softDeleteOrder(userId, created.id);
    await expect(softDeleteOrder(userId, created.id)).rejects.toThrow(NotFoundError);
  });
});

describe('patchOrder returns what was actually persisted', () => {
  it('matches a subsequent getOrder after both fields change', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    const newDueDate = new Date('2026-02-01T00:00:00Z');
    const patched = await patchOrder(userId, created.id, { customer: 'Beta Co', dueDate: newDueDate }, NOW);
    const reloaded = await getOrder(userId, created.id, NOW);
    expect(patched).toEqual(reloaded);
  });
});

describe('patchOrder ignores fields it does not own', () => {
  it('cannot be used to change lines, totalMinor, ref, userId, or deletedAt', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    const hijack = {
      customer: 'Legit Update',
      lines: [{ description: 'Free stuff', quantity: 1, unitPriceMinor: 1 }],
      totalMinor: 1,
      ref: 'HACKED-1',
      userId: new ObjectId(),
      deletedAt: new Date(),
    };
    await patchOrder(userId, created.id, hijack as unknown as { customer?: string; dueDate?: Date }, NOW);

    const { orders } = await import('@/server/db');
    const doc = await (await orders()).findOne({ _id: new ObjectId(created.id) });
    expect(doc?.ref).toBe(created.ref);
    expect(doc?.totalMinor).toBe(created.totalMinor);
    expect(doc?.lines).toEqual(created.lines);
    expect(doc?.userId).toEqual(userId);
    expect(doc?.deletedAt).toBeNull();
    expect(doc?.customer).toBe('Legit Update');
  });
});

describe('empty patch', () => {
  it('is a no-op on the data but still bumps updatedAt and records an audit event', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, input, NOW);
    const patched = await patchOrder(userId, created.id, {}, NOW);
    expect(patched.customer).toBe(input.customer);
    expect(patched.dueDate).toBe(input.dueDate.toISOString());

    const { orders, audit } = await import('@/server/db');
    const doc = await (await orders()).findOne({ _id: new ObjectId(created.id) });
    expect(doc?.updatedAt.getTime()).toBeGreaterThan(doc!.createdAt.getTime());

    const auditDocs = await (await audit())
      .find({ orderId: new ObjectId(created.id), event: 'order.updated' })
      .toArray();
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0].payload).toEqual({ fields: [] });
  });
});
