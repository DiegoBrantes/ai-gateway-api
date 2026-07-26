/**
 * Event boundary in an SSE stream: a blank line, which per the spec may use
 * LF, CR, or CRLF line endings. Providers differ — OpenAI emits `\n\n` while
 * Google Gemini emits `\r\n\r\n` — so we must accept all of them.
 */
const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;
const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Parse a Server-Sent-Events response body into an async iterator of
 * `data:` payloads. Handles chunk boundaries that split events, any of the
 * three SSE line-ending styles, and stops at the `[DONE]` sentinel used by
 * OpenAI-style streams.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string, void, unknown> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let match = EVENT_BOUNDARY.exec(buffer);
      while (match !== null) {
        const rawEvent = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = extractData(rawEvent);
        if (data === '[DONE]') return;
        if (data !== null) yield data;
        match = EVENT_BOUNDARY.exec(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split(LINE_BREAK);
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

/** Format a payload as an SSE frame for the outgoing client stream. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
