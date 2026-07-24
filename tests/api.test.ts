import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

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

  it('streams a chat completion over SSE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/stream',
      headers: { 'x-api-key': 'test-key' },
      payload: { messages: [{ role: 'user', content: 'stream this' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.payload).toContain('event: delta');
    expect(res.payload).toContain('event: done');
  });
});
