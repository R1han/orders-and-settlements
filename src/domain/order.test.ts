import { describe, it, expect } from 'vitest';
import { computeTotals } from './order';
import { ValidationError } from './errors';

describe('computeTotals', () => {
  it('computes the brief sample scenario exactly', () => {
    const totals = computeTotals([{ description: 'Consulting', quantity: 2, unitPriceMinor: 50000 }]);
    expect(totals.subtotalMinor).toBe(100000); // $1,000.00
    expect(totals.totalMinor).toBe(100000);
    expect(totals.lines[0].lineTotalMinor).toBe(100000);
  });

  it('sums multiple lines', () => {
    const totals = computeTotals([
      { description: 'A', quantity: 3, unitPriceMinor: 1999 },
      { description: 'B', quantity: 1, unitPriceMinor: 5 },
    ]);
    expect(totals.subtotalMinor).toBe(5997 + 5);
  });

  it('treats total as equal to subtotal (no order-level tax or discount)', () => {
    const totals = computeTotals([{ description: 'A', quantity: 1, unitPriceMinor: 1234 }]);
    expect(totals.totalMinor).toBe(totals.subtotalMinor);
  });

  it('allows a zero-priced line', () => {
    expect(computeTotals([{ description: 'Free', quantity: 1, unitPriceMinor: 0 }]).totalMinor).toBe(0);
  });

  it('rejects an empty order', () => {
    expect(() => computeTotals([])).toThrow(ValidationError);
  });

  it('rejects quantity below one or non-integer', () => {
    expect(() => computeTotals([{ description: 'A', quantity: 0, unitPriceMinor: 1 }])).toThrow(ValidationError);
    expect(() => computeTotals([{ description: 'A', quantity: 1.5, unitPriceMinor: 1 }])).toThrow(ValidationError);
  });

  it('rejects negative or non-integer unit price', () => {
    expect(() => computeTotals([{ description: 'A', quantity: 1, unitPriceMinor: -1 }])).toThrow(ValidationError);
    expect(() => computeTotals([{ description: 'A', quantity: 1, unitPriceMinor: 1.5 }])).toThrow(ValidationError);
  });

  it('rejects a blank description', () => {
    expect(() => computeTotals([{ description: '   ', quantity: 1, unitPriceMinor: 1 }])).toThrow(ValidationError);
  });

  it('rejects totals beyond safe integer range', () => {
    expect(() => computeTotals([
      { description: 'A', quantity: 1_000_000, unitPriceMinor: 1_000_000_000_000 },
    ])).toThrow(ValidationError);
  });
});
