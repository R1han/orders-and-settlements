'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Orders', match: (path: string) => path === '/' || path.startsWith('/orders/') },
  { href: '/orders/new', label: 'New order', match: (path: string) => path === '/orders/new' },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link key={item.href} href={item.href}
                className={`rounded-[5px] px-2 py-[7px] text-[13px] ${
                  active ? 'bg-white/[0.09] text-white' : 'text-[#a9c0b9]'}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
