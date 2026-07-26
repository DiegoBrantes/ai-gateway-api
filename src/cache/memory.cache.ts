import { env } from '../config/env';
import type { Cache } from './cache.interface';

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * In-memory cache with lazy expiry and a bounded size (approximate LRU).
 * Perfect for local development, tests and single-instance deployments; swap
 * in Redis when you need to share state across instances.
 *
 * Bounding matters: without a cap, a gateway that sees many distinct prompts
 * would grow its cache without limit. We use the insertion order of a `Map` as
 * a recency list — reads re-insert the key (moving it to the newest position),
 * and when the cap is exceeded the oldest key is evicted.
 */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = env.MEMORY_CACHE_MAX_ENTRIES) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    // Mark as most-recently-used.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Delete first so re-insertion refreshes recency order.
    this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
    this.evictIfNeeded();
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.set(key, { value: 1, expiresAt: Date.now() + ttlSeconds * 1000 });
      this.evictIfNeeded();
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

  async healthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.store.clear();
  }

  /** Current number of stored entries (exposed for tests/observability). */
  get size(): number {
    return this.store.size;
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      // First key is the oldest (least-recently-used).
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }
}
