#!/usr/bin/env node
// loupe-validate <files...> [--manifest <json>] [--catalog <module>]
//
// Validates fabrial files and prints numbered issues per file; exits 1 on any.
// --manifest: path to a JSON file containing either an AppDescriptor
//             (its .verbs is used) or a bare VerbDecl[] array.
// --catalog:  path to a JS/TS module exporting a catalog (default export, or
//             a `catalog` / `loupeStd` named export). Without it, catalog
//             checks (types/props/slots/events) are skipped — envelope,
//             graph, ui-path, and verb checks still run.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { zVerbDecl, type VerbDecl } from '@loupe/protocol';
import { validateFabrialPartial, type Catalog } from '../src/index.ts';

interface Args {
  files: string[];
  manifest?: string;
  catalog?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--catalog') args.catalog = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('usage: loupe-validate <files...> [--manifest <json>] [--catalog <module>]');
      process.exit(0);
    } else args.files.push(a);
  }
  return args;
}

async function loadManifest(path: string): Promise<VerbDecl[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const verbs = Array.isArray(raw) ? raw : (raw as { verbs?: unknown }).verbs;
  if (!Array.isArray(verbs)) {
    throw new Error(`${path}: expected a VerbDecl[] array or an AppDescriptor with .verbs`);
  }
  return verbs.map((v, i) => {
    const parsed = zVerbDecl.safeParse(v);
    if (!parsed.success) throw new Error(`${path}: verbs[${i}] is not a valid VerbDecl`);
    return parsed.data;
  });
}

async function loadCatalog(path: string): Promise<Catalog> {
  const mod = (await import(pathToFileURL(resolvePath(path)).href)) as Record<string, unknown>;
  const candidate = mod['default'] ?? mod['catalog'] ?? mod['loupeStd'];
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof (candidate as Catalog).name !== 'string' ||
    typeof (candidate as Catalog).components !== 'object'
  ) {
    throw new Error(`${path}: no catalog export found (default / catalog / loupeStd)`);
  }
  return candidate as Catalog;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) {
    console.error('usage: loupe-validate <files...> [--manifest <json>] [--catalog <module>]');
    process.exit(1);
  }
  const manifest = args.manifest !== undefined ? await loadManifest(args.manifest) : null;
  const catalog = args.catalog !== undefined ? await loadCatalog(args.catalog) : null;

  let failed = 0;
  for (const file of args.files) {
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      console.error(`✗ ${file}\n  1. bad-envelope: not readable JSON (${(e as Error).message})`);
      failed += 1;
      continue;
    }
    const result = validateFabrialPartial(doc, catalog, manifest);
    if (result.ok) {
      console.log(`✓ ${file}`);
    } else {
      failed += 1;
      console.error(`✗ ${file}`);
      result.issues.forEach((issue, i) => {
        const where = issue.path ?? issue.elementId ?? '';
        console.error(`  ${i + 1}. ${issue.code}${where ? ` at ${where}` : ''}: ${issue.message}`);
      });
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(`loupe-validate: ${(e as Error).message}`);
  process.exit(1);
});
