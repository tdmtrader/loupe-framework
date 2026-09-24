// The loupe MCP server: MCP as a third transport, not a redesign (§5.5).
//
// The design promised this seam years before there was a reason to build it:
// *"projections map to MCP resources … with subscription notifications, the
// verb manifest is the tool list (`params` is already JSON Schema,
// `description` is already the tool description), and `dispatch` is
// `tools/call`."* This file is that sentence, and almost nothing else. It
// invents no verb, renames no parameter, and rewrites no schema: everything a
// model sees under `tools/list` came out of `GET /loupe/app` verbatim, except
// the two tools loupe adds for the two things a manifest cannot express —
// reading a projection, and WAITING.
//
// `await` is the whole point of the track this file belongs to ("the agent
// inhabits the same state", R3). A fabrial holds a subscription; a turn-based
// agent cannot, because it acts only when a tool call returns. So the
// subscription is shaped as a tool call that returns when something happens:
// `LoupeClient.records()` under the hood, blocked on until a record lands on
// one of the named streams. Every harness honours a slow tool call. Resource
// subscriptions are offered beside it and measured by AC7, not relied on.
//
// WHAT THIS FILE MAY IMPORT is a boundary, not an accident: `@loupe/client`
// and `@loupe/protocol` only. Never `@loupe/serve`, never an adapter, never
// the catalog. The server is generic over any app that speaks the wire, and
// an import of one app would quietly make it that app's.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  zJsonObject,
  type AppDescriptor,
  type ConnectionState,
  type Json,
  type JsonObject,
  type LoupeClient,
  type Params,
} from '@loupe/protocol';
import { DEFAULT_AWAIT_TIMEOUT_MS } from './args.ts';

export const MCP_SERVER_VERSION = '0.1.0';

/**
 * The two tools loupe adds to the manifest's own. Reserved names: a manifest
 * that declared a verb called `snapshot` or `await` would make the tool list
 * ambiguous — two tools, one name, and a model with no way to say which it
 * meant — so the server refuses to start against such an app rather than
 * publishing a list whose names do not identify anything. An app's verbs are
 * namespaced (`question.ask`) and so are safely clear of both.
 */
export const SNAPSHOT_TOOL = 'snapshot';
export const AWAIT_TOOL = 'await';
const RESERVED = [SNAPSHOT_TOOL, AWAIT_TOOL];

// ------------------------------------------------------------- loupe's own two

/**
 * Declared in zod and published through `z.toJSONSchema` for exactly the
 * reason the harness does it (`verbParamsJsonSchema` in @loupe/serve): the
 * schema a model reads and the schema the arguments are validated against
 * must be one object, or the two drift and the drift is invisible until a
 * call is refused for a reason the description did not mention.
 */
const zSnapshotArgs = z.strictObject({
  projection: z.string().describe('the projection name, as `projections` in GET /loupe/app lists it'),
  params: z
    .record(z.string(), z.string())
    .optional()
    .describe('the projection’s declared params, which travel as query parameters'),
});

const zAwaitArgs = z.strictObject({
  streams: z
    .array(z.string())
    .min(1)
    .describe('append-only stream names to listen on, e.g. ["dispositions.jsonl", "answers.jsonl"]'),
  after: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'the seq to listen from — the one a previous await returned, or the seq in a verb’s dispatch ' +
        'response; omitted means 0. A snapshot’s seq is not a cursor: it only moves when that ' +
        'projection’s derived JSON changes, so passing it may re-deliver records you have already ' +
        'seen, which is safe.',
    ),
  timeoutMs: z.number().int().positive().optional().describe('how long to block before answering empty'),
});

function jsonSchemaOf(schema: z.ZodType): Json {
  const doc = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, Json>;
  // The manifest's own schemas arrive without one (@loupe/serve strips it),
  // so loupe's two tools are stripped the same way and the list is uniform.
  delete doc['$schema'];
  return doc;
}

/**
 * A JSON Schema document becomes the SDK's `Tool['inputSchema']`.
 *
 * THE DOCUMENT IS NOT REWRITTEN. AC3 asserts every verb tool's `inputSchema`
 * is deep-equal to the manifest's `params`, so this function's only job is to
 * prove the shape the MCP type demands — an object schema — before the
 * document crosses from `Json` into a typed position. It is the one
 * unchecked conversion in this package, and it is the mirror of `toJson` in
 * @loupe/serve: same seam, opposite direction. An app whose verb params are
 * not an object schema is refused by name, because a tool whose inputSchema a
 * client cannot read is worse than a tool that is not offered.
 */
const zObjectSchemaDoc = z.looseObject({ type: z.literal('object') });

function toolInputSchema(owner: string, params: Json): Tool['inputSchema'] {
  if (!zObjectSchemaDoc.safeParse(params).success) {
    throw new Error(
      `${owner}: params is not an object JSON Schema, so it cannot be an MCP inputSchema — ` +
        'a loupe verb publishes draft-2020-12 `{"type": "object", ...}`',
    );
  }
  return params as unknown as Tool['inputSchema'];
}

// --------------------------------------------------- what a failure has to say

/**
 * The manifest could not be read. ONE SENTENCE, WRITTEN ONCE, because two
 * callers need it and they must not disagree: `main.ts` prints it at startup
 * and `tools/list` throws it as an `McpError`. Before this existed the model
 * received the SDK's bare `fetch failed` — a string that names neither the app
 * nor the fact that asking again is the fix — while the human reading stderr
 * got the whole story.
 */
export function manifestUnreadableNote(appUrl: string | undefined, cause: unknown): string {
  const where = appUrl !== undefined ? `${appUrl}/loupe/app` : 'the app’s /loupe/app';
  const why = cause instanceof Error ? cause.message : String(cause);
  return (
    `could not read the manifest at ${where} (${why}); nothing can be listed or dispatched until the ` +
    'app answers. The manifest is re-read on the next call, so this recovers on its own once the app is up.'
  );
}

/** The projection could not be read, for the same reason and in the same voice. */
function projectionUnreadableNote(appUrl: string | undefined, projection: string, cause: unknown): string {
  const where = appUrl !== undefined ? `${appUrl}/loupe/state/${encodeURIComponent(projection)}` : `the app`;
  const why = cause instanceof Error ? cause.message : String(cause);
  return (
    `could not read projection ${projection} from ${where} (${why}); neither snapshot nor await can ` +
    'succeed until the app answers. Start it and call again.'
  );
}

/**
 * Thrown by `refresh()` when the app's own manifest collides with the two
 * names this server adds. It is a CLASS and not a bare Error because
 * `main.ts` has to tell the two failure modes apart: an app that is merely
 * down recovers by itself on the next call, so the server stays up; an app
 * whose manifest declares a verb called `await` never recovers, and a server
 * that stayed up would answer every `tools/list` with the same error forever
 * while its stderr said "serving anyway".
 */
export class ReservedVerbNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReservedVerbNameError';
  }
}

// ------------------------------------------------------------------ the await

/**
 * One record that landed while an `await` was open. `JsonObject` and not
 * `Json`, following the client seam: a record is a jsonl line, and `null` in
 * its place is the re-snapshot signal rather than a record with no content —
 * so nothing null-shaped can reach `records[]` here either.
 */
export interface LandedRecord {
  stream: string;
  seq: number;
  record: JsonObject;
}

/**
 * What `await` answers. `seq` is where the cursor now is and what the next
 * `await` should pass as `after`; on a timeout it is unmoved, which is why
 * the agent loop says to await again from the same number. `note` carries the
 * sentence an empty answer owes the reader (R7: no empty surface is silent).
 */
export interface AwaitResult {
  records: LandedRecord[];
  seq: number;
  timedOut?: true;
  /**
   * The app was not answering while this await listened, so the empty answer
   * is NOT a quiet round. It rides beside `timedOut` rather than replacing it
   * because both are true — the call did reach its deadline — and a reader
   * that only knows `timedOut` still behaves correctly, just less informed.
   */
  unreachable?: true;
  /**
   * The app has no `/loupe/records` route: it predates the record wire, so
   * there is nothing to listen to and blocking for two minutes would only
   * hide that. Distinct from `unreachable`: this app is up and its snapshots
   * work.
   */
  noRecordWire?: true;
  note?: string;
}

/** What `awaitRecords` needs beyond the four things the tool's arguments name. */
export interface AwaitOptions {
  /**
   * The app's base URL, so an answer that blames the app can name it. Absent
   * (a test with an injected client) only costs the sentence its noun.
   */
  appUrl?: string;
  /**
   * The SDK's per-request cancellation. A client that gives up on a slow tool
   * call sends `notifications/cancelled` and the SDK aborts this; without it
   * the await would hold its sockets for the rest of its timeout, which on
   * the shipped default is two minutes of a subscription nobody is reading.
   */
  signal?: AbortSignal;
}

/**
 * How long after the first record `await` keeps listening before answering —
 * the width of "the same breath". See THE COALESCING below.
 */
export const SETTLE_MS = 25;

/**
 * Hold a records() subscription on every named stream until one of them
 * speaks, then answer with everything that spoke.
 *
 * THE COALESCING, stated rather than improvised, because AC4 turns on it:
 * *"two dispositions dispatched during one open await are both in the one
 * return."* One dispatch can append two records, and two dispatches can land
 * in the same breath; answering the first and leaving the rest for the next
 * call would hand the agent half a story and let it act on the half. So the
 * first record does not resolve the call — it arms `SETTLE_MS`, and
 * everything that lands inside that window is in the same answer.
 *
 * WHY A TIMER AND NOT A TICK. A macrotask looks like the natural unit — the
 * socket's reads land there — and it is enough for two records from ONE
 * dispatch, which share a seq and arrive in one frame batch. It is not enough
 * for two dispatches: each is its own HTTP round trip, its own append, and
 * its own re-derive, and measured against a fixture app the two record
 * frames arrive one to three milliseconds apart — the same breath by every
 * human measure, and several macrotasks by the loop's. `SETTLE_MS` is that
 * measurement rounded up with room, and it is deliberately NOT extended by
 * each new record: a window that slid would never close under a busy stream,
 * and the point is to answer, not to accumulate.
 *
 * A stream that never goes quiet still cannot hold the call past its
 * deadline; when the deadline arrives with records in hand the answer is
 * those records, NOT a timeout, because something did land and `timedOut`
 * would be a lie.
 *
 * A `null` record is the client interface's re-snapshot signal, not a record:
 * the server's ring no longer holds what happened between the cursor and the
 * seq it answered. It wakes the call — a gap is news — and it is reported in
 * `note` rather than smuggled into `records` as a record with no content.
 *
 * THE DUPLICATE STREAM. `streams` comes from a model, and a model that names
 * `["dispositions.jsonl", "dispositions.jsonl"]` meant one stream, not two.
 * Two subscriptions on one stream deliver every record twice, and the answer
 * would say a disposition happened twice when it happened once — a lie an
 * agent would act on. The set, not the array, is what is listened to.
 *
 * SILENCE HAS TWO CAUSES AND THEY ARE NOT THE SAME. Nothing happened, and
 * nobody was listening. `LoupeClient`'s poll swallows a failed fetch and a
 * 404 alike, so an app that is down looks exactly like an app where the
 * humans are at lunch — and answering "a quiet round, not an error" to a dead
 * app tells an agent to keep awaiting a machine that will never speak. The
 * `connection` observable already knows better (it is what tones the
 * renderer's band), so it is read here: a deadline reached while the client is
 * `reconnecting` or `gone` answers `unreachable` and names the app. A client
 * without the observable (a third-party transport, a test's fake) keeps the
 * old answer, because an unknown connection is not evidence of a bad one.
 */
export function awaitRecords(
  client: LoupeClient,
  streams: readonly string[],
  after: number,
  timeoutMs: number,
  opts: AwaitOptions = {},
): Promise<AwaitResult> {
  // One subscription per DISTINCT stream; the order the model wrote them in
  // is kept, because the notes below read them back.
  const wanted = [...new Set(streams)];
  const where = opts.appUrl ?? 'the app';

  return new Promise<AwaitResult>((resolve, reject) => {
    const landed: LandedRecord[] = [];
    let gaps = 0;
    let head = after;
    let settled = false;
    let settle: ReturnType<typeof setTimeout> | null = null;
    // Optimistic-by-default is the tracker's own convention; `null` here means
    // this client cannot say, which is different from saying "connected".
    let connection: ConnectionState | null = null;

    const unsubs: Array<() => void> = [];
    const release = (): void => {
      if (settle !== null) {
        clearTimeout(settle);
        settle = null;
      }
      clearTimeout(deadline);
      opts.signal?.removeEventListener('abort', onAbort);
      while (unsubs.length > 0) unsubs.pop()!();
    };

    const gapNote = (): string | undefined =>
      gaps === 0
        ? undefined
        : `the app no longer holds every record between seq ${after} and seq ${head} on ` +
          `${wanted.join(', ')} — its in-process ring dropped ${gaps === 1 ? 'a stretch' : `${gaps} stretches`} ` +
          'of them, so snapshot the projection before trusting what follows.';

    const finish = (): void => {
      if (settled) return;
      settled = true;
      release();
      const note = gapNote();
      resolve({ records: landed, seq: head, ...(note !== undefined ? { note } : {}) });
    };

    /**
     * A cancelled await REJECTS rather than resolving empty, and the choice is
     * deliberate: a resolved `{records: [], timedOut: true}` would tell a
     * caller that nothing landed, which this call cannot know — it stopped
     * listening. The SDK has already abandoned the response by the time this
     * fires, so the rejection is for the record and for direct callers; what
     * matters on the wire is the line above it, which lets the subscriptions
     * go instead of holding them for the rest of the timeout.
     */
    function onAbort(): void {
      if (settled) return;
      settled = true;
      release();
      reject(
        new McpError(
          ErrorCode.InvalidRequest,
          `the await on ${wanted.join(', ')} was cancelled; its subscriptions are released and the cursor ` +
            `did not move — await again from seq ${after}.`,
        ),
      );
    }

    /** The first record opens the window; the rest of the breath joins it. */
    const arm = (): void => {
      if (settled || settle !== null) return;
      settle = setTimeout(finish, SETTLE_MS);
    };

    const deadline = setTimeout(() => {
      if (settled) return;
      // Records in hand at the deadline are an answer, not a timeout.
      if (landed.length > 0 || gaps > 0) {
        finish();
        return;
      }
      settled = true;
      release();
      if (connection !== null && connection !== 'connected') {
        resolve({
          records: [],
          seq: head,
          timedOut: true,
          unreachable: true,
          note:
            `nothing landed on ${wanted.join(', ')} within ${timeoutMs} ms, but that is not a quiet round: ` +
            `the connection to ${where} is "${connection}" — the app did not answer while this await ` +
            'listened. Neither await nor snapshot can succeed until it is up; start it, then await again ' +
            `from seq ${head}.`,
        });
        return;
      }
      resolve({
        records: [],
        seq: head,
        timedOut: true,
        note:
          `nothing landed on ${wanted.join(', ')} within ${timeoutMs} ms; that is a quiet round, not an ` +
          `error — await again from seq ${head}, or snapshot the projection to see the current state.`,
      });
    }, timeoutMs);

    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Before the record subscriptions, so the observable's immediate first
    // callback is captured rather than racing the first failed poll.
    if (client.connection !== undefined) {
      unsubs.push(
        client.connection((state) => {
          connection = state;
        }),
      );
    }

    for (const stream of wanted) {
      unsubs.push(
        client.records(stream, after, (seq, record, from) => {
          if (settled) return;
          if (seq > head) head = seq;
          if (record === null) gaps += 1;
          else landed.push({ stream: from, seq, record });
          arm();
        }),
      );
    }
  });
}

// ----------------------------------------------------------------- the server

export interface LoupeMcpOptions {
  /** The transport to the app. `main.ts` builds a wsClient; tests inject one. */
  client: LoupeClient;
  /** The `await` default, stated verbatim in that tool's description. */
  awaitTimeoutMs?: number;
  /**
   * The app's base URL — the same string the client was built with. The
   * client hides the URL behind its methods, which is right for every call
   * this server makes, and wrong for the two things it must say in words: a
   * sentence blaming an app cannot name it otherwise, and the record-wire
   * probe below is a route the `LoupeClient` interface deliberately does not
   * expose. Absent (a test with an injected client) costs the sentences their
   * noun and skips the probe.
   */
  appUrl?: string;
}

/**
 * Whether this app has `GET /loupe/records/:stream` at all.
 *
 * `records()` was added to the wire by this track's R1; an app built against
 * the protocol before it answers 404 there and 200 everywhere else. The
 * client cannot tell the difference — `startRecordPolling` logs a warning
 * once and keeps polling forever — so an `await` against such an app blocks
 * for its whole timeout and then reports a quiet round, which is the single
 * most misleading answer this server could give: the app is healthy, its
 * snapshots are current, and no record will ever arrive. One probe at
 * `refresh()` turns that into a sentence.
 */
type RecordWire = 'present' | 'absent' | 'unknown';

/** The first stream any verb in the manifest declares it writes, if any. */
function firstDeclaredStream(app: AppDescriptor): string | null {
  for (const verb of app.verbs) {
    const first = verb.records?.[0]?.stream;
    if (first !== undefined) return first;
  }
  return null;
}

async function probeRecordWire(appUrl: string, stream: string): Promise<RecordWire> {
  let res: Response;
  try {
    res = await fetch(`${appUrl}/loupe/records/${encodeURIComponent(stream)}?after=0`);
  } catch {
    // The app is down, which is a different sentence (`unreachable`) told by
    // a different place. Unknown, and asked again next time.
    return 'unknown';
  }
  // The body is read and dropped so the socket goes back to the pool rather
  // than sitting half-consumed for the life of the process.
  await res.text().catch(() => '');
  if (res.status === 404) return 'absent';
  // 410 is the ring having overflowed past `after=0` — the route exists and
  // is answering exactly as the protocol says it should.
  if (res.ok || res.status === 410) return 'present';
  return 'unknown';
}

export interface LoupeMcp {
  server: Server;
  /**
   * The descriptor read at start and again on every `tools/list`, so a
   * restarted app's manifest is current rather than whatever was true when
   * this process began. Returns it; throws the app's own failure.
   */
  refresh: () => Promise<AppDescriptor>;
  /** Release every held resource subscription. Idempotent. */
  close: () => Promise<void>;
}

function textResult(value: unknown): CallToolResult {
  // ONE text block carrying JSON, on every path. A refusal is the app's own
  // `{ok: false, error: {code, message}}` and `isError` is never set: the
  // model should read the app's code and sentence, not a protocol failure
  // that erases both (R3).
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/**
 * Both segments are encoded because both are the app's words, not this
 * server's: an app named `antique app` or a projection named `board/today`
 * would otherwise produce a URI that is not a URI, and `resources/subscribe`
 * — which finds the projection by comparing the URI a client sent against the
 * one this function built — would match nothing while `resources/list` had
 * just offered it. Everything that turns a name into a URI, and everything
 * that turns a URI back into a name, goes through here.
 */
function resourceUri(appName: string, projection: string): string {
  return `loupe://${encodeURIComponent(appName)}/state/${encodeURIComponent(projection)}`;
}

/**
 * One held resource subscription, as a mutable slot rather than the release
 * function itself.
 *
 * WHY A SLOT. `resources/subscribe` has to read the manifest before it knows
 * the projection a URI names, and that `await` is a window in which a second
 * subscribe for the same URI could run the whole handler too — both would
 * find the map empty, both would call `client.subscribe`, and the first
 * subscription would be overwritten in the map and never released: a socket
 * held until the process exits, delivering notifications nobody can stop. The
 * slot is put in the map BEFORE the await, so the second call sees it and
 * returns; `cancelled` covers the other half, an unsubscribe that arrives
 * while the first call is still reading the manifest.
 */
interface HeldSubscription {
  release: (() => void) | null;
  cancelled: boolean;
}

export function createLoupeMcp(opts: LoupeMcpOptions): LoupeMcp {
  const { client, appUrl } = opts;
  const awaitTimeoutMs = opts.awaitTimeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;

  const server = new Server(
    { name: 'loupe-mcp', version: MCP_SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        // `subscribe` is claimed because it is honoured below.
        // `listChanged` is not claimed for either kind: this server never
        // pushes a new list, it re-reads the manifest when asked.
        resources: { subscribe: true },
      },
      instructions:
        'This is one loupe app, spoken as MCP. Every tool named after a verb is that verb, ' +
        'dispatched verbatim; `snapshot` reads a projection; `await` blocks until a record lands ' +
        'on a stream, which is how a turn-based session holds a subscription.',
    },
  );

  /** The last manifest read, so `tools/call` and `resources/read` need no round trip. */
  let descriptor: AppDescriptor | null = null;
  /** Probed once and remembered; `unknown` is asked again, an answer is not. */
  let recordWire: RecordWire = 'unknown';

  const refresh = async (): Promise<AppDescriptor> => {
    const next = await client.describe();
    for (const verb of next.verbs) {
      if (RESERVED.includes(verb.name)) {
        throw new ReservedVerbNameError(
          `app ${next.app.name} declares a verb named "${verb.name}", which is one of the two names ` +
            'this server adds of its own (snapshot, await) — the tool list would carry that name twice.',
        );
      }
    }
    descriptor = next;
    if (recordWire === 'unknown' && appUrl !== undefined) {
      const stream = firstDeclaredStream(next);
      // No verb declares a stream, so there is nothing to probe WITH and
      // nothing for `await` to listen to either; leaving it unknown keeps the
      // old behaviour rather than blaming the app for a route it may have.
      if (stream !== null) recordWire = await probeRecordWire(appUrl, stream);
    }
    return next;
  };

  /**
   * `refresh()`, with the app's silence turned into the sentence above. The
   * reserved-name refusal passes through unwrapped: it is this server
   * refusing, not the app failing, and `main.ts` is watching for its type.
   */
  const refreshOrExplain = async (): Promise<AppDescriptor> => {
    try {
      return await refresh();
    } catch (err) {
      if (err instanceof ReservedVerbNameError) throw new McpError(ErrorCode.InternalError, err.message);
      throw new McpError(ErrorCode.InternalError, manifestUnreadableNote(appUrl, err));
    }
  };

  const manifest = async (): Promise<AppDescriptor> => descriptor ?? (await refreshOrExplain());

  const snapshotOrExplain = async (projection: string, params?: Params): Promise<{ seq: number; state: Json }> => {
    try {
      return await client.snapshot(projection, params);
    } catch (err) {
      throw new McpError(ErrorCode.InternalError, projectionUnreadableNote(appUrl, projection, err));
    }
  };

  /**
   * The arguments a tool was called with, or an `InvalidParams` refusal
   * naming the fields. A raw `ZodError` thrown from here is mapped by the SDK
   * to `-32603 InternalError` — "the server broke" — for what is in fact the
   * model having mistyped a field, and the issues never reach it in readable
   * form. `safeParse` plus the code MCP has for exactly this says both.
   */
  function argsOrRefuse<T>(schema: z.ZodType<T>, raw: unknown, tool: string): T {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new McpError(ErrorCode.InvalidParams, `${tool}: ${z.prettifyError(parsed.error)}`);
  }

  // -------------------------------------------------------------- tools/list

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    const app = await refreshOrExplain();
    const tools: Tool[] = app.verbs.map((verb) => ({
      name: verb.name,
      // The manifest's description verbatim, and no description invented
      // where the app gave none: a sentence this file wrote would be loupe
      // describing the app's verb to the model, which is exactly the layer
      // that must not have an opinion.
      ...(verb.description !== undefined ? { description: verb.description } : {}),
      inputSchema: toolInputSchema(`verb ${verb.name}`, verb.params as Json),
    }));
    tools.push({
      name: SNAPSHOT_TOOL,
      description:
        `read one projection of ${app.app.name} as the app derives it — the state the screen renders, ` +
        'in the envelope the wire carries: {projection, seq, state}. The state already contains the ' +
        'sentences the app composed (statusNote and the like); read them rather than counting.',
      inputSchema: toolInputSchema(SNAPSHOT_TOOL, jsonSchemaOf(zSnapshotArgs)),
    });
    tools.push({
      name: AWAIT_TOOL,
      description:
        'block until a record lands on one of the named append-only streams, then return every record ' +
        `that landed with the seq at the head: {records: [{stream, seq, record}], seq}. Defaults to ` +
        `${awaitTimeoutMs} ms, after which it answers {records: [], seq, timedOut: true} and a note ` +
        'saying nothing landed — a quiet round, not an error; if the app itself was not answering the ' +
        'answer also carries unreachable: true and says so. Pass `after` the seq a previous await ' +
        'returned, or the seq in a verb’s dispatch response; a snapshot’s seq is not a cursor (it moves ' +
        'only when that projection changes), so passing it may re-deliver records you have seen, which ' +
        'is safe. This is how a turn-based session holds the subscription a screen holds.' +
        (recordWire === 'absent'
          ? ' NOT AVAILABLE ON THIS APP: it answers 404 for GET /loupe/records/…, so it predates loupe’s ' +
            'record wire and has nothing to push. Calling this returns that sentence immediately rather ' +
            'than blocking; use snapshot to see the current state.'
          : ''),
      inputSchema: toolInputSchema(AWAIT_TOOL, jsonSchemaOf(zAwaitArgs)),
    });
    return { tools };
  });

  // -------------------------------------------------------------- tools/call

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const name = request.params.name;
    const rawArgs = request.params.arguments ?? {};

    if (name === SNAPSHOT_TOOL) {
      const args = argsOrRefuse(zSnapshotArgs, rawArgs, SNAPSHOT_TOOL);
      const snap = await snapshotOrExplain(args.projection, args.params);
      return textResult({ projection: args.projection, seq: snap.seq, state: snap.state });
    }

    if (name === AWAIT_TOOL) {
      const args = argsOrRefuse(zAwaitArgs, rawArgs, AWAIT_TOOL);
      const after = args.after ?? 0;
      // The manifest is what the probe rides on, so an await that is the very
      // first call this process serves still knows whether there is a wire. A
      // manifest that cannot be read is deliberately NOT reported from here:
      // an app that is down is an await's own kind of news, and `awaitRecords`
      // below says it in the words an awaiting agent needs.
      try {
        await manifest();
      } catch {
        /* the unreachable answer below is the better sentence for this path */
      }
      if (recordWire === 'absent') {
        return textResult({
          records: [],
          seq: after,
          timedOut: true,
          noRecordWire: true,
          note:
            `${appUrl ?? 'this app'} answers 404 for GET /loupe/records/… — it predates loupe’s record ` +
            'wire, so no record can ever be pushed to this await and blocking would only hide that. ' +
            'Read the projection with snapshot instead, and upgrade the app to get the wire.',
        });
      }
      return textResult(
        await awaitRecords(client, args.streams, after, args.timeoutMs ?? awaitTimeoutMs, {
          ...(appUrl !== undefined ? { appUrl } : {}),
          signal: extra.signal,
        }),
      );
    }

    // A name the manifest did not carry when it was last read may be a verb
    // the app grew since; re-read once before calling it unknown.
    let app = await manifest();
    if (!app.verbs.some((verb) => verb.name === name)) app = await refreshOrExplain();
    if (!app.verbs.some((verb) => verb.name === name)) {
      // NOT a tool result: this is not the app refusing a dispatch, it is a
      // call for a tool that does not exist, and MCP has a code for that.
      throw new McpError(ErrorCode.InvalidParams, `${app.app.name} has no verb named ${name}`);
    }

    // The arguments cross unvalidated on purpose. The app validates them
    // against the same schema this server published, and its refusal names
    // the field and the reason in the app's own words; a second validation
    // here could only refuse first and say less.
    const params: Params = zJsonObject.parse(rawArgs);
    return textResult(await client.dispatch(name, params));
  });

  // --------------------------------------------------------------- resources

  server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => {
    const app = await refreshOrExplain();
    return {
      resources: app.projections.map((projection) => ({
        uri: resourceUri(app.app.name, projection.name),
        name: projection.name,
        mimeType: 'application/json',
        description:
          `the ${projection.name} projection of ${app.app.name}, as the app derives it` +
          (projection.params !== undefined && projection.params.length > 0
            ? ` — it accepts ${projection.params.join(', ')}, which a resource URI cannot carry, so read it ` +
              `through the ${SNAPSHOT_TOOL} tool to name them`
            : ''),
      })),
    };
  });

  /** `loupe://<app>/state/<projection>` → the projection name, or a refusal. */
  const projectionOf = async (uri: string): Promise<string> => {
    const app = await manifest();
    const match = app.projections.find((projection) => resourceUri(app.app.name, projection.name) === uri);
    if (!match) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `${uri} is not a projection of ${app.app.name}; its projections are ` +
          `${app.projections.map((p) => resourceUri(app.app.name, p.name)).join(', ')}`,
      );
    }
    return match.name;
  };

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    const uri = request.params.uri;
    const projection = await projectionOf(uri);
    // No params: a resource URI names a projection, not a parameterised view
    // of one. A projection that takes params derives its own default (a
    // per-round view might pick the latest round), and the model that
    // needs a particular one uses the snapshot tool, which the list above
    // says so.
    const snap = await snapshotOrExplain(projection);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ projection, seq: snap.seq, state: snap.state }),
        },
      ],
    };
  });

  /** One held subscription per subscribed URI. */
  const held = new Map<string, HeldSubscription>();

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (held.has(uri)) return {};
    // THE SLOT GOES IN BEFORE THE AWAIT. See HeldSubscription: the manifest
    // read below is a window a second subscribe can run through, and two
    // subscriptions for one URI means one of them is never released.
    const slot: HeldSubscription = { release: null, cancelled: false };
    held.set(uri, slot);

    let projection: string;
    try {
      projection = await projectionOf(uri);
    } catch (err) {
      // A URI that names no projection leaves nothing behind: the reservation
      // must go, or the next (correct) subscribe for it would be told it is
      // already held.
      if (held.get(uri) === slot) held.delete(uri);
      throw err;
    }
    // An unsubscribe that arrived while the manifest was being read has
    // already had its answer; opening a subscription now would be a
    // subscription nobody asked for and nobody holds the handle to.
    if (slot.cancelled) return {};

    // The first callback is the subscription being answered with the state
    // that was already there — not an update, and notifying on it would tell
    // the session something changed the moment it asked whether anything had.
    let opened = false;
    slot.release = client.subscribe(projection, {}, () => {
      if (!opened) {
        opened = true;
        return;
      }
      if (slot.cancelled) return;
      // Best-effort: a notification that cannot be sent (the session went
      // away mid-push) must not take the push path down with it.
      void server.sendResourceUpdated({ uri }).catch(() => {});
    });
    return {};
  });

  server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const slot = held.get(request.params.uri);
    if (slot) {
      held.delete(request.params.uri);
      slot.cancelled = true;
      slot.release?.();
    }
    return {};
  });

  return {
    server,
    refresh,
    close: async () => {
      for (const slot of held.values()) {
        slot.cancelled = true;
        slot.release?.();
      }
      held.clear();
      await server.close();
    },
  };
}
