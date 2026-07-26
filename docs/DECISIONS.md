# Architecture Decision Records (ADRs)

Short records of the significant decisions, in the spirit of
[Michael Nygard's ADRs](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

---

## ADR-001 — Depend on a `Provider` interface, not vendor SDKs

**Status:** Accepted

**Context.** We need to support OpenAI, Gemini and Anthropic, which have
different request/response shapes and SDKs.

**Decision.** Define a single `Provider` interface and implement one adapter per
vendor using the native `fetch`. The application depends only on the interface.

**Consequences.** Providers are hot-swappable and the fallback chain is trivial.
Adding a provider is a one-file change. We take on the small cost of mapping each
vendor's HTTP shape ourselves — which is exactly where that knowledge belongs.

---

## ADR-002 — Fail over only on transient errors

**Status:** Accepted

**Context.** When a provider call fails, should we try the next provider?

**Decision.** Fail over on 5xx / 429 / network / timeout errors only. Client
errors (4xx, except 429) are re-thrown immediately.

**Consequences.** We avoid wasting time and money re-sending a malformed or
unauthorized request to every provider, while still surviving provider outages.

---

## ADR-003 — Cache behind an interface, in-memory by default

**Status:** Accepted

**Context.** Response caching and rate-limit counters need shared state in
multi-instance deployments, but requiring Redis for local dev is friction.

**Decision.** Define a `Cache` interface with Redis and in-memory
implementations, selected by `REDIS_URL`. Default to in-memory.

**Consequences.** Zero-dependency local development; correct shared state in
production. Calling code never changes.

---

## ADR-004 — Ship a mock provider

**Status:** Accepted

**Context.** Running and testing the gateway should not require paid API keys.

**Decision.** Include a deterministic `MockProvider`, auto-enabled when no real
credentials are configured.

**Consequences.** The full pipeline (auth → routing → usage → cost → metrics) is
runnable and testable offline. The entire test suite makes zero network calls.

---

## ADR-005 — Fail fast on insecure production configuration

**Status:** Accepted

**Context.** The most common real-world incident is shipping example credentials.

**Decision.** In `NODE_ENV=production`, refuse to boot if `API_KEYS` is empty or
contains the example key, or if `JWT_SECRET` is the placeholder.

**Consequences.** A misconfigured deployment stops at startup with a clear error
instead of silently running insecurely.

---

## ADR-006 — Approximate token counting instead of bundling tokenizers

**Status:** Accepted

**Context.** Exact token counts require vendor-specific tokenizers (large deps).

**Decision.** Prefer the provider's reported usage; when unavailable (e.g.
streaming), estimate with a calibrated heuristic (~4 chars/token).

**Consequences.** Accurate accounting when the provider reports it, good-enough
estimates otherwise, and no heavy tokenizer dependencies.

---

## ADR-007 — Fail over on streaming only before the first token

**Status:** Accepted (v1.1.0)

**Context.** Non-streaming calls can transparently retry another provider. For
streaming, switching providers after bytes have been sent would interleave two
different completions.

**Decision.** Try providers (with retries) until one successfully opens its stream
and yields its first event; emit a `provider` SSE event, then stream. After the
first `delta`, a failure is surfaced as a structured `error` event — never a silent
switch.

**Consequences.** Real resilience while establishing the stream, and a coherent,
single-provider response once it starts. `attempts` is reported on the `done` event.

---

## ADR-008 — No silent mock provider in production

**Status:** Accepted (v1.1.0)

**Context.** The mock provider is invaluable for zero-credential dev/test, but a
misconfigured production deployment could accidentally serve simulated completions.

**Decision.** In `NODE_ENV=production`, the mock is registered only when
`ALLOW_MOCK_PROVIDER=true`; otherwise, if no real provider is configured, the process
refuses to boot.

**Consequences.** Dev/test stay frictionless; production never fakes answers by
accident. The choice is explicit and logged.

---

## ADR-009 — Per-caller cache isolation by default

**Status:** Accepted (v1.1.0)

**Context.** A shared response cache could serve one caller's completion to another
for an identical prompt.

**Decision.** `CACHE_SCOPE=principal` (default) folds a hash of the caller identity
into the cache key. `global` opts into a shared cache. The raw API key is never used
in the key — only a hash.

**Consequences.** Safe multi-tenant defaults; a documented opt-out for deployments
that explicitly want a shared cache.

---

## ADR-010 — Honest cost: unknown pricing is null, not zero

**Status:** Accepted (v1.1.0)

**Context.** Returning `0` for a model absent from the pricing table silently
understates cost.

**Decision.** Unknown models return `pricingKnown:false` with `null` costs and log a
one-time warning. Known costs accumulate in integer micro-dollars to avoid
floating-point drift. Costs remain estimates for observability, not billing.

**Consequences.** Dashboards distinguish "free" from "unknown", and totals stay
precise under high volume.
