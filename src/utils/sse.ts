/**
 * Parse a Server-Sent-Events response body into an async iterator of
 * `data:` payloads. Handles chunk boundaries that split events and
 * stops at the `[DONE]` sentinel used by OpenAI-style streams.
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

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractData(rawEvent);
        if (data === '[DONE]') return;
        if (data !== null) yield data;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split('\n');
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

/** Format a payload as an SSE frame for the outgoing client stream. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
