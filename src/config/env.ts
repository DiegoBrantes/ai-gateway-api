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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  API_KEYS: csv(),
  JWT_SECRET: z.string().min(1).default('change-me-in-production'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  REDIS_URL: z.string().default(''),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  DEFAULT_PROVIDER: z.string().default('openai'),
  FALLBACK_PROVIDERS: csv(),

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
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
