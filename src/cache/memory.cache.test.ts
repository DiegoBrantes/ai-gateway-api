import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from './memory.cache';

describe('MemoryCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new MemoryCache();
    await cache.set('k', { hello: 'world' });
    expect(await cache.get('k')).toEqual({ hello: 'world' });
  });

  it('returns null for missing keys', async () => {
    const cache = new MemoryCache();
    expect(await cache.get('missing')).toBeNull();
  });

  it('expires values after their TTL', async () => {
    vi.useFakeTimers();
    const cache = new MemoryCache();
    await cache.set('temp', 42, 1);
    expect(await cache.get('temp')).toBe(42);
    vi.advanceTimersByTime(1_500);
    expect(await cache.get('temp')).toBeNull();
    vi.useRealTimers();
  });

  it('increments counters within a window', async () => {
    const cache = new MemoryCache();
    expect(await cache.increment('c', 60)).toBe(1);
    expect(await cache.increment('c', 60)).toBe(2);
    expect(await cache.increment('c', 60)).toBe(3);
  });

  it('reports remaining ttl', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 1, 10);
    const ttl = await cache.pttl('k');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10_000);
  });
});
