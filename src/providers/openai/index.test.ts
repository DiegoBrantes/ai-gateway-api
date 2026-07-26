import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../utils/errors';
import type { ChatRequest, EmbeddingsRequest } from '../../types';
import { OpenAIProvider } from './index';

const provider = new OpenAIProvider();
const chatReq: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function sseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('OpenAIProvider metadata', () => {
  it('exposes per-model capabilities without vision', () => {
    const infos = provider.listModelInfos();
    expect(infos.find((m) => m.id === 'gpt-4o')?.capabilities).toEqual(['chat', 'stream']);
    expect(infos.find((m) => m.id === 'text-embedding-3-small')?.capabilities).toEqual([
      'embeddings',
    ]);
    expect(infos.every((m) => !m.capabilities.includes('vision' as never))).toBe(true);
  });

  it('is not a mock and defaults sensibly', () => {
    expect(provider.isMock).toBe(false);
    expect(provider.defaultChatModel()).toBe('gpt-4o-mini');
  });
});

describe('OpenAIProvider.chat', () => {
  it('maps a successful completion, sending model/temperature/max_tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          model: 'gpt-4o',
          choices: [{ message: { content: 'hello world' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.chat({ ...chatReq, model: 'gpt-4o', temperature: 0.3, maxTokens: 50 });
    expect(result.content).toBe('hello world');
    expect(result.model).toBe('gpt-4o');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toMatchObject({ model: 'gpt-4o', temperature: 0.3, max_tokens: 50 });
  });

  it('uses the default model when none is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await provider.chat(chatReq);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).model).toBe('gpt-4o-mini');
    expect(result.usage.totalTokens).toBe(0); // no usage reported → zeros
  });

  it('throws ProviderError on an empty choices array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
    await expect(provider.chat(chatReq)).rejects.toBeInstanceOf(ProviderError);
  });

  it('maps a 400 upstream error to a 400 ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400)));
    await expect(provider.chat(chatReq)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('maps a 500 upstream error to a 502 ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(provider.chat(chatReq)).rejects.toMatchObject({ statusCode: 502 });
  });

  it('maps a 429 upstream error to a 429 ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow', { status: 429 })));
    await expect(provider.chat(chatReq)).rejects.toMatchObject({ statusCode: 429 });
  });
});

describe('OpenAIProvider.chatStream', () => {
  async function drain(req: ChatRequest) {
    const events = [];
    for await (const e of provider.chatStream(req)) events.push(e);
    return events;
  }

  it('yields deltas and a final done with reported usage', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n' +
      'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));

    const events = await drain(chatReq);
    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e as { delta: string }).delta);
    expect(deltas.join('')).toBe('Hello');
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', usage: { totalTokens: 5 } });
  });

  it('estimates usage when the stream reports none', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hey there"}}]}\n\ndata: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const events = await drain(chatReq);
    const done = events.at(-1) as { type: string; usage: { totalTokens: number } };
    expect(done.type).toBe('done');
    expect(done.usage.totalTokens).toBeGreaterThan(0);
  });

  it('ignores malformed JSON chunks without throwing', async () => {
    const sse = 'data: not-json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const events = await drain(chatReq);
    expect(events.some((e) => e.type === 'delta' && (e as { delta: string }).delta === 'ok')).toBe(
      true,
    );
  });
});

describe('OpenAIProvider.embeddings', () => {
  it('maps embedding vectors and usage for multiple inputs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          model: 'text-embedding-3-small',
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
      ),
    );
    const req: EmbeddingsRequest = { input: ['a', 'b'] };
    const result = await provider.embeddings(req);
    expect(result.embeddings).toHaveLength(2);
    expect(result.usage).toEqual({ promptTokens: 4, totalTokens: 4 });
  });
});
