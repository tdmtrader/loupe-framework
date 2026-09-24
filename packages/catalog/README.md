# @loupe/catalog

`loupe-std@1.4.0` — the one component catalog fabrials pin.

- **Defs** (`src/defs/`, exported from the package root): `loupeStd` (the
  frozen `defineCatalog` object the validator and renderer share) and
  `componentDefs` — Zod prop schemas plus declared `events`, `eventsFrom`,
  `slots`, and `itemSlots` (with Zod scope schemas) for all 29 components.
  Defs are data; they import no React.
- **Impls** (`src/react/`, exported as `@loupe/catalog/react`): the React
  implementations (`components`), styled exclusively with `--lp-*` vars from
  `@loupe/tokens` — a raw hex literal is a lint error.

Component index with props/events/slots: `docs/catalog.md`.

Versioning (r1f6): fabrials pin `{name, version}`; a load succeeds when the
loaded catalog has the same name, same major, and minor/patch ≥ pinned.
`1.0.0 → 1.1.0` added `scrollIntoView` to the Stack/Row box channel
(rising-edge cursor follow, block `nearest`); `1.1.0 → 1.2.0` added `grow`;
`1.2.0 → 1.3.0` added `ProseDoc`; `1.3.0 → 1.4.0` added `Link` and
`ProseDoc`'s `outline`/`anchor`. Every bump so far is additive, so an older
pin keeps loading — but a fabrial that USES a newer component must re-pin,
because the element check runs against the loaded catalog and a stale pin
would validate while lying.

Amendments are integration-owner-only, in escalation-ladder order: push
derivation into the projection, add an itemSlot scope field, extend the
grammar last. Test (real-browser render checks via playwright):
`pnpm --filter @loupe/catalog test`.
