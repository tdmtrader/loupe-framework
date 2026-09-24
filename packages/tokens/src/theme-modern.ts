// @loupe/tokens — "modern", the host's default theme.
//
// Same contract as classic (theme.ts), different answers. It exists because
// the classic theme, faithfully applied to whole screens, reads as busy:
// every glyph one monospace face at 700, most of them uppercase with .0425em
// tracking on top of section tracking, at 10–12px, on a page whose only
// separators are 1px hairlines at near-text contrast. Everything shouts, so
// nothing leads.
//
// The five moves, in order of how much they buy:
//
//  1. TWO FACES. A system UI sans carries labels, prose and numbers; the mono
//     face is kept for the things that are actually code — diffs, code blocks,
//     digests — where column alignment is the point. No webfont: the host loads
//     no stylesheet, and a self-hosted tool should not need the network to look
//     right.
//  2. HIERARCHY BY SIZE AND WEIGHT, not by color. The scale keeps its NAMES
//     (10/11/12/14/16/18/24 — principle 1 is intact and fabrials are untouched)
//     and re-pitches its VALUES up a step; the default weight drops 700 → 500 so
//     that 600 and 700 can mean something again.
//  3. LOWERCASE. Micro-labels stop being uppercase — the wayfinding line
//     "↑↓ move · f v a n x decide · r w s resolve" was being SHOUTED — and
//     tracking drops to near-normal. Only badges keep a case rule, and it is
//     capitalize, which is what makes a one-word status read as a chip.
//  4. QUIETER SEMANTICS. The tone fills were near-neon (#1CBD63, #fad43b) and
//     sat next to each other on every row. They step back toward Tailwind-400s:
//     still unambiguous, no longer competing with the text they annotate.
//  5. STRUCTURE YOU CAN SEE THROUGH. Borders drop to well below text contrast
//     so they separate without drawing; radius arrives (4/6/10/pill) so a badge
//     reads as a badge without a border doing the work; panels get one soft
//     shadow instead of a hairline box.
//
// Surfaces are a cool near-neutral rather than pure gray: at these low
// lightnesses a touch of blue keeps the page from reading as "off" black, and
// gives the amber/violet tints somewhere to sit.
import type { Theme } from './theme.ts';

export const modern = {
  color: {
    bg: {
      /** Body background; also “ink” — the fg on every filled chip/button. */
      page: '#101114',
      panel: '#16181D',
      raised: '#1B1E24',
      inset: '#14161A',
      selected: '#222630',
      selectedViolet: '#221F33',
      tintBlue: '#10202E',
      tintAmber: '#241C0E',
      tintAmberDim: '#1A150C',
      tintRed: '#2A1618',
    },
    scrim: 'rgba(8,9,12,.72)',
    border: {
      /** Deliberately well below text contrast: structure, not decoration. */
      primary: '#262A33',
      hairline: '#232833',
      idle: '#383E4A',
      amber: '#5A4212',
      violet: '#3D3866',
      blue: '#1B4C74',
      red: '#6E2A28',
    },
    text: {
      heading: '#F5F7FA',
      primary: '#E4E7ED',
      /** Raised from classic's #c6c6c6 — this is the reading tier. */
      body: '#C2C8D2',
      secondary: '#98A1AF',
      dim: '#737D8C',
      muted: '#4E5764',
      /** On filled chips/buttons — same value as bg.page. */
      inverse: '#101114',
    },
    tone: {
      // `soft` is the hue at roughly 12% over the panel — enough ground to
      // carry `text` at contrast, quiet enough to repeat down forty rows.
      agent: { fill: '#A78BFA', border: '#3D3866', text: '#C4B5FD', soft: '#262042' },
      person: { fill: '#60A5FA', border: '#1B4C74', text: '#93C5FD', soft: '#13283E' },
      wait: { fill: '#F0B429', border: '#5A4212', text: '#FCD34D', soft: '#2F2410' },
      waitBright: { fill: '#FDE9C0', border: '#5A4212', text: '#FDE9C0', soft: '#332912' },
      now: { fill: '#FACC15', border: '#5A4212', text: '#FDE047', soft: '#31290D' },
      done: { fill: '#34D399', border: '#17795A', text: '#6EE7B7', soft: '#112C24' },
      bad: { fill: '#F87171', border: '#6E2A28', text: '#FCA5A5', soft: '#2F1A1B' },
    },
    accent: {
      agent: '#A78BFA',
      person: '#60A5FA',
      personHover: '#93C5FD',
      wait: '#F0B429',
      waitText: '#FCD34D',
      waitBright: '#FDE9C0',
      now: '#FACC15',
      done: '#34D399',
      doneDeep: '#17795A',
      bad: '#F87171',
      badDeep: '#6E2A28',
      badText: '#FCA5A5',
    },
    diff: {
      addBg: '#10281E',
      addText: '#A7F3D0',
      addNo: '#17795A',
      addSign: '#34D399',
      delBg: '#2E1618',
      delText: '#FECDD3',
      delNo: '#6E2A28',
      delSign: '#F87171',
      ctxText: '#C2C8D2',
      ctxNo: '#4E5764',
    },
    claim: {
      observed: '#98A1AF',
      attributable: '#A78BFA',
      reproducible: '#34D399',
      witnessed: '#F0B429',
    },
  },
  font: {
    // System stacks on purpose: instant, no FOUT, no network, and they are the
    // faces the reader's other tools already use.
    family:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, 'Helvetica Neue', Arial, sans-serif",
    familyMono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    weights: { regular: 400, bold: 600, black: 700 },
    /** 500 is the resting weight; 600/700 are now available to mean something. */
    weight: { body: 400, medium: 500, strong: 600, max: 700 },
    defaultWeight: 500,
    /** A sans at these sizes needs no help; tracking was a mono compensation. */
    letterSpacing: 'normal',
    baseSize: 13,
    baseLineHeight: 1.5,
    scale: [10, 11, 12, 14, 16, 18, 24],
    /**
     * The scale, re-pitched. Names are unchanged, so no fabrial and no
     * component moves; `--lp-size-12` — the body size — simply becomes 13px.
     */
    sizePx: { 10: 11, 11: 12, 12: 13, 14: 15, 16: 18, 18: 21, 24: 30 },
    tracking: { section: '0.04em', interactive: '0.01em' },
    prose: { minCh: 62, maxCh: 72, maxChCap: 80, lineHeight: 1.65 },
    /** Follows the mono face's 13px body. */
    diffLineHeight: '22px',
  },
  radius: 6,
  radii: { sm: '4px', md: '6px', lg: '10px', pill: '999px' },
  shadow: '0 1px 2px rgba(0,0,0,.35)',
  shadows: {
    panel: '0 1px 2px rgba(0,0,0,.35)',
    overlay: '-24px 0 64px rgba(0,0,0,.55)',
  },
  /**
   * Micro-labels and buttons carry the author's own casing — several are whole
   * sentences. Badges capitalize: a status word wants to look like a token.
   */
  transform: { micro: 'none', badge: 'capitalize', button: 'none' },
  /**
   * Filled means TINTED. The severity ladder the fabrials encode — critical
   * and high filled, medium and low outline — survives intact (tinted ground
   * vs bare), but a settled board stops being ten green slabs.
   */
  badge: { fillAlpha: '0%', fgTone: '100%' },
  accentWidth: { atom: 2, structural: 3 },
  spacing: {
    hair: 1,
    list: 2,
    pip: 3,
    tight: 8,
    snug: 10,
    row: 12,
    gap: 14,
    region: 18,
    page: 24,
  },
} as const satisfies Theme;

export type Modern = typeof modern;
