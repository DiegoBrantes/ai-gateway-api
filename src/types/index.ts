/**
 * Provider-agnostic domain model. Every provider adapter maps its
 * native request/response shape to these types, so the rest of the
 * application never depends on a specific vendor SDK.
 */

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Explicit provider override; falls back to the configured default. */
  provider?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  currency: 'USD';
  /** Dollar costs, or `null` when the model has no entry in the pricing table. */
  promptCost: number | null;
  completionCost: number | null;
  totalCost: number | null;
  /** Integer micro-dollars (1e-6 USD) for float-free accumulation; null when unknown. */
  costMicros: number | null;
  /** False when the model is absent from the pricing table (cost is unknown, not zero). */
  pricingKnown: boolean;
}

export interface ChatResponse {
  id: string;
  provider: string;
  model: string;
  content: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  /** Providers actually attempted before this one succeeded. */
  attempts: string[];
  latencyMs: number;
}

export interface EmbeddingsRequest {
  model?: string;
  input: string | string[];
  provider?: string;
}

export interface EmbeddingsResponse {
  provider: string;
  model: string;
  embeddings: number[][];
  usage: Pick<TokenUsage, 'promptTokens' | 'totalTokens'>;
  cost: CostBreakdown;
}

export interface ModelInfo {
  id: string;
  provider: string;
  capabilities: Array<'chat' | 'stream' | 'embeddings'>;
}

export interface ProviderHealth {
  name: string;
  configured: boolean;
  /** True for the built-in mock provider, so callers never confuse it. */
  mock: boolean;
  models: string[];
}
