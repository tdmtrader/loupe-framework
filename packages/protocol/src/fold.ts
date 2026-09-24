/**
 * Fold semantics (r1f8), specified exactly once for every loupe adapter:
 * latest-wins by `at`, ties broken by lexicographic `actor` — sort records
 * ascending by the (at, actor) tuple (plain code-unit comparison, no locale);
 * the last record per id wins. Order-independent over its input given the
 * tiebreak. vectors/fold.json is the shared conformance vector; both adapters'
 * fold tests must pass it.
 *
 * Mechanism, not vocabulary: the fold knows nothing about what a record
 * *means*. All it requires is `zRecordFloor` (schemas.ts) — a timestamp and
 * an actor — plus an app-named identity field. Apps define the record shapes
 * that sit on top.
 */

/**
 * Which fields of a record the fold reads. `at`/`actor` are the floor's
 * canonical names (`zRecordFloor`); FoldKeys exists so an app that spells
 * them differently can still fold, which is why the `records` generic is not
 * constrained to `RecordFloor` itself.
 */
export interface FoldKeys {
  /** Record field naming the fold identity — app-chosen (e.g. "finding_id"). */
  id: string;
  /** Record field carrying the floor's `at` (ISO-8601 UTC sorts lexicographically). */
  at: string;
  /** Record field carrying the floor's `actor` (the tiebreak). */
  actor: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function foldLatest<T extends Record<string, unknown>>(
  records: readonly T[],
  keys: FoldKeys,
): Record<string, T> {
  const sorted = [...records].sort((a, b) => {
    const byAt = cmp(String(a[keys.at] ?? ''), String(b[keys.at] ?? ''));
    if (byAt !== 0) return byAt;
    return cmp(String(a[keys.actor] ?? ''), String(b[keys.actor] ?? ''));
  });
  const out: Record<string, T> = {};
  for (const record of sorted) {
    const id = record[keys.id];
    if (typeof id === 'string') out[id] = record;
  }
  return out;
}
