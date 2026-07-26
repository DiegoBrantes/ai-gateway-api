import type { ChatRequest, EmbeddingsRequest, TokenUsage } from '../types';

/**
 * Capabilities a specific model supports. Deliberately does NOT include
 * `vision`: the current domain model represents message content as a plain
 * string, so no adapter can accept image parts. Advertising `vision` would be
 * a false claim — it will be added here only when real multimodal support
 * (types, validation, tests) lands.
 */
export type ModelCapability = 'chat' | 'stream' | 'embeddings';

/** Per-model metadata surfaced by `GET /v1/models`. */
export interface ProviderModel {
  id: string;
  capabilities: ReadonlyArray<ModelCapability>;
}

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
  /** Whether this adapter is the built-in mock (vs. a real vendor). */
  readonly isMock: boolean;
  readonly capabilities: ReadonlyArray<'chat' | 'embeddings'>;

  /** True when the required credentials are present. */
  isConfigured(): boolean;
  /** Model ids only (used for provider status). */
  listModels(): string[];
  /** Per-model metadata with accurate capabilities. */
  listModelInfos(): ProviderModel[];
  defaultChatModel(): string;
  defaultEmbeddingModel(): string;

  chat(request: ChatRequest, signal?: AbortSignal): Promise<ProviderChatResult>;
  chatStream(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown>;
  embeddings(
    request: EmbeddingsRequest,
    signal?: AbortSignal,
  ): Promise<ProviderEmbeddingsResult>;
}
