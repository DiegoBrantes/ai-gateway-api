# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report privately via [GitHub Security Advisories](https://github.com/DiegoBrantes/ai-gateway-api/security/advisories/new)
or by email to the maintainer. You can expect an acknowledgement within 72 hours
and a remediation plan once the report is triaged.

When reporting, please include:

- affected version / commit,
- a minimal reproduction,
- the impact you observed.

## Security Design

This project applies several defensive measures by default:

- **No default credentials in production.** The service refuses to boot in
  `NODE_ENV=production` if `API_KEYS` is empty/uses the example key, or if
  `JWT_SECRET` is still the placeholder. See `src/config/env.ts`.
- **No silent mock in production.** In production, if no real provider is
  configured and `ALLOW_MOCK_PROVIDER` is not `true`, the process refuses to boot,
  so it never serves simulated completions by accident (`assertProviderPolicy`).
- **Constant-time API-key comparison.** Keys are compared with
  `crypto.timingSafeEqual` over SHA-256 digests, never `===`/`includes`
  (`src/auth/apiKeys.ts`), avoiding timing side-channels.
- **Protected operational surface.** `/dashboard` and `/metrics/summary` are
  public in dev/test but **protected in production** by default (`DASHBOARD_PUBLIC`),
  requiring an API key, `ADMIN_API_KEY`, or a JWT.
- **Per-caller cache isolation.** `CACHE_SCOPE=principal` (default) folds a hash of
  the caller identity into the cache key, so one caller's response is never served
  to another. The in-memory cache is bounded (LRU) to limit memory-exhaustion risk.
- **Environment & input validation.** All configuration and every request body are
  validated with Zod (fail-fast at boot; rejected before business logic).
- **Secret redaction in logs.** `authorization`, `x-api-key`, `cookie` and
  `set-cookie` are redacted. Prompts and request bodies are never logged.
- **Security headers.** `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` on every
  response; HSTS in production. The Swagger UI (static assets) is off by default in
  production; `/openapi.json` is always available.
- **Payload limits & rate limiting.** Request bodies are capped (1 MiB); a
  per-caller fixed-window limiter is backed by Redis when configured.
- **Resilient dependencies.** A corrupted Redis value is discarded (miss) instead
  of crashing the request; a disconnecting client aborts the upstream call.

## Dependency Policy

- CI runs `npm audit --audit-level=high` and **fails** on high/critical advisories.
- The dependency tree is kept clean via `overrides` in `package.json`: a patched
  `@fastify/static` and a patched `brace-expansion` (the latter resolving a
  DoS advisory pulled transitively through `@fastify/static`/eslint). **Dependabot**
  proposes weekly updates and **CodeQL** runs static analysis. As of the v1.1.0
  release, `npm audit` reports **0 vulnerabilities**.

## OWASP Alignment

The design maps to several OWASP API Security Top 10 items: broken authentication
(API-key/JWT, constant-time compare, rate limiting), security misconfiguration (env
validation, secure defaults, no silent mock, protected dashboard), unrestricted
resource consumption (timeouts, bounded retries, body limits, rate limits, bounded
cache), and vulnerable/outdated components (audit gate + Dependabot + CodeQL).
