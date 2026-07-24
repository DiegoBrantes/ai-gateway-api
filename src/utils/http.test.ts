import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './errors';
import { withRetry } from './http';

describe('withRetry', () => {
  const alwaysRetry = () => true;

  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { retries: 3, isRetryable: alwaysRetry });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('x', 'boom', 502))
      .mockRejectedValueOnce(new ProviderError('x', 'boom', 502))
      .mockResolvedValue('recovered');
    const result = await withRetry(fn, {
      retries: 3,
      isRetryable: alwaysRetry,
      baseDelayMs: 1,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the error is classified as non-retryable', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('x', 'bad input', 400));
    await expect(
      withRetry(fn, { retries: 3, isRetryable: () => false, baseDelayMs: 1 }),
    ).rejects.toThrow('bad input');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting the retry budget', async () => {
    const fn = vi.fn().mockRejectedValue(new ProviderError('x', 'still down', 503));
    await expect(
      withRetry(fn, { retries: 2, isRetryable: alwaysRetry, baseDelayMs: 1 }),
    ).rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
