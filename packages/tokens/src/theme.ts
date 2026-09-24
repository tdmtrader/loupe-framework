// The Theme shape — the contract every loupe theme fills.
//
// v1 had exactly one theme (classic) and the design doc promised that "a
// future theme is a CSS file swap". That promise was only half true: colors and
// sizes went through --lp-* vars, but the *chrome* decisions — radius 0,
// uppercase-as-transform, no shadows, one monospace typeface, the 10/11/12/…
// pixel values themselves — were literals inside the catalog impls, so no CSS
// file could move them. This interface is the rest of the promise: everything a
// theme decides now has a name, and `generateCss(theme)` emits the whole of it.
//
// Two themes ship: `tokens` (classic, unchanged, still emitted to
// theme-classic.css) and `modern` (theme-modern.ts, the host default).

/** How a class of label is cased. The theme decides; components never do. */
export type Transform = 'uppercase' | 'capitalize' | 'none';

/**
 * A hue, as the four surfaces a component may need of it (principle 6):
 * bright fill / deep border / pale text / and `soft`, a tinted ground dark
 * enough to sit under `text`. `soft` is what lets a theme answer "filled"
 * with a tint instead of a slab — see `badge` below.
 */
export interface Triad {
  fill: string;
  border: string;
  text: string;
  soft: string;
}

export type BgKey =
  | 'page'
  | 'panel'
  | 'raised'
  | 'inset'
  | 'selected'
  | 'selectedViolet'
  | 'tintBlue'
  | 'tintAmber'
  | 'tintAmberDim'
  | 'tintRed';

export type BorderKey = 'primary' | 'hairline' | 'idle' | 'amber' | 'violet' | 'blue' | 'red';

export type TextKey = 'heading' | 'primary' | 'body' | 'secondary' | 'dim' | 'muted' | 'inverse';

export type ToneKey = 'agent' | 'person' | 'wait' | 'waitBright' | 'now' | 'done' | 'bad';

export type AccentKey =
  | 'agent'
  | 'person'
  | 'personHover'
  | 'wait'
  | 'waitText'
  | 'waitBright'
  | 'now'
  | 'done'
  | 'doneDeep'
  | 'bad'
  | 'badDeep'
  | 'badText';

export type DiffKey =
  | 'addBg'
  | 'addText'
  | 'addNo'
  | 'addSign'
  | 'delBg'
  | 'delText'
  | 'delNo'
  | 'delSign'
  | 'ctxText'
  | 'ctxNo';

export type ClaimKey = 'observed' | 'attributable' | 'reproducible' | 'witnessed';

/** The closed type scale, by NAME. Values live in `font.sizePx`. */
export type SizeName = 10 | 11 | 12 | 14 | 16 | 18 | 24;

export type SpacingKey =
  | 'hair'
  | 'list'
  | 'pip'
  | 'tight'
  | 'snug'
  | 'row'
  | 'gap'
  | 'region'
  | 'page';

export interface Theme {
  color: {
    bg: Record<BgKey, string>;
    scrim: string;
    border: Record<BorderKey, string>;
    text: Record<TextKey, string>;
    tone: Record<ToneKey, Triad>;
    accent: Record<AccentKey, string>;
    diff: Record<DiffKey, string>;
    claim: Record<ClaimKey, string>;
  };
  font: {
    /** The UI face — labels, prose, numbers. */
    family: string;
    /** The code face — diffs, code blocks, digests. May equal `family`. */
    familyMono: string;
    /** Raw numeric weights, kept for the styleguide and back-compat. */
    weights: { regular: number; bold: number; black: number };
    /**
     * Semantic weights. Components ask for a ROLE, so a theme with a
     * variable-weight UI face can answer 500 where classic answers 700.
     */
    weight: { body: number; medium: number; strong: number; max: number };
    defaultWeight: number;
    letterSpacing: string;
    baseSize: number;
    baseLineHeight: number;
    /** Scale NAMES — frozen at 10/11/12/14/16/18/24 (principle 1). */
    scale: readonly SizeName[];
    /**
     * Scale name -> px. A theme re-pitches the whole scale here without
     * renaming a single --lp-size-* var or touching a fabrial.
     */
    sizePx: Record<SizeName, number>;
    tracking: { section: string; interactive: string };
    prose: { minCh: number; maxCh: number; maxChCap: number; lineHeight: number };
    diffLineHeight: string;
  };
  /** Legacy scalar radius (classic: 0). Components use `radii`. */
  radius: number;
  radii: { sm: string; md: string; lg: string; pill: string };
  /** Legacy scalar shadow (classic: none). Components use `shadows`. */
  shadow: string;
  shadows: { panel: string; overlay: string };
  /** Casing per label class — the single biggest lever on visual noise. */
  transform: { micro: Transform; badge: Transform; button: Transform };
  /**
   * What `filled` MEANS on a badge, as two mix ratios the component feeds to
   * `color-mix` against the tone's own surfaces:
   *
   *   background = mix(tone.fill  `fillAlpha`, tone.soft)
   *   color      = mix(tone.text  `fgTone`,    text.inverse)
   *
   * So `100% / 0%` is the classic slab — bright fill, ink text — and
   * `0% / 100%` is a tinted chip. The ratios ride in --lp-* vars but the
   * color-mix() is declared ON THE BADGE, which is the only place the
   * per-tone locals exist: a custom property substitutes where it is
   * DECLARED, so composing this at :root silently yields nothing.
   *
   * It is expressed as a theme decision rather than a second `filled` variant
   * because a row of ten bright status slabs is the loudest thing a triage
   * screen can do, and `filled` was always going to produce it.
   */
  badge: { fillAlpha: string; fgTone: string };
  accentWidth: { atom: number; structural: number };
  spacing: Record<SpacingKey, number>;
}
