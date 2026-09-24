# @loupe/spec

The fabrial dialect: model + engine.

- **Model** (`src/model/`) — Zod schemas for the envelope (`zFabrial`,
  catalog pin, app binding, ui doc), elements (`zElement`, `zRepeat`,
  `zContext`), the closed expression grammar (`zExpression`, `zCondition`,
  `zPropValue`), actions (`zUiAction`, `zVerbAction`, `zAdvanceAction`), and
  the catalog contract (`defineCatalog`, `ComponentDef`, itemSlot scopes).
- **Engine** (`src/engine/`) — `resolve` (expression evaluation against
  `{state, ui, item, index}` scopes), `expandRepeat` / `evaluateVisible` /
  `evaluateCondition`, `advanceCursor` and `resolveContextItem` (cursor
  semantics — the renderer must reuse these, never reimplement),
  `validateFabrial(fabrial, catalog, verbManifest, projections?)` — full
  validation (schema, refs, props, events, slots, ui-path declarations, verb
  params) returning `{ok: true, fabrial}` or `{ok: false, issues}`, never a
  partial pass — and `emitJsonSchemas` (→ `schema/`, via
  `pnpm --filter @loupe/spec emit-schemas`).

CLI: `bin/validate.ts` (`loupe-validate`). The repo-level wrapper
`node fabrials/validate.mjs` is the everyday entry point.

Authoring guide: `docs/authoring-fabrials.md`. Test:
`pnpm --filter @loupe/spec test`.
