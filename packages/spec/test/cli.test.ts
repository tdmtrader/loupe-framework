// loupe-validate CLI: numbered issues, exit 1 on any invalid file.
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Json } from '@loupe/protocol';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fabrialJsonSchema, resolve, validateFabrial, validateFabrialPartial, zExpression, zFabrial } from '../src/index.ts';
import { miniCatalog } from './fixtures/mini-catalog.ts';
import * as spec from '../src/index.ts';

const routeFabrial = (href: unknown) => ({
  loupe: 1, fabrial: 'notes/source', version: 1,
  catalog: { name: 'loupe-std', version: '2.0.0' },
  app: { name: 'notes', projection: 'review' }, ui: { id: 'x' }, root: 'link',
  elements: { link: { type: 'Link', props: { label: 'open', href } } },
});

it('exposes the route schema for catalog authors through the public module', () => {
  expect('zRouteExpr' in spec).toBe(true);
  if ('zRouteExpr' in spec) {
    expect(spec.zRouteExpr.safeParse({ $route: { fabrial: 'track' } }).success).toBe(true);
  }
});

describe('route authoring grammar', () => {
  it('admits routes as expression leaves and inside recursive props', () => {
    const route = { $route: { fabrial: 'track', params: { id: { $bind: 'id' }, tab: { $ui: '/id' }, mode: 'read' } } };
    expect(zExpression.safeParse(route).success).toBe(true);
    expect(zFabrial.safeParse(routeFabrial(route)).success).toBe(true);
    expect(zFabrial.safeParse(routeFabrial({ nested: [route] })).success).toBe(true);
  });

  it.each(['', '/track', '../track', './track', 'a/../track', 'a/./track', 'track?id=x', 'track#x'])('rejects target %j', (fabrial) => {
    expect(zFabrial.safeParse(routeFabrial({ $route: { fabrial } })).success).toBe(false);
  });

  it.each([7, false, null, [], {}])('rejects non-string literal param %j', (id) => {
    expect(zFabrial.safeParse(routeFabrial({ $route: { fabrial: 'track', params: { id } } })).success).toBe(false);
  });

  it('rejects instance selection, extra fields and expression targets', () => {
    for (const route of [
      { fabrial: 'track', instance: 'other' },
      { fabrial: { $bind: '/target' } },
      { fabrial: 'track', extra: true },
    ]) expect(zFabrial.safeParse(routeFabrial({ $route: route })).success).toBe(false);
  });
});

describe('route resolution through the spec module', () => {
  it('carries the mounting context through composites and conditional branches', () => {
    const route = { $route: { fabrial: 'track', params: { id: { $bind: 'id' }, tab: { $ui: '/tab' } } } };
    const scope = { state: {}, ui: { tab: 'read' }, item: { id: 'a/b&c' } };
    expect(resolve({ links: [{ $cond: { $ui: '/tab', eq: 'read' }, $then: route, $else: '' }] }, scope, { instance: 'notes-mirror' }))
      .toEqual({ links: ['#/notes-mirror/track?id=a%2Fb%26c&tab=read'] });
    expect(resolve({ $route: { fabrial: 'track' } }, scope, { instance: 'notes' })).toBe('#/notes/track');
    expect(resolve({ $route: { fabrial: 'track', params: {} } }, scope, { instance: 'notes' })).toBe('#/notes/track');
  });

  it('refuses missing instance context and non-string reads', () => {
    const route = { $route: { fabrial: 'track', params: { id: { $bind: '/id' } } } };
    expect(() => resolve(route, { state: { id: 'x' }, ui: {} })).toThrow(/instance/);
    const states: Json[] = [{}, { id: 7 }, { id: false }, { id: null }, { id: [] }, { id: {} }];
    for (const state of states) {
      expect(() => resolve(route, { state, ui: {} }, { instance: 'notes' })).toThrow(/string/);
    }
  });
});

describe('route inventory validation', () => {
  const document = (value: unknown) => ({
    ...routeFabrial(value), catalog: { name: miniCatalog.name, version: miniCatalog.version },
    elements: { link: { type: 'Text', props: { text: value } } },
  });
  const route = { $route: { fabrial: 'track', params: { id: { $ui: '/id' } } } };
  it('requires membership in the source app through both validation entry points', () => {
    for (const validate of [validateFabrial, validateFabrialPartial]) {
      const inventories: Array<Readonly<Record<string, readonly string[]>> | undefined> = [undefined, {}, { grill: ['track'] }, { notes: ['other'] }];
      for (const inventory of inventories) {
        const result = validate(document(route), miniCatalog, [], undefined, inventory);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((i) => i.code)).toContain('bad-props');
      }
      expect(validate(document(route), miniCatalog, [], undefined, { notes: ['track'] }).ok).toBe(true);
    }
  });

  it('checks routes without a catalog or manifest, including nested routes and ui reads', () => {
    const nested = document({ nested: [route] });
    expect(validateFabrialPartial(nested, null, null).ok).toBe(false);
    expect(validateFabrialPartial(nested, null, null, undefined, { notes: ['track'] }).ok).toBe(true);
    const result = validateFabrialPartial({ ...nested, ui: {} }, null, null, undefined, { notes: ['track'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.code)).toContain('undeclared-ui-path');
  });
});

it('ships the emitted dialect-1 schema including strict route constraints', () => {
  const shipped = JSON.parse(readFileSync(join(import.meta.dirname, '../../../schema/fabrial.schema.json'), 'utf8'));
  expect(shipped).toEqual(fabrialJsonSchema());
  expect(shipped.properties.loupe).toMatchObject({ type: 'integer', exclusiveMinimum: 0 });
  const unknown = validateFabrialPartial({ ...routeFabrial('#/notes/track'), loupe: 2 }, null, null);
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.issues.map((issue) => issue.code)).toEqual(['bad-envelope']);
  const defs = Object.values(shipped.$defs) as Array<{ properties?: Record<string, unknown> }>;
  const route = defs.find((def) => def.properties?.['$route'])?.properties?.['$route'];
  expect(route).toMatchObject({ type: 'object', additionalProperties: false, required: ['fabrial'] });
  expect(route).toHaveProperty('properties.fabrial.pattern');
  expect(route).toHaveProperty('properties.params.additionalProperties.anyOf');
});

const pkgRoot = join(import.meta.dirname, '..');
const tsx = ['node_modules/.bin/tsx', '../../node_modules/.bin/tsx']
  .map((p) => join(pkgRoot, p))
  .find(existsSync);
const bin = join(pkgRoot, 'bin/validate.ts');
const fx = (p: string) => join(import.meta.dirname, p);

interface RunResult {
  status: number;
  out: string;
}
function run(args: string[]): RunResult {
  try {
    const out = execFileSync(tsx as string, [bin, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('loupe-validate', () => {
  it('passes the golden fabrial with catalog + manifest (exit 0)', () => {
    const r = run([
      fx('corpus/valid/golden-triage.fabrial.json'),
      '--manifest', fx('fixtures/cli-manifest.json'),
      '--catalog', fx('fixtures/cli-catalog.ts'),
    ]);
    expect(r.out).toContain('✓');
    expect(r.status).toBe(0);
  });

  it('prints numbered issues and exits 1 on an invalid fabrial', () => {
    const r = run([
      fx('corpus/invalid/unknown-verb.fabrial.json'),
      fx('corpus/valid/golden-triage.fabrial.json'),
      '--manifest', fx('fixtures/cli-manifest.json'),
      '--catalog', fx('fixtures/cli-catalog.ts'),
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('✗');
    expect(r.out).toMatch(/1\. unknown-verb/);
    expect(r.out).toContain('✓'); // the valid file still reports
  });
});

// Public validation uses the package's catalog double; subprocesses below load
// loupe-std itself without introducing a circular spec → catalog dependency.
describe.each([validateFabrial, validateFabrialPartial])('route public validation matrix via $name', (validate) => {
  const inventory = { notes: ['track'] };
  const catalog = spec.defineCatalog({
    name: 'loupe-std', version: '2.0.0',
    components: { Link: { props: z.strictObject({
      label: z.string(),
      href: spec.zRouteExpr,
    }) } },
  });
  const document = (href: unknown) => ({
    ...routeFabrial(href),
  });
  const codes = (doc: unknown) => {
    const result = validate(doc, catalog, [], undefined, inventory);
    return result.ok ? [] : [...new Set(result.issues.map((issue) => issue.code))];
  };

  it('T2 enforces direct Link routes through both public validators', () => {
    const route = { $route: { fabrial: 'track', params: { id: { $bind: 'id' } } } };
    const doc = document;
    expect(validate(doc(route), catalog, [], undefined, inventory).ok).toBe(true);
    for (const href of ['#/notes/track?id=x', { $bind: '/href' }, { $ui: '/id' },
      { $template: '#/notes/${/id}' },
      { $cond: { $ui: '/id', eq: 'x' }, $then: '#/notes/track?id=x', $else: '#/notes/track?id=y' },
      { $cond: { $ui: '/id', eq: 'x' }, $then: route, $else: route },
      { nested: route }]) {
      const result = validate(doc(href), catalog, [], undefined, inventory);
      expect(result.ok, JSON.stringify(href)).toBe(false);
      if (!result.ok) expect([...new Set(result.issues.map((issue) => issue.code))]).toEqual(['bad-props']);
    }
    expect(validate(doc(route), catalog, [], undefined, { notes: [] }).ok).toBe(false);
    const missingUi = validate(doc({ $route: { fabrial: 'track', params: { id: { $ui: '/missing' } } } }), catalog, [], undefined, inventory);
    expect(missingUi.ok).toBe(false);
    if (!missingUi.ok) expect([...new Set(missingUi.issues.map((issue) => issue.code))]).toEqual(['undeclared-ui-path']);
  });

  it.each([
    '', '/track', '../track', './track', 'a/../track', 'a/./track', 'track?id=x', 'track#x',
    { $bind: '/target' },
  ])('reports bad-envelope for target %j', (fabrial) => {
    expect(codes(document({ $route: { fabrial } }))).toEqual(['bad-envelope']);
  });
  it.each([7, false, null, [], {}])('reports bad-envelope for literal param %j', (id) => {
    expect(codes(document({ $route: { fabrial: 'track', params: { id } } }))).toEqual(['bad-envelope']);
  });
  it('refuses extra route and expression fields', () => {
    for (const href of [
      { $route: { fabrial: 'track', instance: 'other' } },
      { $route: { fabrial: 'track', extra: true } },
      { $route: { fabrial: 'track' }, extra: true },
    ]) expect(codes(document(href))).toEqual(['bad-envelope']);
  });
  it.each([
    { $route: { fabrial: 'track' } },
    { $route: { fabrial: 'track', params: { id: 'x', read: { $bind: 'id' }, ui: { $ui: '/id' } } } },
    { $route: { fabrial: 'track', params: { id: { $bind: 'id' } } } },
  ])('accepts a direct route %j', (href) => {
    expect(codes(document(href))).toEqual([]);
  });
  it.each([
    '#/notes/track?id=x', { $bind: '/href' }, { $ui: '/id' },
    { $template: '#/notes/${id}' },
    { $cond: { $ui: '/id', eq: 'x' }, $then: '#/notes/track', $else: '#/notes/source' },
    '/track', 'https://example.com',
  ])('reports bad-props for legacy or wrapped href %j', (href) => {
    expect(codes(document(href))).toEqual(['bad-props']);
  });
  it('reports undeclared-ui-path for a route param read', () => {
    expect(codes(document({ $route: { fabrial: 'track', params: { id: { $ui: '/missing' } } } })))
      .toEqual(['undeclared-ui-path']);
  });
});

describe('route CLI compatibility', () => {
  it.each([
    ['route', routeFabrial({ $route: { fabrial: 'track' } }), 1, 'bad-props'],
    ...['1.4.0', '1.5.0'].map((version) => [
      `pin-${version}`, { ...routeFabrial(null), catalog: { name: 'loupe-std', version },
        elements: { link: { type: 'Text', props: { text: 'pin compatibility' } } } }, 1, 'catalog-pin-mismatch',
    ] as const),
    ['dialect-2', { ...routeFabrial('#/notes/track'), loupe: 2 }, 1, 'bad-envelope'],
  ] as const)('%s has the specified exit and diagnostic against loupe-std', (name, doc, status, diagnostic) => {
    const dir = mkdtempSync(join(tmpdir(), 'loupe-route-cli-'));
    try {
      const file = join(dir, `${name}.fabrial.json`);
      writeFileSync(file, JSON.stringify(doc));
      const result = run([file, '--catalog', join(pkgRoot, '../catalog/src/index.ts')]);
      expect(result.status, result.out).toBe(status);
      expect(result.out).toContain(diagnostic);
      if (status === 1) expect(result.out).toMatch(new RegExp(`1\\. ${diagnostic}`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });


});

// A repository-shaped copy keeps mutations away from the shipped documents.
function shippedCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loupe-shipped-cli-'));
  const repo = join(pkgRoot, '../..');
  cpSync(join(repo, 'fabrials'), join(dir, 'fabrials'), { recursive: true });
  for (const entry of ['packages', 'apps']) symlinkSync(join(repo, entry), join(dir, entry));
  return dir;
}

// The shipped grill/board carries no Link, so the route contract is proved on
// an in-test fixture beside it: a second grill fabrial whose one Link routes to
// board. It exists only in the temporary copy, never in the shipped tree.
const linksFixture = () => ({
  loupe: 1, fabrial: 'grill/links', version: 1,
  catalog: { name: 'loupe-std', version: '2.0.0' },
  app: { name: 'grill', projection: 'board' }, ui: {}, root: 'screen',
  elements: {
    screen: { type: 'Stack', children: ['open'] },
    open: { type: 'Link', props: { label: 'open board', href: { $route: { fabrial: 'board', params: { id: { $bind: '/id' } } } } } },
  },
} as Record<string, any>);

describe.each(['live', 'offline'] as const)('shipped validator with %s manifests', (mode) => {
  it('validates the shipped file plus a route fixture, refusing a target absent from the app inventory', async () => {
    const dir = shippedCopy();
    const shipped = readdirSync(join(dir, 'fabrials'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.fabrial.json')).sort();
    expect(shipped).toEqual(['grill/board.fabrial.json']);
    const file = join(dir, 'fabrials/grill/links.fabrial.json');
    const doc = linksFixture();
    writeFileSync(file, JSON.stringify(doc));
    // Descriptor fixtures expose the shipped verb names. Param grammar has its
    // own seam; here the contract is manifest selection and route membership.
    const verbs = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'verb' && typeof child === 'string') verbs.add(child);
        else collect(child);
      }
    };
    for (const name of readdirSync(join(dir, 'fabrials', 'grill'))) {
      collect(JSON.parse(readFileSync(join(dir, 'fabrials', 'grill', name), 'utf8')));
    }
    expect(verbs.size).toBeGreaterThan(0);
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ verbs: [...verbs].map((name) => ({ name, params: { type: 'object' } })) }));
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const names = readdirSync(join(dir, 'fabrials'), { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.fabrial.json')).sort();
      expect(names).toEqual(['grill/board.fabrial.json', 'grill/links.fabrial.json']);
      const links: unknown[] = [];
      for (const name of names) {
        const parsed = JSON.parse(readFileSync(join(dir, 'fabrials', name), 'utf8'));
        expect(parsed.loupe).toBe(1);
        expect(parsed.catalog).toEqual({ name: 'loupe-std', version: '2.0.0' });
        for (const el of Object.values(parsed.elements) as Array<{ type: string; props?: { href?: unknown } }>) {
          if (el.type === 'Link') links.push(el.props?.href);
        }
      }
      expect(links).toHaveLength(1);
      for (const href of links) expect(spec.zRouteExpr.safeParse(href).success).toBe(true);

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing descriptor port');
      const base = mode === 'live' ? `http://127.0.0.1:${address.port}` : 'http://127.0.0.1:0';
      const runShipped = async (): Promise<RunResult> => {
        try {
          const result = await promisify(execFile)(process.execPath, ['fabrials/validate.mjs'], {
            cwd: dir, encoding: 'utf8',
            env: { ...process.env, LOUPE_GRILL_BASE: base },
          });
          return { status: 0, out: result.stdout + result.stderr };
        } catch (e) {
          const error = e as { code: number; stdout: string; stderr: string };
          return { status: error.code, out: error.stdout + error.stderr };
        }
      };
      const assertAll = (result: RunResult): void => {
        expect(result.status, result.out).toBe(0);
        expect(result.out.match(/^ok   /gm)).toHaveLength(2);
        expect(result.out).toContain('ok   fabrials/grill/board.fabrial.json');
        expect(result.out).not.toMatch(/^FAIL|\[[a-z-]+\]/m);
        expect(result.out).toContain('catalog loupe-std@2.0.0 · 2 fabrial(s)');
        expect(result.out.match(mode === 'live' ? /\(live /g : /\(inline manifest\)/g)).toHaveLength(2);
      };
      const initial = await runShipped();
      assertAll(initial);
      console.log(`shipped validator ${mode} evidence:\n${initial.out}`);
      const route = doc.elements.open.props.href;
      // Matching pins, declared ui paths and same-app inventory isolate the
      // href contract from envelope or membership failures in the real catalog.
      doc.ui = { ...doc.ui, routeHref: '#/grill/board?id=x' };
      for (const href of ['#/grill/board?id=x', { $bind: '/href' }, { $ui: '/routeHref' },
        { $template: '#/grill/board?id=${/id}' },
        { $cond: { $ui: '/routeHref', exists: true }, $then: '#/grill/board?id=x', $else: '#/grill/board?id=y' },
        { $cond: { $ui: '/routeHref', exists: true }, $then: route, $else: route }]) {
        doc.elements.open.props.href = href;
        writeFileSync(file, JSON.stringify(doc));
        const result = await runShipped();
        expect(result.status, result.out).toBe(1);
        expect(result.out.match(/^ok   /gm)).toHaveLength(1);
        expect(result.out.match(/\[[a-z-]+\]/g)).toEqual(['[bad-props]']);
      }
      doc.elements.open.props.href = route;
      writeFileSync(file, JSON.stringify(doc));
      assertAll(await runShipped());
      for (const name of ['grill/links', 'grill/board']) {
        const pinFile = join(dir, 'fabrials', `${name}.fabrial.json`);
        const original = readFileSync(pinFile, 'utf8');
        const pinned = JSON.parse(original);
        for (const version of ['1.4.0', '1.5.0']) {
          pinned.catalog.version = version;
          writeFileSync(pinFile, JSON.stringify(pinned));
          const result = await runShipped();
          expect(result.status, result.out).toBe(1);
          expect(result.out.match(/\[[a-z-]+\]/g)).toEqual(['[catalog-pin-mismatch]']);
        }
        pinned.catalog.version = '2.0.0';
        pinned.loupe = 2;
        writeFileSync(pinFile, JSON.stringify(pinned));
        const result = await runShipped();
        expect(result.status, result.out).toBe(1);
        expect(result.out.match(/\[[a-z-]+\]/g)).toEqual(['[bad-envelope]']);
        writeFileSync(pinFile, original);
      }
      // A target no grill fabrial answers to is refused, never guessed at.
      doc.elements.open.props.href.$route.fabrial = 'track';
      writeFileSync(file, JSON.stringify(doc));
      const foreign = await runShipped();
      expect(foreign.status, foreign.out).toBe(1);
      expect(foreign.out).toContain('FAIL fabrials/grill/links.fabrial.json');
      expect(foreign.out).toContain('[bad-props]');
      expect(foreign.out).toContain('route target "track" is absent from the inventory for app "grill"');
      expect(foreign.out.match(/^ok   /gm)).toHaveLength(1);
      expect(foreign.out.match(mode === 'live' ? /\(live /g : /\(inline manifest\)/g)).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

// Per-file release check: each shipped pin validates at the current catalog.
it.each(['grill/board'])('shipped pin %s validates at catalog 2.0.0', (name) => {
  const repo = join(pkgRoot, '../..');
  let out: string;
  try {
    out = execFileSync(process.execPath, ['fabrials/validate.mjs'], {
      cwd: repo, encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, LOUPE_GRILL_BASE: 'http://127.0.0.1:0' },
    });
  } catch (e) {
    const error = e as { stdout: string; stderr: string };
    out = error.stdout + error.stderr;
  }
  expect(out).toContain(`ok   fabrials/${name}.fabrial.json (inline manifest)`);
  const doc = JSON.parse(readFileSync(join(repo, 'fabrials', `${name}.fabrial.json`), 'utf8'));
  expect(doc.catalog).toEqual({ name: 'loupe-std', version: '2.0.0' });
  expect(doc.loupe).toBe(1);
});

