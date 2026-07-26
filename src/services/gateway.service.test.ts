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
    isMock: false,
    capabilities: ['chat', 'embeddings'],
    isConfigured: () => true,
    listModels: () => [`${name}-model`],
    listModelInfos: () => [{ id: `${name}-model`, capabilities: ['chat', 'stream'] }],
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

  it('isolates the cache per principal by default (CACHE_SCOPE=principal)', async () => {
    const provider = fakeProvider('openai');
    const spy = vi.spyOn(provider, 'chat');
    const { gateway } = makeGateway([provider]);
    await gateway.chat(request, 'key:alice'); // miss
    await gateway.chat(request, 'key:alice'); // hit — same principal
    await gateway.chat(request, 'key:bob'); // miss — different principal
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

async function collectStream(
  gen: AsyncGenerator<{ type: string; delta?: string; provider?: string }>,
) {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('GatewayService.chatStream failover', () => {
  // eslint-disable-next-line require-yield -- intentionally throws before yielding
  const failOpen = async function* (): AsyncGenerator<ProviderStreamEvent> {
    throw new ProviderError('x', 'failed to open stream', 503);
  };

  it('fails over to the next provider when the first fails before the first delta', async () => {
    const first = fakeProvider('openai', { chatStream: failOpen });
    const second = fakeProvider('anthropic');
    const { gateway } = makeGateway([first, second]);

    const events = await collectStream(gateway.chatStream(request, 'key:test'));
    const open = events.find((e) => e.type === 'open');
    expect(open).toMatchObject({ provider: 'anthropic' });
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('does NOT fail over once the first delta has been sent', async () => {
    const midFail = fakeProvider('openai', {
      chatStream: async function* (): AsyncGenerator<ProviderStreamEvent> {
        yield { type: 'delta', delta: 'partial' };
        throw new ProviderError('openai', 'mid-stream failure', 500);
      },
    });
    const second = fakeProvider('anthropic');
    const { gateway } = makeGateway([midFail, second]);

    const gen = gateway.chatStream(request, 'key:test');
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const e of gen) if (e.type === 'delta') seen.push(e.delta!);
      })(),
    ).rejects.toThrow(/mid-stream failure/);
    // Only the first provider's partial output — never the second provider's.
    expect(seen).toEqual(['partial']);
  });

  it('throws AllProvidersFailedError when every provider fails to open', async () => {
    const a = fakeProvider('openai', { chatStream: failOpen });
    const b = fakeProvider('anthropic', { chatStream: failOpen });
    const { gateway } = makeGateway([a, b]);
    await expect(collectStream(gateway.chatStream(request, 'key:test'))).rejects.toThrow(
      /All providers failed/,
    );
  });
});
