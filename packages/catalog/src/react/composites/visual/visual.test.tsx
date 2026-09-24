// Browser-mode render tests for the visual composites (catalog-visual lane).
// The theme is load-bearing here: ProseDoc's code-span assertion compares real
// --lp-* values, and without it every colour resolves to transparent.
import '@loupe/tokens/theme-classic.css';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { createElement, type ReactNode } from 'react';
import type { Json } from '@loupe/spec';
import { RouteGraph } from './route-graph.tsx';
import { DiffBlock } from './diff-block.tsx';
import { OverlaySheet } from './overlay-sheet.tsx';
import { ProseDoc } from './prose-doc.tsx';

type Emitted = Array<{ event: string; payload?: Json }>;

const slotStub = (name: string, scope: Json, key: string): ReactNode =>
  createElement('div', { 'data-slot': name, 'data-slot-key': key }, JSON.stringify(scope));

const args = (props: Record<string, Json>, emitted: Emitted, children?: ReactNode) => ({
  props: props as never,
  children,
  emit: (event: string, payload?: Json) => emitted.push({ event, payload }),
  itemSlot: slotStub,
});

// ---------------------------------------------------------------- RouteGraph

const routeProps: Record<string, Json> = {
  nodes: [
    { id: 'plan', kind: 'agent', pos: { x: 184, y: 88 } },
    { id: 'shot', kind: 'task', pos: { x: 368, y: 74 }, conditional: true },
    { id: 'signoff', kind: 'await', pos: { x: 552, y: 74 } },
  ],
  edges: [
    { from: 'ticket', to: 'plan' },
    { from: 'plan', to: 'shot' },
    { from: 'shot', to: 'signoff' },
    { from: 'signoff', to: 'pr', kind: 'fail' },
  ],
  terminals: [
    { id: 'ticket', pos: { x: 0, y: 46 } },
    { id: 'pr', pos: { x: 736, y: 74 } },
  ],
  size: { width: 900, height: 310 },
  selectedId: 'plan',
  annotations: [{ x: 700, y: 244, text: 'after the tests fail 3×', tone: 'badText' }],
};

test('RouteGraph places nodes and terminals at their given pos', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(RouteGraph, args(routeProps, emitted)));

  const plan = container.querySelector<HTMLElement>('[data-lp-rect-id="plan"]')!;
  expect(plan).not.toBeNull();
  expect(plan.style.left).toBe('184px');
  expect(plan.style.top).toBe('88px');
  expect(plan.style.width).toBe('132px');

  expect(container.querySelectorAll('[data-lp="node"]').length).toBe(3);
  const terminals = container.querySelectorAll<HTMLElement>('[data-lp="terminal"]');
  expect(terminals.length).toBe(2);
  expect(terminals[0]!.style.left).toBe('0px');
  expect(terminals[0]!.style.top).toBe('46px');

  // Terminals render through the same `node` itemSlot with terminal: true.
  const terminalSlot = terminals[0]!.querySelector('[data-slot="node"]')!;
  expect(JSON.parse(terminalSlot.textContent!)).toMatchObject({
    terminal: true,
    node: { id: 'ticket' },
  });
});

test('RouteGraph draws flow edges (n-1) plus the dashed fail edge', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(RouteGraph, args(routeProps, emitted)));

  const edges = container.querySelectorAll<SVGPathElement>('path[data-lp="edge"]');
  expect(edges.length).toBe(4);

  const flow = container.querySelectorAll<SVGPathElement>('path[data-edge-kind="flow"]');
  expect(flow.length).toBe(3);
  for (const p of flow) {
    expect(p.style.stroke).toBe('var(--lp-border-idle)');
    expect(p.getAttribute('stroke-width')).toBe('2');
    expect(p.getAttribute('stroke-dasharray')).toBeNull();
    expect(p.getAttribute('marker-end')).toMatch(/^url\(#.*flow\)$/);
    expect(p.getAttribute('d')).toMatch(/^M \d.* C /);
  }

  const fail = container.querySelectorAll<SVGPathElement>('path[data-edge-kind="fail"]');
  expect(fail.length).toBe(1);
  expect(fail[0]!.style.stroke).toBe('var(--lp-accent-bad-deep)');
  expect(fail[0]!.getAttribute('stroke-dasharray')).toBe('6 5');
  expect(fail[0]!.getAttribute('marker-end')).toMatch(/^url\(#.*fail\)$/);

  // Bezier math: edge plan→shot leaves plan's right-center. plan is at
  // x 184 (+132 wide), so the path starts at x 316.
  const planEdge = edges[1]!;
  expect(planEdge.getAttribute('d')).toMatch(/^M 316,/);
});

test('RouteGraph marks selection, dashes conditional, and emits nodeSelect', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(RouteGraph, args(routeProps, emitted)));

  const plan = container.querySelector<HTMLElement>('[data-lp-rect-id="plan"]')!;
  expect(plan.style.outline).toContain('var(--lp-accent-person)');
  expect(plan.style.borderLeft).toContain('solid');
  expect(plan.style.borderLeft).toContain('var(--lp-accent-agent)');

  const shot = container.querySelector<HTMLElement>('[data-lp-rect-id="shot"]')!;
  expect(shot.style.outline).toBe('none');
  expect(shot.style.borderLeft).toContain('dashed');

  const signoff = container.querySelector<HTMLElement>('[data-lp-rect-id="signoff"]')!;
  expect(signoff.style.borderLeft).toContain('var(--lp-accent-wait)');
  signoff.click();
  expect(emitted).toEqual([{ event: 'nodeSelect', payload: { id: 'signoff' } }]);
});

// ----------------------------------------------------------------- DiffBlock

const diffProps: Record<string, Json> = {
  file: 'settle/retry.go',
  lines: [
    { no: 12, sign: ' ', text: 'func retry() {' },
    { no: 13, sign: '-', text: '  old', side: '-' },
    { no: 13, sign: '+', text: '  new', side: '+' },
    { no: 14, sign: '+', text: '  more', side: '+' },
  ],
  notes: [{ line: 13, side: '+', body: 'note here', mine: true }],
  composeAt: { line: 14, side: '+' },
};

test('DiffBlock colors add/del/ctx rows from the diff token septet', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(DiffBlock, args(diffProps, emitted)));

  const rows = container.querySelectorAll<HTMLElement>('[data-lp="diff-line"]');
  expect(rows.length).toBe(4);

  const [ctx, del, add] = [rows[0]!, rows[1]!, rows[2]!];
  expect(ctx.style.background).toBe('transparent');
  expect(del.style.background).toBe('var(--lp-diff-del-bg)');
  expect(add.style.background).toBe('var(--lp-diff-add-bg)');

  const cols = (row: HTMLElement) => row.querySelectorAll<HTMLElement>('span');
  expect(cols(add)[0]!.style.color).toBe('var(--lp-diff-add-no)');
  expect(cols(add)[1]!.style.color).toBe('var(--lp-diff-add-sign)');
  expect(cols(add)[2]!.style.color).toBe('var(--lp-diff-add-text)');
  expect(cols(del)[0]!.style.color).toBe('var(--lp-diff-del-no)');
  expect(cols(del)[1]!.style.color).toBe('var(--lp-diff-del-sign)');
  expect(cols(del)[2]!.style.color).toBe('var(--lp-diff-del-text)');
  expect(cols(ctx)[0]!.style.color).toBe('var(--lp-diff-ctx-no)');
  expect(cols(ctx)[2]!.style.color).toBe('var(--lp-diff-ctx-text)');

  expect(add.style.gridTemplateColumns).toBe('56px 22px 1fr');
});

test('DiffBlock interleaves the note under its anchor and compose at composeAt', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(DiffBlock, args(diffProps, emitted)));

  const noteWrap = container.querySelector<HTMLElement>('[data-lp="diff-note"]')!;
  expect(noteWrap).not.toBeNull();
  // The note hangs immediately beneath its +13 anchor line.
  const anchor = noteWrap.previousElementSibling as HTMLElement;
  expect(anchor.dataset['sign']).toBe('+');
  expect(anchor.textContent).toContain('13');
  expect(noteWrap.style.marginLeft).toBe('78px');
  expect(noteWrap.style.borderLeft).toContain('var(--lp-accent-agent)');
  const noteSlot = noteWrap.querySelector('[data-slot="note"]')!;
  expect(JSON.parse(noteSlot.textContent!)).toEqual({
    note: { line: 13, side: '+', body: 'note here', mine: true },
  });

  const composeWrap = container.querySelector<HTMLElement>('[data-lp="diff-compose"]')!;
  expect(composeWrap).not.toBeNull();
  const composeAnchor = composeWrap.previousElementSibling as HTMLElement;
  expect(composeAnchor.textContent).toContain('14');
  expect(composeWrap.style.border).toContain('var(--lp-border-violet)');
  const composeSlot = composeWrap.querySelector('[data-slot="compose"]')!;
  expect(JSON.parse(composeSlot.textContent!)).toEqual({ line: 14, side: '+' });

  // Exact-match anchoring: the -13 line gets no note.
  const delRow = container.querySelector<HTMLElement>('[data-sign="-"]')!;
  expect(delRow.parentElement!.querySelector('[data-lp="diff-note"]')).toBeNull();
});

test('DiffBlock emits linePress {file, line, side} on changed lines only; context lines are inert', async () => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(DiffBlock, args(diffProps, emitted)));

  // Context line 12: no emit on click, default cursor (findings anchor to changed lines).
  const ctx = container.querySelector<HTMLElement>('[data-lp="diff-line"]')!;
  expect(ctx.dataset['sign']).toBe(' ');
  expect(ctx.style.cursor).toBe('');
  ctx.click();
  expect(emitted).toEqual([]);

  // Changed lines still emit with their side and show the pointer.
  const del = container.querySelector<HTMLElement>('[data-sign="-"]')!;
  const add = container.querySelector<HTMLElement>('[data-sign="+"]')!;
  expect(del.style.cursor).toBe('pointer');
  expect(add.style.cursor).toBe('pointer');
  del.click();
  add.click();
  expect(emitted).toEqual([
    { event: 'linePress', payload: { file: 'settle/retry.go', line: 13, side: '-' } },
    { event: 'linePress', payload: { file: 'settle/retry.go', line: 13, side: '+' } },
  ]);
});

test('DiffBlock maxLines slices with a truncation note', async () => {
  const emitted: Emitted = [];
  const { container } = await render(
    createElement(DiffBlock, args({ ...diffProps, notes: [], composeAt: null, maxLines: 2 }, emitted)),
  );

  expect(container.querySelectorAll('[data-lp="diff-line"]').length).toBe(2);
  const note = container.querySelector<HTMLElement>('[data-lp="diff-truncated"]')!;
  expect(note.textContent).toContain('2 more lines');
});

// -------------------------------------------------------------- OverlaySheet

test('OverlaySheet portals to document.body and controls mount via open', async () => {
  const emitted: Emitted = [];
  const { container, rerender } = await render(
    createElement(
      OverlaySheet,
      args({ open: false }, emitted, createElement('p', null, 'sheet body')),
    ),
  );

  expect(document.body.querySelector('[data-lp="overlay-sheet"]')).toBeNull();

  await rerender(
    createElement(
      OverlaySheet,
      args({ open: true }, emitted, createElement('p', null, 'sheet body')),
    ),
  );

  const sheet = document.body.querySelector<HTMLElement>('[data-lp="overlay-sheet"]')!;
  expect(sheet).not.toBeNull();
  expect(sheet.parentElement).toBe(document.body); // portal-mounted, outside the react root
  expect(container.querySelector('[data-lp="overlay-sheet"]')).toBeNull();
  expect(sheet.style.width).toBe('560px');
  expect(sheet.style.position).toBe('fixed');
  expect(sheet.style.right).toBe('0px');
  expect(sheet.style.background).toBe('var(--lp-bg-panel)');
  expect(sheet.textContent).toContain('sheet body');
  expect(emitted).toEqual([]);
});

test('OverlaySheet dismisses on scrim click and on Escape', async () => {
  const emitted: Emitted = [];
  await render(
    createElement(OverlaySheet, args({ open: true }, emitted, createElement('p', null, 'body'))),
  );

  const scrim = document.body.querySelector<HTMLElement>('[data-lp="overlay-scrim"]')!;
  expect(scrim.style.background).toBe('var(--lp-scrim)');
  scrim.click();
  expect(emitted).toEqual([{ event: 'dismiss', payload: undefined }]);

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(emitted).toEqual([
    { event: 'dismiss', payload: undefined },
    { event: 'dismiss', payload: undefined },
  ]);
});

// ------------------------------------------------------------------ ProseDoc
//
// Track 20260901T1235, Phase 2. Two properties carry this component: inline
// code must be distinguishable without a font change (there is only one face),
// and its measure must be its own rather than a widened `Prose`.

const docBlocks: Json = [
  { kind: 'heading', level: 2, spans: [{ t: 'text', v: 'Findings' }] },
  {
    kind: 'para',
    spans: [
      { t: 'text', v: 'The engine returns ' },
      { t: 'code', v: 'no_fix_decision' },
      { t: 'text', v: ' on refusal.' },
    ],
  },
  { kind: 'task', done: true, spans: [{ t: 'text', v: 'done' }] },
  { kind: 'code', lang: 'ts', lines: ['const x = 1;'] },
  { kind: 'rule' },
];

const proseDoc = async (props: Record<string, Json>): Promise<HTMLElement> => {
  const emitted: Emitted = [];
  const { container } = await render(createElement(ProseDoc, args(props, emitted) as never));
  const el = container.querySelector<HTMLElement>('[data-lp="ProseDoc"]');
  if (el === null) throw new Error('ProseDoc did not render');
  return el;
};

const pick = (root: HTMLElement, lp: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-lp="${lp}"]`);
  if (el === null) throw new Error(`no [data-lp="${lp}"]`);
  return el;
};

test('ProseDoc: inline code is distinguished by ground, never by font', async () => {
  const root = await proseDoc({ blocks: docBlocks });
  const code = pick(root, 'ProseDoc-code');
  const para = pick(root, 'ProseDoc-para');
  // one typeface by design, so a font change is not available as a signal
  expect(getComputedStyle(code).fontFamily).toBe(getComputedStyle(para).fontFamily);
  // the distinction is ground, and it is real
  expect(getComputedStyle(code).backgroundColor).not.toBe(getComputedStyle(para).backgroundColor);
});

test('ProseDoc: its measure is its own, wider than Prose', async () => {
  expect((await proseDoc({ blocks: docBlocks })).style.maxWidth).toBe('84ch');
  expect((await proseDoc({ blocks: docBlocks, maxCh: 96 })).style.maxWidth).toBe('96ch');
});

test('ProseDoc: every size it emits is a member of the closed scale', async () => {
  const root = await proseDoc({ blocks: docBlocks });
  const allowed = new Set(['10px', '11px', '12px', '14px', '16px', '18px', '24px']);
  for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
    expect(allowed.has(getComputedStyle(node as HTMLElement).fontSize)).toBe(true);
  }
});

test('ProseDoc: a done task reads differently from an open one', async () => {
  const done = pick(await proseDoc({ blocks: docBlocks }), 'ProseDoc-task').textContent;
  const open = pick(
    await proseDoc({ blocks: [{ kind: 'task', done: false, spans: [{ t: 'text', v: 'done' }] }] }),
    'ProseDoc-task',
  ).textContent;
  expect(done).not.toBe(open);
});

// Track 20260903T0453 — the three measured rendering defects, at the
// component end. (a) code inside bold, (b) tables sized to content, (c) the
// outline's anchor.

test('ProseDoc: a bold carrying spans renders them, and one without still renders v', async () => {
  const root = await proseDoc({
    blocks: [
      {
        kind: 'para',
        spans: [
          { t: 'bold', v: 'OWNED_STREAMS gates it', spans: [{ t: 'code', v: 'OWNED_STREAMS' }, { t: 'text', v: ' gates it' }] },
          { t: 'text', v: ' and ' },
          { t: 'bold', v: 'plain bold' },
        ],
      },
    ],
  });
  const strong = root.querySelector('strong');
  if (strong === null) throw new Error('no <strong>');
  const code = strong.querySelector('[data-lp="ProseDoc-code"]');
  if (code === null) throw new Error('the nested code span did not render as code');
  expect(code.textContent).toBe('OWNED_STREAMS');
  // no literal backticks anywhere, and the plain bold is untouched
  expect(root.textContent).not.toContain('`');
  expect(root.textContent).toContain('plain bold');
});

test('ProseDoc: table columns are sized to content, not shared equally', async () => {
  const root = await proseDoc({
    blocks: [
      {
        kind: 'table',
        head: [[{ t: 'text', v: '#' }], [{ t: 'text', v: 'Verification' }]],
        rows: [[[{ t: 'text', v: 'AC1' }], [{ t: 'text', v: 'a'.repeat(122) }]]],
      },
    ],
  });
  const grid = pick(root, 'ProseDoc-table').firstElementChild as HTMLElement;
  expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(min-content, auto))');
  // and the wide table scrolls in its own container rather than breaking out
  expect(getComputedStyle(pick(root, 'ProseDoc-table')).overflowX).toBe('auto');
});

test('ProseDoc: anchor scrolls the matching heading, on the rising edge only', async () => {
  const calls: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) {
    calls.push(this.textContent ?? '');
  };
  try {
    const blocks: Json = [
      { kind: 'heading', level: 2, id: 'h1', spans: [{ t: 'text', v: 'First' }] },
      { kind: 'heading', level: 2, id: 'h2', spans: [{ t: 'text', v: 'Second' }] },
    ];
    const emitted: Emitted = [];
    const { rerender } = await render(
      createElement(ProseDoc, args({ blocks, anchor: null }, emitted) as never),
    );
    expect(calls).toEqual([]); // nothing on mount
    await rerender(createElement(ProseDoc, args({ blocks, anchor: 'h2' }, emitted) as never));
    expect(calls).toEqual(['Second']);
    // a re-render with the SAME anchor is not a second edge
    await rerender(createElement(ProseDoc, args({ blocks, anchor: 'h2' }, emitted) as never));
    expect(calls).toEqual(['Second']);
    await rerender(createElement(ProseDoc, args({ blocks, anchor: 'h1' }, emitted) as never));
    expect(calls).toEqual(['Second', 'First']);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
