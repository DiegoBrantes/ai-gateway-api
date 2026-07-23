<div align="center">

# 🧠 AI Gateway API

**One API for OpenAI, Google Gemini and Anthropic — with automatic fallback, streaming, token accounting and cost estimation.**

[![CI](https://github.com/DiegoBrantes/ai-gateway-api/actions/workflows/ci.yml/badge.svg)](https://github.com/DiegoBrantes/ai-gateway-api/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-22%20passing-brightgreen)](#-testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**🇧🇷 [Português](README.md) · 🇺🇸 English**

</div>

---

## Overview

Modern products rarely bet on a single AI provider. You want OpenAI's reasoning,
Gemini's price-per-token, Anthropic's long context — and you want to switch
between them without rewriting your application.

**AI Gateway API** puts a single, provider-agnostic HTTP surface in front of all
three. Your app speaks one schema; the gateway handles vendor differences,
**fails over automatically** when a provider is down, **streams** tokens over SSE,
and reports **exact token usage and estimated cost** on every call.

```
                         ┌──────────────────────────────┐
                         │        AI Gateway API         │
  POST /v1/chat  ───────▶│  auth · rate-limit · cache    │
  POST /v1/chat/stream   │  fallback · retry · metrics   │
  POST /v1/embeddings    │                               │
                         │   ┌─────────┬────────┬──────┐ │
                         │   │ OpenAI  │ Gemini │ Anth.│ │──▶ provider APIs
                         │   └─────────┴────────┴──────┘ │
                         └──────────────────────────────┘
```

> **Zero-credential dev mode:** with no API keys set, the gateway serves a
> deterministic **mock provider**, so you can clone, run and explore the whole
> pipeline in seconds — no vendor account required.

---

## ✨ Features

|                                |                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 🔀 **Unified API**             | One request schema for chat, streaming and embeddings across three providers.                         |
| 🛟 **Automatic fallback**      | Configurable provider chain; transient 5xx/429 failures roll over to the next provider transparently. |
| ⚡ **Streaming (SSE)**         | Token-by-token streaming with a normalized `delta` / `done` event contract.                           |
| 🔁 **Retry & timeout**         | Bounded exponential backoff with jitter; per-request `AbortController` timeouts.                      |
| 🧮 **Token & cost accounting** | Real provider usage when available, calibrated estimates otherwise, priced from a per-model table.    |
| 🗄️ **Response caching**        | Deterministic cache key for idempotent chat calls (Redis or in-memory).                               |
| 🔐 **Auth**                    | API-key **and** JWT authentication, per-caller identity for attribution.                              |
| 🚦 **Rate limiting**           | Fixed-window limiter with standard `X-RateLimit-*` headers, backed by the shared cache.               |
| 📊 **Live dashboard**          | Zero-dependency `/dashboard` showing consumption per provider and per model.                          |
| 📖 **OpenAPI + Swagger UI**    | Auto-generated docs at `/docs`.                                                                       |
| 🧱 **Clean architecture**      | Provider adapters behind an interface, dependency-injected services, typed errors.                    |
| 🐳 **Prod-ready ops**          | Multi-stage Docker image, docker-compose with Redis, GitHub Actions CI.                               |

---

## 🧰 Tech Stack

**TypeScript** · **Node.js 20+** · **Fastify 5** · **Zod** · **ioredis** · **pino** ·
**@fastify/swagger** · **JWT** · **Vitest** · **tsup**

No vendor SDKs: adapters talk to the providers' HTTP APIs directly through the
native `fetch`, keeping the dependency tree small and the streaming path fully
under our control.

---

## 🏗️ Architecture

```
src/
├── app.ts                 # Application factory: plugins, DI wiring, routes
├── server.ts              # Process entrypoint + graceful shutdown
├── config/                # Zod-validated environment (fail-fast on boot)
├── providers/             # Provider abstraction — the heart of the gateway
│   ├── types.ts           #   the Provider interface every adapter implements
│   ├── openai/            #   OpenAI adapter
│   ├── gemini/            #   Google Gemini adapter
│   ├── anthropic/         #   Anthropic adapter
│   ├── mock/              #   deterministic no-network adapter (dev/tests)
│   └── registry.ts        #   builds & owns the live provider set
├── services/
│   ├── gateway.service.ts #   orchestration: fallback, retry, cache, metrics
│   ├── pricing.ts         #   per-model price table + cost estimator
│   ├── tokens.service.ts  #   token estimation
│   └── metrics.service.ts #   in-process usage aggregation
├── cache/                 # Cache interface + Redis & in-memory implementations
├── middlewares/           # auth · rate-limit · global error handler
├── controllers/           # thin HTTP adapters over the services
├── routes/                # versioned, documented route registration
├── schemas/               # Zod request schemas
├── dashboard/             # self-contained usage dashboard
├── utils/                 # errors, logger, http (retry/timeout), SSE
└── types/                 # provider-agnostic domain model
tests/                     # end-to-end HTTP tests (Fastify inject)
```

**Design principles:** the application depends on a `Provider` _interface_, never
on a vendor SDK — which is exactly what makes providers hot-swappable and the
fallback chain possible. Services receive their dependencies through
constructors (poor-man's DI), so tests inject fakes with zero mocking of modules.

### Request flow

```
request → auth → rate-limit → validate (Zod) → controller
        → GatewayService: cache lookup → build fallback chain
        → try provider (retry + timeout) → on 5xx/429: next provider
        → compute usage + cost → record metrics → cache → respond
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js **≥ 20**
- (optional) Redis, for shared cache / rate limiting across instances
- (optional) Provider API keys — omit them to use the mock provider

### Run locally

```bash
git clone https://github.com/DiegoBrantes/ai-gateway-api.git
cd ai-gateway-api
npm install
cp .env.example .env      # edit if you have provider keys
npm run dev               # http://localhost:3000
```

Open:

- **API docs (Swagger UI):** http://localhost:3000/docs
- **Usage dashboard:** http://localhost:3000/dashboard
- **Health:** http://localhost:3000/health

### Run with Docker (includes Redis)

```bash
docker compose up --build
```

---

## ⚙️ Configuration

All configuration is via environment variables, validated at boot (see
[`.env.example`](.env.example)). Highlights:

| Variable                                                  | Default                 | Description                                        |
| --------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| `API_KEYS`                                                | `dev-key-please-change` | Comma-separated accepted API keys.                 |
| `DEFAULT_PROVIDER`                                        | `openai`                | Provider used when the caller doesn't specify one. |
| `FALLBACK_PROVIDERS`                                      | `anthropic,gemini`      | Ordered fallback chain.                            |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | —                       | Enable real providers.                             |
| `REDIS_URL`                                               | _(empty)_               | Set to use Redis; empty = in-memory cache.         |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`                 | `60` / `60000`          | Requests per window per caller.                    |
| `REQUEST_TIMEOUT_MS`                                      | `30000`                 | Per-provider request timeout.                      |
| `PROVIDER_MAX_RETRIES`                                    | `2`                     | Retries before failing over.                       |

---

## 📡 Endpoints

| Method | Path               | Auth | Description                                  |
| ------ | ------------------ | :--: | -------------------------------------------- |
| `POST` | `/v1/chat`         |  ✅  | Chat completion.                             |
| `POST` | `/v1/chat/stream`  |  ✅  | Streaming chat completion (SSE).             |
| `POST` | `/v1/embeddings`   |  ✅  | Create embeddings.                           |
| `POST` | `/auth/token`      |  —   | Exchange an API key for a short-lived JWT.   |
| `GET`  | `/v1/providers`    |  ✅  | Providers and their configuration status.    |
| `GET`  | `/v1/models`       |  ✅  | Available models and capabilities.           |
| `GET`  | `/v1/usage`        |  ✅  | Usage & cost for the calling key.            |
| `GET`  | `/health`          |  —   | Liveness probe.                              |
| `GET`  | `/metrics/summary` |  —   | Global usage summary (powers the dashboard). |
| `GET`  | `/dashboard`       |  —   | Live usage dashboard (HTML).                 |
| `GET`  | `/docs`            |  —   | Swagger UI.                                  |

---

## 💻 Usage Examples

### cURL

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "content-type: application/json" \
  -H "x-api-key: dev-key-please-change" \
  -d '{
    "provider": "openai",
    "messages": [{ "role": "user", "content": "Explain what a reverse proxy is in one sentence." }]
  }'
```

```jsonc
{
  "id": "b1e6…",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "content": "A reverse proxy is a server that sits in front of backend services…",
  "usage": { "promptTokens": 18, "completionTokens": 24, "totalTokens": 42 },
  "cost": {
    "currency": "USD",
    "promptCost": 0.0000027,
    "completionCost": 0.0000144,
    "totalCost": 0.0000171,
  },
  "attempts": ["openai"],
  "latencyMs": 512,
}
```

### JavaScript (fetch)

```js
const res = await fetch('http://localhost:3000/v1/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'dev-key-please-change' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Give me 3 name ideas for a coffee brand.' }],
  }),
});
const data = await res.json();
console.log(data.content, data.cost.totalCost);
```

### TypeScript (streaming, SSE)

```ts
const res = await fetch('http://localhost:3000/v1/chat/stream', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'dev-key-please-change' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Write a haiku about the sea.' }],
  }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value)); // event: delta … event: done …
}
```

---

## 🧪 Testing

```bash
npm test              # run the suite
npm run test:coverage # with coverage report
npm run typecheck     # strict type-check, no emit
```

The suite (22 tests) covers pricing math, the cache (including TTL expiry),
gateway **fallback / retry / caching / metrics**, and the full HTTP surface via
Fastify's `inject` — all with **no network calls**, thanks to the mock provider.

---

## 🚢 Deployment

- **Docker:** `docker build -t ai-gateway-api . && docker run -p 3000:3000 --env-file .env ai-gateway-api`
- **Compose:** `docker compose up --build` (gateway + Redis)
- **CI:** every push/PR runs type-check, tests+coverage, build, and a Docker image build via [GitHub Actions](.github/workflows/ci.yml).

The image is multi-stage, runs as a non-root user, and ships a container
`HEALTHCHECK` hitting `/health`.

---

## 🗺️ Roadmap

- [ ] Additional endpoints: vision, OCR, transcription, translation, image generation, moderation
- [ ] Per-key budget caps and monthly spend limits
- [ ] Persisted metrics (Postgres/ClickHouse) + Prometheus `/metrics`
- [ ] Semantic response cache (embedding-based)
- [ ] Weighted / latency-aware provider routing
- [ ] Official TypeScript client SDK

---

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss substantial changes
first. For pull requests: keep the type-check and test suite green
(`npm run typecheck && npm test`) and follow the existing architecture — new
providers should implement the `Provider` interface and nothing else needs to change.

---

## 📄 License

[MIT](LICENSE) © Diego de Carvalho Brantes
