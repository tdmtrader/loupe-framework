// loupe-std@2.0.0 — the frozen catalog (defs only; impls in ../react).
// Scaffold-owned; amendments are integration-owner-only (§8 escalation ladder:
// (a) push derivation into the projection, (b) add an itemSlot scope field,
// (c) last resort: extend the expression grammar).
import type { z } from 'zod';
import { defineCatalog, type UiBinding } from '@loupe/spec';
import { primitiveDefs } from './primitives.ts';
import { layoutDefs } from './layout.ts';
import { interactiveDefs } from './interactive.ts';
import { visualDefs } from './visual.ts';

export {
  zObj,
  BADGE_TONES,
  zBadgeTone,
  ACCENT_TONES,
  zAccentTone,
  TEXT_TIERS,
  zTextTier,
  zSize,
  zWeight,
  BUTTON_VARIANTS,
  zButtonVariant,
  BG_TOKENS,
  zBgToken,
  zPad,
} from './shared.ts';
export type { BadgeTone, AccentTone, TextTier, ButtonVariant, BgToken, Pad } from './shared.ts';
export { primitiveDefs } from './primitives.ts';
export { layoutDefs } from './layout.ts';
export { interactiveDefs } from './interactive.ts';
export { visualDefs } from './visual.ts';

/** Every loupe-std component def, keyed by catalog type name. */
export const componentDefs = {
  ...primitiveDefs,
  ...layoutDefs,
  ...interactiveDefs,
  ...visualDefs,
} as const;

export type LoupeStdComponentName = keyof typeof componentDefs;

/** The pinned catalog object fabrials validate against. */
// 1.0.0 → 1.1.0: additive `scrollIntoView` on the Stack/Row box channel
// (minor per the pin rule r1f6 — same name, same major, loaded minor/patch
// >= pinned, so 1.0.0-pinned fabrials keep loading).
// 1.1.0 → 1.2.0: additive `grow` on the Stack/Row box channel and on
// Grid/ScrollArea — a screen that fills its viewport. Same minor rule: a
// fabrial pinned at 1.0.0 or 1.1.0 keeps loading against 1.2.0.
// 1.2.0 → 1.3.0: additive `ProseDoc` — a reading surface for a parsed
// document. Its measure is its own (72–96ch); `Prose` stays at 62–76ch, which
// four screens depend on. Additive, so the same minor rule holds.
// 1.3.0 → 1.4.0: additive `Link` — an in-app `<a href>` to another fabrial,
// the first element that can point at one — and additive `outline`/`anchor`
// on `ProseDoc`, the served heading map and the heading it scrolls to. Both
// additive, so the same minor rule holds and a fabrial pinned at 1.3.0 (or
// 1.0.0) keeps loading. The one thing a 1.3.0 pin may NOT do is USE a 1.4.0
// component: the element check runs against the loaded catalog and would pass
// while the pin lied, so every fabrial that gains a `Link` re-pins 1.4.0.
// 1.4.0 → 1.5.0: additive direct $route on Link.href beside literal and
// served hrefs. Existing pins keep loading under the same minor rule.
// 1.5.0 → 2.0.0: breaking Link.href restriction to a direct $route only;
// literal and served hrefs no longer validate. Every fabrial must re-pin.
export const loupeStd = defineCatalog({
  name: 'loupe-std',
  version: '2.0.0',
  components: componentDefs,
});

/** Inferred (fabrial-side) props for a component. */
export type PropsOf<K extends LoupeStdComponentName> = z.infer<(typeof componentDefs)[K]['props']>;
/** Inferred scope object for a component's itemSlot. */
export type ItemSlotScopeOf<
  K extends LoupeStdComponentName,
  S extends keyof NonNullable<(typeof componentDefs)[K] extends { itemSlots: infer I } ? I : never>,
> = (typeof componentDefs)[K] extends { itemSlots: infer I }
  ? S extends keyof I
    ? I[S] extends { scope: infer Z extends z.ZodType }
      ? z.infer<Z>
      : never
    : never
  : never;

// ---- frozen prop types (fabrial-side; expressions already substituted) ----
export type TextProps = PropsOf<'Text'>;
export type MicroLabelProps = PropsOf<'MicroLabel'>;
export type ProseProps = PropsOf<'Prose'>;
export type BadgeProps = PropsOf<'Badge'>;
export type ButtonProps = PropsOf<'Button'>;
export type ChipProps = PropsOf<'Chip'>;
export type NumeralProps = PropsOf<'Numeral'>;
export type PipProps = PropsOf<'Pip'>;
export type DividerProps = PropsOf<'Divider'>;
export type MetaRowProps = PropsOf<'MetaRow'>;
export type DigestProps = PropsOf<'Digest'>;
/** Impl-side Link props: the renderer resolves the authoring route to a string. */
export type LinkProps = Omit<PropsOf<'Link'>, 'href'> & { href: string };
export type TextareaProps = PropsOf<'Textarea'>;
export type StackProps = PropsOf<'Stack'>;
export type RowProps = PropsOf<'Row'>;
export type GridProps = PropsOf<'Grid'>;
export type PanelProps = PropsOf<'Panel'>;
export type BandProps = PropsOf<'Band'>;
export type InsetHeaderProps = PropsOf<'InsetHeader'>;
export type SidePanelProps = PropsOf<'SidePanel'>;
export type StickyFooterProps = PropsOf<'StickyFooter'>;
export type SpacerProps = PropsOf<'Spacer'>;
export type ScrollAreaProps = PropsOf<'ScrollArea'>;
export type BoardProps = PropsOf<'Board'>;
export type VerbBarProps = PropsOf<'VerbBar'>;
export type HotkeysProps = PropsOf<'Hotkeys'>;
export type RouteGraphProps = PropsOf<'RouteGraph'>;
export type DiffBlockProps = PropsOf<'DiffBlock'>;
export type ProseDocProps = PropsOf<'ProseDoc'>;
export type OverlaySheetProps = PropsOf<'OverlaySheet'>;

/**
 * Impl-side Textarea props: the renderer resolves the bindUi pointer to a
 * live UiBinding before calling the impl.
 */
export type TextareaImplProps = Omit<TextareaProps, 'bindUi'> & { bindUi: UiBinding };
