// §3.1 — the fabrial envelope. One persisted JSON file per screen.
import { z } from 'zod';
import { zJson } from '@loupe/protocol';
import { zElement, zElementId } from './element.ts';

/** The dialect version this model implements. Loaders reject unknown majors. */
export const LOUPE_DIALECT_VERSION = 1;

export const zSemver = z.string().regex(/^\d+\.\d+\.\d+$/, 'catalog versions are semver x.y.z');

/**
 * The catalog pin (r1f6): load fails unless the loaded catalog has the same
 * name, same major, and minor/patch >= pinned. Failure is total and legible —
 * an error panel listing issues, never a partial render.
 */
export const zCatalogPin = z.strictObject({
  name: z.string(),
  version: zSemver,
});
export type CatalogPin = z.infer<typeof zCatalogPin>;

/** The verb-manifest namespace this fabrial was validated against + its default projection. */
export const zAppBinding = z.strictObject({
  name: z.string(),
  projection: z.string(),
});
export type AppBinding = z.infer<typeof zAppBinding>;

export const zFabrial = z.strictObject({
  /** Dialect version (integer). */
  loupe: z.number().int().positive(),
  /** e.g. "grill/board" */
  fabrial: z.string(),
  version: z.number().int().positive(),
  title: z.string().optional(),
  catalog: zCatalogPin,
  app: zAppBinding,
  /**
   * The initial value of the client-local ui doc — lossable view ephemera
   * only, reset on reload BY DESIGN. Declares every ui path the fabrial uses;
   * binds or ui-sets to undeclared paths are validation errors.
   */
  ui: z.record(z.string(), zJson).optional(),
  root: zElementId,
  /** Flat ID-keyed map, single root; no dangling refs, orphans, or cycles. */
  elements: z.record(zElementId, zElement),
});
export type Fabrial = z.infer<typeof zFabrial>;
