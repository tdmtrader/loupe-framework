# loupe-mcp

MCP as a third transport, not a redesign. A stdio MCP server in
front of **one** loupe app, generic over any app that speaks the wire: it
reads `GET /loupe/app` and publishes what it finds. It invents no verb,
renames no parameter, and rewrites no schema.

```
pnpm --filter loupe-mcp exec tsx src/main.ts --app http://127.0.0.1:6182 --actor Kelsier-1
```

It exists because loupe's loop was closed on the human side and open on the
agent side. A human answers on `grill/board`, the app appends the answer and
re-derives, and the screen repaints — while the agent that asked learns
nothing until a person tells it to go read a file. `await` below is the other
half of that symmetry: the subscription a turn-based session can hold.

## The three kinds of tool

**One tool per verb.** `name`, `description` and `inputSchema` come out of the
manifest verbatim — `zVerbDecl.params` has always been draft-2020-12 JSON
Schema and `description` has always been a sentence for a reader, so nothing
here translates anything. `tools/call` is `dispatch`. The result is the
`VerbResult` as one JSON text block, and **a refusal is a tool result, never
an MCP error**: `{"ok": false, "error": {"code": "...", "message": "..."}}`
with `isError` unset, so the model reads the app's own code and the app's own
sentence rather than a protocol failure that erases both. The only MCP error
on this path is a call for a tool the app has no verb for, which is not a
refusal.

**`snapshot {projection, params?}`** — one projection, in the envelope the
wire carries: `{projection, seq, state}`. The state already contains the
sentences the app composed (grill's `summary`, say); read them rather than
tallying the arrays beside them.

**`await {streams, after?, timeoutMs?}`** — blocks until a record lands on one
of the named append-only streams, then returns every record that landed:
`{records: [{stream, seq, record}], seq}`. Records that land within one breath
of each other come back in one answer rather than one per call, so an agent
never acts on half a story. Naming the same stream twice listens to it once.

**What `after` is.** The cursor is the `seq` a previous `await` returned, or
the `seq` in a verb's dispatch response; omitted, it starts at 0. **A
snapshot's `seq` is not a cursor.** A projection's seq advances only when that
projection's derived JSON changes, so it lags the record wire's `seq` — pass
it and you may be re-delivered records you have already seen. That is safe
(the records are the same records, and the answer is idempotent to read), and
it is the right way round: the other error, a cursor that runs ahead, is what
produces a false gap.

An empty answer always says which kind of empty it is:

| answer | what happened |
| --- | --- |
| `{records: [], seq, timedOut: true, note}` | a quiet round. Nothing landed; await again from the same `seq`. |
| `… timedOut: true, unreachable: true, note` | **the app was not answering** while the await listened. Not a quiet round — nothing will land, and `snapshot` will fail too, until the app is up. The note names the URL. |
| `… timedOut: true, noRecordWire: true, note` | the app answers `404` for `GET /loupe/records/…`: it predates the record wire and can never push. Answered immediately rather than after the full timeout. Use `snapshot`. |
| `{records, seq, note}` where the note mentions a dropped stretch | the app's in-process ring overflowed past your cursor. Snapshot before trusting what follows. |

The last row is unambiguous because the wire says so. A `record` is a JSON
object on every shape that carries one — `WrittenRecord`, the `record` frame,
the poll twin's envelope — so the `null` `LoupeClient.records` hands its
callback is the re-snapshot signal and nothing else. This server never has to
guess whether an app appended a null, and a gap can never arrive disguised as
a record or a record as a gap.

A cancelled `await` (the harness gave up on the call, or the session closed)
releases its subscriptions at once and answers an MCP error rather than an
empty result — a result would claim nothing landed, which a call that stopped
listening cannot know.

**Resources** are the projections: `loupe://<app>/state/<projection>`, one per
entry in the manifest's `projections`. `resources/read` answers the same
envelope `snapshot` does; `resources/subscribe` holds a `LoupeClient`
subscription and raises `notifications/resources/updated` on every pushed
snapshot. A resource URI cannot carry projection params, so a projection that
takes them says so in its description and points at the `snapshot` tool.
Whether a session ever surfaces a resource notification to the model between
turns is a measurement (AC7), not a promise — `await` is the path this server
was built for.

## The flags

| flag | required | meaning |
| --- | --- | --- |
| `--app <base url>` | yes | the loupe app to be a transport for, e.g. `http://127.0.0.1:6182`. An `http:`/`https:` base URL, not a host — `localhost:6182` is refused. |
| `--actor <name>` | no | the name every record this server writes carries. Must match `/^[A-Za-z0-9._-]{1,64}$/`; anything else is refused at startup with exit 2. |
| `--await-timeout-ms <ms>` | no | how long `await` blocks before answering empty (default `120000`, stated in the tool's own description). **The harness's per-tool-call ceiling must exceed it** — see below. |

**The default `await` timeout is longer than the MCP SDK's default per-request
ceiling, and that is deliberate.** `@modelcontextprotocol/sdk` times a request
out after `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`; this server blocks for
`120000`. A harness that keeps the SDK default will abandon every `await` at
sixty seconds with a `-32001 RequestTimeout` — the tool call fails rather than
answering "a quiet round", and the agent loop reads a protocol error where it
expected a cursor. Raise the ceiling above the await timeout, or lower
`--await-timeout-ms` below it. In Claude Code the ceiling is the
`MCP_TOOL_TIMEOUT` environment variable (milliseconds); set it to at least
`180000` for the shipped default. The cancellation is honoured either way —
the await releases its subscriptions the moment the client gives up, rather
than holding sockets for the remaining minute.

`--actor` is `X-Loupe-Actor` on every dispatch. An app that opted in
(`defineApp({actors: 'header'})`, which the grill app does) stamps it
into the record over a loopback connection; an app that did not, or a
connection that is not loopback, ignores it and stamps its own actor as
before. **A server started without `--actor` sends no header**, so its records
are signed by the app's configured actor — for a screen-facing app, the
human. That is the mistake the flag exists to prevent.

The name is validated here, against the same expression the serve harness
tests the header with, because the serve side's answer to a name it does not
like is to *ignore the header* and stamp the app's own actor — silently, and
indistinguishably from a server that was never given `--actor` at all. A
typo'd actor would not fail; it would sign the human's name to the agent's
records. Refusing at startup is the only place that mistake is visible.

The app being down at startup is not fatal: the server says so on stderr and
serves anyway, because `tools/list` re-reads the manifest every time it is
asked and so recovers on its own once the app comes up. While it is down,
`tools/list` and `snapshot` answer that sentence as an MCP error naming the
URL, and `await` answers `unreachable: true` — none of them answer `fetch
failed`. A manifest that declares a verb named `snapshot` or `await` is the
other kind of failure and **exits 2**: it can never recover, and a server that
stayed up would refuse every `tools/list` for the life of the process.

## Registering it

An MCP client config entry in front of the grill example (`.mcp.json` for
Claude Code, or your client's equivalent):

```json
{
  "mcpServers": {
    "loupe-grill": {
      "command": "pnpm",
      "args": ["--filter", "loupe-mcp", "exec", "tsx", "src/main.ts",
               "--app", "http://127.0.0.1:6182",
               "--actor", "<your-agent-name>"]
    }
  }
}
```

`<your-agent-name>` is a placeholder, and it is a placeholder on purpose: the
right value is *this agent's* own name, which no file in the repo knows.
Replace it before starting a session, so the records say the agent wrote them.

**The angle brackets are load-bearing.** They fail the actor pattern, so an
unedited entry exits 2 with a sentence on stderr instead of starting. A
placeholder that was a *valid* actor name would start cleanly and stamp
itself into real records, which is the one outcome a placeholder must never
have. (The test suite parses this block and holds it to that.)

`exec` rather than `run`/`start` is not a style choice. **Stdout is the wire**
for a stdio MCP transport, and `pnpm run` prints its own two-line banner
there, which a client parses as a malformed frame. `pnpm exec` prints nothing.
Everything this process says to a human goes to stderr.

## What it may import

`@loupe/client` and `@loupe/protocol`, and nothing else. Never `@loupe/serve`,
never an adapter, never the catalog. The server is a transport in front of an
app it knows only through the wire, and an import of one app would quietly
make it that app's. (The test does import `createGrillApp` and `defineApp`, as
devDependencies, because AC3 and AC4 are about a real manifest and real
records and a stub of either would be the test agreeing with itself.)
