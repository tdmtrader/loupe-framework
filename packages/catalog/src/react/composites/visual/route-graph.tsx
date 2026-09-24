// RouteGraph — h-scrollable canvas: absolutely-positioned div layer for
// nodes/terminals over one SVG layer of cubic-bezier edges (design §4,
// design-language §2.4). Node positions come from the data (node.pos {x,y});
// no auto-layout in v1. The component contributes position, the 3px kind-toned
// left border (dashed for conditional), the selection outline from selectedId,
// and the nodeSelect event; card CONTENT renders via the `node` itemSlot
// (terminals reuse it with terminal: true).
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ComponentImplArgs, JsonObject } from '@loupe/spec';
import { lp, num, posOf, str } from './shared.ts';

export interface RouteGraphProps {
  nodes: JsonObject[];
  edges: JsonObject[];
  terminals?: JsonObject[];
  size: { width: number; height: number };
  selectedId?: string | null;
  annotations?: JsonObject[];
}

const NODE_W = 132;
const TERMINAL_H = 36;
const DEFAULT_NODE_H = 36;

/** Kind → left-border accent (violet agent / gray task / amber await / dark-red fail). */
const kindAccent = (kind: string | undefined, fail: boolean): string => {
  if (fail || kind === 'fail') return lp('accentBadDeep');
  switch (kind) {
    case 'agent':
      return lp('accentAgent');
    case 'await':
    case 'wait':
      return lp('accentWait');
    case 'person':
      return lp('accentPerson');
    default:
      return lp('textSecondary'); // task and anything unrecognized: gray
  }
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const idOf = (o: JsonObject, i: number, prefix: string): string =>
  str(o['id']) ?? str(o['name']) ?? `${prefix}${i}`;

export function RouteGraph({
  props,
  emit,
  itemSlot,
}: ComponentImplArgs<ReactNode, RouteGraphProps>): ReactNode {
  const uid = useId();
  const flowMarker = `${uid}-flow`;
  const failMarker = `${uid}-fail`;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Edges anchor to node rects (right-center → left-center); heights are
  // content-driven, so measure the cards after layout and re-draw once.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const next: Record<string, number> = {};
    for (const card of layer.querySelectorAll<HTMLElement>('[data-lp-rect-id]')) {
      next[card.dataset['lpRectId'] ?? ''] = card.offsetHeight;
    }
    setHeights((prev) => {
      const keys = Object.keys(next);
      const same =
        keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]);
      return same ? prev : next;
    });
  });

  const nodes = props.nodes ?? [];
  const terminals = props.terminals ?? [];
  const { width, height } = props.size;

  const rects = new Map<string, Rect>();
  nodes.forEach((n, i) => {
    const id = idOf(n, i, 'node-');
    const { x, y } = posOf(n);
    rects.set(id, { x, y, w: NODE_W, h: heights[id] ?? DEFAULT_NODE_H });
  });
  terminals.forEach((t, i) => {
    const id = idOf(t, i, 'terminal-');
    const { x, y } = posOf(t);
    rects.set(id, { x, y, w: NODE_W, h: heights[id] ?? TERMINAL_H });
  });

  // Cubic bezier right-center → left-center, control points at ±40% dx.
  const edgePath = (from: Rect, to: Rect): string => {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const c = 0.4 * (x2 - x1);
    return `M ${x1},${y1} C ${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
  };

  const arrow = (id: string, color: string): ReactNode => (
    <marker
      id={id}
      viewBox="0 0 8 8"
      refX={7}
      refY={4}
      markerWidth={6}
      markerHeight={6}
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 8 4 L 0 8 z" style={{ fill: color }} />
    </marker>
  );

  return (
    <div data-lp="route-graph" style={{ overflowX: 'auto' }}>
      <div ref={layerRef} style={{ position: 'relative', width, height }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            {arrow(flowMarker, lp('borderIdle'))}
            {arrow(failMarker, lp('accentBadDeep'))}
          </defs>
          {(props.edges ?? []).map((e, i) => {
            const from = rects.get(str(e['from']) ?? '');
            const to = rects.get(str(e['to']) ?? '');
            if (!from || !to) return null;
            const fail = e['fail'] === true || str(e['kind']) === 'fail';
            return (
              <path
                key={`${str(e['from'])}→${str(e['to'])}:${i}`}
                data-lp="edge"
                data-edge-kind={fail ? 'fail' : 'flow'}
                d={edgePath(from, to)}
                fill="none"
                strokeWidth={2}
                strokeDasharray={fail ? '6 5' : undefined}
                markerEnd={`url(#${fail ? failMarker : flowMarker})`}
                style={{ stroke: fail ? lp('accentBadDeep') : lp('borderIdle') }}
              />
            );
          })}
        </svg>

        {terminals.map((t, i) => {
          const id = idOf(t, i, 'terminal-');
          const { x, y } = posOf(t);
          return (
            <div
              key={`terminal:${id}`}
              data-lp="terminal"
              data-lp-rect-id={id}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: NODE_W,
                height: TERMINAL_H,
                boxSizing: 'border-box',
                padding: '0 11px',
                border: `1px solid ${lp('borderIdle')}`,
                background: lp('bgPage'),
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {itemSlot('node', { node: t, terminal: true, selected: false }, `terminal:${id}`)}
            </div>
          );
        })}

        {nodes.map((n, i) => {
          const id = idOf(n, i, 'node-');
          const { x, y } = posOf(n);
          const selected = props.selectedId != null && props.selectedId === id;
          const dashed =
            n['conditional'] === true || n['dashed'] === true || str(n['kind']) === 'conditional';
          const accent = kindAccent(str(n['kind']), n['fail'] === true);
          return (
            <div
              key={`node:${id}`}
              data-lp="node"
              data-lp-rect-id={id}
              data-selected={selected ? 'true' : undefined}
              onClick={() => emit('nodeSelect', { id })}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: NODE_W,
                boxSizing: 'border-box',
                cursor: 'pointer',
                background: lp('bgPage'),
                borderLeft: `3px ${dashed ? 'dashed' : 'solid'} ${accent}`,
                outline: selected ? `1px solid ${lp('accentPerson')}` : 'none',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {itemSlot('node', { node: n, terminal: false, selected }, `node:${id}`)}
            </div>
          );
        })}

        {(props.annotations ?? []).map((a, i) => {
          const tone = str(a['tone']) ?? 'badText';
          return (
            <span
              key={`annotation:${i}`}
              data-lp="annotation"
              style={{
                position: 'absolute',
                left: num(a['x'], 0),
                top: num(a['y'], 0),
                width: num(a['width'], 190),
                fontSize: 'var(--lp-size-10)',
                fontWeight: 'var(--lp-weight-body)' as CSSProperties['fontWeight'],
                color: lp(`accent${tone[0]?.toUpperCase()}${tone.slice(1)}`),
              }}
            >
              {str(a['text'])}
            </span>
          );
        })}
      </div>
    </div>
  );
}
