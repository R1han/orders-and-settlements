import Link from 'next/link';
import { auth, signOut } from '@/auth';
import { ToastHost } from '@/components/toast';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <ToastHost>
      <div className="min-h-screen text-body">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-8">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-[3px] border-[1.5px] border-brand">
                <span className="h-[7px] w-[7px] bg-brand" />
              </span>
              <span className="text-body font-semibold tracking-[-0.01em] text-fg">Settlements</span>
            </Link>

            <div className="flex items-center gap-4">
              <span className="text-[12.5px] text-fg-muted">{session?.user?.email}</span>
              <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
                <button type="submit" className="rounded px-2 py-1.5 text-[12.5px] text-fg-muted">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <main className="min-w-0">{children}</main>
      </div>
    </ToastHost>
  );
}
