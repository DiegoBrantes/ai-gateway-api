import { describe, expect, it } from 'vitest';
import {
  assertProductionSecrets,
  assertProviderPolicy,
  hasRealProvider,
  type Env,
} from './env';

function makeEnv(overrides: Partial<Env>): Env {
  return {
    NODE_ENV: 'production',
    API_KEYS: ['a-strong-key'],
    ADMIN_API_KEY: '',
    JWT_SECRET: 'a-strong-secret',
    // Only the fields exercised by the guard matter; the rest are filled
    // with representative defaults to satisfy the type.
    HOST: '0.0.0.0',
    PORT: 3000,
    LOG_LEVEL: 'info',
    JWT_EXPIRES_IN: '1h',
    RATE_LIMIT_MAX: 60,
    RATE_LIMIT_WINDOW_MS: 60_000,
    REDIS_URL: '',
    CACHE_TTL_SECONDS: 300,
    CACHE_SCOPE: 'principal',
    MEMORY_CACHE_MAX_ENTRIES: 10_000,
    DEFAULT_PROVIDER: 'openai',
    FALLBACK_PROVIDERS: [],
    ALLOW_MOCK_PROVIDER: undefined,
    DASHBOARD_PUBLIC: undefined,
    ENABLE_SWAGGER_UI: undefined,
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    REQUEST_TIMEOUT_MS: 30_000,
    PROVIDER_MAX_RETRIES: 2,
    ...overrides,
  };
}

describe('assertProductionSecrets', () => {
  it('allows strong secrets in production', () => {
    expect(() => assertProductionSecrets(makeEnv({}))).not.toThrow();
  });

  it('never blocks outside production', () => {
    const env = makeEnv({
      NODE_ENV: 'development',
      API_KEYS: ['dev-key-please-change'],
      JWT_SECRET: 'change-me-in-production',
    });
    expect(() => assertProductionSecrets(env)).not.toThrow();
  });

  it('rejects the example API key in production', () => {
    const env = makeEnv({ API_KEYS: ['dev-key-please-change'] });
    expect(() => assertProductionSecrets(env)).toThrow(/example key/);
  });

  it('rejects an empty API key list in production', () => {
    const env = makeEnv({ API_KEYS: [] });
    expect(() => assertProductionSecrets(env)).toThrow(/API_KEYS must be set/);
  });

  it('rejects the example JWT secret in production', () => {
    const env = makeEnv({ JWT_SECRET: 'change-me-in-production' });
    expect(() => assertProductionSecrets(env)).toThrow(/JWT_SECRET/);
  });
});

describe('assertProviderPolicy (no silent mock in production)', () => {
  it('allows development without any real provider', () => {
    const env = makeEnv({ NODE_ENV: 'development' });
    expect(hasRealProvider(env)).toBe(false);
    expect(() => assertProviderPolicy(env)).not.toThrow();
  });

  it('allows test without any real provider', () => {
    const env = makeEnv({ NODE_ENV: 'test' });
    expect(() => assertProviderPolicy(env)).not.toThrow();
  });

  it('refuses to boot in production with no real provider and mock not allowed', () => {
    const env = makeEnv({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDER: undefined });
    expect(() => assertProviderPolicy(env)).toThrow(/no real provider configured/);
  });

  it('boots in production when a real provider is configured', () => {
    const env = makeEnv({ NODE_ENV: 'production', OPENAI_API_KEY: 'sk-real' });
    expect(hasRealProvider(env)).toBe(true);
    expect(() => assertProviderPolicy(env)).not.toThrow();
  });

  it('boots in production with mock explicitly authorized', () => {
    const env = makeEnv({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDER: true });
    expect(() => assertProviderPolicy(env)).not.toThrow();
  });
});
