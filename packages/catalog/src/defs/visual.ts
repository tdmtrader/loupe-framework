// §4 visual composites — frozen defs. Impls land in
// src/react/composites/visual (catalog-visual lane).
import { z } from 'zod';
import type { ComponentDef } from '@loupe/spec';
import { zObj } from './shared.ts';

export const visualDefs = {
  RouteGraph: {
    description:
      'Absolutely-positioned node layer over one SVG bezier-edge layer. Node positions come from the projection (node.pos {x,y}); no auto-layout in v1. Contributes position, 3px kind-colored left border, dashed border for conditional, selection outline from selectedId; emits nodeSelect on click.',
    props: z.strictObject({
      nodes: z.array(zObj),
      edges: z.array(zObj),
      terminals: z.array(zObj).optional(),
      size: z.strictObject({ width: z.number(), height: z.number() }),
      /** Fed from the ui doc — node selection is view ephemera. */
      selectedId: z.string().nullable().optional(),
      annotations: z.array(zObj).optional(),
    }),
    events: ['nodeSelect'],
    itemSlots: {
      node: {
        description: 'Card content per node (and per terminal, with terminal: true).',
        scope: z.strictObject({ node: zObj, terminal: z.boolean(), selected: z.boolean() }),
      },
    },
  },
  DiffBlock: {
    description:
      '56px/22px/1fr diff grid at 21px line-height, colored from the diff token septet by sign. Interleaves matching notes[] (note itemSlot) and the compose itemSlot at composeAt after their anchor lines; exact-match anchoring only. Emits linePress {file, line, side}.',
    props: z.strictObject({
      /** File path, echoed into linePress payloads. */
      file: z.string().optional(),
      lines: z.array(
        z.strictObject({
          no: z.number().int(),
          sign: z.enum(['+', '-', ' ']),
          text: z.string(),
          side: z.enum(['+', '-']).optional(),
        }),
      ),
      notes: z.array(z.looseObject({ line: z.number().int(), side: z.string() })).optional(),
      composeAt: z
        .strictObject({ line: z.number().int(), side: z.string() })
        .nullable()
        .optional(),
      maxLines: z.number().int().positive().optional(),
    }),
    events: ['linePress'],
    itemSlots: {
      note: {
        description: 'An inline note card hung beneath its anchor line.',
        scope: z.strictObject({ note: zObj }),
      },
      compose: {
        description: 'The inline compose form at composeAt (visibility driven by the fabrial’s ui doc).',
        scope: z.strictObject({ line: z.number().int(), side: z.string() }),
      },
    },
  },
  ProseDoc: {
    description:
      'A reading surface for a parsed document: takes the projection\'s block array and styles it from the token ramp (the DiffBlock precedent — structure in, tokens applied internally). Its measure is its own: `Prose` stays capped at 62–76ch for a finding body, this reads a 300-line review. Inline code is distinguished by GROUND, never by font — the typeface is one face by design.',
    props: z.strictObject({
      blocks: z.array(zObj),
      /** Reading measure. Wider than Prose on purpose; Prose is untouched. */
      maxCh: z.number().int().min(72).max(96).optional(),
      /**
       * The served heading map — `{id, label, tier}` per heading, ids matching
       * the `id` the projection put on each heading block. THE COMPONENT
       * RENDERS NO OUTLINE: the fabrial repeats this list, because a list of
       * pressable rows is a thing the grammar already does and a component
       * that grew its own would be deciding layout the screen owns.
       */
      outline: z.array(zObj).optional(),
      /** The heading id to scroll to; scrolls on a rising edge, never on mount. */
      anchor: z.string().nullable().optional(),
    }),
  },
  OverlaySheet: {
    description:
      'Scrim + portal-mounted fixed right sheet (560px, radius 0, no shadow). Scrim click and Escape emit dismiss; body scrolls; children render inside.',
    props: z.strictObject({
      open: z.boolean(),
      width: z.number().optional(),
      side: z.literal('right').optional(),
    }),
    events: ['dismiss'],
  },
} as const satisfies Record<string, ComponentDef>;
