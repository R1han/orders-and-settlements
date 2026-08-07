import { describe, it, expect, vi, afterEach } from 'vitest';
import { ValidationError } from '@/domain/errors';
import { fail, ok } from './respond';

describe('ok', () => {
  it('wraps the body in a 200 JSON response by default', async () => {
    const res = ok({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('accepts a custom status', async () => {
    const res = ok({ id: '1' }, 201);
    expect(res.status).toBe(201);
  });
});

describe('fail', () => {
  it('maps a DomainError to its own code, message, details, and httpStatus', async () => {
    const res = fail(new ValidationError('Enter a valid email address.', { field: 'email' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Enter a valid email address.',
        details: { field: 'email' },
      },
    });
  });

  // Not in the brief. fail() is the single place a DomainError becomes an HTTP
  // response, and every later route depends on that being true for all errors,
  // not just the ones the author anticipated. An unexpected error (a thrown
  // TypeError, a driver error, anything not a DomainError) must not leak its
  // message or stack into the response body — that's an internals leak to the
  // client, and the sole reason fail() has a generic catch-all branch at all.
  // Mutation: change fail()'s catch-all NextResponse.json body to interpolate
  // `error instanceof Error ? error.message : String(error)` in place of the
  // fixed 'Something went wrong.' string, and this test fails because the
  // response body then contains 'sensitive internal detail: db password xyz'.
  it('maps a non-DomainError to a generic 500 without leaking its message', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fail(new Error('sensitive internal detail: db password xyz'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} },
    });
    expect(JSON.stringify(body)).not.toContain('sensitive internal detail');
    consoleError.mockRestore();
  });

  it('maps a thrown non-Error value to the same generic 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fail('a bare string throw, not even an Error');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} },
    });
    consoleError.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
