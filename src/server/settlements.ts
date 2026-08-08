import { ObjectId } from 'mongodb';
import { ConcurrencyError, DomainError, IdempotencyKeyReusedError } from '@/domain/errors';
import { validateAndProject, type AppendInput } from '@/domain/ledger';
import { ZERO_BALANCE } from '@/domain/types';
import { isDuplicateKey, ledger, type LedgerEntryDoc } from './db';
import { loadOwnedOrder, toObjectId, toView, type OrderView } from './orders';
import { latestBalance } from './ledger';
import { recordAudit } from './audit';

export interface AppendResult {
  view: OrderView;
  entry: LedgerEntryDoc;
  replayed: boolean;
}

const MAX_ATTEMPTS = 5;

/**
 * Records a rejection in the audit log — the only trace a rejected attempt
 * ever leaves, since it writes no ledger entry. Best-effort: an audit failure
 * must never replace the real rejection the caller needs to see, so it is
 * caught and logged loudly rather than left to propagate.
 */
async function auditRejection(
  userId: ObjectId,
  orderId: ObjectId | null,
  kind: AppendInput['kind'],
  amountMinor: number,
  error: DomainError,
): Promise<void> {
  await recordAudit(
    userId, orderId,
    kind === 'payment' ? 'payment.rejected' : 'refund.rejected',
    // Details spread first: amountMinor and code always reflect this rejection's
    // own values and can never be shadowed by a same-named key inside `details`.
    { ...error.details, amountMinor, code: error.code },
  ).catch((auditError) => {
    console.error('audit write failed for a rejected settlement', {
      orderId: orderId?.toHexString() ?? null, code: error.code, auditError,
    });
  });
}

/**
 * Appends one payment or refund to an order's ledger.
 *
 * The invariant is that payments may never exceed the order total, and it must
 * hold under concurrent requests. Read-then-validate-then-write does not achieve
 * that, and neither does wrapping the read and write in a transaction: MongoDB
 * transactions give snapshot isolation, which prevents write-write conflicts on
 * the SAME document but permits write skew — two requests reading identical state
 * and inserting two DIFFERENT documents conflict with nothing, so both commit.
 *
 * The fix is to force both writers through one shared conflict point. Each entry
 * carries a per-order `seq` under a unique index, so two concurrent appends that
 * both compute seq = N collide: one wins, the loser gets E11000, re-reads the now
 * larger balance, and is correctly rejected. The whole state change is a single
 * document insert, so no transaction is needed anywhere.
 */
export async function appendEntry(
  userId: ObjectId,
  orderId: string,
  input: AppendInput,
  now: Date,
): Promise<AppendResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    // Re-read the order on every attempt, not once outside the loop. Both guards
    // compare against totalMinor, and an order only freezes once an entry exists —
    // so before the first entry a concurrent PATCH can still move the total.
    const order = await loadOwnedOrder(userId, orderId);
    const last = await (await ledger()).findOne({ orderId: order._id }, { sort: { seq: -1 } });
    const balance = last?.balanceAfter ?? ZERO_BALANCE;

    let projected;
    try {
      projected = validateAndProject(order, balance, input, now);
    } catch (error) {
      if (error instanceof DomainError) {
        await auditRejection(userId, order._id, input.kind, input.amountMinor, error);
      }
      throw error;
    }

    const doc: LedgerEntryDoc = {
      _id: new ObjectId(),
      orderId: order._id,
      userId,
      seq: (last?.seq ?? 0) + 1,
      recordedAt: new Date(),
      ...projected,
    };

    try {
      await (await ledger()).insertOne(doc);
      return { view: toView(order, doc.balanceAfter, now), entry: doc, replayed: false };
    } catch (error) {
      // A replayed idempotency key is NOT a retry: return what was already recorded.
      if (projected.idempotencyKey && isDuplicateKey(error, 'user_idem_unique')) {
        const existing = await (await ledger()).findOne({ userId, idempotencyKey: projected.idempotencyKey });
        if (existing) {
          // `user_idem_unique` is scoped to {userId, idempotencyKey} only — not to
          // an order, kind, or amount — so a matching row is not automatically a
          // replay of *this* request. Reusing a key against a different order, a
          // different settlement kind, or a different amount must be refused, not
          // silently answered with whatever was recorded under the key before.
          if (
            !existing.orderId.equals(order._id)
            || existing.kind !== projected.kind
            || existing.amountMinor !== projected.amountMinor
          ) {
            const reuseError = new IdempotencyKeyReusedError({
              idempotencyKey: projected.idempotencyKey,
              requested: { orderId: order._id.toHexString(), kind: projected.kind, amountMinor: projected.amountMinor },
              recorded: {
                orderId: existing.orderId.toHexString(), kind: existing.kind, amountMinor: existing.amountMinor,
              },
            });
            await auditRejection(userId, order._id, input.kind, input.amountMinor, reuseError);
            throw reuseError;
          }
          // `view` reflects the order's current state (same as an ordinary GET
          // would show right now); `entry` is the original, immutable ledger row
          // that proves this exact request was already honored. The two are
          // allowed to diverge — entry.balanceAfter is a snapshot of "after that
          // entry", not "as of now" — which only matters if other entries landed
          // on the order between the original call and this replay.
          return { view: toView(order, await latestBalance(order._id), now), entry: existing, replayed: true };
        }
        // The unique index fired but the row it names can't be found (e.g. it was
        // removed between the failed insert and this read). Translate rather than
        // let the raw duplicate-key error escape untranslated as a 500 — the caller
        // should retry, the same as any other collision.
        throw new ConcurrencyError();
      }
      // A seq collision IS a retry: another writer won, so re-read and try again.
      if (isDuplicateKey(error, 'order_seq_unique')) continue;
      throw error;
    }
  }

  // ponytail: bounded retries, no backoff — contention here is two browser tabs,
  // not a thundering herd. Add jitter if this ever fronts a payment processor.
  const exhausted = new ConcurrencyError();
  await auditRejection(userId, toObjectId(orderId), input.kind, input.amountMinor, exhausted);
  throw exhausted;
}
