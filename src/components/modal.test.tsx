// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './modal';

// jsdom does not implement HTMLDialogElement.showModal()/close() (they are simply
// absent from the prototype), so calling them on a real dialog throws. Polyfill just
// enough of the native behaviour — toggling the reflected `open` attribute — so the
// component's effect has something real to drive, and spy on the calls so we can
// assert Modal's `open` prop is what drives them rather than, say, always calling
// showModal on mount.
let showModalSpy: ReturnType<typeof vi.fn<() => void>>;
let closeSpy: ReturnType<typeof vi.fn<(returnValue?: string) => void>>;

beforeAll(() => {
  showModalSpy = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  closeSpy = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  HTMLDialogElement.prototype.showModal = showModalSpy;
  HTMLDialogElement.prototype.close = closeSpy;
});

afterEach(() => {
  cleanup();
  showModalSpy.mockClear();
  closeSpy.mockClear();
});

function noop() {}

describe('Modal', () => {
  it('does not call showModal when rendered closed', () => {
    render(<Modal open={false} onClose={noop} title="Record payment">content</Modal>);
    expect(showModalSpy).not.toHaveBeenCalled();
  });

  it('calls showModal when open becomes true', () => {
    const { rerender } = render(<Modal open={false} onClose={noop} title="Record payment">content</Modal>);
    expect(showModalSpy).not.toHaveBeenCalled();
    rerender(<Modal open onClose={noop} title="Record payment">content</Modal>);
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(true);
  });

  it('calls close when open goes from true to false', () => {
    const { rerender } = render(<Modal open onClose={noop} title="Record payment">content</Modal>);
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    rerender(<Modal open={false} onClose={noop} title="Record payment">content</Modal>);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false);
  });

  it('does not re-invoke showModal on a re-render that keeps open=true', () => {
    const { rerender } = render(<Modal open onClose={noop} title="Record payment">content</Modal>);
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    rerender(<Modal open onClose={noop} title="Record payment" subtitle="updated">content</Modal>);
    expect(showModalSpy).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on a click inside the dialog content', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Record payment">
      <button type="button">Inner button</button>
    </Modal>);

    fireEvent.click(screen.getByText('Inner button'));
    expect(onClose).not.toHaveBeenCalled();

    // A click whose event.target is the <dialog> itself (not a descendant) is the
    // backdrop, since the dialog element's padding/backdrop area has no other element.
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
