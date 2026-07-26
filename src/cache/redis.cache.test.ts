import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisCache } from './redis.cache';

/** Minimal in-memory fake of the ioredis surface RedisCache uses. */
function fakeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async incr(key: string) {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    },
    async expire() {
      return 1;
    },
    async pttl() {
      return 1000;
    },
    async ping() {
      return 'PONG';
    },
    async quit() {
      return 'OK';
    },
    ...overrides,
  } as unknown as Redis & { store: Map<string, string> };
}

describe('RedisCache', () => {
  it('round-trips a JSON value', async () => {
    const cache = new RedisCache(fakeRedis());
    await cache.set('k', { a: 1 }, 60);
    expect(await cache.get('k')).toEqual({ a: 1 });
  });

  it('returns null for a missing key', async () => {
    const cache = new RedisCache(fakeRedis());
    expect(await cache.get('missing')).toBeNull();
  });

  it('drops a corrupted entry and returns a miss (does not throw)', async () => {
    const client = fakeRedis();
    client.store.set('poison', '{not valid json');
    const cache = new RedisCache(client);
    expect(await cache.get('poison')).toBeNull();
    // The poison key was deleted.
    expect(client.store.has('poison')).toBe(false);
  });

  it('reports healthy when PING succeeds', async () => {
    expect(await new RedisCache(fakeRedis()).healthy()).toBe(true);
  });

  it('reports unhealthy when the client is down', async () => {
    const down = fakeRedis({ ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    expect(await new RedisCache(down).healthy()).toBe(false);
  });

  it('increments and sets expiry only on first increment', async () => {
    const expire = vi.fn().mockResolvedValue(1);
    const cache = new RedisCache(fakeRedis({ expire }));
    expect(await cache.increment('c', 60)).toBe(1);
    expect(await cache.increment('c', 60)).toBe(2);
    expect(expire).toHaveBeenCalledTimes(1);
  });
});
