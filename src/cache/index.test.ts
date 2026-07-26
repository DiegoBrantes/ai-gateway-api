import { describe, expect, it } from 'vitest';
import { buildCache } from './index';
import { MemoryCache } from './memory.cache';

describe('buildCache', () => {
  it('returns the in-memory cache when REDIS_URL is unset (test default)', () => {
    // vitest env leaves REDIS_URL empty, so the memory backend is selected.
    const cache = buildCache();
    expect(cache).toBeInstanceOf(MemoryCache);
  });
});
