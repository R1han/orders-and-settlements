'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';
import { formatMoney } from '@/lib/format';

interface Line { description: string; quantity: string; unitPrice: string }
const EMPTY: Line = { description: '', quantity: '1', unitPrice: '' };

const INPUT = 'h-8 w-full rounded border border-border-strong bg-surface px-2.5 text-table';
const ERROR_INPUT = 'border-status-overdue-dot bg-[#fffbfb]';
const LABEL = 'text-xs font-medium text-[#4a5552]';
const GRID = 'grid grid-cols-[1fr_76px_130px_118px_30px] gap-2';

/**
 * Preview only, and labelled as such in the UI. The server recomputes every total
 * from the line items and ignores whatever the client sends, so a divergence here
 * is cosmetic rather than a correctness bug.
 */
function previewMinor(lines: Line[]): number {
  return lines.reduce((total, line) => {
    const quantity = Number(line.quantity);
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(line.unitPrice.trim());
    // Integer, not just finite: a decimal quantity (e.g. "1.5") is finite but invalid —
    // it would multiply into a fractional minor-unit total that formatMoney was never
    // built to display, and it will be rejected at submit anyway. Drop it to 0 rather
    // than show a garbled preview for a value the server will never accept.
    if (!match || !Number.isInteger(quantity)) return total;
    const unit = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return total + quantity * unit;
  }, 0);
}

/** `lines.<index>.<field>` — the dotted paths the server's field errors use. */
function lineErrorKey(index: number, field: 'description' | 'quantity' | 'unitPrice') {
  return `lines.${index}.${field}`;
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <span role="alert" className="flex items-center gap-1 text-[11.5px] text-status-overdue-fg">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" />
      </svg>
      {children}
    </span>
  );
}

export function OrderForm() {
  const router = useRouter();
  const toast = useToast();
  const [customer, setCustomer] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const single = lines.length === 1;

  // A field's error is stale the moment the user edits it — the message described the
  // value that was there before, not the one they're now typing. Drop it eagerly rather
  // than waiting for the next submit, so red never lingers on a field the user just fixed.
  function clearError(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Adding or removing a row shifts every later index, so any stored `lines.N.field`
  // error would silently point at the wrong row afterward. Drop them all rather than
  // let a red border survive on a row it no longer describes.
  function clearLineErrors() {
    setErrors((prev) => {
      const kept = Object.entries(prev).filter(([key]) => key !== 'lines' && !key.startsWith('lines.'));
      return Object.fromEntries(kept);
    });
  }

  const update = (index: number, patch: Partial<Line>, clearKey?: string) => {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    if (clearKey) clearError(clearKey);
  };

  // Every message keyed under the line items — the array-level `lines` message plus any
  // per-row `lines.N.field` ones — surfaces here, below the rows, in addition to marking
  // the specific row/field red. De-duplicated: several rows can share the same message.
  const lineMessages = Array.from(new Set(
    Object.entries(errors)
      .filter(([key]) => key === 'lines' || key.startsWith('lines.'))
      .map(([, message]) => message),
  ));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const next: Record<string, string> = {};
    if (!customer.trim()) next.customer = 'Customer is required.';
    if (!dueDate) next.dueDate = 'Due date is required.';
    lines.forEach((line, index) => {
      if (!line.description.trim()) next[lineErrorKey(index, 'description')] = 'Description is required.';
      // Whole digits only — the field itself no longer rewrites what was typed (a "1.5"
      // must still read "1.5"), so this is the only place a decimal quantity is caught.
      // Same wording the server uses, so the two can never disagree.
      const raw = line.quantity.trim();
      const isWholeNumber = /^\d+$/.test(raw);
      if (raw !== '' && !isWholeNumber) {
        next[lineErrorKey(index, 'quantity')] = 'Quantity must be a whole number.';
      } else if (!isWholeNumber || Number(raw) < 1) {
        next[lineErrorKey(index, 'quantity')] = 'Quantity must be at least 1.';
      }
    });
    if (Object.keys(next).length) {
      setErrors(next);
      toast({ kind: 'error', title: 'Order not created', body: 'Fix the highlighted fields and try again.' });
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          dueDate,
          lines: lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: line.unitPrice,
          })),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        // Server-side field errors win over the client's own guesses.
        setErrors(body.error?.details?.fields ?? {});
        toast({
          kind: 'error',
          title: 'Order not created',
          body: body.error?.message ?? 'Fix the highlighted fields and try again.',
        });
        return;
      }

      toast({
        kind: 'ok',
        title: 'Order created',
        body: `${body.ref} · ${formatMoney(body.totalMinor)}`,
      });
      router.push(`/orders/${body.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-[1fr_220px] gap-4 rounded-lg border border-border bg-surface px-5 py-[18px]">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Customer</span>
          <input value={customer}
                 onChange={(e) => { setCustomer(e.target.value); clearError('customer'); }}
                 placeholder="Company name"
                 className={`h-[34px] w-full rounded border border-border-strong bg-surface px-2.5 text-body ${
                   errors.customer ? ERROR_INPUT : ''}`} />
          {errors.customer && <FieldError>{errors.customer}</FieldError>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Due date</span>
          <input type="date" value={dueDate}
                 onChange={(e) => { setDueDate(e.target.value); clearError('dueDate'); }}
                 className={`h-[34px] w-full rounded border border-border-strong bg-surface px-2.5 text-body ${
                   errors.dueDate ? ERROR_INPUT : ''}`} />
          {errors.dueDate && <FieldError>{errors.dueDate}</FieldError>}
        </label>
      </div>

      <div className="mt-3.5 rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Line items</h2>
          <span className="text-xs text-fg-subtle">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-1 pt-3">
          <div className={`${GRID} text-label uppercase text-fg-subtle`}>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          {lines.map((line, index) => {
            const descErr = errors[lineErrorKey(index, 'description')];
            const qtyErr = errors[lineErrorKey(index, 'quantity')];
            const priceErr = errors[lineErrorKey(index, 'unitPrice')];
            return (
              <div key={index} className={`${GRID} items-center`}>
                <input value={line.description}
                       onChange={(e) => update(index, { description: e.target.value }, lineErrorKey(index, 'description'))}
                       placeholder="What are you billing for?"
                       className={`${INPUT} ${descErr ? ERROR_INPUT : ''}`} />
                <input value={line.quantity}
                       onChange={(e) => update(index, { quantity: e.target.value }, lineErrorKey(index, 'quantity'))}
                       inputMode="numeric" className={`${INPUT} text-right tabular-nums ${qtyErr ? ERROR_INPUT : ''}`} />
                <input value={line.unitPrice}
                       onChange={(e) => update(index, { unitPrice: e.target.value }, lineErrorKey(index, 'unitPrice'))}
                       inputMode="decimal" placeholder="0.00"
                       className={`${INPUT} text-right tabular-nums ${priceErr ? ERROR_INPUT : ''}`} />
                <div className="text-right text-table tabular-nums text-[#3d4a47]">
                  {formatMoney(previewMinor([line]))}
                </div>
                <button type="button" title="Remove line" disabled={single}
                        onClick={() => { setLines(lines.filter((_, i) => i !== index)); clearLineErrors(); }}
                        className="flex h-7 w-7 items-center justify-center rounded text-[#a9b1ae] disabled:cursor-not-allowed disabled:opacity-35">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}

          {lineMessages.map((message) => <FieldError key={message}>{message}</FieldError>)}

          <button type="button" onClick={() => { setLines([...lines, { ...EMPTY }]); clearLineErrors(); }}
                  className="mb-2.5 mt-0.5 flex h-[29px] items-center gap-1.5 self-start rounded border border-dashed border-[#cdd4d1] bg-surface px-2.5 text-[12.5px] text-[#3d4a47]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add line item
          </button>
        </div>

        <div className="flex items-baseline justify-end gap-3.5 border-t border-border px-4 py-3">
          <div className="text-right">
            <div className="text-[12.5px] text-fg-muted">Subtotal</div>
            <div className="mt-px text-[11px] text-[#9aa3a0]">
              Calculated in the browser. The server recalculates on save.
            </div>
          </div>
          <div className="min-w-[150px] text-right text-lg font-semibold tabular-nums">
            {formatMoney(previewMinor(lines))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => router.push('/')}
                className="h-8 rounded border border-border-strong bg-surface px-[13px] text-[13px]">Cancel</button>
        <button type="submit" disabled={busy}
                className="h-8 rounded bg-brand px-3.5 text-[13px] font-medium text-white disabled:opacity-70">
          {busy ? 'Creating…' : 'Create order'}
        </button>
      </div>
    </form>
  );
}
