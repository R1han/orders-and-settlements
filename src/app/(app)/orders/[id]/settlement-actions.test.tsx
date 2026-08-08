// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@/components/toast';
import { SettlementActions } from './settlement-actions';

// jsdom does not implement HTMLDialogElement.showModal()/close() — same polyfill
// as src/components/modal.test.tsx, needed again here because vitest gives each
// test file its own jsdom instance.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

afterEach(() => {
  cleanup();
  mockRefresh.mockReset();
  vi.unstubAllGlobals();
});

function renderActions(overrides: Partial<Parameters<typeof SettlementActions>[0]> = {}) {
  return render(
    <ToastHost>
      <SettlementActions
        orderId="order-1"
        orderRef="ORD-1042"
        customer="Meridian Facilities Management"
        maxPaymentMinor={60000}
        maxRefundMinor={40000}
        {...overrides}
      />
    </ToastHost>,
  );
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

// getByLabelText won't do: the "AED" prefix span sits inside the same <label>
// as the input (a sibling, not text-in-a-nested-element testing-library
// excludes), so the label's computed text is "AmountAED", not "Amount".
function amountInput(): HTMLInputElement {
  return document.querySelector('input[name="amount"]') as HTMLInputElement;
}

describe('SettlementActions', () => {
  // The reported bug: Modal always renders its <form> children (only the native
  // <dialog>'s open state toggles), so uncontrolled inputs are the same DOM node
  // across an entire close/reopen cycle. Without a remount keyed on which dialog
  // is open, text typed into "Record payment" would still be sitting in the
  // amount field when the user opens "Record refund" next.
  it('does not carry a typed amount from the payment dialog into the refund dialog', () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '500' } });
    expect(amountInput().value).toBe('500');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }));

    expect(amountInput().value).toBe('');
    // Confirms this really is the refund dialog, not a stale payment one.
    expect(screen.getByText('Refundable')).toBeTruthy();
  });

  it('clears a prior error when the dialog is closed and reopened', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', details: {} } }, false),
    ));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces the server-provided maxAllowedMinor in the error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({
        error: {
          code: 'EXCESS_REFUND',
          message: 'Refund exceeds the amount paid on this order.',
          details: { maxAllowedMinor: 40000 },
        },
      }, false),
    ));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }));
    fireEvent.change(amountInput(), { target: { value: '1000.01' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record refund' })[1]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('AED 400.00');
    expect(alert.textContent).toContain('Refund exceeds the amount paid on this order.');
  });

  it('does not print "undefined" when the rejection has no maxAllowedMinor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', details: { fields: {} } } }, false),
    ));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Check the highlighted fields.');
    expect(alert.textContent).not.toContain('undefined');
  });

  it('shows a message and re-enables the form on a network failure, instead of crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/did not reach the server/i);
    // Not stuck showing the busy state.
    const submit = screen.getAllByRole('button', { name: 'Record payment' })[1] as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  // A 2xx means the server accepted the request — the settlement may well be
  // recorded even though this particular response body couldn't be read (a
  // truncated response, a misbehaving proxy). Every submission mints a fresh
  // Idempotency-Key, so telling the user "nothing was recorded" here would
  // invite a retry that is NOT deduplicated server-side and records the
  // settlement twice. The message must not claim that, and the route must be
  // refreshed so the user can see the real state instead of retrying blind.
  it('does not claim nothing was recorded when a 2xx response body is unreadable, and refreshes instead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Response));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/nothing was recorded/i);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  // A non-2xx with an unreadable body is the ordinary "the server said no and we
  // don't know why" case — nothing was recorded, so the message must not claim
  // otherwise in either direction; it should just surface the status.
  it('surfaces the status, without claiming anything about recording, when a non-2xx response body is unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    } as unknown as Response));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('500');
    expect(alert.textContent).not.toMatch(/nothing was recorded/i);
    expect(alert.textContent).not.toMatch(/was recorded\b/i);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('renders neither action when both ceilings are zero, without crashing', () => {
    renderActions({ maxPaymentMinor: 0, maxRefundMinor: 0 });
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record refund' })).toBeNull();
  });

  it('on success, toasts the remaining balance, closes the dialog and refreshes the route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      order: { dueMinor: 60000, paidMinor: 40000, refundedMinor: 0 },
      entryId: 'entry-1',
      replayed: false,
    })));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '400' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);

    await waitFor(() => expect(screen.getByText('Payment recorded')).toBeTruthy());
    const toastBody = within(screen.getByRole('status'));
    expect(toastBody.getByText(/AED 600\.00 still due/)).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false);
  });

  it('sends a fresh Idempotency-Key header on every submission', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      order: { dueMinor: 0, paidMinor: 100000, refundedMinor: 0 }, entryId: 'e', replayed: false,
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(amountInput(), { target: { value: '600' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record payment' })[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
