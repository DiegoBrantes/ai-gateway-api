# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/DiegoBrantes/ai-gateway-api/releases/tag/v1.0.0
