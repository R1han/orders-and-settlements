import { describe, it, expect } from 'vitest';
import { CreateOrderSchema, fieldErrors } from './schemas';

// Not in the brief. The task instructions flag two specific risks in this file:
// MoneyString swallowing a parseMinor failure into something that isn't a
// clean per-field VALIDATION_ERROR, and fieldErrors colliding an empty-path
// issue with a real field named "_". Both are plausible one-line regressions
// (e.g. dropping the try/catch, or using '' instead of '_' as the fallback key)
// that the brief's orders.test.ts would never catch, since it never calls the
// schema with bad input.

const validOrder = {
  customer: 'Acme FZ-LLC',
  dueDate: '2026-02-01',
  lines: [{ description: 'Consulting', quantity: 2, unitPrice: '500.00' }],
};

describe('CreateOrderSchema / MoneyString', () => {
  it('converts a valid decimal string to integer minor units', () => {
    const parsed = CreateOrderSchema.parse(validOrder);
    expect(parsed.lines[0].unitPrice).toBe(50000);
  });

  // Mutation: delete the try/catch in MoneyString's transform (let parseMinor's
  // ValidationError propagate raw). safeParse would then throw synchronously
  // instead of returning { success: false }, and this test's call would throw
  // an uncaught ValidationError instead of failing the assertion below.
  it('surfaces an unparseable amount as a field-scoped validation issue, not a thrown error', () => {
    const result = CreateOrderSchema.safeParse({
      ...validOrder,
      lines: [{ description: 'Consulting', quantity: 2, unitPrice: 'not-a-number' }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const errors = fieldErrors(result.error);
    expect(errors['lines.0.unitPrice']).toBeDefined();
  });
});

describe('fieldErrors', () => {
  it('renders a nested line-item path as dot-joined', () => {
    const result = CreateOrderSchema.safeParse({
      ...validOrder,
      lines: [{ description: 'Consulting', quantity: 0, unitPrice: '500.00' }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(fieldErrors(result.error)).toHaveProperty('lines.0.quantity');
  });

  // Mutation: change the fallback from `|| '_'` to `|| ''`. A top-level issue
  // (empty path) would then be keyed '' instead of '_', which is fine on its
  // own — but the danger this guards against is a *collision*: if the payload
  // shape ever legitimately has a top-level field error under the key '',
  // an empty-path root issue would silently overwrite it. Keying root issues
  // '_' keeps that namespace separate from any real field name.
  it('keys a root-level issue as "_" rather than colliding with a real field name', () => {
    const result = CreateOrderSchema.safeParse('not even an object');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    const errors = fieldErrors(result.error);
    expect(Object.keys(errors)).toContain('_');
    expect(errors['_']).toBeDefined();
  });
});
