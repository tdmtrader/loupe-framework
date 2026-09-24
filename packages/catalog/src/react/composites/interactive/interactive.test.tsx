// Browser-mode acceptance tests for the interactive composites (catalog-interactive lane):
// Board drag lifecycle, VerbBar literal events + printed keyHints, Hotkeys keydown routing.
import { createElement, type ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentImplArgs, Json } from '@loupe/spec';
import { Board } from './board.tsx';
import { VerbBar } from './verb-bar.tsx';
import { Hotkeys } from './hotkeys.tsx';
import { Button } from '../../primitives/Button.tsx';
import { mount as mountPrimitive, rgb, tokenColors } from '../../primitives/test-kit.tsx';

type Impl = (args: ComponentImplArgs<ReactNode>) => ReactNode;

/** Fake itemSlot: renders the slot name, key, and the scope it received. */
const fakeItemSlot = (name: string, scopeItem: Json, key: string): ReactNode => {
  const scope = scopeItem as Record<string, Json>;
  let text = '';
  if (name === 'laneHeader') {
    const lane = scope.lane as Record<string, Json>;
    text = `${String(lane.name ?? lane.id)}|hint:${String(scope.dropHint ?? '')}`;
  } else if (name === 'card') {
    const card = scope.card as Record<string, Json>;
    text = `${String(card.id)}${scope.dragging ? '|dragging' : ''}`;
  } else if (name === 'laneOpen') {
    const lane = scope.lane as Record<string, Json>;
    text = `open:${String(lane.id)}`;
  }
  return createElement('div', { 'data-slot': name, 'data-slot-key': key, key }, text);
};

const mount = async (impl: Impl, props: Record<string, unknown>) => {
  const emit = vi.fn();
  const args: ComponentImplArgs<ReactNode> = {
    props,
    emit,
    itemSlot: fakeItemSlot,
  };
  const screen = await render(createElement(impl as never, args as never));
  return { emit, screen, container: screen.container };
};

const drag = (el: Element, type: string) =>
  el.dispatchEvent(
    new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }),
  );

const boardFixture = {
  lanes: [
    {
      id: 'refunds',
      name: 'refunds',
      cards: [
        { id: 'PAY-2129', column: 'next' },
        { id: 'PAY-2112', column: 'needs' },
      ],
    },
    {
      id: 'ledger',
      name: 'ledger',
      cards: [{ id: 'PAY-2140', column: 'happening' }],
    },
    { id: 'latency', name: 'latency', cards: [] },
  ],
  columns: {
    template: '248px 1fr 1fr 1.3fr 88px',
    cells: ['next', 'happening', { key: 'needs', tint: true }, 'done'],
  },
};

describe('Board', () => {
  test('renders one lane row per lanes[] item with the column cells and cards from fixture data', async () => {
    const { container } = await mount(Board as Impl, boardFixture);
    const laneEls = container.querySelectorAll('[data-lp-lane]');
    expect([...laneEls].map((el) => el.getAttribute('data-lp-lane'))).toEqual([
      'refunds',
      'ledger',
      'latency',
    ]);
    // 4 cells per lane from columns config, in order
    const firstLaneCells = laneEls[0].querySelectorAll('[data-lp-cell]');
    expect([...firstLaneCells].map((el) => el.getAttribute('data-lp-cell'))).toEqual([
      'next',
      'happening',
      'needs',
      'done',
    ]);
    // grid template flows through
    expect((laneEls[0] as HTMLElement).style.gridTemplateColumns).toBe('248px 1fr 1fr 1.3fr 88px');
    // cards land in the cell matching card.column
    expect(
      laneEls[0].querySelector('[data-lp-cell="next"] [data-lp-card]')?.getAttribute('data-lp-card'),
    ).toBe('PAY-2129');
    expect(
      laneEls[0]
        .querySelector('[data-lp-cell="needs"] [data-lp-card]')
        ?.getAttribute('data-lp-card'),
    ).toBe('PAY-2112');
    // laneHeader itemSlot rendered once per lane with the lane in scope, hint empty
    expect(laneEls[1].querySelector('[data-slot="laneHeader"]')?.textContent).toBe('ledger|hint:');
  });

  test('open lane renders the laneOpen itemSlot instead of card cells', async () => {
    const { container } = await mount(Board as Impl, {
      lanes: [{ id: 'refunds', open: true, cards: [{ id: 'PAY-1', column: 'next' }] }],
      columns: boardFixture.columns,
    });
    const lane = container.querySelector('[data-lp-lane="refunds"]') as HTMLElement;
    expect(lane.querySelector('[data-slot="laneOpen"]')?.textContent).toBe('open:refunds');
    expect(lane.querySelectorAll('[data-lp-cell]').length).toBe(0);
    expect(lane.style.gridTemplateColumns).toBe('248px 1fr');
  });

  test('openCardId opens the lane containing that card: laneOpen itemSlot renders, card cells suppressed', async () => {
    const { container } = await mount(Board as Impl, { ...boardFixture, openCardId: 'PAY-2112' });
    // PAY-2112 lives in the refunds lane -> that lane renders laneOpen
    const lane = container.querySelector('[data-lp-lane="refunds"]') as HTMLElement;
    expect(lane.querySelector('[data-slot="laneOpen"]')?.textContent).toBe('open:refunds');
    expect(lane.querySelectorAll('[data-lp-cell]').length).toBe(0);
    expect(lane.querySelector('[data-lp-card]')).toBeNull();
    expect(lane.style.gridTemplateColumns).toBe('248px 1fr');
    // other lanes keep their card cells
    const ledger = container.querySelector('[data-lp-lane="ledger"]') as HTMLElement;
    expect(ledger.querySelector('[data-slot="laneOpen"]')).toBeNull();
    expect(ledger.querySelectorAll('[data-lp-cell]').length).toBe(4);
    expect(ledger.querySelector('[data-lp-card="PAY-2140"]')).not.toBeNull();
  });

  test('openCardId null behaves as today: no lane opens', async () => {
    const { container } = await mount(Board as Impl, { ...boardFixture, openCardId: null });
    expect(container.querySelector('[data-slot="laneOpen"]')).toBeNull();
    expect(container.querySelectorAll('[data-lp-card]').length).toBe(3);
    expect(
      (container.querySelector('[data-lp-lane="refunds"]') as HTMLElement).style
        .gridTemplateColumns,
    ).toBe('248px 1fr 1fr 1.3fr 88px');
  });

  test('card drag to another lane emits exactly one cardMove with correct payload and no internal reorder', async () => {
    const { container, emit } = await mount(Board as Impl, boardFixture);
    const card = container.querySelector('[data-lp-card="PAY-2129"]') as HTMLElement;
    const target = container.querySelector('[data-lp-lane="ledger"]') as HTMLElement;

    drag(card, 'dragstart');
    drag(target, 'dragover');

    // dropHint reaches the hovered lane's laneHeader scope; source card marked dragging
    await vi.waitFor(() => {
      expect(target.querySelector('[data-slot="laneHeader"]')?.textContent).toBe(
        'ledger|hint:move PAY-2129 into this track',
      );
      expect(card.querySelector('[data-slot="card"]')?.textContent).toBe('PAY-2129|dragging');
      // card-retrack target gets the agent-violet outline
      expect(target.getAttribute('style') ?? '').toContain('--lp-accent-agent');
    });
    // non-target lanes get no hint
    expect(
      container
        .querySelector('[data-lp-lane="latency"] [data-slot="laneHeader"]')
        ?.textContent,
    ).toContain('hint:');

    drag(target, 'drop');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('cardMove', { card: 'PAY-2129', toLane: 'ledger' });

    // no internal reorder: the card is still rendered in its source lane
    await vi.waitFor(() => {
      expect(
        container.querySelector(
          '[data-lp-lane="refunds"] [data-lp-cell="next"] [data-lp-card="PAY-2129"]',
        ),
      ).not.toBeNull();
      expect(container.querySelector('[data-lp-lane="ledger"] [data-lp-card="PAY-2129"]')).toBeNull();
      // gesture cleared: hint gone
      expect(target.querySelector('[data-slot="laneHeader"]')?.textContent).toBe('ledger|hint:');
    });
  });

  test('same-lane card drop is suppressed (no emit) and clears the gesture', async () => {
    const { container, emit } = await mount(Board as Impl, boardFixture);
    const card = container.querySelector('[data-lp-card="PAY-2129"]') as HTMLElement;
    const sourceLane = container.querySelector('[data-lp-lane="refunds"]') as HTMLElement;
    drag(card, 'dragstart');
    drag(sourceLane, 'dragover');
    drag(sourceLane, 'drop');
    expect(emit).not.toHaveBeenCalled();
  });

  test('lane header drag emits exactly one laneMove {lane, before}; target gets the person-blue outline; same-target suppressed', async () => {
    const { container, emit } = await mount(Board as Impl, boardFixture);
    const handle = container.querySelector('[data-lp-lane-handle="latency"]') as HTMLElement;
    const target = container.querySelector('[data-lp-lane="refunds"]') as HTMLElement;

    drag(handle, 'dragstart');
    drag(target, 'dragover');
    await vi.waitFor(() => {
      // lane-reorder target outline is person blue; source lane dims
      expect(target.getAttribute('style') ?? '').toContain('--lp-accent-person');
      expect(
        (container.querySelector('[data-lp-lane="latency"]') as HTMLElement).style.opacity,
      ).toBe('0.45');
    });
    drag(target, 'drop');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('laneMove', { lane: 'latency', before: 'refunds' });
    // DOM order untouched (no internal reorder)
    expect(
      [...container.querySelectorAll('[data-lp-lane]')].map((el) =>
        el.getAttribute('data-lp-lane'),
      ),
    ).toEqual(['refunds', 'ledger', 'latency']);

    // same-target drop suppressed
    emit.mockClear();
    const handle2 = container.querySelector('[data-lp-lane-handle="ledger"]') as HTMLElement;
    const lane2 = container.querySelector('[data-lp-lane="ledger"]') as HTMLElement;
    drag(handle2, 'dragstart');
    drag(lane2, 'dragover');
    drag(lane2, 'drop');
    expect(emit).not.toHaveBeenCalled();
  });

  test('lane handle is disabled while a card drags', async () => {
    const { container } = await mount(Board as Impl, boardFixture);
    const card = container.querySelector('[data-lp-card="PAY-2129"]') as HTMLElement;
    const handle = container.querySelector('[data-lp-lane-handle="refunds"]') as HTMLElement;
    expect(handle.draggable).toBe(true);
    drag(card, 'dragstart');
    await vi.waitFor(() => {
      expect(handle.draggable).toBe(false);
      expect(handle.style.cursor).toBe('default');
    });
  });
});

describe('VerbBar', () => {
  const actions = [
    { label: 'keep', keyHint: 'K', variant: 'confirm', event: 'keep' },
    { label: 'edit', keyHint: 'E', variant: 'ghost', event: 'edit' },
    { label: 'drop', keyHint: 'D', variant: 'ghost', event: 'drop' },
    { label: 'block', keyHint: '⇧B', variant: 'danger', event: 'block' },
  ];

  test('emits each button’s literal event name and prints keyHints', async () => {
    const { container, emit } = await mount(VerbBar as Impl, { label: 'verbs', actions });
    const buttons = container.querySelectorAll('button[data-lp-verb]');
    expect([...buttons].map((b) => b.getAttribute('data-lp-verb'))).toEqual([
      'keep',
      'edit',
      'drop',
      'block',
    ]);
    // keyHints printed inside the buttons, muted
    expect(buttons[0].querySelector('[data-lp-key-hint]')?.textContent).toBe('K');
    expect(buttons[3].querySelector('[data-lp-key-hint]')?.textContent).toBe('⇧B');
    expect(container.textContent).toContain('verbs');

    (buttons[0] as HTMLElement).click();
    (buttons[3] as HTMLElement).click();
    expect(emit.mock.calls).toEqual([['keep'], ['block']]);
  });

  test('button styling matches the canonical Button spec exactly (§1.9, one source of truth)', async () => {
    const { container } = await mount(VerbBar as Impl, { actions });
    const verbGhost = container.querySelector('button[data-lp-verb="edit"]') as HTMLElement;
    const buttonGhost = mountPrimitive(Button, 'Button', { label: 'edit', variant: 'ghost' }).el;
    const a = getComputedStyle(verbGhost);
    const b = getComputedStyle(buttonGhost);
    for (const prop of [
      'color',
      'backgroundColor',
      'borderTopWidth',
      'borderTopStyle',
      'borderTopColor',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'fontSize',
      'fontWeight',
      'textTransform',
      'letterSpacing',
      'borderTopLeftRadius',
    ] as const) {
      expect(a[prop], prop).toBe(b[prop]);
    }
    // the previously drifted values, pinned: ghost = secondary text, 5px 12px
    expect(a.color).toBe(rgb(tokenColors.text.secondary));
    expect(a.paddingTop).toBe('5px');
    expect(a.paddingLeft).toBe('12px');
    // filled variants carry a transparent border like Button, not a colored one
    const verbConfirm = container.querySelector('button[data-lp-verb="keep"]') as HTMLElement;
    expect(getComputedStyle(verbConfirm).borderTopColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(verbConfirm).backgroundColor).toBe(rgb(tokenColors.accent.done));
  });

  test('renders without label and without keyHint', async () => {
    const { container } = await mount(VerbBar as Impl, {
      actions: [{ label: 'undo', variant: 'ghost', event: 'undo' }],
    });
    const btn = container.querySelector('button[data-lp-verb="undo"]');
    expect(btn?.textContent).toBe('undo');
    expect(btn?.querySelector('[data-lp-key-hint]')).toBeNull();
  });
});

describe('Hotkeys', () => {
  const key = (init: KeyboardEventInit) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  test('renders nothing and emits the literal key event on keydown', async () => {
    const { container, emit } = await mount(Hotkeys as Impl, {
      keys: [{ key: 'k' }, { key: 'd' }],
    });
    expect(container.innerHTML).toBe('');
    key({ key: 'k' });
    expect(emit.mock.calls).toEqual([['k']]);
    key({ key: 'd' });
    expect(emit.mock.calls).toEqual([['k'], ['d']]);
    key({ key: 'x' });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  test('supports modifier syntax like shift+b, distinct from the bare key', async () => {
    const { emit } = await mount(Hotkeys as Impl, { keys: [{ key: 'shift+b' }, { key: 'b' }] });
    key({ key: 'B', shiftKey: true });
    expect(emit.mock.calls).toEqual([['shift+b']]);
    key({ key: 'b' });
    expect(emit.mock.calls).toEqual([['shift+b'], ['b']]);
    // an undeclared modifier blocks the match
    key({ key: 'b', ctrlKey: true });
    expect(emit).toHaveBeenCalledTimes(2);
  });

  test('respects a pre-resolved `when: false`', async () => {
    const { emit } = await mount(Hotkeys as Impl, {
      keys: [
        { key: '1', when: false },
        { key: '2', when: true },
      ],
    });
    key({ key: '1' });
    expect(emit).not.toHaveBeenCalled();
    key({ key: '2' });
    expect(emit.mock.calls).toEqual([['2']]);
  });

  test('is suspended while a textarea or input has focus', async () => {
    const { emit } = await mount(Hotkeys as Impl, { keys: [{ key: 'k' }] });
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    try {
      ta.focus();
      key({ key: 'k' });
      expect(emit).not.toHaveBeenCalled();
      ta.blur();
      key({ key: 'k' });
      expect(emit.mock.calls).toEqual([['k']]);
    } finally {
      ta.remove();
    }
  });

  test('removes the window listener on unmount', async () => {
    const { emit, screen } = await mount(Hotkeys as Impl, { keys: [{ key: 'k' }] });
    key({ key: 'k' });
    expect(emit).toHaveBeenCalledTimes(1);
    screen.unmount();
    key({ key: 'k' });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
