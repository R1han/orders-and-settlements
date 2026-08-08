// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from '@/components/toast';
import { OrderForm } from './order-form';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

afterEach(() => {
  cleanup();
  mockPush.mockReset();
  mockRefresh.mockReset();
  vi.unstubAllGlobals();
});

function renderForm() {
  return render(
    <ToastHost>
      <OrderForm />
    </ToastHost>,
  );
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

const descriptionInput = () => screen.getByPlaceholderText('What are you billing for?') as HTMLInputElement;
const priceInput = () => screen.getByPlaceholderText('0.00') as HTMLInputElement;
const quantityInputs = () => document.querySelectorAll('input[inputmode="numeric"]');

describe('OrderForm', () => {
  // The one idea this screen exists to communicate: the subtotal shown while typing
  // is a client-side preview, computed with integer minor units (never floats), and
  // it must land on the exact figure the server would compute for the same lines.
  it('previews 2 x 500.00 as AED 1,000.00 before saving, using integer arithmetic', () => {
    renderForm();
    fireEvent.change(quantityInputs()[0], { target: { value: '2' } });
    fireEvent.change(priceInput(), { target: { value: '500.00' } });
    // Two AED 1,000.00 occurrences: the per-line amount and the subtotal.
    const amounts = screen.getAllByText('AED 1,000.00');
    expect(amounts.length).toBeGreaterThanOrEqual(2);
  });

  it('never shows NaN in the preview for an empty, partial, or non-numeric unit price', () => {
    renderForm();
    fireEvent.change(quantityInputs()[0], { target: { value: '3' } });

    // Empty price: both the per-line amount and the subtotal read zero.
    expect(screen.getAllByText('AED 0.00')).toHaveLength(2);

    // Partial price, mid-typing.
    fireEvent.change(priceInput(), { target: { value: '12.' } });
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getAllByText('AED 0.00')).toHaveLength(2);

    // Non-numeric price.
    fireEvent.change(priceInput(), { target: { value: 'abc' } });
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getAllByText('AED 0.00')).toHaveLength(2);
  });

  it('rejects a blank customer client-side: red field, message beneath it, and an error toast', async () => {
    renderForm();
    fireEvent.change(descriptionInput(), { target: { value: 'Consulting' } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    const alert = await screen.findByText('Customer is required.');
    expect(alert.closest('[role="alert"]')).toBeTruthy();
    expect((screen.getByPlaceholderText('Company name') as HTMLInputElement).className).toMatch(/border-status-overdue-dot/);
    expect(await screen.findByText('Order not created')).toBeTruthy();
  });

  it('disables the remove button at one row and re-enables it once a second row exists', () => {
    renderForm();
    const removeButton = () => screen.getByTitle('Remove line') as HTMLButtonElement;
    expect(removeButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add line item' }));
    const removeButtons = screen.getAllByTitle('Remove line') as HTMLButtonElement[];
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0].disabled).toBe(false);

    fireEvent.click(removeButtons[1]);
    expect(removeButton().disabled).toBe(true);
  });

  // The planted defect this test guards: the server returns field errors keyed by
  // dotted path (`lines.0.unitPrice`), but a naive form only ever checks a single
  // top-level `errors.lines` key — silently swallowing exactly this error. It must
  // land on the correct row and field, not vanish.
  it('places a server-side dotted-path line error on the correct row and field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        details: { fields: { 'lines.0.unitPrice': 'Enter an amount like 1000.00.' } },
      },
    }, false)));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Company name'), { target: { value: 'Acme Co' } });
    fireEvent.change(descriptionInput(), { target: { value: 'Consulting' } });
    fireEvent.change(priceInput(), { target: { value: '1.005' } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-09-01' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    const message = await screen.findByText('Enter an amount like 1000.00.');
    expect(message.closest('[role="alert"]')).toBeTruthy();
    expect(priceInput().className).toMatch(/border-status-overdue-dot/);
    // The description field, untouched by this particular error, must stay clean.
    expect(descriptionInput().className).not.toMatch(/border-status-overdue-dot/);
  });

  it('clears a field error as soon as the user edits that field, instead of leaving stale red', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));
    await screen.findByText('Customer is required.');

    fireEvent.change(screen.getByPlaceholderText('Company name'), { target: { value: 'A' } });
    expect(screen.queryByText('Customer is required.')).toBeNull();
    expect((screen.getByPlaceholderText('Company name') as HTMLInputElement).className)
      .not.toMatch(/border-status-overdue-dot/);
  });

  // The round-1 defect: an earlier version stripped non-digit characters from the
  // quantity field on every keystroke, so a typed "1.5" silently became "15" — a
  // tenfold quantity on an order document, with no error and no visible cue beyond
  // the missing decimal point. The field must keep exactly what was typed and reject
  // it at submit instead, with the server's own wording.
  it('rejects a decimal quantity instead of silently changing its value', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Company name'), { target: { value: 'Acme Co' } });
    fireEvent.change(descriptionInput(), { target: { value: 'Consulting' } });
    fireEvent.change(quantityInputs()[0], { target: { value: '1.5' } });
    fireEvent.change(priceInput(), { target: { value: '500.00' } });
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '2026-09-01' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    const message = await screen.findByText('Quantity must be a whole number.');
    expect(message.closest('[role="alert"]')).toBeTruthy();
    // Never rewritten — a stripped "15" would be indistinguishable from a real 15.
    expect((quantityInputs()[0] as HTMLInputElement).value).toBe('1.5');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves the preview at zero for an unparseable quantity rather than NaN', () => {
    renderForm();
    fireEvent.change(quantityInputs()[0], { target: { value: '1.5' } });
    fireEvent.change(priceInput(), { target: { value: '500.00' } });

    expect(screen.queryByText(/NaN/)).toBeNull();
    // Per-line amount and subtotal both read zero: a decimal quantity contributes
    // nothing to the preview rather than a fractional or garbled minor-unit total.
    expect(screen.getAllByText('AED 0.00')).toHaveLength(2);
  });

  it('does not validate the quantity field until submit, so ordinary typing never errors mid-keystroke', () => {
    renderForm();
    const quantity = quantityInputs()[0] as HTMLInputElement;

    fireEvent.change(quantity, { target: { value: '1' } });
    fireEvent.change(quantity, { target: { value: '12' } });
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(quantity, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(quantity.value).toBe('');

    fireEvent.change(quantity, { target: { value: '5' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(quantity.value).toBe('5');
  });

  it('on success, toasts the created order and navigates to its detail page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      id: 'order-99', ref: 'ORD-1099', totalMinor: 100000,
    })));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Company name'), { target: { value: 'Acme Co' } });
    fireEvent.change(descriptionInput(), { target: { value: 'Consulting' } });
    fireEvent.change(quantityInputs()[0], { target: { value: '2' } });
    fireEvent.change(priceInput(), { target: { value: '500.00' } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-09-01' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    await screen.findByText('Order created');
    expect(mockPush).toHaveBeenCalledWith('/orders/order-99');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
