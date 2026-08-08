export { auth as middleware } from '@/auth';

export const runtime = 'nodejs';

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
