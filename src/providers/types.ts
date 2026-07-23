import type {
  ChatRequest,
  ChatStreamChunk,
  EmbeddingsRequest,
  TokenUsage,
} from '../types';

/** Raw chat output from a provider, before the gateway adds cost/latency. */
export interface ProviderChatResult {
  content: string;
  model: string;
  usage: TokenUsage;
}

export interface ProviderEmbeddingsResult {
  embeddings: number[][];
  model: string;
  usage: Pick<TokenUsage, 'promptTokens' | 'totalTokens'>;
}

/** A single stream event: text deltas plus a terminal usage summary. */
export type ProviderStreamEvent =
  { type: 'delta'; delta: string } | { type: 'done'; usage: TokenUsage; model: string };

/**
 * Contract every provider adapter implements. The gateway depends only
 * on this interface — never on a concrete vendor — which is what makes
 * providers hot-swappable and the fallback chain possible.
 */
export interface Provider {
  readonly name: string;
  readonly capabilities: ReadonlyArray<'chat' | 'embeddings' | 'vision'>;

  /** True when the required credentials are present. */
  isConfigured(): boolean;
  listModels(): string[];
  defaultChatModel(): string;
  defaultEmbeddingModel(): string;

  chat(request: ChatRequest): Promise<ProviderChatResult>;
  chatStream(request: ChatRequest): AsyncGenerator<ProviderStreamEvent, void, unknown>;
  embeddings(request: EmbeddingsRequest): Promise<ProviderEmbeddingsResult>;
}

export type { ChatStreamChunk };
