import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// Edge-safe: authConfig carries no providers, so this never pulls in bcryptjs
// or the mongodb driver and can run on the default Edge runtime.
const { auth } = NextAuth(authConfig);
export { auth as middleware };

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
