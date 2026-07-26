import { isProduction, mockAllowed } from '../config/env';
import { logger } from '../utils/logger';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { MockProvider } from './mock';
import { OpenAIProvider } from './openai';
import type { Provider } from './types';

/**
 * Owns the set of live providers and answers "which provider handles X".
 * Built once at boot from configuration; the gateway service depends on
 * this registry rather than importing concrete providers directly.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(providers: Provider[]) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  all(): Provider[] {
    return [...this.providers.values()];
  }
}

/**
 * Assemble the registry. Real providers are always registered (so the
 * `/providers` endpoint can report configuration status). The mock provider
 * is registered only when allowed — always outside production, and in
 * production only when `ALLOW_MOCK_PROVIDER=true`. This prevents a
 * misconfigured production deployment from silently serving simulated
 * completions (the boot-time guard in `assertProviderPolicy` is the first line
 * of defence; this is the second).
 */
export function buildRegistry(): ProviderRegistry {
  const candidates: Provider[] = [
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GeminiProvider(),
  ];

  const configured = candidates.filter((provider) => provider.isConfigured());
  if (configured.length > 0) {
    logger.info({ providers: configured.map((p) => p.name) }, 'Configured providers');
  }

  const providers = [...candidates];
  if (mockAllowed) {
    providers.push(new MockProvider());
    if (configured.length === 0) {
      logger.warn(
        'No real provider credentials found — using the built-in mock provider. ' +
          'Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY to use real models.',
      );
    }
    if (isProduction) {
      logger.warn(
        'ALLOW_MOCK_PROVIDER is enabled in production — the gateway may serve ' +
          'simulated completions. Disable this once real providers are configured.',
      );
    }
  }

  return new ProviderRegistry(providers);
}
