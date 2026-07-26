import type { CostBreakdown } from '../types';

/**
 * Per-model pricing table, expressed in USD per 1M tokens.
 * These are published list prices and can drift over time — they live
 * in one place precisely so updating them is a one-line change.
 *
 * IMPORTANT: costs derived from this table are ESTIMATES for observability,
 * not an invoice. They are only as accurate as (a) this table and (b) the
 * token counts (which are provider-reported when available, otherwise
 * heuristically estimated). Do not use them for billing.
 */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
}

/** Month the list prices below were last reviewed. Update when editing PRICING. */
export const PRICING_UPDATED_AT = '2025-01';

const PER_MILLION = 1_000_000;
const MICROS_PER_USD = 1_000_000;

export const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  // Anthropic
  'claude-3-5-sonnet-latest': { input: 3, output: 15 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4 },
  // Google Gemini — `-latest` aliases track the current generation; prices are
  // published list prices for that generation as of PRICING_UPDATED_AT.
  'gemini-flash-latest': { input: 0.3, output: 2.5 },
  'gemini-pro-latest': { input: 1.25, output: 10 },
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

/**
 * Returns the pricing for a model, or `undefined` when it is not in the table.
 * Providers often return a dated snapshot id (e.g. OpenAI answers a request for
 * `gpt-4o-mini` with `gpt-4o-mini-2024-07-18`), so after an exact miss we fall
 * back to the longest pricing key that is a hyphen-bounded prefix of the id —
 * pricing the snapshot by its base family. Genuinely unknown models still
 * return `undefined` (→ `pricingKnown:false`).
 */
export function priceFor(model: string): ModelPricing | undefined {
  const exact = PRICING[model];
  if (exact) return exact;

  let best: string | undefined;
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(`${key}-`) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  return best ? PRICING[best] : undefined;
}

/**
 * Estimate cost for a request. When the model is unknown, we return a breakdown
 * with `pricingKnown: false` and `null` costs — never a misleading `0`. Costs
 * are computed in integer micro-dollars to avoid floating-point drift when
 * accumulated across many requests.
 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): CostBreakdown {
  const pricing = priceFor(model);
  if (!pricing) {
    return {
      currency: 'USD',
      promptCost: null,
      completionCost: null,
      totalCost: null,
      costMicros: null,
      pricingKnown: false,
    };
  }

  const promptMicros = micros(promptTokens, pricing.input);
  const completionMicros = micros(completionTokens, pricing.output);
  const totalMicros = promptMicros + completionMicros;
  return {
    currency: 'USD',
    promptCost: usd(promptMicros),
    completionCost: usd(completionMicros),
    totalCost: usd(totalMicros),
    costMicros: totalMicros,
    pricingKnown: true,
  };
}

/** Integer micro-dollars for `tokens` at `perMillion` USD / 1M tokens. */
function micros(tokens: number, perMillion: number): number {
  return Math.round((tokens / PER_MILLION) * perMillion * MICROS_PER_USD);
}

/** Convert integer micro-dollars back to a USD number. */
export function usd(costMicros: number): number {
  return costMicros / MICROS_PER_USD;
}
