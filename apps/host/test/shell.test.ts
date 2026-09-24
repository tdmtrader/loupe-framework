// The shell's sizing values are the contract: the host lane is a node project
// with no DOM harness, and the module under test is side-effect-free precisely
// so it can be imported here (main.tsx mounts at import time and cannot be).
import { describe, expect, it } from 'vitest';
import { shellBodyStyle, shellHeaderStyle, shellStyle } from '../src/shell-style.ts';

describe('host shell sizing', () => {
  it('the shell is a fixed-height flex column that does not scroll itself', () => {
    expect(shellStyle.height).toBe('100dvh');
    expect(shellStyle.display).toBe('flex');
    expect(shellStyle.flexDirection).toBe('column');
    expect(shellStyle.overflow).toBe('hidden');
  });

  it('the breadcrumb neither grows nor shrinks', () => {
    expect(shellHeaderStyle.flex).toBe('none');
  });

  it('the fabrial body claims the rest and may shrink below its content', () => {
    expect(shellBodyStyle.flex).toBe('1 1 0%');
    expect(shellBodyStyle.minHeight).toBe(0);
    expect(shellBodyStyle.display).toBe('flex');
    expect(shellBodyStyle.flexDirection).toBe('column');
  });
});

// Real shell/catalog/renderer; only HTTP and WS app/file adapters are fixtures.
import { afterAll, beforeAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Fabrial, Json, JsonObject, PropValue } from '@loupe/spec';

// A CI runner may install the node projects without a playwright chromium
// (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD); browser-driven proofs are a
// `pnpm check`-with-chromium tier there. Skip, and say so, only when no browser
// is installed at all.
const hasChromium = existsSync(chromium.executablePath());
if (!hasChromium) console.warn('mounted route navigation: skipped — no playwright chromium installed');

const routeDocument = (path: string, target = 'track'): Fabrial => ({
  loupe: 1, fabrial: `notes/${path}`, version: 1,
  catalog: { name: 'loupe-std', version: '2.0.0' },
  app: { name: 'notes', projection: 'review' }, root: 'screen',
  elements: {
    screen: { type: 'Stack', children: ['link', 'id'] },
    link: { type: 'Link', props: { label: 'open track', href: { $route: { fabrial: target, params: { id: { $bind: '/id' } } } } } },
    id: { type: 'Text', props: { text: { $bind: '/id' } } },
  },
});

describe.skipIf(!hasChromium)('mounted route navigation', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let base: string;
  beforeAll(async () => {
    server = await createServer({
      configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
      plugins: [react()], server: { host: '127.0.0.1', port: 0 },
    });
    await server.listen();
    base = server.resolvedUrls!.local[0]!;
    browser = await chromium.launch({ headless: true });
  }, 30000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  const defaultFiles = (): Record<string, Fabrial> => ({
      'notes/source.fabrial.json': routeDocument('source'),
      'notes/track.fabrial.json': routeDocument('track'),
  });

  async function fixturePage(
    files = defaultFiles(),
    state: (params: Record<string, string>) => JsonObject = (params) => ({ id: params['id'] ?? 'a/b&c' }),
  ): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/fabrials**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === '/fabrials' ? { fabrials: Object.keys(files) } : files[path.slice('/fabrials/'.length)];
      await route.fulfill({ status: body ? 200 : 404, json: body ?? { error: 'missing fixture' } });
    });
    await page.route('**/apps/*/loupe/app', (route) => route.fulfill({ json: {
      protocol: 1, app: { name: 'notes', version: '1.0.0' },
      projections: [{ name: 'review' }],
      verbs: [{ name: 'select', params: { type: 'object', properties: {}, additionalProperties: false } }],
      capabilities: { ws: true },
    } }));
    await page.route('**/apps/*/loupe/verbs/select', (route) => route.fulfill({ json: { ok: true, seq: 1, records: [] } }));
    await page.routeWebSocket('**/apps/*/loupe/ws', (socket) => {
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message));
        if (frame.t === 'sub') socket.send(JSON.stringify({
          t: 'state', projection: frame.projection, seq: 1,
          state: state(frame.params ?? {}),
        }));
      });
    });
    return page;
  }

  it('loads canonical and legacy paths with projection params and mounted route anchors', async () => {
    const page = await fixturePage();
    try {
      for (const path of ['track', 'notes/track']) {
        await page.goto(`${base}#/notes/${path}?id=x`);
        await page.locator('a[data-lp="Link"], ol').first().waitFor({ timeout: 5000 });
        expect(await page.locator('a[data-lp="Link"]').count(), await page.locator('body').innerText()).toBe(1);
        expect(await page.locator('a[data-lp="Link"]').getAttribute('href')).toBe('#/notes/track?id=x');
        expect(await page.locator('[data-lp="Text"]').textContent()).toBe('x');
      }
    } finally {
      await page.close();
    }
  }, 15000);
  it.each(['notes', 'notes-mirror'])('keeps every scoped route under %s and follows a real anchor with id preserved', async (instance) => {
    const link = (label: string, params?: Record<string, PropValue>) => ({
      type: 'Link', props: { label, href: { $route: { fabrial: 'track', ...(params === undefined ? {} : { params }) } } },
    });
    const source: Fabrial = {
      ...routeDocument('source'), ui: { cursor: 'c/d&e', id: 'u/v&w' },
      elements: {
        screen: { type: 'Stack', children: ['repeat', 'context', 'graph', 'literal', 'ui', 'absent', 'empty'] },
        repeat: { type: 'Stack', repeat: { path: '/items', key: 'id' }, children: ['repeat-link'] },
        'repeat-link': link('repeat', { id: { $bind: 'id' } }),
        context: { type: 'Stack', context: { list: '/selected', key: 'id', at: '/cursor' }, children: ['context-link'] },
        'context-link': link('context', { id: { $bind: 'id' } }),
        graph: { type: 'RouteGraph', props: { nodes: { $bind: '/nodes' }, edges: [], size: { width: 300, height: 80 } }, slots: { node: ['slot-link'] } },
        'slot-link': link('item slot', { id: { $bind: 'node/id' } }),
        literal: link('literal', { id: 'l/m&n' }),
        ui: link('ui', { id: { $ui: '/id' } }),
        absent: link('absent'), empty: link('empty', {}),
      },
    };
    const page = await fixturePage({ ...defaultFiles(), 'notes/source.fabrial.json': source }, (params) => ({
      id: params['id'] ?? 'root', items: [{ id: 'a/b&c' }], selected: [{ id: 'c/d&e' }],
      nodes: [{ id: 'n/o&p', pos: { x: 0, y: 0 } }],
    }));
    try {
      await page.goto(`${base}#/${instance}/source`);
      await page.getByRole('link', { name: 'repeat', exact: true }).waitFor();
      const anchors = page.locator('a[data-lp="Link"]');
      expect(await anchors.count()).toBe(7);
      for (const [label, suffix] of [
        ['repeat', '?id=a%2Fb%26c'], ['context', '?id=c%2Fd%26e'], ['item slot', '?id=n%2Fo%26p'],
        ['literal', '?id=l%2Fm%26n'], ['ui', '?id=u%2Fv%26w'], ['absent', ''], ['empty', ''],
      ]) {
        expect(await page.getByRole('link', { name: label, exact: true }).getAttribute('href'))
          .toBe(`#/${instance}/track${suffix}`);
      }
      await page.getByRole('link', { name: 'repeat', exact: true }).click();
      await page.getByRole('link', { name: 'open track' }).waitFor();
      expect(new URL(page.url()).hash).toBe(`#/${instance}/track?id=a%2Fb%26c`);
      expect(await page.locator('[data-lp="Text"]').textContent()).toBe('a/b&c');
      expect(await page.getByRole('link', { name: 'open track' }).getAttribute('href'))
        .toBe(`#/${instance}/track?id=a%2Fb%26c`);
    } finally {
      await page.close();
    }
  }, 15000);

  describe.each(['on.press.ui', 'done.ui'])('%s routes', (actionPath) => {
    it.each(['notes', 'notes-mirror'])('sets a navigable ui-doc route under %s', async (instance) => {
      const ui = { '/id': { $bind: 'id' }, '/href': { $route: { fabrial: 'track', params: { id: { $bind: 'id' } } } } };
      const source: Fabrial = {
        ...routeDocument('source'), ui: { href: '#/unchanged', id: 'initial' },
        elements: {
          screen: { type: 'Stack', children: ['item', 'link', 'resolved'] },
          item: { type: 'Stack', repeat: { path: '/items', key: 'id' }, children: ['select'] },
          select: {
            type: 'Button', props: { label: 'select route', variant: 'ghost' },
            on: { press: actionPath === 'on.press.ui' ? { ui } : { verb: 'select', params: {}, done: { ui } } },
          },
          link: { type: 'Link', props: { label: 'selected route', href: { $route: { fabrial: 'track', params: { id: { $ui: '/id' } } } } } },
          resolved: { type: 'Text', props: { text: { $ui: '/href' } } },
        },
      };
      const page = await fixturePage({ ...defaultFiles(), 'notes/source.fabrial.json': source }, (params) => ({
        id: params['id'] ?? 'root', items: [{ id: 'a/b&c' }],
      }));
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${base}#/${instance}/source`);
        const anchor = page.getByRole('link', { name: 'selected route' });
        await anchor.waitFor();
        expect(await anchor.getAttribute('href')).toBe(`#/${instance}/track?id=initial`);
        expect(await page.locator('[data-lp="Text"]').textContent()).toBe('#/unchanged');
        await page.getByRole('button', { name: 'select route' }).click();
        await expect.poll(() => anchor.getAttribute('href'), { timeout: 3000 })
          .toBe(`#/${instance}/track?id=a%2Fb%26c`);
        expect(await page.locator('[data-lp="Text"]').textContent()).toBe(`#/${instance}/track?id=a%2Fb%26c`);
        expect(errors).toEqual([]);
        expect(await page.getByTestId('lp-error-panel').count()).toBe(0);
        await anchor.click();
        await page.getByRole('link', { name: 'open track' }).waitFor();
        expect(new URL(page.url()).hash).toBe(`#/${instance}/track?id=a%2Fb%26c`);
        expect(await page.locator('[data-lp="Text"]').textContent()).toBe('a/b&c');
      } finally {
        await page.close();
      }
    }, 15000);
  });

  it.each(['absent', 'foreign'])('refuses a %s route target in launcher and direct load', async (membership) => {
    const files: Record<string, Fabrial> = { 'notes/source.fabrial.json': routeDocument('source') };
    if (membership === 'foreign') files['grill/track.fabrial.json'] = {
      ...routeDocument('track'), fabrial: 'grill/track', app: { name: 'grill', projection: 'review' },
      root: 'text', elements: { text: { type: 'Text', props: { text: 'foreign target' } } },
    };
    const page = await fixturePage(files);
    try {
      await page.goto(base);
      await page.getByText('notes/source', { exact: true }).waitFor();
      expect(await page.locator('body').innerText()).toContain('bad-props');
      expect(await page.getByRole('link', { name: 'notes/source', exact: true }).count()).toBe(0);
      if (membership === 'foreign') expect(await page.getByRole('link', { name: 'grill/track', exact: true }).count()).toBe(1);
      for (const instance of ['notes', 'notes-mirror']) {
        await page.goto(`${base}#/${instance}/source`);
        await page.getByText('fabrial refused — source', { exact: true }).waitFor();
        expect(await page.locator('ol').innerText()).toContain('bad-props');
        expect(await page.locator('a[data-lp="Link"][href]').count()).toBe(0);
      }
    } finally {
      await page.close();
    }
  }, 15000);

  const invalidReads: Array<[string, JsonObject]> = [
    ['number', { id: 7 }], ['boolean', { id: false }], ['null', { id: null }],
    ['array', { id: [] }], ['object', { id: {} }], ['missing', {}],
  ];
  describe.each(['$bind', '$ui'])('%s route params', (read) => {
    it.each(invalidReads)('renders an error and no usable route anchors for a %s read', async (_name, data) => {
      const source: Fabrial = {
        ...routeDocument('source'), ui: { data }, root: 'link',
        elements: { link: { type: 'Link', props: { label: 'invalid route', href: { $route: {
          fabrial: 'track', params: { id: { [read]: '/data/id' } as Json },
        } } } } },
      };
      const page = await fixturePage({ ...defaultFiles(), 'notes/source.fabrial.json': source }, () => ({ data }));
      try {
        for (const instance of ['notes', 'notes-mirror']) {
          await page.goto(`${base}#/${instance}/source`);
          await page.getByTestId('lp-error-panel').waitFor();
          expect(await page.getByTestId('lp-error-panel').innerText()).toContain('render-error');
          expect(await page.getByTestId('lp-error-panel').innerText()).toContain('string');
          expect(await page.locator('a[data-lp="Link"][href]').count()).toBe(0);
        }
      } finally {
        await page.close();
      }
    }, 15000);
  });

});
