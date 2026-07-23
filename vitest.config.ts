import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      API_KEYS: 'test-key',
      RATE_LIMIT_MAX: '1000',
      DEFAULT_PROVIDER: 'openai',
      FALLBACK_PROVIDERS: 'anthropic,gemini',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/**/types.ts'],
    },
  },
});
