import { ValidationError } from '@/domain/errors';
import { ensureIndexes } from '@/server/db';
import { appendEntry } from '@/server/settlements';
import { requireUserId } from '@/server/session';
import { fail, ok } from '../../../_lib/respond';
import { AmountSchema, fieldErrors } from '../../../_lib/schemas';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureIndexes();
    const userId = await requireUserId();
    const { id } = await params;
    const parsed = AmountSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Check the highlighted fields.', { fields: fieldErrors(parsed.error) });
    }
    const result = await appendEntry(userId, id, {
      kind: 'refund',
      amountMinor: parsed.data.amount,
      occurredAt: parsed.data.date,
      note: parsed.data.note,
      idempotencyKey: request.headers.get('Idempotency-Key') ?? undefined,
    }, new Date());
    return ok({ order: result.view, entryId: result.entry._id.toHexString(), replayed: result.replayed }, 201);
  } catch (error) {
    return fail(error);
  }
}
