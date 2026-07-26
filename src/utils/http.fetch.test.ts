import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from './errors';
import { fetchWithTimeout } from './http';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fetchWithTimeout', () => {
  it('returns the response when fetch resolves before the timeout', async () => {
    const response = new Response('ok', { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response),
    );
    const result = await fetchWithTimeout('http://x', {}, 1000, 'openai');
    expect(result).toBe(response);
  });

  it('clears the timeout timer on success (no dangling handles)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
    await fetchWithTimeout('http://x', {}, 1000, 'openai');
    expect(clearSpy).toHaveBeenCalled();
  });

  it('maps an AbortError (timeout) to a 504 ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    await expect(fetchWithTimeout('http://x', {}, 5, 'openai')).rejects.toMatchObject({
      statusCode: 504,
    });
  });

  it('maps a generic network error to a ProviderError (502)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const error = await fetchWithTimeout('http://x', {}, 1000, 'gemini').catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toContain('Network error');
  });

  it('reports a client cancellation (499) when the external signal aborts', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, _init: RequestInit) => {
        controller.abort();
        return Promise.reject(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        );
      }),
    );
    await expect(
      fetchWithTimeout('http://x', {}, 1000, 'openai', controller.signal),
    ).rejects.toMatchObject({ statusCode: 499 });
  });

  it('aborts immediately when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      (init.signal as AbortSignal).aborted
        ? Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        : Promise.resolve(new Response('late')),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchWithTimeout('http://x', {}, 1000, 'openai', controller.signal),
    ).rejects.toMatchObject({ statusCode: 499 });
  });
});
