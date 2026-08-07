import { describe, it, expect } from 'vitest';
import { validateAndProject, maxAllowedMinor } from './ledger';
import { ZERO_BALANCE } from './types';
import { OverpaymentError, ExcessRefundError, ValidationError } from './errors';

const NOW = new Date('2026-01-05T12:00:00Z');
const order = { totalMinor: 100000, dueDate: new Date('2026-01-10T00:00:00Z') };
const balance = (paidMinor: number, refundedMinor = 0) => ({
  paidMinor, refundedMinor, netPaidMinor: paidMinor - refundedMinor,
});
const pay = (amountMinor: number) => ({ kind: 'payment' as const, amountMinor, occurredAt: NOW });
const refund = (amountMinor: number) => ({ kind: 'refund' as const, amountMinor, occurredAt: NOW });

describe('validateAndProject — payments', () => {
  it('projects the balance and both statuses', () => {
    const entry = validateAndProject(order, ZERO_BALANCE, pay(40000), NOW);
    expect(entry.balanceAfter).toEqual({ paidMinor: 40000, refundedMinor: 0, netPaidMinor: 40000 });
    expect(entry.statusBefore).toBe('pending');
    expect(entry.statusAfter).toBe('partially_paid');
  });

  it('accepts an exact payoff', () => {
    const entry = validateAndProject(order, balance(40000), pay(60000), NOW);
    expect(entry.balanceAfter.netPaidMinor).toBe(100000);
    expect(entry.statusAfter).toBe('paid');
  });

  it('rejects one minor unit over', () => {
    expect(() => validateAndProject(order, balance(100000), pay(1), NOW)).toThrow(OverpaymentError);
  });

  it('carries maxAllowedMinor in the error details', () => {
    try {
      validateAndProject(order, balance(60000), pay(50000), NOW);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OverpaymentError);
      expect((error as OverpaymentError).details).toMatchObject({
        orderTotalMinor: 100000, paidMinor: 60000, refundedMinor: 0,
        netPaidMinor: 60000, maxAllowedMinor: 40000,
      });
    }
  });

  it('lets a refund re-open room for payment', () => {
    // Paid in full then refunded 400: 600 net paid, so 400 may be paid again.
    expect(maxAllowedMinor(order, balance(100000, 40000), 'payment')).toBe(40000);
    expect(() => validateAndProject(order, balance(100000, 40000), pay(40000), NOW)).not.toThrow();
    expect(() => validateAndProject(order, balance(100000, 40000), pay(40001), NOW)).toThrow(OverpaymentError);
  });
});

describe('validateAndProject — refunds', () => {
  it('projects a refund and walks status back', () => {
    const entry = validateAndProject(order, balance(100000), refund(40000), NOW);
    expect(entry.balanceAfter).toEqual({ paidMinor: 100000, refundedMinor: 40000, netPaidMinor: 60000 });
    expect(entry.statusBefore).toBe('paid');
    expect(entry.statusAfter).toBe('partially_paid');
  });

  it('accepts a full refund', () => {
    expect(validateAndProject(order, balance(100000), refund(100000), NOW).statusAfter).toBe('pending');
  });

  it('rejects refunding more than was received', () => {
    expect(() => validateAndProject(order, balance(40000), refund(40001), NOW)).toThrow(ExcessRefundError);
    expect(() => validateAndProject(order, ZERO_BALANCE, refund(1), NOW)).toThrow(ExcessRefundError);
  });

  it('reports the refund ceiling as the amount actually paid', () => {
    expect(maxAllowedMinor(order, balance(100000, 30000), 'refund')).toBe(70000);
  });
});

describe('validateAndProject — input validation', () => {
  it('rejects zero, negative, and non-integer amounts', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() => validateAndProject(order, ZERO_BALANCE, pay(bad), NOW), String(bad)).toThrow(ValidationError);
    }
  });

  it('normalises an absent note and idempotency key to null', () => {
    const entry = validateAndProject(order, ZERO_BALANCE, pay(100), NOW);
    expect(entry.note).toBeNull();
    expect(entry.idempotencyKey).toBeNull();
  });

  it('trims a supplied note', () => {
    const entry = validateAndProject(order, ZERO_BALANCE, { ...pay(100), note: '  wire  ' }, NOW);
    expect(entry.note).toBe('wire');
  });

  it('rejects an unrecognised settlement kind rather than silently moving nothing', () => {
    // LedgerKind is erased at runtime and this arrives from a parsed request body.
    // Without the guard, an unknown kind passes the ceiling check as if it were a
    // refund, then matches neither balance update — returning success having moved
    // no money at all.
    for (const kind of ['bogus', 'PAYMENT', '', 'payments']) {
      expect(() => validateAndProject(order, balance(50000), { kind: kind as never, amountMinor: 10000, occurredAt: NOW }, NOW),
        kind).toThrow(ValidationError);
    }
  });

  it('rejects a bad kind before validating the amount', () => {
    // Both are wrong here; the kind error is the more fundamental one to report.
    expect(() => validateAndProject(order, ZERO_BALANCE, { kind: 'bogus' as never, amountMinor: 0, occurredAt: NOW }, NOW))
      .toThrow(/kind/i);
  });
});

describe('validateAndProject — immutability', () => {
  it('does not mutate the balance object', () => {
    const initialBalance = balance(50000, 10000);
    const balanceBefore = JSON.stringify(initialBalance);
    validateAndProject(order, initialBalance, pay(30000), NOW);
    const balanceAfter = JSON.stringify(initialBalance);
    expect(balanceAfter).toBe(balanceBefore);
  });
});
