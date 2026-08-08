import { ObjectId } from 'mongodb';
import { ConcurrencyError, DomainError } from '@/domain/errors';
import { validateAndProject, type AppendInput } from '@/domain/ledger';
import { ZERO_BALANCE } from '@/domain/types';
import { isDuplicateKey, ledger, type LedgerEntryDoc } from './db';
import { loadOwnedOrder, toView, type OrderView } from './orders';
import { latestBalance } from './ledger';
import { recordAudit } from './audit';

export interface AppendResult {
  view: OrderView;
  entry: LedgerEntryDoc;
  replayed: boolean;
}

const MAX_ATTEMPTS = 5;

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
        await recordAudit(
          userId, order._id,
          input.kind === 'payment' ? 'payment.rejected' : 'refund.rejected',
          { amountMinor: input.amountMinor, code: error.code, ...error.details },
        ).catch((auditError) => {
          console.error('audit write failed for a rejected settlement', {
            orderId: order._id.toHexString(), code: error.code, auditError,
          });
        });
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
          const owner = await loadOwnedOrder(userId, existing.orderId.toHexString());
          return { view: toView(owner, await latestBalance(owner._id), now), entry: existing, replayed: true };
        }
      }
      // A seq collision IS a retry: another writer won, so re-read and try again.
      if (isDuplicateKey(error, 'order_seq_unique')) continue;
      throw error;
    }
  }

  // ponytail: bounded retries, no backoff — contention here is two browser tabs,
  // not a thundering herd. Add jitter if this ever fronts a payment processor.
  throw new ConcurrencyError();
}
