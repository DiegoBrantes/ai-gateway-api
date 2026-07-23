import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env';
import type { Cache } from '../cache';
import { RateLimitError } from '../utils/errors';

/**
 * Fixed-window rate limiter keyed by caller identity, backed by the
 * shared cache (so limits hold across instances when Redis is used).
 * Emits standard `X-RateLimit-*` headers on every response.
 */
export function createRateLimiter(cache: Cache) {
  const windowSeconds = Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000);

  return async function rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const identity = request.principal ?? request.ip;
    const key = `ratelimit:${identity}`;
    const count = await cache.increment(key, windowSeconds);
    const remaining = Math.max(0, env.RATE_LIMIT_MAX - count);

    reply.header('X-RateLimit-Limit', env.RATE_LIMIT_MAX);
    reply.header('X-RateLimit-Remaining', remaining);

    if (count > env.RATE_LIMIT_MAX) {
      const retryAfterMs = await cache.pttl(key);
      const retryAfterSec = Math.ceil(Math.max(retryAfterMs, 0) / 1000);
      reply.header('Retry-After', retryAfterSec);
      throw new RateLimitError(retryAfterMs);
    }
  };
}
