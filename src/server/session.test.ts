import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import type { Session } from 'next-auth';
import { UnauthenticatedError } from '@/domain/errors';

// requireUserId gates every route from Task 8 onward, so its three branches —
// no session, a session missing user.id, and a valid session — need direct
// coverage rather than relying on it working incidentally through other tests.
//
// Typed and constructed directly (not via vi.mocked(auth)) because next-auth's
// `auth` export is an intersection of several call signatures (session lookup,
// middleware wrapping, route handler wrapping). vi.mocked() picks the last
// overload for typing purposes, which is the middleware-wrapping one — so
// `mockResolvedValue(null)` fails to type-check against the real export. A
// plain typed mock sidesteps that entirely.
const mockAuth = vi.fn<() => Promise<Session | null>>();
vi.mock('@/auth', () => ({ auth: mockAuth }));

describe('requireUserId', () => {
  afterEach(() => {
    mockAuth.mockReset();
  });

  it('throws UnauthenticatedError when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);
    const { requireUserId } = await import('./session');
    await expect(requireUserId()).rejects.toThrow(UnauthenticatedError);
  });

  it('throws UnauthenticatedError when the session has no user.id', async () => {
    mockAuth.mockResolvedValue({ user: {}, expires: '2099-01-01' });
    const { requireUserId } = await import('./session');
    await expect(requireUserId()).rejects.toThrow(UnauthenticatedError);
  });

  it('returns an ObjectId matching a valid session user.id', async () => {
    const id = new ObjectId();
    mockAuth.mockResolvedValue({ user: { id: id.toHexString() }, expires: '2099-01-01' });
    const { requireUserId } = await import('./session');
    const result = await requireUserId();
    expect(result).toBeInstanceOf(ObjectId);
    expect(result.equals(id)).toBe(true);
  });
});
