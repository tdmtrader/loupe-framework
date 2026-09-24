// The host file/proxy server (§6.2, r1f4): 127.0.0.1:6170 by default. Serves
// fabrials/**/*.fabrial.json with an index, the app config, and proxies
// /apps/:name/loupe/* (HTTP + WS upgrade) to each app's base URL per
// host.config.json. Owns zero domain logic and zero state — kill and restart
// freely.
//
// In a container it is also the whole app: when `pnpm --filter loupe-host
// build:ui` has left a dist-ui/index.html beside this file, every GET that is
// not /healthz, /fabrials, /config or /apps is answered from dist-ui, with the
// SPA fallback to index.html. Vite on 5173 is a dev convenience that proxies
// here; production is this one process on one port. LOUPE_HOST=0.0.0.0 is what
// makes it reachable from outside the container — the default stays loopback so
// nothing on a laptop is published by accident.
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = process.env['LOUPE_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['LOUPE_PORT'] ?? 6170);

const hostDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(hostDir, '../..');
const fabrialsDir = join(repoRoot, 'fabrials');
// The built shell, or nothing. Read once at boot: an image either shipped a UI
// or it did not, and a server that re-stats the directory per request would be
// lying about which of the two it is.
const uiDir = join(hostDir, 'dist-ui');
const uiIndex = join(uiDir, 'index.html');
const hasUi = existsSync(uiIndex);

interface HostConfig {
  apps: Record<string, { base: string }>;
}
const config: HostConfig = JSON.parse(readFileSync(join(hostDir, 'host.config.json'), 'utf8')) as HostConfig;
// Dev override (e.g. LOUPE_GRILL_BASE=http://127.0.0.1:7182) — the committed
// config keeps the §6.2 contract ports; same convention as fabrials/validate.mjs.
for (const name of Object.keys(config.apps)) {
  const override = process.env[`LOUPE_${name.replace(/-/g, '_').toUpperCase()}_BASE`];
  if (override !== undefined && override !== '') config.apps[name] = { base: override };
}

function listFabrials(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...listFabrials(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith('.fabrial.json')) out.push(`${prefix}${entry.name}`);
  }
  return out.sort();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

const PROXY_RE = /^\/apps\/([^/]+)(\/loupe\/.*)$/;

// Paths the API owns. The SPA fallback must never swallow one of these: a
// mistyped /fabrials/nope.fabrial.json has to stay a 404 the shell can show,
// not an index.html the shell would try to JSON.parse.
const RESERVED_RE = /^\/(healthz|fabrials|config|apps)(\/|$)/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** The dist-ui file this path names, or null when the SPA fallback should answer. */
function uiFile(path: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(path.slice(1));
  } catch {
    return null;
  }
  if (rel === '') return null;
  const file = normalize(join(uiDir, rel));
  // Same containment check as /fabrials: normalize() collapses the .. first, so
  // a path that escapes the directory simply is not under it any more.
  if (!file.startsWith(uiDir + sep)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function sendUi(res: ServerResponse, file: string): void {
  const body = readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.byteLength,
    // Vite hashes everything under /assets, so those may be cached forever;
    // index.html is the pointer at them and must never be.
    'cache-control': file.startsWith(join(uiDir, 'assets') + sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  res.end(body);
}

/**
 * The headers to send upstream: everything the caller sent, minus any claim
 * of identity, plus the upstream's own Host.
 *
 * `X-Loupe-Actor` is honoured by @loupe/serve only over loopback, and this
 * proxy reaches its apps FROM loopback — so a header forwarded from here
 * arrives wearing the one credential the harness checks, and anyone who can
 * reach the host's ingress could sign a record with any name they liked. A
 * fabrial's client never sends identity, so the host never forwards a claim
 * of it: an agent transport that may name itself talks to the adapter's
 * loopback port directly, which is the whole of the seam (R4).
 */
function upstreamHeaders(req: IncomingMessage, target: { host: string; port: number }): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = { ...req.headers, host: `${target.host}:${target.port}` };
  // Node lowercases incoming header names, so this one delete is every
  // spelling of the header a caller could have sent.
  delete headers['x-loupe-actor'];
  return headers;
}

function appBase(name: string): { host: string; port: number } | null {
  const base = config.apps[name]?.base;
  if (!base) return null;
  const url = new URL(base);
  return { host: url.hostname, port: Number(url.port || 80) };
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://loupe.local');
  const path = url.pathname;

  // The kubelet's probe. Deliberately the cheapest route in the file: it says
  // this process is answering, and nothing about the apps behind the proxy —
  // an unreachable adapter must not restart the host.
  if (req.method === 'GET' && path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': 2 });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && (path === '/fabrials' || path === '/fabrials/')) {
    sendJson(res, 200, { fabrials: listFabrials(fabrialsDir) });
    return;
  }

  if (req.method === 'GET' && path.startsWith('/fabrials/')) {
    const rel = decodeURIComponent(path.slice('/fabrials/'.length));
    const file = normalize(join(fabrialsDir, rel));
    if (!file.startsWith(fabrialsDir + sep) || !file.endsWith('.fabrial.json') || !existsSync(file)) {
      sendJson(res, 404, { error: `no fabrial ${rel}` });
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.byteLength });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && path === '/config') {
    sendJson(res, 200, config);
    return;
  }

  const match = PROXY_RE.exec(path);
  if (match) {
    const target = appBase(match[1]!);
    if (!target) {
      sendJson(res, 502, { error: `unknown app ${match[1]!} (see host.config.json)` });
      return;
    }
    const proxied = httpRequest(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: match[2]! + url.search,
        headers: upstreamHeaders(req, target),
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', (err) => sendJson(res, 502, { error: `app unreachable: ${err.message}` }));
    req.pipe(proxied);
    return;
  }

  if (hasUi && req.method === 'GET' && !RESERVED_RE.test(path)) {
    sendUi(res, uiFile(path) ?? uiIndex);
    return;
  }

  sendJson(res, 404, { error: `no route for ${req.method} ${path}` });
});

// WS upgrade proxying for /apps/:name/loupe/ws — raw socket splice.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://loupe.local');
  const match = PROXY_RE.exec(url.pathname);
  const target = match ? appBase(match[1]!) : null;
  if (!match || !target) {
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return;
  }
  const proxied = httpRequest({
    host: target.host,
    port: target.port,
    method: 'GET',
    path: match[2]! + url.search,
    headers: upstreamHeaders(req, target),
  });
  proxied.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
      lines.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upstreamHead.length > 0) socket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    const drop = () => {
      upstreamSocket.destroy();
      socket.destroy();
    };
    upstreamSocket.on('error', drop);
    socket.on('error', drop);
  });
  proxied.on('response', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  proxied.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  proxied.end();
});

server.listen(PORT, HOST, () => {
  console.log(`loupe-host on http://${HOST}:${PORT} — fabrials from ${fabrialsDir}`);
  console.log(`apps: ${Object.entries(config.apps).map(([n, a]) => `${n} → ${a.base}`).join(' · ')}`);
  console.log(hasUi ? `ui: ${uiDir}` : 'ui: none built — run `pnpm --filter loupe-host build:ui` (dev uses vite on 5173)');
});
