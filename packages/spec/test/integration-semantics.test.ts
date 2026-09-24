// Semantics pinned down during integration (T7):
// 1. A missing pointer and an explicit null are indistinguishable to eq/neq —
//    a ui merge-set uses null to DELETE a path, and `exists` already treats
//    null and missing alike, so `eq: null` must keep matching after a delete.
// 2. Component event payloads become the relative scope for the event's
//    actions (renderer-side; the pure part — relative resolution over an
//    arbitrary payload object — is covered here).
import { describe, expect, it } from 'vitest';
import type { Condition, Context } from '../src/index.ts';
import { evaluateCondition, resolve, resolveContextItem } from '../src/index.ts';

const scope = { state: { a: { b: null as null } }, ui: { x: null as null } };

describe('null ≈ missing in eq/neq', () => {
  it('eq null matches a missing state pointer', () => {
    expect(evaluateCondition({ $bind: '/nope', eq: null }, scope)).toBe(true);
    expect(evaluateCondition({ $bind: '/a/b', eq: null }, scope)).toBe(true);
  });
  it('eq null matches a deleted (missing) ui pointer', () => {
    expect(evaluateCondition({ $ui: '/gone', eq: null }, scope)).toBe(true);
    expect(evaluateCondition({ $ui: '/x', eq: null }, scope)).toBe(true);
  });
  it('neq null is false for missing, true for a value', () => {
    expect(evaluateCondition({ $ui: '/gone', neq: null }, scope)).toBe(false);
    expect(evaluateCondition({ $bind: '/a', neq: null }, scope)).toBe(true);
  });
});

describe('event payloads as relative scope', () => {
  it('resolves single- and multi-segment relative binds over a payload item', () => {
    const s = { state: {}, ui: {}, item: { card: 'PAY-2129', toLane: 'ledger', at: { line: 7 } } };
    expect(resolve({ $bind: 'card' }, s)).toBe('PAY-2129');
    expect(resolve({ $bind: 'toLane' }, s)).toBe('ledger');
    expect(resolve({ $bind: 'at/line' }, s)).toBe(7);
  });
});

// 3. Hotkeys-with-context: the element's `when` props are item-aware — as the
//    cursor moves, resolveContextItem re-scopes and a key's Condition flips.
describe('context item scope drives hotkey guards', () => {
  const state = {
    findings: [
      { id: 'f1', phase: 'undecided' },
      { id: 'f2', phase: 'decided' },
    ],
  };
  const context: Context = { list: '/findings', key: 'id', at: '/cursorId' };
  const decideGuard: Condition = { $bind: 'phase', eq: 'undecided' };

  const guardAt = (cursorId: string | null): boolean => {
    const base = { state, ui: { cursorId } };
    const hit = resolveContextItem(context, base);
    const scoped =
      hit === null ? base : { ...base, item: hit.item, index: hit.index };
    return evaluateCondition(decideGuard, scoped);
  };

  it("a decide key's when flips as the cursor moves onto a decided item", () => {
    expect(guardAt('f1')).toBe(true); // live on a pending finding
    expect(guardAt('f2')).toBe(false); // dead on a decided one
  });
  it('no cursor item → relative conditions are false (keys stay dead)', () => {
    expect(guardAt(null)).toBe(false);
    expect(guardAt('gone')).toBe(false);
  });
});
