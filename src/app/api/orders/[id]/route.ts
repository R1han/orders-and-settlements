import { getOrder } from '@/server/orders';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../../_lib/respond';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    return ok(await getOrder(userId, id, new Date()));
  } catch (error) {
    return fail(error);
  }
}
