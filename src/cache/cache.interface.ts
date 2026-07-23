/**
 * Storage-agnostic cache contract. The gateway uses it for response
 * caching and for the rate-limiter's counters, so both Redis (shared,
 * multi-instance) and in-memory (single-instance, zero-dependency)
 * back-ends can be dropped in interchangeably.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  /** Atomic increment; returns the new value. Used by the rate limiter. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** Remaining TTL in ms, or -1 when the key has no expiry / is absent. */
  pttl(key: string): Promise<number>;
  close(): Promise<void>;
}
