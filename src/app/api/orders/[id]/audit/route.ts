import { orderTimeline } from '@/server/audit';
import { loadOwnedOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../../../_lib/respond';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const order = await loadOwnedOrder(userId, id); // 404s before revealing anything
    return ok({ items: await orderTimeline(userId, order._id) });
  } catch (error) {
    return fail(error);
  }
}
