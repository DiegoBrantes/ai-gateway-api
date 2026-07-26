// AI Gateway API — TypeScript example with a minimal SSE parser.
// Run with: tsx docs/examples/typescript.ts
const BASE = process.env.BASE ?? 'http://localhost:3000';
const KEY = process.env.API_KEY ?? 'dev-key-please-change';

interface ChatResponse {
  content: string;
  provider: string;
  model: string;
  usage: { totalTokens: number };
  cost: { totalCost: number | null; pricingKnown: boolean };
  attempts: string[];
}

async function chat(prompt: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Gateway error ${res.status}`);
  return (await res.json()) as ChatResponse;
}

async function stream(prompt: string): Promise<void> {
  const res = await fetch(`${BASE}/v1/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const dataLine = /^data: (.+)$/m.exec(frame)?.[1];
      if (event === 'delta' && dataLine) process.stdout.write(JSON.parse(dataLine).content);
      if (event === 'done' && dataLine) console.log('\n[done]', JSON.parse(dataLine));
    }
  }
}

const result = await chat('Explain a reverse proxy in one sentence.');
console.log(result.content, '· attempts:', result.attempts.join(' → '));
await stream('Write a haiku about the sea.');
