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
- **Environment validation.** All configuration is validated with Zod at boot
  (fail-fast) — a malformed environment never reaches request handling.
- **Input validation.** Every request body is validated with Zod before it
  touches business logic.
- **Secret redaction in logs.** `authorization`, `x-api-key`, `cookie` and
  `set-cookie` are redacted by the logger. Prompts and request bodies are never
  logged.
- **Security headers.** `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` on every
  response; HSTS in production.
- **Payload limits.** Request bodies are capped (1 MiB) to mitigate
  oversized-payload abuse.
- **Rate limiting.** Per-caller fixed-window limiter, backed by Redis when
  configured (atomic counters across instances).
- **Least dependencies.** Providers are reached via the native `fetch`; the
  dependency surface is intentionally small.

## OWASP Alignment

The design maps to several OWASP API Security Top 10 items: broken authentication
(API-key/JWT + rate limiting), security misconfiguration (env validation, secure
defaults), and unrestricted resource consumption (timeouts, retries with bounds,
body limits, rate limits).
