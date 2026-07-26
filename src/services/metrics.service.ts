import type { CostBreakdown, TokenUsage } from '../types';
import { usd } from './pricing';

export interface UsageEvent {
  apiKey: string;
  provider: string;
  model: string;
  operation: 'chat' | 'chat_stream' | 'embeddings';
  usage: TokenUsage | Pick<TokenUsage, 'promptTokens' | 'totalTokens'>;
  cost: CostBreakdown;
  cached: boolean;
  latencyMs: number;
}

interface Aggregate {
  requests: number;
  cachedRequests: number;
  totalTokens: number;
  /** Integer micro-dollars — accumulated without floating-point drift. */
  totalCostMicros: number;
  /** Requests whose model had no pricing entry (cost unknown, excluded from cost). */
  unpricedRequests: number;
  totalCostUsd: number;
}

interface Totals extends Aggregate {
  byProvider: Record<string, Aggregate>;
  byModel: Record<string, Aggregate>;
}

/**
 * In-process usage aggregator that powers the `/dashboard` view and the
 * `/v1/usage` endpoint. Kept intentionally simple and per-instance and
 * IN-MEMORY: totals reset on restart and are NOT shared across instances.
 * For durable, cross-instance analytics, forward UsageEvents to a warehouse.
 */
export class MetricsService {
  private readonly totals: Totals = emptyTotals();
  private readonly byApiKey = new Map<string, Totals>();

  record(event: UsageEvent): void {
    apply(this.totals, event);
    const forKey = this.byApiKey.get(event.apiKey) ?? emptyTotals();
    apply(forKey, event);
    this.byApiKey.set(event.apiKey, forKey);
  }

  summary() {
    return {
      totals: this.totals,
      keys: this.byApiKey.size,
      /** Metrics are volatile: they reflect activity since process start. */
      inMemory: true,
    };
  }

  forApiKey(apiKey: string): Totals {
    return this.byApiKey.get(apiKey) ?? emptyTotals();
  }
}

function apply(target: Totals, event: UsageEvent): void {
  bump(target, event);
  target.byProvider[event.provider] = bump(
    target.byProvider[event.provider] ?? emptyAggregate(),
    event,
  );
  target.byModel[event.model] = bump(
    target.byModel[event.model] ?? emptyAggregate(),
    event,
  );
}

function bump<T extends Aggregate>(aggregate: T, event: UsageEvent): T {
  aggregate.requests += 1;
  if (event.cached) aggregate.cachedRequests += 1;
  aggregate.totalTokens += event.usage.totalTokens;
  if (event.cost.pricingKnown && event.cost.costMicros !== null) {
    aggregate.totalCostMicros += event.cost.costMicros;
  } else {
    aggregate.unpricedRequests += 1;
  }
  aggregate.totalCostUsd = usd(aggregate.totalCostMicros);
  return aggregate;
}

function emptyAggregate(): Aggregate {
  return {
    requests: 0,
    cachedRequests: 0,
    totalTokens: 0,
    totalCostMicros: 0,
    unpricedRequests: 0,
    totalCostUsd: 0,
  };
}

function emptyTotals(): Totals {
  return { ...emptyAggregate(), byProvider: {}, byModel: {} };
}
