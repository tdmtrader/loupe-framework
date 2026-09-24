// Renderer browser-mode smoke: mini-catalog + fake LoupeClient proving bind
// render, repeat+filter, ui-action re-render, uiPointer bindings, verb
// dispatch with pending + optimistic overlay discard, confirm dialog, and the
// validation-failure error panel.
//
// @loupe/renderer deliberately has no zod dependency, so the mini-catalog defs
// use duck-typed prop schemas (safeParse / shape) — the real Zod interplay is
// covered by @loupe/spec's validator tests.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { loupeStd } from '@loupe/catalog';
import { components } from '@loupe/catalog/react';
import type {
  AppDescriptor,
  Json,
  JsonObject,
  LoupeClient,
  VerbDecl,
  VerbResult,
} from '@loupe/protocol';
import { UI_POINTER_MARK, defineCatalog } from '@loupe/spec';
import type { ComponentDef, ComponentImplArgs, Fabrial, ImplRecord, UiBinding } from '@loupe/spec';
import { useEffect, type ReactNode } from 'react';
import type { ConnectionState } from '@loupe/protocol';
import { LoupeRenderer } from '../src/index.ts';

let probeMounts = 0;

// ------------------------------------------------------------- mini catalog

type PropSchema = ComponentDef['props'];
const anyProps = (): PropSchema =>
  ({ safeParse: () => ({ success: true }) }) as unknown as PropSchema;
const notePropsSchema = (): PropSchema =>
  ({
    safeParse: () => ({ success: true }),
    shape: { bindUi: { description: UI_POINTER_MARK } },
  }) as unknown as PropSchema;

const miniCatalog = defineCatalog({
  name: 'rmini',
  version: '1.0.0',
  components: {
    Stack: { props: anyProps() },
    Text: { props: anyProps() },
    Button: { props: anyProps(), events: ['press'] },
    Note: { props: notePropsSchema() },
    Pinger: { props: anyProps(), events: ['ping'] },
    Bomb: { props: anyProps() },
    Probe: { props: anyProps() },
  },
});

type Args = ComponentImplArgs<ReactNode, Record<string, unknown>>;
const impls: ImplRecord<ReactNode> = {
  Stack: ((args: Args) => <div>{args.children}</div>) as ImplRecord<ReactNode>['Stack'],
  Text: ((args: Args) => <span>{String(args.props['text'])}</span>) as ImplRecord<ReactNode>['Text'],
  Button: ((args: Args) => (
    <button
      type="button"
      disabled={args.props['disabled'] === true}
      onClick={() => args.emit('press')}
    >
      {String(args.props['label'])}
    </button>
  )) as ImplRecord<ReactNode>['Button'],
  Pinger: ((args: Args) => (
    <button
      type="button"
      onClick={() => args.emit('ping', { card: 'PAY-1', toLane: 'ledger', at: { line: 7 } })}
    >
      ping
    </button>
  )) as ImplRecord<ReactNode>['Pinger'],
  Bomb: (() => {
    throw new Error('kaboom during render');
  }) as ImplRecord<ReactNode>['Bomb'],
  // Mount counter for remount-stability assertions (context re-scope must not
  // remount — instanceKey is stable across cursor moves).
  Probe: ((args: Args) => {
    useEffect(() => {
      probeMounts += 1;
    }, []);
    return <i>probe:{String(args.props['text'])}</i>;
  }) as ImplRecord<ReactNode>['Probe'],
  Note: ((args: Args) => {
    const binding = args.props['bindUi'] as UiBinding;
    return (
      <input
        aria-label="note"
        value={String(binding.value ?? '')}
        onChange={(e) => binding.set(e.target.value)}
      />
    );
  }) as ImplRecord<ReactNode>['Note'],
};

// -------------------------------------------------------------- fake client

const verbs: VerbDecl[] = [
  {
    name: 'keepIt',
    params: {
      type: 'object',
      properties: { findingId: { type: 'string' } },
      required: ['findingId'],
      additionalProperties: false,
    },
    optimistic: [{ op: 'replace', path: '/note', value: 'kept ${params.findingId}' }],
  },
  { name: 'undo', params: { type: 'object', properties: {}, additionalProperties: false } },
  // A first verb with no params of its own — the one whose side effect
  // re-derives the projection under the element that dispatched it.
  { name: 'writeIt', params: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'recordIt',
    params: {
      type: 'object',
      properties: { findingId: { type: 'string' } },
      required: ['findingId'],
      additionalProperties: false,
    },
  },
];

class FakeClient implements LoupeClient {
  seq = 1;
  state: Json;
  cb: ((seq: number, state: Json) => void) | null = null;
  dispatched: Array<{ verb: string; params: Json }> = [];
  subscribeCount = 0;
  lastSubscribeParams: Json = null;
  private resolvers: Array<(r: VerbResult) => void> = [];

  constructor(state: Json) {
    this.state = state;
  }
  describe(): Promise<AppDescriptor> {
    return Promise.resolve({
      protocol: 1,
      app: { name: 'fake', version: '0.0.0' },
      projections: [{ name: 'review' }],
      verbs,
      capabilities: { ws: false },
    });
  }
  snapshot(): Promise<{ seq: number; state: Json }> {
    return Promise.resolve({ seq: this.seq, state: this.state });
  }
  subscribe(_p: string, params: Json, cb: (seq: number, state: Json) => void): () => void {
    this.subscribeCount += 1;
    this.lastSubscribeParams = params;
    this.cb = cb;
    cb(this.seq, this.state);
    return () => {
      this.cb = null;
    };
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
  push(state: Json): number {
    this.seq += 1;
    this.state = state;
    this.cb?.(this.seq, state);
    return this.seq;
  }
}

// ------------------------------------------------------------------ fabrial

const smokeFabrial: Fabrial = {
  loupe: 1,
  fabrial: 'test/smoke',
  version: 1,
  catalog: { name: 'rmini', version: '1.0.0' },
  app: { name: 'fake', projection: 'review' },
  ui: { cursorId: null, draft: '', lastKeptId: null },
  root: 'screen',
  elements: {
    screen: {
      type: 'Stack',
      children: [
        'status',
        'cursor-label',
        'last-kept',
        'finding-row',
        'note',
        'draft-echo',
        'undo-btn',
      ],
    },
    status: { type: 'Text', props: { text: { $bind: '/note' } } },
    'cursor-label': { type: 'Text', props: { text: { $template: 'cursor=${ui:/cursorId}' } } },
    'last-kept': { type: 'Text', props: { text: { $template: 'last=${ui:/lastKeptId}' } } },
    'finding-row': {
      type: 'Stack',
      repeat: { path: '/findings', key: 'id', filter: { $bind: 'decision', eq: null } },
      children: ['select-btn', 'keep-btn', 'mark-btn', 'compose-btn'],
    },
    'select-btn': {
      type: 'Button',
      props: { label: { $template: 'select ${id}' } },
      on: { press: { ui: { '/cursorId': { $bind: 'id' } } } },
    },
    'keep-btn': {
      type: 'Button',
      props: { label: { $template: 'keep ${id}' } },
      on: {
        press: {
          verb: 'keepIt',
          params: { findingId: { $bind: 'id' } },
          pending: { label: 'keeping…', disable: true },
          done: { ui: { '/cursorId': null } },
        },
      },
    },
    // Same verb, but done.ui writes an ITEM-RELATIVE bind — the case where the
    // dispatching element can unmount before the verb resolves.
    'mark-btn': {
      type: 'Button',
      props: { label: { $template: 'mark ${id}' } },
      on: {
        press: {
          verb: 'keepIt',
          params: { findingId: { $bind: 'id' } },
          done: { ui: { '/lastKeptId': { $bind: 'id' } } },
        },
      },
    },
    // Two verbs in ONE array from inside a repeat: the first verb's side
    // effect re-derives the projection and drops this row, so the second
    // verb's item-relative bind must come from the event-time snapshot.
    'compose-btn': {
      type: 'Button',
      props: { label: { $template: 'compose ${id}' } },
      on: {
        press: [
          { verb: 'writeIt', params: {} },
          {
            verb: 'recordIt',
            params: { findingId: { $bind: 'id' } },
            done: { ui: { '/lastKeptId': { $bind: 'id' } } },
          },
        ],
      },
    },
    note: { type: 'Note', props: { bindUi: '/draft' } },
    'draft-echo': { type: 'Text', props: { text: { $template: 'draft=${ui:/draft}' } } },
    'undo-btn': {
      type: 'Button',
      props: { label: 'undo' },
      on: {
        press: {
          verb: 'undo',
          params: {},
          confirm: { title: 'undo', message: { $template: 'really undo ${/note}?' } },
        },
      },
    },
  },
} as Fabrial;

const initialState: Json = {
  note: 'idle',
  findings: [
    { id: 'f1', decision: null },
    { id: 'f2', decision: 'kept' },
    { id: 'f3', decision: null },
  ],
};

function mount(client: FakeClient, fabrial: Fabrial = smokeFabrial) {
  return render(
    <LoupeRenderer fabrial={fabrial} catalog={miniCatalog} components={impls} client={client} />,
  );
}

// -------------------------------------------------------------------- tests

describe('LoupeRenderer', () => {
  it('renders binds, templates, and repeat+filter from the snapshot', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await expect.element(screen.getByText('idle')).toBeVisible();
    await expect.element(screen.getByText('cursor=')).toBeVisible();
    // filter decision eq null: rows for f1 and f3 only
    await expect.element(screen.getByRole('button', { name: 'select f1' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'select f3' })).toBeVisible();
    expect(screen.container.textContent).not.toContain('select f2');
  });

  it('re-renders on a served state push (nothing here is a picture)', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await expect.element(screen.getByText('idle')).toBeVisible();
    client.push({ ...(initialState as JsonObject), note: 'round 2 appeared' });
    await expect.element(screen.getByText('round 2 appeared')).toBeVisible();
  });

  it('ui actions merge-set the ui doc and re-render (ephemera only)', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await screen.getByRole('button', { name: 'select f3' }).click();
    await expect.element(screen.getByText('cursor=f3')).toBeVisible();
    // served state untouched: no dispatch happened
    expect(client.dispatched).toEqual([]);
  });

  it('uiPointer props resolve to a UiBinding {value, set}', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await screen.getByLabelText('note').fill('half-typed thought');
    await expect.element(screen.getByText('draft=half-typed thought')).toBeVisible();
  });

  it('dispatches verbs with pending presentation and optimistic overlay discard', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await screen.getByRole('button', { name: 'select f1' }).click();
    await expect.element(screen.getByText('cursor=f1')).toBeVisible();

    await screen.getByRole('button', { name: 'keep f1' }).click();
    // pending presentation: label swap + disable, purely visual
    await expect.element(screen.getByRole('button', { name: 'keeping…' })).toBeDisabled();
    // params resolved in the repeat scope
    expect(client.dispatched).toEqual([{ verb: 'keepIt', params: { findingId: 'f1' } }]);
    // optimistic overlay from the manifest PatchTemplate, ${params.x} substituted
    await expect.element(screen.getByText('kept f1')).toBeVisible();

    client.resolveDispatch({ ok: true, seq: 2, records: [] });
    // done.ui ran on success
    await expect.element(screen.getByText('cursor=')).toBeVisible();
    // authoritative state arrives with seq >= response seq: overlay discarded
    client.push({ ...(initialState as JsonObject), note: 'authoritative truth' });
    await expect.element(screen.getByText('authoritative truth')).toBeVisible();
    expect(screen.container.textContent).not.toContain('kept f1');
    // pending cleared
    await expect.element(screen.getByRole('button', { name: 'keep f1' })).toBeEnabled();
  });

  it('done.ui resolves item-relative binds even when the element unmounted mid-flight', async () => {
    // The decide-then-undo case: deciding hides the decide bar, so by the time
    // the verb resolves the dispatching element is gone and the renderer's
    // per-render scope map no longer holds it. The item scope belongs to the
    // EVENT, so done.ui must still see it — otherwise {"$bind": "id"} writes
    // undefined and the undo hotkey's `neq null` guard never opens.
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await expect.element(screen.getByText('last=')).toBeVisible();

    await screen.getByRole('button', { name: 'mark f1' }).click();
    expect(client.dispatched).toEqual([{ verb: 'keepIt', params: { findingId: 'f1' } }]);

    // authoritative state lands FIRST: f1 is now decided, so the repeat's
    // filter drops the row and mark-btn unmounts while the verb is in flight
    client.push({
      ...(initialState as JsonObject),
      findings: [
        { id: 'f1', decision: 'kept' },
        { id: 'f2', decision: 'kept' },
        { id: 'f3', decision: null },
      ],
    });
    await expect.element(screen.getByRole('button', { name: 'mark f1' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('button', { name: 'mark f3' })).toBeVisible();

    client.resolveDispatch({ ok: true, seq: 2, records: [] });
    await expect.element(screen.getByText('last=f1')).toBeVisible();
  });

  it('a later action in the array binds the pressed item, not the post-verb scope', async () => {
    // A compose button: its first verb lands, the app re-derives and the
    // compose row's repeat unmounts — and the SECOND action of the same
    // press was refused with `choice: undefined` because
    // its params were resolved against the scope map of the render that had
    // already dropped the pressed item. The scope belongs to the EVENT.
    const client = new FakeClient(initialState);
    const screen = await mount(client);

    await screen.getByRole('button', { name: 'compose f1' }).click();
    expect(client.dispatched).toEqual([{ verb: 'writeIt', params: {} }]);

    // the first verb's effect lands: f1 is decided, the filtered repeat drops
    // the row, and the dispatching element is gone before verb two resolves
    client.push({
      ...(initialState as JsonObject),
      findings: [
        { id: 'f1', decision: 'kept' },
        { id: 'f2', decision: 'kept' },
        { id: 'f3', decision: null },
      ],
    });
    await expect.element(screen.getByRole('button', { name: 'compose f1' })).not.toBeInTheDocument();

    client.resolveDispatch({ ok: true, seq: 2, records: [] });
    await expect.poll(() => client.dispatched.length).toBe(2);
    expect(client.dispatched[1]).toEqual({ verb: 'recordIt', params: { findingId: 'f1' } });

    client.resolveDispatch({ ok: true, seq: 3, records: [] });
    await expect.element(screen.getByText('last=f1')).toBeVisible();
  });

  it('drops the overlay and reports onVerbError on failure (truthful re-render)', async () => {
    const client = new FakeClient(initialState);
    const errors: Array<{ verb: string; code: string }> = [];
    const screen = await render(
      <LoupeRenderer
        fabrial={smokeFabrial}
        catalog={miniCatalog}
        components={impls}
        client={client}
        onVerbError={(verb, e) => errors.push({ verb, code: e.error.code })}
      />,
    );
    await screen.getByRole('button', { name: 'keep f3' }).click();
    await expect.element(screen.getByText('kept f3')).toBeVisible();
    client.resolveDispatch({ ok: false, error: { code: 'conflict', message: 'nope' } });
    await expect.element(screen.getByText('idle')).toBeVisible(); // overlay dropped, truth restored
    expect(errors).toEqual([{ verb: 'keepIt', code: 'conflict' }]);
  });

  it('draws the confirm dialog and only dispatches on confirm', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await screen.getByRole('button', { name: 'undo' }).click();
    await expect.element(screen.getByText('really undo idle?')).toBeVisible();
    await screen.getByTestId('lp-confirm-cancel').click();
    expect(client.dispatched).toEqual([]);
    await screen.getByRole('button', { name: 'undo' }).click();
    await screen.getByTestId('lp-confirm-ok').click();
    await expect.element(screen.getByTestId('lp-confirm-scrim')).not.toBeInTheDocument();
    expect(client.dispatched).toEqual([{ verb: 'undo', params: {} }]);
    client.resolveDispatch({ ok: true, seq: 2, records: [] });
  });

  it('refuses to mount an invalid fabrial with the issues panel (never partial render)', async () => {
    const client = new FakeClient(initialState);
    const bad = structuredClone(smokeFabrial) as Fabrial;
    (bad.elements as Record<string, { type: string }>)['status'] = { type: 'Waffle' };
    const screen = await mount(client, bad);
    await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
    expect(screen.container.textContent).toContain('unknown-type');
    expect(screen.container.textContent).toContain('rmini@1.0.0');
    // no partial render of the element tree
    expect(screen.container.textContent).not.toContain('idle');
  });

  it('refuses to mount a fabrial bound to an undeclared projection', async () => {
    const client = new FakeClient(initialState);
    const bad = structuredClone(smokeFabrial) as Fabrial;
    (bad.app as { projection: string }).projection = 'no-such-projection';
    const screen = await mount(client, bad);
    await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
    expect(screen.container.textContent).toContain('unknown-projection');
    // never a silent infinite lp-loading
    expect(client.subscribeCount).toBe(0);
  });

  it('renders the error panel (not a blank page) when a render throws', async () => {
    const client = new FakeClient(initialState);
    const boom = structuredClone(smokeFabrial) as Fabrial;
    (boom.elements as Record<string, { type: string }>)['status'] = { type: 'Bomb' };
    const screen = await mount(client, boom);
    await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
    expect(screen.container.textContent).toContain('render-error');
    expect(screen.container.textContent).toContain('kaboom during render');
    expect(screen.container.textContent).toContain('test/smoke');
  });

  it('keeps the later dispatch’s pending presentation when an earlier one settles first', async () => {
    const client = new FakeClient({ note: 'idle' });
    const fabrial: Fabrial = {
      loupe: 1,
      fabrial: 'test/pending-race',
      version: 1,
      catalog: { name: 'rmini', version: '1.0.0' },
      app: { name: 'fake', projection: 'review' },
      ui: {},
      root: 'screen',
      elements: {
        screen: { type: 'Stack', children: ['spam'] },
        spam: {
          type: 'Button',
          props: { label: 'spam' },
          on: { press: { verb: 'undo', params: {}, pending: { label: 'working…' } } },
        },
      },
    };
    const screen = await mount(client, fabrial);
    await screen.getByRole('button', { name: 'spam' }).click();
    await screen.getByRole('button', { name: 'working…' }).click(); // second dispatch, still enabled
    expect(client.dispatched).toHaveLength(2);
    client.resolveDispatch({ ok: true, seq: 2, records: [] });
    // the first completion must NOT clear the second dispatch's pending state
    await expect.element(screen.getByRole('button', { name: 'working…' })).toBeVisible();
    client.resolveDispatch({ ok: true, seq: 3, records: [] });
    await expect.element(screen.getByRole('button', { name: 'spam' })).toBeVisible();
  });

  it('resubscribes when projectionParams change in place (and not on identity churn)', async () => {
    const client = new FakeClient(initialState);
    const ui = (params: JsonObject) => (
      <LoupeRenderer
        fabrial={smokeFabrial}
        catalog={miniCatalog}
        components={impls}
        client={client}
        projectionParams={params}
      />
    );
    const screen = await render(ui({ ticket: 'a' }));
    await expect.element(screen.getByText('idle')).toBeVisible();
    expect(client.subscribeCount).toBe(1);
    expect(client.lastSubscribeParams).toEqual({ ticket: 'a' });
    // fresh object, same content: no remount, no resubscribe
    screen.rerender(ui({ ticket: 'a' }));
    await expect.element(screen.getByText('idle')).toBeVisible();
    expect(client.subscribeCount).toBe(1);
    // content change: remounts and resubscribes with the new params
    screen.rerender(ui({ ticket: 'b' }));
    await expect.poll(() => client.subscribeCount).toBe(2);
    expect(client.lastSubscribeParams).toEqual({ ticket: 'b' });
  });
});

// ---------------------------------------------------- integration semantics

describe('integration semantics (T7)', () => {
  it('an event payload becomes the relative scope for the bound actions', async () => {
    const client = new FakeClient({ note: 'idle' });
    const fabrial: Fabrial = {
      loupe: 1,
      fabrial: 'test/payload',
      version: 1,
      catalog: { name: 'rmini', version: '1.0.0' },
      app: { name: 'fake', projection: 'review' },
      ui: {},
      root: 'screen',
      elements: {
        screen: { type: 'Stack', children: ['pinger'] },
        pinger: {
          type: 'Pinger',
          on: { ping: { verb: 'keepIt', params: { findingId: { $template: '${card}:${at/line}' } } } },
        },
      },
    };
    const screen = await mount(client, fabrial);
    await screen.getByRole('button', { name: 'ping' }).click();
    expect(client.dispatched).toEqual([{ verb: 'keepIt', params: { findingId: 'PAY-1:7' } }]);
    client.resolveDispatch({ ok: true, seq: 2, records: [] });
  });

  it('visible on a repeated element gates the whole repeat in the OUTER scope', async () => {
    const client = new FakeClient({
      show: true,
      items: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ],
    });
    const fabrial: Fabrial = {
      loupe: 1,
      fabrial: 'test/repeat-visible',
      version: 1,
      catalog: { name: 'rmini', version: '1.0.0' },
      app: { name: 'fake', projection: 'review' },
      ui: {},
      root: 'screen',
      elements: {
        screen: { type: 'Stack', children: ['row'] },
        row: {
          type: 'Text',
          repeat: { path: '/items', key: 'id' },
          // '/show' does not exist on the repeat items — it must be read in
          // the enclosing scope, not per item (that is filter's job).
          visible: { $bind: '/show', eq: true },
          props: { text: { $bind: 'name' } },
        },
      },
    };
    const screen = await mount(client, fabrial);
    await expect.element(screen.getByText('Alpha')).toBeVisible();
    await expect.element(screen.getByText('Beta')).toBeVisible();
    client.push({ show: false, items: [{ id: 'a', name: 'Alpha' }] });
    await expect.element(screen.getByText('Alpha')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------- element context

describe('element context (the current cursor item in scope)', () => {
  const contextFabrial: Fabrial = {
    loupe: 1,
    fabrial: 'test/context',
    version: 1,
    catalog: { name: 'rmini', version: '1.0.0' },
    app: { name: 'fake', projection: 'review' },
    ui: { cursorId: null },
    root: 'screen',
    elements: {
      screen: { type: 'Stack', children: ['select-f1', 'select-f3', 'clear', 'scoped', 'pane'] },
      'select-f1': {
        type: 'Button',
        props: { label: 'go f1' },
        on: { press: { ui: { '/cursorId': 'f1' } } },
      },
      'select-f3': {
        type: 'Button',
        props: { label: 'go f3' },
        on: { press: { ui: { '/cursorId': 'f3' } } },
      },
      clear: {
        type: 'Button',
        props: { label: 'clear' },
        on: { press: { ui: { '/cursorId': { $bind: '/nope' } } } },
      },
      scoped: {
        type: 'Stack',
        context: { list: '/findings', key: 'id', at: '/cursorId' },
        // visible evaluates IN the context scope: only when an item is current
        visible: { $bind: '', exists: true },
        children: ['scoped-label', 'scoped-probe', 'keep-current', 'scoped-pinger'],
      },
      // children inherit the context scope (relative bind on the item)
      'scoped-label': { type: 'Text', props: { text: { $template: 'current=${id}:${decision}' } } },
      'scoped-probe': { type: 'Probe', props: { text: { $bind: 'id' } } },
      'keep-current': {
        type: 'Button',
        props: { label: 'keep current' },
        on: { press: { verb: 'keepIt', params: { findingId: { $bind: 'id' } } } },
      },
      // An UNGATED context element carrying both branches — the shape a detail
      // pane uses so a stale cursor gets a placeholder instead of a blank pane.
      pane: {
        type: 'Stack',
        context: { list: '/findings', key: 'id', at: '/cursorId' },
        children: ['pane-empty', 'pane-full'],
      },
      'pane-empty': {
        type: 'Text',
        visible: { $bind: '', exists: false },
        props: { text: 'pick a finding' },
      },
      'pane-full': {
        type: 'Text',
        visible: { $bind: '', exists: true },
        props: { text: { $template: 'showing ${id}' } },
      },
      // the ping payload has its own `card`: payload wins over the context item
      'scoped-pinger': {
        type: 'Pinger',
        on: { ping: { verb: 'keepIt', params: { findingId: { $bind: 'card' } } } },
      },
    },
  } as Fabrial;

  const contextState: Json = {
    findings: [
      { id: 'f1', decision: null, card: 'ctx-f1' },
      { id: 'f2', decision: 'kept', card: 'ctx-f2' },
      { id: 'f3', decision: 'dropped', card: 'ctx-f3' },
    ],
  };

  it('scopes props/actions/children to the cursor item; visible is item-aware', async () => {
    probeMounts = 0;
    const client = new FakeClient(contextState);
    const screen = await mount(client, contextFabrial);
    // no cursor: relative exists-condition is false, the whole element hidden
    expect(screen.container.textContent).not.toContain('current=');
    await screen.getByRole('button', { name: 'go f1' }).click();
    await expect.element(screen.getByText('current=f1:')).toBeVisible();

    // event actions see the context item ($bind id resolves to the cursor row)
    await screen.getByRole('button', { name: 'keep current' }).click();
    expect(client.dispatched).toEqual([{ verb: 'keepIt', params: { findingId: 'f1' } }]);
    client.resolveDispatch({ ok: true, seq: 2, records: [] });

    // cursor move re-scopes WITHOUT remounting (stable instanceKey)
    await screen.getByRole('button', { name: 'go f3' }).click();
    await expect.element(screen.getByText('current=f3:dropped')).toBeVisible();
    expect(probeMounts).toBe(1);

    // event payload still wins over the context item
    await screen.getByRole('button', { name: 'ping' }).click();
    expect(client.dispatched[1]).toEqual({ verb: 'keepIt', params: { findingId: 'PAY-1' } });
    client.resolveDispatch({ ok: true, seq: 3, records: [] });

    // cursor id that matches nothing ⇒ no item ⇒ hidden again
    await screen.getByRole('button', { name: 'clear' }).click();
    await expect.element(screen.getByText('current=f3:dropped')).not.toBeInTheDocument();
  });

  // Track 20260831T1457_triage_defects, AC7. A `repeat` filtered on the cursor
  // renders NOTHING when the cursor names a row that is gone — neither the
  // detail nor a placeholder, because the placeholder's own gate (`cursor eq
  // null`) is false for a stale id. `context` mounts with no item in scope, so
  // an exists:false branch is well-defined and the pane can say so.
  it('an ungated context element renders its exists:false branch on a stale cursor', async () => {
    const client = new FakeClient(contextState);
    const screen = await mount(client, contextFabrial);
    // entry: cursor null ⇒ no item ⇒ placeholder, not a blank pane
    await expect.element(screen.getByText('pick a finding')).toBeVisible();

    await screen.getByRole('button', { name: 'go f1' }).click();
    await expect.element(screen.getByText('showing f1')).toBeVisible();
    await expect.element(screen.getByText('pick a finding')).not.toBeInTheDocument();

    // a cursor naming a row that is not in the served list is the stale case
    await screen.getByRole('button', { name: 'clear' }).click();
    await expect.element(screen.getByText('pick a finding')).toBeVisible();
    await expect.element(screen.getByText('showing f1')).not.toBeInTheDocument();
  });
});

// --------------------------------------------------------- connection band

class ConnFakeClient extends FakeClient {
  private connCb: ((s: ConnectionState) => void) | null = null;
  private connState: ConnectionState = 'connected';
  connection = (cb: (s: ConnectionState) => void): (() => void) => {
    this.connCb = cb;
    cb(this.connState);
    return () => {
      this.connCb = null;
    };
  };
  setConnection(s: ConnectionState): void {
    this.connState = s;
    this.connCb?.(s);
  }
}

describe('connection band', () => {
  it('appears only after the grace period, tracks state copy, and clears on reconnect', async () => {
    const client = new ConnFakeClient(initialState);
    const screen = await mount(client);
    await expect.element(screen.getByText('idle')).toBeVisible();
    // connected: no band
    expect(screen.container.ownerDocument.querySelector('[data-testid="lp-conn-band"]')).toBeNull();

    client.setConnection('reconnecting');
    // inside the 1500 ms grace: still no band (no flash on sub-second blips)
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.container.ownerDocument.querySelector('[data-testid="lp-conn-band"]')).toBeNull();
    // after the grace: band with the retrying copy
    await expect.element(screen.getByTestId('lp-conn-band'), { timeout: 3000 }).toBeVisible();
    await expect.element(screen.getByText('app unreachable — retrying…')).toBeVisible();

    client.setConnection('gone');
    await expect
      .element(screen.getByText('app unreachable — still retrying · the app may be down'), {
        timeout: 3000,
      })
      .toBeVisible();

    client.setConnection('connected');
    await expect.element(screen.getByTestId('lp-conn-band')).not.toBeInTheDocument();
  });

  it('a client without connection() never renders a band', async () => {
    const client = new FakeClient(initialState);
    const screen = await mount(client);
    await expect.element(screen.getByText('idle')).toBeVisible();
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.container.ownerDocument.querySelector('[data-testid="lp-conn-band"]')).toBeNull();
  });
});

// Host wiring masks these missing-context and independent validation cases.
describe('independent route mount with the real catalog', () => {
  const fabrial: Fabrial = {
    loupe: 1, fabrial: 'notes/source', version: 1,
    catalog: { name: 'loupe-std', version: '2.0.0' },
    app: { name: 'notes', projection: 'review' }, root: 'link',
    elements: { link: { type: 'Link', props: { label: 'open track', href: { $route: { fabrial: 'track' } } } } },
  };
  const inventories: Array<Readonly<Record<string, readonly string[]>> | undefined> = [
    undefined, {}, { notes: ['other'] }, { notes: ['source'], grill: ['track'] },
  ];
  it.each(inventories)('refuses absent or foreign targets for inventory %j before mounting anchors', async (fabrialInventory) => {
    const screen = await render(<LoupeRenderer fabrial={fabrial} catalog={loupeStd} components={components} client={new FakeClient({})} instance="notes" fabrialInventory={fabrialInventory} />);
    await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
    expect(screen.container.textContent).toContain('bad-props');
    expect(screen.container.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('reports missing mounting instance after inventory validation, with no usable anchor', async () => {
    const screen = await render(<LoupeRenderer fabrial={fabrial} catalog={loupeStd} components={components} client={new FakeClient({})} fabrialInventory={{ notes: ['track'] }} />);
    await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
    expect(screen.container.textContent).toContain('render-error');
    expect(screen.container.textContent).toContain('instance');
    expect(screen.container.querySelectorAll('a[href]')).toHaveLength(0);
  });

  it('mounts the same route when both explicit instance and source-app inventory exist', async () => {
    const screen = await render(<LoupeRenderer fabrial={fabrial} catalog={loupeStd} components={components} client={new FakeClient({})} instance="notes-mirror" fabrialInventory={{ notes: ['track'] }} />);
    await expect.element(screen.getByRole('link', { name: 'open track' })).toHaveAttribute('href', '#/notes-mirror/track');
    expect(screen.container.querySelectorAll('a[href]')).toHaveLength(1);
  });

  describe.each(['on.press.ui', 'done.ui'])('%s routes', (actionPath) => {
    const ui = { '/href': { $route: { fabrial: 'track' } } };
    const actionFabrial: Fabrial = {
      ...fabrial, ui: { href: '#/unchanged' }, root: 'screen',
      elements: {
        screen: { type: 'Stack', children: ['select', 'resolved'] },
        select: {
          type: 'Button', props: { label: 'select route', variant: 'ghost' },
          on: { press: actionPath === 'on.press.ui' ? { ui } : { verb: 'writeIt', params: {}, done: { ui } } },
        },
        resolved: { type: 'Text', props: { text: { $ui: '/href' } } },
      },
    };

    it.each(inventories)('validates action targets against inventory %j before mounting', async (fabrialInventory) => {
      const screen = await render(<LoupeRenderer fabrial={actionFabrial} catalog={loupeStd} components={components} client={new FakeClient({})} instance="notes" fabrialInventory={fabrialInventory} />);
      await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
      expect(screen.container.textContent).toContain('bad-props');
      expect(screen.container.querySelectorAll('a[href], button')).toHaveLength(0);
    });

    it('reports missing mounting context after the action with no stale content', async () => {
      const client = new FakeClient({});
      const screen = await render(<LoupeRenderer fabrial={actionFabrial} catalog={loupeStd} components={components} client={client} fabrialInventory={{ notes: ['track'] }} />);
      await expect.element(screen.getByText('#/unchanged')).toBeVisible();
      await screen.getByRole('button', { name: 'select route' }).click();
      if (actionPath === 'done.ui') client.resolveDispatch({ ok: true, seq: 1, records: [] });
      await expect.element(screen.getByTestId('lp-error-panel')).toBeVisible();
      expect(screen.container.textContent).toContain('render-error');
      expect(screen.container.textContent).toContain('$route requires explicit mounting instance context');
      expect(screen.container.textContent).not.toContain('#/unchanged');
      expect(screen.container.querySelectorAll('a[href]')).toHaveLength(0);
    });
  });
});
