import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/errors';

export function ok<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** The single place a domain error becomes an HTTP response. */
export function fail(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.httpStatus },
    );
  }
  console.error('Unhandled error', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: {} } },
    { status: 500 },
  );
}
