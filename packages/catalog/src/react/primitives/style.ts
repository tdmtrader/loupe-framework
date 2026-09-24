// Shared token -> CSS custom-property maps for catalog impls (catalog-core lane).
// The ONLY color/size source is @loupe/tokens' generated --lp-* variables:
// no raw hex may appear here (lint-enforced) so a theme is a CSS swap.
// Tone triads (design principle 6) are resolved HERE, internally — a fabrial
// names a tone, never a fill/border/text pair.
//
// The same rule now covers CHROME, not just color: weight, casing, radius and
// shadow are read from vars too. A component that writes `borderRadius: 0` or
// `textTransform: 'uppercase'` has made a theme decision on the theme's behalf,
// and no CSS file can take it back — which is exactly why the classic look
// could not be swapped before.
import type { CSSProperties } from 'react';
import type { AccentTone, BadgeTone, BgToken, ButtonVariant, Pad, TextTier } from '../../defs/index.ts';

/**
 * `var(...)` for a property csstype types as a keyword union (fontWeight,
 * textTransform). The cast is the whole point: the VALUE is the theme's, and
 * TypeScript cannot know that a custom property resolves to a legal keyword.
 */
const v = <K extends keyof CSSProperties>(name: string): CSSProperties[K] =>
  `var(${name})` as CSSProperties[K];

type Weight = CSSProperties['fontWeight'];
type Transform = CSSProperties['textTransform'];

/** Semantic weights — components ask for a role, the theme picks the number. */
export const weight: Record<'body' | 'medium' | 'strong' | 'max', Weight> = {
  body: v<'fontWeight'>('--lp-weight-body'),
  medium: v<'fontWeight'>('--lp-weight-medium'),
  strong: v<'fontWeight'>('--lp-weight-strong'),
  max: v<'fontWeight'>('--lp-weight-max'),
};

/** Casing per label class. classic says uppercase to all three. */
export const transform: Record<'micro' | 'badge' | 'button', Transform> = {
  micro: v<'textTransform'>('--lp-transform-micro'),
  badge: v<'textTransform'>('--lp-transform-badge'),
  button: v<'textTransform'>('--lp-transform-button'),
};

export const radius = {
  sm: 'var(--lp-radius-sm)',
  md: 'var(--lp-radius-md)',
  lg: 'var(--lp-radius-lg)',
  pill: 'var(--lp-radius-pill)',
} as const;

export const shadow = {
  panel: 'var(--lp-shadow-panel)',
  overlay: 'var(--lp-shadow-overlay)',
} as const;

/** Base typography every catalog element carries (UI face + theme tracking). */
export const fontBase: CSSProperties = {
  fontFamily: 'var(--lp-font-family)',
  letterSpacing: 'var(--lp-letter-spacing)',
};

/**
 * The code face — diffs, code blocks, digests, anything whose columns must
 * line up. In classic it is the same face as `fontBase`; in a two-face theme
 * it is the only thing that stays monospace.
 */
export const monoBase: CSSProperties = {
  fontFamily: 'var(--lp-font-mono)',
  letterSpacing: 'normal',
};

/** Map a fabrial's numeric weight (400/700/900) onto the theme's roles. */
export function weightFor(n: number | undefined, fallback: Weight = weight.medium): Weight {
  if (n === undefined) return fallback;
  if (n >= 900) return weight.max;
  if (n >= 700) return weight.strong;
  if (n >= 500) return weight.medium;
  return weight.body;
}

const ACCENT_VARS: Record<Exclude<AccentTone, 'none'>, string> = {
  neutral: 'var(--lp-text-secondary)',
  border: 'var(--lp-border-primary)',
  muted: 'var(--lp-border-idle)',
  agent: 'var(--lp-accent-agent)',
  person: 'var(--lp-accent-person)',
  personHover: 'var(--lp-accent-person-hover)',
  wait: 'var(--lp-accent-wait)',
  waitText: 'var(--lp-accent-wait-text)',
  waitBright: 'var(--lp-accent-wait-bright)',
  now: 'var(--lp-accent-now)',
  done: 'var(--lp-accent-done)',
  doneDeep: 'var(--lp-accent-done-deep)',
  bad: 'var(--lp-accent-bad)',
  badDeep: 'var(--lp-accent-bad-deep)',
  badText: 'var(--lp-accent-bad-text)',
};

/** Flat accent tone -> css var ('none'/undefined -> undefined). */
export function accentVar(tone: AccentTone | undefined): string | undefined {
  if (tone === undefined || tone === 'none') return undefined;
  return ACCENT_VARS[tone];
}

const BG_VARS: Record<Exclude<BgToken, 'none'>, string> = {
  page: 'var(--lp-bg-page)',
  panel: 'var(--lp-bg-panel)',
  raised: 'var(--lp-bg-raised)',
  inset: 'var(--lp-bg-inset)',
  selected: 'var(--lp-bg-selected)',
  selectedViolet: 'var(--lp-bg-selected-violet)',
  tintBlue: 'var(--lp-bg-tint-blue)',
  tintAmber: 'var(--lp-bg-tint-amber)',
  tintAmberDim: 'var(--lp-bg-tint-amber-dim)',
  tintRed: 'var(--lp-bg-tint-red)',
};

/** Surface token -> css var ('none'/undefined -> undefined). */
export function bgVar(bg: BgToken | undefined): string | undefined {
  if (bg === undefined || bg === 'none') return undefined;
  return BG_VARS[bg];
}

const TIER_VARS: Record<TextTier, string> = {
  heading: 'var(--lp-text-heading)',
  primary: 'var(--lp-text-primary)',
  body: 'var(--lp-text-body)',
  secondary: 'var(--lp-text-secondary)',
  dim: 'var(--lp-text-dim)',
  muted: 'var(--lp-text-muted)',
};

export function tierVar(tier: TextTier): string {
  return TIER_VARS[tier];
}

export function sizeVar(size: 10 | 11 | 12 | 14 | 16 | 18 | 24): string {
  return `var(--lp-size-${size})`;
}

/** A hue as its four surfaces: fill / border / text / soft ground (principle 6). */
export interface Triad {
  fill: string;
  border: string;
  text: string;
  soft: string;
}

/**
 * Publish a triad as per-element custom properties so THEME CSS can compose
 * with it. `--lp-badge-filled-bg` is written by the theme as
 * `var(--lp-t-fill)` or `var(--lp-t-soft)`; custom-property substitution is
 * lazy, so it resolves against whichever badge is currently painting.
 */
export function triadLocals(t: Triad): CSSProperties {
  return {
    '--lp-t-fill': t.fill,
    '--lp-t-border': t.border,
    '--lp-t-text': t.text,
    '--lp-t-soft': t.soft,
  } as CSSProperties;
}

function toneTriad(name: 'agent' | 'person' | 'wait' | 'wait-bright' | 'now' | 'done' | 'bad'): Triad {
  return {
    fill: `var(--lp-tone-${name}-fill)`,
    border: `var(--lp-tone-${name}-border)`,
    text: `var(--lp-tone-${name}-text)`,
    soft: `var(--lp-tone-${name}-soft)`,
  };
}

const NEUTRAL_TRIAD: Triad = {
  fill: 'var(--lp-text-secondary)',
  border: 'var(--lp-border-idle)',
  text: 'var(--lp-text-secondary)',
  soft: 'var(--lp-bg-selected)',
};
/** The ghost-gray verdict tone (idle-border gray, per the comp). */
const MINOR_TRIAD: Triad = {
  fill: 'var(--lp-border-idle)',
  border: 'var(--lp-border-idle)',
  text: 'var(--lp-text-secondary)',
  soft: 'var(--lp-bg-selected)',
};

const BADGE_TRIADS: Record<BadgeTone, Triad> = {
  neutral: NEUTRAL_TRIAD,
  person: toneTriad('person'),
  agent: toneTriad('agent'),
  wait: toneTriad('wait'),
  waitBright: toneTriad('wait-bright'),
  now: toneTriad('now'),
  done: toneTriad('done'),
  bad: toneTriad('bad'),
  // severity verdicts (design language §1): red fill / amber fill / ghost.
  blocking: toneTriad('bad'),
  notable: toneTriad('wait'),
  minor: MINOR_TRIAD,
  // claim words (provenance): claim color as fill, tone border behind it.
  observed: {
    fill: 'var(--lp-claim-observed)',
    border: 'var(--lp-border-idle)',
    text: 'var(--lp-claim-observed)',
    soft: 'var(--lp-bg-selected)',
  },
  attributable: toneTriad('agent'),
  reproducible: toneTriad('done'),
  witnessed: toneTriad('wait'),
};

/** Resolve a badge tone name to its triad — the fabrial can never mispair. */
export function badgeTriad(tone: BadgeTone): Triad {
  return BADGE_TRIADS[tone];
}

/**
 * Verb-button base shared by Button and VerbBar (design-language §1.9):
 * uppercase 11/700/interactive tracking, 5px 12px, radius 0.
 */
export const buttonBaseStyle: CSSProperties = {
  ...fontBase,
  fontSize: 'var(--lp-size-11)',
  fontWeight: weight.strong,
  textTransform: transform.button,
  letterSpacing: 'var(--lp-tracking-interactive)',
  padding: '5px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
};

const BUTTON_FILLED: Partial<Record<ButtonVariant, string>> = {
  primary: 'var(--lp-accent-person)',
  confirm: 'var(--lp-accent-done)',
  agent: 'var(--lp-accent-agent)',
};

/**
 * Canonical Button variant colors (design-language §1.9) — the ONE source for
 * every verb-button surface: filled (person/done/agent, always ink text,
 * transparent border) > ghost (idle border, secondary text) > danger ghost
 * (red border, red text, never filled — principle 14).
 */
export function buttonVariantStyle(variant: ButtonVariant): CSSProperties {
  const fill = BUTTON_FILLED[variant];
  if (fill !== undefined)
    return { background: fill, color: 'var(--lp-text-inverse)', border: '1px solid transparent' };
  if (variant === 'danger')
    return {
      background: 'transparent',
      color: 'var(--lp-accent-bad-text)',
      border: '1px solid var(--lp-border-red)',
    };
  return {
    background: 'transparent',
    color: 'var(--lp-text-secondary)',
    border: '1px solid var(--lp-border-idle)',
  };
}

/** The micro-label style — the wayfinding system (principle 2); the theme cases it. */
export function microLabelStyle(tracking: 'section' | 'interactive' = 'section', color?: string): CSSProperties {
  return {
    ...fontBase,
    fontSize: 'var(--lp-size-10)',
    fontWeight: weight.strong,
    textTransform: transform.micro,
    letterSpacing: tracking === 'interactive' ? 'var(--lp-tracking-interactive)' : 'var(--lp-tracking-section)',
    color: color ?? 'var(--lp-text-secondary)',
  };
}

/** Pad prop (n | [v,h] | [t,r,b,l]) -> css padding string. */
export function padCss(pad: Pad | undefined): string | undefined {
  if (pad === undefined) return undefined;
  if (typeof pad === 'number') return `${pad}px`;
  return pad.map((n) => `${n}px`).join(' ');
}
