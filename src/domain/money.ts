import { ValidationError } from './errors';
import type { Minor } from './types';

/** Non-negative decimal with at most two fractional digits. No signs, no exponents, no separators. */
const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

export function parseMinor(input: string): Minor {
  const match = DECIMAL.exec(String(input).trim());
  if (!match) {
    throw new ValidationError(
      'Enter an amount as a positive number with at most two decimal places, for example 1000.00.',
      { received: input },
    );
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor)) {
    throw new ValidationError('That amount is too large to record.', { received: input });
  }
  return minor;
}

export function formatMinor(minor: Minor): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
