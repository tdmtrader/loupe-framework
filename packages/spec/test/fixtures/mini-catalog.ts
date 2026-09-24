// The mini-catalog + verb manifest the spec tests validate against (the lane
// must not import @loupe/catalog — this is the test double).
import { z } from 'zod';
import type { VerbDecl } from '@loupe/protocol';
import { defineCatalog, hashHref, uiPointer, zJson } from '../../src/index.ts';

const zObj = z.record(z.string(), zJson);

export const miniCatalog = defineCatalog({
  name: 'mini',
  version: '1.2.3',
  components: {
    Stack: {
      props: z.strictObject({ gap: z.number().optional() }),
    },
    Text: {
      props: z.strictObject({
        text: z.union([z.string(), z.number()]),
        tier: z.enum(['primary', 'dim']).optional(),
      }),
    },
    Row: {
      props: z.strictObject({ accent: z.enum(['agent', 'border', 'none']).optional() }),
      events: ['press'],
    },
    Button: {
      props: z.strictObject({
        label: z.string(),
        variant: z.enum(['primary', 'ghost']),
      }),
      events: ['press'],
    },
    Hotkeys: {
      props: z.strictObject({
        keys: z.array(z.strictObject({ key: z.string(), when: z.boolean().optional() })),
      }),
      eventsFrom: { prop: 'keys', field: 'key' },
    },
    List: {
      props: z.strictObject({ items: z.array(zObj).optional() }),
      slots: ['footer'],
      itemSlots: {
        row: { scope: z.strictObject({ thing: zObj, hint: z.string().nullable() }) },
      },
    },
    Note: {
      props: z.strictObject({ bindUi: uiPointer(), placeholder: z.string().optional() }),
    },
    // The hashHref() prop type under test. Named `Link` because that is what
    // loupe-std calls it, but this lane never imports @loupe/catalog.
    Link: {
      props: z.strictObject({ href: hashHref(), label: z.string() }),
    },
  },
});

export const miniManifest: VerbDecl[] = [
  {
    name: 'keepIt',
    params: {
      type: 'object',
      properties: { findingId: { type: 'string' } },
      required: ['findingId'],
      additionalProperties: false,
    },
    optimistic: [{ op: 'replace', path: '/triage/lastKept', value: '${params.findingId}' }],
  },
  {
    name: 'undo',
    params: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'release',
    params: {
      type: 'object',
      properties: { ticketId: { type: 'string' }, note: { type: ['string', 'null'] } },
      required: ['ticketId'],
      additionalProperties: false,
    },
  },
];
