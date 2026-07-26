import { describe, expect, it } from 'vitest';
import { parseSSE, sseFrame } from './sse';

/** Build a Response whose body streams `text` in the given chunk sizes. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array> | null): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSSE(body)) out.push(data);
  return out;
}

describe('parseSSE', () => {
  it('returns nothing for a null body', async () => {
    expect(await collect(null)).toEqual([]);
  });

  it('parses complete events separated by blank lines', async () => {
    const body = streamOf(['data: a\n\ndata: b\n\n']);
    expect(await collect(body)).toEqual(['a', 'b']);
  });

  it('reassembles events split across chunk boundaries', async () => {
    const body = streamOf(['data: hel', 'lo\n', '\ndata: wo', 'rld\n\n']);
    expect(await collect(body)).toEqual(['hello', 'world']);
  });

  it('stops at the [DONE] sentinel and ignores anything after', async () => {
    const body = streamOf(['data: one\n\ndata: [DONE]\n\ndata: two\n\n']);
    expect(await collect(body)).toEqual(['one']);
  });

  it('joins multiple data: lines within a single event', async () => {
    const body = streamOf(['data: line1\ndata: line2\n\n']);
    expect(await collect(body)).toEqual(['line1\nline2']);
  });

  it('ignores comment/other lines with no data field', async () => {
    const body = streamOf([': keep-alive\n\nevent: ping\n\ndata: real\n\n']);
    expect(await collect(body)).toEqual(['real']);
  });

  it('handles an event with no trailing blank line at stream end', async () => {
    // No final "\n\n": the last partial event is not emitted (matches SSE framing).
    const body = streamOf(['data: a\n\ndata: b']);
    expect(await collect(body)).toEqual(['a']);
  });

  it('parses CRLF line endings (Gemini-style \\r\\n\\r\\n boundaries)', async () => {
    const body = streamOf(['data: alpha\r\n\r\ndata: beta\r\n\r\n']);
    expect(await collect(body)).toEqual(['alpha', 'beta']);
  });

  it('parses CRLF events split across chunk boundaries', async () => {
    const body = streamOf(['data: hel', 'lo\r\n', '\r\ndata: wo', 'rld\r\n\r\n']);
    expect(await collect(body)).toEqual(['hello', 'world']);
  });

  it('stops at [DONE] with CRLF endings', async () => {
    const body = streamOf(['data: one\r\n\r\ndata: [DONE]\r\n\r\n']);
    expect(await collect(body)).toEqual(['one']);
  });
});

describe('sseFrame', () => {
  it('formats an event with JSON data', () => {
    expect(sseFrame('delta', { content: 'hi' })).toBe(
      'event: delta\ndata: {"content":"hi"}\n\n',
    );
  });
});
