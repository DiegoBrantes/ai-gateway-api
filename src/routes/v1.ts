import type { FastifyInstance } from 'fastify';
import { ChatController } from '../controllers/chat.controller';
import { EmbeddingsController } from '../controllers/embeddings.controller';
import { MetaController } from '../controllers/meta.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { createRateLimiter } from '../middlewares/rateLimit.middleware';
import type { AppServices } from '../app';

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
        security: [{ apiKey: [] }],
        body: chatBodySchema,
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
          'Returns `text/event-stream`. Events: `delta` (text chunks), `done` (usage), `end`.',
        security: [{ apiKey: [] }],
        body: chatBodySchema,
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
        security: [{ apiKey: [] }],
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
        security: [{ apiKey: [] }],
      },
    },
    meta.providers,
  );

  app.get(
    '/models',
    {
      schema: {
        tags: ['meta'],
        summary: 'List available models',
        security: [{ apiKey: [] }],
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
        security: [{ apiKey: [] }],
      },
    },
    meta.usage,
  );
}
