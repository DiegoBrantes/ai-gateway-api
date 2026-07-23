import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildCache, type Cache } from './cache';
import { dashboardHtml } from './dashboard/html';
import { errorHandler } from './middlewares/error.middleware';
import { buildRegistry, type ProviderRegistry } from './providers/registry';
import { env, isProduction, isTest } from './config/env';
import { registerAuthRoutes } from './routes/auth';
import { registerV1 } from './routes/v1';
import { GatewayService } from './services/gateway.service';
import { MetricsService } from './services/metrics.service';

/** Everything the route layer needs, wired once and passed down (poor-man's DI). */
export interface AppServices {
  registry: ProviderRegistry;
  cache: Cache;
  metrics: MetricsService;
  gateway: GatewayService;
}

export interface BuildAppOptions {
  services?: Partial<AppServices>;
}

/**
 * Compose the application: build the service graph, register cross-cutting
 * plugins (CORS, OpenAPI), mount routes and install the global error handler.
 * Accepts service overrides so tests can inject fakes.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const registry = options.services?.registry ?? buildRegistry();
  const cache = options.services?.cache ?? buildCache();
  const metrics = options.services?.metrics ?? new MetricsService();
  const gateway =
    options.services?.gateway ?? new GatewayService({ registry, cache, metrics });
  const services: AppServices = { registry, cache, metrics, gateway };

  const app = Fastify({
    // Pretty logs in dev, structured JSON in prod, silent under test — the
    // same policy the bootstrap logger uses, so output stays consistent.
    logger: isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          ...(isProduction
            ? {}
            : {
                transport: {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss',
                    ignore: 'pid,hostname',
                  },
                },
              }),
        },
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
  });

  app.setErrorHandler(errorHandler);
  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AI Gateway API',
        description:
          'Unified, provider-agnostic gateway for OpenAI, Google Gemini and Anthropic.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // ── Public endpoints (no auth) ──────────────────────────────────
  app.get(
    '/health',
    { schema: { tags: ['meta'], summary: 'Liveness probe' } },
    async () => ({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    '/metrics/summary',
    { schema: { tags: ['meta'], summary: 'Global usage summary' } },
    async () => metrics.summary(),
  );

  app.get('/dashboard', { schema: { hide: true } }, async (_request, reply) => {
    reply.type('text/html').send(dashboardHtml);
  });

  app.get('/', { schema: { hide: true } }, async (_request, reply) => {
    reply.send({
      name: 'ai-gateway-api',
      docs: '/docs',
      dashboard: '/dashboard',
      health: '/health',
    });
  });

  // Token issuance (exchanges a valid API key for a short-lived JWT).
  await registerAuthRoutes(app);

  // ── Versioned, authenticated API ────────────────────────────────
  await app.register(async (instance) => registerV1(instance, services), {
    prefix: '/v1',
  });

  app.addHook('onClose', async () => {
    await cache.close();
  });

  return app;
}
