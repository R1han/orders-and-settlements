'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { formatMoney } from '@/lib/format';

const INPUT = 'h-[34px] w-full rounded border border-border-strong px-2.5 text-body';
const LABEL = 'text-xs font-medium text-[#4a5552]';

type Kind = 'payments' | 'refunds';

const COPY = {
  payments: { title: 'Record payment', ceiling: 'Remaining balance', verb: 'Payment' },
  refunds: { title: 'Record refund', ceiling: 'Refundable', verb: 'Refund' },
} as const;

export function SettlementActions({ orderId, orderRef, customer, maxPaymentMinor, maxRefundMinor }: {
  orderId: string; orderRef: string; customer: string;
  maxPaymentMinor: number; maxRefundMinor: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ceilingMinor = open === 'refunds' ? maxRefundMinor : maxPaymentMinor;

  function close() {
    setOpen(null);
    setError(null);
    setBusy(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !open) return;
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const amount = String(form.get('amount') ?? '');

    try {
      const response = await fetch(`/api/orders/${orderId}/${open}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // One key per submission, so a double-click or a retried request
          // cannot record the same settlement twice.
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          amount,
          date: String(form.get('date') ?? ''),
          note: String(form.get('note') ?? ''),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        // The server knows the ceiling; show it rather than a generic failure.
        const max = body.error?.details?.maxAllowedMinor;
        const hint = typeof max === 'number'
          ? ` The most you can record against ${orderRef} is ${formatMoney(max)}.`
          : '';
        setError(`${body.error?.message ?? 'Could not record that.'}${hint}`);
        return;
      }

      const remaining = body.order.dueMinor as number;
      toast({
        kind: 'ok',
        title: `${COPY[open].verb} recorded`,
        body: `${formatMoney(body.order[open === 'refunds' ? 'refundedMinor' : 'paidMinor'])} total against ${orderRef} · `
          + (remaining === 0 ? 'order is now paid in full' : `${formatMoney(remaining)} still due`),
      });
      close();
      router.refresh();
    } catch {
      setError('The request did not reach the server. Nothing was recorded; try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-none gap-2">
        {maxRefundMinor > 0 && (
          <button type="button" onClick={() => setOpen('refunds')}
                  className="h-8 whitespace-nowrap rounded border border-border-strong bg-surface px-3 text-[13px]">
            Record refund
          </button>
        )}
        {maxPaymentMinor > 0 && (
          <button type="button" onClick={() => setOpen('payments')}
                  className="h-8 whitespace-nowrap rounded bg-brand px-[13px] text-[13px] font-medium text-white">
            Record payment
          </button>
        )}
      </div>

      <Modal open={open !== null} onClose={close}
             title={open ? COPY[open].title : ''} subtitle={`${customer} · ${orderRef}`}>
        {/* Keyed on `open`: without this, the amount/date/note inputs below are
            uncontrolled DOM nodes that never unmount between one dialog session
            and the next (Modal always renders its children; only the native
            <dialog>'s open state toggles). Closing "Record payment" after typing
            an amount and then opening "Record refund" would otherwise show the
            stale payment amount sitting in the refund form. Remounting the form
            on every open/close forces fresh, empty fields and today's date. */}
        <form onSubmit={submit} key={open ?? 'closed'}>
          <div className="px-5">
            <div className="mt-3.5 flex items-baseline justify-between rounded bg-[#f4f6f5] px-3 py-[9px]">
              <span className="text-[12.5px] text-[#57615e]">{open ? COPY[open].ceiling : ''}</span>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(ceilingMinor)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Amount</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-fg-subtle">AED</span>
                <input name="amount" inputMode="decimal" placeholder="0.00" required autoFocus
                       className={`${INPUT} pl-11 text-right tabular-nums ${error ? 'border-status-overdue-dot bg-[#fffbfb]' : ''}`} />
              </div>
              {error && (
                <span role="alert" className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-status-overdue-fg">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       className="mt-0.5 flex-none"><circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" /></svg>
                  {error}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{open === 'refunds' ? 'Refund date' : 'Payment date'}</span>
              <input name="date" type="date" required className={INPUT}
                     defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Note <span className="font-normal text-[#9aa3a0]">optional</span></span>
              <input name="note" placeholder="Bank transfer reference" className={INPUT} />
            </label>
          </div>

          <div className="flex justify-end gap-2 px-5 pb-5">
            <button type="button" onClick={close}
                    className="h-8 rounded border border-border-strong bg-surface px-[13px] text-[13px]">Cancel</button>
            <button type="submit" disabled={busy}
                    className={`flex h-8 items-center gap-[7px] rounded px-3.5 text-[13px] font-medium text-white ${
                      busy ? 'bg-[#3d8b74]' : 'bg-brand'}`}>
              {busy && <span className="h-3 w-3 animate-spin rounded-full border-[1.6px] border-white/40 border-t-white" />}
              {busy ? 'Recording…' : open ? COPY[open].title : ''}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
