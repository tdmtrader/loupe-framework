// §4 interactive composites — frozen defs. Impls land in
// src/react/composites/interactive (catalog-interactive lane).
import { z } from 'zod';
import { zJson, type ComponentDef } from '@loupe/spec';
import { zButtonVariant, zObj } from './shared.ts';

export const interactiveDefs = {
  Board: {
    description:
      'Owns the HTML5 drag lifecycle and nothing else: renders the 5-column grid from `columns` + one lane row per lanes[] item; drag state is transient component state; drop emits exactly ONE semantic event and the board performs no reordering (authoritative order returns via projection).',
    props: z.strictObject({
      lanes: z.array(zObj),
      /** Column header config from the projection (labels/counts, precomposed). */
      columns: zJson,
      /**
       * Opens the lane containing this card id inline (laneOpen itemSlot),
       * so a fabrial can bind a ui key set from a card press. `lane.open`
       * in the projection still forces a lane open independently.
       */
      openCardId: z.string().nullable().optional(),
      laneOrderVerb: z.string().optional(),
      cardMoveVerb: z.string().optional(),
    }),
    events: ['cardMove', 'laneMove'],
    itemSlots: {
      laneHeader: {
        description:
          'Once per lane; dropHint is the violet hint line while a card drags over this lane (else null).',
        scope: z.strictObject({ lane: zObj, dropHint: z.string().nullable() }),
      },
      card: {
        description: 'Once per card; dragging is true for the drag source.',
        scope: z.strictObject({ card: zObj, dragging: z.boolean() }),
      },
      laneOpen: {
        description: 'The opened lane’s inline detail (ticket detail).',
        scope: z.strictObject({ lane: zObj }),
      },
    },
  },
  VerbBar: {
    description:
      'Co-located verb row: buttons print their keyHints; each button emits its literal `event` name. The actions prop is a literal array (eventsFrom), so the shortcut map and the printed hints share one source — the fabrial.',
    props: z.strictObject({
      label: z.string().optional(),
      actions: z.array(
        z.strictObject({
          label: z.string(),
          keyHint: z.string().optional(),
          variant: zButtonVariant,
          event: z.string(),
        }),
      ),
    }),
    eventsFrom: { prop: 'actions', field: 'event' },
  },
  Hotkeys: {
    description:
      'Renders nothing; emits each keys[] entry’s key as an event on keydown (modifier syntax like "shift+b"). `when` is authored as a Condition in the fabrial and arrives pre-resolved as a boolean each render. Suspended while a textarea/input has focus. keys is a literal array (eventsFrom).',
    props: z.strictObject({
      keys: z.array(
        z.strictObject({
          key: z.string(),
          when: z.boolean().optional(),
        }),
      ),
    }),
    eventsFrom: { prop: 'keys', field: 'key' },
  },
} as const satisfies Record<string, ComponentDef>;
