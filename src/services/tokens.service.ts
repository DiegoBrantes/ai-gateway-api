import type { ChatMessage } from '../types';

/**
 * Lightweight token estimator. Exact tokenisation is model-specific and
 * would require shipping vendor tokenizers; for accounting, budgeting
 * and cache-key purposes a well-calibrated heuristic (~4 chars/token,
 * plus per-message overhead) is accurate enough and dependency-free.
 *
 * When a provider returns real usage numbers we always prefer those;
 * this estimator only fills the gaps (e.g. streaming responses).
 */
const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 3;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function estimatePromptTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(message.content) + PER_MESSAGE_OVERHEAD,
    0,
  );
}
