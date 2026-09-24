#!/usr/bin/env node
// Regenerates /schema/*.schema.json from the model + protocol emitters.
// Run: pnpm --filter @loupe/spec emit-schemas   (or: tsx bin/emit-schemas.ts)
import { fileURLToPath } from 'node:url';
import { emitJsonSchemas } from '../src/index.ts';

const outDir = fileURLToPath(new URL('../../../schema/', import.meta.url));
const written = await emitJsonSchemas(outDir);
for (const path of written) console.log(`wrote ${path}`);
