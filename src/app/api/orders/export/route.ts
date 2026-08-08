import { ValidationError } from '@/domain/errors';
import { exportOrders, toCsv } from '@/server/dashboard';
import { requireUserId } from '@/server/session';
import type { OrderStatus } from '@/domain/types';
import { fail } from '../../_lib/respond';

const STATUSES: OrderStatus[] = ['pending', 'partially_paid', 'paid', 'overdue'];

/**
 * An unparsable date string does not throw when passed to `new Date(...)` —
 * it silently produces an Invalid Date, which the MongoDB driver then
 * serialises to a filter that matches unpredictably rather than raising an
 * error. Rejecting it here, at the boundary, means a bad `from`/`to` query
 * param reliably 400s through `fail()` instead of returning a CSV the caller
 * did not ask for.
 */
function parseDateParam(value: string | null, field: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('Check the date range.', { fields: { [field]: 'Enter a valid date.' } });
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);

    const status = url.searchParams.get('status');

    const rows = await exportOrders(userId, {
      status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
      from: parseDateParam(url.searchParams.get('from'), 'from'),
      to: parseDateParam(url.searchParams.get('to'), 'to'),
    }, new Date());

    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="orders.csv"',
      },
    });
  } catch (error) {
    return fail(error);
  }
}
