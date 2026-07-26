import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { signToken } from '../auth/jwt';
import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';
import { createDashboardGuard } from './dashboardGuard';

const reply = {} as FastifyReply;
function req(headers: Record<string, string> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('dashboard guard', () => {
  it('allows everyone when public (dev default)', async () => {
    const guard = createDashboardGuard(true);
    await expect(guard(req(), reply)).resolves.toBeUndefined();
  });

  it('rejects anonymous access when protected', async () => {
    const guard = createDashboardGuard(false);
    await expect(guard(req(), reply)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('accepts a valid API key when protected', async () => {
    const guard = createDashboardGuard(false);
    // vitest.config sets API_KEYS=test-key
    await expect(
      guard(req({ 'x-api-key': env.API_KEYS[0]! }), reply),
    ).resolves.toBeUndefined();
  });

  it('rejects an invalid API key when protected', async () => {
    const guard = createDashboardGuard(false);
    await expect(guard(req({ 'x-api-key': 'wrong' }), reply)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('accepts a valid Bearer JWT when protected', async () => {
    const guard = createDashboardGuard(false);
    const token = signToken({ sub: 'admin' });
    await expect(
      guard(req({ authorization: `Bearer ${token}` }), reply),
    ).resolves.toBeUndefined();
  });
});
