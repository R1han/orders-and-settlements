import type { OrderStatus } from '@/domain/types';

const STATUS: Record<OrderStatus, { label: string; pill: string; dot: string }> = {
  pending: { label: 'Pending', pill: 'bg-status-pending-bg text-status-pending-fg', dot: 'bg-status-pending-dot' },
  partially_paid: { label: 'Partially paid', pill: 'bg-status-partial-bg text-status-partial-fg', dot: 'bg-status-partial-dot' },
  paid: { label: 'Paid', pill: 'bg-status-paid-bg text-status-paid-fg', dot: 'bg-status-paid-dot' },
  overdue: { label: 'Overdue', pill: 'bg-status-overdue-bg text-status-overdue-fg', dot: 'bg-status-overdue-dot' },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const style = STATUS[status];
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded px-2 text-[11.5px] font-medium ${style.pill}`}>
      <span className={`h-[5px] w-[5px] flex-none rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
