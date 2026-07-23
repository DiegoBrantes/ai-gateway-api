import { describe, expect, it } from 'vitest';
import { estimateCost, priceFor } from './pricing';

describe('pricing', () => {
  it('computes cost from token counts using the per-model rate', () => {
    // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
    const cost = estimateCost('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(cost.promptCost).toBeCloseTo(0.15, 6);
    expect(cost.completionCost).toBeCloseTo(0.6, 6);
    expect(cost.totalCost).toBeCloseTo(0.75, 6);
    expect(cost.currency).toBe('USD');
  });

  it('falls back to zero cost for unknown models', () => {
    expect(priceFor('nonexistent-model')).toEqual({ input: 0, output: 0 });
    expect(estimateCost('nonexistent-model', 500, 500).totalCost).toBe(0);
  });

  it('charges nothing for output on embedding models', () => {
    const cost = estimateCost('text-embedding-3-small', 1_000_000, 0);
    expect(cost.completionCost).toBe(0);
    expect(cost.totalCost).toBeCloseTo(0.02, 6);
  });
});
