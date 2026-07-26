import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time API-key matching. Comparing secrets with `===`/`Array.includes`
 * short-circuits on the first differing byte, leaking length/prefix information
 * through timing. We instead compare fixed-length SHA-256 digests with
 * `timingSafeEqual`, so the work is independent of where a mismatch occurs and
 * of the candidate's length.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time equality of two strings via their SHA-256 digests. */
export function secureEquals(a: string, b: string): boolean {
  // Digests are always 32 bytes, so timingSafeEqual never throws on length.
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * True when `candidate` matches any key in `keys`. Every key is checked (no
 * early return) so the timing does not reveal which key matched or how many
 * were compared. Returns false for an empty/whitespace candidate.
 */
export function matchesAnyKey(candidate: string, keys: readonly string[]): boolean {
  if (!candidate) return false;
  const target = digest(candidate);
  let matched = false;
  for (const key of keys) {
    if (timingSafeEqual(target, digest(key))) matched = true;
  }
  return matched;
}

/** Constant-time check against a single (possibly empty) admin key. */
export function matchesAdminKey(candidate: string, adminKey: string): boolean {
  if (!candidate || !adminKey) return false;
  return secureEquals(candidate, adminKey);
}
