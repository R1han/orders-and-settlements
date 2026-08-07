import { ValidationError } from './errors';
import type { LineItem, LineItemInput, OrderTotals } from './types';

export function computeTotals(lines: LineItemInput[]): OrderTotals {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new ValidationError('An order needs at least one line item.', { field: 'lines' });
  }

  const computed: LineItem[] = lines.map((line, index) => {
    if (typeof line !== 'object' || line === null) {
      throw new ValidationError('Every line item must be an object.', { field: `lines.${index}` });
    }
    if (typeof line.description !== 'string' || line.description.trim().length === 0) {
      throw new ValidationError('Every line item needs a description.', { field: `lines.${index}.description` });
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError('Quantity must be a whole number of at least 1.', { field: `lines.${index}.quantity` });
    }
    if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) {
      throw new ValidationError('Unit price must be zero or more.', { field: `lines.${index}.unitPriceMinor` });
    }
    return {
      description: line.description.trim(),
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.quantity * line.unitPriceMinor,
    };
  });

  const subtotalMinor = computed.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  if (!Number.isSafeInteger(subtotalMinor)) {
    throw new ValidationError('This order total is too large to record.', { field: 'lines' });
  }

  // totalMinor is a distinct field because order-level tax and discount would land here.
  return { lines: computed, subtotalMinor, totalMinor: subtotalMinor };
}
