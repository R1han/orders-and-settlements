import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { verifyCredentials } from '@/server/users';
import { authConfig } from './auth.config';

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const user = await verifyCredentials(String(raw?.email ?? ''), String(raw?.password ?? ''));
        return user ? { id: user._id.toHexString(), email: user.email } : null;
      },
    }),
  ],
});
