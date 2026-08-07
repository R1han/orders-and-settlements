import { ObjectId } from 'mongodb';
import { audit, type AuditDoc } from './db';

/**
 * The ledger records money that moved; this records everything else, including
 * attempts that were refused. A rejected payment writes no ledger entry, so
 * without this it would leave no trace at all.
 */
export async function recordAudit(
  userId: ObjectId,
  orderId: ObjectId | null,
  event: AuditDoc['event'],
  payload: Record<string, unknown> = {},
): Promise<void> {
  await (await audit()).insertOne({ _id: new ObjectId(), userId, orderId, event, at: new Date(), payload });
}
