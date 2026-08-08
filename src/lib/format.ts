import { formatMinor } from '@/domain/money';
import { endOfDayUtc } from '@/domain/status';
import type { OrderStatus } from '@/domain/types';

/** Display only. The domain never sees a formatted string. */
export function formatMoney(minor: number): string {
  const [whole, fraction] = formatMinor(minor).split('.');
  return `AED ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * The mockup's second line under every due date. Computed from the same end-of-day
 * UTC boundary the status rules use, so "0 days overdue" can never appear beside an
 * order the domain still calls pending.
 */
export function relativeDue(dueDate: string | Date, status: OrderStatus, now: Date): string {
  if (status === 'paid') return '';
  const boundary = endOfDayUtc(new Date(dueDate));
  // Floor, not ceil: `boundary` sits at the last millisecond of the due date (23:59:59.999),
  // so for any `now` earlier that same day the gap to `boundary` is just under a whole
  // number of days. Ceiling that gap overcounts by one day almost everywhere; flooring it
  // lands on the calendar-day difference, and it still flips to the overdue branch on the
  // exact millisecond `now` passes `boundary` — the same instant the status rules do.
  const days = Math.floor((boundary.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}
