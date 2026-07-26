import { describe, expect, it } from 'vitest';
import { estimateCost, priceFor, PRICING } from './pricing';

describe('pricing', () => {
  it('computes cost from token counts using the per-model rate', () => {
    // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
    const cost = estimateCost('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(cost.promptCost).toBeCloseTo(0.15, 6);
    expect(cost.completionCost).toBeCloseTo(0.6, 6);
    expect(cost.totalCost).toBeCloseTo(0.75, 6);
    expect(cost.currency).toBe('USD');
  });

  it('reports unknown pricing as null (never a misleading zero)', () => {
    expect(priceFor('nonexistent-model')).toBeUndefined();
    const cost = estimateCost('nonexistent-model', 500, 500);
    expect(cost.pricingKnown).toBe(false);
    expect(cost.totalCost).toBeNull();
    expect(cost.costMicros).toBeNull();
  });

  it('charges nothing for output on embedding models', () => {
    const cost = estimateCost('text-embedding-3-small', 1_000_000, 0);
    expect(cost.completionCost).toBe(0);
    expect(cost.totalCost).toBeCloseTo(0.02, 6);
    expect(cost.pricingKnown).toBe(true);
  });

  it('accumulates in integer micro-dollars', () => {
    const cost = estimateCost('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(cost.costMicros).toBe(750_000); // $0.75 → 750000 micro-USD
  });

  it('prices dated model snapshots by their base family', () => {
    // OpenAI returns e.g. "gpt-4o-mini-2024-07-18" for a "gpt-4o-mini" request.
    expect(priceFor('gpt-4o-mini-2024-07-18')).toEqual(PRICING['gpt-4o-mini']);
    expect(priceFor('gpt-4o-2024-08-06')).toEqual(PRICING['gpt-4o']);
    // Longest-prefix wins: a gpt-4o-mini snapshot must not match "gpt-4o".
    expect(priceFor('gpt-4o-mini-2024-07-18')).not.toEqual(PRICING['gpt-4o']);
    const cost = estimateCost('gpt-4o-mini-2024-07-18', 1_000_000, 0);
    expect(cost.pricingKnown).toBe(true);
    expect(cost.promptCost).toBeCloseTo(0.15, 6);
  });
});
