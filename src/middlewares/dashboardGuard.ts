import type { FastifyReply, FastifyRequest } from 'fastify';
import { matchesAdminKey, matchesAnyKey } from '../auth/apiKeys';
import { verifyToken } from '../auth/jwt';
import { dashboardPublic, env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';

/**
 * Access policy for the operational surface (`/dashboard`, `/metrics/summary`).
 * These expose aggregate usage and cost, so they must not be world-readable in
 * production. Behaviour is driven by `DASHBOARD_PUBLIC` (default: public in
 * dev/test, protected in production). When protected, a caller must present a
 * valid API key, the dedicated `ADMIN_API_KEY`, or a valid JWT.
 *
 * A factory (rather than a bare hook) so the public/protected decision can be
 * injected in tests.
 */
export function createDashboardGuard(isPublic: boolean = dashboardPublic) {
  return async function dashboardGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (isPublic) return;

    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string') {
      if (matchesAdminKey(apiKey, env.ADMIN_API_KEY)) return;
      if (matchesAnyKey(apiKey, env.API_KEYS)) return;
    }

    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ') && verifyToken(auth.slice(7))) return;

    throw new UnauthorizedError(
      'The dashboard and metrics are protected. Provide a valid `x-api-key` ' +
        '(or `ADMIN_API_KEY`) or `Authorization: Bearer <token>`.',
    );
  };
}
