import Link from 'next/link';
import { ObjectId } from 'mongodb';
import { getOrder } from '@/server/orders';
import { listEntries } from '@/server/ledger';
import { orderTimeline } from '@/server/audit';
import { requireUserId } from '@/server/session';
import { formatDate, formatMoney, relativeDue } from '@/lib/format';
import { StatusBadge } from '@/components/status-badge';
import { SettlementActions } from './settlement-actions';

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const now = new Date();

  const order = await getOrder(userId, id, now);
  const entries = await listEntries(new ObjectId(order.id));
  const timeline = await orderTimeline(userId, new ObjectId(order.id));

  const isPaid = order.status === 'paid';
  const locked = entries.length > 0;
  const maxPaymentMinor = order.totalMinor + order.refundedMinor - order.paidMinor;
  const maxRefundMinor = order.paidMinor - order.refundedMinor;
  const caption = relativeDue(order.dueDate, order.status, now);

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-12 pt-[22px]">
      <div className="max-w-[1000px]">
        <Link href="/" className="mb-4 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Orders
        </Link>

        <div className="mb-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs text-fg-subtle">{order.ref}</span>
              <StatusBadge status={order.status} />
            </div>
            <h1 className="mt-[5px] text-[21px] font-semibold tracking-[-0.015em]">{order.customer}</h1>
            <p className="mt-[5px] text-[12.5px] text-fg-muted">
              Created {formatDate(order.createdAt)} · Due {formatDate(order.dueDate)}{' '}
              <span className={order.status === 'overdue' ? 'ml-0.5 text-status-overdue-fg' : 'ml-0.5 text-[#9aa3a0]'}>
                {caption}
              </span>
            </p>
          </div>

          <SettlementActions orderId={order.id} orderRef={order.ref} customer={order.customer}
                             maxPaymentMinor={maxPaymentMinor} maxRefundMinor={maxRefundMinor} />
        </div>

        <div className={`grid grid-cols-[1fr_1fr_1.2fr] rounded-lg border ${
          isPaid ? 'border-[#cfe6dc] bg-[#f4faf7]' : 'border-border bg-surface'}`}>
          <div className="border-r border-border px-[18px] py-3.5">
            <div className="text-label uppercase text-fg-subtle">Order total</div>
            <div className="mt-1 text-base font-medium tabular-nums">{formatMoney(order.totalMinor)}</div>
          </div>
          <div className="border-r border-border px-[18px] py-3.5">
            <div className="text-label uppercase text-fg-subtle">Amount paid</div>
            <div className="mt-1 text-base font-medium tabular-nums">
              {formatMoney(order.netPaidMinor)}
              {order.refundedMinor > 0 && (
                <span className="ml-1.5 text-[11.5px] font-normal text-fg-subtle">
                  after {formatMoney(order.refundedMinor)} refunded
                </span>
              )}
            </div>
          </div>
          <div className="px-[18px] py-3.5">
            <div className="text-label font-semibold uppercase text-[#4a5552]">{isPaid ? 'Status' : 'Amount due'}</div>
            <div className={`mt-0.5 font-semibold tabular-nums tracking-[-0.01em] ${
              isPaid ? 'text-base text-brand'
                : order.status === 'overdue' ? 'text-[22px] text-status-overdue-fg' : 'text-[22px] text-fg'}`}>
              {isPaid ? 'Paid in full' : formatMoney(order.dueMinor)}
            </div>
          </div>
        </div>

        <h2 className="mt-[26px] text-section">Line items</h2>

        {locked && (
          <div className="mt-2.5 flex items-start gap-2 rounded border border-border bg-[#f4f6f5] px-3 py-[9px] text-[12.5px] leading-[1.45] text-[#57615e]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                 className="mt-px flex-none text-fg-subtle">
              <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span>
              <b className="font-semibold text-[#3d4a47]">This order is locked.</b> Settlements have been
              recorded against it, so neither its line items nor its details can change. Over-payment is
              checked against the order total, so a total that moved afterwards would invalidate
              settlements already accepted. To correct it, create a replacement order.
            </span>
          </div>
        )}

        <div className={`mt-2.5 overflow-hidden rounded-lg border border-border ${locked ? 'bg-[#fcfdfc]' : 'bg-surface'}`}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="h-8 px-4 text-left text-label uppercase text-fg-subtle">Description</th>
                <th className="h-8 w-[70px] px-4 text-right text-label uppercase text-fg-subtle">Qty</th>
                <th className="h-8 w-[140px] px-4 text-right text-label uppercase text-fg-subtle">Unit price</th>
                <th className="h-8 w-[150px] px-4 text-right text-label uppercase text-fg-subtle">Amount</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line, index) => (
                <tr key={index} className="border-b border-[#eef0ef]">
                  <td className={`px-4 py-2.5 text-table ${locked ? 'text-[#57615e]' : 'text-fg'}`}>{line.description}</td>
                  <td className="px-4 py-2.5 text-right text-table tabular-nums text-fg-muted">{line.quantity}</td>
                  <td className="px-4 py-2.5 text-right text-table tabular-nums text-fg-muted">{formatMoney(line.unitPriceMinor)}</td>
                  <td className={`px-4 py-2.5 text-right text-table tabular-nums ${locked ? 'text-[#3d4a47]' : 'text-fg'}`}>
                    {formatMoney(line.lineTotalMinor)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="px-4 py-[9px] text-right text-[12.5px] text-fg-muted">Subtotal</td>
                <td className="px-4 py-[9px] text-right text-table tabular-nums">{formatMoney(order.subtotalMinor)}</td>
              </tr>
              <tr className="border-t border-border">
                <td colSpan={3} className="px-4 py-2.5 text-right text-table font-semibold">Total</td>
                <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums">{formatMoney(order.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="mb-2.5 mt-[26px] text-section">Settlement history</h2>

        {entries.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-5 py-[30px] text-center text-[13px] text-fg-muted">
            No settlements recorded yet. This order stays editable until the first one lands.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {entries.map((entry, index) => {
              const refund = entry.kind === 'refund';
              return (
                <div key={entry._id.toHexString()}
                     className={`flex items-center gap-[11px] px-4 py-[11px] ${index === 0 ? '' : 'border-t border-[#eef0ef]'}`}>
                  <span className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full ${
                    refund ? 'bg-status-overdue-bg' : 'bg-[#eaf2ee]'}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.2"
                         stroke={refund ? '#a4342a' : '#0f6b52'}>
                      <path d={refund ? 'M5 12h14' : 'M20 6L9 17l-5-5'} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-table font-medium tabular-nums">
                      {refund ? '−' : ''}{formatMoney(entry.amountMinor)}
                      <span className="ml-2 text-[11.5px] font-normal text-fg-subtle">
                        {entry.statusBefore} → {entry.statusAfter}
                      </span>
                    </div>
                    <div className="mt-px text-xs text-fg-muted">
                      {formatDate(entry.occurredAt)} · {entry.note ?? 'No note'}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-label text-fg-subtle">Balance after</div>
                    <div className="mt-px text-[12.5px] tabular-nums text-[#3d4a47]">
                      {formatMoney(order.totalMinor - entry.balanceAfter.netPaidMinor)} due
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <h2 className="mb-2.5 mt-[26px] text-section">Audit trail</h2>
        {timeline.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-5 py-[30px] text-center text-[13px] text-fg-muted">
            No activity recorded yet.
          </div>
        ) : (
          <ol className="overflow-hidden rounded-lg border border-border bg-surface">
            {timeline.map((item, index) => (
              <li key={index}
                  className={`flex items-baseline gap-3 px-4 py-2.5 text-[12.5px] ${
                    index === 0 ? '' : 'border-t border-[#eef0ef]'}`}>
                <span className="w-[110px] flex-none text-fg-subtle">{formatDate(item.at)}</span>
                <span className="min-w-0 flex-1 text-[#3d4a47]">
                  {item.summary}
                  {item.amountMinor !== null && <> {formatMoney(item.amountMinor)}</>}
                  {item.statusBefore && item.statusAfter && (
                    <span className="ml-2 text-[11.5px] font-normal text-fg-subtle">
                      {item.statusBefore} → {item.statusAfter}
                    </span>
                  )}
                  {item.errorCode && (
                    <span className="ml-2 text-[11.5px] font-normal text-fg-subtle">({item.errorCode})</span>
                  )}
                </span>
                <code className="flex-none font-mono text-[11px] text-fg-subtle">{item.kind}</code>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
