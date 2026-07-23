/**
 * Typed application errors. Everything the gateway throws on purpose
 * extends AppError, which carries an HTTP status and a stable machine
 * code so the global error handler can serialise a consistent body.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid credentials') {
    super(401, 'unauthorized', message);
  }
}

export class RateLimitError extends AppError {
  constructor(public readonly retryAfterMs: number) {
    super(429, 'rate_limited', 'Rate limit exceeded');
  }
}

export class ProviderError extends AppError {
  constructor(
    public readonly provider: string,
    message: string,
    statusCode = 502,
    details?: unknown,
  ) {
    super(statusCode, 'provider_error', message, details);
  }
}

/** Raised when the whole fallback chain has been exhausted. */
export class AllProvidersFailedError extends AppError {
  constructor(
    public readonly attempts: string[],
    details?: unknown,
  ) {
    super(
      502,
      'all_providers_failed',
      `All providers failed: ${attempts.join(' → ')}`,
      details,
    );
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'not_found', message);
  }
}
