import { describe, it, expect } from 'vitest';
import { parseMinor, formatMinor } from './money';
import { ValidationError } from './errors';

describe('parseMinor', () => {
  it('parses whole units', () => {
    expect(parseMinor('1000')).toBe(100000);
  });

  it('parses two decimal places', () => {
    expect(parseMinor('1000.00')).toBe(100000);
    expect(parseMinor('0.01')).toBe(1);
    expect(parseMinor('12.34')).toBe(1234);
  });

  it('pads a single decimal place', () => {
    expect(parseMinor('0.1')).toBe(10);
  });

  it('does not lose precision where floats would', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; integers make this exact.
    expect(parseMinor('0.1') + parseMinor('0.2')).toBe(parseMinor('0.3'));
  });

  it('rejects more than two decimal places', () => {
    expect(() => parseMinor('1.005')).toThrow(ValidationError);
  });

  it('rejects non-numeric, empty, and negative input', () => {
    for (const bad of ['', 'abc', '1.2.3', '-5.00', '1e3', ' ']) {
      expect(() => parseMinor(bad), bad).toThrow(ValidationError);
    }
  });

  it('rejects values beyond safe integer range', () => {
    expect(() => parseMinor('99999999999999999')).toThrow(ValidationError);
  });

  it('rejects thousands separators', () => {
    expect(() => parseMinor('1,000.00')).toThrow(ValidationError);
  });

  it('trims surrounding whitespace', () => {
    expect(parseMinor('  12.34  ')).toBe(1234);
  });
});

describe('formatMinor', () => {
  it('always renders two decimal places', () => {
    expect(formatMinor(100000)).toBe('1000.00');
    expect(formatMinor(1)).toBe('0.01');
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(1234)).toBe('12.34');
  });

  it('round-trips with parseMinor', () => {
    for (const s of ['0.00', '0.01', '12.34', '1000.00', '999999.99']) {
      expect(formatMinor(parseMinor(s))).toBe(s);
    }
  });

  it('formats negative values by magnitude, not by flooring the signed value', () => {
    // Math.floor(-1234 / 100) is -13, not -12 — the sign must be split off first.
    // Refund arithmetic produces negative intermediates, so this branch is reachable.
    expect(formatMinor(-1234)).toBe('-12.34');
    expect(formatMinor(-100000)).toBe('-1000.00');
    expect(formatMinor(-1)).toBe('-0.01');
  });
});
