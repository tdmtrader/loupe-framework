# Authoring apps

An app is a server process that owns all domain state and speaks the wire
contract: a descriptor at `GET /loupe/app`,
projections at `GET /loupe/state/:name`, verbs at `POST /loupe/verbs/:name`,
and optional WS push at `/loupe/ws`. `@loupe/serve` implements all of that
once; an app is its domain logic plus one `defineApp` call. The shipped
grill example (`apps/grill`) is exactly this shape. When an app speaks to
another system — reading its files or API into the store, writing back only
what the app owns — that part is its *adapter*, a module inside the app,
never an app of its own.

## The worked example

A minimal triage app: an append-only decision log, one projection, one verb.

```ts
import { z } from 'zod';
import { defineApp } from '@loupe/serve';

interface Store {
  findings: Array<{ id: string; claim: string; severity: string }>;
  decisions: Array<{ finding_id: string; status: string; actor: string; at: string }>;
}

const store: Store = { findings: loadFindings(), decisions: [] };

const app = defineApp({
  name: 'triage',
  version: '0.1.0',
  store,
  projections: {
    // A projection is a pure fold over the store. Pre-compose everything the
    // screen shows — counts, phrases, order. `advance` walks this array order.
    review: {
      derive: (s) => ({
        findings: s.findings.map((f) => ({
          ...f,
          decision: s.decisions.findLast((d) => d.finding_id === f.id)?.status ?? null,
        })),
        summary: `${s.decisions.length} of ${s.findings.length} decided`,
      }),
    },
  },
  verbs: {
    // Verbs append records. Params are a Zod schema; the harness validates,
    // emits the JSON-Schema manifest, stamps actor/at, re-derives every live
    // projection, bumps seqs, pushes snapshots, and fills in the returned seq.
    'finding.decide': {
      description: 'record a verdict for a finding',
      params: z.strictObject({
        finding_id: z.string(),
        status: z.enum(['fix', 'accept', 'dismiss']),
      }),
      execute: (p, ctx, s) => {
        if (!s.findings.some((f) => f.id === p.finding_id)) {
          return { ok: false, error: { code: 'unknown_finding', message: p.finding_id } };
        }
        s.decisions.push({ ...p, actor: ctx.actor, at: ctx.at });
        return { ok: true, seq: 0 }; // seq 0 — the harness overwrites it
      },
    },
  },
});

await app.listen(6180, '127.0.0.1'); // loopback only
// app.touch() when the store changes outside a verb (fs.watch, etc.)
```

That is the whole server. The harness derives lazily per `(projection,
params)` pair, bumps `seq` only when the derived JSON actually changed, and
serves HTTP polling (`?after=seq` → 304) and WS subscriptions from the same
bookkeeping.

## The descriptor

`GET /loupe/app` is generated — projection names + params, and each verb's
name, description, and JSON-Schema'd params (from the Zod schema). It is the
manifest fabrials validate against: a fabrial dispatching an undeclared verb,
or params that fail the schema, is a validation error before anything mounts.

Verify from the shell:

```
curl -s http://127.0.0.1:6180/loupe/app | jq '.verbs[].name'
curl -s http://127.0.0.1:6180/loupe/state/review | jq '.state.summary'
curl -s -X POST http://127.0.0.1:6180/loupe/verbs/finding.decide \
  -H 'content-type: application/json' \
  -d '{"params": {"finding_id": "f1", "status": "accept"}}'
```

The app port, not the UI, is the platform boundary — `apps/loupe-mcp` puts
an agent on it with no renderer involved (`docs/agent-loop.md`).

## Then the fabrial

One JSON file binds a screen to the projection and verbs
(`docs/authoring-fabrials.md` has the full dialect):

```json
{
  "loupe": 1,
  "fabrial": "triage/review",
  "version": 1,
  "title": "triage",
  "catalog": { "name": "loupe-std", "version": "1.0.0" },
  "app": { "name": "triage", "projection": "review" },
  "ui": { "cursorId": null },
  "root": "screen",
  "elements": {
    "screen": { "type": "Stack", "props": { "pad": 16, "gap": 8 }, "children": ["summary", "row"] },
    "summary": { "type": "Text", "props": { "text": { "$bind": "/summary" }, "tier": "muted" } },
    "row": {
      "type": "Row",
      "repeat": { "path": "/findings", "key": "id" },
      "props": { "pad": [8, 12] },
      "children": ["claim", "accept"],
      "on": { "press": { "ui": { "/cursorId": { "$bind": "id" } } } }
    },
    "claim": { "type": "Text", "props": { "text": { "$bind": "claim" } } },
    "accept": {
      "type": "Button",
      "props": { "label": "accept", "variant": "ghost" },
      "visible": { "$bind": "decision", "eq": null },
      "on": { "press": { "verb": "finding.decide",
                         "params": { "finding_id": { "$bind": "id" }, "status": "accept" } } }
    }
  }
}
```

Drop it under `fabrials/triage/`, register the app's base URL in
`apps/host/host.config.json`, and the host lists and mounts it. Validate
headlessly with `node fabrials/validate.mjs` — with the app running it
validates against the live `GET /loupe/app` descriptor; for offline
validation add the verb manifest to the inline table in `validate.mjs`.

## Records reach whoever subscribes

A verb appends more than the projections read. `finding.decide` above returns
`{ok: true, seq: 0}` and nothing else; a verb that wants to *notify*, not just
re-derive, also declares which streams it may write —
`records: [{stream: 'dispositions.jsonl'}]` in the verb's config, published
verbatim in the manifest — and its `execute` returns the records it actually
appended that call, as `VerbOk.records: WrittenRecord[]`
(`{stream, record}`). The harness does the rest: after `touch()` re-derives
every live projection, each returned record is pushed to every socket
subscribed to its stream, as `{t: 'record', stream, record, seq}` — stamped
with the same post-execution `seq` the dispatcher is answered, so a record
frame and the state frame it caused are ordered and comparable.

A `record` is a JSON **object** — a line of a `.jsonl` stream — and that is
the shape on all three surfaces it crosses (`WrittenRecord`, the frame, the
poll twin's envelope), not "whatever the app wrote". Two reasons, and neither
is tidiness: the append-record floor reads two named fields off it, and `null`
is spoken for, as the re-snapshot signal `LoupeClient.records` hands its
callback — an app free to append a bare scalar could make its own record
unreadable, and one free to append `null` could make it look like a gap.

A client asks for a stream the way it asks for a projection, except the frame
carries one field or the other, never both: `{t: 'sub', stream}` /
`{t: 'unsub', stream}`. Unlike a projection sub, a stream sub is answered with
nothing — there is no snapshot of a stream, only what lands next; history
since a seq is the poll twin's job, not the socket's.

Both additions are source-compatible on the wire — the server frame union
gained `record` beside `state`/`patch`, and the client frame union gained
these stream shapes beside the projection ones, and neither breaks a peer
that predates it — but a TypeScript consumer that read `frame.projection`
straight off a `ServerFrame` back when `state` and `patch` were the only two
variants now needs a `t === 'state'` guard first, since a `record` frame
carries `stream`, not `projection`.

`GET /loupe/records/:stream?after=seq` is that poll twin, for a caller with no
socket: it answers `{stream, seq, records: [{seq, record}]}`, everything
appended since `after`, from a bounded ring the harness keeps per stream in
process memory (`recordRing` on `defineApp`, default 256 records). An `after`
older than what the ring still holds answers `410` with a sentence naming the
oldest seq it does hold, and the caller re-snapshots rather than silently
missing what fell off the back. The ring is a wake-up channel, not a second
log: the files a verb appends to are the history, and a restart empties the
ring by design.

`LoupeClient.records(stream, after, cb)` hides both transports behind one
call, the way `subscribe` hides its own — `record` frames on `wsClient`, the
poll twin on `httpClient`, and the twin again as the WS path's resync on every
reopen. Its callback is handed that object, or `null` — and `null` is never a
record: it says the ring no longer holds what happened between the cursor and
the seq beside it, so re-snapshot before trusting what follows. Because the
wire shapes refuse a null record, reading `record === null` as "gap" is never
wrong. It exists for a process that needs to know *when* something happened,
not for the renderer: the fabrial dialect has no way to reach it, and a screen
has no business consuming an event a projection has not already folded into a
phrase.

## `actors: 'header'` — letting a loopback process sign its own name

By default every record an app writes carries `ctx.actor` — the name
`defineApp({actor})` was configured with, or the app's own `name` — no matter
who dispatched; clients never send identity. `actors: 'header'` in
`defineApp` opts an app into one exception: a dispatch arriving over
**loopback** may name itself in `X-Loupe-Actor`, and that name replaces the
configured actor in `ctx` for that one call. A header from anywhere else, or
one that is not a plain name (`[A-Za-z0-9._-]`, at most 64 characters), is
ignored outright — not refused, just unheard — and the dispatch is stamped
exactly as if the app had not opted in.

`httpClient`/`wsClient` take a matching `{actor}` in their options and send it
as `X-Loupe-Actor` on every dispatch; leave it unset and no header goes out at
all, which is what every fabrial's client already does. The two gates —
opt-in and loopback — exist for the same reason: identity is transport, not
params, and a header arriving over anything but loopback would be a real
principal showing up unannounced on a wire that otherwise promises "clients
never send identity." An app takes the exception on deliberately, one config
field at a time, for a process it trusts because it runs on the same
machine — never for a fabrial's client, which has no way to set it.

The host (`apps/host`) enforces the other half: `upstreamHeaders` in
`server.ts` deletes any `X-Loupe-Actor` a caller sent before proxying to an
app, so the loopback gate really means *spoke to the app's loopback port
directly*, never *the request eventually reached loopback after bouncing
through a proxy*. State the rule plainly for any other reverse proxy that
might sit in front of a loopback-bound app: one that forwards headers
verbatim defeats the gate, because it hands every caller through it the one
credential the harness checks, for free.

## Rules that keep it honest

- **The app is the only writer, and it writes only what it owns.** Verbs
  append; projections fold; no projection endpoint mutates anything. An app
  that reads files it did not originate keeps a code-level gate over its single
  append path — the grill app's `OWNED_STREAMS`
  (`apps/grill/src/streams.ts`) — and a name earns a place on that
  list by being *originated* by the app, not by being useful to it.

  The corollary: if the app needs to record something it currently writes
  into somebody else's file, the fix is a stream of its own plus a verb, not
  a hand-run script that appends to the other file. The other system's file
  stays read-only and becomes a documented *fallback* source the projection
  consults only for what the app does not own. Moving old data across is a
  migration that dispatches the verb over HTTP — a migration for an
  append-only app is a sequence of verb calls, and it proves itself by
  deep-comparing the projection before and after each step. Prove such a
  migration lossless in *both* directions — ablate either source and see
  what survives, because a before/after diff alone passes trivially if
  derivation never switched source.
- **Loopback binding.** Adapters listen on `127.0.0.1`; the host proxies.
- **Actor and time are server-stamped** (`ctx.actor`, `ctx.at`); clients never
  send identity — unless the app opts into `actors: 'header'`, above, in
  which case a loopback client may.
- **Order lives in the projection.** The client renders and traverses the
  served array order; if the screen wants severity-major, serve
  severity-major.
- **Every number is a sentence.** Compose display strings server-side; the
  fabrial grammar has no arithmetic on purpose.
- **Record types are yours.** Loupe states only the append-record *floor* —
  `zRecordFloor` (`at`, `actor`) in `@loupe/protocol`. Every record type above
  it is domain vocabulary, so the app defines it, typically as
  `zRecordFloor.extend({...})`; see `apps/grill/src/records.ts`.
- **Shared fold semantics.** If two records can claim the same key, fold with
  `@loupe/protocol`'s `foldLatest` (latest-wins by `at`, ties by lexicographic
  `actor`, identity field named per fold via `FoldKeys.id`) and pass its shared
  test vector.
