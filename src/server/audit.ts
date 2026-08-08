import { ObjectId } from 'mongodb';
import { audit, ledger, type AuditDoc } from './db';

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

/**
 * Money and status stay structured fields, not baked into `summary`, so this
 * module never has to know how a minor-units figure should be displayed —
 * that's the UI's job (`formatMoney`). `summary` carries only what has no
 * numeric formatting decision attached to it.
 */
export interface TimelineItem {
  at: string;
  kind: string;
  summary: string;
  amountMinor: number | null;
  statusBefore: string | null;
  statusAfter: string | null;
  errorCode: string | null;
}

/**
 * The ledger holds money that moved; the audit log holds everything else,
 * including refused attempts. The order page shows one merged trail.
 *
 * Sorted by ISO string with `localeCompare`, not by numeric timestamp. ISO
 * 8601 timestamps (both here always UTC, always millisecond precision) compare
 * identically either way, so this is a style choice, not a correctness one —
 * and `Array.prototype.sort` is a stable sort per spec, so two records with
 * the exact same millisecond keep the relative order they arrived in above
 * (ledger entries, in `seq` order, before audit records, in `at` order).
 */
export async function orderTimeline(userId: ObjectId, orderId: ObjectId): Promise<TimelineItem[]> {
  const [entries, records] = await Promise.all([
    (await ledger()).find({ userId, orderId }).sort({ seq: 1 }).toArray(),
    (await audit()).find({ userId, orderId }).sort({ at: 1 }).toArray(),
  ]);

  const items: TimelineItem[] = [
    ...entries.map((entry) => ({
      at: entry.recordedAt.toISOString(),
      kind: entry.kind,
      summary: entry.kind === 'refund' ? 'Refund' : 'Payment',
      amountMinor: entry.amountMinor,
      statusBefore: entry.statusBefore,
      statusAfter: entry.statusAfter,
      errorCode: null,
    })),
    ...records.map((record) => {
      const rejected = record.event === 'payment.rejected' || record.event === 'refund.rejected';
      return {
        at: record.at.toISOString(),
        kind: record.event,
        summary: rejected ? 'Rejected' : record.event.replace('order.', 'Order '),
        amountMinor: rejected ? Number(record.payload.amountMinor) : null,
        statusBefore: null,
        statusAfter: null,
        errorCode: rejected ? String(record.payload.code) : null,
      };
    }),
  ];

  return items.sort((a, b) => a.at.localeCompare(b.at));
}
