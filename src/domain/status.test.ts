import { describe, it, expect } from 'vitest';
import { deriveStatus, dueMinor, endOfDayUtc } from './status';
import { ZERO_BALANCE } from './types';

const balance = (paidMinor: number, refundedMinor = 0) => ({
  paidMinor, refundedMinor, netPaidMinor: paidMinor - refundedMinor,
});

const DUE = new Date('2026-01-10T00:00:00Z');
const BEFORE = new Date('2026-01-05T12:00:00Z');
const AFTER = new Date('2026-01-12T00:00:00Z');
const order = { totalMinor: 100000, dueDate: DUE };

describe('deriveStatus', () => {
  it('is pending with no payments before the due date', () => {
    expect(deriveStatus(order, ZERO_BALANCE, BEFORE)).toBe('pending');
  });

  it('is partially_paid with some payment before the due date', () => {
    expect(deriveStatus(order, balance(40000), BEFORE)).toBe('partially_paid');
  });

  it('is paid when payments equal the total', () => {
    expect(deriveStatus(order, balance(100000), BEFORE)).toBe('paid');
  });

  it('is overdue when unpaid past the due date', () => {
    expect(deriveStatus(order, ZERO_BALANCE, AFTER)).toBe('overdue');
    expect(deriveStatus(order, balance(40000), AFTER)).toBe('overdue');
  });

  it('resolves to paid when it was overdue but is now fully paid', () => {
    // The brief asks for this case by name: terminal states beat time-based ones.
    expect(deriveStatus(order, balance(100000), AFTER)).toBe('paid');
  });

  it('walks back from paid when refunded', () => {
    expect(deriveStatus(order, balance(100000, 40000), BEFORE)).toBe('partially_paid');
    expect(deriveStatus(order, balance(100000, 40000), AFTER)).toBe('overdue');
    expect(deriveStatus(order, balance(100000, 100000), BEFORE)).toBe('pending');
  });

  it('treats the due date as inclusive through end of day UTC', () => {
    expect(deriveStatus(order, ZERO_BALANCE, new Date('2026-01-10T23:59:59.999Z'))).toBe('pending');
    expect(deriveStatus(order, ZERO_BALANCE, new Date('2026-01-11T00:00:00.000Z'))).toBe('overdue');
  });

  it('treats a zero-total order as paid', () => {
    expect(deriveStatus({ totalMinor: 0, dueDate: DUE }, ZERO_BALANCE, AFTER)).toBe('paid');
  });

  it('rejects an invalid due date rather than silently never being overdue', () => {
    // NaN comparisons are always false, so without this guard the order would sit
    // outside the overdue bucket indefinitely instead of surfacing the bad data.
    expect(() => deriveStatus({ totalMinor: 100000, dueDate: new Date('nonsense') }, ZERO_BALANCE, AFTER))
      .toThrow(RangeError);
  });
});

describe('dueMinor', () => {
  it('is the outstanding amount', () => {
    expect(dueMinor(100000, balance(40000))).toBe(60000);
    expect(dueMinor(100000, ZERO_BALANCE)).toBe(100000);
  });

  it('clamps at zero rather than reporting a negative amount due', () => {
    // Unclamped this is -20000. Over-payment is guarded elsewhere, so this state
    // should not arise — the clamp exists so a corrupt balance renders as 0 due
    // rather than as a negative amount owed.
    expect(dueMinor(100000, balance(120000))).toBe(0);
    expect(dueMinor(100000, balance(100000))).toBe(0);
  });
});

describe('endOfDayUtc', () => {
  it('moves to the last millisecond of the UTC day', () => {
    expect(endOfDayUtc(new Date('2026-01-10T08:30:00Z')).toISOString()).toBe('2026-01-10T23:59:59.999Z');
  });
});
