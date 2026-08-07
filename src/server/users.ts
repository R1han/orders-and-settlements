import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { ValidationError } from '@/domain/errors';
import { isDuplicateKey, users, type UserDoc } from './db';

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

export async function registerUser(email: string, password: string): Promise<ObjectId> {
  const parsed = Credentials.safeParse({ email, password });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0].message, {
      field: String(parsed.error.issues[0].path[0]),
    });
  }

  const _id = new ObjectId();
  try {
    await (await users()).insertOne({
      _id,
      email: parsed.data.email,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      createdAt: new Date(),
    });
  } catch (error) {
    if (isDuplicateKey(error, 'email_unique')) {
      throw new ValidationError('An account with that email already exists.', { field: 'email' });
    }
    throw error;
  }
  return _id;
}

// A syntactically valid bcrypt hash (exactly 60 chars) with no known plaintext.
// bcryptjs's compare() short-circuits to `false` without hashing when the target
// string isn't 60 chars, so a malformed placeholder here would skip the bcrypt
// computation entirely and defeat the timing-safety this exists for.
const DUMMY_HASH = '$2b$10$NXeVrTIzZAbBe4vD9VQyCe90WTno4.WN0kZieBV9Du3Gk10yNq5J.';

export async function verifyCredentials(email: string, password: string): Promise<UserDoc | null> {
  const normalised = String(email).trim().toLowerCase();
  const user = await (await users()).findOne({ email: normalised });
  // Hash even when no user exists so response time does not reveal registration.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const matches = await bcrypt.compare(String(password), hash);
  return user && matches ? user : null;
}
