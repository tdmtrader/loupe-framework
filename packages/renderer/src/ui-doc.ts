// The client-local ui doc: lossable view ephemera only, initialized from the
// envelope's `ui`, mutated ONLY by {"ui": {...}} actions (merge-set; a literal
// null deletes), reset on remount by design. Nothing here is ever persisted
// or sent.
import type { Json } from '@loupe/protocol';
import { isPlainObject, pointerTokens, resolve } from '@loupe/spec';
import type { ResolveScope, UiSet } from '@loupe/spec';

/** Immutably set a value at an absolute pointer, creating objects on the way. */
export function setAtPointer(doc: Json, ptr: string, value: Json): Json {
  const tokens = pointerTokens(ptr);
  if (tokens.length === 0) return value;
  const walk = (node: Json, depth: number): Json => {
    const token = tokens[depth] as string;
    const base: Record<string, Json> = isPlainObject(node) ? { ...node } : {};
    base[token] =
      depth === tokens.length - 1 ? value : walk(base[token] ?? null, depth + 1);
    return base;
  };
  return walk(doc, 0);
}

/** Immutably delete the value at an absolute pointer (missing path: no-op). */
export function deleteAtPointer(doc: Json, ptr: string): Json {
  const tokens = pointerTokens(ptr);
  if (tokens.length === 0) return {};
  const walk = (node: Json, depth: number): Json => {
    if (!isPlainObject(node)) return node;
    const token = tokens[depth] as string;
    if (!Object.hasOwn(node, token)) return node;
    const base: Record<string, Json> = { ...node };
    if (depth === tokens.length - 1) {
      delete base[token];
    } else {
      base[token] = walk(base[token] as Json, depth + 1);
    }
    return base;
  };
  return walk(doc, 0);
}

/**
 * Apply a ui action's merge-set: each pointer gets its expression resolved in
 * `scope`. A LITERAL null deletes the path (§3.3); an expression that
 * resolves to null/undefined sets null (so declared-null ephemera like
 * cursorId stay present and `eq: null` conditions keep working).
 */
export function applyUiSet(
  doc: Json,
  set: UiSet,
  scope: ResolveScope,
  context?: { instance: string },
): Json {
  let next = doc;
  for (const [ptr, expr] of Object.entries(set)) {
    if (expr === null) {
      next = deleteAtPointer(next, ptr);
    } else {
      next = setAtPointer(next, ptr, resolve(expr, scope, context) ?? null);
    }
  }
  return next;
}
