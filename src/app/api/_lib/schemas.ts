import { z } from 'zod';
import { parseMinor } from '@/domain/money';

/** Decimal strings become integer minor units here, at the HTTP boundary, and nowhere else. */
const MoneyString = z.string().transform((value, ctx) => {
  try {
    return parseMinor(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 1000.00.' });
    return z.NEVER;
  }
});

const DateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid date.')
  .transform((value) => new Date(value));

export const CreateOrderSchema = z.object({
  customer: z.string().trim().min(1, 'Customer is required.').max(200),
  dueDate: DateString,
  lines: z.array(z.object({
    description: z.string().trim().min(1, 'Description is required.').max(500),
    quantity: z.number().int('Quantity must be a whole number.').min(1, 'Quantity must be at least 1.'),
    unitPrice: MoneyString,
  })).min(1, 'Add at least one line item.'),
});

export const PatchOrderSchema = z.object({
  customer: z.string().trim().min(1).max(200).optional(),
  dueDate: DateString.optional(),
});

export const AmountSchema = z.object({
  amount: MoneyString,
  date: DateString,
  note: z.string().trim().max(500).optional(),
});

/** Turns a Zod failure into the error envelope's per-field details. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]));
}
