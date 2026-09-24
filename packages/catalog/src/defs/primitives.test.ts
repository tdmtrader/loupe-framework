import { describe, expect, it } from 'vitest';
import { isHashHrefSchema, validateFabrial } from '@loupe/spec';
import { loupeStd } from './index.ts';

const document = (href: unknown, version = '2.0.0') => ({
  loupe: 1, fabrial: 'notes/source', version: 1,
  catalog: { name: 'loupe-std', version },
  app: { name: 'notes', projection: 'review' }, ui: { href: '#/notes/track' }, root: 'link',
  elements: { link: { type: 'Link', props: { label: 'open', href } } },
});

describe('Link authoring', () => {
  it('T4 publishes the breaking catalog 2.0.0 release', () => {
    expect({ name: loupeStd.name, version: loupeStd.version }).toEqual({ name: 'loupe-std', version: '2.0.0' });
  });
  it('T3 admits only direct route authoring and preserves label and tone', () => {
    const props = loupeStd.components.Link!.props;
    const route = { $route: { fabrial: 'track', params: { id: { $bind: 'id' } } } };
    expect(props.safeParse({ href: route, label: 'open', tone: 'agent' }).success).toBe(true);
    for (const href of ['#/notes/track?id=x', { $bind: '/href' }, { $ui: '/href' },
      { $template: '#/notes/${/id}' },
      { $cond: { $ui: '/href', exists: true }, $then: route, $else: route }]) {
      expect(props.safeParse({ href, label: 'open' }).success, JSON.stringify(href)).toBe(false);
    }
    expect(props.safeParse({ href: route }).success).toBe(false);
    expect(props.safeParse({ href: route, label: 'open', tone: 'unknown' }).success).toBe(false);
  });
  it('loads 2.0.0 while refusing old majors and a newer minor', () => {
    const route = { $route: { fabrial: 'track' } };
    expect(validateFabrial(document(route), loupeStd, [], undefined, { notes: ['track'] }).ok).toBe(true);
    for (const version of ['1.4.0', '1.5.0', '2.1.0']) {
      const result = validateFabrial(document(route, version), loupeStd, [], undefined, { notes: ['track'] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((issue) => issue.code)).toEqual(['catalog-pin-mismatch']);
    }
  });

  it('refuses legacy and wrapped hrefs without hash metadata', () => {
    expect(isHashHrefSchema(loupeStd.components.Link?.props.shape.href)).toBe(false);
    const route = { $route: { fabrial: 'track' } };
    for (const href of ['#/notes/track?id=x', { $bind: '/href' }, { $ui: '/href' },
      { $template: '#/notes/${/target}' },
      { $cond: { $bind: '/yes', eq: true }, $then: '#/notes/track', $else: '#/' },
      { $cond: { $bind: '/yes', eq: true }, $then: route, $else: route },
      'https://example.com', 'javascript:alert(1)']) {
      const result = validateFabrial(document(href), loupeStd, [], undefined, { notes: ['track'] });
      expect(result.ok, JSON.stringify(href)).toBe(false);
      if (!result.ok) expect(result.issues.map((issue) => issue.code)).toEqual(['bad-props']);
    }
  });
});
