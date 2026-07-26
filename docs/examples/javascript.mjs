// AI Gateway API — JavaScript (Node 20+ / browser fetch) examples.
const BASE = process.env.BASE ?? 'http://localhost:3000';
const KEY = process.env.API_KEY ?? 'dev-key-please-change';
const headers = { 'content-type': 'application/json', 'x-api-key': KEY };

// Non-streaming chat
const chat = await fetch(`${BASE}/v1/chat`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Give me 3 coffee brand name ideas.' }],
  }),
});
const data = await chat.json();
console.log(data.content, '· cost:', data.cost.totalCost, '· pricingKnown:', data.cost.pricingKnown);

// Streaming chat (SSE). Events: provider, delta, done, error, end.
const res = await fetch(`${BASE}/v1/chat/stream`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Write a haiku about the sea.' }] }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value)); // raw SSE frames
}
