import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../utils/errors';
import type { ChatRequest } from '../../types';
import { AnthropicProvider } from './index';

const provider = new AnthropicProvider();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
function sseResponse(text: string): Response {
  return new Response(text, { status: 200 });
}

afterEach(() => vi.restoreAllMocks());

describe('AnthropicProvider', () => {
  it('advertises chat/stream only (no embeddings, no vision)', () => {
    expect(provider.capabilities).toEqual(['chat']);
    const haiku = provider.listModelInfos().find((m) => m.id === 'claude-3-5-haiku-latest');
    expect(haiku?.capabilities).toEqual(['chat', 'stream']);
  });

  it('splits the system prompt out of the messages array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: 'claude-3-5-haiku-latest',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 8, output_tokens: 2 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const req: ChatRequest = {
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'hello' },
      ],
    };
    const result = await provider.chat(req);
    expect(result.content).toBe('hi');
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 2, totalTokens: 10 });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.system).toBe('Be terse.');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.max_tokens).toBe(1024); // default applied
  });

  it('concatenates text content blocks and ignores non-text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          content: [
            { type: 'text', text: 'a' },
            { type: 'tool_use' },
            { type: 'text', text: 'b' },
          ],
        }),
      ),
    );
    const result = await provider.chat({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.content).toBe('ab');
  });

  it('streams content_block_delta and reads usage from message_delta', async () => {
    const sse =
      'data: {"type":"content_block_delta","delta":{"text":"He"}}\n\n' +
      'data: {"type":"content_block_delta","delta":{"text":"llo"}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));

    const events = [];
    for await (const e of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] }))
      events.push(e);
    const done = events.at(-1) as { type: string; usage: { completionTokens: number } };
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { delta: string }).delta).join('')).toBe('Hello');
    expect(done.usage.completionTokens).toBe(7);
  });

  it('rejects embeddings with a 400 ProviderError', async () => {
    await expect(provider.embeddings({ input: 'x' })).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.embeddings({ input: 'x' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('maps a 500 upstream error to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 500 })));
    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});
