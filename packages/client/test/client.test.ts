// Transport tests against a minimal in-test protocol server (plain node:http
// plus a hand-rolled WS endpoint — @loupe/client depends only on
// @loupe/protocol, so the test provides its own §5-speaking peer).
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState, Json, JsonObject } from '@loupe/protocol';
import { httpClient, wsClient } from '../src/index.ts';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface MiniApp {
  base: string;
  seq: number;
  state: Json;
  /** When true every HTTP request answers 500 (liveness sees a dead app). */
  failing: boolean;
  bump: (state: Json) => void;
  close: () => Promise<void>;
  sockets: Duplex[];
  subs: Array<{ socket: Duplex; projection: string; params?: Json }>;
  verbCalls: Array<{ verb: string; params: Json }>;
  /**
   * The `x-loupe-actor` each dispatch carried, `null` for a dispatch that
   * sent none. Kept beside `verbCalls` rather than inside it because identity
   * is transport and the body is exactly zVerbRequest either way.
   */
  verbActors: Array<string | null>;
  /** The record wire: a ring per stream, stream subs per socket, and every `after` the twin was asked. */
  ring: Array<{ stream: string; seq: number; record: Json }>;
  streamSubs: Array<{ socket: Duplex; stream: string }>;
  recordAsks: number[];
  /** When set, an `after` below it is answered 410 — the ring "forgot" up to here. */
  forgotten: number | null;
  /** Delay before the twin answers, to make a poll tick slower than the interval. */
  slowRecordsMs: number;
  /** When true /loupe/records 404s: a server older than the record wire. */
  noRecordsRoute: boolean;
  append: (stream: string, record: JsonObject) => number;
  /** Send a frame to every open socket, whatever it asked for. */
  broadcast: (frame: Json) => void;
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const head = Buffer.alloc(4);
  head[0] = 0x81;
  head[1] = 126;
  head.writeUInt16BE(payload.length, 2);
  return Buffer.concat([head, payload]);
}

/**
 * `onClose` is not decoration: a client that calls close() waits for the peer
 * to finish the handshake before its own `close` event fires, so a server that
 * ignores the close frame leaves the client hanging in CLOSING — and every
 * reconnect this file tests would silently never happen. A real ws server
 * answers; so does this one.
 */
function decodeFrames(buffer: Buffer, onText: (text: string) => void, onClose?: () => void): Buffer {
  let buf = buffer;
  for (;;) {
    if (buf.length < 2) return buf;
    const opcode = buf[0]! & 0x0f;
    const masked = (buf[1]! & 0x80) !== 0;
    let len = buf[1]! & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return buf;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      return buf.subarray(buf.length); // not needed at test sizes
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return buf;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
    if (opcode === 0x1) onText(payload.toString('utf8'));
    if (opcode === 0x8) {
      onClose?.();
      return Buffer.alloc(0);
    }
    buf = buf.subarray(offset + maskLen + len);
  }
}

/** A minimal §5 server: one projection "counter", one verb "poke", WS optional. */
async function miniApp(withWs: boolean): Promise<MiniApp> {
  const app: MiniApp = {
    base: '',
    seq: 1,
    state: { count: 0 },
    failing: false,
    bump: (state) => {
      app.seq += 1;
      app.state = state;
      for (const sub of app.subs) {
        sub.socket.write(
          encodeTextFrame(JSON.stringify({ t: 'state', projection: sub.projection, seq: app.seq, state: app.state })),
        );
      }
    },
    close: () =>
      new Promise((r) => {
        for (const s of app.sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => r());
      }),
    sockets: [],
    subs: [],
    verbCalls: [],
    verbActors: [],
    ring: [],
    streamSubs: [],
    recordAsks: [],
    forgotten: null,
    slowRecordsMs: 0,
    noRecordsRoute: false,
    append: (stream, record) => {
      app.seq += 1;
      app.ring.push({ stream, seq: app.seq, record });
      for (const sub of app.streamSubs) {
        if (sub.stream !== stream) continue;
        sub.socket.write(encodeTextFrame(JSON.stringify({ t: 'record', stream, record, seq: app.seq })));
      }
      return app.seq;
    },
    broadcast: (frame) => {
      for (const socket of app.sockets) socket.write(encodeTextFrame(JSON.stringify(frame)));
    },
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (app.failing) {
      reply(500, { ok: false, error: { code: 'boom', message: 'flaky' } });
      return;
    }
    if (url.pathname === '/loupe/app') {
      reply(200, {
        protocol: 1,
        app: { name: 'mini', version: '0.0.0' },
        projections: [{ name: 'counter' }],
        verbs: [{ name: 'poke', params: { type: 'object' } }],
        capabilities: { ws: withWs },
      });
      return;
    }
    if (url.pathname === '/loupe/state/counter') {
      const after = url.searchParams.get('after');
      // Epoch-aware like @loupe/serve: 304 only when `after` is from this
      // lifetime AND nothing advanced; an `after` beyond our seq answers 200.
      if (after !== null && app.seq <= Number(after) && Number(after) <= app.seq) {
        res.writeHead(304);
        res.end();
        return;
      }
      reply(200, { projection: 'counter', seq: app.seq, state: app.state });
      return;
    }
    if (url.pathname.startsWith('/loupe/records/') && !app.noRecordsRoute) {
      const stream = decodeURIComponent(url.pathname.split('/').pop()!);
      const after = Number(url.searchParams.get('after') ?? '0');
      app.recordAsks.push(after);
      if (app.forgotten !== null && after < app.forgotten) {
        reply(410, {
          stream,
          seq: app.seq,
          records: [],
          note: `records after seq ${after} on ${stream} are no longer held; re-snapshot, then poll from seq ${app.seq}`,
        });
        return;
      }
      const answer = (): void =>
        reply(200, {
          stream,
          seq: app.seq,
          records: app.ring.filter((r) => r.stream === stream && r.seq > after).map(({ seq, record }) => ({ seq, record })),
        });
      if (app.slowRecordsMs > 0) setTimeout(answer, app.slowRecordsMs);
      else answer();
      return;
    }
    if (url.pathname.startsWith('/loupe/verbs/')) {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { params: Json };
        app.verbCalls.push({ verb: url.pathname.split('/').pop()!, params: body.params });
        const claimed = req.headers['x-loupe-actor'];
        app.verbActors.push(typeof claimed === 'string' ? claimed : null);
        reply(200, { ok: true, seq: app.seq, records: [] });
      });
      return;
    }
    reply(404, { ok: false, error: { code: 'not_found', message: url.pathname } });
  });

  if (withWs) {
    server.on('upgrade', (req, socket: Duplex) => {
      const key = req.headers['sec-websocket-key'];
      const accept = createHash('sha1')
        .update(String(key) + WS_GUID)
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      app.sockets.push(socket);
      let pending: Buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        pending = decodeFrames(Buffer.concat([pending, chunk]), (text) => {
          const frame = JSON.parse(text) as { t: string; projection?: string; stream?: string; params?: Json };
          if (frame.stream !== undefined) {
            const stream = frame.stream;
            if (frame.t === 'sub') app.streamSubs.push({ socket, stream });
            else app.streamSubs = app.streamSubs.filter((s) => s.socket !== socket || s.stream !== stream);
            return;
          }
          if (frame.projection === undefined) return;
          if (frame.t === 'sub') {
            app.subs.push({ socket, projection: frame.projection, params: frame.params });
            socket.write(
              encodeTextFrame(
                JSON.stringify({ t: 'state', projection: frame.projection, seq: app.seq, state: app.state }),
              ),
            );
          } else if (frame.t === 'unsub') {
            // Match on projection AND params, like @loupe/serve's key.
            const projection = frame.projection;
            app.subs = app.subs.filter(
              (s) =>
                s.socket !== socket ||
                s.projection !== projection ||
                JSON.stringify(s.params ?? {}) !== JSON.stringify(frame.params ?? {}),
            );
          }
        },
        () => {
          // The peer asked to close: forget its subscriptions and let the
          // socket go, which is what finishes the handshake for the client.
          app.subs = app.subs.filter((s) => s.socket !== socket);
          app.streamSubs = app.streamSubs.filter((s) => s.socket !== socket);
          app.sockets = app.sockets.filter((s) => s !== socket);
          socket.destroy();
        });
      });
      socket.on('error', () => {});
    });
  }

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  app.base = `http://127.0.0.1:${addr && typeof addr === 'object' ? addr.port : 0}`;
  return app;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('the transport seam', () => {
  it('both transports expose exactly the same surface, records() included', async () => {
    // The seam is the promise that a fabrial cannot tell which transport it
    // has. A method added to one and forgotten on the other (records() was
    // added to both in this track) breaks that quietly — the caller finds out
    // at runtime, on the transport it did not test with.
    const app = await miniApp(false);
    cleanups.push(app.close);
    const surface = ['connection', 'describe', 'dispatch', 'records', 'snapshot', 'subscribe'];
    expect(Object.keys(httpClient(app.base)).sort()).toEqual(surface);
    expect(Object.keys(wsClient(app.base)).sort()).toEqual(surface);
  });
});

describe('httpClient', () => {
  it('describe / snapshot / dispatch speak the wire shapes', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base);

    const descriptor = await client.describe();
    expect(descriptor.app.name).toBe('mini');

    const snap = await client.snapshot('counter');
    expect(snap).toEqual({ seq: 1, state: { count: 0 } });

    const result = await client.dispatch('poke', { hard: true });
    expect(result.ok).toBe(true);
    expect(app.verbCalls).toEqual([{ verb: 'poke', params: { hard: true } }]);
  });

  it('subscribe polls with ?after=seq and reports only advancing seqs', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base, { pollMs: 15 });

    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);

    await waitFor(() => seen.length === 1);
    app.bump({ count: 1 });
    await waitFor(() => seen.length === 2);
    expect(seen[0]).toEqual({ seq: 1, state: { count: 0 } });
    expect(seen[1]).toEqual({ seq: 2, state: { count: 1 } });

    // No seq advance → no callback (304 path).
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toHaveLength(2);
  });

  it('recovers after a server restart: a regressed seq is an epoch change, not stale data', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base, { pollMs: 15 });

    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);

    await waitFor(() => seen.length === 1);
    app.bump({ count: 1 }); // seq 2
    await waitFor(() => seen.length === 2);

    // Simulate the server process restarting: seq counter resets, fresh state.
    app.seq = 1;
    app.state = { count: 100 };
    await waitFor(() => seen.some((s) => (s.state as { count: number }).count === 100));
    expect(seen.at(-1)).toEqual({ seq: 1, state: { count: 100 } });
  });

  it('dispatch surfaces transport failure as an error envelope, not a throw', async () => {
    const client = httpClient('http://127.0.0.1:1');
    const result = await client.dispatch('poke', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('transport');
  });
});

describe('wsClient', () => {
  it('subscribes over WS: initial state frame plus pushed snapshots', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });

    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);

    await waitFor(() => seen.length === 1);
    app.bump({ count: 5 });
    await waitFor(() => seen.length === 2);
    expect(seen[1]).toEqual({ seq: 2, state: { count: 5 } });
  });

  it('falls back to http polling when the WS upgrade fails', async () => {
    const app = await miniApp(false); // no upgrade handler → socket destroyed
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 15 });

    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);

    await waitFor(() => seen.length >= 1);
    app.bump({ count: 9 });
    await waitFor(() => seen.some((s) => s.seq === 2));
  });

  it('accepts a pushed frame with regressed seq (server restart) instead of freezing', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });

    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);

    await waitFor(() => seen.length === 1);
    app.bump({ count: 5 }); // seq 2
    await waitFor(() => seen.length === 2);

    // Simulate a restarted server pushing from a reset counter.
    app.seq = 0;
    app.bump({ count: 50 }); // pushes seq 1
    await waitFor(() => seen.some((s) => (s.state as { count: number }).count === 50));
    expect(seen.at(-1)).toEqual({ seq: 1, state: { count: 50 } });
  });

  it('unsub carries the params used at sub time so the server can match the subscription', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });

    const seen: number[] = [];
    const stop = client.subscribe('counter', { who: 'sazed' }, (seq) => seen.push(seq));
    await waitFor(() => app.subs.length === 1);
    expect(app.subs[0]!.params).toEqual({ who: 'sazed' });
    await waitFor(() => seen.length === 1);

    stop();
    // Params-keyed match: without params on the unsub frame this never empties.
    await waitFor(() => app.subs.length === 0);
    app.bump({ count: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([1]);
  });

  it('unsubscribe stops delivery', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });

    const seen: number[] = [];
    const stop = client.subscribe('counter', {}, (seq) => seen.push(seq));
    await waitFor(() => seen.length === 1);
    stop();
    await waitFor(() => app.subs.length === 0);
    app.bump({ count: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([1]);
  });
});

// ------------------------------------------------------------------ records

type Heard = { seq: number; record: JsonObject | null; stream: string };

describe('records() — the same sequence on both transports', () => {
  /** Three records, one on another stream, so the filter is exercised too. */
  function appendThree(app: MiniApp): number[] {
    const seqs = [
      app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' }),
      app.append('other.jsonl', { by: 99, actor: 'mini', at: '2026-09-04T00:00:02Z' }),
      app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:03Z' }),
    ];
    return [seqs[0]!, seqs[2]!];
  }

  it('httpClient polls the twin from `after` and delivers each record with its seq and stream', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base, { pollMs: 15 });
    const start = app.seq;
    // One record already in the ring before the subscription: `after` is honoured.
    const before = app.append('bumps.jsonl', { by: 0, actor: 'mini', at: '2026-09-04T00:00:00Z' });

    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', start, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => heard.length === 1);
    expect(heard[0]).toEqual({ seq: before, record: { by: 0, actor: 'mini', at: '2026-09-04T00:00:00Z' }, stream: 'bumps.jsonl' });

    const expected = appendThree(app);
    await waitFor(() => heard.length === 3);
    expect(heard.map((h) => h.seq)).toEqual([before, ...expected]);
    expect(heard.map((h) => (h.record as { by: number }).by)).toEqual([0, 1, 2]);
    expect(heard.every((h) => h.stream === 'bumps.jsonl')).toBe(true);
    // The poll asked from the cursor each time, never from behind it, and
    // once caught up it asks from the head.
    expect(app.recordAsks[0]).toBe(start);
    await waitFor(() => app.recordAsks.includes(app.seq));
    expect(Math.max(...app.recordAsks)).toBe(app.seq);
  });

  it('wsClient subscribes by stream, catches up through the twin, and hears record frames live', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });
    const start = app.seq;
    const before = app.append('bumps.jsonl', { by: 0, actor: 'mini', at: '2026-09-04T00:00:00Z' });

    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', start, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => app.streamSubs.length === 1 && heard.length === 1);
    expect(app.streamSubs[0]!.stream).toBe('bumps.jsonl');
    expect(heard[0]!.seq).toBe(before);

    const expected = appendThree(app);
    await waitFor(() => heard.length === 3);
    expect(heard.map((h) => h.seq)).toEqual([before, ...expected]);
    expect(heard.map((h) => (h.record as { by: number }).by)).toEqual([0, 1, 2]);
    // Live frames came over the socket: the twin was asked once, at open.
    expect(app.recordAsks).toEqual([start]);
  });

  it('both transports deliver the same sequence for the same stream', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const start = app.seq;
    const overHttp: Heard[] = [];
    const overWs: Heard[] = [];
    cleanups.push(
      httpClient(app.base, { pollMs: 15 }).records('bumps.jsonl', start, (seq, record, stream) =>
        overHttp.push({ seq, record, stream }),
      ),
    );
    cleanups.push(
      wsClient(app.base, { pollMs: 5000 }).records('bumps.jsonl', start, (seq, record, stream) =>
        overWs.push({ seq, record, stream }),
      ),
    );
    await waitFor(() => app.streamSubs.length === 1);
    appendThree(app);
    appendThree(app);
    await waitFor(() => overHttp.length === 4 && overWs.length === 4);
    expect(overWs).toEqual(overHttp);
    expect(overWs.map((h) => (h.record as { by: number }).by)).toEqual([1, 2, 1, 2]);
  });

  it('wsClient resubscribes after a drop and the resync carries the last seq: nothing lost, nothing twice', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 10 });
    const start = app.seq;
    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', start, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => app.streamSubs.length === 1);
    const first = app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });
    await waitFor(() => heard.length === 1);

    // Server-side drop of only the socket; the app stays reachable, and a
    // record lands while the socket is down.
    const doomed = app.sockets.splice(0);
    app.streamSubs = [];
    for (const s of doomed) s.destroy();
    const asksBefore = app.recordAsks.length;
    const during = app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:02Z' });

    // The fallback poll or the reopen's catch-up hears it — asked from the
    // last seq heard, not from the original `after`.
    await waitFor(() => heard.length === 2);
    await waitFor(() => app.streamSubs.length === 1, 4000);
    const asks = app.recordAsks.slice(asksBefore);
    expect(asks.length).toBeGreaterThanOrEqual(1);
    expect(asks[0]).toBe(first);
    expect(asks.every((a) => a >= first)).toBe(true);

    // Live again over the new socket; the sequence is exact.
    const after = app.append('bumps.jsonl', { by: 3, actor: 'mini', at: '2026-09-04T00:00:03Z' });
    await waitFor(() => heard.length === 3);
    await new Promise((r) => setTimeout(r, 60));
    expect(heard.map((h) => h.seq)).toEqual([first, during, after]);
  });

  it('a 410 from the twin resets the cursor to the answered seq and says so with a null record', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base, { pollMs: 15 });
    app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });
    app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:02Z' });
    app.forgotten = app.seq; // the ring holds nothing before the head

    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', 0, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => heard.length === 1);
    // The re-snapshot signal: a null record at the head the server named.
    expect(heard[0]).toEqual({ seq: app.seq, record: null, stream: 'bumps.jsonl' });

    // And it continues from there — the next record is heard, once.
    const next = app.append('bumps.jsonl', { by: 3, actor: 'mini', at: '2026-09-04T00:00:03Z' });
    await waitFor(() => heard.length === 2);
    expect(heard[1]!.seq).toBe(next);
    await new Promise((r) => setTimeout(r, 60));
    expect(heard).toHaveLength(2);
    expect(app.recordAsks.filter((a) => a === 0)).toHaveLength(1);
  });

  it('a twin slower than the poll interval never delivers a record twice', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    app.slowRecordsMs = 60;
    const client = httpClient(app.base, { pollMs: 10 });
    const start = app.seq;
    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', start, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    const seqs = [
      app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' }),
      app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:02Z' }),
    ];
    await waitFor(() => heard.length >= 2);
    // Six intervals' worth of ticks would have overlapped the one slow pull;
    // the sequence is still the two records, once each.
    await new Promise((r) => setTimeout(r, 150));
    expect(heard.map((h) => h.seq)).toEqual(seqs);
    // Positive control: the poll did keep asking, from the head, after the
    // slow answer — it stalled, it did not stop.
    expect(app.recordAsks.filter((a) => a === app.seq).length).toBeGreaterThanOrEqual(1);
  });

  it('a record frame for another stream on the same socket is not this subscription’s', async () => {
    // One socket per subscription today, but the frame carries the stream for
    // a reason: a server that multiplexed (or a stray frame) must not be able
    // to put another stream's records into this callback.
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });
    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', app.seq, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => app.streamSubs.length === 1);

    app.broadcast({ t: 'record', stream: 'other.jsonl', record: { by: 99, actor: 'mini', at: 'x' }, seq: app.seq + 1 });
    // The barrier is a record this subscription DID ask for: it can only
    // arrive after the one above, so hearing exactly one frame means the
    // other stream's was refused.
    const mine = app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });
    await waitFor(() => heard.length === 1);
    expect(heard).toEqual([{ seq: mine, record: { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' }, stream: 'bumps.jsonl' }]);
  });

  it('a record appended while the catch-up pull is in flight is heard once, not twice', async () => {
    // The twin's answer names the head it covered, and a frame at or under
    // that head was in the answer. Without that comparison the buffered frame
    // is delivered on top of the pull that already carried it.
    const app = await miniApp(true);
    cleanups.push(app.close);
    app.slowRecordsMs = 150;
    const client = wsClient(app.base, { pollMs: 5000 });
    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', app.seq, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);

    // The sub frame is sent immediately before the catch-up pull, so a
    // registered stream sub means the pull is in flight and the append below
    // lands in both the socket and the twin's (still unanswered) view.
    await waitFor(() => app.streamSubs.length === 1);
    const during = app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });

    await waitFor(() => heard.length >= 1, 3000);
    await new Promise((r) => setTimeout(r, 200));
    expect(heard.map((h) => h.seq)).toEqual([during]);
    // POSITIVE CONTROL: the socket is live and delivering — the next record
    // is heard, so the single delivery above is not a stalled subscription.
    const after = app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:02Z' });
    await waitFor(() => heard.length === 2);
    expect(heard[1]!.seq).toBe(after);
  });

  it('a restarted server’s regressed seq moves the cursor BACK, so the resync asks from where it is', async () => {
    // The twin of the subscribe path's epoch rule (a regressed seq is a new
    // process, not stale data). A cursor that only ever moved forward would
    // ask the new process for a seq it has not reached, and everything it
    // wrote in between would be answered as "nothing past your seq" and lost.
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 10 });
    const heard: Heard[] = [];
    const stop = client.records('bumps.jsonl', app.seq, (seq, record, stream) => heard.push({ seq, record, stream }));
    cleanups.push(stop);
    await waitFor(() => app.streamSubs.length === 1);
    const before = app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });
    await waitFor(() => heard.length === 1);

    // The server restarts: the seq counter resets and the in-process ring is
    // empty again. The first record of the new lifetime is heard live.
    app.seq = 0;
    app.ring = [];
    const restarted = app.append('bumps.jsonl', { by: 2, actor: 'mini', at: '2026-09-04T00:00:02Z' });
    expect(restarted).toBeLessThan(before);
    await waitFor(() => heard.length === 2);

    // Now the socket drops and one more record lands while it is down — at a
    // seq the cursor has already SEEN once, in the previous lifetime.
    const doomed = app.sockets.splice(0);
    app.streamSubs = [];
    for (const s of doomed) s.destroy();
    const asksBefore = app.recordAsks.length;
    const during = app.append('bumps.jsonl', { by: 3, actor: 'mini', at: '2026-09-04T00:00:03Z' });

    await waitFor(() => heard.length === 3, 4000);
    await new Promise((r) => setTimeout(r, 100));
    expect(app.recordAsks.slice(asksBefore)[0]).toBe(restarted);
    expect(heard.map((h) => h.seq)).toEqual([before, restarted, during]);
    expect(heard.map((h) => (h.record as { by: number }).by)).toEqual([1, 2, 3]);
  });

  it('a server with no records route is retried with a growing backoff, and says so once', async () => {
    // An older server (no /loupe/records) answers 404, the catch-up cannot be
    // done honestly, and the socket is dropped on purpose. Resetting the retry
    // ladder on `open` made that an unbounded ~500 ms open/close loop with a
    // warning per cycle; the ladder is reset only once a catch-up succeeded.
    const app = await miniApp(true);
    cleanups.push(app.close);
    app.noRecordsRoute = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timers = vi.spyOn(globalThis, 'setTimeout');
    cleanups.push(() => {
      warn.mockRestore();
      timers.mockRestore();
    });

    const client = wsClient(app.base, { pollMs: 20 });
    const stop = client.records('bumps.jsonl', 0, () => {});
    cleanups.push(stop);

    // Picked out by the callback rather than by the delay: fetch's own
    // machinery (undici) schedules timeouts of 499 and 3000 ms while this
    // runs, and a delay-range filter would read them as rungs of the ladder.
    // The reopen's callback is the only one that names openSocket.
    const backoffs = (): number[] =>
      timers.mock.calls
        .filter((c) => String(c[0]).includes('openSocket'))
        .map((c) => c[1])
        .filter((ms): ms is number => typeof ms === 'number');
    await waitFor(() => backoffs().length >= 3, 8000);
    const ladder = backoffs();
    expect(ladder[0]).toBeGreaterThanOrEqual(400);
    expect(ladder[0]).toBeLessThanOrEqual(600);
    expect(ladder[1]).toBeGreaterThanOrEqual(800);
    expect(ladder[1]).toBeLessThanOrEqual(1200);
    expect(ladder[2]).toBeGreaterThanOrEqual(1600);
    expect(ladder[2]).toBeLessThanOrEqual(2400);
    // Said once for the subscription, however many poll loops it started.
    const said = warn.mock.calls.filter((c) => String(c[0]).includes('/loupe/records/bumps.jsonl'));
    expect(said).toHaveLength(1);
  }, 20000);

  it('unsubscribe sends unsub by stream and stops delivery', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 5000 });
    const heard: number[] = [];
    const stop = client.records('bumps.jsonl', app.seq, (seq) => heard.push(seq));
    await waitFor(() => app.streamSubs.length === 1);
    stop();
    await waitFor(() => app.streamSubs.length === 0);
    app.append('bumps.jsonl', { by: 1, actor: 'mini', at: '2026-09-04T00:00:01Z' });
    await new Promise((r) => setTimeout(r, 50));
    expect(heard).toEqual([]);
  });
});

// -------------------------------------------------------- connection state

/** Event-loop-yielding waitFor for phases where setTimeout is faked. */
async function ioWaitFor(check: () => boolean, iters = 5000): Promise<void> {
  for (let i = 0; i < iters; i += 1) {
    if (check()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('ioWaitFor timed out');
}

describe('connection state', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('httpClient: fires the current state immediately, then transitions on poll failure/recovery', async () => {
    const app = await miniApp(false);
    cleanups.push(app.close);
    const client = httpClient(app.base, { pollMs: 15 });

    const states: ConnectionState[] = [];
    cleanups.push(client.connection!((s) => states.push(s)));
    expect(states).toEqual(['connected']); // immediate, synchronous, optimistic

    const seen: number[] = [];
    const stop = client.subscribe('counter', {}, (seq) => seen.push(seq));
    cleanups.push(stop);
    await waitFor(() => seen.length === 1);
    expect(states).toEqual(['connected']); // healthy polling emits nothing new

    app.failing = true; // 5xx = the app is not answering
    await waitFor(() => states.at(-1) === 'reconnecting');
    app.failing = false;
    await waitFor(() => states.at(-1) === 'connected');
    expect(states).toEqual(['connected', 'reconnecting', 'connected']);
  });

  it('wsClient: WS drop → reconnecting, poll success → connected, WS reopens and re-subs (pushes flow again)', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 10 });

    const states: ConnectionState[] = [];
    cleanups.push(client.connection!((s) => states.push(s)));
    const seen: Array<{ seq: number; state: Json }> = [];
    const stop = client.subscribe('counter', {}, (seq, state) => seen.push({ seq, state }));
    cleanups.push(stop);
    await waitFor(() => seen.length === 1 && app.subs.length === 1);

    // Server-side drop of only the socket: the app itself stays reachable.
    const doomed = app.sockets.splice(0);
    app.subs = [];
    for (const s of doomed) s.destroy();

    // The drop marks reconnecting; the fallback poll answers, so the state is
    // legitimately connected again while WS is down.
    await waitFor(() => states.includes('reconnecting'));
    await waitFor(() => states.at(-1) === 'connected');

    // The backed-off reopen re-sends sub — the server sees a fresh subscription
    // (today's code would have polled forever and never retried WS).
    await waitFor(() => app.subs.length === 1, 4000);
    app.bump({ count: 41 });
    await waitFor(() => seen.some((s) => (s.state as { count: number }).count === 41));
    expect(states.at(-1)).toBe('connected');
  });

  it('wsClient: retries with growing backoff delays (500/1000/2000 order, jitter-tolerant)', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 20 });

    const seen: number[] = [];
    const stop = client.subscribe('counter', {}, (seq) => seen.push(seq));
    cleanups.push(stop);
    await waitFor(() => seen.length === 1);

    // Record scheduled retry delays via a callthrough spy (the poll uses
    // setInterval; the only setTimeout delays in [300, 10000) are the reopen
    // backoff — the gone timer is 30000).
    const spy2 = vi.spyOn(globalThis, 'setTimeout');

    await app.close(); // the whole app dies mid-session
    await waitFor(() => {
      const backoffs = spy2.mock.calls
        .map((c) => c[1])
        .filter((ms): ms is number => typeof ms === 'number' && ms >= 300 && ms < 10_000);
      return backoffs.length >= 3;
    }, 8000);
    const backoffs = spy2.mock.calls
      .map((c) => c[1])
      .filter((ms): ms is number => typeof ms === 'number' && ms >= 300 && ms < 10_000);
    // min(500·2^n, 8000) ± 20% jitter
    expect(backoffs[0]).toBeGreaterThanOrEqual(400);
    expect(backoffs[0]).toBeLessThanOrEqual(600);
    expect(backoffs[1]).toBeGreaterThanOrEqual(800);
    expect(backoffs[1]).toBeLessThanOrEqual(1200);
    expect(backoffs[2]).toBeGreaterThanOrEqual(1600);
    expect(backoffs[2]).toBeLessThanOrEqual(2400);
  });

  it('wsClient: 30 s of continuous non-contact → gone (still retrying)', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);
    const client = wsClient(app.base, { pollMs: 20 });

    const states: ConnectionState[] = [];
    cleanups.push(client.connection!((s) => states.push(s)));
    const seen: number[] = [];
    const stop = client.subscribe('counter', {}, (seq) => seen.push(seq));
    cleanups.push(stop);
    await waitFor(() => seen.length === 1);

    // Fake ONLY setTimeout/clearTimeout before the drop, so the gone timer and
    // the reopen backoff are controllable while sockets/fetch/setInterval stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await app.close();
    await ioWaitFor(() => states.includes('reconnecting'));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(states.at(-1)).toBe('gone');
    vi.useRealTimers();
  });

  it('wsClient: unsubscribe cancels the retry chain and the fallback poll (no timers survive)', async () => {
    // A dead address: WS never opens, the poll never answers.
    const client = wsClient('http://127.0.0.1:1', { pollMs: 15 });
    const states: ConnectionState[] = [];
    cleanups.push(client.connection!((s) => states.push(s)));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const stop = client.subscribe('counter', {}, () => {});
    await waitFor(() => states.at(-1) === 'reconnecting');
    stop();

    await new Promise((r) => setTimeout(r, 120));
    const fetchCount = fetchSpy.mock.calls.length;
    const retryCount = timeoutSpy.mock.calls.filter(
      (c) => typeof c[1] === 'number' && c[1] >= 300 && c[1] < 10_000,
    ).length;
    // A surviving retry (first is ~500 ms) would fire in this window and
    // schedule the next backoff; a surviving poll would keep fetching. Sleep
    // in sub-300 ms chunks so the test's own timers stay out of the range.
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 250));
    expect(fetchSpy.mock.calls.length).toBe(fetchCount);
    expect(
      timeoutSpy.mock.calls.filter((c) => typeof c[1] === 'number' && c[1] >= 300 && c[1] < 10_000)
        .length,
    ).toBe(retryCount);
  });
});

describe('the actor a client signs with (track "the agent inhabits the same state", R4)', () => {
  it('sends x-loupe-actor on dispatch when opts.actor is set, on both transports', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);

    await httpClient(app.base, { actor: 'Kelsier-1' }).dispatch('poke', { hard: true });
    // A WS client dispatches over HTTP — the socket carries subscriptions
    // only — so the header rides the same POST on both.
    await wsClient(app.base, { actor: 'Vin-204811' }).dispatch('poke', {});

    // POSITIVE CONTROL: both dispatches actually reached the app, so the
    // header list below is two claims and not two silences.
    expect(app.verbCalls.map((c) => c.verb)).toEqual(['poke', 'poke']);
    expect(app.verbActors).toEqual(['Kelsier-1', 'Vin-204811']);
    // The body is unchanged by naming oneself: identity is transport.
    expect(app.verbCalls[0]!.params).toEqual({ hard: true });
  });

  it('sends no identity header at all when opts.actor is unset — what every fabrial client is', async () => {
    const app = await miniApp(true);
    cleanups.push(app.close);

    await httpClient(app.base).dispatch('poke', {});
    await httpClient(app.base, { pollMs: 15 }).dispatch('poke', {});
    await wsClient(app.base).dispatch('poke', {});

    expect(app.verbCalls).toHaveLength(3);
    expect(app.verbActors).toEqual([null, null, null]);
  });
});
