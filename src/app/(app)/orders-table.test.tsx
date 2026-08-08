// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { OrderView } from '@/server/orders';
import { OrdersTable } from './orders-table';

afterEach(cleanup);

function order(overrides: Partial<OrderView>): OrderView {
  return {
    id: '1',
    ref: 'ORD-1001',
    customer: 'Acme Co',
    dueDate: '2026-08-14T00:00:00.000Z',
    lines: [],
    subtotalMinor: 100000,
    totalMinor: 100000,
    paidMinor: 0,
    refundedMinor: 0,
    netPaidMinor: 0,
    dueMinor: 100000,
    status: 'pending',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('OrdersTable', () => {
  // relativeDue(order.dueDate, order.status, now) returns '' for a paid order.
  // If the table ever stopped passing the row's own status through — say, passed
  // a hardcoded 'pending' — a paid row overdue by the calendar would wrongly grow
  // a caption. Pin the wiring, not just the pure function.
  it('renders no relative-due caption for a paid row, even if its due date is in the past', () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    render(<OrdersTable orders={[order({ status: 'paid', dueDate: '2026-08-01T00:00:00.000Z' })]} now={now} />);
    // Scoped to the desktop table: the date cell there is <span>date</span><span>caption</span>,
    // and the caption must be empty for a paid row.
    const table = within(document.querySelector('table')!);
    const dateCell = table.getByText('Aug 1, 2026').closest('td');
    const captionSpan = dateCell?.querySelectorAll('span')[1];
    expect(captionSpan?.textContent ?? '').toBe('');
  });

  it('renders a red overdue caption for an overdue row', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    render(<OrdersTable orders={[order({ status: 'overdue', dueDate: '2026-08-14T00:00:00.000Z' })]} now={now} />);
    const table = within(document.querySelector('table')!);
    const caption = table.getByText('6 days overdue');
    expect(caption.className).toContain('text-status-overdue-fg');
  });

  it('renders both the desktop table and the mobile card list for the same rows', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    render(<OrdersTable orders={[order({ customer: 'Acme Co' })]} now={now} />);
    // Two renderings of the same order coexist in the DOM; CSS (md:table / md:hidden)
    // decides which is visible at a given viewport, so both must be queryable here.
    expect(document.querySelector('table')).toBeTruthy();
    expect(document.querySelector('ul')).toBeTruthy();
    expect(screen.getAllByText('Acme Co').length).toBe(2);
  });

  it('omits order total and amount paid from the mobile card', () => {
    const now = new Date('2026-08-20T00:00:00.000Z');
    render(<OrdersTable orders={[order({ totalMinor: 250000, netPaidMinor: 100000, dueMinor: 150000 })]} now={now} />);
    const list = document.querySelector('ul');
    expect(list?.textContent).toContain('AED 1,500.00'); // amount due
    expect(list?.textContent).not.toContain('AED 2,500.00'); // order total
    expect(list?.textContent).not.toContain('AED 1,000.00'); // amount paid
  });
});
