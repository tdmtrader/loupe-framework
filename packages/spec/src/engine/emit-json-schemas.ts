// emitJsonSchemas(outDir): writes fabrial.schema.json (generated from the
// model Zod schemas via z.toJSONSchema) plus the @loupe/protocol hand-authored
// wire schemas into outDir (schema/). Returns the written file paths.
import { z } from 'zod';
import { protocolJsonSchemas, type JsonObject } from '@loupe/protocol';
import { zFabrial } from '../model/index.ts';

/** The fabrial envelope as a wire JSON Schema (draft 2020-12). */
export function fabrialJsonSchema(): JsonObject {
  const generated = z.toJSONSchema(zFabrial, {
    target: 'draft-2020-12',
    io: 'input',
    reused: 'ref',
    unrepresentable: 'any',
  }) as JsonObject;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'loupe:fabrial',
    title: 'loupe fabrial (dialect v1) — envelope + elements + closed expression grammar',
    ...Object.fromEntries(Object.entries(generated).filter(([k]) => k !== '$schema')),
  };
}

export async function emitJsonSchemas(outDir: string): Promise<string[]> {
  // Lazy node imports keep @loupe/spec importable in the browser (the
  // renderer bundles the barrel; only this function touches the fs).
  const [{ mkdir, writeFile }, { join }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  await mkdir(outDir, { recursive: true });
  const docs: Record<string, JsonObject> = {
    'fabrial.schema.json': fabrialJsonSchema(),
    ...protocolJsonSchemas(),
  };
  const written: string[] = [];
  for (const [name, doc] of Object.entries(docs)) {
    const path = join(outDir, name);
    await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`);
    written.push(path);
  }
  return written;
}
