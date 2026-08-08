import { ValidationError } from '@/domain/errors';
import type { OrderStatus } from '@/domain/types';
import { ensureIndexes } from '@/server/db';
import { listOrders } from '@/server/dashboard';
import { createOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../_lib/respond';
import { CreateOrderSchema, fieldErrors } from '../_lib/schemas';

const STATUSES: OrderStatus[] = ['pending', 'partially_paid', 'paid', 'overdue'];

export async function POST(request: Request) {
  try {
    await ensureIndexes();
    const userId = await requireUserId();
    const parsed = CreateOrderSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Check the highlighted fields.', { fields: fieldErrors(parsed.error) });
    }
    const view = await createOrder(userId, {
      customer: parsed.data.customer,
      dueDate: parsed.data.dueDate,
      lines: parsed.data.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPrice,
      })),
    });
    return ok(view, 201);
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  try {
    await ensureIndexes();
    const userId = await requireUserId();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    return ok(await listOrders(userId, {
      status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
      page: Number(url.searchParams.get('page') ?? 1),
      pageSize: Number(url.searchParams.get('pageSize') ?? 20),
    }, new Date()));
  } catch (error) {
    return fail(error);
  }
}
