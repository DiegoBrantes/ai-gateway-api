import { ProviderError } from './errors';

/**
 * fetch wrapper with an AbortController-based timeout. Node 20+ ships
 * a global fetch, so no HTTP client dependency is required. An optional
 * external signal (e.g. the client having disconnected) is linked so the
 * upstream request is aborted promptly when the caller goes away.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  provider: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new ProviderError(provider, 'Request cancelled by client', 499);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(provider, `Request timed out after ${timeoutMs}ms`, 504);
    }
    throw new ProviderError(
      provider,
      `Network error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
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
