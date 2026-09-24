// @loupe/serve — the app-side harness (§6.1). defineApp({name, version, store,
// projections, verbs}) → node HTTP+WS server implementing the wire contract
// (§5) exactly: manifest emission (zod→JSON Schema), per-(projection, params)
// seq bookkeeping, SNAPSHOT-ONLY push on store change, verb routing with zod
// validation, actor/at stamping, structured error envelopes, loopback binding,
// the record wire — every record a verb appends pushed to whoever subscribed
// to its stream, with a bounded ring behind a poll twin — and the one place
// a dispatcher may name itself: a loopback agent transport's X-Loupe-Actor,
// honoured only when the app opts in.
// Both adapters are ~their domain logic plus a defineApp call; the plumbing
// exists once, and a third-party TS app starts here.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  zClientFrame,
  zVerbRequest,
  ERROR_CODES,
  type AppDescriptor,
  type Json,
  type JsonObject,
  type PatchTemplate,
  type ProjectionEnvelope,
  type RecordsEnvelope,
  type ServerFrame,
  type VerbDecl,
  type VerbError,
  type VerbResult,
} from '@loupe/protocol';

export interface ProjectionConfig<Store> {
  /** Names of accepted query params. */
  params?: readonly string[];
  derive: (store: Store, params: Record<string, string>) => Json;
}

/**
 * The Jsonifiable seam: rewrites T with every non-JSON leaf (function,
 * symbol, bigint, undefined in required position) erased to `never`, so
 * `value: T & Jsonifiable<T>` typechecks exactly when T serializes losslessly
 * to JSON. This is what lets typed app data (interfaces included — they lack
 * the implicit index signature `Json` demands) cross into a projection
 * without an unchecked cast. Optional properties stay optional: omission is
 * valid JSON serialization.
 */
export type Jsonifiable<T> = T extends Json // already wire-shaped: stop recursing
  ? T
  : T extends undefined | symbol | bigint | ((...args: never) => unknown)
    ? never
    : T extends readonly unknown[] | object
      ? { [K in keyof T]: Jsonifiable<T[K]> }
      : never;

/**
 * Compile-time-checked bridge from typed app data to wire `Json` — THE one
 * boundary cast in the platform, proven safe by `Jsonifiable<T>` above.
 * Identity at runtime.
 */
export function toJson<T>(value: T & Jsonifiable<T>): Json {
  return value as unknown as Json;
}

export interface VerbContext {
  /**
   * Server-stamped actor. A fabrial's client never sends identity; a loopback
   * agent transport may, and the app must opt in (`actors: 'header'`).
   */
  actor: string;
  /** Server-stamped UTC ISO timestamp. */
  at: string;
}

export interface VerbConfig<Store, Schema extends z.ZodType = z.ZodType> {
  description?: string;
  params: Schema;
  optimistic?: PatchTemplate[];
  records?: Array<{ stream: string }>;
  /**
   * Domain logic — `params` arrives already validated and typed by the verb's
   * zod schema. On `{ok: true}` results the harness re-derives every live
   * projection, bumps seqs, pushes snapshots, and OVERWRITES `seq` with the
   * authoritative post-execution value — return `seq: 0` and let the harness
   * fill it in.
   */
  // Method syntax (not a function property) so a specifically-typed verb
  // widens to VerbConfig<Store> for the harness internals.
  execute(params: z.output<Schema>, ctx: VerbContext, store: Store): VerbResult | Promise<VerbResult>;
}

export interface DefineAppConfig<
  Store,
  Schemas extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  name: string;
  version: string;
  store: Store;
  projections: Record<string, ProjectionConfig<Store>>;
  /**
   * Each verb keyed by name. The mapped type lets defineApp infer every
   * verb's params schema, so `execute` sees its own typed params — no
   * annotations (and no `any`) at the app-author surface.
   */
  verbs: { [K in keyof Schemas]: VerbConfig<Store, Schemas[K]> };
  /** Server-stamped actor. Defaults to the app `name`. */
  actor?: string;
  /**
   * Who may say who they are (track "the agent inhabits the same state",
   * R4). Unset, every dispatch is stamped with `actor` above, whatever the
   * request claims. `'header'` lets a dispatch arriving over LOOPBACK name
   * its actor in `X-Loupe-Actor` — the seam an agent process on the same
   * machine signs its own records through — and a header from anywhere
   * else, or one that is not a plain name (`[A-Za-z0-9._-]`, at most 64),
   * is ignored rather than refused: identity is transport, never params,
   * and a stranger's claim costs the app nothing but the configured name.
   */
  actors?: 'header';
  /**
   * How many records the harness holds per stream, in process memory, behind
   * `GET /loupe/records/:stream?after=seq` (default 256). A poller whose
   * `after` predates what the ring still holds is answered 410 and
   * re-snapshots; the files are the history, this is a wake-up channel.
   */
  recordRing?: number;
}

export interface LoupeAppServer {
  /** Serve an app-relative request on a caller-owned HTTP server. */
  handle: (req: IncomingMessage, res: ServerResponse) => void;
  /** Upgrade only app-relative /loupe/ws on the original request socket. */
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  listen: (port: number, host?: string) => Promise<void>;
  close: () => Promise<void>;
  /** Signal that the store changed: re-derive, bump seqs, push snapshots. */
  touch: () => void;
  /** The bound port (useful with listen(0) in tests). */
  port: () => number;
}

/**
 * A name a record can carry: non-empty, at most 64 characters, drawn from
 * `[A-Za-z0-9._-]` — the alphabet agent and user handles (`Vin-204811`,
 * `ada`) already live in. Anything else is not an actor and is not
 * stamped.
 */
const ACTOR_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/** The three spellings of "this machine" a node socket reports. */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The whole of the transport half of the actor gate: is the peer this
 * machine? Exported because it is the one rule here that can be checked
 * without a network — a test for it otherwise needs a machine with a
 * non-loopback address to bind on, and a machine without one gets no test at
 * all. `undefined` (a socket already gone) is not this machine.
 */
export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_ADDRESSES.has(remoteAddress);
}

/** Canonical cache key for a (projection, params) pair. */
function projectionKey(projection: string, params: Record<string, string>): string {
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${projection}?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

function verbParamsJsonSchema(schema: z.ZodType): JsonObject {
  const doc = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as JsonObject;
  delete doc['$schema'];
  return doc;
}

interface LiveProjection {
  projection: string;
  params: Record<string, string>;
  seq: number;
  state: Json;
  /** Serialized state for change detection (seq bumps only on real change). */
  json: string;
}

interface Subscription {
  key: string;
  projection: string;
  params: Record<string, string>;
}

/** One record as the ring holds it: the seq the dispatch was answered with. */
interface HeldRecord {
  seq: number;
  /** An object, like every record on the wire — see zWrittenRecord. */
  record: JsonObject;
}

/**
 * The per-stream ring. `evicted` is the seq of the newest record the bound
 * pushed out — the line a poller's `after` must be at or past to be answered
 * in full. A ring that has never overflowed has nothing to refuse.
 */
interface StreamRing {
  items: HeldRecord[];
  evicted: number | null;
}

export function defineApp<Store, Schemas extends Record<string, z.ZodType>>(
  config: DefineAppConfig<Store, Schemas>,
): LoupeAppServer {
  const actor = config.actor ?? config.name;
  const DEFAULT_RECORD_RING = 256;
  const ringSize = Math.max(1, Math.floor(config.recordRing ?? DEFAULT_RECORD_RING));
  // Erase the per-verb schema types for the harness internals (safe: each
  // verb's execute is only ever called with its own schema's parse output).
  const verbs: Record<string, VerbConfig<Store>> = config.verbs;
  // Single monotonic counter feeding every projection's seq: per-projection
  // seqs stay monotonic and any pushed seq is comparable to a verb response
  // seq (the optimistic-overlay discard rule in §5.4 step 4).
  let globalSeq = 0;
  const live = new Map<string, LiveProjection>();
  const subs = new Map<WebSocket, Map<string, Subscription>>();
  // The stream side of a socket: the names it asked for by `{t:'sub', stream}`.
  // Kept beside the projection map rather than inside it because the two are
  // keyed differently (a stream has no params) and answered differently (a
  // stream sub is answered with nothing until a verb appends).
  const streamSubs = new Map<WebSocket, Set<string>>();
  const rings = new Map<string, StreamRing>();

  const verbDecls: VerbDecl[] = Object.entries(verbs).map(([name, verb]) => ({
    name,
    ...(verb.description !== undefined ? { description: verb.description } : {}),
    params: verbParamsJsonSchema(verb.params),
    ...(verb.optimistic !== undefined ? { optimistic: verb.optimistic } : {}),
    ...(verb.records !== undefined ? { records: verb.records } : {}),
  }));

  const descriptor: AppDescriptor = {
    protocol: PROTOCOL_VERSION,
    app: { name: config.name, version: config.version },
    projections: Object.entries(config.projections).map(([name, proj]) => ({
      name,
      ...(proj.params !== undefined ? { params: [...proj.params] } : {}),
    })),
    verbs: verbDecls,
    capabilities: { ws: true },
  };

  /** Derive (or re-derive) one projection; bump seq only when the state changed. */
  function deriveInto(projection: string, params: Record<string, string>): LiveProjection {
    const key = projectionKey(projection, params);
    const proj = config.projections[projection];
    if (!proj) throw new Error(`unknown projection ${projection}`);
    const state = proj.derive(config.store, params);
    const json = JSON.stringify(state);
    const existing = live.get(key);
    if (existing && existing.json === json) return existing;
    const entry: LiveProjection = {
      projection,
      params,
      seq: ++globalSeq,
      state,
      json,
    };
    live.set(key, entry);
    return entry;
  }

  function pushSnapshots(): void {
    for (const [socket, bySub] of subs) {
      for (const sub of bySub.values()) {
        const entry = live.get(sub.key);
        if (!entry) continue;
        sendFrame(socket, stateFrame(entry));
      }
    }
  }

  function touch(): void {
    rederive();
  }

  /**
   * Snapshot-only push: re-derive every live (projection, params) and stamp
   * every entry that changed with ONE shared seq. handleVerb answers
   * globalSeq, so each changed projection's pushed frame must carry a seq
   * >= the response seq or the renderer's optimistic-overlay confirm rule
   * (§5.4 step 4) could never fire from the push. A verb that appended
   * records reserves that seq BEFORE calling this (`withSeq`), so the
   * snapshots, the response and the record frames all carry one number
   * even when no projection changed.
   */
  function rederive(withSeq?: number): void {
    const changed: Array<Omit<LiveProjection, 'seq'> & { key: string }> = [];
    for (const entry of [...live.values()]) {
      const proj = config.projections[entry.projection];
      if (!proj) continue;
      try {
        const state = proj.derive(config.store, entry.params);
        const json = JSON.stringify(state);
        if (json !== entry.json) {
          changed.push({
            key: projectionKey(entry.projection, entry.params),
            projection: entry.projection,
            params: entry.params,
            state,
            json,
          });
        }
      } catch {
        // A projection that throws on re-derive keeps its last good snapshot.
      }
    }
    if (changed.length > 0) {
      const batchSeq = withSeq ?? ++globalSeq;
      for (const { key, ...rest } of changed) live.set(key, { ...rest, seq: batchSeq });
    }
    pushSnapshots();
  }

  /**
   * The record wire (track "the agent inhabits the same state", R1). Each
   * record a verb appended goes into its stream's ring, bounded to `ringSize`
   * with the oldest dropped first, and out as a `record` frame to every
   * socket subscribed to that stream. Called after the snapshots so a record
   * frame never precedes the state it caused on any one socket.
   */
  function publishRecords(records: ReadonlyArray<{ stream: string; record: JsonObject }>, seq: number): void {
    for (const { stream, record } of records) {
      let ring = rings.get(stream);
      if (!ring) {
        ring = { items: [], evicted: null };
        rings.set(stream, ring);
      }
      ring.items.push({ seq, record });
      while (ring.items.length > ringSize) ring.evicted = ring.items.shift()!.seq;
      const frame: ServerFrame = { t: 'record', stream, record, seq };
      for (const [socket, streams] of streamSubs) {
        if (streams.has(stream)) sendFrame(socket, frame);
      }
    }
  }

  function stateFrame(entry: LiveProjection): ServerFrame {
    return {
      t: 'state',
      projection: entry.projection,
      seq: entry.seq,
      state: entry.state,
      ...(Object.keys(entry.params).length > 0 ? { params: entry.params } : {}),
    };
  }

  function sendFrame(socket: WebSocket, frame: ServerFrame): void {
    // Errors never drop the socket (engine ws_bridge lesson).
    try {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    } catch {
      /* keep the socket */
    }
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function errorEnvelope(code: string, message: string): VerbError {
    return { ok: false, error: { code, message } };
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody, rejectBody) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
      req.on('error', rejectBody);
    });
  }

  /**
   * The actor a dispatch names for itself, or null when the harness will
   * not hear it. Two gates, both on the request and neither on the app's
   * config (that one is the caller's): the socket must be loopback — the
   * design's "a real principal arrives with a non-loopback transport later"
   * is still true, and a header over the LAN is exactly that principal
   * arriving unannounced — and the value must be a name a record can carry
   * verbatim, so nothing downstream ever meets a blank, a sentence or a
   * sixty-fifth character where an actor should be.
   */
  function headerActor(req: IncomingMessage): string | null {
    if (!isLoopbackAddress(req.socket.remoteAddress)) return null;
    const header = req.headers['x-loupe-actor'];
    const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    return ACTOR_NAME.test(value) ? value : null;
  }

  async function handleVerb(name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const verb = verbs[name];
    if (!verb) {
      json(res, 404, errorEnvelope(ERROR_CODES.unknownVerb, `unknown verb ${name}`));
      return;
    }
    let request: { params: Json };
    try {
      request = zVerbRequest.parse(JSON.parse((await readBody(req)) || '{}'));
    } catch {
      json(res, 400, errorEnvelope(ERROR_CODES.invalidParams, 'body must be {"params": {...}}'));
      return;
    }
    const parsed = verb.params.safeParse(request.params);
    if (!parsed.success) {
      json(
        res,
        400,
        errorEnvelope(
          ERROR_CODES.invalidParams,
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        ),
      );
      return;
    }
    const ctx: VerbContext = {
      actor: config.actors === 'header' ? (headerActor(req) ?? actor) : actor,
      at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    let result: VerbResult;
    try {
      result = await verb.execute(parsed.data, ctx, config.store);
    } catch (err) {
      json(res, 500, errorEnvelope(ERROR_CODES.internal, err instanceof Error ? err.message : String(err)));
      return;
    }
    if (!result.ok) {
      json(res, result.error.code === ERROR_CODES.conflict ? 409 : 400, result);
      return;
    }
    // The app appended its records; re-derive, bump seqs, push, and answer
    // with the authoritative post-execution seq. A dispatch that appended
    // anything advances the seq whether or not a projection changed —
    // otherwise two records could share a seq across dispatches and a poller
    // holding the first one's seq would never be handed the second.
    const reserved = result.records.length > 0 ? ++globalSeq : undefined;
    rederive(reserved);
    publishRecords(result.records, globalSeq);
    json(res, 200, { ...result, seq: globalSeq });
  }

  /**
   * The poll twin of the record frame: everything appended to `stream` since
   * `after`, from the ring. A stream no verb has written yet (declared or
   * not) is answered empty — a stream with no records is not an error. An
   * `after` the ring can no longer honour is 410 and says what it does hold,
   * so the caller re-snapshots instead of quietly missing records. An
   * `after` beyond our counter is a client that outlived a previous process
   * (the epoch rule handleState follows): it is read as seq 0, so a ring that
   * has never overflowed answers it in full from the start and one that has
   * overflowed answers 410 — which is the honest answer to that client
   * anyway, since re-snapshotting is exactly what an outlived cursor owes.
   */
  function handleRecords(stream: string, url: URL, res: ServerResponse): void {
    const raw = url.searchParams.get('after');
    // Digits before Number(): `1e3`, `0x10` and ` 3 ` are all numbers to
    // Number() and none of them is the non-negative integer seq the refusal
    // below promises — a caller that spelled a seq that way has a bug, and
    // guessing which seq it meant would hide it.
    const after = raw === null ? 0 : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(after) || after < 0) {
      json(res, 400, errorEnvelope(ERROR_CODES.invalidParams, 'after must be a non-negative integer seq'));
      return;
    }
    const since = after > globalSeq ? 0 : after;
    const ring = rings.get(stream) ?? { items: [], evicted: null };
    const oldest = ring.items[0]?.seq;
    // Two records from one dispatch share a seq, so a bound can split a
    // batch: when the eviction line equals the oldest held seq, part of that
    // seq's batch is gone and `after` must be strictly past it.
    const lost =
      ring.evicted !== null && (since < ring.evicted || (since === ring.evicted && oldest === ring.evicted));
    if (lost) {
      const gone: RecordsEnvelope = {
        stream,
        seq: globalSeq,
        records: [],
        // `since`, not `after`: an `after` past our counter was already read
        // as 0 above, and a sentence naming a seq this process never issued
        // would be telling the caller about a ring it is not being refused
        // from.
        note:
          `records after seq ${since} on ${stream} are no longer held: the ring keeps ${ringSize} ` +
          `and its oldest is seq ${oldest}; re-snapshot, then poll from seq ${globalSeq}`,
      };
      json(res, 410, gone);
      return;
    }
    const envelope: RecordsEnvelope = {
      stream,
      seq: globalSeq,
      records: ring.items.filter((held) => held.seq > since),
    };
    json(res, 200, envelope);
  }

  function handleState(projection: string, url: URL, res: ServerResponse): void {
    const proj = config.projections[projection];
    if (!proj) {
      json(res, 404, errorEnvelope(ERROR_CODES.unknownProjection, `unknown projection ${projection}`));
      return;
    }
    const params: Record<string, string> = {};
    let after: number | null = null;
    for (const [k, v] of url.searchParams) {
      if (k === 'after') after = Number(v);
      else params[k] = v;
    }
    let entry: LiveProjection;
    try {
      entry = deriveInto(projection, params);
    } catch (err) {
      json(res, 500, errorEnvelope(ERROR_CODES.internal, err instanceof Error ? err.message : String(err)));
      return;
    }
    // 304 only when the client's `after` is from THIS server lifetime
    // (after <= globalSeq) and the entry hasn't advanced past it. An `after`
    // beyond our counter means the client outlived a previous server process
    // (epoch change): answer a full snapshot so it can re-anchor.
    if (after !== null && Number.isFinite(after) && after <= globalSeq && entry.seq <= after) {
      res.writeHead(304);
      res.end();
      return;
    }
    const envelope: ProjectionEnvelope = { projection, seq: entry.seq, state: entry.state };
    json(res, 200, envelope);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://loupe.local');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/loupe/app') {
        json(res, 200, descriptor);
        return;
      }
      const stateMatch = /^\/loupe\/state\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && stateMatch) {
        handleState(decodeURIComponent(stateMatch[1]!), url, res);
        return;
      }
      const recordsMatch = /^\/loupe\/records\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && recordsMatch) {
        handleRecords(decodeURIComponent(recordsMatch[1]!), url, res);
        return;
      }
      const verbMatch = /^\/loupe\/verbs\/([^/]+)$/.exec(path);
      if (req.method === 'POST' && verbMatch) {
        await handleVerb(decodeURIComponent(verbMatch[1]!), req, res);
        return;
      }
      json(res, 404, errorEnvelope('not_found', `no route for ${req.method} ${path}`));
    })().catch(() => {
      try {
        json(res, 500, errorEnvelope(ERROR_CODES.internal, 'internal error'));
      } catch {
        /* response already gone */
      }
    });
  }

  const httpServer: Server = createServer((req, res) => app.handle(req, res));
  httpServer.on('upgrade', (req, socket, head) => app.upgrade(req, socket, head));
  const wss = new WebSocketServer({ noServer: true });
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (new URL(req.url ?? '/', 'http://loupe.local').pathname !== '/loupe/ws') {
      // Answer as ws's own path check did before noServer mode: a status the
      // host proxy and clients can read, not a bare reset.
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  wss.on('connection', (socket: WebSocket) => {
    subs.set(socket, new Map());
    streamSubs.set(socket, new Set());
    socket.on('message', (data: Buffer | string) => {
      // Errors never drop the socket: bad frames are ignored.
      let frame: z.infer<typeof zClientFrame>;
      try {
        frame = zClientFrame.parse(JSON.parse(String(data)));
      } catch {
        return;
      }
      if ('stream' in frame) {
        // A stream subscription is answered with nothing: there is no
        // snapshot of a stream, only what lands next. History since a seq is
        // the poll twin's job, and the client asks it on (re)open.
        const streams = streamSubs.get(socket);
        if (!streams) return;
        if (frame.t === 'unsub') streams.delete(frame.stream);
        else streams.add(frame.stream);
        return;
      }
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(frame.params ?? {})) params[k] = String(v);
      const key = projectionKey(frame.projection, params);
      const bySub = subs.get(socket);
      if (!bySub) return;
      if (frame.t === 'unsub') {
        bySub.delete(key);
        return;
      }
      if (!config.projections[frame.projection]) return;
      try {
        const entry = deriveInto(frame.projection, params);
        bySub.set(key, { key, projection: frame.projection, params });
        sendFrame(socket, stateFrame(entry));
      } catch {
        /* keep the socket */
      }
    });
    const forget = (): void => {
      subs.delete(socket);
      streamSubs.delete(socket);
    };
    socket.on('close', forget);
    socket.on('error', forget);
  });

  const app: LoupeAppServer = {
    handle,
    upgrade,
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolveListen, rejectListen) => {
        httpServer.once('error', rejectListen);
        httpServer.listen(port, host, () => resolveListen());
      }),
    close: () =>
      new Promise((resolveClose) => {
        subs.clear();
        streamSubs.clear();
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => {
          if (httpServer.listening) httpServer.close(() => resolveClose());
          else resolveClose();
        });
      }),
    touch,
    port: () => {
      const addr = httpServer.address();
      return addr && typeof addr === 'object' ? addr.port : 0;
    },
  };
  return app;
}


type Span =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string; spans?: Span[] }
  | { t: 'italic'; v: string };

export type Block =
  | { kind: 'heading'; level: number; spans: Span[] }
  | { kind: 'para'; spans: Span[] }
  | { kind: 'bullet'; depth: number; spans: Span[] }
  | { kind: 'ordered'; depth: number; marker: string; spans: Span[] }
  | { kind: 'task'; done: boolean; spans: Span[] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'code'; lang: string | null; lines: string[] }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] }
  | { kind: 'rule' };


interface Unhandled {
  line: number;
  construct: string;
  text: string;
}

interface Doc {
  blocks: Block[];
  unhandled: Unhandled[];
}
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/;


function bold(body: string): Span {
  if (INLINE.exec(body) === null) return { t: 'bold', v: body };
  return { t: 'bold', v: body, spans: parseSpans(body) };
}

function parseSpans(text: string): Span[] {
  const out: Span[] = [];
  let rest = text;
  while (rest !== '') {
    const m = INLINE.exec(rest);
    if (m === null || m.index === undefined) break;
    if (m.index > 0) out.push({ t: 'text', v: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('`')) out.push({ t: 'code', v: tok.slice(1, -1) });
    else if (tok.startsWith('**')) out.push(bold(tok.slice(2, -2)));
    else out.push({ t: 'italic', v: tok.slice(1, -1) });
    rest = rest.slice(m.index + tok.length);
  }
  if (rest !== '') out.push({ t: 'text', v: rest });
  return out.length > 0 ? out : [{ t: 'text', v: text }];
}


const cells = (row: string): Span[][] => {
  const body = row.replace(/^\||\|$/g, '');
  const out: string[] = [];
  let cell = '';
  let inCode = false;
  for (const ch of body) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      out.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  out.push(cell);
  return out.map((c) => parseSpans(c.trim()));
};
const FOREIGN: Array<[RegExp, string]> = [
  [/!\[[^\]]*\]\([^)]*\)/, 'image'],
  [/(?<!!)\[[^\]]+\]\([^)]*\)/, 'link'],
  [/^<[a-zA-Z][^>]*>/, 'raw html'],
  [/^\[\^[^\]]+\]:/, 'footnote'],
  [/^[^\n]+\n:{3,}/, 'definition list'],
];

// Closed markdown grammar; unsupported links, images and HTML remain literal text.
export function parseDoc(source: string): Doc {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  const unhandled: Unhandled[] = [];
  type Pending = { open: (spans: Span[]) => Block; lines: string[]; quote?: boolean };
  let pending: Pending | null = null;

  const flush = (): void => {
    if (pending !== null) {
      blocks.push(pending.open(parseSpans(pending.lines.join(' '))));
      pending = null;
    }
  };
  
  const open = (first: string, make: (spans: Span[]) => Block): Pending => {
    flush();
    return { open: make, lines: [first] };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    for (const [re, name] of FOREIGN) {
      if (re.test(line)) unhandled.push({ line: i + 1, construct: name, text: line.trim().slice(0, 80) });
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence !== null) {
      flush();
      const lang = fence[1] === '' ? null : fence[1]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'code', lang, lines: body });
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h !== null) {
      flush();
      blocks.push({ kind: 'heading', level: h[1]!.length, spans: parseSpans(h[2]!) });
      continue;
    }

    const task = /^(\s*)- \[([ xX])\]\s+(.*)$/.exec(line);
    if (task !== null) {
      const done = task[2]!.toLowerCase() === 'x';
      pending = open(task[3]!, (spans) => ({ kind: 'task', done, spans }));
      continue;
    }

    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet !== null) {
      const depth = Math.floor(bullet[1]!.length / 2);
      pending = open(bullet[2]!, (spans) => ({ kind: 'bullet', depth, spans }));
      continue;
    }

    const ord = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (ord !== null) {
      const odepth = Math.floor(ord[1]!.length / 2);
      const marker = ord[2]!;
      pending = open(ord[3]!, (spans) => ({ kind: 'ordered', depth: odepth, marker, spans }));
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote !== null) {
      if (pending !== null && pending.quote === true) pending.lines.push(quote[1]!);
      else pending = { ...open(quote[1]!, (spans) => ({ kind: 'quote', spans })), quote: true };
      continue;
    }

    if (/^\|/.test(line)) {
      flush();
      const head = cells(line);
      const rows: Span[][][] = [];
      i += 1;
      if (i < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i]!)) i += 1; // separator
      while (i < lines.length && /^\|/.test(lines[i]!)) {
        const row = cells(lines[i]!);
        while (row.length < head.length) row.push([]);
        rows.push(row);
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    if (pending !== null) pending.lines.push(line.trim());
    else pending = open(line.trim(), (spans) => ({ kind: 'para', spans }));
  }
  flush();
  return { blocks, unhandled };
}

