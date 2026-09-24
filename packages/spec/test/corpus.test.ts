// The invalid-fabrial corpus: at least one fixture per frozen Issue code,
// table-driven — each fixture must yield exactly its expected code(s).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISSUE_CODES, validateFabrial, type IssueCode } from '../src/index.ts';
import { miniCatalog, miniManifest } from './fixtures/mini-catalog.ts';

const corpusDir = join(import.meta.dirname, 'corpus');

/** fixture file → the exact set of issue codes it must yield (duplicates collapse). */
const EXPECTED: Record<string, IssueCode[]> = {
  'bad-envelope.fabrial.json': ['bad-envelope'],
  'bad-envelope-dialect.fabrial.json': ['bad-envelope'],
  'catalog-pin-mismatch.fabrial.json': ['catalog-pin-mismatch'],
  'unknown-type.fabrial.json': ['unknown-type'],
  'bad-props.fabrial.json': ['bad-props'],
  'bad-props-missing-required.fabrial.json': ['bad-props'],
  'dangling-ref.fabrial.json': ['dangling-ref'],
  'orphan.fabrial.json': ['orphan'],
  'cycle.fabrial.json': ['cycle'],
  'undeclared-event.fabrial.json': ['undeclared-event'],
  'eventsfrom-nonliteral.fabrial.json': ['eventsFrom-nonliteral'],
  'undeclared-slot.fabrial.json': ['undeclared-slot'],
  'missing-repeat-key.fabrial.json': ['missing-repeat-key'],
  'undeclared-ui-path.fabrial.json': ['undeclared-ui-path'],
  'undeclared-ui-path-action.fabrial.json': ['undeclared-ui-path'],
  'advance-undeclared-cursor.fabrial.json': ['undeclared-ui-path'],
  'context-undeclared-at.fabrial.json': ['undeclared-ui-path'],
  'unknown-verb.fabrial.json': ['unknown-verb'],
  'bad-verb-params.fabrial.json': ['bad-verb-params'],
  'bad-verb-params-type.fabrial.json': ['bad-verb-params'],
  'unknown-projection.fabrial.json': ['unknown-projection'],
};

/** The app's declared projections, as the renderer would pass them. */
const miniProjections = ['review'];

const load = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(join(corpusDir, dir, file), 'utf8'));

describe('invalid corpus', () => {
  const files = readdirSync(join(corpusDir, 'invalid')).filter((f) => f.endsWith('.fabrial.json'));

  it('every fixture on disk has an expectation and vice versa', () => {
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('every frozen Issue code is covered by at least one fixture', () => {
    const covered = new Set(Object.values(EXPECTED).flat());
    for (const code of ISSUE_CODES) expect(covered, `code ${code} uncovered`).toContain(code);
  });

  it.each(Object.entries(EXPECTED))('%s yields exactly %j', (file, expectedCodes) => {
    const result = validateFabrial(load('invalid', file), miniCatalog, miniManifest, miniProjections);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const got = [...new Set(result.issues.map((i) => i.code))].sort();
    expect(got).toEqual([...new Set(expectedCodes)].sort());
    // every issue is legible: a message, and a place to point at
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.path ?? issue.elementId).toBeTruthy();
    }
  });
});

describe('golden valid fabrials', () => {
  const files = readdirSync(join(corpusDir, 'valid')).filter((f) => f.endsWith('.fabrial.json'));
  it('corpus has at least one golden fabrial', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)('%s validates clean', (file) => {
    const result = validateFabrial(load('valid', file), miniCatalog, miniManifest, miniProjections);
    if (!result.ok) {
      throw new Error(result.issues.map((i) => `${i.code}: ${i.message}`).join('\n'));
    }
    expect(result.fabrial.root).toBeTypeOf('string');
  });
});
