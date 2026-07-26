import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildCache, type Cache } from './cache';
import { dashboardHtml } from './dashboard/html';
import { createDashboardGuard } from './middlewares/dashboardGuard';
import { errorHandler } from './middlewares/error.middleware';
import { securityHeaders } from './middlewares/securityHeaders';
import { buildRegistry, type ProviderRegistry } from './providers/registry';
import {
  env,
  isProduction,
  isTest,
  mockAllowed,
  swaggerUiEnabled,
} from './config/env';
import { registerAuthRoutes } from './routes/auth';
import { registerV1 } from './routes/v1';
import { openApiComponents } from './schemas/openapi';
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
          // Never let credentials reach the logs, in any environment.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
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
    // Cap request bodies to protect against oversized-payload abuse.
    bodyLimit: 1_048_576, // 1 MiB
  });

  app.setErrorHandler(errorHandler);
  // Security headers on every response (applied before routing).
  app.addHook('onRequest', securityHeaders);
  await app.register(cors, { origin: true });

  const dashboardGuard = createDashboardGuard();

  // OpenAPI spec generation (no static assets — always safe to register).
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AI Gateway API',
        description:
          'Unified, provider-agnostic gateway for OpenAI, Google Gemini and Anthropic. ' +
          'Authenticate with the `x-api-key` header or a Bearer JWT from `/auth/token`.',
        version: '1.1.0',
      },
      tags: [
        { name: 'chat', description: 'Chat completions (JSON and SSE streaming)' },
        { name: 'embeddings', description: 'Vector embeddings' },
        { name: 'meta', description: 'Providers, models, usage and health' },
        { name: 'auth', description: 'API-key ↔ JWT exchange' },
      ],
      components: openApiComponents,
    },
  });

  // The OpenAPI JSON is always available, even when the Swagger UI is disabled.
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  // Swagger UI serves static assets; mount it only when enabled (default: on in
  // dev, off in production) to keep that surface off production by default.
  if (swaggerUiEnabled) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // ── Liveness (always public) ────────────────────────────────────
  app.get(
    '/health',
    { schema: { tags: ['meta'], summary: 'Liveness probe' } },
    async () => ({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );

  // ── Readiness (config + dependencies) ───────────────────────────
  app.get(
    '/ready',
    { schema: { tags: ['meta'], summary: 'Readiness probe' } },
    async (_request, reply) => {
      const realConfigured = registry
        .all()
        .some((provider) => !provider.isMock && provider.isConfigured());
      const mockPresent = registry.get('mock') !== undefined;
      const canServe = realConfigured || mockPresent;
      const cacheOk = await cache.healthy();

      const checks = {
        providers: realConfigured ? 'ok' : mockPresent ? 'mock-only' : 'none',
        cache: cacheOk ? 'ok' : 'down',
        mock: mockAllowed ? 'enabled' : 'disabled',
      };
      const status = !canServe ? 'not_ready' : cacheOk ? 'ready' : 'degraded';
      reply.status(status === 'not_ready' ? 503 : 200).send({ status, checks });
    },
  );

  // ── Operational surface (guarded unless DASHBOARD_PUBLIC) ───────
  app.get(
    '/metrics/summary',
    { schema: { tags: ['meta'], summary: 'Global usage summary' }, onRequest: dashboardGuard },
    async () => metrics.summary(),
  );

  app.get(
    '/dashboard',
    { schema: { hide: true }, onRequest: dashboardGuard },
    async (_request, reply) => {
      reply.type('text/html').send(dashboardHtml);
    },
  );

  app.get('/', { schema: { hide: true } }, async (_request, reply) => {
    reply.send({
      name: 'ai-gateway-api',
      openapi: '/openapi.json',
      docs: swaggerUiEnabled ? '/docs' : null,
      dashboard: '/dashboard',
      health: '/health',
      ready: '/ready',
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
