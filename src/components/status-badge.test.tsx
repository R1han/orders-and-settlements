// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { OrderStatus } from '@/domain/types';
import { StatusBadge } from './status-badge';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders a distinct label for every OrderStatus value', () => {
    const cases: Record<OrderStatus, string> = {
      pending: 'Pending',
      partially_paid: 'Partially paid',
      paid: 'Paid',
      overdue: 'Overdue',
    };
    for (const [status, label] of Object.entries(cases) as [OrderStatus, string][]) {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      cleanup();
    }
  });

  // The mockup names this status token `partial`; the domain calls it `partially_paid`.
  // A key mismatch between STATUS's `partially_paid` entry and that token would silently
  // render an undefined pill/dot class (or nothing) rather than throwing, so pin it directly.
  it('renders "Partially paid" with the partial-status classes for partially_paid', () => {
    render(<StatusBadge status="partially_paid" />);
    const label = screen.getByText('Partially paid');
    const pill = label.closest('span');
    expect(pill?.className).toContain('bg-status-partial-bg');
    expect(pill?.className).toContain('text-status-partial-fg');
    const dot = pill?.querySelector('span');
    expect(dot?.className).toContain('bg-status-partial-dot');
  });

  it('gives every status a distinct pill class and dot class', () => {
    const statuses: OrderStatus[] = ['pending', 'partially_paid', 'paid', 'overdue'];
    const pillClasses = new Set<string>();
    const dotClasses = new Set<string>();
    for (const status of statuses) {
      render(<StatusBadge status={status} />);
      const pill = screen.getByText(
        { pending: 'Pending', partially_paid: 'Partially paid', paid: 'Paid', overdue: 'Overdue' }[status],
      ).closest('span');
      pillClasses.add(pill!.className);
      dotClasses.add(pill!.querySelector('span')!.className);
      cleanup();
    }
    expect(pillClasses.size).toBe(4);
    expect(dotClasses.size).toBe(4);
  });
});
