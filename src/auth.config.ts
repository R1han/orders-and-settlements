import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe. No providers here: Credentials pulls in verifyCredentials, which
 * imports bcryptjs and the mongodb driver — both unsupported on the Edge
 * runtime. Middleware only ever decodes the session cookie via these
 * callbacks, so it never needs the provider at all. Route handlers and server
 * components (which do need the provider) run on Node and import auth.ts,
 * which spreads this config and adds it back.
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Empty, not omitted: NextAuthConfig requires the field, and middleware never
  // calls authorize() anyway — authorized() below only reads the JWT cookie.
  providers: [],
  // Required once NODE_ENV is production (i.e. any `next start`, including this
  // app's Vercel deployment): Auth.js refuses to trust the request's Host header
  // by default and every route — including the ones that only decode the session
  // cookie — throws UntrustedHost instead of authenticating. Unrelated to the
  // provider split above; this was already reachable before it.
  trustHost: true,
  callbacks: {
    // Without this, `auth` used as middleware never redirects: the library's
    // default `authorized` result is `true` regardless of session state, so an
    // unauthenticated request would fall through to the page instead of /login.
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
