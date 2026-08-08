import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Edge-safe: authConfig carries no providers, so this never pulls in bcryptjs
// or the mongodb driver and can run on the default Edge runtime.
const { auth } = NextAuth(authConfig);
export { auth as middleware };

// Everything under public/ is, by definition, public — and Next's generated
// icon routes (icon.png, apple-icon.png) are just as public as the favicon.
// Rather than name each asset (which silently breaks again the next time
// someone adds one — see /logo/*), exclude any path whose *last* segment is
// a bare filename ending in a static-asset extension. That's narrow on
// purpose: it only matches a single path segment with no further slashes,
// so it can never accidentally cover a route param that merely looks like a
// filename — e.g. /orders/x.png still has two segments ("orders", "x.png")
// and still requires auth, because [^/]+ can't cross the "/" to swallow
// "orders/" too. If a future public asset needs a nested path of its own
// (like /logo/*), add its top-level directory name here explicitly.
export const config = {
  matcher: [
    '/((?!api|login|_next/static|_next/image|logo/|[^/]+\\.(?:ico|png|jpg|jpeg|svg|gif|webp|css|js|txt|xml|woff2?)$).*)',
  ],
};
