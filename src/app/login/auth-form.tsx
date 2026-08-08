'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

const INPUT = 'h-[34px] w-full rounded border border-border-strong bg-surface px-2.5 text-body';
const LABEL = 'text-xs font-medium text-[#4a5552]';

export function AuthForm() {
  const router = useRouter();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));

    try {
      if (tab === 'signup') {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          setError((await response.json()).error?.message ?? 'Could not create the account.');
          return;
        }
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('That email and password do not match.');
        return;
      }
      router.push('/');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const tabClass = (on: boolean) =>
    `h-7 flex-1 rounded text-[12.5px] ${on ? 'bg-surface font-semibold text-fg shadow-[0_1px_2px_rgba(13,39,36,0.10)]' : 'text-fg-muted'}`;

  return (
    <div className="w-[352px]">
      <div className="mb-[22px] flex items-center justify-center gap-2.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-[3px] border-[1.5px] border-brand">
          <span className="h-[7px] w-[7px] bg-brand" />
        </span>
        <span className="text-sm font-semibold tracking-[-0.01em]">Settlements</span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-5 flex gap-0.5 rounded bg-[#f2f4f3] p-0.5">
          <button type="button" className={tabClass(tab === 'login')}
                  onClick={() => { setTab('login'); setError(null); }}>Log in</button>
          <button type="button" className={tabClass(tab === 'signup')}
                  onClick={() => { setTab('signup'); setError(null); }}>Sign up</button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
          {tab === 'signup' && (
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Full name</span>
              <input name="name" placeholder="Rania Haddad" className={INPUT} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Email</span>
            <input name="email" type="email" required autoComplete="email"
                   placeholder="you@company.ae" className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Password</span>
            <input name="password" type="password" required minLength={8} className={INPUT}
                   autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} />
          </label>
          {error && <p role="alert" className="text-[11.5px] text-status-overdue-fg">{error}</p>}
          <button type="submit" disabled={busy}
                  className="mt-1 h-[34px] rounded bg-brand text-[13px] font-medium text-white disabled:opacity-70">
            {busy ? 'Working…' : tab === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>
      </div>

      <p className="mt-3.5 text-center text-xs text-fg-subtle">
        {tab === 'signup' ? 'A new account starts with no orders.' : 'Sign in to manage your orders.'}
      </p>
    </div>
  );
}
