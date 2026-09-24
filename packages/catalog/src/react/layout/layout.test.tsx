// Browser-mode render checks: every layout component, computed styles vs tokens.
import { describe, expect, test, vi } from 'vitest';
import { mount, rgb, tokenColors } from '../primitives/test-kit.tsx';
import {
  Band,
  Grid,
  InsetHeader,
  Panel,
  Row,
  ScrollArea,
  SidePanel,
  Spacer,
  Stack,
  StickyFooter,
} from './index.ts';

const c = tokenColors;

describe('Stack', () => {
  test('flex column default; gap/pad/bg/borders/opacity', () => {
    const { css, el } = mount(Stack, 'Stack', {
      gap: 8,
      pad: [10, 16],
      bg: 'panel',
      borders: 'both',
      opacity: 0.82,
    });
    expect(css().display).toBe('flex');
    expect(css().flexDirection).toBe('column');
    expect(css().gap).toBe('8px');
    expect(el.style.padding).toBe('10px 16px');
    expect(css().backgroundColor).toBe(rgb(c.bg.panel));
    expect(css().borderTopColor).toBe(rgb(c.border.primary));
    expect(css().borderBottomColor).toBe(rgb(c.border.primary));
    expect(css().opacity).toBe('0.82');
    expect(mount(Stack, 'Stack', { direction: 'row' }).css().flexDirection).toBe('row');
  });
});

describe('Row', () => {
  test('accent agent = 2px left border --lp-accent-agent by default', () => {
    const { css } = mount(Row, 'Row', { accent: 'agent' });
    expect(css().borderLeftWidth).toBe('2px');
    expect(css().borderLeftStyle).toBe('solid');
    expect(css().borderLeftColor).toBe(rgb(c.accent.agent));
    expect(css().display).toBe('flex');
    expect(css().flexDirection).toBe('row');
  });
  test('accentWidth 3 / accentEdge top / 4-tuple pad / selected-violet bg', () => {
    const { css, el } = mount(Row, 'Row', {
      accent: 'doneDeep',
      accentWidth: 3,
      accentEdge: 'top',
      pad: [8, 12, 8, 12],
      bg: 'selectedViolet',
    });
    expect(css().borderTopWidth).toBe('3px');
    expect(css().borderTopColor).toBe(rgb(c.accent.doneDeep));
    expect(el.style.padding).toBe('8px 12px');
    expect(css().backgroundColor).toBe(rgb(c.bg.selectedViolet));
  });
  test('press emits; accent none renders no bar', () => {
    const { el, emit } = mount(Row, 'Row', { accent: 'none' });
    expect(getComputedStyle(el).borderLeftWidth).toBe('0px');
    el.click();
    expect(emit).toHaveBeenCalledWith('press');
  });
});

describe('Grid', () => {
  test('raw template flows through; cellBorders = hairline bg + 1px gap', () => {
    const { el, css } = mount(Grid, 'Grid', { template: '400px 1fr', cellBorders: true });
    expect(css().display).toBe('grid');
    expect(el.style.gridTemplateColumns).toBe('400px 1fr');
    expect(css().backgroundColor).toBe(rgb(c.border.primary));
    expect(css().gap).toBe('1px');
    const plain = mount(Grid, 'Grid', { template: '248px 1fr 1fr 1.3fr 88px', gap: 2, bg: 'page' });
    expect(plain.css().gap).toBe('2px');
    expect(plain.css().backgroundColor).toBe(rgb(c.bg.page));
  });
});

describe('Panel', () => {
  test('panel/inset bg, micro-label title, note + footnote', () => {
    const { css, q } = mount(Panel, 'Panel', {
      title: 'the board',
      note: 'five tracks',
      bg: 'panel',
      footnote: 'reject opens round 3 from the plan',
    });
    expect(css().backgroundColor).toBe(rgb(c.bg.panel));
    expect(css().borderTopColor).toBe(rgb(c.border.primary));
    expect(css(q('Panel-title')).textTransform).toBe('uppercase');
    expect(css(q('Panel-title')).fontSize).toBe('10px');
    expect(css(q('Panel-footnote')).fontWeight).toBe('400');
    expect(mount(Panel, 'Panel', { bg: 'inset' }).css().backgroundColor).toBe(rgb(c.bg.inset));
  });
});

describe('Band', () => {
  test('raised strip with bottom hairline; default pad', () => {
    const { css, el } = mount(Band, 'Band', {});
    expect(css().backgroundColor).toBe(rgb(c.bg.raised));
    expect(css().borderBottomWidth).toBe('1px');
    expect(css().borderBottomColor).toBe(rgb(c.border.primary));
    expect(el.style.padding).toBe('10px 16px');
    expect(mount(Band, 'Band', { pad: [6, 12] }).el.style.padding).toBe('6px 12px');
  });
});

describe('InsetHeader', () => {
  test('bg.inset micro-label row with dim right text', () => {
    const { css, q } = mount(InsetHeader, 'InsetHeader', { label: 'settled', right: '2' });
    expect(css().backgroundColor).toBe(rgb(c.bg.inset));
    expect(css(q('InsetHeader-label')).textTransform).toBe('uppercase');
    expect(css(q('InsetHeader-label')).fontSize).toBe('10px');
    expect(css(q('InsetHeader-right')).color).toBe(rgb(c.text.dim));
  });
});

describe('SidePanel', () => {
  test('panel bg, scrollable body, footer slot', () => {
    const { css, q, el } = mount(SidePanel, 'SidePanel', {}, {
      children: 'queue rows',
      slots: { footer: <div data-lp="test-footer">footer</div> },
    });
    expect(css().backgroundColor).toBe(rgb(c.bg.panel));
    expect(css(q('SidePanel-body')).overflowY).toBe('auto');
    expect(q('SidePanel-body').textContent).toBe('queue rows');
    expect(el.querySelector('[data-lp="test-footer"]')).not.toBeNull();
  });
});

describe('StickyFooter', () => {
  test('raised + top hairline; toned note; actions slot', () => {
    const { css, q } = mount(
      StickyFooter,
      'StickyFooter',
      { note: '3 findings still untriaged', noteTone: 'waitText' },
      { slots: { actions: <div data-lp="test-actions">undo</div> } },
    );
    expect(css().backgroundColor).toBe(rgb(c.bg.raised));
    expect(css().borderTopColor).toBe(rgb(c.border.primary));
    expect(css(q('StickyFooter-note')).color).toBe(rgb(c.accent.waitText));
    expect(q('StickyFooter-actions').textContent).toBe('undo');
    const plain = mount(StickyFooter, 'StickyFooter', { note: 'x' });
    expect(plain.css(plain.q('StickyFooter-note')).color).toBe(rgb(c.text.secondary));
  });
});

describe('Spacer', () => {
  test('flex 1', () => {
    const { css } = mount(Spacer, 'Spacer', {});
    expect(css().flexGrow).toBe('1');
  });
});

describe('ScrollArea', () => {
  test('single-axis scrolling', () => {
    const x = mount(ScrollArea, 'ScrollArea', { axis: 'x' });
    expect(x.css().overflowX).toBe('auto');
    expect(x.css().overflowY).toBe('hidden');
    const y = mount(ScrollArea, 'ScrollArea', { axis: 'y' });
    expect(y.css().overflowY).toBe('auto');
    expect(y.css().overflowX).toBe('hidden');
  });
});

describe('scrollIntoView (1.1.0 cursor follow)', () => {
  const flushEffects = () => new Promise((r) => setTimeout(r, 0));

  test('Stack: fires on the rising edge only, block nearest', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { rerender } = mount(Stack, 'Stack', { scrollIntoView: false } as Record<string, unknown>);
    await flushEffects();
    expect(spy).not.toHaveBeenCalled();

    rerender({ scrollIntoView: true });
    await flushEffects();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });

    // still true: redundant renders do not re-fire
    rerender({ scrollIntoView: true, gap: 4 });
    await flushEffects();
    expect(spy).toHaveBeenCalledTimes(1);

    // falling edge is silent; the next rising edge fires again
    rerender({ scrollIntoView: false });
    await flushEffects();
    expect(spy).toHaveBeenCalledTimes(1);
    rerender({ scrollIntoView: true });
    await flushEffects();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test('Row: same rising-edge contract; absent prop never scrolls', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { rerender } = mount(Row, 'Row', {} as Record<string, unknown>);
    await flushEffects();
    expect(spy).not.toHaveBeenCalled();
    rerender({ scrollIntoView: true });
    await flushEffects();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// Track 20260831T1457_triage_defects, Phase 4 (loupe-std 1.2.0). A screen that
// fills its viewport needs a flex child that claims the remaining main-axis
// space AND may shrink below its content — without the min-* reset the child
// refuses to shrink and the rails inside it never scroll.
describe('grow (box channel, 1.2.0)', () => {
  test('Stack grow: flex 1 1 0% with both min-* resets', () => {
    const { css } = mount(Stack, 'Stack', { grow: true });
    expect(css().flexGrow).toBe('1');
    expect(css().flexShrink).toBe('1');
    expect(css().flexBasis).toBe('0%');
    expect(css().minHeight).toBe('0px');
    expect(css().minWidth).toBe('0px');
  });

  test('Stack without grow is inert', () => {
    expect(mount(Stack, 'Stack', {}).css().flexGrow).toBe('0');
  });

  test('Row grow behaves the same', () => {
    const { css } = mount(Row, 'Row', { grow: true });
    expect(css().flexGrow).toBe('1');
    expect(css().flexBasis).toBe('0%');
  });

  test('Grid grow overrides the default 1 1 auto and allows shrink', () => {
    const { css } = mount(Grid, 'Grid', { template: '1fr 1fr', grow: true });
    expect(css().flexGrow).toBe('1');
    expect(css().flexBasis).toBe('0%');
    expect(css().minHeight).toBe('0px');
  });

  test('Grid without grow keeps its stretch default', () => {
    const { css } = mount(Grid, 'Grid', { template: '1fr' });
    expect(css().flexGrow).toBe('1');
    expect(css().flexBasis).toBe('auto');
  });

  test('ScrollArea grow keeps its axis overflow', () => {
    const { css } = mount(ScrollArea, 'ScrollArea', { axis: 'y', grow: true });
    expect(css().overflowY).toBe('auto');
    expect(css().flexGrow).toBe('1');
    expect(css().minHeight).toBe('0px');
  });
});
