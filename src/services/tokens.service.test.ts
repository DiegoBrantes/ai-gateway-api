import { describe, expect, it } from 'vitest';
import { estimatePromptTokens, estimateTokens } from './tokens.service';

describe('token estimation', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~1 token per 4 characters (min 1)', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('sums message content plus per-message overhead', () => {
    const tokens = estimatePromptTokens([
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'efgh' },
    ]);
    // (1 + 3) + (1 + 3) = 8
    expect(tokens).toBe(8);
  });
});
