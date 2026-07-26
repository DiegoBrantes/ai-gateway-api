import { createHash, randomUUID } from 'node:crypto';
import { env } from '../config/env';
import type { Cache } from '../cache';
import type { ProviderRegistry } from '../providers/registry';
import type { Provider, ProviderStreamEvent } from '../providers/types';
import type {
  ChatRequest,
  ChatResponse,
  CostBreakdown,
  EmbeddingsRequest,
  EmbeddingsResponse,
  TokenUsage,
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
 * Events yielded by {@link GatewayService.chatStream}. Unlike the raw provider
 * events, these carry the resolved provider/model and (on `done`) the computed
 * cost and the list of providers attempted, so the HTTP layer can render a
 * self-describing SSE stream.
 */
export type GatewayStreamEvent =
  | { type: 'open'; provider: string; model: string; attempts: string[] }
  | { type: 'delta'; provider: string; delta: string }
  | {
      type: 'done';
      provider: string;
      model: string;
      usage: TokenUsage;
      cost: CostBreakdown;
      attempts: string[];
    };

/** Models we've already warned about missing pricing for (avoids log spam). */
const unpricedWarned = new Set<string>();

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

  async chat(
    request: ChatRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const startedAt = Date.now();
    const cacheKey = this.chatCacheKey(request, apiKey);

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
      const raw = await withRetry(() => provider.chat(request, signal), {
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
    warnIfUnpriced(raw.model, cost);
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
   * Streaming chat with real failover *before the first token*. Each provider
   * in the chain is tried (with bounded retries) until one successfully opens
   * its stream and yields its first event. Once bytes are flowing we never
   * switch providers — a mid-stream failure surfaces as a structured error.
   * Streaming responses are never cached (consumed once, incrementally).
   */
  async *chatStream(
    request: ChatRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GatewayStreamEvent, void, unknown> {
    const startedAt = Date.now();
    const attempts: string[] = [];
    const chain = this.buildChain(request.provider).filter(
      (provider) => provider.isConfigured() && provider.capabilities.includes('chat'),
    );
    if (chain.length === 0) {
      throw new ProviderError(
        'gateway',
        'No configured provider can handle this request',
        503,
      );
    }

    let chosen: Provider | undefined;
    let iterator: AsyncIterator<ProviderStreamEvent> | undefined;
    let firstResult: IteratorResult<ProviderStreamEvent> | undefined;
    let lastError: unknown;

    for (const provider of chain) {
      attempts.push(provider.name);
      try {
        const opened = await withRetry(
          async () => {
            const it = provider.chatStream(request, signal)[Symbol.asyncIterator]();
            const first = await it.next();
            return { it, first };
          },
          { retries: env.PROVIDER_MAX_RETRIES, isRetryable },
        );
        chosen = provider;
        iterator = opened.it;
        firstResult = opened.first;
        break;
      } catch (error) {
        lastError = error;
        logger.warn(
          { provider: provider.name, err: describe(error) },
          'Stream provider failed before first token — trying next in chain',
        );
        // Client errors won't be fixed by another provider.
        if (
          error instanceof AppError &&
          error.statusCode < 500 &&
          error.statusCode !== 429
        ) {
          throw error;
        }
      }
    }

    if (!chosen || !iterator || !firstResult) {
      throw new AllProvidersFailedError(attempts, describe(lastError));
    }

    yield {
      type: 'open',
      provider: chosen.name,
      model: request.model ?? chosen.defaultChatModel(),
      attempts: [...attempts],
    };

    let lastEvent: ProviderStreamEvent | undefined;
    let result = firstResult;
    while (!result.done) {
      const event = result.value;
      lastEvent = event;
      if (event.type === 'delta') {
        yield { type: 'delta', provider: chosen.name, delta: event.delta };
      }
      // A failure here is AFTER the first token — it propagates (no failover).
      result = await iterator.next();
    }

    if (lastEvent?.type === 'done') {
      const cost = estimateCost(
        lastEvent.model,
        lastEvent.usage.promptTokens,
        lastEvent.usage.completionTokens,
      );
      warnIfUnpriced(lastEvent.model, cost);
      this.deps.metrics.record({
        apiKey,
        provider: chosen.name,
        model: lastEvent.model,
        operation: 'chat_stream',
        usage: lastEvent.usage,
        cost,
        cached: false,
        latencyMs: Date.now() - startedAt,
      });
      yield {
        type: 'done',
        provider: chosen.name,
        model: lastEvent.model,
        usage: lastEvent.usage,
        cost,
        attempts: [...attempts],
      };
    }
  }

  async embeddings(
    request: EmbeddingsRequest,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<EmbeddingsResponse> {
    const startedAt = Date.now();
    const attempts: string[] = [];
    const provider = await this.runChain(
      request.provider,
      attempts,
      async (p) => p,
      (p) => p.capabilities.includes('embeddings'),
    );

    const raw = await withRetry(() => provider.embeddings(request, signal), {
      retries: env.PROVIDER_MAX_RETRIES,
      isRetryable,
    });
    const cost = estimateCost(raw.model, raw.usage.promptTokens, 0);
    warnIfUnpriced(raw.model, cost);
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
    // Keep the mock as a last resort only when it's registered (dev/test, or
    // production with ALLOW_MOCK_PROVIDER) and nothing else is configured.
    const mock = this.deps.registry.get('mock');
    if (mock && !seen.has('mock') && chain.every((p) => !p.isConfigured())) {
      chain.push(mock);
    }
    return chain;
  }

  /**
   * Deterministic cache key. Includes every parameter that changes the answer.
   * When `CACHE_SCOPE=principal` (the default) the caller identity is folded in
   * so one caller's response is never served to another; `global` opts into a
   * shared cache. The raw API key is never used — only a hash of the principal.
   */
  private chatCacheKey(request: ChatRequest, principal: string): string {
    const material = JSON.stringify({
      p: request.provider ?? env.DEFAULT_PROVIDER,
      m: request.model,
      t: request.temperature,
      mt: request.maxTokens,
      msg: request.messages,
    });
    const digest = createHash('sha256').update(material).digest('hex');
    if (env.CACHE_SCOPE === 'principal') {
      const who = createHash('sha256').update(principal).digest('hex').slice(0, 16);
      return `chat:${who}:${digest}`;
    }
    return `chat:${digest}`;
  }
}

function warnIfUnpriced(model: string, cost: CostBreakdown): void {
  if (!cost.pricingKnown && !unpricedWarned.has(model)) {
    unpricedWarned.add(model);
    logger.warn(
      { model },
      'No pricing entry for model — cost reported as null (not zero). Update src/services/pricing.ts.',
    );
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
