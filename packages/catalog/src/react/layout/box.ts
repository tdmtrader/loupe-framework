// The shared box channel for Stack/Row (design principle 4: state lives in a
// left accent bar — 2px content atoms, 3px structural rows/nodes).
import type { CSSProperties } from 'react';
import type { AccentTone, BgToken, Pad } from '../../defs/index.ts';
import { accentVar, bgVar, padCss } from '../primitives/style.ts';

export interface BoxProps {
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  pad?: Pad;
  bg?: BgToken;
  borders?: 'top' | 'bottom' | 'both';
  accent?: AccentTone;
  accentWidth?: 2 | 3;
  accentEdge?: 'left' | 'top';
  opacity?: number;
  grow?: boolean;
}

const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

export function boxStyle(p: BoxProps, defaultAlign?: 'start' | 'center'): CSSProperties {
  const style: CSSProperties = {};
  if (p.gap !== undefined) style.gap = p.gap;
  const align = p.align ?? defaultAlign;
  if (align !== undefined) style.alignItems = ALIGN[align];
  const padding = padCss(p.pad);
  if (padding !== undefined) style.padding = padding;
  const bg = bgVar(p.bg);
  if (bg !== undefined) style.background = bg;
  if (p.borders === 'top' || p.borders === 'both') style.borderTop = '1px solid var(--lp-border-primary)';
  if (p.borders === 'bottom' || p.borders === 'both') style.borderBottom = '1px solid var(--lp-border-primary)';
  const accent = accentVar(p.accent);
  if (accent !== undefined) {
    const bar = `${p.accentWidth ?? 2}px solid ${accent}`;
    if ((p.accentEdge ?? 'left') === 'top') style.borderTop = bar;
    else style.borderLeft = bar;
  }
  if (p.grow === true) {
    // Claim the remaining main-axis space AND allow shrinking below content.
    // The min-* reset is load-bearing: a flex child defaults to min-height
    // auto, refuses to shrink past its content, and the scrolling rail inside
    // it then never scrolls — the page grows instead.
    style.flex = '1 1 0%';
    style.minHeight = 0;
    style.minWidth = 0;
  }
  if (p.opacity !== undefined) style.opacity = p.opacity;
  return style;
}
