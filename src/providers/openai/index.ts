import { env } from '../../config/env';
import type { ChatRequest, EmbeddingsRequest, TokenUsage } from '../../types';
import { ProviderError } from '../../utils/errors';
import { fetchWithTimeout } from '../../utils/http';
import { parseSSE } from '../../utils/sse';
import { estimatePromptTokens, estimateTokens } from '../../services/tokens.service';
import type {
  Provider,
  ProviderChatResult,
  ProviderEmbeddingsResult,
  ProviderStreamEvent,
} from '../types';

const CHAT_MODELS = ['gpt-4o', 'gpt-4o-mini'];
const EMBEDDING_MODELS = ['text-embedding-3-small', 'text-embedding-3-large'];

/**
 * OpenAI adapter, talking to the standard `/chat/completions` and
 * `/embeddings` endpoints. Also works against any OpenAI-compatible
 * gateway by pointing OPENAI_BASE_URL elsewhere.
 */
export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  readonly capabilities = ['chat', 'embeddings', 'vision'] as const;

  isConfigured(): boolean {
    return env.OPENAI_API_KEY.length > 0;
  }

  listModels(): string[] {
    return [...CHAT_MODELS, ...EMBEDDING_MODELS];
  }

  defaultChatModel(): string {
    return 'gpt-4o-mini';
  }

  defaultEmbeddingModel(): string {
    return 'text-embedding-3-small';
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    const model = request.model ?? this.defaultChatModel();
    const response = await this.post('/chat/completions', {
      model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    });
    const data = (await response.json()) as OpenAIChatCompletion;
    const choice = data.choices?.[0];
    if (!choice) throw new ProviderError(this.name, 'Empty completion response');
    return {
      content: choice.message.content ?? '',
      model: data.model ?? model,
      usage: mapUsage(data.usage),
    };
  }

  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const model = request.model ?? this.defaultChatModel();
    const response = await this.post('/chat/completions', {
      model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    const promptTokens = estimatePromptTokens(request.messages);
    let completionText = '';
    let reportedUsage: TokenUsage | undefined;

    for await (const payload of parseSSE(response.body)) {
      const chunk = safeParse<OpenAIStreamChunk>(payload);
      if (!chunk) continue;
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        completionText += delta;
        yield { type: 'delta', delta };
      }
      if (chunk.usage) reportedUsage = mapUsage(chunk.usage);
    }

    const usage =
      reportedUsage ?? buildUsage(promptTokens, estimateTokens(completionText));
    yield { type: 'done', usage, model };
  }

  async embeddings(request: EmbeddingsRequest): Promise<ProviderEmbeddingsResult> {
    const model = request.model ?? this.defaultEmbeddingModel();
    const input = Array.isArray(request.input) ? request.input : [request.input];
    const response = await this.post('/embeddings', { model, input });
    const data = (await response.json()) as OpenAIEmbeddings;
    return {
      embeddings: data.data.map((item) => item.embedding),
      model: data.model ?? model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const response = await fetchWithTimeout(
      `${env.OPENAI_BASE_URL}${path}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
      env.REQUEST_TIMEOUT_MS,
      this.name,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        this.name,
        `OpenAI responded ${response.status}`,
        response.status >= 500 ? 502 : response.status,
        detail.slice(0, 500),
      );
    }
    return response;
  }
}

function mapUsage(usage?: OpenAIUsage): TokenUsage {
  return buildUsage(usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
}

function buildUsage(promptTokens: number, completionTokens: number): TokenUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Minimal vendor response shapes (only the fields we consume) ──────
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
interface OpenAIChatCompletion {
  model?: string;
  choices?: Array<{ message: { content?: string } }>;
  usage?: OpenAIUsage;
}
interface OpenAIStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: OpenAIUsage;
}
interface OpenAIEmbeddings {
  model?: string;
  data: Array<{ embedding: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}
