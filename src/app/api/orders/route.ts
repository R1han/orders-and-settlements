import { ValidationError } from '@/domain/errors';
import { ensureIndexes } from '@/server/db';
import { createOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../_lib/respond';
import { CreateOrderSchema, fieldErrors } from '../_lib/schemas';

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
