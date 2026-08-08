import { auth, signOut } from '@/auth';
import { ToastHost } from '@/components/toast';
import { SidebarNav } from './sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <ToastHost>
      <div className="flex min-h-screen text-body">
        <aside className="flex w-[216px] flex-none flex-col bg-brand-950 px-3 pb-3.5 pt-[18px] text-[#cddbd6]">
          <div className="flex items-center gap-2.5 px-2 pb-5">
            <span className="flex h-5 w-5 items-center justify-center rounded-[3px] border-[1.5px] border-[#4f9c81]">
              <span className="h-[7px] w-[7px] bg-[#4f9c81]" />
            </span>
            <span className="text-body font-semibold tracking-[-0.01em] text-white">Settlements</span>
          </div>

          <SidebarNav />

          <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.09] pt-4">
            <div className="px-2 pb-0.5 pt-1.5 text-[12.5px] text-white">{session?.user?.email}</div>
            <div className="px-2 pb-2 text-[11.5px] text-[#7d9a92]">Finance operations</div>
            <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
              <button type="submit" className="w-full rounded px-2 py-1.5 text-left text-[12.5px] text-[#9db5ae]">
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </ToastHost>
  );
}
