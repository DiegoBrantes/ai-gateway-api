import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

/**
 * Single, global error handler. Maps typed AppErrors, Zod validation
 * failures and unexpected errors onto a consistent JSON envelope, and
 * makes sure 5xx internals are never leaked to the client.
 */
export function errorHandler(
  error: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;

  if (error instanceof ZodError) {
    reply
      .status(400)
      .send(body('bad_request', 'Validation failed', requestId, error.issues));
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      request.log.error({ err: error }, 'Application error');
    }
    reply
      .status(error.statusCode)
      .send(body(error.code, error.message, requestId, error.details));
    return;
  }

  // Fastify's own validation / parsing errors carry a statusCode.
  const status = (error as FastifyError).statusCode ?? 500;
  if (status < 500) {
    reply.status(status).send(body('bad_request', error.message, requestId));
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  reply
    .status(500)
    .send(body('internal_error', 'An unexpected error occurred', requestId));
}

function body(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorBody {
  return {
    error: { code, message, requestId, ...(details !== undefined ? { details } : {}) },
  };
}
