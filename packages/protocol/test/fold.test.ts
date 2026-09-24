import { describe, expect, it } from 'vitest';
import { foldLatest } from '../src/fold.ts';
import foldVector from '../vectors/fold.json';

const KEYS = { id: 'finding_id', at: 'at', actor: 'actor' };

describe('foldLatest', () => {
  it('passes the shared fold vector (vectors/fold.json)', () => {
    const folded = foldLatest(foldVector.records, foldVector.keys);
    expect(folded).toEqual(foldVector.expected);
  });

  it('is order-independent: any permutation folds to the same result', () => {
    const reversed = [...foldVector.records].reverse();
    expect(foldLatest(reversed, foldVector.keys)).toEqual(foldVector.expected);
    const rotated = [...foldVector.records.slice(3), ...foldVector.records.slice(0, 3)];
    expect(foldLatest(rotated, foldVector.keys)).toEqual(foldVector.expected);
  });

  it('latest wins by at', () => {
    const records = [
      { finding_id: 'a', status: 'old', actor: 'x', at: '2026-01-01T00:00:00Z' },
      { finding_id: 'a', status: 'new', actor: 'x', at: '2026-01-02T00:00:00Z' },
    ];
    expect(foldLatest(records, KEYS)['a']!.status).toBe('new');
  });

  it('ties on at break by lexicographic actor (last after ascending sort wins)', () => {
    const at = '2026-01-01T00:00:00Z';
    const records = [
      { finding_id: 'a', status: 'from-b', actor: 'bob', at },
      { finding_id: 'a', status: 'from-a', actor: 'alice', at },
    ];
    expect(foldLatest(records, KEYS)['a']!.status).toBe('from-b');
  });

  it('keys off the named fields, not hardcoded names', () => {
    const records = [
      { id: 'x', v: 1, when: '2026-01-01T00:00:00Z', who: 'a' },
      { id: 'x', v: 2, when: '2026-01-03T00:00:00Z', who: 'a' },
    ];
    const folded = foldLatest(records, { id: 'id', at: 'when', actor: 'who' });
    expect(folded['x']!.v).toBe(2);
  });

  it('returns an empty fold for no records', () => {
    expect(foldLatest([], KEYS)).toEqual({});
  });
});
