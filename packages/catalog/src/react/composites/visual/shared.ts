// Shared helpers for the visual composites (catalog-visual lane).
// Token access is exclusively via --lp-* custom properties (no raw hex).
import type { Json, JsonObject } from '@loupe/spec';

/** camelCase token name → --lp- kebab custom property reference. */
export const lp = (name: string): string =>
  `var(--lp-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;

export const num = (v: Json | undefined, fallback: number): number =>
  typeof v === 'number' ? v : fallback;

export const str = (v: Json | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

export const obj = (v: Json | undefined): JsonObject | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined;

/** Read an {x, y} position off a data object (node.pos / annotation x,y). */
export const posOf = (o: JsonObject): { x: number; y: number } => {
  const p = obj(o['pos']);
  if (p) return { x: num(p['x'], 0), y: num(p['y'], 0) };
  return { x: num(o['x'], 0), y: num(o['y'], 0) };
};
