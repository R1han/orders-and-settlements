'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface Toast { kind: 'ok' | 'error'; title: string; body: string }

const ToastContext = createContext<(toast: Toast) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((next: Toast) => setToast(next), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(timer);
  }, [toast]);

  const isError = toast?.kind === 'error';

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-[60]">
          <div className={`flex w-[360px] items-start gap-2.5 rounded-lg border bg-surface p-[12px_13px] shadow-[0_8px_24px_rgba(13,39,36,0.14)] ${
            isError ? 'border-[#f0cdc9] border-l-[3px] border-l-status-overdue-dot' : 'border-border border-l-[3px] border-l-status-paid-dot'}`}>
            <div className={`mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full ${
              isError ? 'bg-status-overdue-bg text-status-overdue-fg' : 'bg-status-paid-bg text-status-paid-fg'}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d={isError ? 'M12 7v6M12 17h.01' : 'M20 6L9 17l-5-5'} />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{toast.title}</div>
              <div className="mt-px text-[12.5px] text-fg-muted">{toast.body}</div>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss"
                    className="ml-1.5 flex-none p-0.5 leading-none text-fg-subtle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
