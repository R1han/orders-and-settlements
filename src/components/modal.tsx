'use client';

import { useEffect, useRef } from 'react';

export function Modal({ open, onClose, title, subtitle, children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // <dialog> gives focus trapping, Escape handling and inertness for free —
  // all of which a div-with-fixed-inset would have to reimplement badly.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
      className="w-[420px] rounded-[10px] p-0 shadow-[0_16px_48px_rgba(13,39,36,0.22)] backdrop:bg-[rgba(13,39,36,0.34)]"
    >
      <div className="px-5 pt-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="mt-[3px] text-[12.5px] text-fg-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="p-0.5 leading-none text-fg-subtle">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}
