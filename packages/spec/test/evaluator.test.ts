// §3.3 evaluator + §3.2 repeat/filter/visible helpers — pure, no DOM.
import { describe, expect, it } from 'vitest';
import type { Json } from '@loupe/protocol';
import type { Condition, ResolveScope } from '../src/index.ts';
import {
  evaluateCondition,
  evaluateVisible,
  expandRepeat,
  getPointer,
  pointerTokens,
  resolve,
} from '../src/index.ts';

const state: Json = {
  triage: { pendingCount: 4, total: 22, keptCount: 12, dropReasons: [{ reason: 'trivial', key: '1' }] },
  findings: [
    { id: 'f1', sev: 'high', decision: null, tags: ['a', 'b'] },
    { id: 'f2', sev: 'minor', decision: 'kept', tags: [] },
    { id: 'f3', sev: 'high', decision: 'dropped', tags: ['c'] },
  ],
  'weird/key': { '~tilde': 'escaped' },
  note: null,
};
const ui: Json = { cursorId: 'f2', pane: 'finding', dropPicking: false, draft: null };
const scope: ResolveScope = { state, ui };

describe('JSON Pointer (RFC 6901)', () => {
  it('tokenizes with ~0/~1 unescaping', () => {
    expect(pointerTokens('/weird~1key/~0tilde')).toEqual(['weird/key', '~tilde']);
    expect(pointerTokens('')).toEqual([]);
    expect(pointerTokens('a/b')).toEqual(['a', 'b']);
  });
  it('walks objects and arrays; misses are undefined', () => {
    expect(getPointer(state, '/findings/1/id')).toBe('f2');
    expect(getPointer(state, '/weird~1key/~0tilde')).toBe('escaped');
    expect(getPointer(state, '/findings/9/id')).toBeUndefined();
    expect(getPointer(state, '/findings/01')).toBeUndefined(); // no leading zeros
    expect(getPointer(state, '/nope/deep')).toBeUndefined();
    expect(getPointer(state, '/note')).toBeNull();
  });
});

describe('resolve(expr, scope) — the closed grammar', () => {
  it('literals are themselves', () => {
    expect(resolve('x', scope)).toBe('x');
    expect(resolve(42, scope)).toBe(42);
    expect(resolve(null, scope)).toBeNull();
    expect(resolve(false, scope)).toBe(false);
    expect(resolve([1, 'a'], scope)).toEqual([1, 'a']);
    expect(resolve({ plain: { data: 1 } }, scope)).toEqual({ plain: { data: 1 } });
  });
  it('$bind absolute reads the projection; $ui reads the ui doc', () => {
    expect(resolve({ $bind: '/triage/pendingCount' }, scope)).toBe(4);
    expect(resolve({ $ui: '/cursorId' }, scope)).toBe('f2');
    expect(resolve({ $bind: '/missing' }, scope)).toBeUndefined();
  });
  it('$bind relative reads the scope item; "" is the item itself', () => {
    const item = { id: 'f1', sev: 'high' };
    const s: ResolveScope = { state, ui, item, index: 0 };
    expect(resolve({ $bind: 'sev' }, s)).toBe('high');
    expect(resolve({ $bind: '' }, s)).toEqual(item);
    expect(resolve({ $index: true }, s)).toBe(0);
    // absolute pointers still reach outer data from inside a scope
    expect(resolve({ $bind: '/triage/total' }, s)).toBe(22);
  });
  it('$template interpolates state and ui:; null/undefined render ""', () => {
    expect(resolve({ $template: '${/triage/keptCount} kept of ${/triage/total}' }, scope)).toBe('12 kept of 22');
    expect(resolve({ $template: 'cursor=${ui:/cursorId}' }, scope)).toBe('cursor=f2');
    expect(resolve({ $template: '[${/note}][${/missing}][${ui:/draft}]' }, scope)).toBe('[][][]');
    const s: ResolveScope = { state, ui, item: { id: 'f1' }, index: 0 };
    expect(resolve({ $template: 'item ${id}' }, s)).toBe('item f1');
  });
  it('$cond selects branches; one nesting level works', () => {
    expect(
      resolve({ $cond: { $bind: '/triage/pendingCount', gt: 3 }, $then: 'busy', $else: 'quiet' }, scope),
    ).toBe('busy');
    const nested = {
      $cond: { $bind: 'decision', eq: null },
      $then: 'agent',
      $else: { $cond: { $bind: 'decision', eq: 'kept' }, $then: 'done', $else: 'muted' },
    };
    expect(resolve(nested, { state, ui, item: { decision: null } })).toBe('agent');
    expect(resolve(nested, { state, ui, item: { decision: 'kept' } })).toBe('done');
    expect(resolve(nested, { state, ui, item: { decision: 'dropped' } })).toBe('muted');
  });
  it('condition operands may be expressions ($ui vs $bind equality)', () => {
    const expr = { $cond: { $ui: '/cursorId', eq: { $bind: 'id' } }, $then: 'agent', $else: 'border' };
    expect(resolve(expr, { state, ui, item: { id: 'f2' } })).toBe('agent');
    expect(resolve(expr, { state, ui, item: { id: 'f1' } })).toBe('border');
  });
  it('all condition ops', () => {
    const c = (cond: Json) => evaluateCondition(cond as never, scope);
    expect(c({ $bind: '/triage/total', eq: 22 })).toBe(true);
    expect(c({ $bind: '/triage/total', neq: 22 })).toBe(false);
    expect(c({ $bind: '/triage/total', gt: 21 })).toBe(true);
    expect(c({ $bind: '/triage/total', gte: 22 })).toBe(true);
    expect(c({ $bind: '/triage/total', lt: 22 })).toBe(false);
    expect(c({ $bind: '/triage/total', lte: 22 })).toBe(true);
    expect(c({ $bind: '/findings/0/sev', in: ['high', 'blocking'] })).toBe(true);
    expect(c({ $bind: '/findings/1/sev', in: ['high', 'blocking'] })).toBe(false);
    expect(c({ $bind: '/triage', exists: true })).toBe(true);
    expect(c({ $bind: '/missing', exists: true })).toBe(false);
    expect(c({ $bind: '/note', exists: false })).toBe(true); // null counts as absent
    expect(c({ $ui: '/dropPicking', eq: false })).toBe(true);
    // gt on mixed types is false, not a crash
    expect(c({ $bind: '/findings/0/sev', gt: 3 })).toBe(false);
  });
  it('composite prop values resolve expressions anywhere inside', () => {
    const composed = {
      label: { $bind: '/findings/0/id' },
      nested: [{ n: { $template: '${/triage/total}' } }],
    };
    expect(resolve(composed, scope)).toEqual({ label: 'f1', nested: [{ n: '22' }] });
  });
});

describe('expandRepeat + filter + visible', () => {
  it('expands in projection order with string keys', () => {
    const items = expandRepeat({ path: '/findings', key: 'id' }, scope);
    expect(items.map((i) => i.key)).toEqual(['f1', 'f2', 'f3']);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2]);
  });
  it('filter is item-scoped; indices are post-filter render positions', () => {
    const pending = expandRepeat({ path: '/findings', key: 'id', filter: { $bind: 'decision', eq: null } }, scope);
    expect(pending.map((i) => i.key)).toEqual(['f1']);
    const settled = expandRepeat({ path: '/findings', key: 'id', filter: { $bind: 'decision', neq: null } }, scope);
    expect(settled.map((i) => i.key)).toEqual(['f2', 'f3']);
    expect(settled.map((i) => i.index)).toEqual([0, 1]);
  });
  it('non-array targets expand to nothing', () => {
    expect(expandRepeat({ path: '/triage', key: 'x' }, scope)).toEqual([]);
    expect(expandRepeat({ path: '/missing', key: 'x' }, scope)).toEqual([]);
  });
  it('nested repeats scope innermost: relative path reads the outer item', () => {
    const outer = expandRepeat({ path: '/findings', key: 'id' }, scope);
    const first = outer[0]!;
    const innerScope: ResolveScope = { state, ui, item: first.item, index: first.index };
    const inner = expandRepeat({ path: 'tags', key: '' }, innerScope);
    expect(inner.map((i) => i.item)).toEqual(['a', 'b']);
    // inside the inner scope, "" is the inner (string) item; absolute still works
    const innermost: ResolveScope = { state, ui, item: inner[1]!.item, index: 1 };
    expect(resolve({ $bind: '' }, innermost)).toBe('b');
    expect(resolve({ $bind: '/findings/0/id' }, innermost)).toBe('f1');
  });
  it('itemSlot scope items bind with ordinary relative pointers', () => {
    // the component supplies the scope object; relative binds hit its fields
    const slotScope: ResolveScope = { state, ui, item: { lane: { name: 'refunds' }, dropHint: null } };
    expect(resolve({ $bind: 'lane/name' }, slotScope)).toBe('refunds');
    expect(resolve({ $bind: 'dropHint' }, slotScope)).toBeNull();
    expect(resolve({ $cond: { $bind: 'dropHint', exists: true }, $then: 'hint', $else: 'none' }, slotScope)).toBe('none');
  });
  it('evaluateVisible: absent, boolean, condition, $and/$or', () => {
    expect(evaluateVisible(undefined, scope)).toBe(true);
    expect(evaluateVisible(false, scope)).toBe(false);
    expect(evaluateVisible({ $bind: '/triage/total', gt: 1 }, scope)).toBe(true);
    expect(
      evaluateVisible({ $and: [{ $bind: '/triage/total', gt: 1 }, { $ui: '/dropPicking', eq: true }] }, scope),
    ).toBe(false);
    expect(
      evaluateVisible({ $or: [{ $bind: '/triage/total', gt: 99 }, { $ui: '/pane', eq: 'finding' }] }, scope),
    ).toBe(true);
  });
});

describe('malformed dynamic forms stay total (never a crash)', () => {
  it('a {$cond,$then,$else} whose $cond is not a Condition is plain data', () => {
    const junk = { $cond: { $maybe: true }, $then: 'a', $else: 'b' };
    expect(resolve(junk, scope)).toEqual(junk); // resolves as a record, no throw
  });
  it('a condition with no $bind/$ui source evaluates to false', () => {
    expect(evaluateCondition({ eq: 1 } as unknown as Condition, scope)).toBe(false);
    // even exists:false is false without a source — malformed means false, not "matches missing"
    expect(evaluateCondition({ exists: false } as unknown as Condition, scope)).toBe(false);
  });
});

describe('expandRepeat duplicate keys', () => {
  it('suffixes repeated key-field values deterministically', () => {
    const dupScope: ResolveScope = {
      state: { rows: [{ id: 'x' }, { id: 'x' }, { id: 'y' }, { id: 'x' }] },
      ui: {},
    };
    const items = expandRepeat({ path: '/rows', key: 'id' }, dupScope);
    expect(items.map((i) => i.key)).toEqual(['x', 'x#2', 'y', 'x#3']);
    expect(items.map((i) => i.index)).toEqual([0, 1, 2, 3]);
  });
});
