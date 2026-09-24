// emitJsonSchemas writes the three promised schema docs.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emitJsonSchemas, fabrialJsonSchema } from '../src/index.ts';

const outDir = await mkdtemp(join(tmpdir(), 'loupe-schema-'));
afterAll(() => rm(outDir, { recursive: true, force: true }));

describe('emitJsonSchemas', () => {
  it('writes fabrial + the two protocol wire schema docs', async () => {
    const written = await emitJsonSchemas(outDir);
    const names = written.map((p) => p.split('/').pop()).sort();
    // Wire shapes only: loupe emits no domain record schemas (r3f1).
    expect(names).toEqual([
      'app-descriptor.schema.json',
      'fabrial.schema.json',
      'verb-decl.schema.json',
    ]);
    for (const path of written) {
      const doc = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      expect(doc['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(typeof doc['$id']).toBe('string');
    }
  });
  it('fabrial schema pins the envelope required fields', () => {
    const schema = fabrialJsonSchema() as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(['loupe', 'fabrial', 'version', 'catalog', 'app', 'root', 'elements']),
    );
  });
});
