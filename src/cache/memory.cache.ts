import type { Cache } from './cache.interface';

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * In-memory cache with lazy expiry. Perfect for local development,
 * tests and single-instance deployments; swap in Redis when you need
 * to share state across multiple instances.
 */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 1;
    }
    const next = (entry.value as number) + 1;
    entry.value = next;
    return next;
  }

  async pttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  async close(): Promise<void> {
    this.store.clear();
  }

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }
}
