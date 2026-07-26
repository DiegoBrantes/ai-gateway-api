/**
 * Reusable JSON schemas for the OpenAPI document and Fastify's response
 * serialization. Keeping them here (rather than inline per route) makes the
 * generated `/openapi.json` consistent and lets routes document their success
 * and error shapes with a single import.
 */

export const openApiComponents = {
  securitySchemes: {
    apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
} as const;

/** Standard error envelope emitted by the global error handler. */
export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'bad_request' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: {},
      },
      required: ['code', 'message', 'requestId'],
    },
  },
} as const;

const usageSchema = {
  type: 'object',
  properties: {
    promptTokens: { type: 'integer' },
    completionTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
  },
} as const;

const costSchema = {
  type: 'object',
  description:
    'Estimated cost for observability (not an invoice). `pricingKnown:false` ' +
    'means the model has no pricing entry, so the numeric costs are null.',
  properties: {
    currency: { type: 'string', example: 'USD' },
    promptCost: { type: ['number', 'null'] },
    completionCost: { type: ['number', 'null'] },
    totalCost: { type: ['number', 'null'] },
    costMicros: { type: ['integer', 'null'] },
    pricingKnown: { type: 'boolean' },
  },
} as const;

export const chatResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string', example: 'openai' },
    model: { type: 'string', example: 'gpt-4o-mini' },
    content: { type: 'string' },
    usage: usageSchema,
    cost: costSchema,
    attempts: { type: 'array', items: { type: 'string' } },
    latencyMs: { type: 'integer' },
  },
} as const;

export const embeddingsResponseSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string' },
    model: { type: 'string' },
    embeddings: {
      type: 'array',
      items: { type: 'array', items: { type: 'number' } },
    },
    usage: {
      type: 'object',
      properties: {
        promptTokens: { type: 'integer' },
        totalTokens: { type: 'integer' },
      },
    },
    cost: costSchema,
  },
} as const;

export const providersResponseSchema = {
  type: 'object',
  properties: {
    providers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          configured: { type: 'boolean' },
          mock: { type: 'boolean' },
          models: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export const modelsResponseSchema = {
  type: 'object',
  properties: {
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          provider: { type: 'string' },
          capabilities: {
            type: 'array',
            items: { type: 'string', enum: ['chat', 'stream', 'embeddings'] },
          },
        },
      },
    },
  },
} as const;

/** Common error responses attached to authenticated routes. */
export const commonErrorResponses = {
  400: { description: 'Validation failed', ...errorResponseSchema },
  401: { description: 'Missing or invalid credentials', ...errorResponseSchema },
  429: { description: 'Rate limit exceeded', ...errorResponseSchema },
  502: { description: 'All providers failed', ...errorResponseSchema },
  503: { description: 'No provider can handle the request', ...errorResponseSchema },
} as const;
