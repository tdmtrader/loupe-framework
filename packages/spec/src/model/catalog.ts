// defineCatalog + ComponentDef — the catalog contract the validator and
// renderer share. Defs are data (Zod schemas + declarations); impls live in
// @loupe/catalog/react and are typed by impl.ts.
import type { z } from 'zod';

export interface ItemSlotDef {
  /**
   * The declared scope shape (a Zod schema): the object the component supplies
   * per item, which the fabrial's slot subtree binds into with ordinary
   * relative pointers (e.g. Board.laneHeader scope = { lane, dropHint }).
   */
  scope: z.ZodType;
  description?: string;
}

export interface ComponentDef {
  /**
   * Zod schema for the component's props. Checked at validate time only:
   * fully-literal prop values are parsed against this schema, while values
   * containing expression placeholders are skipped (their shapes are checked
   * by the closed grammar instead). Resolved expression output is passed to
   * the impl WITHOUT a runtime re-validation — a post-resolve re-check is
   * explicitly deferred.
   */
  props: z.ZodType;
  /** Statically declared event names usable in `on`. */
  events?: readonly string[];
  /**
   * Dynamic-but-validatable events: the named prop must be a LITERAL JSON
   * array in the fabrial (expressions rejected — issue eventsFrom-nonliteral)
   * and `on` keys are checked against the collected `field` values. This is
   * how Hotkeys ({prop:"keys", field:"key"}) and VerbBar ({prop:"actions",
   * field:"event"}) stay fully statically validated.
   */
  eventsFrom?: { prop: string; field: string };
  /** Declared slot names (element-id lists in the fabrial). */
  slots?: readonly string[];
  /** Slots rendered once per component-supplied data item, with declared scope schemas. */
  itemSlots?: Readonly<Record<string, ItemSlotDef>>;
  description?: string;
}

export interface Catalog {
  name: string;
  /** Semver; fabrials pin {name, version} (r1f6). */
  version: string;
  components: Readonly<Record<string, ComponentDef>>;
}

/** Structural checks + freeze. The catalog object is data; impls arrive separately. */
export function defineCatalog<const C extends Catalog>(catalog: C): C {
  if (!/^\d+\.\d+\.\d+$/.test(catalog.version)) {
    throw new Error(`catalog version must be semver x.y.z, got "${catalog.version}"`);
  }
  for (const [name, def] of Object.entries(catalog.components)) {
    if (def.eventsFrom && def.events?.includes(def.eventsFrom.field)) {
      throw new Error(`catalog component ${name}: eventsFrom.field collides with a static event name`);
    }
  }
  Object.freeze(catalog.components);
  return Object.freeze(catalog);
}
