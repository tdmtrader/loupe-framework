// §4 primitives — frozen defs (Zod props, events). Impls land in
// src/react/primitives (catalog-core lane).
import { z } from 'zod';
import { uiPointer, zRouteExpr, type ComponentDef } from '@loupe/spec';
import { zAccentTone, zBadgeTone, zButtonVariant, zSize, zTextTier, zWeight } from './shared.ts';

export const primitiveDefs = {
  Text: {
    description: 'General text at a tier of the seven-tier gray ramp.',
    props: z.strictObject({
      text: z.union([z.string(), z.number()]),
      tier: zTextTier.optional(),
      size: zSize.optional(),
      weight: zWeight.optional(),
      tone: zAccentTone.optional(),
      upper: z.boolean().optional(),
      strike: z.boolean().optional(),
    }),
  },
  MicroLabel: {
    description: '10px/700 uppercase micro-label — the wayfinding system (tracking .12em section, .09em interactive).',
    props: z.strictObject({
      text: z.string(),
      tracking: z.enum(['section', 'interactive']).optional(),
      tone: zAccentTone.optional(),
    }),
  },
  Prose: {
    description: '12/400, lh 1.6–1.7, ch-capped measure (default 68ch).',
    props: z.strictObject({
      text: z.string(),
      maxCh: z.number().int().min(62).max(76).optional(),
      tier: zTextTier.optional(),
      strike: z.boolean().optional(),
    }),
  },
  Badge: {
    description:
      'Tri-tone badge; filled ⇒ ink text, outline ⇒ deep border + pale text. Triads resolved internally — a fabrial names a tone, never a pair.',
    props: z.strictObject({
      label: z.union([z.string(), z.number()]),
      tone: zBadgeTone,
      filled: z.boolean().optional(),
    }),
  },
  Button: {
    description: 'Verb button. danger is ghost-red, never filled (principle 14). keyHint prints dim inside the label (principle 9).',
    props: z.strictObject({
      label: z.string(),
      variant: zButtonVariant,
      keyHint: z.string().optional(),
      disabled: z.boolean().optional(),
      flex: z.boolean().optional(),
    }),
    events: ['press'],
  },
  Chip: {
    description: 'Inverted-when-active toggle chip (tabs, scope chips, sev pickers).',
    props: z.strictObject({
      label: z.string(),
      active: z.boolean(),
      tone: z.enum(['neutral', 'blocking', 'notable', 'minor']).optional(),
    }),
    events: ['press'],
  },
  Numeral: {
    description: '24/900 stat numeral + 11/400 phrase — “every number is a sentence”.',
    props: z.strictObject({
      value: z.union([z.string(), z.number()]),
      label: z.string().optional(),
      color: zAccentTone.optional(),
    }),
  },
  Pip: {
    description: '10×10 or 12×12 square progress/agent pip.',
    props: z.strictObject({
      state: zAccentTone,
      size: z.union([z.literal(10), z.literal(12)]).optional(),
      hollow: z.boolean().optional(),
    }),
  },
  Divider: {
    description: 'Vertical 1px hairline divider.',
    props: z.strictObject({}),
  },
  MetaRow: {
    description: 'Parts joined by “·” separators in muted.',
    props: z.strictObject({
      parts: z.array(z.union([z.string(), z.number()])),
    }),
  },
  Digest: {
    description: 'Person-blue sha/digest text; pairWith renders the “a → b” pair form.',
    props: z.strictObject({
      value: z.string(),
      pairWith: z.string().optional(),
    }),
  },
  Link: {
    description:
      'An in-app anchor to another fabrial. Renders a real <a href> the browser follows — no event, no verb, no action kind: the grammar still has no navigation action. `href` is a direct $route naming a fabrial of the same app; the renderer resolves it against the mounting instance, and the impl re-checks the resolved string at runtime.',
    props: z.strictObject({
      href: zRouteExpr,
      label: z.string(),
      tone: zAccentTone.optional(),
    }),
  },
  Textarea: {
    description:
      'Draft input bound to a ui-doc path (bindUi resolves to UiBinding {value,set}). Committing content is always a verb; the draft is lossable ephemera by design.',
    props: z.strictObject({
      bindUi: uiPointer(),
      placeholder: z.string().optional(),
      borderTone: z.enum(['agent', 'neutral']).optional(),
      minHeight: z.number().optional(),
    }),
  },
} as const satisfies Record<string, ComponentDef>;
