// The proxy is the host's whole surface onto the apps, and identity is the one
// thing it must not carry across it (track "the agent inhabits the same state",
// R4). @loupe/serve honours `X-Loupe-Actor` only from a loopback peer, and this
// proxy dials its apps FROM loopback — in the container, over the pod's own
// loopback — so a header forwarded from here would arrive wearing the exact
// credential the harness checks, and anyone who can reach the host's ingress
// (LOUPE_HOST=0.0.0.0 is the image default) could sign a record with any name.
//
// server.ts is the process the Dockerfile runs, so the test runs it: spawned
// with `tsx`, pointed at a fixture app by the same LOUPE_<APP>_BASE override
// the manifests use. The fixture is deliberately MORE permissive than any real
// app — it stamps whatever `x-loupe-actor` reaches it, with no loopback gate at
// all — so a dispatch through the proxy that comes back stamped with the
// fixture's own name can only mean the header never arrived.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** One request the fixture app saw, and what identity it carried. */
interface Seen {
  path: string;
  upgrade: boolean;
  actor: string | null;
  /** A second header nobody strips: the control that headers cross at all. */
  probe: string | null;
}

interface Fixture {
  base: string;
  port: number;
  seen: Seen[];
  close: () => Promise<void>;
}

function header(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * An app-shaped fixture: POST /loupe/verbs/:name answers a verb result whose
 * record is stamped with the actor the request claimed, or 'fixture-app' when
 * it claimed none — i.e. an app that opted in, with the loopback gate removed
 * so nothing but the header's presence can decide the answer. The upgrade
 * handler completes a WS handshake so the host's splice has something to
 * splice, and records what the upgrade carried.
 */
async function startFixture(): Promise<Fixture> {
  const seen: Seen[] = [];
  const sockets: Socket[] = [];
  const server: Server = createServer((req, res) => {
    const actor = header(req.headers['x-loupe-actor']);
    seen.push({ path: req.url ?? '/', upgrade: false, actor, probe: header(req.headers['x-probe']) });
    const body = JSON.stringify({
      ok: true,
      seq: 1,
      records: [{ stream: 'bumps.jsonl', record: { actor: actor ?? 'fixture-app', at: '2026-09-05T00:00:00Z' } }],
    });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.on('upgrade', (req, socket) => {
    seen.push({
      path: req.url ?? '/',
      upgrade: true,
      actor: header(req.headers['x-loupe-actor']),
      probe: header(req.headers['x-probe']),
    });
    sockets.push(socket as Socket);
    const accept = createHash('sha1')
      .update(String(req.headers['sec-websocket-key']) + WS_GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    seen,
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

/** A port nothing is listening on: bind zero, read it back, hand it over. */
async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
  const addr = probe.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

/**
 * One raw HTTP request over a socket, so the test can send headers the fetch
 * and WebSocket APIs will not (an upgrade with `x-loupe-actor` on it).
 * Resolves with the status line.
 */
async function rawUpgrade(port: number, path: string, headers: Record<string, string>): Promise<string> {
  const socket = connect(port, '127.0.0.1');
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ];
  try {
    await new Promise<void>((resolveConnect, rejectConnect) => {
      socket.once('connect', () => resolveConnect());
      socket.once('error', rejectConnect);
    });
    const status = new Promise<string>((resolveStatus, rejectStatus) => {
      socket.once('data', (chunk: Buffer) => resolveStatus(chunk.toString('utf8').split('\r\n')[0] ?? ''));
      socket.once('error', rejectStatus);
      socket.once('end', () => resolveStatus('CLOSED'));
    });
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    return await status;
  } finally {
    socket.destroy();
  }
}

async function waitForHealthz(base: string, ms = 15_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - startedAt > ms) throw new Error(`host did not answer /healthz within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function dispatch(base: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(`${base}/loupe/verbs/bump`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ params: { by: 1 } }),
  });
  const result = (await res.json()) as { records: Array<{ record: { actor: string } }> };
  return result.records[0]!.record.actor;
}

let fixture: Fixture;
let host: ChildProcess;
let hostBase: string;
/** Everything under the app's own route through the proxy. */
let proxied: string;

beforeAll(async () => {
  fixture = await startFixture();
  const port = await freePort();
  hostBase = `http://127.0.0.1:${port}`;
  proxied = `${hostBase}/apps/grill`;
  const hostDir = fileURLToPath(new URL('..', import.meta.url));
  // Its own process group: the tsx launcher runs the server as a grandchild
  // (plus an esbuild service), and killing only the launcher would leave both
  // alive holding the port and the vitest process open.
  host = spawn('./node_modules/.bin/tsx', ['server.ts'], {
    cwd: hostDir,
    detached: true,
    env: {
      ...process.env,
      LOUPE_HOST: '127.0.0.1',
      LOUPE_PORT: String(port),
      LOUPE_GRILL_BASE: fixture.base,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  host.unref();
  await waitForHealthz(hostBase);
}, 30_000);

afterAll(async () => {
  if (host.pid !== undefined) {
    try {
      process.kill(-host.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  await fixture.close();
});

describe('the host proxy never carries a claim of identity (track "the agent inhabits the same state", R4)', () => {
  it('strips x-loupe-actor from a proxied HTTP dispatch, and forwards everything else', async () => {
    // POSITIVE CONTROL: the same header, sent straight to the app's own
    // loopback port — the way an agent transport reaches it — IS honoured. So
    // the assertion below is about the proxy and not about a fixture that
    // ignores the header, or a header name spelled wrong in this test.
    expect(await dispatch(fixture.base, { 'x-loupe-actor': 'Kelsier-1', 'x-probe': 'direct' })).toBe('Kelsier-1');

    const before = fixture.seen.length;
    expect(await dispatch(proxied, { 'x-loupe-actor': 'Kelsier-1', 'x-probe': 'proxied' })).toBe('fixture-app');
    const arrived = fixture.seen.slice(before);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.actor).toBeNull();
    // The proxy still forwards headers — it dropped this one, not all of them.
    expect(arrived[0]!.probe).toBe('proxied');
  });

  it('strips it however it is spelled: header names are not case-sensitive and neither is the refusal', async () => {
    const before = fixture.seen.length;
    expect(await dispatch(proxied, { 'X-Loupe-Actor': 'Kelsier-1' })).toBe('fixture-app');
    expect(await dispatch(proxied, { 'X-LOUPE-ACTOR': 'Kelsier-1' })).toBe('fixture-app');
    expect(fixture.seen.slice(before).map((s) => s.actor)).toEqual([null, null]);
  });

  it('strips it from the WS upgrade too: the other path to the same app', async () => {
    const port = Number(new URL(hostBase).port);
    // POSITIVE CONTROL first: the fixture sees the header on an upgrade that
    // did not go through the proxy, so the absence below is the proxy's doing.
    const before = fixture.seen.length;
    expect(await rawUpgrade(fixture.port, '/loupe/ws', { 'x-loupe-actor': 'Kelsier-1', 'x-probe': 'direct' })).toContain(
      '101',
    );
    const direct = fixture.seen.slice(before);
    expect(direct.map((s) => ({ upgrade: s.upgrade, actor: s.actor }))).toEqual([
      { upgrade: true, actor: 'Kelsier-1' },
    ]);

    const beforeProxy = fixture.seen.length;
    const status = await rawUpgrade(port, '/apps/grill/loupe/ws', {
      'x-loupe-actor': 'Kelsier-1',
      'x-probe': 'proxied',
    });
    expect(status).toContain('101');
    const arrived = fixture.seen.slice(beforeProxy);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.upgrade).toBe(true);
    expect(arrived[0]!.actor).toBeNull();
    expect(arrived[0]!.probe).toBe('proxied');
  });
});
