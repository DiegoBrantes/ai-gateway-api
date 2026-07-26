import { describe, expect, it } from 'vitest';
import { matchesAdminKey, matchesAnyKey, secureEquals } from './apiKeys';

describe('secureEquals', () => {
  it('is true for identical strings', () => {
    expect(secureEquals('abc', 'abc')).toBe(true);
  });
  it('is false for different strings of equal length', () => {
    expect(secureEquals('abc', 'abd')).toBe(false);
  });
  it('is false for different lengths (no throw)', () => {
    expect(secureEquals('abc', 'abcd')).toBe(false);
  });
});

describe('matchesAnyKey', () => {
  const keys = ['key-one', 'key-two', 'key-three'];

  it('matches a valid key in the list', () => {
    expect(matchesAnyKey('key-two', keys)).toBe(true);
  });
  it('rejects an unknown key', () => {
    expect(matchesAnyKey('nope', keys)).toBe(false);
  });
  it('rejects a key of a different length', () => {
    expect(matchesAnyKey('key-twoo', keys)).toBe(false);
  });
  it('rejects an empty candidate', () => {
    expect(matchesAnyKey('', keys)).toBe(false);
  });
  it('rejects against an empty key list', () => {
    expect(matchesAnyKey('key-one', [])).toBe(false);
  });
});

describe('matchesAdminKey', () => {
  it('matches the configured admin key', () => {
    expect(matchesAdminKey('admin-secret', 'admin-secret')).toBe(true);
  });
  it('rejects when admin key is unset', () => {
    expect(matchesAdminKey('admin-secret', '')).toBe(false);
  });
  it('rejects a wrong candidate', () => {
    expect(matchesAdminKey('wrong', 'admin-secret')).toBe(false);
  });
});
