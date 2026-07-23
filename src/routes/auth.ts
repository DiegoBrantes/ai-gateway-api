import type { FastifyInstance } from 'fastify';
import { signToken } from '../auth/jwt';
import { env } from '../config/env';
import { UnauthorizedError } from '../utils/errors';

/**
 * Exchanges a valid API key for a short-lived JWT. This demonstrates the
 * second supported auth scheme end to end: clients that prefer bearer
 * tokens can mint one here and then call the API with `Authorization`.
 */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/token',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange an API key for a JWT',
        body: {
          type: 'object',
          required: ['apiKey'],
          properties: { apiKey: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { apiKey } = request.body as { apiKey: string };
      if (!env.API_KEYS.includes(apiKey)) {
        throw new UnauthorizedError('Unknown API key');
      }
      const token = signToken({ sub: `key:${apiKey.slice(0, 2)}…`, scope: ['chat'] });
      reply.send({ tokenType: 'Bearer', expiresIn: env.JWT_EXPIRES_IN, token });
    },
  );
}
