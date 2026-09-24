// Repeat/filter/visible semantics as pure helpers the renderer reuses (it
// must NOT reimplement them). §3.2.
import type { Json } from '@loupe/protocol';
import type { Advance, Condition, Context, Repeat, ResolveScope, Visible } from '../model/index.ts';
import { getPointer, isAbsolutePointer } from './pointer.ts';
import { evaluateConditionInternal } from './resolve.ts';
import { deepEqual, isPlainObject } from './util.ts';

export interface RepeatItem {
  item: Json;
  /** The render position among the expanded (post-filter) items. */
  index: number;
  /** The value of the item field named by repeat.key, stringified. */
  key: string;
}

/**
 * Expand a repeat: items at repeat.path (absolute pointer, or relative inside
 * an enclosing scope), filter applied item-scoped, in projection order.
 * Non-array targets expand to nothing. If repeat.key is missing (validation
 * rejects that, but the helper stays total) the key falls back to the index.
 */
export function expandRepeat(repeat: Repeat, scope: ResolveScope): RepeatItem[] {
  const target = isAbsolutePointer(repeat.path)
    ? getPointer(scope.state, repeat.path)
    : repeat.path === ''
      ? scope.item
      : getPointer(scope.item, repeat.path);
  if (!Array.isArray(target)) return [];
  const out: RepeatItem[] = [];
  const seen = new Map<string, number>();
  for (const item of target) {
    const itemScope: ResolveScope = { state: scope.state, ui: scope.ui, item, index: out.length };
    if (repeat.filter !== undefined && !evaluateConditionInternal(repeat.filter, itemScope)) {
      continue;
    }
    const keySource =
      repeat.key !== undefined &&
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.hasOwn(item, repeat.key)
        ? item[repeat.key]
        : undefined;
    const base =
      keySource === undefined || keySource === null || typeof keySource === 'object'
        ? String(out.length)
        : String(keySource);
    // Duplicate key-field values get a deterministic suffix ("x", "x#2", …)
    // so React keys and event-time scope lookups stay one-to-one with items.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ item, index: out.length, key: n === 1 ? base : `${base}#${n}` });
  }
  return out;
}

export function evaluateCondition(condition: Condition, scope: ResolveScope): boolean {
  return evaluateConditionInternal(condition, scope);
}

/** Absent visible = true. Invisible elements do not mount. */
export function evaluateVisible(visible: Visible | undefined, scope: ResolveScope): boolean {
  if (visible === undefined) return true;
  if (typeof visible === 'boolean') return visible;
  if ('$and' in visible && Array.isArray(visible.$and)) {
    return visible.$and.every((c) => evaluateConditionInternal(c, scope));
  }
  if ('$or' in visible && Array.isArray(visible.$or)) {
    return visible.$or.some((c) => evaluateConditionInternal(c, scope));
  }
  return evaluateConditionInternal(visible as Condition, scope);
}

// ------------------------------------------------------------ cursor advance

/**
 * Compute the next cursor value for an advance action. Pure. Returns the raw
 * key-field value of the target item (the same value a `press →
 * {"$bind":"id"}` would have set), null when the navigation scope is empty,
 * or undefined for "leave the cursor untouched" (no-op).
 *
 * `filter` is item-scoped with the same semantics as repeat.filter, except
 * that `$index` here is the FULL-LIST position, not the post-filter render
 * index (pathological to use, harmless to define).
 *
 * Convergence note for the decide-then-advance sequence: whether or not the
 * snapshot/optimistic overlay has folded the decide by the time advance runs,
 * the anchor-eligible and anchor-ineligible branches both land on "first
 * eligible after the anchor" except at boundaries — the race is benign by
 * construction.
 */
export function advanceCursor(spec: Advance, scope: ResolveScope): Json | undefined {
  const full = getPointer(scope.state, spec.list);
  // Not an array → no-op; the ui doc is never corrupted by a missing projection.
  if (!Array.isArray(full)) return undefined;

  const eligible = (i: number): boolean =>
    spec.filter === undefined ||
    evaluateConditionInternal(spec.filter, { state: scope.state, ui: scope.ui, item: full[i], index: i });
  const firstEligible = (from: number): number => {
    for (let i = Math.max(from, 0); i < full.length; i += 1) if (eligible(i)) return i;
    return -1;
  };
  const lastEligible = (until: number): number => {
    for (let i = Math.min(until, full.length - 1); i >= 0; i -= 1) if (eligible(i)) return i;
    return -1;
  };
  const value = (i: number): Json | undefined =>
    i === -1 ? null : isPlainObject(full[i]) ? (full[i] as Record<string, Json>)[spec.key] : undefined;

  // Guard: a null/missing cursor never anchors (never match a null cursor
  // against a null key field).
  const cursorValue = getPointer(scope.ui, spec.cursor);
  const anchor =
    cursorValue === null || cursorValue === undefined
      ? -1
      : full.findIndex((item) => isPlainObject(item) && deepEqual(item[spec.key], cursorValue));

  // No anchor (null cursor, or the id vanished from the list): enter at the
  // near edge; nothing eligible at all → null (the "all done" state).
  if (anchor === -1) {
    return value(spec.dir === 'next' ? firstEligible(0) : lastEligible(full.length - 1));
  }

  // Anchor eligible (plain ↑/↓ on a live row): step, clamped — at the edge
  // the cursor stays (undefined, no wrap).
  if (eligible(anchor)) {
    const target = spec.dir === 'next' ? firstEligible(anchor + 1) : lastEligible(anchor - 1);
    return target === -1 ? undefined : value(target);
  }

  // Anchor ineligible (the decide-advance case: the cursor item just left the
  // navigation scope): forward, then fall back behind, then null.
  const target =
    spec.dir === 'next'
      ? (firstEligible(anchor + 1) !== -1 ? firstEligible(anchor + 1) : lastEligible(anchor - 1))
      : (lastEligible(anchor - 1) !== -1 ? lastEligible(anchor - 1) : firstEligible(anchor + 1));
  return value(target);
}

// ------------------------------------------------------------- context scope

export interface ContextHit {
  item: Json;
  /** The FULL-list position of the hit (repeat indices are post-filter; there is no filter here). */
  index: number;
}

/**
 * Resolve a context declaration; null when there is no current item (null or
 * missing ui value at `at`, no match, or `list` is not an array). The renderer
 * must not reimplement this (same rule as expandRepeat).
 */
export function resolveContextItem(context: Context, scope: ResolveScope): ContextHit | null {
  const list = getPointer(scope.state, context.list);
  if (!Array.isArray(list)) return null;
  const at = getPointer(scope.ui, context.at);
  // Guard: a null cursor never matches a null key field.
  if (at === null || at === undefined) return null;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] as Json;
    if (isPlainObject(item) && deepEqual(item[context.key], at)) return { item, index: i };
  }
  return null;
}
