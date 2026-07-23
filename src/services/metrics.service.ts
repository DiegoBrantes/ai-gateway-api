import type { CostBreakdown, TokenUsage } from '../types';

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
  totalCostUsd: number;
}

interface Totals extends Aggregate {
  byProvider: Record<string, Aggregate>;
  byModel: Record<string, Aggregate>;
}

/**
 * In-process usage aggregator that powers the `/dashboard` view and the
 * `/v1/usage` endpoint. Kept intentionally simple and per-instance;
 * for cross-instance analytics, forward UsageEvents to your warehouse.
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
  aggregate.totalCostUsd = round(aggregate.totalCostUsd + event.cost.totalCost);
  return aggregate;
}

function emptyAggregate(): Aggregate {
  return { requests: 0, cachedRequests: 0, totalTokens: 0, totalCostUsd: 0 };
}

function emptyTotals(): Totals {
  return { ...emptyAggregate(), byProvider: {}, byModel: {} };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
