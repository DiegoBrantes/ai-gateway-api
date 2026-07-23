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

  /** Returns the provider or throws a caller-friendly error. */
  require(name: string): Provider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `Unknown provider "${name}". Available: ${this.names().join(', ')}`,
      );
    }
    return provider;
  }

  names(): string[] {
    return [...this.providers.keys()];
  }

  all(): Provider[] {
    return [...this.providers.values()];
  }
}

/**
 * Assemble the registry. Real providers are always registered (so the
 * `/providers` endpoint can report configuration status), and a mock is
 * added as a safety net so the gateway is usable with zero credentials.
 */
export function buildRegistry(): ProviderRegistry {
  const candidates: Provider[] = [
    new OpenAIProvider(),
    new AnthropicProvider(),
    new GeminiProvider(),
  ];

  const configured = candidates.filter((provider) => provider.isConfigured());
  if (configured.length === 0) {
    logger.warn(
      'No provider credentials found — enabling the built-in mock provider. ' +
        'Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY to use real models.',
    );
  } else {
    logger.info({ providers: configured.map((p) => p.name) }, 'Configured providers');
  }

  return new ProviderRegistry([...candidates, new MockProvider()]);
}
