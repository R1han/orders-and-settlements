import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { setupTestDb } from './helpers';
import { createOrder, softDeleteOrder } from '@/server/orders';
import { appendEntry } from '@/server/settlements';
import { exportOrders, toCsv } from '@/server/dashboard';
import { orderTimeline } from '@/server/audit';

setupTestDb();

const NOW = new Date('2026-01-15T12:00:00Z');
const order = (dueDate: Date) => ({
  customer: 'Acme, Inc "Group"', dueDate,
  lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 100000 }],
});

describe('exportOrders', () => {
  it('filters by due-date range', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    await createOrder(userId, order(new Date('2026-02-05T00:00:00Z')));

    const rows = await exportOrders(userId, {
      from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-01-31T00:00:00Z'),
    }, NOW);
    expect(rows).toHaveLength(1);
  });

  it('is not capped by the dashboard page size', async () => {
    const userId = new ObjectId();
    for (let i = 0; i < 25; i += 1) await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    expect(await exportOrders(userId, {}, NOW)).toHaveLength(25);
  });

  it('only supplying "from" includes everything on or after it', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    await createOrder(userId, order(new Date('2026-02-05T00:00:00Z')));

    const rows = await exportOrders(userId, { from: new Date('2026-01-20T00:00:00Z') }, NOW);
    expect(rows).toHaveLength(1);
  });

  it('only supplying "to" includes everything up to and including it', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    await createOrder(userId, order(new Date('2026-02-05T00:00:00Z')));

    const rows = await exportOrders(userId, { to: new Date('2026-01-20T00:00:00Z') }, NOW);
    expect(rows).toHaveLength(1);
  });

  it('returns nothing, not a crash, when "from" is after "to"', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));

    const rows = await exportOrders(userId, {
      from: new Date('2026-02-01T00:00:00Z'), to: new Date('2026-01-01T00:00:00Z'),
    }, NOW);
    expect(rows).toEqual([]);
  });

  it('only returns the requesting user\'s orders', async () => {
    const alice = new ObjectId();
    const bob = new ObjectId();
    await createOrder(alice, order(new Date('2026-01-05T00:00:00Z')));
    await createOrder(bob, order(new Date('2026-01-05T00:00:00Z')));

    expect(await exportOrders(alice, {}, NOW)).toHaveLength(1);
  });

  it('excludes soft-deleted orders', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    await softDeleteOrder(userId, created.id);

    expect(await exportOrders(userId, {}, NOW)).toHaveLength(1);
  });
});

describe('toCsv', () => {
  it('quotes fields containing commas and doubles embedded quotes', async () => {
    const userId = new ObjectId();
    await createOrder(userId, order(new Date('2026-01-05T00:00:00Z')));
    const csv = toCsv(await exportOrders(userId, {}, NOW));
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe('ref,customer,status,dueDate,totalMinor,paidMinor,refundedMinor,netPaidMinor,dueMinor');
    expect(row).toContain('"Acme, Inc ""Group"""');
  });

  it('neutralises a customer name that looks like a spreadsheet formula', async () => {
    const userId = new ObjectId();
    await createOrder(userId, {
      customer: '=cmd|\'/C calc\'!A0, "quoted"\nsecond line',
      dueDate: new Date('2026-01-05T00:00:00Z'),
      lines: [{ description: 'Work', quantity: 1, unitPriceMinor: 100000 }],
    });
    const csv = toCsv(await exportOrders(userId, {}, NOW));

    // The cell must not begin with =, +, - or @ once opened in a spreadsheet —
    // it should be prefixed so it renders as inert text instead of executing.
    // (Checked against the raw CSV text rather than a line split: the field's
    // own embedded newline would otherwise split it across two "lines".)
    expect(csv).toContain('"\'=cmd|\'/C calc\'!A0, ""quoted""\nsecond line"');
  });

  it('renders an empty CSV body when there are no rows', () => {
    expect(toCsv([])).toBe('ref,customer,status,dueDate,totalMinor,paidMinor,refundedMinor,netPaidMinor,dueMinor\n');
  });
});

describe('orderTimeline', () => {
  it('merges ledger entries with audit records in time order', async () => {
    const userId = new ObjectId();
    const created = await createOrder(userId, order(new Date('2026-02-05T00:00:00Z')));
    await appendEntry(userId, created.id, { kind: 'payment', amountMinor: 40000, occurredAt: NOW }, NOW);
    await expect(appendEntry(userId, created.id, { kind: 'payment', amountMinor: 999999, occurredAt: NOW }, NOW))
      .rejects.toThrow();

    const timeline = await orderTimeline(userId, new ObjectId(created.id));
    const kinds = timeline.map((item) => item.kind);
    expect(kinds).toContain('order.created');
    expect(kinds).toContain('payment');
    expect(kinds).toContain('payment.rejected');

    // Chronological: creation before the payment, payment before its rejection.
    expect(kinds.indexOf('order.created')).toBeLessThan(kinds.indexOf('payment'));
    expect(kinds.indexOf('payment')).toBeLessThan(kinds.indexOf('payment.rejected'));
  });

  it('returns an empty list, not a crash, for an order with no ledger or audit activity', async () => {
    const userId = new ObjectId();
    // No createOrder call at all — orderId matches nothing in either collection.
    const timeline = await orderTimeline(userId, new ObjectId());
    expect(timeline).toEqual([]);
  });
});
