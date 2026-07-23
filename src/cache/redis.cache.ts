import type { Redis } from 'ioredis';
import type { Cache } from './cache.interface';

/**
 * Redis-backed cache for multi-instance deployments. Values are stored
 * as JSON; counters use native INCR so rate limiting stays correct even
 * under concurrent requests across many gateway instances.
 */
export class RedisCache implements Cache {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, payload);
    }
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    // Only set the expiry on first increment so the window slides once.
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }

  async pttl(key: string): Promise<number> {
    return this.client.pttl(key);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
