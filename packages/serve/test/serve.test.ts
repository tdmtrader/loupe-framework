// Harness conformance: the defineApp server must speak §5 exactly — the
// protocol schemas are the arbiter (zAppDescriptor / zProjectionEnvelope /
// zVerbOk / zVerbError / zServerFrame all parse its live output).
import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import {
  zAppDescriptor,
  zProjectionEnvelope,
  zRecordsEnvelope,
  zServerFrame,
  zVerbError,
  zVerbOk,
} from '@loupe/protocol';
import { defineApp, isLoopbackAddress, toJson, type LoupeAppServer } from '../src/index.ts';

interface CounterStore {
  count: number;
  notes: Array<{ text: string; actor: string; at: string }>;
}

interface AppOptions {
  recordRing?: number;
  /** Opt in to `X-Loupe-Actor` (track "the agent inhabits the same state", R4). */
  actors?: 'header';
  /** The configured actor, i.e. what a dispatch is stamped with by default. */
  actor?: string;
}

function makeApp(opts?: AppOptions): { app: LoupeAppServer; store: CounterStore } {
  const store: CounterStore = { count: 0, notes: [] };
  const app = defineApp({
    name: 'test-app',
    version: '0.0.1',
    store,
    ...(opts?.recordRing !== undefined ? { recordRing: opts.recordRing } : {}),
    ...(opts?.actors !== undefined ? { actors: opts.actors } : {}),
    ...(opts?.actor !== undefined ? { actor: opts.actor } : {}),
    projections: {
      counter: {
        derive: (s) => ({ count: s.count, notes: toJson(s.notes) }),
      },
      echo: {
        params: ['who'],
        derive: (_s, params) => ({ who: params['who'] ?? null }),
      },
      doubled: {
        derive: (s) => ({ twice: s.count * 2 }),
      },
      dump: {
        params: ['a', 'b'],
        derive: (_s, params) => ({ ...params }),
      },
    },
    verbs: {
      bump: {
        description: 'bump the counter',
        params: z.strictObject({ by: z.number().int() }),
        optimistic: [{ op: 'replace', path: '/count', value: '${params.by}' }],
        records: [{ stream: 'bumps.jsonl' }],
        execute: (params, ctx, s) => {
          if (params.by === 13) return { ok: false, error: { code: 'unlucky', message: 'not 13' } };
          s.count += params.by;
          const record = { by: params.by, actor: ctx.actor, at: ctx.at };
          return { ok: true, seq: 0, records: [{ stream: 'bumps.jsonl', record }] };
        },
      },
      // Two records from ONE dispatch share a seq — the case the ring's
      // eviction line has to reason about, since a bound can fall between
      // them. `single` writes one, so a test can make a pair straddle it.
      pair: {
        description: 'append two records at once (or one)',
        params: z.strictObject({ single: z.boolean().optional() }),
        records: [{ stream: 'pairs.jsonl' }],
        execute: (params, ctx) => {
          const line = (n: number) => ({ n, actor: ctx.actor, at: ctx.at });
          const records = [{ stream: 'pairs.jsonl', record: line(1) }];
          if (params.single !== true) records.push({ stream: 'pairs.jsonl', record: line(2) });
          return { ok: true, seq: 0, records };
        },
      },
    },
  });
  return { app, store };
}

let running: LoupeAppServer | null = null;
afterEach(async () => {
  if (running) await running.close();
  running = null;
});

async function start(
  opts?: AppOptions & { host?: string },
): Promise<{ app: LoupeAppServer; store: CounterStore; base: string }> {
  const { app, store } = makeApp(opts);
  const host = opts?.host ?? '127.0.0.1';
  await app.listen(0, host);
  running = app;
  return { app, store, base: `http://${host}:${app.port()}` };
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const startAt = Date.now();
  while (!check()) {
    if (Date.now() - startAt > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('defineApp HTTP surface', () => {
  it('GET /loupe/app answers a schema-valid descriptor with JSON-Schema verb params', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/loupe/app`);
    expect(res.status).toBe(200);
    const descriptor = zAppDescriptor.parse(await res.json());
    expect(descriptor.protocol).toBe(1);
    expect(descriptor.app).toEqual({ name: 'test-app', version: '0.0.1' });
    expect(descriptor.projections).toEqual([
      { name: 'counter' },
      { name: 'echo', params: ['who'] },
      { name: 'doubled' },
      { name: 'dump', params: ['a', 'b'] },
    ]);
    const bump = descriptor.verbs.find((v) => v.name === 'bump')!;
    expect(bump.params).toMatchObject({
      type: 'object',
      required: ['by'],
      additionalProperties: false,
      properties: { by: { type: 'integer' } },
    });
    expect(bump.optimistic).toEqual([{ op: 'replace', path: '/count', value: '${params.by}' }]);
    expect(bump.records).toEqual([{ stream: 'bumps.jsonl' }]);
  });

  it('GET /loupe/state/:projection serves envelopes; ?after=seq answers 304 until seq advances', async () => {
    const { base, store, app } = await start();
    const first = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/counter`)).json());
    expect(first.projection).toBe('counter');
    expect(first.state).toMatchObject({ count: 0 });

    const unchanged = await fetch(`${base}/loupe/state/counter?after=${first.seq}`);
    expect(unchanged.status).toBe(304);

    store.count = 7;
    app.touch();
    const changed = await fetch(`${base}/loupe/state/counter?after=${first.seq}`);
    expect(changed.status).toBe(200);
    const second = zProjectionEnvelope.parse(await changed.json());
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(second.state).toMatchObject({ count: 7 });
  });

  it('projection params flow into derive; unknown projections 404 with an error envelope', async () => {
    const { base } = await start();
    const echoed = zProjectionEnvelope.parse(
      await (await fetch(`${base}/loupe/state/echo?who=sazed`)).json(),
    );
    expect(echoed.state).toEqual({ who: 'sazed' });

    const missing = await fetch(`${base}/loupe/state/nope`);
    expect(missing.status).toBe(404);
    const err = zVerbError.parse(await missing.json());
    expect(err.error.code).toBe('unknown_projection');
  });

  it('POST /loupe/verbs/:name validates, stamps actor/at, and answers the authoritative seq', async () => {
    const { base, store } = await start();
    const before = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/counter`)).json());

    const res = await fetch(`${base}/loupe/verbs/bump`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { by: 5 } }),
    });
    expect(res.status).toBe(200);
    const ok = zVerbOk.parse(await res.json());
    expect(ok.seq).toBeGreaterThan(before.seq);
    const record = ok.records[0]!.record as { actor: string; at: string };
    // No config.actor → the harness stamps the app name, not a personal user.
    expect(record.actor).toBe('test-app');
    expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(store.count).toBe(5);

    const after = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/counter`)).json());
    expect(after.state).toMatchObject({ count: 5 });
    expect(after.seq).toBe(ok.seq);
  });

  it('?after beyond the current seq (client outlived a server restart) answers 200, not 304', async () => {
    const { base } = await start();
    const first = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/counter`)).json());
    const res = await fetch(`${base}/loupe/state/counter?after=${first.seq + 1000}`);
    expect(res.status).toBe(200);
    const envelope = zProjectionEnvelope.parse(await res.json());
    expect(envelope.state).toMatchObject({ count: 0 });
  });

  it('param sets with reserved characters get distinct live entries (no key collision)', async () => {
    const { base } = await start();
    // Pre-fix, {a: '1&b=2'} and {a: '1', b: '2'} shared the key "dump?a=1&b=2".
    const tricky = zProjectionEnvelope.parse(
      await (await fetch(`${base}/loupe/state/dump?a=${encodeURIComponent('1&b=2')}`)).json(),
    );
    const plain = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/dump?a=1&b=2`)).json());
    expect(tricky.state).toEqual({ a: '1&b=2' });
    expect(plain.state).toEqual({ a: '1', b: '2' });

    // Re-fetch the first set: same entry, same seq — no flip-flop from overwrites.
    const again = zProjectionEnvelope.parse(
      await (await fetch(`${base}/loupe/state/dump?a=${encodeURIComponent('1&b=2')}`)).json(),
    );
    expect(again.seq).toBe(tricky.seq);
    expect(again.state).toEqual({ a: '1&b=2' });
  });

  it('invalid params → 400 invalid_params; domain errors pass through; unknown verb → 404', async () => {
    const { base } = await start();
    const bad = await fetch(`${base}/loupe/verbs/bump`, {
      method: 'POST',
      body: JSON.stringify({ params: { by: 'many' } }),
    });
    expect(bad.status).toBe(400);
    expect(zVerbError.parse(await bad.json()).error.code).toBe('invalid_params');

    const domain = await fetch(`${base}/loupe/verbs/bump`, {
      method: 'POST',
      body: JSON.stringify({ params: { by: 13 } }),
    });
    expect(domain.status).toBe(400);
    expect(zVerbError.parse(await domain.json()).error.code).toBe('unlucky');

    const missing = await fetch(`${base}/loupe/verbs/nope`, {
      method: 'POST',
      body: JSON.stringify({ params: {} }),
    });
    expect(missing.status).toBe(404);
    expect(zVerbError.parse(await missing.json()).error.code).toBe('unknown_verb');
  });
});

describe('defineApp WS surface (snapshot-only push)', () => {
  it('an upgrade outside /loupe/ws is answered 400, not a bare reset', async () => {
    const { base } = await start();
    const status = await new Promise<number | undefined>((resolveStatus, reject) => {
      const req = request(`${base}/loupe/elsewhere`, {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
      });
      req.on('response', (res) => { res.resume(); resolveStatus(res.statusCode); });
      req.on('upgrade', () => reject(new Error('upgraded outside /loupe/ws')));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('sub answers a state frame and touch() pushes full snapshots; bad frames never drop the socket', async () => {
    const { base, store, app } = await start();
    const socket = new WebSocket(`${base.replace('http', 'ws')}/loupe/ws`);
    const frames: unknown[] = [];
    const nextFrame = () =>
      new Promise<unknown>((resolveFrame) => {
        socket.addEventListener(
          'message',
          (event) => {
            const frame = JSON.parse(String((event as MessageEvent).data));
            frames.push(frame);
            resolveFrame(frame);
          },
          { once: true },
        );
      });
    await new Promise<void>((resolveOpen) => socket.addEventListener('open', () => resolveOpen(), { once: true }));

    socket.send('this is not a frame');
    socket.send(JSON.stringify({ t: 'sub', projection: 'counter' }));
    const first = zServerFrame.parse(await nextFrame());
    expect(first).toMatchObject({ t: 'state', projection: 'counter', state: { count: 0 } });

    store.count = 42;
    const pushed = nextFrame();
    app.touch();
    const second = zServerFrame.parse(await pushed);
    expect(second).toMatchObject({ t: 'state', projection: 'counter', state: { count: 42 } });
    expect((second as { seq: number }).seq).toBeGreaterThan((first as { seq: number }).seq);

    socket.close();
  });

  it('one verb changing several projections stamps them all with the response seq', async () => {
    const { base } = await start();
    const socket = new WebSocket(`${base.replace('http', 'ws')}/loupe/ws`);
    const frames: Array<{ t: string; projection: string; seq: number }> = [];
    socket.addEventListener('message', (event) =>
      frames.push(JSON.parse(String((event as MessageEvent).data)) as { t: string; projection: string; seq: number }),
    );
    await new Promise<void>((resolveOpen) => socket.addEventListener('open', () => resolveOpen(), { once: true }));

    socket.send(JSON.stringify({ t: 'sub', projection: 'counter' }));
    socket.send(JSON.stringify({ t: 'sub', projection: 'doubled' }));
    await waitFor(() => frames.length === 2);

    const res = await fetch(`${base}/loupe/verbs/bump`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ params: { by: 3 } }),
    });
    const ok = zVerbOk.parse(await res.json());
    await waitFor(() => frames.length >= 4);

    const pushed = frames.slice(2);
    const counterFrame = pushed.find((f) => f.projection === 'counter')!;
    const doubledFrame = pushed.find((f) => f.projection === 'doubled')!;
    // Both projections changed by the one verb carry the SAME seq as the verb
    // response, so a push on either can confirm the optimistic overlay.
    expect(counterFrame.seq).toBe(ok.seq);
    expect(doubledFrame.seq).toBe(ok.seq);
    socket.close();
  });

  it('unsub stops the push', async () => {
    const { base, store, app } = await start();
    const socket = new WebSocket(`${base.replace('http', 'ws')}/loupe/ws`);
    const received: unknown[] = [];
    socket.addEventListener('message', (event) => received.push(JSON.parse(String((event as MessageEvent).data))));
    await new Promise<void>((resolveOpen) => socket.addEventListener('open', () => resolveOpen(), { once: true }));

    socket.send(JSON.stringify({ t: 'sub', projection: 'counter' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);

    socket.send(JSON.stringify({ t: 'unsub', projection: 'counter' }));
    await new Promise((r) => setTimeout(r, 50));
    store.count = 9;
    app.touch();
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    socket.close();
  });
});

// ------------------------------------------------------------ the record wire

/** Open a socket, collect every frame it receives, resolve once it is open. */
async function openCollecting(base: string): Promise<{ socket: WebSocket; frames: Array<{ t: string; seq: number }> }> {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/loupe/ws`);
  const frames: Array<{ t: string; seq: number }> = [];
  socket.addEventListener('message', (event) =>
    frames.push(JSON.parse(String((event as MessageEvent).data)) as { t: string; seq: number }),
  );
  await new Promise<void>((resolveOpen) => socket.addEventListener('open', () => resolveOpen(), { once: true }));
  return { socket, frames };
}

async function bump(base: string, by: number): Promise<{ seq: number }> {
  const res = await fetch(`${base}/loupe/verbs/bump`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: { by } }),
  });
  return zVerbOk.parse(await res.json());
}

/** The two-records-in-one-dispatch verb; `single` makes it one. */
async function pair(base: string, single = false): Promise<{ seq: number }> {
  const res = await fetch(`${base}/loupe/verbs/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: single ? { single: true } : {} }),
  });
  return zVerbOk.parse(await res.json());
}

async function fetchRecords(base: string, stream: string, after: number | string): Promise<Response> {
  return fetch(`${base}/loupe/records/${stream}?after=${after}`);
}

describe('the record wire (track "the agent inhabits the same state", AC1)', () => {
  it('a projection subscriber never sees a record frame; a stream subscriber sees every one, in order', async () => {
    const { base } = await start();
    const projection = await openCollecting(base);
    const stream = await openCollecting(base);
    projection.socket.send(JSON.stringify({ t: 'sub', projection: 'counter' }));
    stream.socket.send(JSON.stringify({ t: 'sub', stream: 'bumps.jsonl' }));
    await waitFor(() => projection.frames.length === 1);
    const startSeq = zProjectionEnvelope.parse(await (await fetch(`${base}/loupe/state/counter`)).json()).seq;

    const responses: number[] = [];
    for (let i = 1; i <= 10; i += 1) responses.push((await bump(base, i)).seq);
    await waitFor(() => projection.frames.length >= 11 && stream.frames.length >= 10);

    // The zero is trusted only after the ten: the projection socket received
    // at least ten state frames across the ten dispatches, and not one record.
    const states = projection.frames.filter((f) => f.t === 'state');
    expect(states.length).toBeGreaterThanOrEqual(11);
    expect(projection.frames.filter((f) => f.t === 'record')).toEqual([]);

    // Exactly ten record frames, each a valid server frame, seqs strictly
    // increasing, and each at or past the seq of the state frame for the same
    // dispatch and the seq the dispatcher was answered.
    const records = stream.frames.filter((f) => f.t === 'record');
    expect(records).toHaveLength(10);
    expect(stream.frames).toHaveLength(10);
    for (const frame of records) zServerFrame.parse(frame);
    const pushedStates = states.slice(1);
    for (let i = 0; i < 10; i += 1) {
      const record = records[i]!;
      if (i > 0) expect(record.seq).toBeGreaterThan(records[i - 1]!.seq);
      expect(record.seq).toBeGreaterThanOrEqual(pushedStates[i]!.seq);
      expect(record.seq).toBeGreaterThanOrEqual(responses[i]!);
    }

    // The poll twin answers the same ten for ?after=<start>, the head at the
    // last of them.
    const polled = zRecordsEnvelope.parse(
      await (await fetch(`${base}/loupe/records/bumps.jsonl?after=${startSeq}`)).json(),
    );
    expect(polled.stream).toBe('bumps.jsonl');
    expect(polled.records.map((r) => r.seq)).toEqual(records.map((r) => r.seq));
    expect(polled.records.map((r) => (r.record as { by: number }).by)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(polled.seq).toBe(responses[9]);

    // And nothing past the head: the next poll is empty, not an error.
    const drained = zRecordsEnvelope.parse(
      await (await fetch(`${base}/loupe/records/bumps.jsonl?after=${polled.seq}`)).json(),
    );
    expect(drained.records).toEqual([]);

    projection.socket.close();
    stream.socket.close();
  });

  it('a record advances the seq even when no projection changed, so a poller never misses one', async () => {
    const { base } = await start();
    // Nothing is live and bump by 0 changes no derived state: the record is
    // still an event, and the dispatcher's seq moves past the previous one.
    const first = await bump(base, 0);
    const second = await bump(base, 0);
    expect(second.seq).toBeGreaterThan(first.seq);
    const polled = zRecordsEnvelope.parse(
      await (await fetch(`${base}/loupe/records/bumps.jsonl?after=${first.seq}`)).json(),
    );
    expect(polled.records.map((r) => r.seq)).toEqual([second.seq]);
  });

  it('a stream nobody has written is answered empty, and after=0 on an empty ring is not a 410', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/loupe/records/never.jsonl?after=0`);
    expect(res.status).toBe(200);
    expect(zRecordsEnvelope.parse(await res.json())).toEqual({ stream: 'never.jsonl', seq: 0, records: [] });
    const bad = await fetch(`${base}/loupe/records/never.jsonl?after=soon`);
    expect(bad.status).toBe(400);
    expect(zVerbError.parse(await bad.json()).error.code).toBe('invalid_params');
  });

  it('an after older than the ring answers 410 with a sentence naming the oldest seq still held', async () => {
    const { base } = await start({ recordRing: 256 });
    let last = 0;
    for (let i = 0; i < 300; i += 1) last = (await bump(base, 1)).seq;

    const gone = await fetch(`${base}/loupe/records/bumps.jsonl?after=0`);
    expect(gone.status).toBe(410);
    const refusal = zRecordsEnvelope.parse(await gone.json());
    expect(refusal.records).toEqual([]);
    expect(refusal.seq).toBe(last);
    expect(refusal.note).toMatch(/no longer held/);
    expect(refusal.note).toMatch(/keeps 256/);
    const oldest = Number(/oldest is seq (\d+)/.exec(refusal.note!)![1]);
    // 300 appended, 256 held: the oldest held is the 45th, and the poll from
    // just before it is the positive control — answered in full.
    expect(oldest).toBe(last - 255);
    const held = zRecordsEnvelope.parse(
      await (await fetch(`${base}/loupe/records/bumps.jsonl?after=${oldest - 1}`)).json(),
    );
    expect(held.records).toHaveLength(256);
    expect(held.records[0]!.seq).toBe(oldest);
    // One before that is on the far side of the line.
    expect((await fetch(`${base}/loupe/records/bumps.jsonl?after=${oldest - 2}`)).status).toBe(410);
  });

  it('a sub naming both a projection and a stream is dropped like any bad frame; unsub by stream stops the push', async () => {
    const { base } = await start();
    const { socket, frames } = await openCollecting(base);
    socket.send(JSON.stringify({ t: 'sub', projection: 'counter', stream: 'bumps.jsonl' }));
    await bump(base, 1);

    // No sleep to prove the emptiness: the record from the GOOD sub below is
    // the barrier. A dropped frame that had in fact registered a subscription
    // would have delivered the `by: 1` bump first, and the one frame here
    // would be that one.
    socket.send(JSON.stringify({ t: 'sub', stream: 'bumps.jsonl' }));
    // This sleep is not a "nothing arrived" wait: a stream sub is answered
    // with nothing, so there is no frame to wait for before the dispatch that
    // must land after it.
    await new Promise((r) => setTimeout(r, 50));
    await bump(base, 2);
    await waitFor(() => frames.length === 1);
    expect(frames[0]!.t).toBe('record');
    expect((frames[0] as unknown as { record: { by: number } }).record.by).toBe(2);

    socket.send(JSON.stringify({ t: 'unsub', stream: 'bumps.jsonl' }));
    await new Promise((r) => setTimeout(r, 50));
    await bump(base, 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(frames).toHaveLength(1);
    socket.close();
  });

  it('one socket subscribed to both hears the state before the record it explains', async () => {
    // R1: the record is the event, the state is what the app looks like after
    // it. On one socket the two are ordered, and this is the order — a
    // renderer that re-reads state on a record must never read the state from
    // before it.
    const { base } = await start();
    const { socket, frames } = await openCollecting(base);
    // Stream sub FIRST: one socket's frames are handled in order, so the
    // state frame answering the second sub is proof the first was registered
    // — a barrier, where a sleep would only be a guess.
    socket.send(JSON.stringify({ t: 'sub', stream: 'bumps.jsonl' }));
    socket.send(JSON.stringify({ t: 'sub', projection: 'counter' }));
    await waitFor(() => frames.length === 1); // the projection sub's state frame

    await bump(base, 4);
    await waitFor(() => frames.length === 3);
    expect(frames.slice(1).map((f) => f.t)).toEqual(['state', 'record']);
    // Both carry the one post-execution seq, so the order is the only thing
    // that distinguishes them and it is the order asserted above.
    expect(frames[1]!.seq).toBe(frames[2]!.seq);
    socket.close();
  });

  it('an `after` past the counter is read as the start of the ring, not as itself', async () => {
    // The epoch rule handleState follows (mirrors "?after beyond the current
    // seq" above): a client that outlived a previous process asks with a seq
    // this one never issued, and gets everything the ring holds rather than
    // silence.
    const { base } = await start();
    const first = await bump(base, 1);
    const second = await bump(base, 2);
    const res = await fetchRecords(base, 'bumps.jsonl', second.seq + 1000);
    expect(res.status).toBe(200);
    const envelope = zRecordsEnvelope.parse(await res.json());
    expect(envelope.records.map((r) => r.seq)).toEqual([first.seq, second.seq]);
    expect(envelope.seq).toBe(second.seq);
  });

  it('`after` must be spelled as digits: 1e3, 0x10 and " 3 " are refused, not guessed at', async () => {
    const { base } = await start();
    await bump(base, 1);
    for (const raw of ['1e3', '0x10', ' 3 ', '-1', '1.0', 'soon']) {
      const res = await fetchRecords(base, 'bumps.jsonl', encodeURIComponent(raw));
      expect(res.status, raw).toBe(400);
      expect(zVerbError.parse(await res.json()).error.code).toBe('invalid_params');
    }
    // POSITIVE CONTROL: the plain spellings of the same idea are answered.
    expect((await fetchRecords(base, 'bumps.jsonl', '0')).status).toBe(200);
    expect((await fetchRecords(base, 'bumps.jsonl', '3')).status).toBe(200);
  });

  it('a bound falling INSIDE one dispatch’s records refuses that seq: half a batch is a gap', async () => {
    // Two records from one dispatch share a seq, so `evicted` can name a seq
    // the ring still holds part of. A caller sitting exactly on that seq has
    // lost the other half and must be told, which the plain `since < evicted`
    // test alone would not do.
    const { base } = await start({ recordRing: 4 });
    const firstPair = await pair(base);
    const secondPair = await pair(base);

    // POSITIVE CONTROL: nothing has been evicted yet, so the same `after` on
    // the same ring is answered in full.
    const intact = zRecordsEnvelope.parse(await (await fetchRecords(base, 'pairs.jsonl', firstPair.seq)).json());
    expect(intact.records.map((r) => r.seq)).toEqual([secondPair.seq, secondPair.seq]);

    // One more record: the ring drops exactly ONE of the first pair, so the
    // eviction line and the oldest held record are both that dispatch's seq.
    const odd = await pair(base, true);
    const split = await fetchRecords(base, 'pairs.jsonl', firstPair.seq);
    expect(split.status).toBe(410);
    const refusal = zRecordsEnvelope.parse(await split.json());
    expect(refusal.note).toMatch(new RegExp(`records after seq ${firstPair.seq} on pairs.jsonl are no longer held`));
    expect(refusal.note).toMatch(new RegExp(`oldest is seq ${firstPair.seq}`));

    // And the seq past the split is still answered: the refusal is about the
    // straddled batch, not about the whole ring.
    const past = zRecordsEnvelope.parse(await (await fetchRecords(base, 'pairs.jsonl', secondPair.seq)).json());
    expect(past.records.map((r) => r.seq)).toEqual([odd.seq]);
  });

  it('the 410 note names the seq the caller was answered from, never one this process never issued', async () => {
    const { base } = await start({ recordRing: 1 });
    const first = await bump(base, 1);
    await bump(base, 2);
    // An `after` from a previous epoch is read as 0 — so the note must say 0,
    // the seq the refusal is actually about, and not the caller's impossible
    // number.
    const gone = await fetchRecords(base, 'bumps.jsonl', first.seq + 1000);
    expect(gone.status).toBe(410);
    const refusal = zRecordsEnvelope.parse(await gone.json());
    expect(refusal.note).toMatch(/^records after seq 0 on bumps\.jsonl/);
    expect(refusal.note).not.toMatch(String(first.seq + 1000));
  });
});

// ------------------------------------------------------- who signed a record

/**
 * The first non-internal IPv4 this machine has, or null. AC5 wants the header
 * refused on a socket that is not loopback, and the only honest way to get one
 * is to bind the harness on an address the machine really answers on — so a
 * machine with no network gets the test skipped rather than a fake address.
 */
function firstExternalIPv4(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

/** Dispatch a bump, optionally claiming a name the way an agent transport does. */
async function bumpAs(base: string, by: number, actor?: string): Promise<string> {
  const res = await fetch(`${base}/loupe/verbs/bump`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(actor !== undefined ? { 'x-loupe-actor': actor } : {}) },
    body: JSON.stringify({ params: { by } }),
  });
  const ok = zVerbOk.parse(await res.json());
  return (ok.records[0]!.record as { actor: string }).actor;
}

const EXTERNAL_IPV4 = firstExternalIPv4();

describe('a record names the actor who caused it (track "the agent inhabits the same state", AC5)', () => {
  it('an app that opted in stamps the name a loopback dispatch claims — and its own when none is claimed', async () => {
    const { base } = await start({ actors: 'header' });
    // POSITIVE CONTROL first: with no header the configured actor is stamped,
    // so the assertion below is about the header and not about the default.
    expect(await bumpAs(base, 1)).toBe('test-app');
    expect(await bumpAs(base, 1, 'Kelsier-1')).toBe('Kelsier-1');
  });

  it('an app that did not opt in stamps its own name however loudly the dispatcher claims otherwise', async () => {
    const { base } = await start({ actor: 'closed-app' });
    expect(await bumpAs(base, 1, 'Kelsier-1')).toBe('closed-app');
    expect(await bumpAs(base, 1)).toBe('closed-app');
  });

  // Skipped, with the reason in the name, on a machine that has no address to
  // be reached at: an unreachable server proves nothing about a refusal.
  (EXTERNAL_IPV4 === null ? it.skip : it)(
    EXTERNAL_IPV4 === null
      ? 'a header on a non-loopback socket is ignored — SKIPPED: this machine has no non-internal IPv4 to bind on'
      : 'a header arriving on a non-loopback socket is ignored: a real principal arrives with a transport, not a claim',
    async () => {
      const { base } = await start({ actors: 'header', host: EXTERNAL_IPV4! });
      // The app opted in and the name is well-formed; only the address is
      // wrong, which is the whole of the second gate.
      expect(await bumpAs(base, 1, 'Kelsier-1')).toBe('test-app');

      // POSITIVE CONTROL: the same app, reached over loopback, honours the
      // same header — so the refusal above is the address and not a typo in
      // the header name. Started outside `start` so the afterEach still owns
      // the non-loopback server this test is actually about.
      const loopback = makeApp({ actors: 'header' });
      await loopback.app.listen(0);
      try {
        expect(await bumpAs(`http://127.0.0.1:${loopback.app.port()}`, 1, 'Kelsier-1')).toBe('Kelsier-1');
      } finally {
        await loopback.app.close();
      }
    },
  );

  it('a claim that is not a name — blank, oversized, or with a space in it — is ignored, not refused', async () => {
    const { base } = await start({ actors: 'header' });
    for (const claim of ['', '   ', 'a'.repeat(65), 'Kelsier 1', 'kelsier@example', 'two\tnames']) {
      // Ignored and not refused: the dispatch still succeeds, still appends,
      // and is simply signed by the app.
      expect(await bumpAs(base, 1, claim), JSON.stringify(claim)).toBe('test-app');
    }
    // POSITIVE CONTROL: one character under the limit, and every character of
    // the alphabet a record may carry, is a name.
    expect(await bumpAs(base, 1, 'a'.repeat(64))).toBe('a'.repeat(64));
    expect(await bumpAs(base, 1, '  Vin-204811.2_x  ')).toBe('Vin-204811.2_x');
  });

  it('the loopback half of the gate, without a network: only this machine is this machine', () => {
    // The test above needs a machine with a non-internal address to bind on
    // and is skipped without one. The predicate itself needs nothing: three
    // spellings of loopback are this machine, anything else is not, and a
    // socket with no remote address (already gone) is not either.
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
