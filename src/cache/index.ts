import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { Cache } from './cache.interface';
import { MemoryCache } from './memory.cache';
import { RedisCache } from './redis.cache';

export type { Cache } from './cache.interface';

/**
 * Choose a cache implementation from configuration. A REDIS_URL opts
 * into the shared Redis back-end; otherwise the in-memory cache keeps
 * the gateway dependency-free. If Redis is configured but unreachable
 * we log loudly and degrade to memory rather than failing to boot.
 */
export function buildCache(): Cache {
  if (!env.REDIS_URL) {
    logger.info('Using in-memory cache (set REDIS_URL to enable Redis)');
    return new MemoryCache();
  }

  try {
    const client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    client.on('error', (error) => logger.error({ err: error }, 'Redis error'));
    logger.info('Using Redis cache');
    return new RedisCache(client);
  } catch (error) {
    logger.error({ err: error }, 'Redis init failed — falling back to memory cache');
    return new MemoryCache();
  }
}
