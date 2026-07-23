import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { verifyToken } from '../auth/jwt';
import { UnauthorizedError } from '../utils/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** Identity of the caller, used for rate limiting and usage attribution. */
    principal?: string;
  }
}

/**
 * Authentication guard. Accepts either an `x-api-key` header matching a
 * configured key, or a `Bearer <jwt>` signed with JWT_SECRET. The
 * resolved identity is attached to the request as `principal`.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && env.API_KEYS.includes(apiKey)) {
    request.principal = `key:${maskKey(apiKey)}`;
    return;
  }

  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const payload = verifyToken(auth.slice(7));
    if (payload) {
      request.principal = `jwt:${payload.sub}`;
      return;
    }
  }

  throw new UnauthorizedError(
    'Provide a valid `x-api-key` header or `Authorization: Bearer <token>`',
  );
}

function maskKey(key: string): string {
  return key.length <= 4 ? '****' : `${key.slice(0, 2)}…${key.slice(-2)}`;
}
