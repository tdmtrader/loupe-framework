// loupe-std styleguide (catalog-core lane): every primitive + layout component
// in every variant, for side-by-side eyeball QA. Composite impls
// (Board/VerbBar/Hotkeys/RouteGraph/DiffBlock/OverlaySheet) belong to the
// catalog-interactive / catalog-visual lanes and demo through the host.
//
// It mounts either theme, switchable in the header. Both are imported as URLs
// rather than as stylesheets: a plain `import '….css'` from two themes would
// put two :root blocks in the document and the second would simply win. The
// theme is a <link> the toggle rewrites — which is also the most honest demo
// of the claim that a theme IS a file swap. Check a change against BOTH before
// calling it done; classic is the frozen reference and must not move.
import classicCss from '@loupe/tokens/theme-classic.css?url';
import modernCss from '@loupe/tokens/theme-modern.css?url';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ComponentImpl, ComponentImplArgs, Json } from '@loupe/spec';
import {
  BADGE_TONES,
  ACCENT_TONES,
  TEXT_TIERS,
  BUTTON_VARIANTS,
  BG_TOKENS,
  type TextareaImplProps,
} from '../src/defs/index.ts';
import {
  Text,
  MicroLabel,
  Prose,
  Badge,
  Button,
  Chip,
  Numeral,
  Pip,
  Divider,
  MetaRow,
  Digest,
  Textarea,
} from '../src/react/primitives/index.ts';
import {
  Stack,
  Row,
  Grid,
  Panel,
  Band,
  InsetHeader,
  SidePanel,
  StickyFooter,
  Spacer,
  ScrollArea,
} from '../src/react/layout/index.ts';

/** Mount one impl with resolved props + a console-logging emit. */
function show<P>(
  impl: ComponentImpl<ReactNode, P>,
  props: P,
  extra?: Partial<Pick<ComponentImplArgs<ReactNode, P>, 'children' | 'slots'>>,
  onEmit?: (event: string, payload?: Json) => void,
): ReactNode {
  const args: ComponentImplArgs<ReactNode, P> = {
    props,
    emit: (event: string, payload?: Json) => {
      console.log('emit', event, payload);
      onEmit?.(event, payload);
    },
    itemSlot: () => null,
    ...extra,
  };
  return impl(args);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          fontSize: 'var(--lp-size-10)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 'var(--lp-tracking-section)',
          color: 'var(--lp-text-dim)',
          borderBottom: '1px solid var(--lp-border-primary)',
          paddingBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function Line({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      {label !== undefined && (
        <span style={{ width: 110, flex: 'none', fontSize: 'var(--lp-size-10)', fontWeight: 400, color: 'var(--lp-text-muted)' }}>
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

function TextareaDemo(props: Omit<TextareaImplProps, 'bindUi'> & { initial: string }) {
  const { initial, ...rest } = props;
  const [value, setValue] = useState<Json>(initial);
  return (
    <div style={{ width: 360 }}>
      {show(Textarea, { ...rest, bindUi: { value, set: setValue } } as TextareaImplProps)}
    </div>
  );
}

const accentTones = ACCENT_TONES.filter((t) => t !== 'none');

const THEMES = { modern: modernCss, classic: classicCss } as const;
type ThemeName = keyof typeof THEMES;

/** Swap the one <link> that carries the :root block. */
function useTheme(): [ThemeName, (t: ThemeName) => void] {
  const [name, setName] = useState<ThemeName>('modern');
  useEffect(() => {
    let link = document.getElementById('lp-theme');
    if (!(link instanceof HTMLLinkElement)) {
      link = document.createElement('link');
      link.id = 'lp-theme';
      (link as HTMLLinkElement).rel = 'stylesheet';
      document.head.appendChild(link);
    }
    (link as HTMLLinkElement).href = THEMES[name];
  }, [name]);
  return [name, setName];
}

function App() {
  const [theme, setTheme] = useTheme();
  return (
    <main
      style={{
        fontFamily: 'var(--lp-font-family)',
        letterSpacing: 'var(--lp-letter-spacing)',
        fontWeight: 'var(--lp-weight-medium)' as never,
        fontSize: 'var(--lp-size-12)',
        lineHeight: 'var(--lp-line-height-base)',
        background: 'var(--lp-bg-page)',
        color: 'var(--lp-text-primary)',
        minHeight: '100vh',
        padding: '20px 24px 60px',
        display: 'flex',
        flexDirection: 'column',
        gap: 26,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span
          style={{
            fontSize: 'var(--lp-size-18)',
            fontWeight: 'var(--lp-weight-max)' as never,
            color: 'var(--lp-text-heading)',
          }}
        >
          loupe-std styleguide
        </span>
        <span
          style={{
            fontSize: 'var(--lp-size-11)',
            fontWeight: 'var(--lp-weight-body)' as never,
            color: 'var(--lp-text-dim)',
          }}
        >
          primitives + layout · classic is the frozen reference look
        </span>
        <span style={{ flex: 1 }} />
        {(Object.keys(THEMES) as ThemeName[]).map((name) => (
          <span key={name}>
            {show(Chip, { label: name, active: theme === name }, undefined, () => setTheme(name))}
          </span>
        ))}
      </header>

      <Section title="Text — tiers / sizes / weights / tone / upper / strike">
        <Line label="tiers">
          {TEXT_TIERS.map((tier) => show(Text, { text: tier, tier }))}
        </Line>
        <Line label="sizes">
          {([10, 11, 12, 14, 16, 18, 24] as const).map((size) => show(Text, { text: `${size}px`, size }))}
        </Line>
        <Line label="weights">
          {([400, 700, 900] as const).map((weight) => show(Text, { text: `w${weight}`, weight }))}
        </Line>
        <Line label="variants">
          {show(Text, { text: 'uppercase', upper: true })}
          {show(Text, { text: 'struck through', strike: true, tier: 'secondary' })}
          {show(Text, { text: 'badText tone', tone: 'badText' })}
          {show(Text, { text: 'waitText tone', tone: 'waitText' })}
        </Line>
      </Section>

      <Section title="MicroLabel — section .12em / interactive .09em / tones">
        <Line label="tracking">
          {show(MicroLabel, { text: 'the walk' })}
          {show(MicroLabel, { text: 'your review', tracking: 'section' })}
          {show(MicroLabel, { text: 'why', tracking: 'interactive' })}
        </Line>
        <Line label="tones">
          {show(MicroLabel, { text: 'agent', tone: 'agent' })}
          {show(MicroLabel, { text: 'person', tone: 'person' })}
          {show(MicroLabel, { text: 'waitBright', tone: 'waitBright' })}
          {show(MicroLabel, { text: 'done', tone: 'done' })}
        </Line>
      </Section>

      <Section title="Prose — 12/400 lh 1.65, ch-capped measure">
        {show(Prose, {
          text: 'the webhook path never re-derives the panel; it reads the served projection and trusts it. that is the part you cannot check by reading — re-run it and see whether the second derivation ever disagrees with the first.',
        })}
        {show(Prose, { text: 'a tighter 62ch measure, secondary tier, struck.', maxCh: 62, tier: 'secondary', strike: true })}
      </Section>

      <Section title="Badge — every tone, outline vs filled (triads resolved internally)">
        {BADGE_TONES.map((tone) => (
          <Line key={tone} label={tone}>
            {show(Badge, { label: tone, tone })}
            {show(Badge, { label: tone, tone, filled: true })}
          </Line>
        ))}
      </Section>

      <Section title="Button — variants / keyHint / disabled / flex">
        <Line label="variants">
          {BUTTON_VARIANTS.map((variant) => show(Button, { label: variant, variant }))}
        </Line>
        <Line label="keyHint">
          {show(Button, { label: 'keep', variant: 'confirm', keyHint: 'K' })}
          {show(Button, { label: 'drop', variant: 'ghost', keyHint: 'D' })}
          {show(Button, { label: 'block', variant: 'danger', keyHint: '⇧B' })}
        </Line>
        <Line label="disabled">
          {BUTTON_VARIANTS.map((variant) => show(Button, { label: variant, variant, disabled: true }))}
        </Line>
        <Line label="flex">
          <div style={{ display: 'flex', width: 420, gap: 8 }}>
            {show(Button, { label: 'release to author', variant: 'primary', flex: true })}
          </div>
        </Line>
      </Section>

      <Section title="Chip — inverted when active">
        <Line label="neutral">
          {show(Chip, { label: 'this commit', active: false })}
          {show(Chip, { label: 'all 14 files', active: true })}
        </Line>
        <Line label="sev tones">
          {(['blocking', 'notable', 'minor'] as const).map((tone) => show(Chip, { label: tone, active: false, tone }))}
          {(['blocking', 'notable', 'minor'] as const).map((tone) => show(Chip, { label: tone, active: true, tone }))}
        </Line>
      </Section>

      <Section title="Numeral — every number is a sentence">
        <Line>
          {show(Numeral, { value: 12, label: 'of 22 findings to triage', color: 'agent' })}
          {show(Numeral, { value: 7, label: 'done this week', color: 'done' })}
          {show(Numeral, { value: '3', label: 'need a person', color: 'waitText' })}
          {show(Numeral, { value: 4 })}
        </Line>
      </Section>

      <Section title="Pip — states / 10 vs 12 / hollow">
        <Line label="12px">
          <div style={{ display: 'flex', gap: 3 }}>{accentTones.map((state) => show(Pip, { state }))}</div>
        </Line>
        <Line label="10px">
          <div style={{ display: 'flex', gap: 3 }}>{accentTones.map((state) => show(Pip, { state, size: 10 }))}</div>
        </Line>
        <Line label="hollow">
          <div style={{ display: 'flex', gap: 3 }}>
            {(['agent', 'person', 'done', 'muted'] as const).map((state) => show(Pip, { state, hollow: true }))}
          </div>
        </Line>
      </Section>

      <Section title="Divider / MetaRow / Digest">
        <Line label="divider">
          {show(Text, { text: 'loupe' })}
          {show(Divider, {})}
          {show(Text, { text: 'the board', tier: 'secondary' })}
        </Line>
        <Line label="metarow">{show(MetaRow, { parts: ['PAY-2112', 'node review', 'round 2', '41m'] })}</Line>
        <Line label="digest">
          {show(Digest, { value: 'sha256:a1b2c3d' })}
          {show(Digest, { value: 'sha256:a1b2c3d', pairWith: 'sha256:e5f6a7b' })}
        </Line>
      </Section>

      <Section title="Textarea — bindUi draft (lossable by design)">
        <Line label="agent border">
          <TextareaDemo initial="half-typed finding draft…" placeholder="what is wrong with this line" borderTone="agent" />
        </Line>
        <Line label="neutral">
          <TextareaDemo initial="" placeholder="disposition note" minHeight={48} />
        </Line>
      </Section>

      <Section title="Stack / Row — box channel: bg / borders / pad / accent bars">
        <Line label="bg tokens">
          {BG_TOKENS.filter((bg) => bg !== 'none').map((bg) => (
            <div key={bg} style={{ border: '1px solid var(--lp-border-hairline)' }}>
              {show(Stack, { pad: [8, 10], bg }, { children: show(Text, { text: bg, size: 10, weight: 400, tier: 'secondary' }) })}
            </div>
          ))}
        </Line>
        <Line label="accent 2px">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 340 }}>
            {(['agent', 'person', 'doneDeep', 'border'] as const).map((accent) => (
              <div key={accent}>
                {show(
                  Row,
                  { pad: [8, 12], gap: 8, bg: 'panel', accent },
                  { children: show(Text, { text: `accent ${accent}`, tier: 'body' }) },
                )}
              </div>
            ))}
          </div>
        </Line>
        <Line label="3px cursor row">
          <div style={{ width: 340 }}>
            {show(
              Row,
              { pad: [10, 12], gap: 8, bg: 'selectedViolet', accent: 'agent', accentWidth: 3 },
              { children: show(Text, { text: 'current finding row', tier: 'heading' }) },
            )}
          </div>
        </Line>
        <Line label="accentEdge top">
          <div style={{ width: 340 }}>
            {show(
              Stack,
              { pad: [8, 12], bg: 'panel', accent: 'now', accentWidth: 3, accentEdge: 'top' },
              { children: show(Text, { text: 'current commit rail cell', tier: 'body' }) },
            )}
          </div>
        </Line>
        <Line label="opacity .45">
          <div style={{ width: 340 }}>
            {show(
              Row,
              { pad: [8, 12], bg: 'panel', accent: 'border', opacity: 0.45 },
              { children: show(Text, { text: 'dragging source', tier: 'body' }) },
            )}
          </div>
        </Line>
      </Section>

      <Section title="Grid — raw comp templates, cellBorders hairlines">
        {show(
          Grid,
          { template: '248px 1fr 1fr 1.3fr 88px', cellBorders: true },
          {
            children: ['track', 'agent working', 'needs a person', 'waiting', 'done'].map((label) =>
              show(Stack, { pad: [8, 10], bg: 'raised' }, { children: show(MicroLabel, { text: label }) }),
            ),
          },
        )}
        {show(
          Grid,
          { template: '400px 1fr', gap: 12, bg: 'page' },
          {
            children: [
              show(Stack, { pad: 10, bg: 'panel' }, { children: show(Text, { text: 'queue (400px)' }) }),
              show(Stack, { pad: 10, bg: 'panel' }, { children: show(Text, { text: 'evidence (1fr)' }) }),
            ],
          },
        )}
      </Section>

      <Section title="Panel — panel / inset, title, note, footnote">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 320 }}>
            {show(
              Panel,
              { title: 'the board', note: 'five tracks, one paused', bg: 'panel', footnote: 'reject opens round 3 from the plan; nothing is lost.' },
              { children: show(Prose, { text: 'body content composed by the fabrial.' }) },
            )}
          </div>
          <div style={{ width: 320 }}>
            {show(Panel, { title: 'not built yet', bg: 'inset' }, { children: show(Prose, { text: 'inset variant.' }) })}
          </div>
        </div>
      </Section>

      <Section title="Band / InsetHeader">
        {show(Band, {}, {
          children: (
            <>
              {show(MicroLabel, { text: 'route' })}
              {show(Text, { text: 'ship-change@7', tier: 'heading', size: 14, weight: 900 })}
              {show(Spacer, {})}
              {show(Digest, { value: 'sha256:44el9' })}
            </>
          ),
        })}
        {show(InsetHeader, { label: 'in commit 2 of 5', right: '3 files' })}
        {show(InsetHeader, { label: 'settled' })}
      </Section>

      <Section title="SidePanel + StickyFooter — queue shell">
        <div style={{ height: 260, width: 400, border: '1px solid var(--lp-border-primary)' }}>
          {show(SidePanel, {}, {
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {(['r1f6 — catalog pin is unchecked', 'r1f7 — origin_phase is untyped', 'r1f8 — fold ties are unspecified'] as const).map(
                  (t, i) =>
                    show(
                      Row,
                      { pad: [10, 12], gap: 8, bg: i === 0 ? 'selectedViolet' : 'none', accent: i === 0 ? 'agent' : 'border', accentWidth: 3 },
                      { children: show(Text, { text: t, tier: i === 0 ? 'heading' : 'body' }) },
                    ),
                )}
              </div>
            ),
            slots: {
              footer: show(
                StickyFooter,
                { note: '4 findings undecided · 3 fixes awaiting resolution', noteTone: 'waitText' },
                {
                  slots: {
                    actions: (
                      <>
                        {show(Button, { label: 'undo', variant: 'ghost', keyHint: 'U' })}
                        {show(Button, { label: 'release to author', variant: 'primary', flex: true })}
                      </>
                    ),
                  },
                },
              ),
            },
          })}
        </div>
      </Section>

      <Section title="ScrollArea — x / y">
        <div style={{ width: 340, border: '1px solid var(--lp-border-hairline)' }}>
          {show(ScrollArea, { axis: 'x' }, {
            children: (
              <div style={{ display: 'flex', gap: 8, padding: 8, width: 900 }}>
                {Array.from({ length: 12 }, (_, i) => show(Badge, { label: `node-${i + 1}`, tone: 'neutral' }))}
              </div>
            ),
          })}
        </div>
        <div style={{ width: 340, height: 90, display: 'flex', flexDirection: 'column', border: '1px solid var(--lp-border-hairline)' }}>
          {show(ScrollArea, { axis: 'y' }, {
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 8 }}>
                {Array.from({ length: 10 }, (_, i) => show(Text, { text: `row ${i + 1}`, tier: 'secondary', weight: 400 }))}
              </div>
            ),
          })}
        </div>
      </Section>
    </main>
  );
}

const rootEl = document.getElementById('root');
if (rootEl === null) throw new Error('no #root');
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
