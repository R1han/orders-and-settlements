import { ObjectId } from 'mongodb';
import { NotFoundError } from '@/domain/errors';
import { computeTotals } from '@/domain/order';
import { deriveStatus, dueMinor } from '@/domain/status';
import type { Balance, LineItem, LineItemInput, OrderStatus } from '@/domain/types';
import { ZERO_BALANCE } from '@/domain/types';
import { counters, orders, type OrderDoc } from './db';
import { latestBalance } from './ledger';
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

/** Never throws on malformed input — an unparseable id is simply not found. */
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

export async function createOrder(userId: ObjectId, input: CreateOrderInput): Promise<OrderView> {
  const totals = computeTotals(input.lines);
  const now = new Date();
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
  await recordAudit(userId, doc._id, 'order.created', {
    totalMinor: doc.totalMinor, lineCount: doc.lines.length,
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
