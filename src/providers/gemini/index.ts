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

const CHAT_MODELS = ['gemini-1.5-pro', 'gemini-1.5-flash'];
const EMBEDDING_MODELS = ['text-embedding-004'];

/**
 * Google Gemini adapter. Gemini's schema differs the most from the
 * OpenAI shape — roles are `user`/`model`, messages are `contents` with
 * `parts`, and the system prompt is a dedicated `systemInstruction` —
 * so the mapping lives entirely inside this adapter.
 */
export class GeminiProvider implements Provider {
  readonly name = 'gemini';
  readonly capabilities = ['chat', 'embeddings', 'vision'] as const;

  isConfigured(): boolean {
    return env.GEMINI_API_KEY.length > 0;
  }

  listModels(): string[] {
    return [...CHAT_MODELS, ...EMBEDDING_MODELS];
  }

  defaultChatModel(): string {
    return 'gemini-1.5-flash';
  }

  defaultEmbeddingModel(): string {
    return 'text-embedding-004';
  }

  async chat(request: ChatRequest): Promise<ProviderChatResult> {
    const model = request.model ?? this.defaultChatModel();
    const response = await this.post(
      `/models/${model}:generateContent`,
      this.buildPayload(request),
    );
    const data = (await response.json()) as GeminiResponse;
    const content = extractText(data);
    return {
      content,
      model,
      usage: mapUsage(data.usageMetadata),
    };
  }

  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const model = request.model ?? this.defaultChatModel();
    const response = await this.post(
      `/models/${model}:streamGenerateContent?alt=sse`,
      this.buildPayload(request),
    );

    const promptTokens = estimatePromptTokens(request.messages);
    let completionText = '';
    let reportedUsage: TokenUsage | undefined;

    for await (const payload of parseSSE(response.body)) {
      const chunk = safeParse<GeminiResponse>(payload);
      if (!chunk) continue;
      const delta = extractText(chunk);
      if (delta) {
        completionText += delta;
        yield { type: 'delta', delta };
      }
      if (chunk.usageMetadata) reportedUsage = mapUsage(chunk.usageMetadata);
    }

    const usage =
      reportedUsage ?? buildUsage(promptTokens, estimateTokens(completionText));
    yield { type: 'done', usage, model };
  }

  async embeddings(request: EmbeddingsRequest): Promise<ProviderEmbeddingsResult> {
    const model = request.model ?? this.defaultEmbeddingModel();
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const response = await this.post(`/models/${model}:batchEmbedContents`, {
      requests: inputs.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      })),
    });
    const data = (await response.json()) as GeminiEmbeddings;
    const promptTokens = inputs.reduce((sum, text) => sum + estimateTokens(text), 0);
    return {
      embeddings: data.embeddings.map((item) => item.values),
      model,
      usage: { promptTokens, totalTokens: promptTokens },
    };
  }

  private buildPayload(request: ChatRequest) {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));
    return {
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    };
  }

  private async post(path: string, body: unknown): Promise<Response> {
    // Gemini authenticates via an API key query parameter.
    const separator = path.includes('?') ? '&' : '?';
    const url = `${env.GEMINI_BASE_URL}${path}${separator}key=${env.GEMINI_API_KEY}`;
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env.REQUEST_TIMEOUT_MS,
      this.name,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderError(
        this.name,
        `Gemini responded ${response.status}`,
        response.status >= 500 ? 502 : response.status,
        detail.slice(0, 500),
      );
    }
    return response;
  }
}

function extractText(data: GeminiResponse): string {
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');
}

function mapUsage(usage?: GeminiUsage): TokenUsage {
  return buildUsage(usage?.promptTokenCount ?? 0, usage?.candidatesTokenCount ?? 0);
}

function buildUsage(promptTokens: number, completionTokens: number): TokenUsage {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: GeminiUsage;
}
interface GeminiEmbeddings {
  embeddings: Array<{ values: number[] }>;
}
