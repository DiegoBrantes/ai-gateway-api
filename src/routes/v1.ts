import type { FastifyInstance } from 'fastify';
import { ChatController } from '../controllers/chat.controller';
import { EmbeddingsController } from '../controllers/embeddings.controller';
import { MetaController } from '../controllers/meta.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import {
  chatResponseSchema,
  commonErrorResponses,
  embeddingsResponseSchema,
  modelsResponseSchema,
  providersResponseSchema,
} from '../schemas/openapi';
import type { AppServices } from '../app';

const security: Array<Record<string, string[]>> = [{ apiKey: [] }, { bearerAuth: [] }];

const messageSchema = {
  type: 'object',
  required: ['role', 'content'],
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant'] },
    content: { type: 'string' },
  },
};

const chatBodySchema = {
  type: 'object',
  required: ['messages'],
  properties: {
    provider: {
      type: 'string',
      description: 'Force a provider (openai|anthropic|gemini)',
    },
    model: { type: 'string' },
    messages: { type: 'array', minItems: 1, items: messageSchema },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    maxTokens: { type: 'integer', minimum: 1 },
  },
  examples: [
    { messages: [{ role: 'user', content: 'Explain a reverse proxy in one sentence.' }] },
  ],
};

/**
 * Versioned API surface. Every route is authenticated and rate-limited;
 * the JSON schemas double as request validation hints and as the source
 * of the generated OpenAPI document.
 */
export async function registerV1(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  const chat = new ChatController(services.gateway);
  const embeddings = new EmbeddingsController(services.gateway);
  const meta = new MetaController(services.registry, services.metrics);
  const rateLimit = createRateLimiter(services.cache);

  // Guard the whole v1 surface with auth + rate limiting.
  app.addHook('onRequest', authenticate);
  app.addHook('onRequest', rateLimit);

  app.post(
    '/chat',
    {
      schema: {
        tags: ['chat'],
        summary: 'Create a chat completion',
        security,
        body: chatBodySchema,
        response: {
          200: { description: 'Chat completion', ...chatResponseSchema },
          ...commonErrorResponses,
        },
      },
    },
    chat.chat,
  );

  app.post(
    '/chat/stream',
    {
      schema: {
        tags: ['chat'],
        summary: 'Stream a chat completion over SSE',
        description:
          'Returns `text/event-stream`. SSE is not fully expressible in OpenAPI; ' +
          'the event contract is: `provider` (chosen provider/model, sent once), ' +
          '`delta` (text chunks: `{content, provider}`), `done` ' +
          '(`{usage, cost, attempts, provider, model}`), `error` ' +
          '(`{code, message, requestId}`), then `end` with `[DONE]`. Provider ' +
          'failover happens only before the first `delta`.',
        security,
        body: chatBodySchema,
        response: { ...commonErrorResponses },
      },
    },
    chat.stream,
  );

  app.post(
    '/embeddings',
    {
      schema: {
        tags: ['embeddings'],
        summary: 'Create embeddings',
        security,
        body: {
          type: 'object',
          required: ['input'],
          properties: {
            provider: { type: 'string' },
            model: { type: 'string' },
            input: {
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            },
          },
          examples: [{ input: ['hello', 'world'] }],
        },
        response: {
          200: { description: 'Embedding vectors', ...embeddingsResponseSchema },
          ...commonErrorResponses,
        },
      },
    },
    embeddings.create,
  );

  app.get(
    '/providers',
    {
      schema: {
        tags: ['meta'],
        summary: 'List providers and their status',
        security,
        response: {
          200: { description: 'Providers', ...providersResponseSchema },
          401: commonErrorResponses[401],
        },
      },
    },
    meta.providers,
  );

  app.get(
    '/models',
    {
      schema: {
        tags: ['meta'],
        summary: 'List available models with per-model capabilities',
        security,
        response: {
          200: { description: 'Models', ...modelsResponseSchema },
          401: commonErrorResponses[401],
        },
      },
    },
    meta.models,
  );

  app.get(
    '/usage',
    {
      schema: {
        tags: ['meta'],
        summary: 'Usage & cost for the current caller',
        security,
        response: { 401: commonErrorResponses[401] },
      },
    },
    meta.usage,
  );
}
