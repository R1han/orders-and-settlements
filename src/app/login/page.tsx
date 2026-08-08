import Image from 'next/image';
import { AuthForm } from './auth-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen bg-bg">
      <div className="relative hidden w-1/2 flex-none overflow-hidden bg-brand-950 lg:block">
        <div className="px-12 pt-12">
          <div className="flex items-center gap-2.5">
            <Image src="/logo/settlement-mark-onDark.svg" alt="" width={20} height={20} className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-[-0.01em] text-white">Settlements</span>
          </div>
          <p className="mt-4 max-w-[300px] text-[13.5px] leading-[1.55] text-white/60">
            Track what customers owe you, and what they&rsquo;ve settled.
          </p>
        </div>

        <div className="absolute bottom-[-2rem] left-12 right-[-3rem] top-44 overflow-hidden rounded-tl-lg border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <Image
            src="/login/dashboard-preview.png"
            alt="The orders dashboard, showing summary totals and a list of orders in different settlement states"
            fill
            className="object-cover object-left-top"
          />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <AuthForm />
      </div>
    </main>
  );
}
