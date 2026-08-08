import { describe, it, expect } from 'vitest';
import { formatMoney, relativeDue } from './format';

describe('formatMoney', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatMoney(100000)).toBe('AED 1,000.00');
    expect(formatMoney(1)).toBe('AED 0.01');
    expect(formatMoney(12841000)).toBe('AED 128,410.00');
  });

  it('places the first separator exactly at the 4th whole digit, not before', () => {
    // 999.99 has a 3-digit whole part: no separator yet.
    expect(formatMoney(99999)).toBe('AED 999.99');
    // 1,000.00 is the first value whose whole part needs a separator.
    expect(formatMoney(100000)).toBe('AED 1,000.00');
  });

  it('groups a 6-digit minor amount (4-digit whole part)', () => {
    expect(formatMoney(999999)).toBe('AED 9,999.99');
  });

  it('groups a 7-digit minor amount (5-digit whole part)', () => {
    expect(formatMoney(9999999)).toBe('AED 99,999.99');
  });

  it('groups a 9-digit minor amount across two separators (7-digit whole part)', () => {
    expect(formatMoney(999999999)).toBe('AED 9,999,999.99');
  });
});

describe('relativeDue', () => {
  const due = '2026-08-14T00:00:00Z';

  it('is blank for a paid order', () => {
    expect(relativeDue(due, 'paid', new Date('2026-09-01T00:00:00Z'))).toBe('');
  });

  it('counts forward to the end-of-day boundary', () => {
    expect(relativeDue(due, 'pending', new Date('2026-08-07T00:00:00Z'))).toBe('due in 7 days');
    expect(relativeDue(due, 'pending', new Date('2026-08-13T12:00:00Z'))).toBe('due tomorrow');
    expect(relativeDue(due, 'pending', new Date('2026-08-14T12:00:00Z'))).toBe('due today');
  });

  it('agrees with the status rules on the overdue boundary', () => {
    // The order is still pending at 23:59 on the due date, so the caption must not
    // say "overdue" while the badge says "Pending".
    expect(relativeDue(due, 'pending', new Date('2026-08-14T23:59:00Z'))).toBe('due today');
    expect(relativeDue(due, 'overdue', new Date('2026-08-19T12:00:00Z'))).toBe('5 days overdue');
  });
});
