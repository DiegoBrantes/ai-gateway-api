import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../cache/memory.cache';
import { env } from '../config/env';
import { RateLimitError } from '../utils/errors';
import { createRateLimiter } from './rateLimit.middleware';

function fakeReply() {
  const headers: Record<string, unknown> = {};
  const reply = {
    header(name: string, value: unknown) {
      headers[name] = value;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, headers };
}

function fakeRequest(principal: string): FastifyRequest {
  return { principal, ip: '127.0.0.1' } as unknown as FastifyRequest;
}

describe('rate limiter', () => {
  it('allows requests under the limit and exposes RateLimit headers', async () => {
    const rateLimit = createRateLimiter(new MemoryCache());
    const { reply, headers } = fakeReply();

    await rateLimit(fakeRequest('key:alice'), reply);

    expect(headers['X-RateLimit-Limit']).toBe(env.RATE_LIMIT_MAX);
    expect(headers['X-RateLimit-Remaining']).toBe(env.RATE_LIMIT_MAX - 1);
  });

  it('throws RateLimitError once the window budget is exceeded', async () => {
    // A cache whose counter is already past the limit simulates a hot key.
    const cache = new MemoryCache();
    await cache.set('primed', true); // touch, keeps types happy
    const rateLimit = createRateLimiter({
      ...cache,
      increment: async () => env.RATE_LIMIT_MAX + 1,
      pttl: async () => 5_000,
    } as unknown as MemoryCache);

    const { reply, headers } = fakeReply();
    await expect(rateLimit(fakeRequest('key:bob'), reply)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(headers['Retry-After']).toBe(5);
  });

  it('isolates counters per caller identity', async () => {
    const cache = new MemoryCache();
    const rateLimit = createRateLimiter(cache);

    const a = fakeReply();
    const b = fakeReply();
    await rateLimit(fakeRequest('key:alice'), a.reply);
    await rateLimit(fakeRequest('key:carol'), b.reply);

    // Each identity gets its own fresh budget.
    expect(a.headers['X-RateLimit-Remaining']).toBe(env.RATE_LIMIT_MAX - 1);
    expect(b.headers['X-RateLimit-Remaining']).toBe(env.RATE_LIMIT_MAX - 1);
  });
});
