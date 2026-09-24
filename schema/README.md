Generated wire + dialect JSON Schemas (draft 2020-12). Do not edit by hand.

- `fabrial.schema.json` — the fabrial envelope + element map + closed
  expression grammar, generated from the `@loupe/spec` model Zod schemas.
- `app-descriptor.schema.json`, `verb-decl.schema.json` — the hand-authored
  wire schemas re-exported from `@loupe/protocol`. That is the whole set:
  loupe publishes no domain record schemas, only the generic append-record
  floor (`zRecordFloor` in `@loupe/protocol`), which apps extend with record
  shapes of their own.

Regenerate: `pnpm --filter @loupe/spec exec tsx bin/emit-schemas.ts`
(or call `emitJsonSchemas(outDir)` from `@loupe/spec`).
