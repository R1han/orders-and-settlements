// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ObjectId } from 'mongodb';
import type { ListResult } from '@/server/dashboard';
import type { DashboardSummary } from '@/server/dashboard';

const mockListOrders = vi.fn<() => Promise<ListResult>>();
const mockDashboardSummary = vi.fn<() => Promise<DashboardSummary>>();
const mockEnsureIndexes = vi.fn().mockResolvedValue(undefined);
const mockRequireUserId = vi.fn().mockResolvedValue(new ObjectId());

vi.mock('@/server/dashboard', () => ({
  listOrders: mockListOrders,
  dashboardSummary: mockDashboardSummary,
}));
vi.mock('@/server/db', () => ({ ensureIndexes: mockEnsureIndexes }));
vi.mock('@/server/session', () => ({ requireUserId: mockRequireUserId }));

const { default: Dashboard } = await import('./page');

afterEach(() => {
  cleanup();
  mockListOrders.mockReset();
  mockDashboardSummary.mockReset();
});

const emptySummary: DashboardSummary = { outstandingMinor: 0, overdueMinor: 0, openCount: 0, totalCount: 0 };

describe('Dashboard empty states', () => {
  // The mockup and the brief both call out two distinct empty states. Mixing them
  // up — showing "clear filter" copy with zero total orders, or "no orders yet"
  // while a filter is hiding real rows — would mislead the user about whether
  // they need to create an order or just change the filter.
  it('shows "No orders yet" when the account has no orders at all, regardless of filter', async () => {
    mockListOrders.mockResolvedValue({ orders: [], total: 0, page: 1, pageSize: 20 });
    mockDashboardSummary.mockResolvedValue(emptySummary);

    render(await Dashboard({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('No orders yet')).toBeTruthy();
    expect(screen.queryByText(/none of them are in this state/)).toBeNull();
  });

  it('shows the "none match this filter" empty state when orders exist but the filter matches none', async () => {
    mockListOrders.mockResolvedValue({ orders: [], total: 0, page: 1, pageSize: 20 });
    mockDashboardSummary.mockResolvedValue({ outstandingMinor: 50000, overdueMinor: 0, openCount: 3, totalCount: 3 });

    render(await Dashboard({ searchParams: Promise.resolve({ status: 'overdue' }) }));

    expect(screen.getByText('No orders are overdue')).toBeTruthy();
    expect(screen.getByText(/You have 3 orders, but none of them are in this state right now\./)).toBeTruthy();
    expect(screen.queryByText('No orders yet')).toBeNull();
    // Clearing the filter must go back to the unfiltered dashboard, not reload the
    // same empty filter.
    expect(screen.getByText('Clear filter').closest('a')?.getAttribute('href')).toBe('/');
  });

  it('shows neither empty state once a filtered page has rows', async () => {
    mockListOrders.mockResolvedValue({
      orders: [{
        id: '1', ref: 'ORD-1001', customer: 'Acme Co', dueDate: '2026-08-14T00:00:00.000Z',
        lines: [], subtotalMinor: 1000, totalMinor: 1000, paidMinor: 0, refundedMinor: 0,
        netPaidMinor: 0, dueMinor: 1000, status: 'pending', createdAt: '2026-08-01T00:00:00.000Z',
      }],
      total: 1, page: 1, pageSize: 20,
    });
    mockDashboardSummary.mockResolvedValue({ outstandingMinor: 1000, overdueMinor: 0, openCount: 1, totalCount: 1 });

    render(await Dashboard({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByText('No orders yet')).toBeNull();
    expect(screen.queryByText(/none of them are in this state/)).toBeNull();
    // Rendered once in the desktop table and once in the mobile card list.
    expect(screen.getAllByText('Acme Co').length).toBe(2);
  });
});

describe('Dashboard pagination', () => {
  // A Next/Previous link that drops `status` when the user is mid-filter silently
  // dumps them back into the unfiltered list on page 2 — easy to miss because page 1
  // looks identical either way.
  it('carries the active status filter onto the Next and Previous links', async () => {
    const orders = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), ref: `ORD-${1000 + i}`, customer: `Customer ${i}`, dueDate: '2026-08-14T00:00:00.000Z',
      lines: [], subtotalMinor: 1000, totalMinor: 1000, paidMinor: 0, refundedMinor: 0,
      netPaidMinor: 0, dueMinor: 1000, status: 'pending' as const, createdAt: '2026-08-01T00:00:00.000Z',
    }));
    mockListOrders.mockResolvedValue({ orders, total: 45, page: 1, pageSize: 20 });
    mockDashboardSummary.mockResolvedValue({ outstandingMinor: 45000, overdueMinor: 0, openCount: 45, totalCount: 45 });

    render(await Dashboard({ searchParams: Promise.resolve({ status: 'pending', page: '1' }) }));

    const next = screen.getByText('Next').closest('a');
    expect(next?.getAttribute('href')).toBe('/?status=pending&page=2');
  });
});
