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
  promptCost: number;
  completionCost: number;
  totalCost: number;
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

/** A single chunk emitted while streaming a chat completion. */
export interface ChatStreamChunk {
  delta: string;
  done: boolean;
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
  capabilities: Array<'chat' | 'embeddings' | 'vision'>;
}

export interface ProviderHealth {
  name: string;
  configured: boolean;
  models: string[];
}
