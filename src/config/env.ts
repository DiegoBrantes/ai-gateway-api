import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment schema. Parsing happens once at boot; if anything is
 * missing or malformed the process fails fast with a readable report
 * instead of blowing up later at request time.
 */
const csv = () =>
  z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );

/**
 * Parse a boolean-ish env string. Returns `undefined` when unset so the
 * caller can apply an environment-specific default (e.g. "on in dev,
 * off in prod"). Accepts 1/true/yes/on (case-insensitive) as truthy.
 */
const boolFlag = () =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return undefined;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  API_KEYS: csv(),
  ADMIN_API_KEY: z.string().default(''),
  JWT_SECRET: z.string().min(1).default('change-me-in-production'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  REDIS_URL: z.string().default(''),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  /** Whether cache entries are isolated per caller or shared globally. */
  CACHE_SCOPE: z.enum(['principal', 'global']).default('principal'),
  /** Hard cap on the in-memory cache to bound memory use (LRU eviction). */
  MEMORY_CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(10_000),

  DEFAULT_PROVIDER: z.string().default('openai'),
  FALLBACK_PROVIDERS: csv(),
  /** Explicitly allow the built-in mock provider in production. */
  ALLOW_MOCK_PROVIDER: boolFlag(),
  /** Expose /dashboard and /metrics/summary without auth. */
  DASHBOARD_PUBLIC: boolFlag(),
  /** Mount the Swagger UI (static assets). The OpenAPI JSON is always served. */
  ENABLE_SWAGGER_UI: boolFlag(),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com/v1'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Fail fast — a misconfigured gateway must never start half-broken.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  assertProductionSecrets(parsed.data);
  assertProviderPolicy(parsed.data);
  return parsed.data;
}

/** Placeholder values shipped in `.env.example`; unsafe to run with in prod. */
const INSECURE_DEFAULTS = {
  apiKey: 'dev-key-please-change',
  jwtSecret: 'change-me-in-production',
} as const;

/**
 * Refuse to boot in production with placeholder or empty secrets. This closes
 * the most common real-world foot-gun: shipping the example credentials.
 * Exported for unit testing; called automatically during {@link loadEnv}.
 */
export function assertProductionSecrets(data: Env): void {
  if (data.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (data.API_KEYS.length === 0) {
    problems.push('API_KEYS must be set in production');
  }
  if (data.API_KEYS.includes(INSECURE_DEFAULTS.apiKey)) {
    problems.push('API_KEYS still contains the example key — rotate it');
  }
  if (data.JWT_SECRET === INSECURE_DEFAULTS.jwtSecret) {
    problems.push('JWT_SECRET is still the example value — set a strong secret');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure configuration:\n` +
        problems.map((p) => `  • ${p}`).join('\n'),
    );
  }
}

/** True when at least one real (non-mock) provider credential is present. */
export function hasRealProvider(data: Env): boolean {
  return [data.OPENAI_API_KEY, data.ANTHROPIC_API_KEY, data.GEMINI_API_KEY].some(
    (key) => key.length > 0,
  );
}

/**
 * In production, refuse to boot if no real provider is configured unless the
 * operator has explicitly opted into the mock provider. This prevents a
 * misconfigured deployment from silently serving simulated completions.
 * Exported for unit testing; called automatically during {@link loadEnv}.
 */
export function assertProviderPolicy(data: Env): void {
  if (data.NODE_ENV !== 'production') return;
  if (hasRealProvider(data)) return;
  if (data.ALLOW_MOCK_PROVIDER === true) return;
  throw new Error(
    'Refusing to start in production with no real provider configured.\n' +
      '  • Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY, or\n' +
      '  • set ALLOW_MOCK_PROVIDER=true to explicitly serve the mock provider.',
  );
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Derived policy flags with environment-aware defaults. Outside production the
 * defaults favour zero-friction local development; in production they default
 * to the safe/closed option and must be opted out of explicitly.
 */
export const mockAllowed = !isProduction || env.ALLOW_MOCK_PROVIDER === true;
export const dashboardPublic = env.DASHBOARD_PUBLIC ?? !isProduction;
export const swaggerUiEnabled = env.ENABLE_SWAGGER_UI ?? !isProduction;
