# @loupe/serve

The app-side harness. `defineApp({name, version, store, projections, verbs,
actor?})` returns a node HTTP+WS server implementing the wire contract
exactly: descriptor emission (Zod → JSON Schema), per-(projection, params)
seq bookkeeping (seq bumps only on real state change), snapshot push on store
change, verb routing with Zod validation, server-stamped `actor`/`at`,
structured error envelopes, loopback binding.

- A **projection** is `{params?, derive(store, params) → Json}` — a pure
  fold; pre-compose everything the screen shows. `toJson(value)` bridges
  typed app data (interfaces included) into `Json` with a compile-time
  `Jsonifiable` check — never cast.
- A **verb** is `{description?, params: ZodType, optimistic?, records?,
  execute(params, ctx, store) → VerbResult}`. `execute`'s `params` is
  inferred from the verb's own Zod schema — no annotations needed. Return
  `seq: 0` on ok — the harness overwrites it with the authoritative
  post-execution value after re-deriving every live projection.
- `app.listen(port, host)`, `app.close()`, `app.touch()` (store changed
  outside a verb — re-derive and push), `app.port()`.

The shipped grill app is its domain logic plus one `defineApp` call; a
third-party TS app starts here. Worked example: `docs/authoring-apps.md`.
Test: `pnpm --filter @loupe/serve test`.
