// @loupe/tokens — "classic", the original loupe design language.
// This object is scaffold-frozen; the CSS theme
// (theme-classic.css) is generated from it by generate-css.ts.
//
// Rules the tokens encode (design principles 1–6):
// - one typeface (Inconsolata 400/700/900, default 700, letter-spacing .0425em)
// - the closed 10/11/12/14/16/18/24 type scale
// - radius 0, no shadows, 1px hairline borders, 2/3px left accent bars
// - six semantic hues as tri-tone triads {fill, border, text} so a bright fill
//   can never be paired with a bright border by a fabrial.
//
// It fills the `Theme` contract (theme.ts). The keys added for that contract —
// familyMono, weight, sizePx, radii, shadows, transform — all carry classic's
// HISTORICAL values here (one face, 700-heavy, identity size map, radius 0, no
// shadow, uppercase), so theme-classic.css keeps rendering exactly as before.
import type { Theme } from './theme.ts';

export const tokens = {
  color: {
    bg: {
      /** Body background; also “ink” — the fg on every filled chip/button, and input bg. */
      page: '#151515',
      panel: '#1e1d1d',
      raised: '#262626',
      inset: '#191818',
      selected: '#2a2929',
      selectedViolet: '#231F33',
      tintBlue: '#0B2638',
      tintAmber: '#30220A',
      tintAmberDim: '#191205',
      tintRed: '#2A1512',
    },
    scrim: 'rgba(10,10,10,.62)',
    border: {
      primary: '#363636',
      hairline: '#262626',
      /** Ghost-button borders / unselected chips; also the muted glyph color. */
      idle: '#4D4D4D',
      amber: '#6E4500',
      violet: '#4B3E86',
      blue: '#075082',
      red: '#912617',
    },
    text: {
      heading: '#F2F2F2',
      primary: '#e6e7e8',
      body: '#c6c6c6',
      secondary: '#a4a4a4',
      dim: '#808080',
      muted: '#4D4D4D',
      /** On filled chips/buttons — same value as bg.page. */
      inverse: '#151515',
    },
    /**
     * The six semantic hues as tri-tone triads (principle 6): bright fill /
     * deep border / pale text. Components resolve a tone name to its triad
     * internally; fabrials only ever name the tone.
     */
    tone: {
      // `soft` repeats `fill` here: classic has no tinted-badge treatment,
      // and a theme key must still answer even when its theme never asks.
      agent: { fill: '#CDC0FA', border: '#4B3E86', text: '#CDC0FA', soft: '#CDC0FA' },
      person: { fill: '#4BAFF2', border: '#075082', text: '#87CFFF', soft: '#4BAFF2' },
      wait: { fill: '#DE951D', border: '#6E4500', text: '#F2BF6B', soft: '#DE951D' },
      waitBright: { fill: '#FCE0B1', border: '#6E4500', text: '#FCE0B1', soft: '#FCE0B1' },
      now: { fill: '#fad43b', border: '#6E4500', text: '#fad43b', soft: '#fad43b' },
      done: { fill: '#1CBD63', border: '#0D9448', text: '#1CBD63', soft: '#1CBD63' },
      bad: { fill: '#DB5442', border: '#912617', text: '#F7B6AD', soft: '#DB5442' },
    },
    /** Flat accent colors (left accent bars, pips, links, single-color uses). */
    accent: {
      agent: '#CDC0FA',
      person: '#4BAFF2',
      personHover: '#87CFFF',
      wait: '#DE951D',
      waitText: '#F2BF6B',
      waitBright: '#FCE0B1',
      now: '#fad43b',
      done: '#1CBD63',
      doneDeep: '#0D9448',
      bad: '#DB5442',
      badDeep: '#912617',
      badText: '#F7B6AD',
    },
    /** The diff septet (+ context grays). */
    diff: {
      addBg: '#0F2B1C',
      addText: '#B4F0CE',
      addNo: '#0D9448',
      addSign: '#1CBD63',
      delBg: '#3B1915',
      delText: '#FFD9D4',
      delNo: '#912617',
      delSign: '#DB5442',
      ctxText: '#c6c6c6',
      ctxNo: '#4D4D4D',
    },
    /** Claim words — artifact provenance colors. */
    claim: {
      observed: '#a4a4a4',
      attributable: '#CDC0FA',
      reproducible: '#1CBD63',
      witnessed: '#DE951D',
    },
  },
  font: {
    family: "'Inconsolata', monospace",
    /** Classic is a one-typeface system: the code face IS the UI face. */
    familyMono: "'Inconsolata', monospace",
    weights: { regular: 400, bold: 700, black: 900 },
    /** Classic's default weight is 700, so medium and strong both land there. */
    weight: { body: 400, medium: 700, strong: 700, max: 900 },
    defaultWeight: 700,
    letterSpacing: '0.0425em',
    baseSize: 12,
    baseLineHeight: 1.4,
    /** The closed scale — names; nothing between (principle 1). */
    scale: [10, 11, 12, 14, 16, 18, 24],
    /** Classic pitches the scale at its own names — the identity map. */
    sizePx: { 10: 10, 11: 11, 12: 12, 14: 14, 16: 16, 18: 18, 24: 24 },
    /** Uppercase micro-label tracking (principle 2). */
    tracking: { section: '0.12em', interactive: '0.09em' },
    prose: { minCh: 62, maxCh: 68, maxChCap: 76, lineHeight: 1.65 },
    diffLineHeight: '21px',
  },
  /** Radius 0. Everywhere. No shadows. Depth is scrim + border only. */
  radius: 0,
  radii: { sm: '0', md: '0', lg: '0', pill: '0' },
  shadow: 'none',
  shadows: { panel: 'none', overlay: 'none' },
  /** Uppercase-as-transform, on every label class (principle 2). */
  transform: { micro: 'uppercase', badge: 'uppercase', button: 'uppercase' },
  /** Filled means filled: all fill, no tone in the text — the classic slab. */
  badge: { fillAlpha: '100%', fgTone: '0%' },
  /** Left accent bar widths: 2px content atoms, 3px structural rows/nodes. */
  accentWidth: { atom: 2, structural: 3 },
  /** Spacing steps (px): near-flush lists → page gutters. */
  spacing: {
    hair: 1,
    list: 2,
    pip: 3,
    tight: 6,
    snug: 8,
    row: 10,
    gap: 12,
    region: 16,
    page: 24,
  },
} as const satisfies Theme;

export type Tokens = typeof tokens;
export type ToneName = keyof Tokens['color']['tone'];
export type AccentName = keyof Tokens['color']['accent'];
export type TextTierName = keyof Tokens['color']['text'];
export type BgName = keyof Tokens['color']['bg'];
export type ClaimName = keyof Tokens['color']['claim'];
