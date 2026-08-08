import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verifyCredentials } from '@/server/users';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const user = await verifyCredentials(String(raw?.email ?? ''), String(raw?.password ?? ''));
        return user ? { id: user._id.toHexString(), email: user.email } : null;
      },
    }),
  ],
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
});
