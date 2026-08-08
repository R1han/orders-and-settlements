import Link from 'next/link';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatMoney, relativeDue } from '@/lib/format';
import type { OrderView } from '@/server/orders';

const TH = 'h-8 px-3.5 text-label uppercase text-fg-subtle whitespace-nowrap';
const TD = 'px-3.5 text-table text-[#3d4a47] border-b border-[#eef0ef] whitespace-nowrap';

export function OrdersTable({ orders, now }: { orders: OrderView[]; now: Date }) {
  return (
    <>
      {/* Desktop: the full table from the mockup. */}
      <table className="hidden w-full min-w-[1010px] table-fixed border-collapse md:table">
        <thead>
          <tr className="border-b border-border bg-[#fafbfa]">
            <th className={`${TH} w-24 text-left`}>Order</th>
            <th className={`${TH} text-left`}>Customer</th>
            <th className={`${TH} w-[134px] text-left`}>Status</th>
            <th className={`${TH} w-[142px] text-right`}>Order total</th>
            <th className={`${TH} w-[142px] text-right`}>Amount paid</th>
            <th className={`${TH} w-[146px] text-right font-semibold text-[#4a5552]`}>Amount due</th>
            <th className={`${TH} w-[152px] text-right`}>Due date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const caption = relativeDue(order.dueDate, order.status, now);
            return (
              <tr key={order.id} className="h-row-lg hover:bg-[#fafbfa]">
                <td className={`${TD} font-mono text-xs text-fg-subtle`}>
                  <Link href={`/orders/${order.id}`}>{order.ref}</Link>
                </td>
                <td className={`${TD} max-w-0 overflow-hidden text-ellipsis font-medium text-fg`}>
                  <Link href={`/orders/${order.id}`}>{order.customer}</Link>
                </td>
                <td className={TD}><StatusBadge status={order.status} /></td>
                <td className={`${TD} text-right tabular-nums text-fg-muted`}>{formatMoney(order.totalMinor)}</td>
                <td className={`${TD} text-right tabular-nums text-fg-muted`}>{formatMoney(order.netPaidMinor)}</td>
                <td className={`${TD} text-right font-semibold tabular-nums text-fg`}>{formatMoney(order.dueMinor)}</td>
                <td className={`${TD} py-1 text-right leading-[1.25] text-fg-muted`}>
                  <span>{formatDate(order.dueDate)}</span>
                  <span className={`-mt-px block text-[11.5px] ${
                    order.status === 'overdue' ? 'text-status-overdue-fg' : 'text-[#9aa3a0]'}`}>{caption}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Below 768px: two-line cards. Total and paid drop; they live on the detail screen. */}
      <ul className="md:hidden">
        {orders.map((order) => (
          <li key={order.id} className="border-b border-[#eef0ef] last:border-0">
            <Link href={`/orders/${order.id}`} className="flex flex-col gap-1 p-3.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{order.customer}</span>
                <StatusBadge status={order.status} />
                <span className="font-semibold tabular-nums text-fg">{formatMoney(order.dueMinor)}</span>
              </div>
              <div className="flex gap-2 text-[11.5px] text-fg-subtle">
                <span className="font-mono">{order.ref}</span>
                <span>·</span>
                <span>{formatDate(order.dueDate)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
