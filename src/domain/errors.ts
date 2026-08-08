export class DomainError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(code: string, httpStatus: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor() {
    super('UNAUTHENTICATED', 401, 'Sign in to continue.');
  }
}

/** Also returned when a document belongs to another user — existence is itself a leak. */
export class NotFoundError extends DomainError {
  constructor(what = 'Resource') {
    super('NOT_FOUND', 404, `${what} not found.`);
  }
}

export class OrderLockedError extends DomainError {
  constructor(entryCount: number) {
    super('ORDER_LOCKED', 409,
      `This order has ${entryCount} settlement ${entryCount === 1 ? 'entry' : 'entries'} recorded and can no longer be changed.`,
      { entryCount });
  }
}

export class OverpaymentError extends DomainError {
  constructor(details: Record<string, unknown>) {
    super('OVERPAYMENT', 409, 'Payment exceeds the amount due on this order.', details);
  }
}

export class ExcessRefundError extends DomainError {
  constructor(details: Record<string, unknown>) {
    super('EXCESS_REFUND', 409, 'Refund exceeds the amount paid on this order.', details);
  }
}

export class ConcurrencyError extends DomainError {
  constructor() {
    super('CONCURRENT_UPDATE', 409, 'This order is being updated by another request. Try again.');
  }
}
