// §3.3 advance action semantics (advanceCursor) + element context resolution
// (resolveContextItem) — pure engine helpers, one test per algorithm clause.
import { describe, expect, it } from 'vitest';
import type { Json } from '@loupe/protocol';
import type { Advance, Context, ResolveScope } from '../src/index.ts';
import { advanceCursor, resolveContextItem } from '../src/index.ts';

const findings = [
  { id: 'f1', sev: 'high', phase: 'undecided' },
  { id: 'f2', sev: 'high', phase: 'decided' },
  { id: 'f3', sev: 'low', phase: 'undecided' },
  { id: 'f4', sev: 'low', phase: 'undecided' },
];
const state: Json = { findings };
const scope = (cursorId: Json): ResolveScope => ({ state, ui: { cursorId } });

const pendingOnly: Advance = {
  list: '/findings',
  key: 'id',
  cursor: '/cursorId',
  dir: 'next',
  filter: { $bind: 'phase', eq: 'undecided' },
};
const prev = (spec: Advance): Advance => ({ ...spec, dir: 'prev' });
const unfiltered: Advance = { list: '/findings', key: 'id', cursor: '/cursorId', dir: 'next' };

describe('advanceCursor', () => {
  it('next/prev step to the adjacent item (no filter)', () => {
    expect(advanceCursor(unfiltered, scope('f2'))).toBe('f3');
    expect(advanceCursor(prev(unfiltered), scope('f2'))).toBe('f1');
  });

  it('filter skips ineligible items in both directions', () => {
    expect(advanceCursor(pendingOnly, scope('f1'))).toBe('f3'); // skips decided f2
    expect(advanceCursor(prev(pendingOnly), scope('f3'))).toBe('f1');
  });

  it('no anchor: next enters at the first eligible, prev at the last', () => {
    expect(advanceCursor(pendingOnly, scope(null))).toBe('f1');
    expect(advanceCursor(prev(pendingOnly), scope(null))).toBe('f4');
    // id vanished from the list behaves like no anchor
    expect(advanceCursor(pendingOnly, scope('gone'))).toBe('f1');
  });

  it('no anchor and nothing eligible → null (the all-done state)', () => {
    const allDecided: ResolveScope = {
      state: { findings: [{ id: 'f1', phase: 'decided' }] },
      ui: { cursorId: null },
    };
    expect(advanceCursor(pendingOnly, allDecided)).toBe(null);
    expect(advanceCursor(prev(pendingOnly), allDecided)).toBe(null);
  });

  it('clamps at both edges (eligible anchor, nothing further) → undefined', () => {
    expect(advanceCursor(pendingOnly, scope('f4'))).toBe(undefined);
    expect(advanceCursor(prev(pendingOnly), scope('f1'))).toBe(undefined);
  });

  it('ineligible anchor: forward first, then fallback behind, then null', () => {
    // decide-advance: f2 is decided; next lands on the eligible item after it
    expect(advanceCursor(pendingOnly, scope('f2'))).toBe('f3');
    // bottom-most pending decided: fall back to the pending one above
    const bottomDecided: ResolveScope = {
      state: {
        findings: [
          { id: 'f1', phase: 'undecided' },
          { id: 'f2', phase: 'decided' },
        ],
      },
      ui: { cursorId: 'f2' },
    };
    expect(advanceCursor(pendingOnly, bottomDecided)).toBe('f1');
    // prev mirrors: behind first, then forward
    const topDecided: ResolveScope = {
      state: {
        findings: [
          { id: 'f1', phase: 'decided' },
          { id: 'f2', phase: 'undecided' },
        ],
      },
      ui: { cursorId: 'f1' },
    };
    expect(advanceCursor(prev(pendingOnly), topDecided)).toBe('f2');
    // last pending of all decided → null clears the cursor
    const lastDecided: ResolveScope = {
      state: { findings: [{ id: 'f1', phase: 'decided' }] },
      ui: { cursorId: 'f1' },
    };
    expect(advanceCursor(pendingOnly, lastDecided)).toBe(null);
    expect(advanceCursor(prev(pendingOnly), lastDecided)).toBe(null);
  });

  it('null cursor never anchors against a null key field', () => {
    const nullKeyed: ResolveScope = {
      state: { findings: [{ id: null, phase: 'decided' }, { id: 'f2', phase: 'undecided' }] },
      ui: { cursorId: null },
    };
    // entry, not an ineligible-anchor walk from index 0
    expect(advanceCursor(pendingOnly, nullKeyed)).toBe('f2');
  });

  it('non-array projection → undefined no-op (never corrupts the ui doc)', () => {
    expect(advanceCursor(pendingOnly, { state: {}, ui: { cursorId: 'f1' } })).toBe(undefined);
    expect(advanceCursor(pendingOnly, { state: { findings: 'nope' }, ui: { cursorId: 'f1' } })).toBe(
      undefined,
    );
  });

  it('non-string key values anchor and return via deepEqual', () => {
    const spec: Advance = { list: '/rows', key: 'k', cursor: '/cur', dir: 'next' };
    const s: ResolveScope = {
      state: { rows: [{ k: { a: [1, 2] } }, { k: 7 }, { k: [true] }] },
      ui: { cur: { a: [1, 2] } },
    };
    expect(advanceCursor(spec, s)).toBe(7);
    expect(advanceCursor(spec, { ...s, ui: { cur: 7 } })).toEqual([true]);
  });

  it('filter $index (operand position) is the full-list position', () => {
    const spec: Advance = {
      list: '/rows',
      key: 'k',
      cursor: '/cur',
      dir: 'next',
      filter: { $bind: 'pos', eq: { $index: true } },
    };
    const s: ResolveScope = {
      state: { rows: [{ k: 'a', pos: 1 }, { k: 'b', pos: 1 }, { k: 'c', pos: 9 }] },
      ui: { cur: null },
    };
    expect(advanceCursor(spec, s)).toBe('b'); // only index 1 matches its own position
  });
});

describe('resolveContextItem', () => {
  const context: Context = { list: '/findings', key: 'id', at: '/cursorId' };

  it('hits the matching item with its full-list index', () => {
    expect(resolveContextItem(context, scope('f3'))).toEqual({ item: findings[2], index: 2 });
  });

  it('null or missing cursor → no item (never matches a null key field)', () => {
    expect(resolveContextItem(context, scope(null))).toBe(null);
    const nullKeyed: ResolveScope = {
      state: { findings: [{ id: null }] },
      ui: {},
    };
    expect(resolveContextItem(context, nullKeyed)).toBe(null);
  });

  it('no match → null', () => {
    expect(resolveContextItem(context, scope('gone'))).toBe(null);
  });

  it('non-array list → null', () => {
    expect(resolveContextItem(context, { state: { findings: 42 }, ui: { cursorId: 'f1' } })).toBe(null);
  });
});
