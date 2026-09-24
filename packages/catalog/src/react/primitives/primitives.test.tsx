// Browser-mode render checks: every primitive, computed styles vs token values.
import { describe, expect, test } from 'vitest';
import { mount, rgb, sameColor, tokenColors } from './test-kit.tsx';
import {
  Badge,
  Button,
  Chip,
  Digest,
  Divider,
  Link,
  MetaRow,
  MicroLabel,
  Numeral,
  Pip,
  Prose,
  Text,
  Textarea,
} from './index.ts';

const c = tokenColors;

describe('Text', () => {
  test('defaults: 12px/700 primary, Inconsolata', () => {
    const { css } = mount(Text, 'Text', { text: 'release to author' });
    expect(css().color).toBe(rgb(c.text.primary));
    expect(css().fontSize).toBe('12px');
    expect(css().fontWeight).toBe('700');
    expect(css().fontFamily).toContain('Inconsolata');
  });
  test('tier/size/weight/upper/strike/tone', () => {
    const { css, el } = mount(Text, 'Text', {
      text: 'x',
      tier: 'dim',
      size: 14,
      weight: 900,
      upper: true,
      strike: true,
    });
    expect(css().color).toBe(rgb(c.text.dim));
    expect(css().fontSize).toBe('14px');
    expect(css().fontWeight).toBe('900');
    expect(css().textTransform).toBe('uppercase');
    expect(css().textDecorationLine).toBe('line-through');
    expect(el.textContent).toBe('x'); // source stays lowercase; uppercase is a CSS transform
    const toned = mount(Text, 'Text', { text: 'x', tone: 'badText' });
    expect(toned.css().color).toBe(rgb(c.accent.badText));
  });
});

describe('MicroLabel', () => {
  test('uppercase 10px/700 secondary, section tracking .12em', () => {
    const { css } = mount(MicroLabel, 'MicroLabel', { text: 'the walk' });
    expect(css().fontSize).toBe('10px');
    expect(css().fontWeight).toBe('700');
    expect(css().textTransform).toBe('uppercase');
    expect(css().color).toBe(rgb(c.text.secondary));
    expect(parseFloat(css().letterSpacing)).toBeCloseTo(10 * 0.12, 3);
  });
  test('interactive tracking .09em + tone', () => {
    const { css } = mount(MicroLabel, 'MicroLabel', { text: 'why', tracking: 'interactive', tone: 'agent' });
    expect(parseFloat(css().letterSpacing)).toBeCloseTo(10 * 0.09, 3);
    expect(css().color).toBe(rgb(c.accent.agent));
  });
});

describe('Prose', () => {
  test('12/400 body with ch-capped measure', () => {
    const { css, el } = mount(Prose, 'Prose', { text: 'the part you cannot check by reading' });
    expect(css().fontWeight).toBe('400');
    expect(css().fontSize).toBe('12px');
    expect(css().color).toBe(rgb(c.text.body));
    expect(el.style.maxWidth).toBe('68ch');
    const capped = mount(Prose, 'Prose', { text: 'x', maxCh: 76 });
    expect(capped.el.style.maxWidth).toBe('76ch');
  });
});

describe('Badge', () => {
  // `filled` resolves through color-mix against the theme's two ratios, so
  // these read channels rather than the computed string's spelling. Under
  // classic (100% fill / 0% tone) the mix is the identity: the slab.
  test('bad filled = accent.bad bg + ink text', () => {
    const { css } = mount(Badge, 'Badge', { label: 'blocking', tone: 'bad', filled: true });
    expect(sameColor(css().backgroundColor, c.accent.bad)).toBe(true);
    expect(sameColor(css().color, c.text.inverse)).toBe(true);
    expect(css().textTransform).toBe('uppercase');
    expect(css().fontSize).toBe('10px');
  });
  test('outline = deep border + pale text (triad resolved internally)', () => {
    const { css } = mount(Badge, 'Badge', { label: 'notable', tone: 'notable' });
    expect(css().backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(css().borderTopColor).toBe(rgb(c.tone.wait.border));
    expect(css().color).toBe(rgb(c.tone.wait.text));
  });
  test('severity + claim tones map onto triads', () => {
    const bg = (props: Record<string, unknown>) =>
      mount(Badge, 'Badge', props as never).css().backgroundColor;
    expect(sameColor(bg({ label: 'x', tone: 'blocking', filled: true }), c.tone.bad.fill)).toBe(true);
    expect(mount(Badge, 'Badge', { label: 'x', tone: 'minor' }).css().borderTopColor).toBe(rgb(c.border.idle));
    expect(sameColor(bg({ label: 'x', tone: 'witnessed', filled: true }), c.claim.witnessed)).toBe(true);
    expect(sameColor(bg({ label: 'x', tone: 'observed', filled: true }), c.claim.observed)).toBe(true);
  });
});

describe('Button', () => {
  test('primary filled person-blue + ink text, radius 0', () => {
    const { css } = mount(Button, 'Button', { label: 'release to author', variant: 'primary' });
    expect(css().backgroundColor).toBe(rgb(c.accent.person));
    expect(css().color).toBe(rgb(c.text.inverse));
    expect(css().borderTopLeftRadius).toBe('0px');
    expect(css().textTransform).toBe('uppercase');
  });
  test('confirm/agent fills; ghost idle; danger is ghost-red never filled', () => {
    expect(mount(Button, 'Button', { label: 'keep', variant: 'confirm' }).css().backgroundColor).toBe(
      rgb(c.accent.done),
    );
    expect(mount(Button, 'Button', { label: 'save', variant: 'agent' }).css().backgroundColor).toBe(
      rgb(c.accent.agent),
    );
    const ghost = mount(Button, 'Button', { label: 'edit', variant: 'ghost' });
    expect(ghost.css().backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(ghost.css().borderTopColor).toBe(rgb(c.border.idle));
    expect(ghost.css().color).toBe(rgb(c.text.secondary));
    const danger = mount(Button, 'Button', { label: 'block', variant: 'danger' });
    expect(danger.css().backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(danger.css().borderTopColor).toBe(rgb(c.border.red));
    expect(danger.css().color).toBe(rgb(c.accent.badText));
  });
  test('keyHint prints dim inside the label; press emits; disabled does not', () => {
    const { el, emit, q } = mount(Button, 'Button', { label: 'keep', variant: 'confirm', keyHint: 'K' });
    expect(q('Button-keyHint').textContent).toBe('K');
    el.click();
    expect(emit).toHaveBeenCalledWith('press');
    const disabled = mount(Button, 'Button', { label: 'x', variant: 'ghost', disabled: true });
    disabled.el.click();
    expect(disabled.emit).not.toHaveBeenCalled();
  });
});

describe('Chip', () => {
  test('inactive ghost; active inverts to ink-on-tone', () => {
    const off = mount(Chip, 'Chip', { label: 'this commit', active: false });
    expect(off.css().backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(off.css().color).toBe(rgb(c.text.secondary));
    expect(off.css().borderTopColor).toBe(rgb(c.border.idle));
    const on = mount(Chip, 'Chip', { label: 'all 14 files', active: true });
    expect(on.css().backgroundColor).toBe(rgb(c.text.secondary));
    expect(on.css().color).toBe(rgb(c.text.inverse));
    const sev = mount(Chip, 'Chip', { label: 'blocking', active: true, tone: 'blocking' });
    expect(sev.css().backgroundColor).toBe(rgb(c.accent.bad));
  });
  test('press emits', () => {
    const { el, emit } = mount(Chip, 'Chip', { label: 'x', active: false });
    el.click();
    expect(emit).toHaveBeenCalledWith('press');
  });
});

describe('Numeral', () => {
  test('24/900 value + 11/400 label — every number is a sentence', () => {
    const { q, css } = mount(Numeral, 'Numeral', { value: 12, label: 'of 22 findings to triage', color: 'agent' });
    expect(css(q('Numeral-value')).fontSize).toBe('24px');
    expect(css(q('Numeral-value')).fontWeight).toBe('900');
    expect(css(q('Numeral-value')).color).toBe(rgb(c.accent.agent));
    expect(css(q('Numeral-label')).fontSize).toBe('11px');
    expect(css(q('Numeral-label')).fontWeight).toBe('400');
  });
});

describe('Pip', () => {
  test('12px filled square in state color; 10px hollow slot', () => {
    const filled = mount(Pip, 'Pip', { state: 'agent' });
    expect(filled.css().width).toBe('12px');
    expect(filled.css().backgroundColor).toBe(rgb(c.accent.agent));
    const hollow = mount(Pip, 'Pip', { state: 'muted', size: 10, hollow: true });
    expect(hollow.css().width).toBe('10px');
    expect(hollow.css().backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(hollow.css().borderTopColor).toBe(rgb(c.border.idle));
  });
});

describe('Divider', () => {
  test('1px border.primary hairline', () => {
    const { css } = mount(Divider, 'Divider', {});
    expect(css().width).toBe('1px');
    expect(css().backgroundColor).toBe(rgb(c.border.primary));
  });
});

describe('MetaRow', () => {
  test('parts joined by muted · separators', () => {
    const { el, css, q } = mount(MetaRow, 'MetaRow', { parts: ['digest', 'node review', 'round 2'] });
    expect(el.textContent).toContain('node review');
    expect(el.querySelectorAll('[data-lp="MetaRow-sep"]').length).toBe(2);
    expect(css(q('MetaRow-sep')).color).toBe(rgb(c.text.muted));
    expect(css().color).toBe(rgb(c.text.secondary));
  });
});

describe('Digest', () => {
  test('person-blue sha; pair form renders →', () => {
    const { css } = mount(Digest, 'Digest', { value: 'sha256:a1b2c3d' });
    expect(css().color).toBe(rgb(c.accent.person));
    const pair = mount(Digest, 'Digest', { value: 'sha256:a1b2c3d', pairWith: 'sha256:e5f6a7b' });
    expect(pair.el.textContent).toContain('→');
    expect(pair.css(pair.q('Digest-arrow')).color).toBe(rgb(c.text.muted));
  });
});

describe('Textarea', () => {
  test('ink bg, mono, borderTone; renders binding value; typing calls set', () => {
    let setWith: unknown;
    const { el, css } = mount(Textarea, 'Textarea', {
      bindUi: { value: 'half-typed draft', set: (v) => (setWith = v) },
      placeholder: 'what is wrong with this line',
      borderTone: 'agent',
    });
    const ta = el as HTMLTextAreaElement;
    expect(ta.value).toBe('half-typed draft');
    expect(css().backgroundColor).toBe(rgb(c.bg.page));
    expect(css().borderTopColor).toBe(rgb(c.border.violet));
    expect(css().fontFamily).toContain('Inconsolata');
    expect(css().fontWeight).toBe('400');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    setter?.set?.call(ta, 'rewritten');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(setWith).toBe('rewritten');
    const neutral = mount(Textarea, 'Textarea', { bindUi: { value: undefined, set: () => {} } });
    expect((neutral.el as HTMLTextAreaElement).value).toBe('');
    expect(neutral.css().borderTopColor).toBe(rgb(c.border.primary));
  });
});

describe('Link', () => {
  // Two clauses, both required. The first alone would pass on a component that
  // rendered nothing at all; the second alone would pass on one that rendered
  // an anchor for anything.
  test('a runtime href not beginning "#/" renders a label and NO anchor', () => {
    for (const href of ['https://evil.example', 'javascript:alert(1)', '/notes/track', '']) {
      const { el } = mount(Link, 'Link-inert', { href: href as never, label: 'open the track' });
      expect(el.tagName, href).toBe('SPAN');
      expect(el.textContent, href).toBe('open the track');
      expect(el.querySelector('a'), href).toBeNull();
    }
  });
  test('an in-app "#/…" href renders a real anchor carrying it', () => {
    const { el, css } = mount(Link, 'Link', {
      href: '#/notes/track?id=20260903T0453' as never,
      label: 'open the track',
    });
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('#/notes/track?id=20260903T0453');
    expect(el.textContent).toBe('open the track');
    expect(css().textDecorationLine).toBe('none');
    expect(css().borderBottomColor).toBe(rgb(c.border.idle));
    expect(css().color).toBe(rgb(c.text.primary));
    const toned = mount(Link, 'Link', { href: '#/notes/begin' as never, label: 'x', tone: 'agent' });
    expect(toned.css().color).toBe(rgb(c.accent.agent));
  });
});
