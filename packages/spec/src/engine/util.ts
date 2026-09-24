// Small pure helpers shared across the engine (resolve/helpers/validate) and
// re-exported for the renderer — the single home for these; do not copy them.
import type { Json } from '@loupe/protocol';
import { isUiPointerSchema } from '../model/index.ts';

/** Narrow to a plain (non-array, non-null) object, preserving Json-ness. */
export function isPlainObject(v: Json | undefined): v is Record<string, Json>;
export function isPlainObject(v: unknown): v is Record<string, unknown>;
export function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Structural equality over Json (advanceCursor / resolveContextItem / conditions). */
export function deepEqual(rawA: Json | undefined, rawB: Json | undefined): boolean {
  // A missing pointer and an explicit null are indistinguishable to the closed
  // grammar: `exists` already treats them alike, and a ui merge-set uses null
  // to DELETE a path — so `eq: null` must keep matching after that delete.
  const a = rawA === undefined ? null : rawA;
  const b = rawB === undefined ? null : rawB;
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], (b as Record<string, Json>)[k]));
  }
  return false;
}

/**
 * Unwrap optional/default wrappers around a catalog prop field schema,
 * stopping at a ui-pointer schema (its mark must stay visible). Bounded to
 * four levels — deeper nesting than optional(default(...)) does not occur.
 */
export function unwrapField<T>(schema: T): T {
  let cur: T = schema;
  for (let i = 0; i < 4; i += 1) {
    if (isUiPointerSchema(cur)) return cur;
    const inner = (cur as { unwrap?: () => T }).unwrap?.();
    if (inner === undefined || inner === cur) return cur;
    cur = inner;
  }
  return cur;
}
