import { env } from '../../config/env';
import type {
  ChatMessage,
  ChatRequest,
  EmbeddingsRequest,
  TokenUsage,
} from '../../types';
import { ProviderError } from '../../utils/errors';
import { fetchWithTimeout } from '../../utils/http';
import { parseSSE } from '../../utils/sse';
import { estimatePromptTokens, estimateTokens } from '../../services/tokens.service';
import type {
  Provider,
  ProviderChatResult,
  ProviderEmbeddingsResult,
  ProviderModel,
  ProviderStreamEvent,
} from '../types';

const MODELS: ProviderModel[] = [
  { id: 'claude-3-5-sonnet-latest', capabilities: ['chat', 'stream'] },
  { id: 'claude-3-5-haiku-latest', capabilities: ['chat', 'stream'] },
];
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Anthropic adapter for the Messages API. Anthropic keeps the system
 * prompt out of the messages array, so we split it out here and map the
 * SSE event shapes back onto the gateway's provider-agnostic stream.
 */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly isMock = false;
  readonly capabilities = ['chat'] as const;

  isConfigured(): boolean {
    return env.ANTHROPIC_API_KEY.length > 0;
  }

  listModels(): string[] {
    return MODELS.map((model) => model.id);
  }

  listModelInfos(): ProviderModel[] {
    return MODELS;
  }

  defaultChatModel(): string {
    return 'claude-3-5-haiku-latest';
  }

  defaultEmbeddingModel(): string {
    // Anthropic does not offer a first-party embeddings endpoint.
    throw new ProviderError(this.name, 'Anthropic does not support embeddings', 400);
  }

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ProviderChatResult> {
    const model = request.model ?? this.defaultChatModel();
    const { system, messages } = splitSystem(request.messages);
    const response = await this.post(
      {
        model,
        system,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
      signal,
    );
    const data = (await response.json()) as AnthropicMessage;
    const content = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    return { content, model: data.model ?? model, usage: mapUsage(data.usage) };
  }

  async *chatStream(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const model = request.model ?? this.defaultChatModel();
    const { system, messages } = splitSystem(request.messages);
    const response = await this.post(
      {
        model,
        system,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      },
      signal,
    );

    const promptTokens = estimatePromptTokens(request.messages);
    let completionText = '';
    let reportedOutput: number | undefined;

    for await (const payload of parseSSE(response.body)) {
      const event = safeParse<AnthropicStreamEvent>(payload);
      if (!event) continue;
      if (event.type === 'content_block_delta' && event.delta?.text) {
        completionText += event.delta.text;
        yield { type: 'delta', delta: event.delta.text };
      }
      if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
        reportedOutput = event.usage.output_tokens;
      }
    }

    const completionTokens = reportedOutput ?? estimateTokens(completionText);
    yield {
      type: 'done',
      model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async embeddings(
    _request: EmbeddingsRequest,
    _signal?: AbortSignal,
  ): Promise<ProviderEmbeddingsResult> {
    throw new ProviderError(this.name, 'Anthropic does not support embeddings', 400);
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const response = await fetchWithTimeout(
      `${env.ANTHROPIC_BASE_URL}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      env.REQUEST_TIMEOUT_MS,
      this.name,
      signal,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        this.name,
        `Anthropic responded ${response.status}`,
        response.status >= 500 ? 502 : response.status,
        detail.slice(0, 500),
      );
    }
    return response;
  }
}

/** Anthropic expects the system prompt as a top-level field, not a message. */
function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  messages: ChatMessage[];
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const rest = messages.filter((message) => message.role !== 'system');
  return { system: system || undefined, messages: rest };
}

function mapUsage(usage?: AnthropicUsage): TokenUsage {
  const promptTokens = usage?.input_tokens ?? 0;
  const completionTokens = usage?.output_tokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}
interface AnthropicMessage {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: AnthropicUsage;
}
interface AnthropicStreamEvent {
  type: string;
  delta?: { text?: string };
  usage?: { output_tokens?: number };
}
