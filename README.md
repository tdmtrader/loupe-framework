# loupe

Screens as persisted, validated specs over apps that own all state.

In loupe, an **app** is a server process that owns its domain state and
serves it over a small wire protocol: **projections** (named, versioned
read-model JSON) and **verbs** (named actions with JSON-Schema'd params). A
**fabrial** is one screen as one JSON document — a flat map of elements drawn
from a fixed, versioned component catalog, whose props are literals or a
closed expression grammar over a projection. A **host** lists apps and
fabrials, validates, and mounts each fabrial with the **renderer**, which
turns component events into verb dispatches.

State never lives in a UI. The one rule, stated here once for the whole repo:

> **A fabrial is a pure function of served state and may mutate only through
> verbs. A bad fabrial renders wrong; it cannot lose anything.**

Domain mutations travel only as verbs; the renderer holds exactly one
client-local document — the ui doc — for lossable view ephemera (cursor, open
panels, unsent drafts), reset on reload by design.

## Quickstart

Requires node ≥ 24 and pnpm. The browser-mode tests need a playwright
chromium (`pnpm exec playwright install chromium`).

> Put comments on their own line when copying these blocks. In zsh, `#`
> mid-line is not a comment — it is passed through as an argument.

```
pnpm install

# typecheck + lint + full test suite + fabrial validation
pnpm check

# the grill example app (:6182) + host (:6170 api, :5173 ui)
pnpm demo:grill
```

Open `http://localhost:5173/` — the launcher lists every app × fabrial pair —
then `http://localhost:5173/#/grill/board`. The board starts empty; ask it a
question the way an agent would, over the app's own loopback port:

```
curl -s -X POST http://127.0.0.1:6182/loupe/verbs/question.ask \
  -H 'content-type: application/json' -H 'X-Loupe-Actor: my-agent' \
  -d '{"params":{"id":"q1","round":1,"title":"keep the cache?","body":"The cache adds a second source of truth.","recommendation":"Drop it.","options":[{"id":"a","label":"keep it"}]}}'
```

The screen repaints; answer it there, and the answer lands in
`apps/grill/.grill/answers.jsonl` (override the directory with
`LOUPE_GRILL_DIR`). Ports are environment-driven: `LOUPE_PORT` for each
process, `LOUPE_UI_PORT` for the vite shell, and `LOUPE_<APP>_BASE` (e.g.
`LOUPE_GRILL_BASE`) to point the host at an app somewhere other than
`apps/host/host.config.json` says.

Validate every fabrial headlessly (no servers needed):

```
node fabrials/validate.mjs
```

## Architecture

Four boxes, three arrows, one invariant.

- **App** — a server process owning all domain state. Serves a versioned
  **state projection** (read-model JSON, monotonic `seq`) and a **verb
  surface** over HTTP/WS. The app is the only writer: verbs append records;
  projections are folds over records. `@loupe/serve`'s `defineApp` implements
  the whole wire contract; an app is its domain logic plus one call.
- **Fabrial** — a persisted JSON file under `fabrials/`, one per screen: a
  flat, ID-keyed map of catalog elements whose props are literals or a closed
  expression grammar (JSON Pointer binds, templates, one conditional form,
  routes). The envelope pins its catalog (`loupe-std`) and names its app.
  Validation failure renders an error panel, never a half-screen.
- **Renderer** (`@loupe/renderer`) — walks the element map, resolves
  expressions against the latest projection snapshot, mounts React catalog
  components, and translates component events into verb dispatches. No domain
  state; only the ui doc. Draws its own chrome: error panel, confirm dialog,
  and a connection band while the app is unreachable.
- **Host** (`apps/host`) — a dev shell that lists apps and fabrials,
  validates, mounts, and proxies each app under `/apps/:name/loupe/*`. Zero
  domain logic, zero state; nothing in the contract assumes it.

## Layout

| Path | What |
|---|---|
| `packages/tokens` | Themes as data (`classic`, `modern`) + generated `--lp-*` CSS |
| `packages/protocol` | The wire contract: schemas, vectors, `foldLatest`, the `LoupeClient` seam |
| `packages/spec` | The fabrial dialect: schemas, evaluator, `validateFabrial`, CLI |
| `packages/client` | HTTP/WS `LoupeClient` transports with liveness + backed-off retry |
| `packages/serve` | `defineApp` — the app-side harness |
| `packages/catalog` | `loupe-std` component defs + React impls + a styleguide |
| `packages/renderer` | `<LoupeRenderer>` |
| `apps/host` | Dev host: fabrial index + app proxy, `/#/:app/:fabrial` |
| `apps/grill` | The example app: an agent asks questions, a human answers them |
| `apps/loupe-mcp` | Stdio MCP server in front of any one loupe app — `snapshot`, `await`, one tool per verb |
| `fabrials/` | The shipped fabrials + `validate.mjs` (headless check) |
| `schema/` | Generated JSON Schemas |
| `docs/` | Authoring guides, catalog index, decision records |

## Authoring

- [`docs/authoring-apps.md`](docs/authoring-apps.md) — the app-author path:
  `defineApp` → descriptor → projections → verbs → fabrial, as a worked
  example. `apps/grill` is a complete small app in this shape.
- [`docs/authoring-fabrials.md`](docs/authoring-fabrials.md) — the fabrial
  dialect: envelope, elements, expression grammar, actions (including
  `advance`), `context` scope, itemSlots, style rules.
- [`docs/catalog.md`](docs/catalog.md) — the `loupe-std` component index.
- [`CONTEXT.md`](CONTEXT.md) — the glossary: the words to hold before
  authoring anything.
- `packages/*/README.md` — one per package: what it exports and where its
  seams are.

To add an app: write it with `defineApp` (see `apps/grill`), give it a name
and base URL in `apps/host/host.config.json`, add its inline verb manifest to
`fabrials/validate.mjs` for offline validation, and put its screens under
`fabrials/<app>/`.

## Decisions

The binding design decisions are recorded in [`docs/adr/`](docs/adr/). Code
comments cite them by their review tags:

- **r1f2** — the app is the only writer, and writes only what it owns → [ADR 0001](docs/adr/0001-app-is-the-only-writer-and-writes-only-what-it-owns.md)
- **r1f3** — no session object → [ADR 0002](docs/adr/0002-no-session-object.md)
- **r1f6** — fabrials pin their catalog → [ADR 0003](docs/adr/0003-fabrials-pin-their-catalog.md)
- **r1f8** — fold semantics specified exactly once → [ADR 0004](docs/adr/0004-fold-semantics-specified-once.md)
- **r3f1** — no domain vocabulary in the generic layer → [ADR 0005](docs/adr/0005-no-domain-vocabulary-in-the-generic-layer.md)
- **r3f2** — the catalog exposes semantic tones only → [ADR 0006](docs/adr/0006-the-catalog-exposes-semantic-tones-only.md)

Also: **r1f4** the serving component is named (`apps/host`, zero domain
logic, zero state).
