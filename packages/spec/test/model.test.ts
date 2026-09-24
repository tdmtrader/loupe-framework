// Frozen-model conformance (scaffold-authored; this test/ directory transfers
// to the renderer-spec lane — keep these assertions passing, they pin the
// grammar the six lanes build against).
import { describe, expect, it } from 'vitest';
import {
  ISSUE_CODES,
  zCondition,
  zElement,
  zExpression,
  zFabrial,
  zPropValue,
} from '../src/model/index.ts';
import { validateFabrial } from '../src/index.ts';
import { miniCatalog, miniManifest } from './fixtures/mini-catalog.ts';

describe('closed expression grammar (§3.3)', () => {
  it('accepts every declared form', () => {
    for (const expr of [
      'literal',
      42,
      null,
      true,
      { $bind: '/triage/pendingCount' },
      { $bind: 'decision' },
      { $bind: '' },
      { $ui: '/cursorId' },
      { $index: true },
      { $template: '${/triage/keptCount} kept · ${ui:/x} …' },
      { $cond: { $bind: 'sev', neq: 'minor' }, $then: true, $else: false },
      {
        $cond: { $bind: 'decision', eq: null },
        $then: 'agent',
        $else: { $cond: { $bind: 'decision', eq: 'kept' }, $then: 'done', $else: 'muted' },
      },
      { $cond: { $ui: '/cursorId', eq: { $bind: 'id' } }, $then: 'agent', $else: 'border' },
    ]) {
      expect(zExpression.safeParse(expr).success, JSON.stringify(expr)).toBe(true);
    }
  });

  it('rejects out-of-grammar forms by grammatical absence', () => {
    for (const expr of [
      { $bindState: '/x' },
      { $computed: '1 + 1' },
      { $bind: '/a', $ui: '/b' },
      { $index: false },
      // two nesting levels of $cond
      {
        $cond: { $bind: '/a', eq: 1 },
        $then: {
          $cond: { $bind: '/b', eq: 1 },
          $then: { $cond: { $bind: '/c', eq: 1 }, $then: 1, $else: 2 },
          $else: 2,
        },
        $else: 0,
      },
    ]) {
      expect(zExpression.safeParse(expr).success, JSON.stringify(expr)).toBe(false);
    }
  });

  it('conditions take exactly one source and one operator', () => {
    expect(zCondition.safeParse({ $bind: '/a', eq: null }).success).toBe(true);
    expect(zCondition.safeParse({ $ui: '/picking', eq: true }).success).toBe(true);
    expect(zCondition.safeParse({ $bind: '/a', in: ['x', 'y'] }).success).toBe(true);
    expect(zCondition.safeParse({ $bind: '/a', exists: true }).success).toBe(true);
    expect(zCondition.safeParse({ eq: 1 }).success).toBe(false);
    expect(zCondition.safeParse({ $bind: '/a', $ui: '/b', eq: 1 }).success).toBe(false);
    expect(zCondition.safeParse({ $bind: '/a', eq: 1, neq: 2 }).success).toBe(false);
    expect(zCondition.safeParse({ $bind: '/a' }).success).toBe(false);
    expect(zCondition.safeParse({ $bind: '/a', matches: '.*' }).success).toBe(false);
  });
});

describe('elements and envelope (§3.1–§3.2)', () => {
  it('parses the §3.4 worked-example shapes', () => {
    const element = {
      type: 'Row',
      repeat: { path: '/findings', key: 'id', filter: { $bind: 'decision', eq: null } },
      props: {
        pad: [10, 12],
        accent: { $cond: { $ui: '/cursorId', eq: { $bind: 'id' } }, $then: 'agent', $else: 'border' },
      },
      on: {
        press: { ui: { '/cursorId': { $bind: 'id' }, '/pane': 'finding', '/dropPicking': false } },
      },
      children: ['f-badges', 'f-body'],
    };
    expect(zElement.safeParse(element).success).toBe(true);

    const verbAction = {
      type: 'Button',
      props: { label: 'release to author', variant: 'primary', flex: true },
      on: {
        press: {
          verb: 'release',
          params: { ticketId: { $bind: '/ticket/id' } },
          confirm: { title: 'release', message: { $bind: '/triage/statusNote' } },
          pending: { label: 'releasing…', disable: true },
          done: { ui: { '/dropPicking': false } },
        },
      },
    };
    expect(zElement.safeParse(verbAction).success).toBe(true);
  });

  it('parses the advance action and rejects malformed ones', () => {
    const good = {
      type: 'Row',
      on: {
        press: [
          { verb: 'keepIt', params: { findingId: { $bind: 'id' } } },
          { advance: { list: '/findings', key: 'id', cursor: '/cursorId', dir: 'next',
              filter: { $bind: 'decision', eq: null } } },
        ],
      },
    };
    expect(zElement.safeParse(good).success).toBe(true);
    const base = { list: '/findings', key: 'id', cursor: '/cursorId', dir: 'next' };
    for (const advance of [
      { ...base, list: 'findings' }, // relative list
      { ...base, key: '' }, // empty key
      { ...base, dir: 'sideways' }, // bad dir
      { ...base, wrap: true }, // extra key — grammar is closed
    ]) {
      expect(
        zElement.safeParse({ type: 'Row', on: { press: { advance } } }).success,
        JSON.stringify(advance),
      ).toBe(false);
    }
  });

  it('parses element context and rejects malformed or doubled item scopes', () => {
    const context = { list: '/findings', key: 'id', at: '/cursorId' };
    expect(zElement.safeParse({ type: 'Row', context }).success).toBe(true);
    // repeat + context together: both define the item scope
    expect(
      zElement.safeParse({
        type: 'Row',
        context,
        repeat: { path: '/findings', key: 'id' },
      }).success,
    ).toBe(false);
    expect(zElement.safeParse({ type: 'Row', context: { ...context, list: 'findings' } }).success).toBe(false);
    expect(zElement.safeParse({ type: 'Row', context: { ...context, at: 'cursorId' } }).success).toBe(false);
    expect(zElement.safeParse({ type: 'Row', context: { ...context, key: '' } }).success).toBe(false);
  });

  it('requires kebab-case ids and absolute ui pointers in actions', () => {
    expect(zElement.safeParse({ type: 'Row', children: ['NotKebab'] }).success).toBe(false);
    expect(zElement.safeParse({ type: 'Row', on: { press: { ui: { cursorId: 1 } } } }).success).toBe(
      false,
    );
  });

  it('parses a minimal envelope and rejects a broken one', () => {
    const fabrial = {
      loupe: 1,
      fabrial: 'notes/review-triage',
      version: 1,
      catalog: { name: 'loupe-std', version: '1.0.0' },
      app: { name: 'notes', projection: 'review-triage' },
      ui: { cursorId: null, pane: 'finding', dropPicking: false },
      root: 'screen',
      elements: { screen: { type: 'Stack', props: { direction: 'column' } } },
    };
    expect(zFabrial.safeParse(fabrial).success).toBe(true);
    expect(zFabrial.safeParse({ ...fabrial, catalog: { name: 'loupe-std', version: '1.0' } }).success).toBe(false);
    expect(zFabrial.safeParse({ ...fabrial, loupe: 'one' }).success).toBe(false);
  });
});

describe('issue codes', () => {
  it('freezes one code per validation class', () => {
    expect(ISSUE_CODES).toEqual([
      'bad-envelope',
      'catalog-pin-mismatch',
      'unknown-type',
      'bad-props',
      'dangling-ref',
      'orphan',
      'cycle',
      'undeclared-event',
      'eventsFrom-nonliteral',
      'undeclared-slot',
      'missing-repeat-key',
      'undeclared-ui-path',
      'unknown-verb',
      'bad-verb-params',
      'unknown-projection',
    ]);
  });
});

describe('prop-position closed grammar (zPropValue)', () => {
  it('accepts expressions, bare Conditions, and $-free composites', () => {
    for (const v of [
      'literal',
      42,
      null,
      { $bind: '/a' },
      { $cond: { $bind: '/a', eq: 1 }, $then: 'x', $else: 'y' },
      { $ui: '/dropPicking', eq: false }, // bare Condition (e.g. Hotkeys `when`)
      { mode: 'compact', nested: { $template: '${/a}' } },
      [{ key: 'u', when: { $ui: '/dropPicking', eq: false } }],
    ]) {
      expect(zPropValue.safeParse(v).success, JSON.stringify(v)).toBe(true);
    }
  });
  it('rejects $-keyed garbage at every depth (no smuggling through records)', () => {
    const depth3 = {
      $cond: { $bind: '/a', eq: 1 },
      $then: {
        $cond: { $bind: '/b', eq: 1 },
        $then: { $cond: { $bind: '/c', eq: 1 }, $then: 1, $else: 2 },
        $else: 2,
      },
      $else: 0,
    };
    for (const v of [
      { $bind: 123 },
      { $ui: '/x', eq: 1, neq: 2 }, // two-op "condition"
      depth3,
      { config: { $bind: 123 } },
      { config: { $ui: '/x', eq: 1, neq: 2 } },
      { config: depth3 },
      [{ $bindState: '/x' }],
    ]) {
      expect(zPropValue.safeParse(v).success, JSON.stringify(v)).toBe(false);
    }
  });
  it('validateFabrial refuses a fabrial smuggling $-keyed garbage inside a prop', () => {
    const fabrial = {
      loupe: 1,
      fabrial: 'test/smuggle',
      version: 1,
      catalog: { name: 'mini', version: '1.2.3' },
      app: { name: 'mock', projection: 'review' },
      ui: {},
      root: 'screen',
      elements: { screen: { type: 'Stack', props: { gap: { deep: { $bind: 123 } } } } },
    };
    const result = validateFabrial(fabrial, miniCatalog, miniManifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'bad-envelope')).toBe(true);
    }
  });
});

describe('app.projection validation (unknown-projection)', () => {
  const fabrial = {
    loupe: 1,
    fabrial: 'test/projection',
    version: 1,
    catalog: { name: 'mini', version: '1.2.3' },
    app: { name: 'mock', projection: 'no-such-projection' },
    ui: {},
    root: 'screen',
    elements: { screen: { type: 'Stack' } },
  };
  it('fails when the declared projections are provided and do not include it', () => {
    const result = validateFabrial(fabrial, miniCatalog, miniManifest, ['review', 'triage']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: 'unknown-projection', path: 'app.projection' }),
      ]);
    }
  });
  it('passes when the projection is declared, and is skipped when the list is absent', () => {
    const bound = { ...fabrial, app: { name: 'mock', projection: 'review' } };
    expect(validateFabrial(bound, miniCatalog, miniManifest, ['review']).ok).toBe(true);
    expect(validateFabrial(fabrial, miniCatalog, miniManifest).ok).toBe(true); // legacy 3-arg call
  });
});

// ---------------------------------------------------------------------------
// The legacy mini-catalog still carries hashHref() until parent track 5.
// Link.href now requires a direct route even with that retained marker;
// the real-catalog direct-route acceptance control lives in cli.test.ts.

describe('hashHref props (§3.4 — an href is bounded, not free)', () => {
  const withHref = (href: unknown): unknown => ({
    loupe: 1,
    fabrial: 'test/href',
    version: 1,
    catalog: { name: 'mini', version: '1.2.3' },
    app: { name: 'mock', projection: 'review' },
    ui: { cursorId: null },
    root: 'screen',
    elements: {
      screen: { type: 'Stack', children: ['link'] },
      link: { type: 'Link', props: { href, label: 'open the track' } },
    },
  });
  const issuesFor = (href: unknown): string[] => {
    const result = validateFabrial(withHref(href), miniCatalog, miniManifest);
    return result.ok ? [] : result.issues.map((i) => `${i.code}: ${i.message}`);
  };

  it('refuses an off-origin literal, a javascript: literal and an assembled href', () => {
    for (const bad of [
      'https://example.com',
      'javascript:alert(1)',
      '/notes/track',
      { $template: 'javascript:${/evil}' },
      { $cond: { $bind: 'x', eq: 1 }, $then: '#/a', $else: '#/b' },
      { $index: true },
    ]) {
      const issues = issuesFor(bad);
      expect(issues.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(issues.every((i) => i.startsWith('bad-props')), JSON.stringify(bad)).toBe(true);
    }
  });

  it('refuses legacy Link hrefs even with the retained hashHref marker', () => {
    for (const href of ['#/notes/track?id=x', { $bind: 'href' }, { $ui: '/cursorId' }]) {
      expect(issuesFor(href)).toEqual(['bad-props: prop "href" on Link must be a direct $route']);
    }
  });
});
