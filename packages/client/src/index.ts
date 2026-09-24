// @loupe/client — LoupeClient transports (§5.5). The interface is the seam:
// httpClient (fetch + ?after=seq poll) and wsClient (WS subscribe/state
// frames with http-poll fallback) both speak @loupe/protocol shapes; MCP
// later is a third implementation, not a redesign. records() rides the same
// two transports the same way: `record` frames over WS, the
// /loupe/records poll twin over HTTP, and the twin again as the WS path's
// resync on every (re)open.
import {
  zAppDescriptor,
  zProjectionEnvelope,
  zRecordsEnvelope,
  zServerFrame,
  zVerbResult,
  type AppDescriptor,
  type ConnectionState,
  type Json,
  type JsonObject,
  type LoupeClient,
  type Params,
  type RecordFrame,
  type VerbResult,
} from '@loupe/protocol';

export interface ClientOptions {
  /** Poll interval for the ?after=seq refresh loop (httpClient / ws fallback). */
  pollMs?: number;
  /**
   * The name this client signs its dispatches with, sent as `X-Loupe-Actor`
   * on every verb POST. Unset — the default, and what every fabrial's
   * client is — sends no identity at all: the app's configured actor is
   * stamped. Set by an agent transport on the same machine as the app; the
   * harness honours it only over loopback and only when the app opted in
   * (`actors: 'header'`), so a client that names itself against an app that
   * did not is simply stamped as before.
   */
  actor?: string;
}

const DEFAULT_POLL_MS = 1000;

/** WS reopen backoff: min(500·2^attempt, 8000) ± 20% jitter. */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;
/** Continuous non-contact this long → 'gone' (still retrying). */
const GONE_AFTER_MS = 30_000;

/**
 * Per-client liveness inference, fed by the subscribe path only (dispatch
 * failures already surface through onVerbError — the seam stays clean).
 * Initial state is 'connected' (optimistic — the renderer's own loading state
 * covers startup; the band never flashes on mount). Emits only on change.
 */
function connectionTracker(goneAfterMs: number): {
  ok: () => void;
  fail: () => void;
  subscribe: (cb: (state: ConnectionState) => void) => () => void;
} {
  let state: ConnectionState = 'connected';
  let goneTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(s: ConnectionState) => void>();
  const emit = (next: ConnectionState): void => {
    if (next === state) return;
    state = next;
    for (const cb of [...listeners]) cb(state);
  };
  return {
    ok: () => {
      if (goneTimer !== null) {
        clearTimeout(goneTimer);
        goneTimer = null;
      }
      emit('connected');
    },
    fail: () => {
      if (state !== 'connected') return;
      emit('reconnecting');
      goneTimer = setTimeout(() => {
        goneTimer = null;
        emit('gone');
      }, goneAfterMs);
    },
    subscribe: (cb) => {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    },
  };
}

function trimBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function queryString(params: Params | undefined, after?: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) search.set(key, String(value));
  }
  if (after !== undefined) search.set('after', String(after));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function fetchDescriptor(base: string): Promise<AppDescriptor> {
  const res = await fetch(`${base}/loupe/app`);
  if (!res.ok) throw new Error(`GET /loupe/app failed: ${res.status}`);
  return zAppDescriptor.parse(await res.json());
}

async function fetchSnapshot(
  base: string,
  projection: string,
  params?: Params,
): Promise<{ seq: number; state: Json }> {
  const res = await fetch(`${base}/loupe/state/${encodeURIComponent(projection)}${queryString(params)}`);
  if (!res.ok) throw new Error(`GET /loupe/state/${projection} failed: ${res.status}`);
  const envelope = zProjectionEnvelope.parse(await res.json());
  return { seq: envelope.seq, state: envelope.state };
}

async function postVerb(base: string, verb: string, params: Params, actor?: string): Promise<VerbResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/loupe/verbs/${encodeURIComponent(verb)}`, {
      method: 'POST',
      // Identity is transport, not params: the body is exactly zVerbRequest
      // whoever sends it, and the actor rides a header the app may ignore.
      headers: { 'content-type': 'application/json', ...(actor !== undefined ? { 'x-loupe-actor': actor } : {}) },
      body: JSON.stringify({ params }),
    });
  } catch (err) {
    return {
      ok: false,
      error: { code: 'transport', message: err instanceof Error ? err.message : String(err) },
    };
  }
  try {
    return zVerbResult.parse(await res.json());
  } catch {
    return { ok: false, error: { code: 'transport', message: `verb ${verb}: unparseable response (${res.status})` } };
  }
}

/**
 * Poll loop shared by httpClient.subscribe and the ws fallback: snapshot
 * first, then refresh with ?after=seq (304 until seq advances). Returns a stop
 * function.
 */
function startPolling(
  base: string,
  projection: string,
  params: Params,
  cb: (seq: number, state: Json) => void,
  pollMs: number,
  /** true on any server answer (2xx, 304, 404 — the app responded); false on fetch rejection or 5xx. */
  onTick?: (ok: boolean) => void,
): () => void {
  let stopped = false;
  let lastSeq = -1;
  let warned404 = false;

  const tick = async (): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(
        `${base}/loupe/state/${encodeURIComponent(projection)}${queryString(params, lastSeq >= 0 ? lastSeq : undefined)}`,
      );
    } catch (err) {
      if (!stopped) onTick?.(false);
      throw err;
    }
    if (!stopped) onTick?.(res.status < 500);
    if (stopped || res.status === 304) return;
    if (!res.ok) {
      if (res.status === 404 && !warned404) {
        warned404 = true;
        console.warn(`loupe: GET /loupe/state/${projection} answered 404; will keep polling`);
      }
      return;
    }
    const envelope = zProjectionEnvelope.parse(await res.json());
    // A seq REGRESSION means the server restarted (seqs are only monotonic
    // within one server lifetime): accept the snapshot and re-anchor. Only an
    // exact repeat is dropped.
    if (stopped || envelope.seq === lastSeq) return;
    lastSeq = envelope.seq;
    cb(envelope.seq, envelope.state);
  };

  void tick().catch(() => {});
  const timer = setInterval(() => void tick().catch(() => {}), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// `null` here is the ring-overflow signal and nothing else: the wire shapes
// (zRecordFrame, zRecordsEnvelope) refuse a null record, so the only value
// that reaches a caller in its place is the one this file puts there.
type RecordCb = (seq: number, record: JsonObject | null, stream: string) => void;

/**
 * Where one records() subscription has read up to. Shared between the poll
 * loop and the WS path of one subscription, so whichever of them is carrying
 * the stream when a socket reopens, the resync asks the twin from the right
 * place — this is what "resubscribe carries the last seq" means on a wire
 * whose stream `sub` frame carries only the stream.
 */
interface RecordCursor {
  since: number;
}

/**
 * One round-trip to the poll twin: deliver everything that landed since the
 * cursor, move the cursor to the head the server answered, and resolve with
 * that head. A 410 means the ring no longer holds the gap: the cursor jumps
 * to the head and the caller hears a `null` record (the re-snapshot signal
 * the LoupeClient contract names). Resolves null when the server did not
 * answer with records (5xx, 404); rejects on a fetch failure — the poll loop
 * swallows both, the WS path treats both as a drop.
 */
async function pullRecords(
  base: string,
  stream: string,
  cursor: RecordCursor,
  cb: RecordCb,
  live: () => boolean,
  onTick?: (ok: boolean) => void,
): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(`${base}/loupe/records/${encodeURIComponent(stream)}?after=${cursor.since}`);
  } catch (err) {
    if (live()) onTick?.(false);
    throw err;
  }
  if (live()) onTick?.(res.status < 500);
  if (!live()) return null;
  if (res.status === 410) {
    const gone = zRecordsEnvelope.parse(await res.json());
    if (!live()) return null;
    cursor.since = gone.seq;
    cb(gone.seq, null, stream);
    return gone.seq;
  }
  if (!res.ok) return null;
  const envelope = zRecordsEnvelope.parse(await res.json());
  if (!live()) return null;
  // The server already filtered by the cursor; the client does not second-
  // guess it — two records from one dispatch share a seq, and a "strictly
  // past the last one" rule here would drop the second.
  cursor.since = envelope.seq;
  for (const held of envelope.records) {
    if (!live()) return null;
    cb(held.seq, held.record, stream);
  }
  return envelope.seq;
}

/**
 * The "this server has no records route" sentence, said once for as long as
 * the returned function lives. The scope of the latch is the point: one
 * records() subscription says it once, not once per poll loop it starts over
 * its life — a ws subscription against such a server starts a new one on
 * every reopen.
 */
function warnNoRecordsOnce(stream: string): () => void {
  let said = false;
  return () => {
    if (said) return;
    said = true;
    console.warn(`loupe: GET /loupe/records/${stream} did not answer with records; will keep polling`);
  };
}

/**
 * The record twin of startPolling, for httpClient.records and the ws
 * fallback: pull from the cursor on every tick. Returns a stop function.
 */
function startRecordPolling(
  base: string,
  stream: string,
  cursor: RecordCursor,
  cb: RecordCb,
  pollMs: number,
  onTick: ((ok: boolean) => void) | undefined,
  /**
   * Says the "no records route" sentence, at most once however often it is
   * called. Owned by the SUBSCRIPTION, not by this loop: the ws path stops
   * and restarts the fallback poll on every blip, so a latch living here
   * would repeat the sentence once per reopen — which is exactly the noise
   * a client aimed at an older server used to make.
   */
  warnNoRecords: () => void,
): () => void {
  let stopped = false;
  let inFlight = false;
  const tick = async (): Promise<void> => {
    // Never two pulls at once. startPolling can overlap itself harmlessly —
    // an exact-repeat seq is dropped there — but two pulls from one cursor
    // would each be answered the same records, and here a repeat is a real
    // second record (two from one dispatch share a seq). A slow answer
    // simply costs the next tick.
    if (inFlight) return;
    inFlight = true;
    try {
      const head = await pullRecords(base, stream, cursor, cb, () => !stopped, onTick);
      // A server without the route (older than the record wire) answers 404
      // here; say so once rather than polling in silence forever.
      if (head === null && !stopped) warnNoRecords();
    } finally {
      inFlight = false;
    }
  };
  void tick().catch(() => {});
  const timer = setInterval(() => void tick().catch(() => {}), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** fetch + `?after=seq` poll transport. */
export function httpClient(base: string, opts?: ClientOptions): LoupeClient {
  const root = trimBase(base);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const tracker = connectionTracker(GONE_AFTER_MS);
  const onTick = (ok: boolean): void => (ok ? tracker.ok() : tracker.fail());
  return {
    describe: () => fetchDescriptor(root),
    snapshot: (projection, params) => fetchSnapshot(root, projection, params),
    subscribe: (projection, params, cb) =>
      // Liveness rides the existing poll cadence (no backoff added here).
      startPolling(root, projection, params, cb, pollMs, onTick),
    records: (stream, after, cb) =>
      // Same cadence, same liveness feed: a records poll is a poll.
      startRecordPolling(root, stream, { since: after }, cb, pollMs, onTick, warnNoRecordsOnce(stream)),
    dispatch: (verb, params) => postVerb(root, verb, params, opts?.actor),
    connection: tracker.subscribe,
  };
}

function wsUrl(base: string): string {
  // Absolute http(s) bases flip scheme; relative bases (the host proxy)
  // resolve against the page origin.
  if (/^https?:\/\//.test(base)) return `${base.replace(/^http/, 'ws')}/loupe/ws`;
  const origin =
    typeof globalThis.location !== 'undefined' ? globalThis.location.origin.replace(/^http/, 'ws') : 'ws://127.0.0.1';
  return `${origin}${base.startsWith('/') ? '' : '/'}${base}/loupe/ws`;
}

/** WS subscribe/state transport with http-poll fallback and backed-off WS retry. */
export function wsClient(base: string, opts?: ClientOptions): LoupeClient {
  const root = trimBase(base);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const tracker = connectionTracker(GONE_AFTER_MS);
  return {
    describe: () => fetchDescriptor(root),
    snapshot: (projection, params) => fetchSnapshot(root, projection, params),
    // A WS client still dispatches over HTTP (the socket carries only
    // subscriptions), so the actor header rides the same POST on both.
    dispatch: (verb, params) => postVerb(root, verb, params, opts?.actor),
    connection: tracker.subscribe,
    subscribe: (projection, params, cb) => {
      let stopped = false;
      let stopPoll: (() => void) | null = null;
      let socket: WebSocket | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let attempt = 0;
      let lastSeq = -1;
      // The exact params used at sub time; the unsub frame must carry the
      // same ones or the server (keyed by projection+params) never matches.
      const subParams = Object.keys(params).length > 0 ? { params } : {};

      const onTick = (ok: boolean): void => (ok ? tracker.ok() : tracker.fail());

      const fallback = (): void => {
        if (stopped || stopPoll) return;
        // The poll feeds the tracker too — if HTTP works while WS is blocked,
        // data flows and the state is legitimately 'connected'.
        stopPoll = startPolling(root, projection, params, cb, pollMs, onTick);
      };
      const stopFallback = (): void => {
        if (stopPoll) {
          stopPoll();
          stopPoll = null;
        }
      };

      const scheduleReopen = (): void => {
        if (stopped || retryTimer !== null) return;
        const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
        const jitter = backoff * 0.2 * (Math.random() * 2 - 1);
        attempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          openSocket();
        }, Math.max(0, Math.round(backoff + jitter)));
      };

      /** A live socket dropped (or never opened): poll for data, retry WS. */
      const dropped = (): void => {
        if (stopped) return;
        socket = null;
        tracker.fail();
        fallback();
        scheduleReopen();
      };

      function openSocket(): void {
        if (stopped) return;
        const WS = globalThis.WebSocket;
        if (typeof WS !== 'function') {
          // No WS in this runtime: permanent poll fallback, nothing to retry.
          fallback();
          return;
        }
        let ws: WebSocket;
        try {
          ws = new WS(wsUrl(root));
        } catch {
          dropped();
          return;
        }
        socket = ws;
        // close and error can both fire for one socket — count the drop once.
        let droppedOnce = false;
        const onDrop = (): void => {
          if (droppedOnce) return;
          droppedOnce = true;
          if (!stopped && socket === ws) dropped();
        };
        ws.addEventListener('open', () => {
          if (stopped) return;
          // Re-sending sub on every (re)open IS the resync: @loupe/serve
          // answers a sub unconditionally with a full state frame; a seq
          // regression is accepted below as a server-restart epoch change,
          // and an identical-seq frame after a blip is dropped — correct,
          // the state is identical.
          ws.send(JSON.stringify({ t: 'sub', projection, ...subParams }));
          tracker.ok();
          attempt = 0;
          // Single data path while WS is live: pushes serve, the poll stops.
          stopFallback();
        });
        ws.addEventListener('message', (event) => {
          if (stopped) return;
          let frame: ReturnType<typeof zServerFrame.parse>;
          try {
            frame = zServerFrame.parse(JSON.parse(String((event as MessageEvent).data)));
          } catch {
            return;
          }
          // A record frame is another subscription's business (records()
          // below); this socket asked for a projection and reads only that.
          if (frame.t === 'record' || frame.projection !== projection) return;
          // A seq REGRESSION means the server restarted (seqs are only
          // monotonic within one server lifetime): accept the frame and
          // re-anchor. Only an exact repeat is dropped.
          if (frame.t === 'state') {
            if (frame.seq === lastSeq) return;
            lastSeq = frame.seq;
            cb(frame.seq, frame.state);
            return;
          }
          // Patch frame: @loupe/serve is snapshot-only, but a third-party app
          // may patch. Treat it as a seq signal and re-request full state —
          // the seq-gap-safe move (§5.3).
          if (frame.seq === lastSeq) return;
          void fetchSnapshot(root, projection, params)
            .then((snap) => {
              if (stopped || snap.seq === lastSeq) return;
              lastSeq = snap.seq;
              cb(snap.seq, snap.state);
            })
            .catch(() => {});
        });
        ws.addEventListener('error', onDrop);
        ws.addEventListener('close', onDrop);
      }

      openSocket();

      return () => {
        stopped = true;
        if (retryTimer !== null) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        stopFallback();
        if (socket && (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)) {
          try {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ t: 'unsub', projection, ...subParams }));
            }
            socket.close();
          } catch {
            /* closing is best-effort */
          }
        }
      };
    },
    records: (stream, after, cb) => {
      // subscribe() above, with a stream where it has a projection: one
      // socket per subscription, poll fallback while WS is down, backed-off
      // reopen. The one real difference is the resync. A projection sub is
      // answered with a full state frame, so re-sending it IS the resync; a
      // stream sub is answered with nothing, so what landed while the socket
      // was down is asked of the poll twin from the cursor, and frames that
      // arrive while that answer is in flight wait for it.
      let stopped = false;
      let stopPoll: (() => void) | null = null;
      let socket: WebSocket | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let attempt = 0;
      const cursor: RecordCursor = { since: after };
      // One latch for the whole subscription, however many times the fallback
      // poll is started and stopped underneath it.
      const warnNoRecords = warnNoRecordsOnce(stream);

      const onTick = (ok: boolean): void => (ok ? tracker.ok() : tracker.fail());

      const fallback = (): void => {
        if (stopped || stopPoll) return;
        stopPoll = startRecordPolling(root, stream, cursor, cb, pollMs, onTick, warnNoRecords);
      };
      const stopFallback = (): void => {
        if (stopPoll) {
          stopPoll();
          stopPoll = null;
        }
      };

      const scheduleReopen = (): void => {
        if (stopped || retryTimer !== null) return;
        const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
        const jitter = backoff * 0.2 * (Math.random() * 2 - 1);
        attempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          openSocket();
        }, Math.max(0, Math.round(backoff + jitter)));
      };

      const dropped = (): void => {
        if (stopped) return;
        socket = null;
        tracker.fail();
        fallback();
        scheduleReopen();
      };

      const deliver = (frame: RecordFrame): void => {
        // Not max(): a regressed seq is a restarted server, and the cursor
        // must follow it or the next resync asks for a seq the new process
        // has not reached and is answered from its start — every record
        // already heard live, again.
        cursor.since = frame.seq;
        cb(frame.seq, frame.record, stream);
      };

      function openSocket(): void {
        if (stopped) return;
        const WS = globalThis.WebSocket;
        if (typeof WS !== 'function') {
          fallback();
          return;
        }
        let ws: WebSocket;
        try {
          ws = new WS(wsUrl(root));
        } catch {
          dropped();
          return;
        }
        socket = ws;
        let droppedOnce = false;
        const onDrop = (): void => {
          if (droppedOnce) return;
          droppedOnce = true;
          if (!stopped && socket === ws) dropped();
        };
        // Frames that land while the catch-up is in flight. The twin's
        // answer names the head seq it covered; a buffered frame past that
        // head is new, one at or under it was in the answer.
        let pending: RecordFrame[] | null = null;
        ws.addEventListener('open', () => {
          if (stopped) return;
          ws.send(JSON.stringify({ t: 'sub', stream }));
          tracker.ok();
          stopFallback();
          pending = [];
          void pullRecords(root, stream, cursor, cb, () => !stopped && socket === ws, onTick)
            .then((head) => {
              if (stopped || socket !== ws) return;
              const held = pending ?? [];
              pending = null;
              if (head === null) {
                // The socket is up but the twin is not answering: without
                // the gap there is no honest order to deliver, so treat it
                // as a drop and let the fallback poll keep asking.
                ws.close();
                return;
              }
              // Only HERE is the reopen ladder reset. An `open` is not yet a
              // working subscription on this path — the catch-up above still
              // decides whether the socket is kept — and resetting on `open`
              // against a server with no records route made an unbounded
              // 500 ms open/close/reopen loop out of what should have been a
              // backing-off retry.
              attempt = 0;
              for (const frame of held) {
                if (stopped) return;
                if (frame.seq > head) deliver(frame);
              }
            })
            .catch(() => {
              if (!stopped && socket === ws) ws.close();
            });
        });
        ws.addEventListener('message', (event) => {
          if (stopped) return;
          let frame: ReturnType<typeof zServerFrame.parse>;
          try {
            frame = zServerFrame.parse(JSON.parse(String((event as MessageEvent).data)));
          } catch {
            return;
          }
          if (frame.t !== 'record' || frame.stream !== stream) return;
          if (pending) {
            pending.push(frame);
            return;
          }
          deliver(frame);
        });
        ws.addEventListener('error', onDrop);
        ws.addEventListener('close', onDrop);
      }

      openSocket();

      return () => {
        stopped = true;
        if (retryTimer !== null) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        stopFallback();
        if (socket && (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)) {
          try {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ t: 'unsub', stream }));
            }
            socket.close();
          } catch {
            /* closing is best-effort */
          }
        }
      };
    },
  };
}
