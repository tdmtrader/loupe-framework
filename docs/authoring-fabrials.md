# Authoring fabrials

A fabrial is one screen as one JSON file: `fabrials/<app>/<name>.fabrial.json`.
The constitutional rule (stated in full in the root README) applies here in
practice: if you find yourself wanting client-side computation or a
client-side write, stop — that is the grammar telling you the derivation
belongs in the projection.

Validate while you write, from anywhere, no servers needed:

```
node fabrials/validate.mjs
```

It runs the full `validateFabrial(fabrial, loupeStd, manifest)` from
`@loupe/spec` against per-app verb manifests (live `GET /loupe/app`
descriptors when the apps are running, inline fallbacks otherwise) and
exits 1 on any issue.

## The envelope

```json
{
  "loupe": 1,
  "fabrial": "grill/board",
  "version": 1,
  "title": "answering the agent's grilling",
  "catalog": { "name": "loupe-std", "version": "1.4.0" },
  "app": { "name": "grill", "projection": "board" },
  "ui": { "cursorId": null },
  "root": "screen",
  "elements": { "…": "…" }
}
```

- `loupe` — dialect version; loaders reject unknown majors.
- `catalog` — the pin (r1f6). Load fails unless the loaded catalog has the
  same name, same major, and minor/patch ≥ pinned. Failure is total and
  legible — an error panel, never a half-screen. Pin the lowest version that
  has everything you use: `1.0.0` unless you use `scrollIntoView` (added in
  `1.1.0`).
- `app` — the verb-manifest namespace this fabrial was validated against and
  the projection it binds. Parameterized projections (`review?ticketId=…`)
  get params from the host route query.
- `ui` — the initial value of the client-local ui doc. **Every ui path the
  fabrial touches must be declared here**; binds or ui-sets to undeclared
  paths are validation errors. The ui doc is reset on reload *by design*:
  anything you would grieve losing belongs server-side, behind a verb.
- `elements` — a flat, ID-keyed map with a single `root`. Kebab-case IDs;
  dangling refs, orphans, and cycles are validation errors.

## Elements

```json
"finding-row": {
  "type": "Row",
  "repeat": { "path": "/findings", "key": "id", "filter": { "$bind": "decision", "eq": null } },
  "visible": { "$bind": "/round", "gt": 1 },
  "props": { "pad": [10, 12], "accent": "agent" },
  "children": ["f-sev", "f-body"],
  "slots": { "footer": ["f-foot"] },
  "on": { "press": { "ui": { "/cursorId": { "$bind": "id" } } } }
}
```

- `type` must exist in the pinned catalog; `props` are checked against the
  component's Zod schema; `slots` names must be declared by the catalog entry.
- `repeat` renders the element once per array item at `path` (`key` is the
  item field used for React keys — required). `filter` is an item-scoped
  Condition, so one projection list can feed several screen regions (pending
  vs settled) without pre-splitting.
- Inside a repeat scope, pointers without a leading `/` resolve against the
  item; `""` is the item itself; `{"$index": true}` is the position. Reach
  outer data with absolute pointers — there is no `../`.
- `visible`: `boolean | Condition | {"$and": [...]} | {"$or": [...]}`.
  Invisible elements do not mount.

### context — the current-item scope

An element may carry `context` instead of `repeat` (never both — each defines
the item scope):

```json
"detail-panel": {
  "type": "SidePanel",
  "context": { "list": "/findings", "key": "id", "at": "/cursorId" },
  "visible": { "$bind": "", "exists": true },
  "children": ["d-claim", "d-evidence"]
}
```

`context` puts "the current item" into scope for the element's props, actions,
and descendants: the first item of the projection array at `list` (absolute
pointer) whose `key` field deep-equals the ui-doc value at `at`. It is exactly
a repeat that expands to at most one item — minus the mounting: on a null or
missing ui value, or no match, the element still mounts with **no** item in
scope (relative binds resolve undefined; relative conditions are false).
Unlike repeat, `visible` evaluates *in* the context scope, so an item-aware
gate like the `exists` check above is well-defined. `at` must be a declared
ui path.

## The expression grammar (closed — nothing else evaluates)

| Form | Meaning |
|---|---|
| literal JSON | itself |
| `{"$bind": ptr}` | read from the projection snapshot (absolute) or scope item (relative). Read-only, always. |
| `{"$ui": ptr}` | read from the ui doc |
| `{"$index": true}` | repeat position |
| `{"$template": "…${/a/b}…${ui:/x}…"}` | string interpolation; null → `""` |
| `{"$cond": C, "$then": V, "$else": V}` | one conditional form; branches may nest one more `$cond`, no deeper |

A Condition is `{"$bind"|"$ui": ptr, op}` with op ∈
`eq neq gt gte lt lte in exists`; a Condition is also a valid prop value in
its own right, resolving to a boolean (`Hotkeys.keys[].when`, or
`scrollIntoView` bound to the cursor test). Literal composites (objects/arrays) may
carry expressions anywhere inside and are resolved member-wise; literal
objects may not use `$`-prefixed keys, so nothing can be smuggled past the
grammar as data.

There is **no** `$bindState`, no `$computed`, no arithmetic, no client write
to projection paths. Projections pre-compose display strings ("12 of 22 · 4
this week") — every number is a sentence, composed server-side.

## Actions

Values in `on` — a single action or an ordered array:

- `{"ui": {"/ptr": Expr, …}}` — merge-set into the ui doc; `null` deletes.
  Ephemera only.
- `{"verb": "keepIt", "params": {…Expr…}, "confirm"?: {title, message},
  "pending"?: {label?, disable?}, "done"?: {"ui": {…}}}` — dispatch through
  the client. `pending` is presentation only; `done.ui` runs on success.
- `{"advance": {list, key, cursor, dir, filter?}}` — a renderer-computed
  relative cursor move over a projection list; a ui-doc write only. See
  below.

Event payloads (e.g. Board's `cardMove {card, toLane}`, DiffBlock's
`linePress {file, line, side}`) become the action's relative scope, so params
bind into them with relative pointers.

Every action in an array resolves its **relative** pointers against the scope
as it was when the event fired — the item the person pressed on. A verb early
in the array can re-derive the projection and drop that item from the served
list; the actions after it still bind what was pressed. Absolute pointers
(`/…`) and `$ui` always read the latest, which is why an `advance` after a
decide already sees the decided item.

**Inputs**: `Textarea` takes `bindUi` — a ui-doc pointer the renderer wires to
`{value, set}`. Committing the content is always a verb; losing an uncommitted
draft on reload is the accepted, demonstrated cost of the invariant.

**Events must be declared.** `on` keys are checked against the catalog entry's
static `events` list, or against its `eventsFrom: {prop, field}` declaration —
in which case that prop must be a **literal** array in the fabrial. This is
how `Hotkeys` (`keys[].key`) and `VerbBar` (`actions[].event`) stay fully
statically validated, and why the shortcut map and the printed key hints share
one source: the fabrial.

## Cursor and keyboard flow

Three pieces make a keyboard-driven queue, all in the fabrial:

1. **`advance`** moves the cursor. `list` is an absolute projection pointer to
   an array of objects, `key` names the item field the cursor stores (same
   role as `repeat.key`), `cursor` is a declared ui-doc pointer, `dir` is
   `next | prev`, and `filter` is an item-scoped Condition with the same
   semantics as `repeat.filter` — so "next undecided" is one action:

   ```json
   { "advance": { "list": "/findings", "key": "id", "cursor": "/cursorId",
                  "dir": "next", "filter": { "$bind": "phase", "eq": "undecided" } } }
   ```

   Semantics: from the item whose `key` equals the cursor value, step to the
   first eligible item in `dir`; at the edge the cursor stays (no wrap). A
   null cursor (or an id no longer in the list) enters at the near edge; an
   empty or missing list is a no-op. If the anchor item itself just became
   ineligible (the decide-then-advance case: `[{verb}, {advance}]` in one
   handler), advance goes forward, falls back behind, and writes `null` when
   nothing is eligible — the "all done" state. `null` is written, never
   deleted, so `eq: null` placeholder visibility keeps working. `advance`
   evaluates against the overlaid (optimistic) snapshot and is always
   absolute-rooted, even when fired from inside a repeat scope.

2. **`context`** (above) derives the detail panel from the cursor, and gives
   `Hotkeys` an item scope so verb params can bind `{"$bind": "id"}`.

3. **`scrollIntoView`** (Stack/Row box channel, catalog ≥ 1.1.0) keeps the
   cursor row visible in a scrolling rail. Bind the cursor condition to it;
   it scrolls on the rising edge only (false→true, block `nearest`):

   ```json
   "scrollIntoView": { "$ui": "/cursorId", "eq": { "$bind": "id" } }
   ```

The projection owns the order: `advance` walks the served array exactly as
drawn, so an app that wants severity-major traversal serves severity-major
(escalation ladder rule (a) — order lives in the projection, never the
client).

## itemSlots

A slot whose template renders once per data item the *component* supplies,
with that item as the relative-pointer scope — and the scope's shape declared
as a Zod schema in the catalog def. Board's `laneHeader` scope is
`{lane, dropHint}`; DiffBlock's `note` scope is `{note}`; RouteGraph's `node`
scope is `{node, terminal, selected}`. Fill them via `slots`:

```json
"board": { "type": "Board", "props": { "lanes": { "$bind": "/lanes" }, "columns": { "$bind": "/columns" } },
  "slots": { "laneHeader": ["lane-header"], "card": ["card-row"] } }
```

## Style rules (normative)

- Reference only **token names** from the closed enums (`tone`, `tier`,
  `accent`, `bg`) — never hex. Components resolve tone triads internally, so
  a fabrial can say `"bad"` but can never pair a bright fill with a bright
  border.
- Lowercase voice; uppercase is a transform (`MicroLabel`), not the text.
- Verbs carry their keys: give buttons `keyHint` and route the same keys
  through `Hotkeys` from the same literal arrays.

## When the grammar cannot express something

Do **not** invent syntax, and do not hack a component. File it for the
integration owner. The allowed fixes, in order:

1. **Push derivation into the projection** — almost always right. If a screen
   needs a count, a phrase, a filtered list, or a per-item extra, the server
   composes it.
2. **Add a field to an itemSlot scope schema** — when a component already owns
   the data and the fabrial just needs one more documented field.
3. **Extend the expression grammar** (last resort, schema bump) — never a
   component-local hack, which would silently fork the dialect.

Compose around the gap in the meantime. A worked example of most of this:
`fabrials/grill/board.fabrial.json` — a cursor/keyboard flow over a served
rail, `ProseDoc` bodies, a `Textarea` draft in the ui doc, and a footer of
verbs with their keys.
