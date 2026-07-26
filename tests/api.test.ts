import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Cache } from '../src/cache';
import { MemoryCache } from '../src/cache/memory.cache';
import { ProviderRegistry } from '../src/providers/registry';
import { MockProvider } from '../src/providers/mock';
import { GatewayService } from '../src/services/gateway.service';
import { MetricsService } from '../src/services/metrics.service';

const downCache: Cache = {
  get: async () => null,
  set: async () => {},
  increment: async () => 1,
  pttl: async () => -1,
  healthy: async () => false,
  close: async () => {},
};

async function appWith(registry: ProviderRegistry, cache: Cache): Promise<FastifyInstance> {
  const metrics = new MetricsService();
  const gateway = new GatewayService({ registry, cache, metrics });
  const app = await buildApp({ services: { registry, cache, metrics, gateway } });
  await app.ready();
  return app;
}

/**
 * End-to-end HTTP tests using Fastify's inject (no real network). With
 * no provider credentials configured, the gateway transparently uses the
 * built-in mock provider, so the full request pipeline is exercised.
 */
describe('AI Gateway HTTP API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public and returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('applies security headers to every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('rejects unauthenticated requests to the API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('returns a chat completion for an authenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-api-key': 'test-key' },
      payload: { messages: [{ role: 'user', content: 'hello there' }] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toContain('resposta simulada');
    expect(body.usage.totalTokens).toBeGreaterThan(0);
    expect(body.cost).toHaveProperty('totalCost');
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('validates the request body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { 'x-api-key': 'test-key' },
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });

  it('creates embeddings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { 'x-api-key': 'test-key' },
      payload: { input: ['hello', 'world'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().embeddings).toHaveLength(2);
  });

  it('lists providers with their configuration status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/providers',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().providers.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini']));
  });

  it('issues a JWT for a valid API key and accepts it as a bearer token', async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { apiKey: 'test-key' },
    });
    expect(tokenRes.statusCode).toBe(200);
    const { token, tokenType } = tokenRes.json();
    expect(tokenType).toBe('Bearer');
    expect(typeof token).toBe('string');

    // The freshly minted token authenticates a real API call.
    const chatRes = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: 'user', content: 'hi via jwt' }] },
    });
    expect(chatRes.statusCode).toBe(200);
  });

  it('rejects a token request with an unknown API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { apiKey: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('streams a chat completion over SSE with a provider event first', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { 'x-api-key': 'test-key' },
      payload: { messages: [{ role: 'user', content: 'stream this' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('event: provider');
    expect(res.payload).toContain('event: delta');
    expect(res.payload).toContain('event: done');
    expect(res.payload).toContain('event: end');
  });

  it('reports per-model capabilities (embedding models are not "chat")', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { 'x-api-key': 'test-key' },
    });
    const models = res.json().models as Array<{ id: string; capabilities: string[] }>;
    const embed = models.find((m) => m.id === 'text-embedding-3-small');
    const chat = models.find((m) => m.id === 'gpt-4o');
    expect(embed?.capabilities).toEqual(['embeddings']);
    expect(chat?.capabilities).toEqual(['chat', 'stream']);
    // No model advertises the (unimplemented) vision capability.
    expect(models.every((m) => !m.capabilities.includes('vision'))).toBe(true);
  });

  it('flags the mock provider in the providers listing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/providers',
      headers: { 'x-api-key': 'test-key' },
    });
    const providers = res.json().providers as Array<{ name: string; mock: boolean }>;
    expect(providers.find((p) => p.name === 'mock')?.mock).toBe(true);
    expect(providers.find((p) => p.name === 'openai')?.mock).toBe(false);
  });

  it('reports readiness with dependency checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toMatchObject({ cache: 'ok' });
  });

  it('serves a valid OpenAPI document at /openapi.json with expected paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    for (const path of ['/v1/chat', '/v1/chat/stream', '/v1/embeddings', '/v1/models']) {
      expect(spec.paths).toHaveProperty(path);
    }
    // Authenticated routes declare a security requirement.
    expect(spec.paths['/v1/chat'].post.security).toBeDefined();
    // Reusable security schemes are documented.
    expect(Object.keys(spec.components.securitySchemes)).toEqual(
      expect.arrayContaining(['apiKey', 'bearerAuth']),
    );
  });

  it('exposes metrics publicly in the test environment (DASHBOARD_PUBLIC default)', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().inMemory).toBe(true);
  });
});

describe('readiness edge cases', () => {
  it('reports degraded (200) when the cache is down but a provider can serve', async () => {
    const registry = new ProviderRegistry([new MockProvider()]);
    const app = await appWith(registry, downCache);
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', checks: { cache: 'down' } });
    await app.close();
  });

  it('reports not_ready (503) when no provider can serve', async () => {
    const registry = new ProviderRegistry([]); // no real providers, no mock
    const app = await appWith(registry, new MemoryCache());
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'not_ready', checks: { providers: 'none' } });
    await app.close();
  });
});
