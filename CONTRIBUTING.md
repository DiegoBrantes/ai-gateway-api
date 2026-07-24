# Contributing

Thanks for your interest in improving **AI Gateway API**! This guide keeps
contributions consistent and easy to review.

## Getting started

```bash
git clone https://github.com/DiegoBrantes/ai-gateway-api.git
cd ai-gateway-api
npm install
cp .env.example .env
npm run dev
```

The gateway runs with a built-in mock provider when no API keys are set, so you
can develop and test without any credentials.

## Development workflow

1. Create a branch: `git checkout -b feat/short-description`.
2. Make your change, keeping it focused and small.
3. Ensure the quality gates pass locally:

   ```bash
   npm run typecheck   # strict TypeScript, no emit
   npm run lint        # ESLint
   npm run test        # Vitest
   npm run build       # production bundle
   ```

4. Open a pull request using the template; link any related issue.

## Adding a new provider

The architecture is designed for this to be a **single-file change**:

1. Create `src/providers/<name>/index.ts` implementing the `Provider` interface
   (`src/providers/types.ts`).
2. Register it in `src/providers/registry.ts`.
3. Add its models to the pricing table in `src/services/pricing.ts`.

No other file needs to change — that is the whole point of the abstraction.

## Coding standards

- **TypeScript strict**, no `any` unless justified with a comment.
- Follow the existing structure: controllers stay thin, business logic lives in
  services, provider specifics live in adapters.
- Prefer composition and dependency injection over inheritance.
- Comments explain **why**, not **what**.
- Keep functions small and named for intent.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:`.

## Reporting bugs / requesting features

Use the issue templates. Include reproduction steps and the affected version.
