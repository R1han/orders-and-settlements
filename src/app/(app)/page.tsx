import Link from 'next/link';
import { dashboardSummary, listOrders } from '@/server/dashboard';
import { ensureIndexes } from '@/server/db';
import { requireUserId } from '@/server/session';
import { formatMoney } from '@/lib/format';
import type { OrderStatus } from '@/domain/types';
import { OrdersTable } from './orders-table';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
];

const PAGE_SIZE = 20;

export default async function Dashboard({
  searchParams,
}: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await ensureIndexes();
  const userId = await requireUserId();
  const { status = '', page = '1' } = await searchParams;
  const now = new Date();

  const active = FILTERS.some((f) => f.value && f.value === status) ? (status as OrderStatus) : undefined;
  const pageNumber = Math.max(1, Number(page) || 1);

  const [result, summary] = await Promise.all([
    listOrders(userId, { status: active, page: pageNumber, pageSize: PAGE_SIZE }, now),
    dashboardSummary(userId, now),
  ]);

  const href = (next: Record<string, string>) => {
    const query = new URLSearchParams({ ...(status ? { status } : {}), ...next });
    return query.toString() ? `/?${query}` : '/';
  };

  const seg = (on: boolean) =>
    `h-[26px] rounded px-2.5 text-[12.5px] ${on ? 'bg-surface font-semibold text-fg shadow-[0_1px_2px_rgba(13,39,36,0.10)]' : 'text-fg-muted'}`;

  const first = (pageNumber - 1) * PAGE_SIZE + 1;
  const last = Math.min(pageNumber * PAGE_SIZE, result.total);

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-10 pt-[26px]">
      <div className="mb-5 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-title">Orders</h1>
          <p className="mt-[3px] text-[13px] text-fg-muted">
            {summary.totalCount === 0
              ? 'Nothing to settle yet'
              : `Tracking ${formatMoney(summary.outstandingMinor)} across ${summary.openCount} open orders`}
          </p>
        </div>
        <Link href="/orders/new"
              className="flex h-8 items-center gap-1.5 rounded bg-brand px-[13px] text-[13px] font-medium text-white">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New order
        </Link>
      </div>

      {summary.totalCount > 0 && (
        <div className="flex items-center gap-[22px] overflow-x-auto whitespace-nowrap rounded-t-lg border border-b-0 border-border bg-surface px-3.5 py-[9px] text-[12.5px]">
          <span className="text-fg-muted">
            Outstanding <b className="ml-1.5 font-semibold tabular-nums text-fg">{formatMoney(summary.outstandingMinor)}</b>
          </span>
          <span className="h-[13px] w-px bg-border" />
          <span className="text-fg-muted">
            Overdue <b className="ml-1.5 font-semibold tabular-nums text-status-overdue-fg">{formatMoney(summary.overdueMinor)}</b>
          </span>
          <span className="h-[13px] w-px bg-border" />
          <span className="text-fg-muted">
            Open orders <b className="ml-1.5 font-semibold tabular-nums text-fg">{summary.openCount}</b>
          </span>
        </div>
      )}

      <div className={`flex items-center gap-3 border border-border bg-surface px-3 py-[9px] ${
        summary.totalCount > 0 ? 'border-t-[#eef0ef]' : 'rounded-t-lg'}`}>
        <div className="flex gap-0.5 rounded bg-[#f2f4f3] p-0.5">
          {FILTERS.map((filter) => (
            <Link key={filter.label} href={filter.value ? `/?status=${filter.value}` : '/'}
                  className={`flex items-center ${seg(status === filter.value)}`}>
              {filter.label}
            </Link>
          ))}
        </div>
        <a href={`/api/orders/export${status ? `?status=${status}` : ''}`} download
           className="flex h-7 items-center gap-1.5 rounded border border-border-strong bg-surface px-2.5 text-[12.5px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
          </svg>
          Export CSV
        </a>
        <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-fg-subtle">
          {result.total ? `${first}–${last} of ${result.total}` : '0 results'}
        </span>
        <div className="flex flex-none gap-1.5">
          <Link href={href({ page: String(pageNumber - 1) })} aria-disabled={pageNumber === 1}
                className={`flex h-7 items-center rounded border px-2.5 text-[12.5px] ${
                  pageNumber === 1 ? 'pointer-events-none border-[#eaedec] text-[#b4bbb9]' : 'border-border-strong bg-surface'}`}>
            Previous
          </Link>
          <Link href={href({ page: String(pageNumber + 1) })} aria-disabled={last >= result.total}
                className={`flex h-7 items-center rounded border px-2.5 text-[12.5px] ${
                  last >= result.total ? 'pointer-events-none border-[#eaedec] text-[#b4bbb9]' : 'border-border-strong bg-surface'}`}>
            Next
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-b-lg border border-t-0 border-border bg-surface">
        {result.orders.length > 0 && <OrdersTable orders={result.orders} now={now} />}

        {summary.totalCount === 0 && (
          <div className="px-6 py-16 text-center">
            <h2 className="text-[15px] font-semibold">No orders yet</h2>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-[1.5] text-fg-muted">
              Create your first order to start tracking what customers owe you. Orders can be paid in
              full or in instalments.
            </p>
            <Link href="/orders/new"
                  className="mt-[18px] inline-flex h-8 items-center rounded bg-brand px-[13px] text-[13px] font-medium text-white">
              Create order
            </Link>
          </div>
        )}

        {summary.totalCount > 0 && result.orders.length === 0 && (
          <div className="px-6 py-13 text-center">
            <h2 className="text-sm font-semibold text-[#4a5552]">
              No orders are {(FILTERS.find((f) => f.value === status)?.label ?? '').toLowerCase()}
            </h2>
            <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] leading-[1.5] text-fg-muted">
              You have {summary.totalCount} orders, but none of them are in this state right now.
            </p>
            <Link href="/" className="mt-4 inline-flex h-[30px] items-center rounded border border-border-strong bg-surface px-3 text-[12.5px]">
              Clear filter
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
