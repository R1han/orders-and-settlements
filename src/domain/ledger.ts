import { ExcessRefundError, OverpaymentError, ValidationError } from './errors';
import { deriveStatus, netPaid } from './status';
import type { Balance, LedgerKind, Minor, OrderStatus } from './types';

export interface AppendInput {
  kind: LedgerKind;
  amountMinor: Minor;
  occurredAt: Date;
  note?: string;
  idempotencyKey?: string;
}

export interface ProjectedEntry {
  kind: LedgerKind;
  amountMinor: Minor;
  occurredAt: Date;
  note: string | null;
  idempotencyKey: string | null;
  balanceAfter: Balance;
  statusBefore: OrderStatus;
  statusAfter: OrderStatus;
}

/**
 * The single hint field on a rejection: "how much can I submit right now?".
 * For a payment that is the room left against the total; for a refund it is the
 * money actually received. One question, one answer, both directions.
 *
 * Precondition: kind must be validated by validateAndProject; the ternary below
 * assumes exactly 'payment' or 'refund'.
 */
export function maxAllowedMinor(order: { totalMinor: Minor }, balance: Balance, kind: LedgerKind): Minor {
  return kind === 'payment'
    ? order.totalMinor - netPaid(balance)
    : balance.paidMinor - balance.refundedMinor;
}

export function validateAndProject(
  order: { totalMinor: Minor; dueDate: Date },
  balance: Balance,
  input: AppendInput,
  now: Date,
): ProjectedEntry {
  if (input.kind !== 'payment' && input.kind !== 'refund') {
    throw new ValidationError('Settlement kind must be either a payment or a refund.', { field: 'kind' });
  }

  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 1) {
    throw new ValidationError('Amount must be at least 0.01.', { field: 'amount' });
  }

  const ceiling = maxAllowedMinor(order, balance, input.kind);
  const details = {
    orderTotalMinor: order.totalMinor,
    paidMinor: balance.paidMinor,
    refundedMinor: balance.refundedMinor,
    netPaidMinor: balance.netPaidMinor,
    maxAllowedMinor: ceiling,
  };

  if (input.amountMinor > ceiling) {
    throw input.kind === 'payment' ? new OverpaymentError(details) : new ExcessRefundError(details);
  }

  const paidMinor = balance.paidMinor + (input.kind === 'payment' ? input.amountMinor : 0);
  const refundedMinor = balance.refundedMinor + (input.kind === 'refund' ? input.amountMinor : 0);
  const balanceAfter: Balance = { paidMinor, refundedMinor, netPaidMinor: paidMinor - refundedMinor };

  return {
    kind: input.kind,
    amountMinor: input.amountMinor,
    occurredAt: input.occurredAt,
    note: input.note?.trim() || null,
    idempotencyKey: input.idempotencyKey?.trim() || null,
    balanceAfter,
    statusBefore: deriveStatus(order, balance, now),
    statusAfter: deriveStatus(order, balanceAfter, now),
  };
}
