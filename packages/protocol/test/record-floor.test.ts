// The append-record floor is the only thing loupe says about stream contents:
// `at` + `actor`, everything else the app's. These tests pin it as a LOWER
// BOUND (extra keys ride along) rather than a record type.
import { describe, expect, it } from 'vitest';
import { foldLatest } from '../src/fold.ts';
import { zRecordFloor } from '../src/schemas.ts';

describe('zRecordFloor', () => {
  it('accepts a record carrying only at + actor', () => {
    const record = { at: '2026-08-29T04:33:42Z', actor: 'ada' };
    expect(zRecordFloor.parse(record)).toEqual(record);
  });

  it('passes app payload through untouched — the floor is a lower bound', () => {
    const record = {
      at: '2026-08-29T04:33:42Z',
      actor: 'ada',
      anything: { the: ['app', 'wants'] },
      count: 3,
      note: null,
    };
    expect(zRecordFloor.parse(record)).toEqual(record);
  });

  it('rejects a record missing at or actor, or with the wrong types', () => {
    expect(zRecordFloor.safeParse({ actor: 'ada' }).success).toBe(false);
    expect(zRecordFloor.safeParse({ at: '2026-08-29T04:33:42Z' }).success).toBe(false);
    expect(zRecordFloor.safeParse({ at: 12345, actor: 'ada' }).success).toBe(false);
    expect(zRecordFloor.safeParse({ at: '2026-08-29T04:33:42Z', actor: null }).success).toBe(false);
  });

  it('is all foldLatest needs: floor records fold with an app-named id', () => {
    const records = [
      { id: 'x', at: '2026-01-02T00:00:00Z', actor: 'a', payload: 'second' },
      { id: 'x', at: '2026-01-01T00:00:00Z', actor: 'a', payload: 'first' },
    ].map((r) => zRecordFloor.parse(r));
    const folded = foldLatest(records, { id: 'id', at: 'at', actor: 'actor' });
    expect(folded['x']?.['payload']).toBe('second');
  });
});
