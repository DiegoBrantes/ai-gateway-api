import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, EmbeddingsRequest } from '../../types';
import { GeminiProvider } from './index';

const provider = new GeminiProvider();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.restoreAllMocks());

describe('GeminiProvider', () => {
  it('maps its own model roles and systemInstruction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'answer' }] } }],
        usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const req: ChatRequest = {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'prior' },
        { role: 'user', content: 'now' },
      ],
    };
    const result = await provider.chat(req);
    expect(result.content).toBe('answer');
    expect(result.usage).toEqual({ promptTokens: 6, completionTokens: 3, totalTokens: 9 });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('generateContent');
    expect(url).toContain('key=');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(body.contents).toEqual([
      { role: 'model', parts: [{ text: 'prior' }] },
      { role: 'user', parts: [{ text: 'now' }] },
    ]);
  });

  it('streams deltas and prefers reported usage', async () => {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"there"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":4}}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(sse, { status: 200 })));

    const events = [];
    for await (const e of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] }))
      events.push(e);
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { delta: string }).delta).join('')).toBe('Hi there');
    expect(events.at(-1)).toMatchObject({ type: 'done', usage: { totalTokens: 6 } });
  });

  it('maps embeddings from batchEmbedContents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3] }] }),
      ),
    );
    const req: EmbeddingsRequest = { input: ['a', 'b'] };
    const result = await provider.embeddings(req);
    expect(result.embeddings).toEqual([[0.1, 0.2], [0.3]]);
    expect(result.usage.promptTokens).toBeGreaterThan(0);
  });

  it('maps a 503 upstream error to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('busy', { status: 503 })));
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});
