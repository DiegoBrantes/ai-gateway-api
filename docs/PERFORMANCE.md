# Performance Notes

Performance choices in this project, and how to reason about them. The gateway is
**I/O-bound** — almost all wall-clock time is spent waiting on upstream provider
APIs — so the design optimizes for latency amortization and resource safety
rather than raw CPU.

## Where time goes

```
total latency ≈ gateway overhead (µs–ms) + provider round-trip (100s of ms)
```

Gateway overhead is dominated by JSON (de)serialization and validation, both
small relative to the provider round-trip.

## Design choices that matter

| Choice                         | Effect                                                                    |
| ------------------------------ | ------------------------------------------------------------------------- |
| **Fastify**                    | One of the fastest Node HTTP frameworks; schema-based fast serialization. |
| **Native `fetch`, no SDKs**    | No SDK overhead; smaller install; full control of the streaming path.     |
| **Response cache**             | Identical chat requests skip the provider round-trip entirely.            |
| **Streaming (SSE)**            | Time-to-first-token is low; the client renders while tokens arrive.       |
| **Bounded retries + timeouts** | A slow/broken provider can't pin a request open indefinitely.             |
| **Redis atomic counters**      | Rate limiting stays O(1) and correct across instances.                    |
| **Approximate token counting** | O(n) over text length, no tokenizer initialization cost.                  |

## Caching

Chat responses are cached under a SHA-256 key derived from the normalized request
(provider, model, temperature, maxTokens, messages). A cache hit avoids the entire
provider call. Streaming responses are intentionally **not** cached — they are
consumed once, incrementally. TTL is configurable via `CACHE_TTL_SECONDS`.

## Concurrency

Node's event loop handles many concurrent I/O-bound requests on a single thread.
For horizontal scale, run multiple instances behind a load balancer and point
them at a shared Redis (`REDIS_URL`) so cache and rate-limit state are shared.

## Failure isolation

- Per-request `AbortController` timeout (`REQUEST_TIMEOUT_MS`).
- Retries bounded by `PROVIDER_MAX_RETRIES` with exponential backoff + jitter to
  avoid thundering herds.
- Fallback stops at the first success and never loops.

## Measuring

Every response includes `latencyMs` and the `attempts` array, and the
`/dashboard` + `/v1/usage` endpoints expose aggregate request counts, cache-hit
rate, tokens and cost — enough to spot regressions without extra tooling.

## Possible future optimizations

- HTTP keep-alive / connection pooling to upstreams (a custom `undici` agent).
- Semantic (embedding-based) cache for near-duplicate prompts.
- Latency-aware provider routing.
