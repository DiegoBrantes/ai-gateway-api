# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07

Security, streaming and reliability hardening. See `RELEASE_NOTES_v1.1.0.md`.

### Added

- **Readiness probe** `GET /ready` (providers + cache checks); `/health` stays liveness-only.
- **`GET /openapi.json`** always served; Swagger UI (`/docs`) now gated by `ENABLE_SWAGGER_UI` (off by default in production).
- **Per-model capabilities** on `GET /v1/models`; `GET /v1/providers` now flags the `mock` provider.
- **Constant-time API-key comparison** (`crypto.timingSafeEqual` over SHA-256).
- **Dashboard/metrics protection** in production via `DASHBOARD_PUBLIC` (+ optional `ADMIN_API_KEY`).
- **Per-caller cache isolation** (`CACHE_SCOPE`, default `principal`) and a **bounded LRU** in-memory cache (`MEMORY_CACHE_MAX_ENTRIES`).
- **Streaming failover before the first token**, with an explicit `provider` SSE event and structured `error` frames.
- **Client-disconnect cancellation**: aborts the upstream provider call.
- Rewritten **dashboard** with real health status, loading/empty/error states, mobile layout, accessibility, and output escaping.
- **Examples** under `docs/examples/` (curl, JavaScript, TypeScript, Python) and dashboard screenshots.
- CI hardening: least-privilege `permissions`, **Dependabot** and **CodeQL** workflows.

### Changed

- Cost is reported honestly: unknown models return `pricingKnown:false` with `null` costs (never a misleading `0`); costs accumulate in integer **micro-dollars**.
- OpenAPI now documents response/error schemas, examples and a `bearerAuth` scheme.
- Documentation aligned with the code (added a **Production Readiness** table; corrected the test count to 124; qualified “production-ready” and streaming-failover claims).

### Fixed

- **SSE parser now accepts CRLF (`\r\n\r\n`) event boundaries**, not only `\n\n`. Found by testing against the **real Google Gemini API**, whose stream uses CRLF — previously the gateway emitted no `delta` events for Gemini streaming. Regression tests added.
- **Cost now prices dated model snapshots by family.** Providers return dated ids (OpenAI answers a `gpt-4o-mini` request with `gpt-4o-mini-2024-07-18`); `priceFor` now falls back to the longest hyphen-bounded prefix, so real responses are priced (`pricingKnown:true`) instead of showing as unknown. Found via the real OpenAI API.
- **Gemini model catalog updated** to the stable `-latest` aliases (`gemini-flash-latest`, `gemini-pro-latest`, `gemini-embedding-001`); the retired `gemini-1.5-*` / `text-embedding-004` ids returned 404 against the live API. Pricing table updated accordingly.
- `GET /v1/models` no longer copies provider-level capabilities onto every model (e.g. embedding models no longer claim `chat`/`vision`).
- `RedisCache.get` no longer crashes on a corrupted JSON value — it discards the entry and returns a miss.
- The mock provider can no longer respond silently in production (boot fails unless `ALLOW_MOCK_PROVIDER=true`).

### Security

- `npm audit` reduced from 8 advisories (2 critical, 2 high) to **0** via dependency upgrades and `overrides`; CI `security-audit` now passes.
- Patched a later-published high advisory (`brace-expansion`/`minimatch` DoS, pulled transitively via `@fastify/static` and eslint) with a `brace-expansion` override — verified `npm audit` back to **0** without breaking lint.
- Removed the false `vision` capability from advertised model metadata (no multimodal support exists yet).

### Verified against a live provider

- The gateway was exercised end-to-end against the **real OpenAI, Google Gemini and Anthropic APIs** with valid keys:
  - **OpenAI** (`gpt-4o-mini`): chat + streaming (10 `delta`s) with real usage and priced cost. Embeddings returned a clean `provider_error` 403 (the key's project lacked model access — not a gateway bug).
  - **Gemini** (`gemini-flash-latest` / `gemini-embedding-001`): chat + streaming + embeddings, all with priced cost (streaming works after the CRLF fix).
  - **Anthropic** (`claude-3-5-haiku-latest`): the key was valid but had no credit, so the API returned a billing 400 — which confirmed the gateway's real-provider **error handling**: a clean JSON envelope for non-streaming and a structured `event: error` → `event: end` for streaming (and correctly no failover on a 4xx).

  These live runs surfaced the CRLF, stale-catalog and dated-snapshot-pricing fixes above.

### Known limitations

- Metrics are **in-memory** (reset on restart; not shared across instances).
- No history **persistence** (no database).
- Cost is an **estimate**, not billing.
- Streaming failover applies **only before the first token**.

### Removed

- Dead code: unused `ProviderRegistry.require()`/`names()` and the unused `ChatStreamChunk` type.

## [1.0.0] — 2026-07

### Added

- Provider-agnostic gateway for **OpenAI**, **Google Gemini** and **Anthropic**
  behind a single HTTP API.
- Automatic **fallback** across a configurable provider chain, with bounded
  **retries** (exponential backoff + jitter) and per-request **timeouts**.
- **Streaming** chat over Server-Sent Events with a normalized `delta`/`done`
  contract.
- **Embeddings** endpoint.
- **Token accounting** and **cost estimation** (per-model pricing table) on every
  response.
- **Response caching** with a deterministic cache key (Redis or in-memory).
- Authentication via **API key** and **JWT**, plus an `/auth/token` exchange.
- Per-caller **rate limiting** with standard `X-RateLimit-*` headers.
- **OpenAPI** document and **Swagger UI** at `/docs`.
- Live **usage dashboard** at `/dashboard`.
- **Security hardening**: production secret guard, security headers, request body
  limit, and secret redaction in logs.
- **Docker** (multi-stage, non-root, healthcheck), **docker-compose** with Redis,
  and **GitHub Actions** CI.
- Test suite covering pricing, cache, gateway fallback/retry/cache/metrics, rate
  limiting, retries, security headers and the full HTTP surface.

[1.1.0]: https://github.com/DiegoBrantes/ai-gateway-api/releases/tag/v1.1.0
[1.0.0]: https://github.com/DiegoBrantes/ai-gateway-api/releases/tag/v1.0.0
