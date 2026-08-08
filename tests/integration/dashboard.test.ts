import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { dashboardSummary, listOrders } from '@/server/dashboard';
import { deriveStatus, endOfDayUtc } from '@/domain/status';
import type { OrderStatus } from '@/domain/types';

setupTestDb();

const NOW = new Date('2026-01-15T12:00:00Z');
const FUTURE = new Date('2026-02-01T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');

const order = (dueDate: Date, unitPriceMinor = 100000) => ({
  customer: 'Acme', dueDate, lines: [{ description: 'Work', quantity: 1, unitPriceMinor }],
});
const pay = (amountMinor: number) => ({ kind: 'payment' as const, amountMinor, occurredAt: NOW });

describe('listOrders', () => {
  it('returns derived fields for an order with no entries', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW);
    const result = await listOrders(userId, { page: 1, pageSize: 20 }, NOW);
    expect(result.total).toBe(1);
    expect(result.orders[0]).toMatchObject({ status: 'pending', netPaidMinor: 0, dueMinor: 100000 });
  });

  it('reflects the latest ledger balance', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, order(FUTURE), NOW);
    await appendEntry(userId, created.id, pay(40000), NOW);
    const result = await listOrders(userId, { page: 1, pageSize: 20 }, NOW);
    expect(result.orders[0]).toMatchObject({ status: 'partially_paid', netPaidMinor: 40000, dueMinor: 60000 });
  });

  it('filters by status in the database, not after paging', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW);            // pending
    await createOrder(userId, order(PAST), NOW);              // overdue
    const paidOrder = await createOrder(userId, order(FUTURE), NOW);
    await appendEntry(userId, paidOrder.id, pay(100000), NOW); // paid

    expect((await listOrders(userId, { status: 'pending', page: 1, pageSize: 20 }, NOW)).total).toBe(1);
    expect((await listOrders(userId, { status: 'overdue', page: 1, pageSize: 20 }, NOW)).total).toBe(1);
    expect((await listOrders(userId, { status: 'paid', page: 1, pageSize: 20 }, NOW)).total).toBe(1);
    expect((await listOrders(userId, { page: 1, pageSize: 20 }, NOW)).total).toBe(3);
  });

  it('paginates a filtered set correctly', async () => {
    // The bug this guards: filtering in JS after $skip/$limit would page over
    // unfiltered rows and return the wrong page.
    const userId = new ObjectId();
    for (let i = 0; i < 5; i += 1) await createOrder(userId, order(PAST), NOW);
    for (let i = 0; i < 5; i += 1) await createOrder(userId, order(FUTURE), NOW);

    const page1 = await listOrders(userId, { status: 'overdue', page: 1, pageSize: 3 }, NOW);
    const page2 = await listOrders(userId, { status: 'overdue', page: 2, pageSize: 3 }, NOW);
    expect(page1.total).toBe(5);
    expect(page1.orders).toHaveLength(3);
    expect(page2.orders).toHaveLength(2);
    expect(page1.orders.every((o) => o.status === 'overdue')).toBe(true);
    expect(page2.orders.every((o) => o.status === 'overdue')).toBe(true);
  });

  it('excludes soft-deleted orders and orders owned by others', async () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    const created = await createOrder(alice, order(FUTURE), NOW);
    await createOrder(bob, order(FUTURE), NOW);

    const { softDeleteOrder } = await import('@/server/orders');
    await softDeleteOrder(alice, created.id);
    expect((await listOrders(alice, { page: 1, pageSize: 20 }, NOW)).total).toBe(0);
    expect((await listOrders(bob, { page: 1, pageSize: 20 }, NOW)).total).toBe(1);
  });

  it('degrades safely on an out-of-range page rather than erroring', async () => {
    // Number() parses these, and an unclamped value reaches $skip, which cannot
    // represent them as a 64-bit integer and fails the whole query.
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW);

    for (const page of [Infinity, 1e21, Number.NaN, -5, 0]) {
      const result = await listOrders(userId, { page, pageSize: 20 }, NOW);
      expect(result.total, String(page)).toBe(1);
    }
  });

  it('returns an empty page past the end without losing the total', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW);

    const result = await listOrders(userId, { page: 500, pageSize: 20 }, NOW);
    expect(result.orders).toEqual([]);
    expect(result.total).toBe(1);
  });
});

describe('pipeline and domain agree', () => {
  it('derives the same status as deriveStatus across a fixture matrix', async () => {
    // The $switch duplicates the status rules in BSON. Two encodings of one rule
    // drift; this is the smallest thing that fails when they do.
    const userId = new ObjectId();
    const expected = new Map<string, OrderStatus>();

    const dueDates = [PAST, FUTURE, new Date('2026-01-15T00:00:00Z')]; // past, future, today
    const payments = [0, 1, 40000, 100000];

    for (const dueDate of dueDates) {
      for (const amount of payments) {
        const created = await createOrder(userId, order(dueDate), NOW);
        const balance = { paidMinor: amount, refundedMinor: 0, netPaidMinor: amount };
        if (amount > 0) await appendEntry(userId, created.id, pay(amount), NOW);
        expected.set(created.id, deriveStatus({ totalMinor: 100000, dueDate }, balance, NOW));
      }
    }

    const result = await listOrders(userId, { page: 1, pageSize: 100 }, NOW);
    expect(result.total).toBe(expected.size);
    for (const row of result.orders) {
      expect(row.status, `order ${row.id}`).toBe(expected.get(row.id));
    }
  });

  it('agrees at the exact end-of-day boundary and one millisecond past it', async () => {
    // endOfDayUtc(dueDate) is the last millisecond of the due day. deriveStatus
    // treats "now === that millisecond" as NOT overdue (now > eod is false) and
    // "now === that millisecond + 1" as overdue. The pipeline reaches the same
    // answer by truncating both sides to a day and comparing, not by reconstructing
    // end-of-day, so this pins that the two techniques land on the same side of
    // the line at the millisecond that actually matters.
    const userId = new ObjectId();
    const dueDate = new Date('2026-01-15T00:00:00Z');
    const eod = endOfDayUtc(dueDate); // 2026-01-15T23:59:59.999Z
    const justAfter = new Date(eod.getTime() + 1); // 2026-01-16T00:00:00.000Z

    const atBoundary = await createOrder(userId, order(dueDate), NOW);
    const pastBoundary = await createOrder(userId, order(dueDate), NOW);

    const expectedAtBoundary = deriveStatus({ totalMinor: 100000, dueDate }, { paidMinor: 0, refundedMinor: 0, netPaidMinor: 0 }, eod);
    const expectedPastBoundary = deriveStatus({ totalMinor: 100000, dueDate }, { paidMinor: 0, refundedMinor: 0, netPaidMinor: 0 }, justAfter);
    expect(expectedAtBoundary).toBe('pending');
    expect(expectedPastBoundary).toBe('overdue');

    const atResult = await listOrders(userId, { status: 'pending', page: 1, pageSize: 20 }, eod);
    const pastResult = await listOrders(userId, { status: 'overdue', page: 1, pageSize: 20 }, justAfter);

    expect(atResult.orders.map((o) => o.id)).toEqual(expect.arrayContaining([atBoundary.id, pastBoundary.id]));
    expect(pastResult.orders.map((o) => o.id)).toEqual(expect.arrayContaining([atBoundary.id, pastBoundary.id]));
  });

  it('treats a zero-total order as paid in both encodings', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE, 0), NOW);
    const expected = deriveStatus({ totalMinor: 0, dueDate: FUTURE }, { paidMinor: 0, refundedMinor: 0, netPaidMinor: 0 }, NOW);
    expect(expected).toBe('paid');

    const result = await listOrders(userId, { page: 1, pageSize: 20 }, NOW);
    expect(result.orders[0]).toMatchObject({ status: 'paid', totalMinor: 0, dueMinor: 0 });
  });

  it('derives the same status for a refunded order, using paid minus refunded', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, order(FUTURE), NOW);
    await appendEntry(userId, created.id, pay(100000), NOW);
    await appendEntry(userId, created.id, { kind: 'refund' as const, amountMinor: 30000, occurredAt: NOW }, NOW);

    const balance = { paidMinor: 100000, refundedMinor: 30000, netPaidMinor: 70000 };
    const expected = deriveStatus({ totalMinor: 100000, dueDate: FUTURE }, balance, NOW);
    expect(expected).toBe('partially_paid');

    const result = await listOrders(userId, { page: 1, pageSize: 20 }, NOW);
    expect(result.orders[0]).toMatchObject({
      status: expected, paidMinor: 100000, refundedMinor: 30000, netPaidMinor: 70000, dueMinor: 30000,
    });
  });
});

describe('dashboardSummary', () => {
  it('returns figures consistent with the underlying rows', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW);              // pending
    await createOrder(userId, order(PAST), NOW);                // overdue
    const partiallyPaid = await createOrder(userId, order(FUTURE), NOW);
    await appendEntry(userId, partiallyPaid.id, pay(40000), NOW); // partially_paid
    const paidOrder = await createOrder(userId, order(FUTURE), NOW);
    await appendEntry(userId, paidOrder.id, pay(100000), NOW);    // paid

    const summary = await dashboardSummary(userId, NOW);
    const { orders: rows } = await listOrders(userId, { page: 1, pageSize: 100 }, NOW);

    const nonPaidRows = rows.filter((r) => r.status !== 'paid');
    const expectedOutstanding = nonPaidRows.reduce((sum, r) => sum + r.dueMinor, 0);
    const expectedOverdue = rows.filter((r) => r.status === 'overdue')
      .reduce((sum, r) => sum + r.dueMinor, 0);

    expect(summary.totalCount).toBe(4);
    expect(summary.openCount).toBe(nonPaidRows.length);
    expect(summary.outstandingMinor).toBe(expectedOutstanding);
    expect(summary.overdueMinor).toBe(expectedOverdue);
  });

  it('returns zeroed figures, not a crash, when there are no orders', async () => {
    const userId = new ObjectId();
    const summary = await dashboardSummary(userId, NOW);
    expect(summary).toEqual({ outstandingMinor: 0, overdueMinor: 0, openCount: 0, totalCount: 0 });
  });
});

describe('empty results', () => {
  it('returns total 0, not undefined, when nothing matches', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(FUTURE), NOW); // pending, won't match 'paid'
    const result = await listOrders(userId, { status: 'paid', page: 1, pageSize: 20 }, NOW);
    expect(result.total).toBe(0);
    expect(result.orders).toEqual([]);
  });

  it('returns total 0 for a user with no orders at all', async () => {
    const userId = new ObjectId();
    const result = await listOrders(userId, { page: 1, pageSize: 20 }, NOW);
    expect(result.total).toBe(0);
    expect(result.orders).toEqual([]);
  });
});
