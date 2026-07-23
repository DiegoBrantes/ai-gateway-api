import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../cache/memory.cache';
import { ProviderRegistry } from '../providers/registry';
import type {
  Provider,
  ProviderChatResult,
  ProviderStreamEvent,
} from '../providers/types';
import type { ChatRequest } from '../types';
import { ProviderError } from '../utils/errors';
import { GatewayService } from './gateway.service';
import { MetricsService } from './metrics.service';

function fakeProvider(name: string, overrides: Partial<Provider> = {}): Provider {
  return {
    name,
    capabilities: ['chat', 'embeddings'],
    isConfigured: () => true,
    listModels: () => [`${name}-model`],
    defaultChatModel: () => `${name}-model`,
    defaultEmbeddingModel: () => `${name}-embed`,
    async chat(): Promise<ProviderChatResult> {
      return {
        content: `hi from ${name}`,
        model: `${name}-model`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    async *chatStream(): AsyncGenerator<ProviderStreamEvent> {
      yield { type: 'delta', delta: 'hi' };
      yield {
        type: 'done',
        model: `${name}-model`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    async embeddings() {
      return {
        embeddings: [[0.1, 0.2]],
        model: `${name}-embed`,
        usage: { promptTokens: 3, totalTokens: 3 },
      };
    },
    ...overrides,
  };
}

function makeGateway(providers: Provider[]) {
  const registry = new ProviderRegistry(providers);
  const cache = new MemoryCache();
  const metrics = new MetricsService();
  return { gateway: new GatewayService({ registry, cache, metrics }), cache, metrics };
}

const request: ChatRequest = { messages: [{ role: 'user', content: 'hello' }] };

describe('GatewayService', () => {
  it('returns a response with usage and cost from the primary provider', async () => {
    const { gateway } = makeGateway([fakeProvider('openai')]);
    const res = await gateway.chat(request, 'key:test');
    expect(res.provider).toBe('openai');
    expect(res.content).toContain('openai');
    expect(res.usage.totalTokens).toBe(15);
    expect(res.attempts).toEqual(['openai']);
  });

  it('fails over to the next provider when the primary throws a 5xx', async () => {
    const failing = fakeProvider('openai', {
      chat: vi.fn().mockRejectedValue(new ProviderError('openai', 'boom', 502)),
    });
    const { gateway } = makeGateway([failing, fakeProvider('anthropic')]);
    const res = await gateway.chat(request, 'key:test');
    expect(res.provider).toBe('anthropic');
    expect(res.attempts).toEqual(['openai', 'anthropic']);
  });

  it('does not fail over on a 4xx client error', async () => {
    const failing = fakeProvider('openai', {
      chat: vi.fn().mockRejectedValue(new ProviderError('openai', 'bad input', 400)),
    });
    const secondary = fakeProvider('anthropic');
    const { gateway } = makeGateway([failing, secondary]);
    await expect(gateway.chat(request, 'key:test')).rejects.toThrow('bad input');
    expect(secondary.chat).toBeDefined();
  });

  it('serves the second identical request from cache', async () => {
    const provider = fakeProvider('openai');
    const spy = vi.spyOn(provider, 'chat');
    const { gateway, metrics } = makeGateway([provider]);
    await gateway.chat(request, 'key:test');
    await gateway.chat(request, 'key:test');
    expect(spy).toHaveBeenCalledTimes(1); // second call hit the cache
    expect(metrics.summary().totals.cachedRequests).toBe(1);
  });

  it('records usage metrics per provider', async () => {
    const { gateway, metrics } = makeGateway([fakeProvider('openai')]);
    await gateway.chat(request, 'key:alice');
    const totals = metrics.summary().totals;
    expect(totals.requests).toBe(1);
    expect(totals.byProvider.openai?.totalTokens).toBe(15);
  });
});
