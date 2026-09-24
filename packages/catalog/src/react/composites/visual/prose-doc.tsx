// A reading surface for a parsed document.
//
// The projection parses; this renders — the DiffBlock precedent. Two decisions
// are load-bearing and neither is arbitrary:
//
//  - INLINE CODE IS GROUND *AND* FONT. Under a one-typeface theme, ground was
//    all it could be: code got bg.inset and a text tier and nothing else,
//    because there was no second face to switch to. It now also takes
//    `monoBase`, which under classic resolves to the same Inconsolata and
//    changes nothing, and under a two-face theme is what makes an identifier
//    look like an identifier. This matters more here than it looks: these
//    documents carry roughly one code span per two lines and they are almost
//    all identifiers.
//  - THE MEASURE IS ITS OWN. `Prose` is capped at 62–76ch for a finding body.
//    A 300-line review is a reading surface, not a UI label, so this component
//    carries its own measure rather than widening a shared component that four
//    other screens depend on.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { ProseDocProps } from '../../../defs/index.ts';
import { fontBase, monoBase, radius, weight } from '../../primitives/style.ts';
import { lp } from './shared.ts';

interface Span { t: string; v: string; spans?: Span[] }
interface Block {
  kind: string;
  id?: string;
  level?: number;
  done?: boolean;
  marker?: string;
  lang?: string | null;
  lines?: string[];
  spans?: Span[];
  head?: Span[][];
  rows?: Span[][][];
}

/** Heading level -> the closed scale. Nothing between 10/11/12/14/16/18/24. */
const HEADING: Record<number, { fontSize: string; fontWeight: CSSProperties['fontWeight'] }> = {
  1: { fontSize: 'var(--lp-size-18)', fontWeight: weight.max },
  2: { fontSize: 'var(--lp-size-16)', fontWeight: weight.max },
  3: { fontSize: 'var(--lp-size-14)', fontWeight: weight.max },
  4: { fontSize: 'var(--lp-size-12)', fontWeight: weight.strong },
  5: { fontSize: 'var(--lp-size-12)', fontWeight: weight.strong },
  6: { fontSize: 'var(--lp-size-12)', fontWeight: weight.strong },
};

function spans(list: Span[] | undefined, key: string): ReactNode {
  return (list ?? []).map((s, i) => {
    const k = `${key}/s${i}`;
    if (s.t === 'code') {
      return (
        <span
          key={k}
          data-lp="ProseDoc-code"
          style={{
            ...monoBase,
            background: lp('bgInset'),
            color: lp('textPrimary'),
            padding: '1px 4px',
            borderRadius: radius.sm,
          }}
        >
          {s.v}
        </span>
      );
    }
    // A bold body may carry its own spans (one level: the reader nests code
    // inside bold and nothing else). `v` stays the raw body, so a bold that
    // carries no `spans` renders exactly as it always did.
    if (s.t === 'bold') {
      return (
        <strong key={k} style={{ fontWeight: weight.strong, color: lp('textPrimary') }}>
          {s.spans === undefined ? s.v : spans(s.spans, k)}
        </strong>
      );
    }
    if (s.t === 'italic') return <em key={k} style={{ fontStyle: 'italic' }}>{s.v}</em>;
    return <span key={k}>{s.v}</span>;
  });
}

/** 12/400 at the prose line-height — the reading body, not the UI body. */
const body = {
  fontSize: 'var(--lp-size-12)',
  fontWeight: weight.body,
  lineHeight: 'var(--lp-prose-line-height)',
} as const;

export const ProseDoc: ComponentImpl<ReactNode, ProseDocProps> = ({ props }) => {
  const blocks = (props.blocks ?? []) as unknown as Block[];
  // The rising-edge idiom, copied from `Stack.scrollIntoView` rather than
  // reinvented: compare against the previous value and scroll only on a CHANGE
  // to a non-null one. Scrolling on every render would fight the reader's own
  // scrollbar; scrolling on mount would jump a freshly-opened document to
  // whichever heading was last pressed on the previous one.
  //
  // The component renders NO outline. `props.outline` is the served map the
  // fabrial repeats; what this holds is the ids, which live on the heading
  // blocks — one function in the projection produces both, so they cannot
  // disagree.
  const root = useRef<HTMLDivElement | null>(null);
  const prevAnchor = useRef<string | null>(null);
  const anchor = props.anchor ?? null;
  useEffect(() => {
    if (anchor !== null && anchor !== prevAnchor.current) {
      const target = root.current?.querySelector(`[data-lp-anchor="${CSS.escape(anchor)}"]`);
      if (target instanceof HTMLElement) target.scrollIntoView({ block: 'start' });
    }
    prevAnchor.current = anchor;
  });
  return (
    <div
      ref={root}
      data-lp="ProseDoc"
      style={{
        ...fontBase,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: `${props.maxCh ?? 84}ch`,
        width: '100%',
        minWidth: 0,
        marginInline: 'auto',
        overflowWrap: 'anywhere',
        color: lp('textBody'),
      }}
    >
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === 'heading') {
          const h = HEADING[b.level ?? 3] ?? HEADING[3]!;
          return (
            <div
              key={key}
              data-lp="ProseDoc-heading"
              data-lp-anchor={b.id}
              style={{ ...h, color: lp('textHeading'), marginTop: i === 0 ? 0 : 6, scrollMarginTop: 8 }}
            >
              {spans(b.spans, key)}
            </div>
          );
        }
        if (b.kind === 'rule') {
          return <div key={key} data-lp="ProseDoc-rule" style={{ height: 1, background: lp('borderPrimary') }} />;
        }
        if (b.kind === 'code') {
          return (
            <div
              key={key}
              data-lp="ProseDoc-codeblock"
              style={{
                ...monoBase,
                background: lp('bgInset'),
                borderLeft: `2px solid ${lp('borderPrimary')}`,
                borderRadius: radius.sm,
                padding: '8px 10px',
                fontSize: 'var(--lp-size-12)',
                fontWeight: weight.body,
                lineHeight: 'var(--lp-diff-line-height)',
                color: lp('textBody'),
                overflowX: 'auto',
                whiteSpace: 'pre',
              }}
            >
              {(b.lines ?? []).join('\n')}
            </div>
          );
        }
        if (b.kind === 'quote') {
          return (
            <div
              key={key}
              data-lp="ProseDoc-quote"
              style={{ ...body, borderLeft: `2px solid ${lp('accentAgent')}`, paddingLeft: 10, color: lp('textBody') }}
            >
              {spans(b.spans, key)}
            </div>
          );
        }
        if (b.kind === 'bullet' || b.kind === 'ordered' || b.kind === 'task') {
          const marker =
            b.kind === 'ordered' ? `${b.marker ?? ''}.` : b.kind === 'task' ? (b.done === true ? '✓' : '·') : '–';
          return (
            <div
              key={key}
              data-lp={`ProseDoc-${b.kind}`}
              style={{ ...body, display: 'flex', gap: 8, paddingLeft: (b.level ?? 0) * 0 + ((b as { depth?: number }).depth ?? 0) * 16 }}
            >
              <span
                style={{
                  color: b.kind === 'task' && b.done === true ? lp('accentDone') : lp('textMuted'),
                  minWidth: 14,
                }}
              >
                {marker}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{spans(b.spans, key)}</span>
            </div>
          );
        }
        if (b.kind === 'table') {
          const cols = (b.head ?? []).length || 1;
          return (
            <div key={key} data-lp="ProseDoc-table" style={{ overflowX: 'auto' }}>
              {/*
                Columns are sized to CONTENT, not shared equally. `repeat(n,
                minmax(0, 1fr))` gave a 122-character cell exactly the width of
                a six-character one beside it, which is how a criteria table
                became a column of single words. `auto` lets a column take what
                it needs; the `min-content` floor stops one long cell from
                collapsing its neighbours to nothing; and the `overflowX`
                container this already sits in is what makes a wide table
                scroll rather than break the page.
              */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(min-content, auto))`, gap: 1, background: lp('borderPrimary') }}>
                {(b.head ?? []).map((c, ci) => (
                  <div key={`${key}/h${ci}`} style={{ ...body, fontWeight: weight.strong, background: lp('bgInset'), padding: '5px 8px', color: lp('textSecondary') }}>
                    {spans(c, `${key}/h${ci}`)}
                  </div>
                ))}
                {(b.rows ?? []).map((r, ri) =>
                  r.map((c, ci) => (
                    <div key={`${key}/r${ri}c${ci}`} style={{ ...body, background: lp('bgPage'), padding: '5px 8px' }}>
                      {spans(c, `${key}/r${ri}c${ci}`)}
                    </div>
                  )),
                )}
              </div>
            </div>
          );
        }
        return (
          <div key={key} data-lp="ProseDoc-para" style={body}>
            {spans(b.spans, key)}
          </div>
        );
      })}
    </div>
  );
};
