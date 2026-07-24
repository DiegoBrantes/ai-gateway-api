import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProduction } from '../config/env';

/**
 * Conservative security headers applied to every response (OWASP Secure
 * Headers). We deliberately avoid a strict `Content-Security-Policy`
 * because the self-contained dashboard uses inline styles/scripts; the
 * headers below harden the API surface without breaking that page.
 */
export async function securityHeaders(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-DNS-Prefetch-Control', 'off');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Only advertise HSTS when actually served over TLS (production).
  if (isProduction) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
