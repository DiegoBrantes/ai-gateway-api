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

  it('is reported healthy', async () => {
    expect(await new MemoryCache().healthy()).toBe(true);
  });

  it('evicts the least-recently-used entry past the size cap', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.get('a'); // touch 'a' → 'b' becomes LRU
    await cache.set('c', 3); // exceeds cap → evict 'b'
    expect(cache.size).toBe(2);
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
  });

  it('never exceeds the configured maximum', async () => {
    const cache = new MemoryCache(3);
    for (let i = 0; i < 10; i++) await cache.set(`k${i}`, i);
    expect(cache.size).toBe(3);
  });
});
