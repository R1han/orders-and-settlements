import type { Metadata } from 'next';
import { Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Not --font-sans / --font-mono: those are Tailwind v4's own theme variable names,
// and reusing them here would make the loader and the theme fight over one variable.
const sans = Public_Sans({ subsets: ['latin'], variable: '--font-public-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

export const metadata: Metadata = { title: 'Orders & Settlements' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
