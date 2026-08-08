import { ValidationError } from '@/domain/errors';
import { getOrder, patchOrder, softDeleteOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../../_lib/respond';
import { PatchOrderSchema, fieldErrors } from '../../_lib/schemas';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    return ok(await getOrder(userId, id, new Date()));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = PatchOrderSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Check the highlighted fields.', { fields: fieldErrors(parsed.error) });
    }
    return ok(await patchOrder(userId, id, parsed.data, new Date()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await softDeleteOrder(userId, id);
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
