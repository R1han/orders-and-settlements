import { describe, it, expect } from 'vitest';
import { setupTestDb } from './helpers';
import { registerUser, verifyCredentials } from '@/server/users';
import { ValidationError } from '@/domain/errors';

setupTestDb();

describe('registerUser', () => {
  it('creates a user and never stores the password', async () => {
    const id = await registerUser('Alice@Example.com ', 'correct horse battery');
    const { users } = await import('@/server/db');
    const doc = await (await users()).findOne({ _id: id });
    expect(doc?.email).toBe('alice@example.com'); // lowercased and trimmed
    expect(doc?.passwordHash).not.toContain('correct horse battery');
    expect(doc?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await registerUser('a@b.com', 'password123');
    await expect(registerUser('A@B.COM', 'password123')).rejects.toThrow(ValidationError);
  });

  it('rejects a short password', async () => {
    await expect(registerUser('c@d.com', 'short')).rejects.toThrow(ValidationError);
  });

  it('rejects a malformed email', async () => {
    await expect(registerUser('not-an-email', 'password123')).rejects.toThrow(ValidationError);
  });
});

describe('verifyCredentials', () => {
  it('returns the user for a correct password', async () => {
    await registerUser('e@f.com', 'password123');
    expect(await verifyCredentials('e@f.com', 'password123')).not.toBeNull();
  });

  it('returns null for a wrong password and for an unknown email', async () => {
    await registerUser('g@h.com', 'password123');
    expect(await verifyCredentials('g@h.com', 'wrong-password')).toBeNull();
    expect(await verifyCredentials('nobody@nowhere.com', 'password123')).toBeNull();
  });

  // Not in the brief. verifyCredentials must hash even for an unknown email so
  // response timing cannot disclose whether an account exists. That property
  // only holds if the dummy hash bcrypt compares against actually runs bcrypt's
  // work loop rather than short-circuiting. It caught a real bug: the brief's
  // own placeholder hash was 67 characters, and bcryptjs's compare() returns
  // `false` immediately (no hashing) whenever the target string isn't exactly
  // 60 characters — silently defeating the timing-safety this code exists for.
  // Mutation: revert src/server/users.ts's DUMMY_HASH to the brief's original
  // '$2a$10$invalidinvalid...' (67 chars) and this test fails, because the
  // unknown-email path returns in ~0ms instead of doing real bcrypt work.
  it('spends real bcrypt work on an unknown email, not a length-mismatch shortcut', async () => {
    await registerUser('timing@example.com', 'password123');

    const knownStart = performance.now();
    await verifyCredentials('timing@example.com', 'wrong-password');
    const knownElapsed = performance.now() - knownStart;

    const unknownStart = performance.now();
    await verifyCredentials('nobody-at-all@example.com', 'wrong-password');
    const unknownElapsed = performance.now() - unknownStart;

    // A real bcrypt compare at cost factor 10 takes tens of milliseconds. A
    // short-circuited compare (malformed dummy hash) returns in well under 1ms.
    // 5ms is comfortably above short-circuit noise and comfortably below a real
    // bcrypt round, so this is not a hardware-speed race.
    expect(unknownElapsed).toBeGreaterThan(5);
    // The unknown-email path should cost roughly the same as the known-email
    // path (same bcrypt work), not be orders of magnitude faster.
    expect(unknownElapsed).toBeGreaterThan(knownElapsed / 5);
  });

  // Not in the brief. registerUser normalises email before storing (the brief's
  // first test proves that), but verifyCredentials must independently normalise
  // on lookup too — otherwise a user who typed their email in mixed case at
  // registration could never log back in with different casing/whitespace.
  // Mutation: change verifyCredentials's `normalised` computation to use the
  // raw `email` argument instead of `.trim().toLowerCase()`, and this test
  // fails because the findOne lookup misses the stored lowercase document.
  it('finds a user at login regardless of the casing/whitespace used to register', async () => {
    await registerUser('Alice@Example.com ', 'correct horse battery');
    const found = await verifyCredentials('  ALICE@EXAMPLE.COM  ', 'correct horse battery');
    expect(found).not.toBeNull();
    expect(found?.email).toBe('alice@example.com');
  });
});
