/**
 * Per-model pricing table, expressed in USD per 1M tokens.
 * These are published list prices and can drift over time — they live
 * in one place precisely so updating them is a one-line change.
 */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

const PER_MILLION = 1_000_000;

export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  // Anthropic
  'claude-3-5-sonnet-latest': { input: 3, output: 15 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
  // Google Gemini
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'text-embedding-004': { input: 0.0, output: 0 },
};

const FALLBACK_PRICING: ModelPricing = { input: 0, output: 0 };

export function priceFor(model: string): ModelPricing {
  return PRICING[model] ?? FALLBACK_PRICING;
}

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
) {
  const pricing = priceFor(model);
  const promptCost = (promptTokens / PER_MILLION) * pricing.input;
  const completionCost = (completionTokens / PER_MILLION) * pricing.output;
  return {
    currency: 'USD' as const,
    promptCost: round(promptCost),
    completionCost: round(completionCost),
    totalCost: round(promptCost + completionCost),
  };
}

function round(value: number): number {
  // 6 decimals is enough to represent sub-cent per-request costs.
  return Math.round(value * 1e6) / 1e6;
}
