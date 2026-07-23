import { ProviderError } from './errors';

/**
 * fetch wrapper with an AbortController-based timeout. Node 20+ ships
 * a global fetch, so no HTTP client dependency is required.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(provider, `Request timed out after ${timeoutMs}ms`, 504);
    }
    throw new ProviderError(
      provider,
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry with exponential backoff and jitter. Only retries when the
 * predicate says the failure is transient (network blips, 5xx, 429).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;
    isRetryable: (error: unknown) => boolean;
    baseDelayMs?: number;
  },
): Promise<T> {
  const { retries, isRetryable, baseDelayMs = 200 } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) break;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
