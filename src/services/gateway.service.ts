import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import type { Cache } from '../cache';
import type { ProviderRegistry } from '../providers/registry';
import type { Provider, ProviderStreamEvent } from '../providers/types';
import type {
  ChatRequest,
  ChatResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from '../types';
import { AllProvidersFailedError, AppError, ProviderError } from '../utils/errors';
import { withRetry } from '../utils/http';
import { logger } from '../utils/logger';
import { estimateCost } from './pricing';
import type { MetricsService } from './metrics.service';

interface GatewayDeps {
  registry: ProviderRegistry;
  cache: Cache;
  metrics: MetricsService;
}

/**
 * The orchestration core. Given a provider-agnostic request it:
 *   1. builds the fallback chain (explicit provider → default → configured fallbacks),
 *   2. tries each provider with bounded retries and per-request timeouts,
 *   3. serves/points-to the cache for idempotent (non-streaming) calls,
 *   4. computes token usage + cost and emits a usage event.
 * Everything above it (HTTP layer, controllers) stays dumb.
 */
export class GatewayService {
  constructor(private readonly deps: GatewayDeps) {}

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const startedAt = Date.now();
    const cacheKey = this.chatCacheKey(request);

    const cached = await this.deps.cache.get<ChatResponse>(cacheKey);
    if (cached) {
      const response = { ...cached, latencyMs: Date.now() - startedAt };
      this.deps.metrics.record({
        apiKey,
        provider: response.provider,
        model: response.model,
        operation: 'chat',
        usage: response.usage,
        cost: response.cost,
        cached: true,
        latencyMs: response.latencyMs,
      });
      return response;
    }

    const attempts: string[] = [];
    const result = await this.runChain(request.provider, attempts, async (provider) => {
      const raw = await withRetry(() => provider.chat(request), {
        retries: env.PROVIDER_MAX_RETRIES,
        isRetryable,
      });
      return { provider, raw };
    });

    const { provider, raw } = result;
    const cost = estimateCost(
      raw.model,
      raw.usage.promptTokens,
      raw.usage.completionTokens,
    );
    const response: ChatResponse = {
      id: randomUUID(),
      provider: provider.name,
      model: raw.model,
      content: raw.content,
      usage: raw.usage,
      cost,
      attempts,
      latencyMs: Date.now() - startedAt,
    };

    await this.deps.cache.set(cacheKey, response, env.CACHE_TTL_SECONDS);
    this.deps.metrics.record({
      apiKey,
      provider: provider.name,
      model: raw.model,
      operation: 'chat',
      usage: raw.usage,
      cost,
      cached: false,
      latencyMs: response.latencyMs,
    });
    return response;
  }

  /**
   * Streaming chat. Yields provider-agnostic stream events and, on the
   * terminal `done` event, records usage/cost. Streaming responses are
   * never cached (they are consumed once, incrementally).
   */
  async *chatStream(
    request: ChatRequest,
    apiKey: string,
  ): AsyncGenerator<ProviderStreamEvent & { provider: string }, void, unknown> {
    const startedAt = Date.now();
    const attempts: string[] = [];
    // For streaming we only fail over while establishing the stream; once
    // bytes are flowing we cannot silently switch providers mid-response.
    const provider = await this.runChain(request.provider, attempts, async (p) => {
      // Probe by opening the generator lazily below; here we just pick a
      // configured provider. Actual failures surface on first iteration.
      return p;
    });

    let lastEvent: ProviderStreamEvent | undefined;
    for await (const event of provider.chatStream(request)) {
      lastEvent = event;
      yield { ...event, provider: provider.name };
    }

    if (lastEvent?.type === 'done') {
      const cost = estimateCost(
        lastEvent.model,
        lastEvent.usage.promptTokens,
        lastEvent.usage.completionTokens,
      );
      this.deps.metrics.record({
        apiKey,
        provider: provider.name,
        model: lastEvent.model,
        operation: 'chat_stream',
        usage: lastEvent.usage,
        cost,
        cached: false,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  async embeddings(
    request: EmbeddingsRequest,
    apiKey: string,
  ): Promise<EmbeddingsResponse> {
    const startedAt = Date.now();
    const attempts: string[] = [];
    const provider = await this.runChain(
      request.provider,
      attempts,
      async (p) => p,
      (p) => p.capabilities.includes('embeddings'),
    );

    const raw = await withRetry(() => provider.embeddings(request), {
      retries: env.PROVIDER_MAX_RETRIES,
      isRetryable,
    });
    const cost = estimateCost(raw.model, raw.usage.promptTokens, 0);
    const response: EmbeddingsResponse = {
      provider: provider.name,
      model: raw.model,
      embeddings: raw.embeddings,
      usage: raw.usage,
      cost,
    };
    this.deps.metrics.record({
      apiKey,
      provider: provider.name,
      model: raw.model,
      operation: 'embeddings',
      usage: raw.usage,
      cost,
      cached: false,
      latencyMs: Date.now() - startedAt,
    });
    return response;
  }

  /**
   * Walk the fallback chain, invoking `action` on each candidate until
   * one succeeds. Records every provider tried in `attempts`.
   */
  private async runChain<T>(
    explicit: string | undefined,
    attempts: string[],
    action: (provider: Provider) => Promise<T>,
    predicate: (provider: Provider) => boolean = () => true,
  ): Promise<T> {
    const chain = this.buildChain(explicit).filter(
      (provider) => provider.isConfigured() && predicate(provider),
    );
    if (chain.length === 0) {
      throw new ProviderError(
        'gateway',
        'No configured provider can handle this request',
        503,
      );
    }

    let lastError: unknown;
    for (const provider of chain) {
      attempts.push(provider.name);
      try {
        return await action(provider);
      } catch (error) {
        lastError = error;
        logger.warn(
          { provider: provider.name, err: describe(error) },
          'Provider failed, trying next in chain',
        );
        // Client errors (bad request, auth) are not worth failing over.
        if (
          error instanceof AppError &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error;
        }
      }
    }
    throw new AllProvidersFailedError(attempts, describe(lastError));
  }

  /** Ordered, de-duplicated provider chain. */
  private buildChain(explicit: string | undefined): Provider[] {
    const order = explicit
      ? [explicit]
      : [env.DEFAULT_PROVIDER, ...env.FALLBACK_PROVIDERS];
    const seen = new Set<string>();
    const chain: Provider[] = [];
    for (const name of order) {
      if (seen.has(name)) continue;
      seen.add(name);
      const provider = this.deps.registry.get(name);
      if (provider) chain.push(provider);
    }
    // Always keep the mock as a last resort in dev when nothing else is set up.
    const mock = this.deps.registry.get('mock');
    if (mock && !seen.has('mock') && chain.every((p) => !p.isConfigured())) {
      chain.push(mock);
    }
    return chain;
  }

  private chatCacheKey(request: ChatRequest): string {
    const material = JSON.stringify({
      p: request.provider ?? env.DEFAULT_PROVIDER,
      m: request.model,
      t: request.temperature,
      mt: request.maxTokens,
      msg: request.messages,
    });
    return `chat:${createHash('sha256').update(material).digest('hex')}`;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode >= 500 || error.statusCode === 429;
  }
  return error instanceof AppError ? error.statusCode >= 500 : true;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
