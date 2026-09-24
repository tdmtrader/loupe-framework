// The validation contract: frozen Issue codes (one per validation class) and
// the shared types the engine implementations (engine/) build on.
import type { Json } from '@loupe/protocol';
import type { Fabrial } from './envelope.ts';

export const ISSUE_CODES = [
  /** Envelope/element/expression shape failed the model schemas. */
  'bad-envelope',
  /** Catalog pin (r1f6): name differs, major differs, or pinned minor.patch > loaded. */
  'catalog-pin-mismatch',
  /** Element type not in the pinned catalog. */
  'unknown-type',
  /** Props fail the component's Zod schema after expression-shape substitution. */
  'bad-props',
  /** children/slots reference a missing element id. */
  'dangling-ref',
  /** Element unreachable from root. */
  'orphan',
  /** children/slots graph contains a cycle. */
  'cycle',
  /** `on` event not in the def's events, nor collected via eventsFrom. */
  'undeclared-event',
  /** The eventsFrom prop is not a literal JSON array (expressions rejected there). */
  'eventsFrom-nonliteral',
  /** Slot name not declared by the catalog entry. */
  'undeclared-slot',
  /** repeat.key missing. */
  'missing-repeat-key',
  /** $ui bind or ui-action path not declared in the envelope's `ui`. */
  'undeclared-ui-path',
  /** Verb not present in the app's verb manifest. */
  'unknown-verb',
  /** Verb params structurally incompatible with the verb's JSON Schema (where decidable). */
  'bad-verb-params',
  /** app.projection not among the app's declared projections (checked when the caller provides them). */
  'unknown-projection',
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  message: string;
  /** JSON-ish path into the fabrial ("elements.finding-row.props.accent"). */
  path?: string;
  elementId?: string;
}

export type ValidateResult = { ok: true; fabrial: Fabrial } | { ok: false; issues: Issue[] };

/** The scope a pure expression resolution runs against. */
export interface ResolveScope {
  state: Json;
  ui: Json;
  /** The repeat/itemSlot scope item, when inside one. */
  item?: Json;
  /** The repeat position, when inside one. */
  index?: number;
}
