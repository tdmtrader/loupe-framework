// §4 layout — frozen defs. Impls land in src/react/layout (catalog-core lane).
import { z } from 'zod';
import type { ComponentDef } from '@loupe/spec';
import { zAccentTone, zBgToken, zPad } from './shared.ts';

/** The shared box channel: gap/pad/bg/borders + the left-accent-bar state channel (principle 4). */
const boxProps = {
  gap: z.number().optional(),
  align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).optional(),
  pad: zPad.optional(),
  bg: zBgToken.optional(),
  borders: z.enum(['top', 'bottom', 'both']).optional(),
  accent: zAccentTone.optional(),
  accentWidth: z.union([z.literal(2), z.literal(3)]).optional(),
  accentEdge: z.enum(['left', 'top']).optional(),
  opacity: z.number().min(0).max(1).optional(),
  /**
   * Rising-edge scroll follow: when this flips false→true the element scrolls
   * itself into view (block 'nearest'). Bind the cursor condition here so ↑/↓
   * keeps the cursor row visible in a scrolling rail. Added in 1.1.0.
   */
  scrollIntoView: z.boolean().optional(),
  /**
   * Claim the remaining main-axis space of a flex parent (flex: 1 1 0%) and
   * allow shrinking below content (min-height/min-width 0), so a rail inside
   * scrolls instead of pushing the page taller. Added in 1.2.0.
   */
  grow: z.boolean().optional(),
};

export const layoutDefs = {
  Stack: {
    description: 'Flex container (default column); pressable like Row (comp finding rows/cards are clickable column stacks).',
    props: z.strictObject({
      direction: z.enum(['column', 'row']).optional(),
      ...boxProps,
    }),
    events: ['press'],
  },
  Row: {
    description: 'Horizontal flex row; pressable (cursor rows, cards).',
    props: z.strictObject(boxProps),
    events: ['press'],
  },
  Grid: {
    description: 'CSS-grid with a raw template string (comp templates flow through); optional 1px cell borders.',
    props: z.strictObject({
      template: z.string(),
      gap: z.number().optional(),
      cellBorders: z.boolean().optional(),
      bg: zBgToken.optional(),
      grow: z.boolean().optional(),
    }),
  },
  Panel: {
    description: 'Titled panel on panel/inset bg; title renders as a MicroLabel; footnote is teaching prose (principle 12).',
    props: z.strictObject({
      title: z.string().optional(),
      note: z.string().optional(),
      bg: z.enum(['panel', 'inset']),
      footnote: z.string().optional(),
    }),
  },
  Band: {
    description: 'Raised full-width strip (bg.raised) with a bottom hairline.',
    props: z.strictObject({
      pad: zPad.optional(),
    }),
  },
  InsetHeader: {
    description: 'Full-bleed micro-label row on bg.inset (“in commit…”, “settled”).',
    props: z.strictObject({
      label: z.string(),
      right: z.string().optional(),
    }),
  },
  SidePanel: {
    description: 'Left/right rail on bg.panel with a scrollable body and a footer slot.',
    props: z.strictObject({}),
    slots: ['footer'],
  },
  StickyFooter: {
    description: 'Raised sticky footer: status note + an actions slot.',
    props: z.strictObject({
      note: z.string().optional(),
      noteTone: zAccentTone.optional(),
    }),
    slots: ['actions'],
  },
  Spacer: {
    description: 'Flex spacer.',
    props: z.strictObject({}),
  },
  ScrollArea: {
    description: 'Single-axis scroll container.',
    props: z.strictObject({
      axis: z.enum(['x', 'y']),
      grow: z.boolean().optional(),
    }),
  },
} as const satisfies Record<string, ComponentDef>;
