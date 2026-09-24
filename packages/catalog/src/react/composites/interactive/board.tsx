// Board — owns the HTML5 drag lifecycle and nothing else (design §4).
//
// Renders the 5-column board grid from `columns` + one lane row per `lanes[]`
// item, filling the def-declared itemSlots:
//   laneHeader {lane, dropHint} · card {card, dragging} · laneOpen {lane}
//
// Data contract (lanes/columns arrive as app-shaped JSON via the def's zObj/zJson):
// - lane:   { id: string, open?: boolean, cards?: JsonObject[], ... }
//           `open: true` renders the laneOpen itemSlot across the non-header
//           columns instead of the card cells (ticket detail / paused row —
//           the fabrial composes what it shows there).
// - card:   { id: string, column: string, draggable?: boolean, ... } — cards
//           land in the cell whose key equals `column`; `draggable: false`
//           opts a card (e.g. a done-count stat entry) out of the drag.
// - columns: { template?: string, cells?: (string | {key, width?, tint?})[] }
//           or just the cells array. `tint: true` gives the cell the
//           needs-a-person amber treatment. Defaults reproduce the comp:
//           248px 1fr 1fr 1.3fr 88px with next/happening/needs/done.
//
// Drag rules (design-language §4.2): drag bookkeeping is transient component
// state — never the ui doc, never emitted mid-gesture. The lane header cell is
// the lane handle (cursor:grab, disabled while a card drags); cards drag with
// stopPropagation; source opacity .4 (card) / .45 (lane); a hovered
// lane-reorder target gets the person-blue outline, a hovered card-retrack
// target gets the agent-violet outline + the dropHint line in its laneHeader
// scope. Drop emits exactly ONE semantic event — cardMove {card, toLane} or
// laneMove {lane, before} — and clears the gesture; the Board performs no
// reordering (authoritative order returns via the projection). Same-target
// drops are suppressed. Columns are never drop targets — only whole lane rows
// accept drops; column membership is derived state.
import { useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import type { ComponentImplArgs, Json, JsonObject } from '@loupe/spec';

interface CellSpec {
  key: string;
  width: string;
  tint: boolean;
}

interface ColumnsSpec {
  headerWidth: string;
  template: string;
  cells: CellSpec[];
}

const FALLBACK_HEADER_WIDTH = '248px';

const isObj = (v: Json | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeCells(raw: Json[]): CellSpec[] {
  const cells: CellSpec[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') cells.push({ key: entry, width: '1fr', tint: false });
    else if (isObj(entry) && typeof entry.key === 'string')
      cells.push({
        key: entry.key,
        width: typeof entry.width === 'string' ? entry.width : '1fr',
        tint: entry.tint === true,
      });
  }
  return cells;
}

function normalizeColumns(raw: Json): ColumnsSpec {
  let headerWidth = FALLBACK_HEADER_WIDTH;
  let cells: CellSpec[] | null = null;
  let template: string | null = null;
  if (Array.isArray(raw)) {
    cells = normalizeCells(raw);
  } else if (isObj(raw)) {
    if (typeof raw.headerWidth === 'string') headerWidth = raw.headerWidth;
    if (Array.isArray(raw.cells)) cells = normalizeCells(raw.cells);
    if (typeof raw.template === 'string') template = raw.template;
  }
  if (!cells || cells.length === 0) {
    // The comp's board: up next / happening / needs a person (amber) / done.
    cells = [
      { key: 'next', width: '1fr', tint: false },
      { key: 'happening', width: '1fr', tint: false },
      { key: 'needs', width: '1.3fr', tint: true },
      { key: 'done', width: '88px', tint: false },
    ];
  }
  if (template) headerWidth = template.trim().split(/\s+/)[0] ?? headerWidth;
  else template = [headerWidth, ...cells.map((c) => c.width)].join(' ');
  return { headerWidth, template, cells };
}

/** Transient drag bookkeeping — exists only between dragstart and drop/dragend. */
interface Gesture {
  kind: 'card' | 'lane';
  /** Dragged card id or lane id. */
  id: string;
  /** Card gesture only: the lane the card started in. */
  fromLane: string | null;
  /** Lane id currently hovered as a drop target. */
  over: string | null;
}

type ItemSlot = ComponentImplArgs<ReactNode>['itemSlot'];

const laneRowStyle = (hairline: boolean): CSSProperties => ({
  borderBottom: hairline ? '1px solid var(--lp-border-primary)' : undefined,
  outlineOffset: -1,
});

export function Board({ props, emit, itemSlot }: ComponentImplArgs<ReactNode>): ReactNode {
  const lanesRaw = Array.isArray(props.lanes) ? (props.lanes as Json[]) : [];
  const lanes = lanesRaw.filter(isObj);
  const columns = normalizeColumns((props.columns ?? null) as Json);
  // Gesture state drives rendering (opacity/outline/dropHint); the ref mirrors
  // it so drag handlers read the *current* gesture even when the browser fires
  // dragover/drop before React has re-rendered with fresh closures.
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = (g: Gesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  };

  const clear = () => setGesture(null);

  const laneId = (lane: JsonObject, index: number): string =>
    typeof lane.id === 'string' ? lane.id : String(lane.id ?? index);

  const onLaneDragStart = (id: string) => (e: DragEvent) => {
    if (gestureRef.current?.kind === 'card') {
      e.preventDefault();
      return;
    }
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    setGesture({ kind: 'lane', id, fromLane: null, over: null });
  };

  const onCardDragStart = (id: string, fromLane: string) => (e: DragEvent) => {
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    setGesture({ kind: 'card', id, fromLane, over: null });
  };

  const onLaneDragOver = (id: string) => (e: DragEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    e.preventDefault();
    if (g.over !== id) setGesture({ ...g, over: id });
  };

  const onLaneDrop = (id: string) => (e: DragEvent) => {
    e.preventDefault();
    const g = gestureRef.current;
    if (!g) return;
    // Exactly one semantic event per completed gesture; same-target suppressed.
    if (g.kind === 'lane' && g.id !== id) {
      emit('laneMove', { lane: g.id, before: id });
    } else if (g.kind === 'card' && g.fromLane !== id) {
      emit('cardMove', { card: g.id, toLane: id });
    }
    clear();
  };

  const cardDragging = gesture?.kind === 'card';

  return (
    <div data-lp-board="" style={{ display: 'flex', flexDirection: 'column' }}>
      {lanes.map((lane, index) => {
        const id = laneId(lane, index);
        const isLaneSource = gesture?.kind === 'lane' && gesture.id === id;
        const isLaneTarget = gesture?.kind === 'lane' && gesture.over === id && gesture.id !== id;
        const isCardTarget = cardDragging && gesture?.over === id && gesture?.fromLane !== id;
        const dropHint =
          isCardTarget && gesture ? `move ${gesture.id} into this track` : null;
        const cards = Array.isArray(lane.cards) ? lane.cards.filter(isObj) : [];
        // A lane is open when the projection says so (`lane.open: true`) OR
        // when it holds the card named by props.openCardId — the fabrial-side
        // route to the inline ticket detail (a card press sets a ui key that
        // binds here; design §2.3).
        const openCardId = typeof props.openCardId === 'string' ? props.openCardId : null;
        const open =
          lane.open === true ||
          (openCardId !== null && cards.some((card) => card.id === openCardId));
        return (
          <div
            key={id}
            data-lp-lane={id}
            onDragOver={onLaneDragOver(id)}
            onDrop={onLaneDrop(id)}
            style={{
              ...laneRowStyle(true),
              opacity: isLaneSource ? 0.45 : 1,
              outline: isLaneTarget
                ? '1px solid var(--lp-accent-person)'
                : isCardTarget
                  ? '1px solid var(--lp-accent-agent)'
                  : '1px solid transparent',
              display: 'grid',
              gridTemplateColumns: open
                ? `${columns.headerWidth} 1fr`
                : columns.template,
            }}
          >
            <div
              data-lp-lane-handle={id}
              draggable={!cardDragging}
              onDragStart={onLaneDragStart(id)}
              onDragEnd={clear}
              style={{
                borderRight: '1px solid var(--lp-border-primary)',
                cursor: cardDragging ? 'default' : 'grab',
              }}
            >
              {itemSlot('laneHeader', { lane, dropHint }, `lane-header-${id}`)}
            </div>
            {open
              ? itemSlot('laneOpen', { lane }, `lane-open-${id}`)
              : columns.cells.map((cell, cellIndex) => {
                  const last = cellIndex === columns.cells.length - 1;
                  return (
                    <div
                      key={cell.key}
                      data-lp-cell={cell.key}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--lp-space-tight)',
                        padding: 'var(--lp-space-gap) var(--lp-space-region)',
                        background: cell.tint ? 'var(--lp-bg-tint-amber-dim)' : undefined,
                        borderRight: last
                          ? undefined
                          : cell.tint
                            ? '1px solid var(--lp-border-amber)'
                            : '1px solid var(--lp-border-primary)',
                      }}
                    >
                      {cards
                        .filter((card) => card.column === cell.key)
                        .map((card, cardIndex) =>
                          renderCard(card, cardIndex, id, gesture, itemSlot, {
                            onCardDragStart,
                            clear,
                          }),
                        )}
                    </div>
                  );
                })}
          </div>
        );
      })}
    </div>
  );
}

function renderCard(
  card: JsonObject,
  index: number,
  fromLane: string,
  gesture: Gesture | null,
  itemSlot: ItemSlot,
  h: {
    onCardDragStart: (id: string, fromLane: string) => (e: DragEvent) => void;
    clear: () => void;
  },
): ReactNode {
  const id = typeof card.id === 'string' ? card.id : String(card.id ?? index);
  const draggable = card.draggable !== false;
  const dragging = gesture?.kind === 'card' && gesture.id === id;
  return (
    <div
      key={`card-${id}`}
      data-lp-card={id}
      draggable={draggable}
      onDragStart={draggable ? h.onCardDragStart(id, fromLane) : undefined}
      onDragEnd={draggable ? h.clear : undefined}
      style={{ cursor: draggable ? 'grab' : undefined, opacity: dragging ? 0.4 : 1 }}
    >
      {itemSlot('card', { card, dragging }, `card-${id}`)}
    </div>
  );
}
