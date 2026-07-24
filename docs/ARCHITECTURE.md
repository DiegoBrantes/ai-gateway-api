# Architecture

This document explains how **AI Gateway API** is structured and why. It
complements the code, which is organized around a single idea: **the application
depends on a `Provider` interface, never on a vendor SDK.**

## High-level overview

```mermaid
flowchart LR
  client["Client<br/>(app / SDK / curl)"]

  subgraph gateway["AI Gateway API (Fastify)"]
    direction TB
    mw["Middlewares<br/>security headers · auth · rate-limit · validation"]
    ctrl["Controllers<br/>(thin HTTP adapters)"]
    gw["GatewayService<br/>fallback · retry · timeout · cache · metrics"]
    reg["ProviderRegistry"]
    cache[("Cache<br/>Redis / in-memory")]
  end

  subgraph providers["Provider adapters"]
    op["OpenAI"]
    an["Anthropic"]
    ge["Gemini"]
    mo["Mock"]
  end

  client -->|HTTP / SSE| mw --> ctrl --> gw
  gw --> reg
  gw <--> cache
  reg --> op & an & ge & mo
  op -->|fetch| openai["OpenAI API"]
  an -->|fetch| anthropic["Anthropic API"]
  ge -->|fetch| gemini["Gemini API"]
```

**Layers, from the outside in:**

| Layer            | Responsibility                                                     | Depends on         |
| ---------------- | ------------------------------------------------------------------ | ------------------ |
| Middlewares      | Cross-cutting concerns (auth, rate limit, headers, error handling) | config, cache      |
| Controllers      | Validate input, call a service, serialize output                   | services, schemas  |
| GatewayService   | Orchestration: chain, retry, timeout, cache, metrics, cost         | registry, cache    |
| ProviderRegistry | Owns the set of live providers, answers "who handles X"            | providers          |
| Provider adapter | Map the vendor's HTTP shape to the domain model                    | (nothing internal) |

The dependency arrows only ever point **inward**, which is the essence of Clean
Architecture: inner layers never import outer ones.

## Request lifecycle (chat)

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant MW as Middlewares
  participant Ctl as ChatController
  participant GW as GatewayService
  participant $ as Cache
  participant P as Provider

  C->>MW: POST /v1/chat (x-api-key)
  MW->>MW: security headers · authenticate · rate limit
  MW->>Ctl: request (validated identity)
  Ctl->>Ctl: Zod validation
  Ctl->>GW: chat(request, principal)
  GW->>$: get(cacheKey)
  alt cache hit
    $-->>GW: cached response
    GW-->>Ctl: response (cached=true)
  else cache miss
    GW->>P: chat() with retry + timeout
    P-->>GW: content + usage
    GW->>GW: estimate cost · record metrics
    GW->>$: set(cacheKey, response)
    GW-->>Ctl: response
  end
  Ctl-->>C: 200 JSON (usage + cost + attempts)
```

## Fallback & retry logic

```mermaid
flowchart TD
  start([chat request]) --> chain["Build ordered chain:<br/>explicit → default → fallbacks"]
  chain --> pick{Next configured<br/>provider?}
  pick -- no --> fail["AllProvidersFailedError (502)"]
  pick -- yes --> try["Call provider<br/>(retry + timeout)"]
  try --> ok{Success?}
  ok -- yes --> done([Return response])
  ok -- no --> cls{Error class}
  cls -- "4xx client<br/>(not 429)" --> stop["Throw — no failover<br/>(bad request won't help elsewhere)"]
  cls -- "5xx / 429 / network" --> pick
```

Only transient failures (5xx, 429, network/timeout) trigger failover; client
errors surface immediately, because retrying a malformed request on another
provider would just waste time and money.

## Authentication

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as /auth/token
  participant API as /v1/*

  Note over C,API: Option 1 — API key
  C->>API: request with header x-api-key
  API-->>C: 200 (if key ∈ API_KEYS)

  Note over C,API: Option 2 — JWT
  C->>A: POST /auth/token { apiKey }
  A-->>C: { token } (signed JWT)
  C->>API: request with Authorization: Bearer <token>
  API-->>C: 200 (if token valid)
```

The resolved identity (`key:…` or `jwt:sub`) is attached to the request and used
for both rate limiting and per-caller usage attribution.

## Key design decisions

- **No vendor SDKs.** Adapters call provider HTTP APIs via the native `fetch`.
  This keeps dependencies minimal and gives full control over the streaming path.
- **Dependency injection via constructors.** Services receive their
  collaborators, so tests inject fakes without module mocking.
- **Cache behind an interface.** Redis for multi-instance deployments; in-memory
  otherwise — the calling code is identical.
- **Fail-fast configuration.** The environment is validated (and production
  secrets are enforced) at boot, never at request time.
- **Mock provider.** Guarantees the whole pipeline is runnable and testable with
  zero credentials and zero network.

See [DECISIONS](DECISIONS.md) for the rationale behind individual trade-offs.
