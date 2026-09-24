// The MCP server against a real app, in process.
//
// The SDK's InMemoryTransport puts a `Client` and this package's `Server` on
// two ends of one linked pair, so every assertion below travels the whole
// JSON-RPC path — request shape, handler, result validation — without a pipe
// or a child process. Underneath it is a REAL app — the grill example — on
// `listen(0)` over a fixture directory, because the two criteria this file
// carries are about an app's own manifest (AC3) and an app's own records
// (AC4), and a stub of either would be this file agreeing with itself.
//
// `createGrillApp` is imported here as a devDependency, test-only; `src/`
// here imports @loupe/client and @loupe/protocol only.
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError, ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { wsClient } from '@loupe/client';
import {
  ERROR_CODES,
  zAppDescriptor,
  zVerbOk,
  type AppDescriptor,
  type ConnectionState,
  type Json,
  type JsonObject,
  type LoupeClient,
  type VerbResult,
} from '@loupe/protocol';
import { defineApp } from '@loupe/serve';
import { createGrillApp } from 'loupe-grill/src/app.ts';
import { DEFAULT_AWAIT_TIMEOUT_MS, parseArgs } from '../src/args.ts';
import {
  AWAIT_TOOL,
  ReservedVerbNameError,
  SETTLE_MS,
  SNAPSHOT_TOOL,
  awaitRecords,
  createLoupeMcp,
} from '../src/server.ts';

/** Three open questions in round 1 — what an agent grilling a plan asked. */
const QUESTIONS = ['q-a', 'q-b', 'q-c'].map((id, i) => ({
  id,
  round: 1,
  title: `question ${id}`,
  body: `why ${id}?`,
  recommendation: `keep ${id}`,
  options: i === 0 ? [{ id: 'x', label: 'drop it' }] : [],
  actor: 'Reviewer-42',
  at: '2026-08-29T04:28:43Z',
}));

function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loupe-mcp-'));
  writeFileSync(join(dir, 'questions.jsonl'), QUESTIONS.map((q) => JSON.stringify(q)).join('\n') + '\n');
  return dir;
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * Every `LoupeClient` call the server makes, counted, and the first
 * subscription frame turned into a promise.
 *
 * COUNTING IS THE ONLY WAY TO SEE A LEAK. A subscription that was opened and
 * never released behaves identically to one that was never opened, from
 * outside: nothing arrives either way. The two assertions that matter here —
 * two concurrent `resources/subscribe` open ONE subscription, and a cancelled
 * `await` releases the ones it opened — are both invisible without these
 * numbers.
 *
 * `opened` exists for the other kind of invisibility. The subscribe path must
 * NOT notify on the frame that answers the subscription, and "no notification
 * arrived" is only evidence if the frame it would have come from has already
 * been delivered; a fixed sleep guesses at that, this waits for it.
 */
interface Instrumented {
  client: LoupeClient;
  stats: { subscribes: number; disposes: number; recordSubs: number; recordDisposes: number };
  opened: Promise<void>;
}

function instrument(inner: LoupeClient, describeGate?: Promise<void>): Instrumented {
  const stats = { subscribes: 0, disposes: 0, recordSubs: 0, recordDisposes: 0 };
  let resolveOpened!: () => void;
  const opened = new Promise<void>((resolve) => {
    resolveOpened = resolve;
  });
  /** Released once, counted once — the server's close() and unsubscribe can overlap. */
  const once = (off: () => void, count: () => void): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      count();
      off();
    };
  };
  const client: LoupeClient = {
    describe: async () => {
      // A gate, not a sleep. `resources/subscribe` reads the manifest before
      // it knows what a URI names, and the races worth testing all live
      // inside that read; holding it open until the test says so makes those
      // races a decision rather than a guess about the scheduler's mood.
      if (describeGate !== undefined) await describeGate;
      return inner.describe();
    },
    snapshot: (projection, params) => inner.snapshot(projection, params),
    dispatch: (verb, params) => inner.dispatch(verb, params),
    subscribe: (projection, params, cb) => {
      stats.subscribes += 1;
      const off = inner.subscribe(projection, params, (seq, state) => {
        resolveOpened();
        cb(seq, state);
      });
      return once(off, () => (stats.disposes += 1));
    },
    records: (stream, after, cb) => {
      stats.recordSubs += 1;
      const off = inner.records(stream, after, cb);
      return once(off, () => (stats.recordDisposes += 1));
    },
    ...(inner.connection !== undefined ? { connection: inner.connection.bind(inner) } : {}),
  };
  return { client, stats, opened };
}

interface Harness {
  base: string;
  /** The fixture app's directory — where `answers.jsonl` is appended. */
  dir: string;
  /** The MCP client — the loupe one underneath it is reachable only as counters. */
  client: Client;
  stats: Instrumented['stats'];
  opened: Instrumented['opened'];
}

interface StartOptions {
  /** Passed to `wsClient`, which sends it as `X-Loupe-Actor` on every dispatch. */
  actor?: string;
  /** Held in front of every `describe()` the server makes. See `instrument`. */
  describeGate?: Promise<void>;
}

/** A promise and the button that resolves it, for the gate above. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * The grill app on an ephemeral port, a wsClient at it, this package's server, and
 * an SDK client on the other end of an in-memory pair. The MCP server is
 * always built with the SHIPPED default timeout, so the `await` tool's
 * description carries the real number; every test that blocks passes its own
 * `timeoutMs` rather than waiting two minutes for the default.
 */
async function start(opts: StartOptions = {}): Promise<Harness & { descriptor: AppDescriptor }> {
  const dir = makeFixtureDir();
  const app = createGrillApp(dir);
  await app.listen(0);
  const base = `http://127.0.0.1:${app.port()}`;
  const loupe = wsClient(base, { pollMs: 50, ...(opts.actor !== undefined ? { actor: opts.actor } : {}) });
  const instrumented = instrument(loupe, opts.describeGate);
  const mcp = createLoupeMcp({
    client: instrumented.client,
    awaitTimeoutMs: DEFAULT_AWAIT_TIMEOUT_MS,
    appUrl: base,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'loupe-mcp-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const descriptor = zAppDescriptor.parse(await (await fetch(`${base}/loupe/app`)).json());
  return { ...instrumented, base, dir, client, descriptor };
}

/**
 * The same server in front of a port nothing is listening on. Port 1 needs
 * root to bind, so nothing in CI or on a laptop can accidentally be there;
 * a connection to it is refused immediately rather than hanging.
 */
async function startDead(): Promise<{ base: string; client: Client }> {
  const base = 'http://127.0.0.1:1';
  const mcp = createLoupeMcp({ client: wsClient(base, { pollMs: 50 }), appUrl: base });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'loupe-mcp-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
  });
  return { base, client };
}

/** The manifest of an app built before the record wire existed (R1). */
const ANTIQUE: AppDescriptor = {
  protocol: 1,
  app: { name: 'antique app', version: '0.0.1' },
  projections: [{ name: 'things' }],
  verbs: [
    {
      name: 'thing.do',
      description: 'do a thing',
      params: { type: 'object', properties: {}, additionalProperties: false },
      records: [{ stream: 'things.jsonl' }],
    },
  ],
  capabilities: { ws: false },
};

/**
 * An app that answers `/loupe/app` and `/loupe/state/…` and 404s everything
 * else — which is exactly what a loupe app older than this track's R1 looks
 * like from outside. It is a handwritten http server rather than a
 * `@loupe/serve` app because the point is a route that DOES NOT EXIST, and
 * the harness has no way to not have it.
 */
async function startNoRecordWire(): Promise<{ base: string; client: Client }> {
  const http: HttpServer = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const send = (status: number, body: Json): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (path === '/loupe/app') return send(200, ANTIQUE as unknown as Json);
    if (path === '/loupe/state/things') return send(200, { projection: 'things', seq: 7, state: { ok: true } });
    return send(404, { ok: false, error: { code: 'not_found', message: `no route for ${path}` } });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const mcp = createLoupeMcp({ client: wsClient(base, { pollMs: 50 }), appUrl: base });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'loupe-mcp-test', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
  cleanups.push(async () => {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { base, client };
}

/**
 * A `LoupeClient` with no app behind it at all: every record is emitted by
 * the test, on the tick the test chooses. The two things it exists to measure
 * — the deadline arriving with records already in hand, and a cancellation
 * releasing subscriptions — are both about the WIDTH OF A WINDOW measured in
 * single-digit milliseconds, which no real socket can be asked to hit.
 */
interface FakeClient {
  client: LoupeClient;
  emit: (stream: string, seq: number, record: JsonObject | null) => void;
  setConnection: (state: ConnectionState) => void;
  stats: { recordSubs: number; recordDisposes: number };
}

function fakeClient(descriptor: AppDescriptor = ANTIQUE): FakeClient {
  const listeners = new Map<string, Set<(seq: number, record: JsonObject | null, stream: string) => void>>();
  const connections = new Set<(state: ConnectionState) => void>();
  let state: ConnectionState = 'connected';
  const stats = { recordSubs: 0, recordDisposes: 0 };
  const client: LoupeClient = {
    describe: () => Promise.resolve(descriptor),
    snapshot: () => Promise.resolve({ seq: 0, state: null as Json }),
    subscribe: () => () => {},
    dispatch: (): Promise<VerbResult> => Promise.resolve({ ok: true, seq: 0, records: [] }),
    connection: (cb) => {
      connections.add(cb);
      cb(state);
      return () => connections.delete(cb);
    },
    records: (stream, _after, cb) => {
      stats.recordSubs += 1;
      const set = listeners.get(stream) ?? new Set();
      set.add(cb);
      listeners.set(stream, set);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        stats.recordDisposes += 1;
        set.delete(cb);
      };
    },
  };
  return {
    client,
    stats,
    emit: (stream, seq, record) => {
      for (const cb of [...(listeners.get(stream) ?? [])]) cb(seq, record, stream);
    },
    setConnection: (next) => {
      state = next;
      for (const cb of [...connections]) cb(next);
    },
  };
}

/** A dispatch that is NOT the MCP server's — AC4's "from a second connection". */
async function dispatch(base: string, verb: string, params: Json): Promise<number> {
  const res = await fetch(`${base}/loupe/verbs/${encodeURIComponent(verb)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params }),
  });
  return zVerbOk.parse(await res.json()).seq;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The one text block every tool result carries, parsed. Narrowed with zod
 * rather than a cast, because "the result had exactly one text block" is one
 * of the things this file is asserting and a cast would assume it.
 */
const zTextResult = z.looseObject({
  isError: z.boolean().optional(),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
});

function toolJson(result: unknown): Record<string, Json> {
  const parsed = zTextResult.parse(result);
  expect(parsed.isError).toBeFalsy();
  expect(parsed.content).toHaveLength(1);
  expect(parsed.content[0]!.type).toBe('text');
  return JSON.parse(parsed.content[0]!.text!) as Record<string, Json>;
}

interface AwaitAnswer {
  records: Array<{ stream: string; seq: number; record: Record<string, Json> }>;
  seq: number;
  timedOut?: boolean;
  unreachable?: boolean;
  noRecordWire?: boolean;
  note?: string;
}

async function callAwait(
  client: Client,
  args: { streams: string[]; after?: number; timeoutMs: number },
): Promise<AwaitAnswer> {
  return toolJson(await client.callTool({ name: AWAIT_TOOL, arguments: args })) as unknown as AwaitAnswer;
}

describe('the tool list is the manifest, and nothing this server invented (AC3)', () => {
  it('names every verb plus snapshot and await, with each inputSchema the manifest’s params verbatim', async () => {
    const { client, descriptor } = await start();

    // The vacuity floor is the app's own verb count. A manifest that came
    // back empty would make every "equals" below trivially true.
    expect(descriptor.verbs.length).toBeGreaterThanOrEqual(4);

    const { tools } = await client.listTools();
    const expected = [...descriptor.verbs.map((v) => v.name), SNAPSHOT_TOOL, AWAIT_TOOL].sort();
    expect(tools.map((t) => t.name).sort()).toEqual(expected);

    let compared = 0;
    for (const verb of descriptor.verbs) {
      const tool = tools.find((t) => t.name === verb.name);
      expect(tool, `no tool for verb ${verb.name}`).toBeDefined();
      expect(tool!.inputSchema).toEqual(verb.params);
      expect(tool!.description).toEqual(verb.description);
      compared += 1;
    }
    // Same reason as the floor above, one level down: a loop that matched no
    // tool would compare nothing and pass.
    expect(compared).toBe(descriptor.verbs.length);

    // The await tool's description states the default it will actually use
    // (R3: "a served constant the tool description states").
    const awaitTool = tools.find((t) => t.name === AWAIT_TOOL)!;
    expect(awaitTool.description).toContain(String(DEFAULT_AWAIT_TIMEOUT_MS));
    expect(tools.find((t) => t.name === SNAPSHOT_TOOL)!.inputSchema.required).toEqual(['projection']);
  });

  it('a refused dispatch is the app’s own {ok:false}, carried as a tool result and not an MCP error', async () => {
    const { client } = await start();

    // POSITIVE CONTROL: the same tool, well-formed, succeeds. Without it an
    // `ok: false` below could be the dispatch path being broken rather than
    // the app refusing.
    const good = toolJson(
      await client.callTool({ name: 'question.answer', arguments: { question_id: 'q-b', choice: 'recommended' } }),
    );
    expect(good['ok']).toBe(true);

    const refused = await client.callTool({
      name: 'question.answer',
      arguments: { question_id: 'q-a', choice: 'maybe' },
    });
    // No MCP error, and `isError` unset: the model must read the app's code
    // and sentence, which a protocol failure would erase.
    expect(refused.isError).toBeFalsy();
    const body = toolJson(refused) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    // The app's OWN code, named: `choice: "maybe"` fails the verb's declared
    // param schema, and the harness answers `invalid_params`. Asserting only
    // that some non-empty string arrived would pass for `internal`, which is
    // the answer this path must never give.
    expect(body.error.code).toBe(ERROR_CODES.invalidParams);
    expect(body.error.message).toContain('choice');
  });

  it('a tool the app has no verb for is an MCP error, because it is not a refusal', async () => {
    const { client } = await start();
    await expect(client.callTool({ name: 'question.explode', arguments: {} })).rejects.toThrow(/no verb named/);
  });
});

describe('await returns on the record and not before (AC4)', () => {
  it('an await opened before a dispatch returns that one record and its seq', async () => {
    const { base, client } = await start();

    const pending = callAwait(client, { streams: ['answers.jsonl'], after: 0, timeoutMs: 4000 });
    // Long enough for the subscription's socket to be up; correctness does
    // not depend on it — the client's resync asks the poll twin from the
    // cursor on every open — but the test should exercise the live path.
    await sleep(250);

    const started = Date.now();
    const seq = await dispatch(base, 'question.answer', {
      question_id: 'q-a',
      choice: 'other',
      note: 'which revision does this refer to?',
    });
    const answer = await pending;
    expect(Date.now() - started).toBeLessThan(2000);

    expect(answer.timedOut).toBeUndefined();
    expect(answer.records).toHaveLength(1);
    expect(answer.records[0]!.stream).toBe('answers.jsonl');
    expect(answer.records[0]!.record['question_id']).toBe('q-a');
    expect(answer.records[0]!.record['choice']).toBe('other');
    // The seq the dispatcher was answered is the seq the subscriber hears.
    expect(answer.records[0]!.seq).toBe(seq);
    expect(answer.seq).toBe(seq);

    // And from that seq, the same record does not arrive twice: the second
    // await hears nothing and SAYS SO (R7 — no empty surface is silent).
    const quietStarted = Date.now();
    const quiet = await callAwait(client, { streams: ['answers.jsonl'], after: seq, timeoutMs: 500 });
    expect(Date.now() - quietStarted).toBeGreaterThanOrEqual(450);
    expect(quiet.timedOut).toBe(true);
    expect(quiet.records).toEqual([]);
    expect(quiet.seq).toBe(seq);
    expect(quiet.note).toContain('nothing landed on answers.jsonl');
    expect(quiet.note).toContain('500 ms');
    expect(quiet.note).toContain('snapshot');
    // POSITIVE CONTROL for the unreachable answer below: a live app's quiet
    // round says quiet, and nothing else. Without this the `unreachable` flag
    // could be set on every timeout and its own test would still pass.
    expect(quiet.unreachable).toBeUndefined();
  });

  it('two answers during one open await are both in the one return', async () => {
    const { base, client } = await start();

    const pending = callAwait(client, { streams: ['answers.jsonl'], after: 0, timeoutMs: 4000 });
    await sleep(250);
    await Promise.all([
      dispatch(base, 'question.answer', { question_id: 'q-a', choice: 'recommended' }),
      dispatch(base, 'question.answer', { question_id: 'q-b', choice: 'recommended' }),
    ]);

    const answer = await pending;
    expect(answer.timedOut).toBeUndefined();
    expect(answer.records).toHaveLength(2);
    expect(answer.records.map((r) => r.record['question_id']).sort()).toEqual(['q-a', 'q-b']);
    // The head is the later of the two, which is what the next await passes.
    expect(answer.seq).toBe(Math.max(...answer.records.map((r) => r.seq)));
  });

  it('POSITIVE CONTROL: with nothing dispatched, the await blocks and then times out', async () => {
    const { client } = await start();
    const started = Date.now();
    const answer = await callAwait(client, { streams: ['questions.jsonl'], after: 0, timeoutMs: 600 });
    // An implementation that returned immediately with an empty array would
    // pass every assertion below except this one.
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
    expect(answer.timedOut).toBe(true);
    expect(answer.records).toEqual([]);
    expect(answer.note).toContain('questions.jsonl');
  });

  it('await hears every named stream, not just the first', async () => {
    const { base, client } = await start();
    // A standing answer first, so the catch-up has something to deliver.
    await dispatch(base, 'question.answer', { question_id: 'q-c', choice: 'recommended' });

    const pending = callAwait(client, {
      streams: ['answers.jsonl', 'questions.jsonl'],
      after: 0,
      timeoutMs: 4000,
    });
    const answer = await pending;
    // The answer above is already in the ring, so the catch-up delivers
    // it; then a question on the OTHER named stream is heard live.
    expect(answer.records.some((r) => r.stream === 'answers.jsonl')).toBe(true);

    const seq = answer.seq;
    const next = callAwait(client, {
      streams: ['answers.jsonl', 'questions.jsonl'],
      after: seq,
      timeoutMs: 4000,
    });
    await sleep(250);
    await dispatch(base, 'question.ask', {
      id: 'q-d', round: 2, title: 'is the file generated?', body: '', recommendation: 'yes',
    });
    const heard = await next;
    expect(heard.timedOut).toBeUndefined();
    expect(heard.records).toHaveLength(1);
    expect(heard.records[0]!.stream).toBe('questions.jsonl');
    expect(heard.records[0]!.record['title']).toBe('is the file generated?');
  });
});

describe('projections are resources, and snapshot is the tool that names params', () => {
  it('every projection is a resource, and reading one is the envelope', async () => {
    const { client, descriptor } = await start();
    expect(descriptor.projections.length).toBeGreaterThanOrEqual(1);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(
      descriptor.projections.map((p) => `loupe://grill/state/${p.name}`).sort(),
    );

    const read = await client.readResource({ uri: 'loupe://grill/state/board' });
    expect(read.contents).toHaveLength(1);
    // Text, not blob: the same narrow-don't-assume rule as toolJson.
    const body = z.looseObject({ uri: z.string(), text: z.string() }).parse(read.contents[0]);
    expect(body.uri).toBe('loupe://grill/state/board');
    const envelope = JSON.parse(body.text) as {
      projection: string;
      seq: number;
      state: { summary?: string };
    };
    expect(envelope.projection).toBe('board');
    expect(typeof envelope.seq).toBe('number');
    // The app's own sentence, which an agent should read rather than count
    // from `questions`. Its exact words, not just its type: the fixture has
    // three questions and nothing answered, and a `summary` that came back
    // as the empty string would satisfy `typeof … === 'string'` while saying
    // nothing at all — the one failure R7 exists to forbid.
    expect(envelope.state.summary).toBe('0 of 3 answered · round 1 open');
  });

  it('the snapshot tool carries params a resource URI cannot', async () => {
    // grill's one projection takes no params, so this is an in-test app whose
    // projection echoes the params it was derived under.
    const echo = defineApp({
      name: 'echo',
      version: '0.0.0',
      store: {},
      projections: { echo: { params: ['round'], derive: (_s, params) => ({ round: params['round'] ?? null }) } },
      verbs: {},
    });
    await echo.listen(0);
    const base = `http://127.0.0.1:${echo.port()}`;
    const mcp = createLoupeMcp({ client: wsClient(base, { pollMs: 50 }), appUrl: base });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'loupe-mcp-test', version: '0.0.0' }, { capabilities: {} });
    await Promise.all([mcp.server.connect(serverSide), client.connect(clientSide)]);
    cleanups.push(async () => {
      await client.close();
      await mcp.close();
      await echo.close();
    });
    const snap = toolJson(
      await client.callTool({ name: SNAPSHOT_TOOL, arguments: { projection: 'echo', params: { round: '1' } } }),
    ) as unknown as { projection: string; seq: number; state: { round: string | null } };
    expect(snap.projection).toBe('echo');
    expect(snap.state.round).toBe('1');
    // POSITIVE CONTROL: without params the same projection says so.
    const bare = toolJson(
      await client.callTool({ name: SNAPSHOT_TOOL, arguments: { projection: 'echo' } }),
    ) as unknown as { state: { round: string | null } };
    expect(bare.state.round).toBeNull();
  });

  it('a subscribed resource raises notifications/resources/updated when a verb changes it', async () => {
    const { base, client, opened } = await start();
    const uri = 'loupe://grill/state/board';
    const seen: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      seen.push(n.params.uri);
    });
    await client.subscribeResource({ uri });
    // The subscription's own opening state frame is not an update; only a
    // later push is. WAIT FOR THAT FRAME rather than guessing how long the
    // socket takes: `opened` resolves when the instrumented client hands the
    // server its first frame, so an empty `seen` after it is evidence the
    // frame did not notify, where an empty `seen` after a fixed 300 ms was
    // only evidence that 300 ms was sometimes enough. The `resources/read`
    // after it is a full round trip through the same pair, which flushes any
    // notification that was queued behind the frame.
    await opened;
    await client.readResource({ uri });
    expect(seen).toEqual([]);

    await dispatch(base, 'question.answer', { question_id: 'q-a', choice: 'recommended' });
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) await sleep(25);
    expect(seen).toEqual([uri]);

    await client.unsubscribeResource({ uri });
    await dispatch(base, 'question.answer', { question_id: 'q-b', choice: 'recommended' });
    // The change has to have been derivable before "not heard" means
    // anything, so read it back — the same round trip as above, and the
    // projection's seq has moved by the time it answers.
    await client.readResource({ uri });
    await sleep(200);
    // Released, so the second change is not heard.
    expect(seen).toEqual([uri]);
  });

  it('an app name with a space is encoded into the URI, and reads back through it', async () => {
    // The fake app is called "antique app". Unencoded, its URI is not a URI:
    // `resources/list` would offer `loupe://antique app/state/things`, and a
    // client that normalised the space away would then be told it names no
    // projection — offered and unreadable in the same breath.
    const { client } = await startNoRecordWire();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['loupe://antique%20app/state/things']);

    const read = await client.readResource({ uri: 'loupe://antique%20app/state/things' });
    const body = z.looseObject({ uri: z.string(), text: z.string() }).parse(read.contents[0]);
    expect(JSON.parse(body.text)).toMatchObject({ projection: 'things', seq: 7 });

    // POSITIVE CONTROL: the unencoded spelling is refused, and the refusal
    // lists the real one — so the encoding is what made the read work.
    await expect(client.readResource({ uri: 'loupe://antique app/state/things' })).rejects.toThrow(
      /is not a projection of antique app/,
    );
  });

  it('an unsubscribe that arrives mid-subscribe is honoured, not lost', async () => {
    // THE RACE, held open rather than hoped for. `resources/subscribe` has to
    // read the manifest before it knows what the URI names, and an
    // `unsubscribe` that arrives during that read used to find an empty map
    // and do nothing — after which the subscribe resumed and opened a
    // subscription the client had already given up, held for the life of the
    // process with no handle anyone could reach.
    const held = gate();
    const { base, client, stats } = await start({ describeGate: held.promise });
    const uri = 'loupe://grill/state/board';
    const seen: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      seen.push(n.params.uri);
    });

    const subscribing = client.subscribeResource({ uri });
    // The handler is now parked inside the manifest read; the unsubscribe is
    // answered from in front of it.
    await client.unsubscribeResource({ uri });
    held.open();
    await subscribing;

    // Opened and released, or never opened — either is honest. What must not
    // be true is one held with nobody holding the handle.
    expect(stats.subscribes - stats.disposes).toBe(0);

    await dispatch(base, 'question.answer', { question_id: 'q-a', choice: 'recommended' });
    // A full round trip through the same pair, so a notification queued
    // behind it would have arrived by the assertion.
    await client.readResource({ uri });
    await sleep(400);
    expect(seen).toEqual([]);

    // POSITIVE CONTROL: subscribing again — with the gate now open — does
    // hear the next change, so the silence above is the unsubscribe and not a
    // push path that never worked.
    await client.subscribeResource({ uri });
    await sleep(300);
    await dispatch(base, 'question.answer', { question_id: 'q-b', choice: 'recommended' });
    const heard = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < heard) await sleep(25);
    expect(seen).toEqual([uri]);
  });

  it('two concurrent subscribes open one subscription, and unsubscribing releases it', async () => {
    // Both handlers are parked in the manifest read at the same time, which
    // is as concurrent as one event loop gets.
    const held = gate();
    const { base, client, stats, opened } = await start({ describeGate: held.promise });
    const uri = 'loupe://grill/state/board';
    const seen: string[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      seen.push(n.params.uri);
    });

    const both = Promise.all([client.subscribeResource({ uri }), client.subscribeResource({ uri })]);
    held.open();
    await both;
    expect(stats.subscribes).toBe(1);
    await opened;

    // POSITIVE CONTROL, and it comes FIRST on purpose: the one subscription
    // the pair opened is live and does notify, so the silence at the end is
    // the release and not a subscription that never worked.
    await dispatch(base, 'question.answer', { question_id: 'q-a', choice: 'recommended' });
    const deadline = Date.now() + 3000;
    while (seen.length === 0 && Date.now() < deadline) await sleep(25);
    expect(seen).toEqual([uri]);

    await client.unsubscribeResource({ uri });
    // One opened, one released: nothing is left holding a socket. Before the
    // slot was reserved ahead of the manifest read, this said two and one —
    // and the leaked one went on notifying below.
    expect(stats.subscribes).toBe(1);
    expect(stats.disposes).toBe(1);

    await dispatch(base, 'question.answer', { question_id: 'q-b', choice: 'recommended' });
    await client.readResource({ uri });
    await sleep(400);
    expect(seen).toEqual([uri]);
  });
});

describe('silence has two causes, and this server tells them apart', () => {
  it('an await against an app that is down answers unreachable and names the app', async () => {
    const { base, client } = await startDead();
    const answer = await callAwait(client, { streams: ['answers.jsonl'], after: 0, timeoutMs: 1500 });
    expect(answer.timedOut).toBe(true);
    expect(answer.unreachable).toBe(true);
    expect(answer.records).toEqual([]);
    // The sentence has to be actionable: which app, and that snapshotting is
    // not a way around it.
    expect(answer.note).toContain(base);
    expect(answer.note).toContain('not a quiet round');
    expect(answer.note).toMatch(/until it is up/);
  });

  it('tools/list against an app that is down is a sentence, not the SDK’s bare “fetch failed”', async () => {
    const { base, client } = await startDead();
    await expect(client.listTools()).rejects.toThrow(new RegExp(`could not read the manifest at ${base}/loupe/app`));
    await expect(client.listTools()).rejects.toThrow(/recovers on its own once the app is up/);
  });

  it('snapshot against an app that is down names the projection and the app', async () => {
    const { base, client } = await startDead();
    const failed = client.callTool({ name: SNAPSHOT_TOOL, arguments: { projection: 'board' } });
    await expect(failed).rejects.toThrow(/could not read projection board/);
    await expect(failed).rejects.toThrow(new RegExp(base.replace(/\./g, '\\.')));
  });

  it('an app with no /loupe/records route says so, in the description and in the answer', async () => {
    const { base, client } = await startNoRecordWire();

    // POSITIVE CONTROL that this fake app is a working app and not a broken
    // one: its manifest lists, and its projection reads.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([AWAIT_TOOL, SNAPSHOT_TOOL, 'thing.do'].sort());
    const snap = toolJson(await client.callTool({ name: SNAPSHOT_TOOL, arguments: { projection: 'things' } }));
    expect(snap['seq']).toBe(7);

    const awaitTool = tools.find((t) => t.name === AWAIT_TOOL)!;
    expect(awaitTool.description).toContain('NOT AVAILABLE ON THIS APP');
    expect(awaitTool.description).toContain('predates');

    // And the call does not block: an app that can never push must not cost
    // the agent its whole timeout to learn that.
    const started = Date.now();
    const answer = await callAwait(client, { streams: ['things.jsonl'], after: 3, timeoutMs: 4000 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(answer.noRecordWire).toBe(true);
    expect(answer.timedOut).toBe(true);
    expect(answer.records).toEqual([]);
    // The cursor is handed back unmoved, so a caller that loops does not
    // silently reset to 0.
    expect(answer.seq).toBe(3);
    expect(answer.note).toContain(base);
    expect(answer.note).toContain('404');

    // POSITIVE CONTROL: the real app, which HAS the route, says none of
    // this and does block.
    const real = await start();
    const realTool = (await real.client.listTools()).tools.find((t) => t.name === AWAIT_TOOL)!;
    expect(realTool.description).not.toContain('NOT AVAILABLE ON THIS APP');
    const realAnswer = await callAwait(real.client, { streams: ['answers.jsonl'], after: 0, timeoutMs: 400 });
    expect(realAnswer.noRecordWire).toBeUndefined();
  });
});

describe('awaitRecords, at the millisecond', () => {
  it('records in hand at the deadline are an answer, not a timeout', async () => {
    const fake = fakeClient();
    // Shorter than SETTLE_MS on purpose: the settle window cannot close
    // before the deadline does, so the ONLY path that can answer is the
    // deadline's "records in hand" branch.
    expect(5).toBeLessThan(SETTLE_MS);
    const pending = awaitRecords(fake.client, ['things.jsonl'], 0, 5);
    fake.emit('things.jsonl', 12, { hello: 'world' });
    const answer = await pending;
    expect(answer.timedOut).toBeUndefined();
    expect(answer.unreachable).toBeUndefined();
    expect(answer.records).toHaveLength(1);
    expect(answer.records[0]!.record).toEqual({ hello: 'world' });
    expect(answer.seq).toBe(12);

    // POSITIVE CONTROL: the same five milliseconds with nothing emitted IS a
    // timeout, so the assertion above is about the record and not about the
    // deadline never firing.
    const quiet = await awaitRecords(fake.client, ['things.jsonl'], 0, 5);
    expect(quiet.timedOut).toBe(true);
    expect(quiet.records).toEqual([]);
  });

  it('a stream named twice is listened to once, and its records arrive once', async () => {
    const fake = fakeClient();
    const pending = awaitRecords(fake.client, ['things.jsonl', 'things.jsonl'], 0, 400);
    expect(fake.stats.recordSubs).toBe(1);
    fake.emit('things.jsonl', 3, { id: 'only-once' });
    const answer = await pending;
    expect(answer.records).toHaveLength(1);
    expect(answer.seq).toBe(3);
    expect(answer.note).toBeUndefined();

    // POSITIVE CONTROL: two DIFFERENT streams really do open two
    // subscriptions, so the dedup above is dedup and not a cap of one.
    const two = fakeClient();
    const both = awaitRecords(two.client, ['a.jsonl', 'b.jsonl'], 0, 400);
    expect(two.stats.recordSubs).toBe(2);
    two.emit('a.jsonl', 1, { from: 'a' });
    two.emit('b.jsonl', 2, { from: 'b' });
    const heard = await both;
    expect(heard.records.map((r) => r.stream).sort()).toEqual(['a.jsonl', 'b.jsonl']);
  });

  it('a cancelled await releases its subscriptions instead of holding them to the deadline', async () => {
    const fake = fakeClient();
    const controller = new AbortController();
    // Two minutes is the shipped default; if cancellation did not release,
    // this test would hold two subscriptions for all of it.
    const pending = awaitRecords(fake.client, ['a.jsonl', 'b.jsonl'], 0, DEFAULT_AWAIT_TIMEOUT_MS, {
      signal: controller.signal,
      appUrl: 'http://127.0.0.1:6182',
    });
    expect(fake.stats.recordSubs).toBe(2);
    expect(fake.stats.recordDisposes).toBe(0);

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(McpError);
    await expect(pending).rejects.toThrow(/was cancelled/);
    expect(fake.stats.recordDisposes).toBe(2);

    // POSITIVE CONTROL: without the abort, the same call holds its
    // subscriptions — the release above is the cancellation's doing.
    const held = fakeClient();
    void awaitRecords(held.client, ['a.jsonl', 'b.jsonl'], 0, DEFAULT_AWAIT_TIMEOUT_MS);
    await sleep(20);
    expect(held.stats.recordDisposes).toBe(0);
  });

  it('a fake client with no connection observable keeps the quiet-round answer', async () => {
    // An unknown connection is not evidence of a bad one: a third-party
    // transport that does not implement `connection` must not have every
    // timeout relabelled as the app being down.
    const fake = fakeClient();
    const blind: LoupeClient = { ...fake.client };
    delete blind.connection;
    const answer = await awaitRecords(blind, ['a.jsonl'], 0, 20, { appUrl: 'http://127.0.0.1:6182' });
    expect(answer.timedOut).toBe(true);
    expect(answer.unreachable).toBeUndefined();
    expect(answer.note).toContain('quiet round');

    // POSITIVE CONTROL: the same client WITH the observable, reporting a lost
    // connection, does say unreachable.
    fake.setConnection('gone');
    const blamed = await awaitRecords(fake.client, ['a.jsonl'], 0, 20, { appUrl: 'http://127.0.0.1:6182' });
    expect(blamed.unreachable).toBe(true);
    expect(blamed.note).toContain('http://127.0.0.1:6182');
  });
});

describe('a tool call that cannot be honoured says which kind of failure it was', () => {
  it('malformed await arguments are InvalidParams, not the SDK’s InternalError', async () => {
    const { client } = await start();
    // POSITIVE CONTROL: the same tool with the required field parses.
    const ok = await callAwait(client, { streams: ['answers.jsonl'], after: 0, timeoutMs: 200 });
    expect(ok.timedOut).toBe(true);

    const failed = client.callTool({ name: AWAIT_TOOL, arguments: {} });
    await expect(failed).rejects.toBeInstanceOf(McpError);
    await expect(failed).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    // The issues, rendered: the model has to be told which field it missed.
    await expect(failed).rejects.toThrow(/streams/);
  });

  it('a manifest whose verb is called await is refused by type, so main.ts can exit on it', async () => {
    const reserved: AppDescriptor = {
      ...ANTIQUE,
      verbs: [{ name: AWAIT_TOOL, params: { type: 'object', properties: {}, additionalProperties: false } }],
    };
    const mcp = createLoupeMcp({ client: fakeClient(reserved).client });
    await expect(mcp.refresh()).rejects.toBeInstanceOf(ReservedVerbNameError);
    await expect(mcp.refresh()).rejects.toThrow(/would carry that name twice/);

    // POSITIVE CONTROL: the same app with an unreserved verb name refreshes,
    // so the refusal is about the NAME and not about this fake.
    const fine = createLoupeMcp({ client: fakeClient().client });
    await expect(fine.refresh()).resolves.toMatchObject({ app: { name: 'antique app' } });
  });
});

describe('the flags, and the .mcp.json that sets them', () => {
  const okArgs = ['--app', 'http://127.0.0.1:6182'];

  it('parses what a launcher sets and refuses what it cannot', () => {
    const cases: Array<{ what: string; argv: string[]; then: 'parses' | RegExp }> = [
      { what: 'the whole line', argv: [...okArgs, '--actor', 'Kelsier-1', '--await-timeout-ms', '30000'], then: 'parses' },
      { what: 'app alone', argv: okArgs, then: 'parses' },
      { what: 'no app', argv: ['--actor', 'Kelsier-1'], then: /--app is required/ },
      { what: 'an app that is not a URL', argv: ['--app', 'not a url'], then: /must be a base URL/ },
      // `new URL` accepts this one — as the scheme `localhost:` — so the
      // scheme check is what refuses it.
      { what: 'a host and port with no scheme', argv: ['--app', 'localhost:6182'], then: /over http or https/ },
      { what: 'a zero timeout', argv: [...okArgs, '--await-timeout-ms', '0'], then: /positive whole number/ },
      { what: 'a timeout that is not a number', argv: [...okArgs, '--await-timeout-ms', 'abc'], then: /positive whole number/ },
      { what: 'an actor with no value', argv: [...okArgs, '--actor'], then: /--actor needs a value/ },
      { what: 'an unknown flag', argv: [...okArgs, '--sign-as', 'Kelsier-1'], then: /unknown flag --sign-as/ },
      { what: 'an actor the app would silently ignore', argv: [...okArgs, '--actor', 'Kelsier 1'], then: /is not a name the app will accept/ },
      { what: 'an actor of 65 characters', argv: [...okArgs, '--actor', 'a'.repeat(65)], then: /is not a name the app will accept/ },
    ];
    let refused = 0;
    let accepted = 0;
    for (const { what, argv, then } of cases) {
      if (then === 'parses') {
        expect(() => parseArgs(argv), what).not.toThrow();
        accepted += 1;
      } else {
        expect(() => parseArgs(argv), what).toThrow(then);
        refused += 1;
      }
    }
    // The floor: a table that silently lost its rows would pass every
    // assertion above by running none of them.
    expect(accepted).toBe(2);
    expect(refused).toBe(cases.length - 2);

    // The values, not just the absence of a throw.
    expect(parseArgs([...okArgs, '--actor', 'Kelsier-1', '--await-timeout-ms', '30000'])).toEqual({
      app: 'http://127.0.0.1:6182',
      actor: 'Kelsier-1',
      awaitTimeoutMs: 30_000,
    });
    // No --actor is no header at all, which is the flag's whole point.
    expect(parseArgs(okArgs).actor).toBeNull();
    expect(parseArgs(okArgs).awaitTimeoutMs).toBe(DEFAULT_AWAIT_TIMEOUT_MS);
  });

  it('the README’s registration block launches this server, and its placeholder actor is refused', () => {
    const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
    const block = /## Registering it[\s\S]*?```json\n([\s\S]*?)```/.exec(readme);
    expect(block, 'README has a ```json block under "Registering it"').not.toBeNull();
    const config = z
      .object({
        mcpServers: z.record(z.string(), z.object({ command: z.string(), args: z.array(z.string()).optional() })),
      })
      .parse(JSON.parse(block![1]!));

    expect(Object.keys(config.mcpServers)).toEqual(['loupe-grill']);

    const entry = config.mcpServers['loupe-grill']!;
    expect(entry.command).toBe('pnpm');
    const argv = entry.args ?? [];
    // `exec`, not `run`: stdout is the wire and `pnpm run` prints a banner on it.
    expect(argv.slice(0, 5)).toEqual(['--filter', 'loupe-mcp', 'exec', 'tsx', 'src/main.ts']);
    const flags = argv.slice(5);

    // The entry as shipped MUST NOT start: its actor is a placeholder, and a
    // placeholder that parsed would be stamped into real records.
    expect(() => parseArgs(flags)).toThrow(/is not a name the app will accept/);
    expect(flags).toContain('<your-agent-name>');

    // POSITIVE CONTROL: the same line with a real actor is a working launch,
    // so the refusal above is about the placeholder and nothing else.
    const edited = flags.map((flag) => (flag === '<your-agent-name>' ? 'Kelsier-1' : flag));
    expect(parseArgs(edited)).toEqual({
      app: 'http://127.0.0.1:6182',
      actor: 'Kelsier-1',
      awaitTimeoutMs: DEFAULT_AWAIT_TIMEOUT_MS,
    });
  });
});

describe('the record an MCP dispatch writes is signed by the agent, not the human (R4)', () => {
  /** The last line of the app's answers.jsonl, as an object. */
  function lastAnswer(dir: string): Record<string, Json> {
    const lines = readFileSync(join(dir, 'answers.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    return JSON.parse(lines[lines.length - 1]!) as Record<string, Json>;
  }

  it('a tools/call over a client with --actor lands in the file as that actor', async () => {
    // The whole chain, end to end and nothing stubbed: the MCP server sends
    // X-Loupe-Actor because wsClient was given one, the app accepts it
    // because it declared `actors: 'header'` and this is loopback, and the
    // verb stamps ctx.actor into the record it appends.
    const { client, dir } = await start({ actor: 'Xosa-1' });
    const result = toolJson(
      await client.callTool({ name: 'question.answer', arguments: { question_id: 'q-a', choice: 'recommended' } }),
    );
    expect(result['ok']).toBe(true);

    const record = lastAnswer(dir);
    expect(record['question_id']).toBe('q-a');
    expect(record['actor']).toBe('Xosa-1');
  });

  it('POSITIVE CONTROL: the same call with no actor is stamped with the app’s own', async () => {
    // Without this, an `actor` field that simply echoed something the test
    // sent would pass above; here the app's configured actor (its name, by
    // default) is stamped and nothing in the MCP path can have produced it.
    const { client, dir } = await start();
    toolJson(await client.callTool({ name: 'question.answer', arguments: { question_id: 'q-a', choice: 'recommended' } }));
    expect(lastAnswer(dir)['actor']).toBe('grill');
  });
});
