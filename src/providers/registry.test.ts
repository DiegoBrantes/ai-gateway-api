import { describe, expect, it } from 'vitest';
import { buildRegistry, ProviderRegistry } from './registry';
import type { Provider } from './types';

describe('ProviderRegistry', () => {
  const fake = (name: string): Provider =>
    ({ name, isMock: name === 'mock' }) as Provider;

  it('looks up by name and lists all', () => {
    const registry = new ProviderRegistry([fake('openai'), fake('mock')]);
    expect(registry.get('openai')?.name).toBe('openai');
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.all().map((p) => p.name)).toEqual(['openai', 'mock']);
  });
});

describe('buildRegistry', () => {
  it('registers all real providers plus the mock in non-production', () => {
    const registry = buildRegistry();
    const names = registry.all().map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini']));
    // In test/dev the mock is allowed, so it is registered as a safety net.
    expect(registry.get('mock')?.isMock).toBe(true);
  });
});
