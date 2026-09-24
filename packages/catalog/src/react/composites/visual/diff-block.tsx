// DiffBlock — the 56px/22px/1fr diff grid at 21px line-height, colored from
// the diff token septet by sign (design §4, design-language §1.5, §2.7).
// After each line it interleaves every notes[] item whose {line, side} anchor
// exact-matches (note itemSlot, margin-left to the 78px code gutter, 2px
// accent) and, when composeAt matches, the compose itemSlot. Click a changed
// ('+'/'-') line → linePress {file, line, side}; context lines are inert.
// maxLines slices with a truncation note.
import { memo, type CSSProperties, type ReactNode } from 'react';
import type { ComponentImplArgs, JsonObject } from '@loupe/spec';
import { lp, str } from './shared.ts';

export interface DiffLine {
  no: number;
  sign: '+' | '-' | ' ';
  text: string;
  side?: '+' | '-';
}

export interface DiffBlockProps {
  file?: string;
  lines: DiffLine[];
  notes?: JsonObject[];
  composeAt?: { line: number; side: string } | null;
  maxLines?: number;
}

/** The diff septet (+ context grays), by sign. */
const SIGN_STYLE: Record<string, { bg: string; no: string; sign: string; text: string }> = {
  '+': { bg: lp('diffAddBg'), no: lp('diffAddNo'), sign: lp('diffAddSign'), text: lp('diffAddText') },
  '-': { bg: lp('diffDelBg'), no: lp('diffDelNo'), sign: lp('diffDelSign'), text: lp('diffDelText') },
  ' ': { bg: 'transparent', no: lp('diffCtxNo'), sign: lp('diffCtxNo'), text: lp('diffCtxText') },
};

const GRID = '56px 22px 1fr';
/** Code gutter: 20px row pad + 56px number column + 2px into the sign column. */
const GUTTER = 78;

interface LineRowProps {
  line: DiffLine;
  file: string | undefined;
  hasSlots: boolean;
  onPress: (line: DiffLine) => void;
}

// Memoized on (line, hasSlots): slotless rows skip re-render when their line
// is unchanged; any row with slots always re-renders (slot content may change).
const LineRow = memo(
  function LineRow({ line, onPress }: LineRowProps): ReactNode {
    const s = SIGN_STYLE[line.sign] ?? SIGN_STYLE[' ']!;
    // Findings anchor to changed lines only (comp): context lines are inert —
    // no linePress, default cursor.
    const interactive = line.sign === '+' || line.sign === '-';
    return (
      <div
        data-lp="diff-line"
        data-sign={line.sign}
        onClick={interactive ? () => onPress(line) : undefined}
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          padding: '0 20px',
          cursor: interactive ? 'pointer' : undefined,
          background: s.bg,
        }}
      >
        <span style={{ textAlign: 'right', paddingRight: 12, color: s.no }}>{line.no}</span>
        <span style={{ color: s.sign }}>{line.sign}</span>
        <span style={{ whiteSpace: 'pre', color: s.text }}>{line.text}</span>
      </div>
    );
  },
  (a, b) =>
    !a.hasSlots &&
    !b.hasSlots &&
    a.file === b.file &&
    a.line.no === b.line.no &&
    a.line.sign === b.line.sign &&
    a.line.side === b.line.side &&
    a.line.text === b.line.text,
);

/** A note's 2px accent: declared tone, else violet for yours, gray otherwise. */
const noteAccent = (note: JsonObject): string => {
  const tone = str(note['tone']);
  if (tone) return lp(`accent${tone[0]?.toUpperCase()}${tone.slice(1)}`);
  return note['mine'] === true ? lp('accentAgent') : lp('borderIdle');
};

export function DiffBlock({
  props,
  emit,
  itemSlot,
}: ComponentImplArgs<ReactNode, DiffBlockProps>): ReactNode {
  const all = props.lines ?? [];
  const lines =
    props.maxLines != null && all.length > props.maxLines ? all.slice(0, props.maxLines) : all;
  const truncated = all.length - lines.length;

  // A line's side defaults to its sign (context lines anchor on ' ').
  const sideOf = (l: DiffLine): string => l.side ?? l.sign;
  const onPress = (l: DiffLine): void => {
    emit('linePress', { file: props.file ?? null, line: l.no, side: sideOf(l) });
  };

  return (
    <div
      data-lp="diff-block"
      style={{
        fontFamily: lp('fontMono'),
        letterSpacing: 'normal',
        fontSize: 'var(--lp-size-12)',
        fontWeight: 'var(--lp-weight-body)' as CSSProperties['fontWeight'],
        lineHeight: 'var(--lp-diff-line-height)',
      }}
    >
      {lines.map((l, i) => {
        const side = sideOf(l);
        const notes = (props.notes ?? []).filter((n) => n['line'] === l.no && n['side'] === side);
        const composeHere =
          props.composeAt != null && props.composeAt.line === l.no && props.composeAt.side === side;
        const hasSlots = notes.length > 0 || composeHere;
        return (
          <div key={`${l.no}:${side}:${i}`} style={{ display: 'flex', flexDirection: 'column' }}>
            <LineRow line={l} file={props.file} hasSlots={hasSlots} onPress={onPress} />
            {notes.map((n, j) => (
              <div
                key={`note:${l.no}:${side}:${j}`}
                data-lp="diff-note"
                style={{
                  margin: `6px 20px 8px ${GUTTER}px`,
                  borderLeft: `2px solid ${noteAccent(n)}`,
                  background: lp('bgPanel'),
                  padding: '9px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                {itemSlot('note', { note: n }, `note:${l.no}:${side}:${j}`)}
              </div>
            ))}
            {composeHere && (
              <div
                data-lp="diff-compose"
                style={{
                  margin: `6px 20px 10px ${GUTTER}px`,
                  border: `1px solid ${lp('borderViolet')}`,
                  background: lp('bgPanel'),
                  padding: '11px 13px',
                }}
              >
                {itemSlot('compose', { line: l.no, side }, `compose:${l.no}:${side}`)}
              </div>
            )}
          </div>
        );
      })}
      {truncated > 0 && (
        <div
          data-lp="diff-truncated"
          style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 20px' }}
        >
          <span />
          <span style={{ color: lp('diffCtxNo') }}>⋮</span>
          <span style={{ color: lp('textDim') }}>
            … {truncated} more {truncated === 1 ? 'line' : 'lines'}
          </span>
        </div>
      )}
    </div>
  );
}
