import type { ChatRequest, EmbeddingsRequest } from '../../types';
import { estimatePromptTokens, estimateTokens } from '../../services/tokens.service';
import type {
  Provider,
  ProviderChatResult,
  ProviderEmbeddingsResult,
  ProviderModel,
  ProviderStreamEvent,
} from '../types';

const MODELS: ProviderModel[] = [
  { id: 'mock-chat', capabilities: ['chat', 'stream'] },
  { id: 'mock-embed', capabilities: ['embeddings'] },
];

/**
 * Deterministic in-process provider. It lets the gateway boot and the
 * test-suite run with zero credentials and zero network calls, while
 * still exercising the full request → usage → cost pipeline. Enabled
 * automatically when no real provider is configured.
 */
export class MockProvider implements Provider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly capabilities = ['chat', 'embeddings'] as const;

  isConfigured(): boolean {
    return true;
  }

  listModels(): string[] {
    return MODELS.map((model) => model.id);
  }

  listModelInfos(): ProviderModel[] {
    return MODELS;
  }

  defaultChatModel(): string {
    return 'mock-chat';
  }

  defaultEmbeddingModel(): string {
    return 'mock-embed';
  }

  async chat(request: ChatRequest, _signal?: AbortSignal): Promise<ProviderChatResult> {
    const content = this.reply(request);
    const promptTokens = estimatePromptTokens(request.messages);
    const completionTokens = estimateTokens(content);
    return {
      content,
      model: request.model ?? this.defaultChatModel(),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async *chatStream(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const content = this.reply(request);
    const promptTokens = estimatePromptTokens(request.messages);
    for (const word of content.split(' ')) {
      if (signal?.aborted) return;
      yield { type: 'delta', delta: `${word} ` };
    }
    const completionTokens = estimateTokens(content);
    yield {
      type: 'done',
      model: request.model ?? this.defaultChatModel(),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async embeddings(
    request: EmbeddingsRequest,
    _signal?: AbortSignal,
  ): Promise<ProviderEmbeddingsResult> {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const promptTokens = inputs.reduce((sum, text) => sum + estimateTokens(text), 0);
    return {
      // Small, stable pseudo-vectors derived from the input text.
      embeddings: inputs.map((text) => this.vectorFor(text)),
      model: request.model ?? this.defaultEmbeddingModel(),
      usage: { promptTokens, totalTokens: promptTokens },
    };
  }

  private reply(request: ChatRequest): string {
    const last = request.messages.at(-1)?.content ?? '';
    return `Esta é uma resposta simulada para: "${last.slice(0, 80)}"`;
  }

  private vectorFor(text: string): number[] {
    const seed = [...text].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Array.from({ length: 8 }, (_, i) =>
      Number((Math.sin(seed + i) / 2 + 0.5).toFixed(6)),
    );
  }
}
