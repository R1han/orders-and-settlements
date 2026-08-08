import { ObjectId } from 'mongodb';
import { NotFoundError, OrderLockedError } from '@/domain/errors';
import { computeTotals } from '@/domain/order';
import { deriveStatus, dueMinor } from '@/domain/status';
import type { Balance, LineItem, LineItemInput, OrderStatus } from '@/domain/types';
import { ZERO_BALANCE } from '@/domain/types';
import { counters, orders, type OrderDoc } from './db';
import { entryCount, latestBalance } from './ledger';
import { recordAudit } from './audit';

export interface CreateOrderInput {
  customer: string;
  dueDate: Date;
  lines: LineItemInput[];
}

export interface OrderView {
  id: string;
  ref: string;
  customer: string;
  dueDate: string;
  lines: LineItem[];
  subtotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  dueMinor: number;
  status: OrderStatus;
  createdAt: string;
}

export function toView(order: OrderDoc, balance: Balance, now: Date): OrderView {
  return {
    id: order._id.toHexString(),
    ref: order.ref,
    customer: order.customer,
    dueDate: order.dueDate.toISOString(),
    lines: order.lines,
    subtotalMinor: order.subtotalMinor,
    totalMinor: order.totalMinor,
    paidMinor: balance.paidMinor,
    refundedMinor: balance.refundedMinor,
    netPaidMinor: balance.netPaidMinor,
    dueMinor: dueMinor(order.totalMinor, balance),
    status: deriveStatus(order, balance, now),
    createdAt: order.createdAt.toISOString(),
  };
}

/**
 * Never throws on malformed input — an unparseable id is simply not found.
 * `ObjectId.isValid` also returns true for a 12-byte Buffer, not just a 24-char
 * hex string, so callers must pass a string. Route params always are; a
 * loosely-typed request body value is not guaranteed to be.
 */
export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/**
 * Issues the next per-user order reference. $inc on one document is atomic, so
 * two concurrent creations can never receive the same number — the ledger's seq
 * argument one level up. Starts at 1001 purely so references look established.
 */
export async function nextOrderRef(userId: ObjectId): Promise<string> {
  const counter = await (await counters()).findOneAndUpdate(
    { _id: userId },
    { $inc: { orderSeq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return `ORD-${1000 + (counter?.orderSeq ?? 1)}`;
}

export async function createOrder(
  userId: ObjectId,
  input: CreateOrderInput,
  now = new Date(),
): Promise<OrderView> {
  const totals = computeTotals(input.lines);
  const doc: OrderDoc = {
    _id: new ObjectId(),
    userId,
    ref: await nextOrderRef(userId),
    customer: input.customer.trim(),
    dueDate: input.dueDate,
    lines: totals.lines,
    subtotalMinor: totals.subtotalMinor,
    totalMinor: totals.totalMinor,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await (await orders()).insertOne(doc);

  // Best-effort, deliberately. The order is the write that matters; the audit row
  // is metadata about it, and no money has moved on an order with no settlements.
  // Failing the call here would tell the client the order was not created when it
  // was, and a retry would produce a duplicate — strictly worse than a missing
  // audit line.
  // ponytail: log-and-continue. If audit completeness ever becomes a hard
  // requirement, the fix is an outbox row written in the same insert, drained
  // separately — not a transaction, which would not survive the append-only model.
  await recordAudit(userId, doc._id, 'order.created', {
    totalMinor: doc.totalMinor, lineCount: doc.lines.length,
  }).catch((error) => {
    console.error('audit write failed for order.created', { orderId: doc._id.toHexString(), error });
  });

  return toView(doc, ZERO_BALANCE, now);
}

/** userId is part of the filter, so another user's order is indistinguishable from a missing one. */
export async function loadOwnedOrder(userId: ObjectId, orderId: string): Promise<OrderDoc> {
  const _id = toObjectId(orderId);
  if (!_id) throw new NotFoundError('Order');
  const order = await (await orders()).findOne({ _id, userId, deletedAt: null });
  if (!order) throw new NotFoundError('Order');
  return order;
}

export async function getOrder(userId: ObjectId, orderId: string, now: Date): Promise<OrderView> {
  const order = await loadOwnedOrder(userId, orderId);
  return toView(order, await latestBalance(order._id), now);
}

/**
 * Orders freeze once money has moved against them. Over-payment validation is
 * anchored to totalMinor, so a total that changes afterwards retroactively
 * invalidates every payment already accepted against it. Metadata freezes too,
 * which makes an order a financial record rather than a mutable row.
 */
async function assertUnlocked(order: OrderDoc): Promise<void> {
  const count = await entryCount(order._id);
  if (count > 0) throw new OrderLockedError(count);
}

export async function patchOrder(
  userId: ObjectId,
  orderId: string,
  patch: { customer?: string; dueDate?: Date },
  now: Date,
): Promise<OrderView> {
  const order = await loadOwnedOrder(userId, orderId);
  await assertUnlocked(order);

  const update: Partial<OrderDoc> = { updatedAt: new Date() };
  if (patch.customer !== undefined) update.customer = patch.customer.trim();
  if (patch.dueDate !== undefined) update.dueDate = patch.dueDate;

  // The entry count is read from ledgerEntries and this writes to orders, so a
  // payment landing in between is a different document and conflicts with nothing.
  // The race cannot be closed here — MongoDB gives snapshot isolation, and having
  // ledger appends touch the order to force a conflict would break the append-only
  // model. So the consequence is made recoverable instead: the audit row carries the
  // prior values, and no money figure is reachable through this path (totalMinor and
  // lines are not patchable), so nothing a payment was validated against can move.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (patch.customer !== undefined && patch.customer.trim() !== order.customer) {
    changes.customer = { from: order.customer, to: patch.customer.trim() };
  }
  if (patch.dueDate !== undefined && patch.dueDate.getTime() !== order.dueDate.getTime()) {
    changes.dueDate = { from: order.dueDate.toISOString(), to: patch.dueDate.toISOString() };
  }

  await (await orders()).updateOne({ _id: order._id, userId }, { $set: update });

  // Best-effort, deliberately, same as createOrder: the update already committed,
  // so an audit failure here must not turn a successful patch into a reported error.
  // Skipped entirely when nothing actually changed — a PATCH with no fields, or one
  // whose values match what's already stored, is not an edit and should not read as
  // one in the trail.
  if (Object.keys(changes).length > 0) {
    await recordAudit(userId, order._id, 'order.updated', { changes }).catch((error) => {
      console.error('audit write failed for order.updated', { orderId: order._id.toHexString(), error });
    });
  }

  return toView({ ...order, ...update } as OrderDoc, await latestBalance(order._id), now);
}

/**
 * Soft, not hard. "Check no entries exist, then delete" reads one collection and
 * writes another, so a concurrent payment conflicts with nothing and both commit.
 * A transaction does not fix that — snapshot isolation permits write skew. Soft
 * deletion makes the residual race benign: the worst case is an order flagged
 * deleted that holds one payment, which is recoverable and leaves the ledger intact.
 */
export async function softDeleteOrder(userId: ObjectId, orderId: string): Promise<void> {
  const order = await loadOwnedOrder(userId, orderId);
  await assertUnlocked(order);
  await (await orders()).updateOne(
    { _id: order._id, userId },
    { $set: { deletedAt: new Date(), updatedAt: new Date() } },
  );

  // Best-effort, deliberately, same as createOrder.
  await recordAudit(userId, order._id, 'order.deleted', {}).catch((error) => {
    console.error('audit write failed for order.deleted', { orderId: order._id.toHexString(), error });
  });
}
