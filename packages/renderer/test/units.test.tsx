// Pure-module units: ui-doc merge-set semantics and optimistic patch mechanics.
import { describe, expect, it } from 'vitest';
import type { Json } from '@loupe/protocol';
import { applyPatchOps, applyUiSet, deleteAtPointer, instantiatePatchTemplate, setAtPointer } from '../src/index.ts';

describe('ui doc', () => {
  it('setAtPointer creates intermediate objects immutably', () => {
    const doc: Json = { cursorId: null };
    const next = setAtPointer(doc, '/compose/line', 12);
    expect(next).toEqual({ cursorId: null, compose: { line: 12 } });
    expect(doc).toEqual({ cursorId: null }); // untouched
  });
  it('deleteAtPointer removes; missing paths are a no-op', () => {
    expect(deleteAtPointer({ a: 1, b: 2 }, '/a')).toEqual({ b: 2 });
    expect(deleteAtPointer({ a: 1 }, '/nope/deep')).toEqual({ a: 1 });
  });
  it('applyUiSet: literal null deletes; expression-null sets null', () => {
    const scope = { state: { id: null } as Json, ui: {} as Json };
    const next = applyUiSet({ cursorId: 'f1', pane: 'x' }, { '/pane': null, '/cursorId': { $bind: '/id' } }, scope);
    expect(next).toEqual({ cursorId: null }); // pane deleted, cursorId set to resolved null
  });
  it('applyUiSet resolves expressions in scope', () => {
    const scope = { state: {} as Json, ui: {} as Json, item: { id: 'f7' } as Json };
    expect(applyUiSet({}, { '/cursorId': { $bind: 'id' } }, scope)).toEqual({ cursorId: 'f7' });
  });
});

describe('optimistic patches', () => {
  it('substitutes ${params.x}: whole-string keeps the type, inline stringifies', () => {
    const ops = instantiatePatchTemplate(
      [
        { op: 'replace', path: '/cards/${params.cardId}/lane', value: '${params.laneNo}' },
        { op: 'replace', path: '/note', value: 'moved ${params.cardId} to ${params.laneNo}' },
      ],
      { cardId: 'c1', laneNo: 3 },
    );
    expect(ops).toEqual([
      { op: 'replace', path: '/cards/c1/lane', value: 3 },
      { op: 'replace', path: '/note', value: 'moved c1 to 3' },
    ]);
  });
  it('applies add/replace/remove without mutating the snapshot', () => {
    const state: Json = { list: [1, 2], note: 'x' };
    const out = applyPatchOps(state, [
      { op: 'add', path: '/list/-', value: 3 },
      { op: 'replace', path: '/note', value: 'y' },
      { op: 'remove', path: '/list/0' },
    ]);
    expect(out).toEqual({ list: [2, 3], note: 'y' });
    expect(state).toEqual({ list: [1, 2], note: 'x' });
  });
  it('skips ops on missing paths (optimism self-heals, never throws)', () => {
    expect(applyPatchOps({ a: 1 }, [{ op: 'replace', path: '/missing/deep', value: 2 }])).toEqual({ a: 1 });
  });
  it('skips ops whose array tokens are not valid indices (never corrupts element 0)', () => {
    const state: Json = { items: [1, 2, 3] };
    // '' from a missing template param would coerce to splice(0, …); 'x' to NaN
    expect(applyPatchOps(state, [{ op: 'remove', path: '/items/' }])).toEqual({ items: [1, 2, 3] });
    expect(applyPatchOps(state, [{ op: 'remove', path: '/items/x' }])).toEqual({ items: [1, 2, 3] });
    expect(applyPatchOps(state, [{ op: 'replace', path: '/items/x', value: 9 }])).toEqual({ items: [1, 2, 3] });
    expect(applyPatchOps(state, [{ op: 'add', path: '/items/01', value: 9 }])).toEqual({ items: [1, 2, 3] });
    // bad token mid-path skips too
    expect(applyPatchOps({ rows: [{ v: 1 }] }, [{ op: 'replace', path: '/rows//v', value: 9 }])).toEqual({
      rows: [{ v: 1 }],
    });
    // a remove template with the param unfilled is exactly this shape
    const ops = instantiatePatchTemplate([{ op: 'remove', path: '/items/${params.idx}' }], {});
    expect(applyPatchOps(state, ops)).toEqual({ items: [1, 2, 3] });
    // valid indices and '-' append still work
    expect(applyPatchOps(state, [{ op: 'remove', path: '/items/1' }])).toEqual({ items: [1, 3] });
    expect(applyPatchOps(state, [{ op: 'add', path: '/items/-', value: 4 }])).toEqual({ items: [1, 2, 3, 4] });
  });
});

// ------------------------------------------------------------ advance action
// runActions' advance branch, exercised through a mounted renderer (the
// branch lives inside the component): writes go through setAtPointer (null is
// WRITTEN, never deleted), a failed verb aborts the sequence before the
// advance, and advance evaluates against the OVERLAID state.
import { render } from 'vitest-browser-react';
import type { AppDescriptor, VerbDecl, VerbResult } from '@loupe/protocol';
import type { ComponentDef, ComponentImplArgs, Fabrial, ImplRecord } from '@loupe/spec';
import type { LoupeClient } from '@loupe/protocol';
import { defineCatalog } from '@loupe/spec';
import type { ReactNode } from 'react';
import { LoupeRenderer } from '../src/index.ts';

const anyProps = (): ComponentDef['props'] =>
  ({ safeParse: () => ({ success: true }) }) as unknown as ComponentDef['props'];

const advCatalog = defineCatalog({
  name: 'amini',
  version: '1.0.0',
  components: {
    Stack: { props: anyProps() },
    Text: { props: anyProps() },
    Button: { props: anyProps(), events: ['press'] },
  },
});

type Args = ComponentImplArgs<ReactNode, Record<string, unknown>>;
const advImpls: ImplRecord<ReactNode> = {
  Stack: ((args: Args) => <div>{args.children}</div>) as ImplRecord<ReactNode>['Stack'],
  Text: ((args: Args) => <span>{String(args.props['text'])}</span>) as ImplRecord<ReactNode>['Text'],
  Button: ((args: Args) => (
    <button type="button" onClick={() => args.emit('press')}>
      {String(args.props['label'])}
    </button>
  )) as ImplRecord<ReactNode>['Button'],
};

const advVerbs: VerbDecl[] = [
  {
    name: 'decideIt',
    params: {
      type: 'object',
      properties: { findingId: { type: 'string' } },
      required: ['findingId'],
      additionalProperties: false,
    },
    // optimistic: the last row's decided flag flips before the authoritative
    // state lands (fixed index — patch templates address paths, not keys)
    optimistic: [{ op: 'replace', path: '/findings/2/phase', value: 'decided' }],
  },
];

class AdvFakeClient implements LoupeClient {
  seq = 1;
  state: Json;
  dispatched: Array<{ verb: string; params: Json }> = [];
  private resolvers: Array<(r: VerbResult) => void> = [];
  constructor(state: Json) {
    this.state = state;
  }
  describe(): Promise<AppDescriptor> {
    return Promise.resolve({
      protocol: 1,
      app: { name: 'fake', version: '0.0.0' },
      projections: [{ name: 'review' }],
      verbs: advVerbs,
      capabilities: { ws: false },
    });
  }
  snapshot(): Promise<{ seq: number; state: Json }> {
    return Promise.resolve({ seq: this.seq, state: this.state });
  }
  subscribe(_p: string, _params: Json, cb: (seq: number, state: Json) => void): () => void {
    cb(this.seq, this.state);
    return () => {};
  }
  dispatch(verb: string, params: Json): Promise<VerbResult> {
    this.dispatched.push({ verb, params });
    return new Promise((res) => this.resolvers.push(res));
  }
  records(stream: string): () => void {
    // The interface has it (R2 of "the agent inhabits the same state"); the
    // renderer must not: nothing in the fabrial dialect can name a stream.
    throw new Error(`the renderer subscribed to stream ${stream}; a fabrial reads projections only`);
  }
  resolveDispatch(result: VerbResult): void {
    const res = this.resolvers.shift();
    if (res === undefined) throw new Error('no in-flight dispatch');
    res(result);
  }
}

const ADV = (dir: 'next' | 'prev') => ({
  advance: {
    list: '/findings',
    key: 'id',
    cursor: '/cursorId',
    dir,
    filter: { $bind: 'phase', eq: 'undecided' },
  },
});

const advFabrial: Fabrial = {
  loupe: 1,
  fabrial: 'test/advance',
  version: 1,
  catalog: { name: 'amini', version: '1.0.0' },
  app: { name: 'fake', projection: 'review' },
  ui: { cursorId: null },
  root: 'screen',
  elements: {
    screen: { type: 'Stack', children: ['cursor-label', 'placeholder', 'row', 'down-btn'] },
    'cursor-label': { type: 'Text', props: { text: { $template: 'cursor=${ui:/cursorId}' } } },
    placeholder: {
      type: 'Text',
      visible: { $ui: '/cursorId', eq: null },
      props: { text: 'no cursor' },
    },
    // fired from INSIDE the repeat scope: advance stays absolute-rooted
    row: {
      type: 'Stack',
      repeat: { path: '/findings', key: 'id' },
      children: ['decide-btn'],
    },
    'decide-btn': {
      type: 'Button',
      props: { label: { $template: 'decide ${id}' } },
      on: {
        press: [
          { verb: 'decideIt', params: { findingId: { $bind: 'id' } } },
          ADV('next'),
        ],
      },
    },
    'down-btn': { type: 'Button', props: { label: 'down' }, on: { press: ADV('next') } },
  },
} as Fabrial;

const advState = (): Json => ({
  findings: [
    { id: 'f1', phase: 'undecided' },
    { id: 'f2', phase: 'decided' },
    { id: 'f3', phase: 'undecided' },
  ],
});

describe('runActions advance', () => {
  it('writes the cursor (setAtPointer) and skips filtered items, from inside a repeat scope', async () => {
    const client = new AdvFakeClient(advState());
    const screen = await render(
      <LoupeRenderer fabrial={advFabrial} catalog={advCatalog} components={advImpls} client={client} />,
    );
    await screen.getByRole('button', { name: 'down' }).click();
    await expect.element(screen.getByText('cursor=f1')).toBeVisible();
    await screen.getByRole('button', { name: 'down' }).click();
    await expect.element(screen.getByText('cursor=f3')).toBeVisible(); // f2 filtered out
    // clamp at the bottom: cursor stays
    await screen.getByRole('button', { name: 'down' }).click();
    await expect.element(screen.getByText('cursor=f3')).toBeVisible();
    expect(client.dispatched).toEqual([]);
  });

  it('a failing verb aborts the sequence — the advance after it never runs', async () => {
    const client = new AdvFakeClient(advState());
    const screen = await render(
      <LoupeRenderer fabrial={advFabrial} catalog={advCatalog} components={advImpls} client={client} />,
    );
    await screen.getByRole('button', { name: 'decide f1' }).click();
    client.resolveDispatch({ ok: false, error: { code: 'conflict', message: 'nope' } });
    // cursor untouched: null ⇒ the placeholder still shows
    await expect.element(screen.getByText('no cursor')).toBeVisible();
    await expect.element(screen.getByText('cursor=')).toBeVisible();
  });

  it('advance sees the optimistic overlay (the just-decided item is already ineligible)', async () => {
    const client = new AdvFakeClient(advState());
    const screen = await render(
      <LoupeRenderer fabrial={advFabrial} catalog={advCatalog} components={advImpls} client={client} />,
    );
    // decide f3 (bottom-most pending) with the cursor on it: the optimistic
    // overlay marks it decided before the advance runs, so the ineligible-
    // anchor fallback lands on the remaining pending row above (f1). Without
    // the overlay f3 would still be eligible and next would clamp in place.
    await screen.getByRole('button', { name: 'down' }).click();
    await screen.getByRole('button', { name: 'down' }).click();
    await expect.element(screen.getByText('cursor=f3')).toBeVisible();
    await screen.getByRole('button', { name: 'decide f3' }).click();
    client.resolveDispatch({ ok: true, seq: 2, records: [] });
    await expect.element(screen.getByText('cursor=f1')).toBeVisible();
  });

  it('an emptied navigation scope writes literal null — eq-null visibility returns', async () => {
    const oneLeft: Json = { findings: [{ id: 'f1', phase: 'decided' }] };
    const client = new AdvFakeClient(oneLeft);
    const screen = await render(
      <LoupeRenderer fabrial={advFabrial} catalog={advCatalog} components={advImpls} client={client} />,
    );
    await screen.getByRole('button', { name: 'down' }).click();
    // nothing eligible: null is WRITTEN via setAtPointer (not deleted), and
    // the `eq: null` placeholder keeps working
    await expect.element(screen.getByText('no cursor')).toBeVisible();
  });
});
