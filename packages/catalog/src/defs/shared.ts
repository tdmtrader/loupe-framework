// Shared closed enums for loupe-std defs. Fabrials name tokens from these
// enums — never hex; components resolve tone triads internally (principle 6).
import { z } from 'zod';
import { zJson } from '@loupe/spec';

/** A JSON object (app-shaped data flowing into composites/itemSlots). */
export const zObj = z.record(z.string(), zJson);

/**
 * Badge tones: the catalog's closed set of SEMANTIC tones — state hues, the
 * severity *verdicts* the design language names, and the claim words.
 *
 * The rule (r3f2): the catalog carries no app's vocabulary. A tone here says
 * what a badge *means* to the eye, never what one app calls it. An app that
 * grades things `critical/high/medium/low` (or `p0/p1`, or `sev1/sev2`) maps
 * its own words to these tones in its projection — that mapping is domain
 * knowledge and belongs to the app, not to a shared component library.
 */
export const BADGE_TONES = [
  'neutral',
  'person',
  'agent',
  'wait',
  'waitBright',
  'now',
  'done',
  'bad',
  'blocking',
  'notable',
  'minor',
  'observed',
  'attributable',
  'reproducible',
  'witnessed',
] as const;
export const zBadgeTone = z.enum(BADGE_TONES);
export type BadgeTone = z.infer<typeof zBadgeTone>;

/** Flat accent/state tones (left accent bars, pips, note tones, text tones). */
export const ACCENT_TONES = [
  'none',
  'neutral',
  'border',
  'muted',
  'agent',
  'person',
  'personHover',
  'wait',
  'waitText',
  'waitBright',
  'now',
  'done',
  'doneDeep',
  'bad',
  'badDeep',
  'badText',
] as const;
export const zAccentTone = z.enum(ACCENT_TONES);
export type AccentTone = z.infer<typeof zAccentTone>;

export const TEXT_TIERS = ['heading', 'primary', 'body', 'secondary', 'dim', 'muted'] as const;
export const zTextTier = z.enum(TEXT_TIERS);
export type TextTier = z.infer<typeof zTextTier>;

/** The closed type scale (px). */
export const zSize = z.union([
  z.literal(10),
  z.literal(11),
  z.literal(12),
  z.literal(14),
  z.literal(16),
  z.literal(18),
  z.literal(24),
]);
export const zWeight = z.union([z.literal(400), z.literal(700), z.literal(900)]);

export const BUTTON_VARIANTS = ['primary', 'confirm', 'agent', 'ghost', 'danger'] as const;
export const zButtonVariant = z.enum(BUTTON_VARIANTS);
export type ButtonVariant = z.infer<typeof zButtonVariant>;

/** Background surface tokens. */
export const BG_TOKENS = [
  'none',
  'page',
  'panel',
  'raised',
  'inset',
  'selected',
  'selectedViolet',
  'tintBlue',
  'tintAmber',
  'tintAmberDim',
  'tintRed',
] as const;
export const zBgToken = z.enum(BG_TOKENS);
export type BgToken = z.infer<typeof zBgToken>;

/** Padding: n | [v, h] | [t, r, b, l] (px). */
export const zPad = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);
export type Pad = z.infer<typeof zPad>;
