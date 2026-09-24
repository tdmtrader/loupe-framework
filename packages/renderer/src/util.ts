// Small pure helpers shared by the renderer internals. (Json-shape helpers —
// isPlainObject, deepEqual, unwrapField — live in @loupe/spec engine utils.)
import type { Json } from '@loupe/protocol';

/**
 * Deep equality over resolved-prop values. Functions compare equal to
 * functions (UiBinding.set / emit / itemSlot are behaviorally stable across
 * renders; their identity churn must not defeat memoization).
 */
export function looseDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => looseDeepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) =>
        Object.hasOwn(b as object, k) &&
        looseDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** structuredClone for Json (undefined in, {} out). */
export function cloneJson(v: Json | undefined): Json {
  return v === undefined ? {} : (structuredClone(v) as Json);
}
