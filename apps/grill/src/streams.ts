// The ownership boundary (r1f2) for the grill app: OWNED_STREAMS gates the
// module's ONLY append function. Both streams are loupe-originated — a
// question an agent asked through `question.ask`, and the answer a human
// gave through `question.answer` — so both earn their place by the rule
// every owned stream must pass: originated here, not merely useful here.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Json, JsonObject } from '@loupe/protocol';

export const OWNED_STREAMS = ['questions.jsonl', 'answers.jsonl'] as const;
export type OwnedStream = (typeof OWNED_STREAMS)[number];

/**
 * Append one record to a loupe-owned jsonl stream. The single write path of
 * the whole app: anything not in OWNED_STREAMS throws before any handle is
 * constructed.
 */
export function appendOwned(grillDir: string, stream: string, record: JsonObject): void {
  if (!(OWNED_STREAMS as readonly string[]).includes(stream)) {
    throw new Error(`refusing to append to non-owned stream ${stream} (owned: ${OWNED_STREAMS.join(', ')})`);
  }
  appendFileSync(join(grillDir, stream), `${JSON.stringify(record)}\n`, 'utf8');
}

/** Read a jsonl file read-only; a missing file is an empty stream. */
export function readJsonl(grillDir: string, file: string): JsonObject[] {
  const path = join(grillDir, file);
  if (!existsSync(path)) return [];
  const out: JsonObject[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Json;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) out.push(parsed);
    } catch {
      // A torn or malformed line is skipped, not fatal — appends are
      // line-atomic at these sizes and the fold is order-independent.
    }
  }
  return out;
}
