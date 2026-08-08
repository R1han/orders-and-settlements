import { ObjectId } from 'mongodb';
import { ValidationError } from '@/domain/errors';
import { listEntries } from '@/server/ledger';
import { getOrder, patchOrder, softDeleteOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../../_lib/respond';
import { PatchOrderSchema, fieldErrors } from '../../_lib/schemas';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    // getOrder runs first, so an order owned by another user 404s before any ledger read happens.
    const order = await getOrder(userId, id, new Date());
    const entries = await listEntries(new ObjectId(order.id), userId);
    return ok({
      ...order,
      entries: entries.map((entry) => ({
        id: entry._id.toHexString(),
        seq: entry.seq,
        kind: entry.kind,
        amountMinor: entry.amountMinor,
        occurredAt: entry.occurredAt.toISOString(),
        recordedAt: entry.recordedAt.toISOString(),
        note: entry.note,
        balanceAfter: entry.balanceAfter,
        statusBefore: entry.statusBefore,
        statusAfter: entry.statusAfter,
      })),
    });
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
