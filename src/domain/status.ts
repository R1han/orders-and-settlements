import type { Balance, Minor, OrderStatus } from './types';

/**
 * Due dates are inclusive and evaluated at end of day UTC. "Past the due date"
 * at 00:01 UTC is a different answer in Dubai, so the rule is fixed here rather
 * than left to the caller's timezone.
 */
export function endOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999,
  ));
}

export function netPaid(balance: Balance): Minor {
  return balance.paidMinor - balance.refundedMinor;
}

/** Display-only. Guards compare raw components so this clamp cannot mask a violation. */
export function dueMinor(totalMinor: Minor, balance: Balance): Minor {
  return Math.max(0, totalMinor - netPaid(balance));
}

export function deriveStatus(
  order: { totalMinor: Minor; dueDate: Date },
  balance: Balance,
  now: Date,
): OrderStatus {
  const paid = netPaid(balance);
  if (paid >= order.totalMinor) return 'paid';
  if (now > endOfDayUtc(order.dueDate)) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'pending';
}
