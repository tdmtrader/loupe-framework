// The host shell (§6.2): hash routes over the file/proxy server. '/#/' is the
// launcher (apps × fabrials, validation refusals as visible rows — hand-JSX);
// '/#/:app/:fabrialPath?params' validates and mounts <LoupeRenderer> with a
// wsClient bound through the proxy. The host owns zero domain logic and zero
// state.
// The theme is a file swap, and this line is the swap: point it at
// theme-classic.css to get the original look back, unchanged.
import '@loupe/tokens/theme-modern.css';
import './global.css';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { zAppDescriptor, type AppDescriptor, type VerbError, type VerbOk } from '@loupe/protocol';
import { validateFabrial, zFabrial, type Fabrial, type Issue } from '@loupe/spec';
import { loupeStd } from '@loupe/catalog';
import { components } from '@loupe/catalog/react';
import { LoupeRenderer } from '@loupe/renderer';
import { wsClient } from '@loupe/client';
import { shellBodyStyle, shellHeaderStyle, shellStyle } from './shell-style.ts';

// ------------------------------------------------------------------- styles

// Host chrome reads the same vars the catalog does — the shell must not be the
// one place a theme cannot reach. (fontWeight/textTransform are keyword unions
// in csstype, hence the casts; the value is the theme's either way.)
const page: CSSProperties = {
  minHeight: '100dvh',
  background: 'var(--lp-bg-page)',
  color: 'var(--lp-text-primary)',
  fontFamily: 'var(--lp-font-family)',
  letterSpacing: 'var(--lp-letter-spacing)',
  fontSize: 'var(--lp-size-12)',
  fontWeight: 'var(--lp-weight-medium)' as CSSProperties['fontWeight'],
  lineHeight: 'var(--lp-line-height-base)',
};
const micro: CSSProperties = {
  fontSize: 'var(--lp-size-10)',
  fontWeight: 'var(--lp-weight-strong)' as CSSProperties['fontWeight'],
  textTransform: 'var(--lp-transform-micro)' as CSSProperties['textTransform'],
  letterSpacing: 'var(--lp-tracking-section)',
  color: 'var(--lp-text-secondary)',
};
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  padding: '10px 16px',
  borderBottom: '1px solid var(--lp-border-hairline)',
};

// -------------------------------------------------------------------- route

interface Route {
  app: string | null;
  fabrialPath: string | null;
  params: Record<string, string>;
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = hash.split('?');
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(queryPart ?? '')) params[k] = v;
  const segments = (pathPart ?? '').split('/').filter(Boolean);
  if (segments.length < 2) return { app: null, fabrialPath: null, params };
  return { app: segments[0]!, fabrialPath: segments.slice(1).join('/'), params };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

// ----------------------------------------------------------------- fetching

class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(`${url} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

/** Network failure or a 5xx through the proxy: the app is down, not the fabrial. */
const isUnreachable = (e: unknown): boolean =>
  e instanceof HttpError ? e.status >= 500 : e instanceof TypeError;

const fetchDescriptor = async (app: string): Promise<AppDescriptor> =>
  zAppDescriptor.parse(await fetchJson(`/apps/${encodeURIComponent(app)}/loupe/app`));

// Read the complete inventory before validating any route, so file order
// cannot decide membership. Envelope identifiers and root filenames stay intact.
interface FabrialFile {
  path: string;
  raw: unknown;
  document?: Fabrial;
  relativePath?: string;
  error?: Error;
}

async function fetchFabrialInventory(): Promise<{
  files: FabrialFile[];
  inventory: Record<string, string[]>;
}> {
  const { fabrials } = await fetchJson<{ fabrials: string[] }>('/fabrials');
  const files = await Promise.all(fabrials.map(async (file): Promise<FabrialFile> => {
    const path = file.replace(/\.fabrial\.json$/, '');
    try {
      const raw = await fetchJson<unknown>(`/fabrials/${file}`);
      const parsed = zFabrial.safeParse(raw);
      if (!parsed.success) return { path, raw };
      const document = parsed.data;
      const prefix = `${document.app.name}/`;
      const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      return { path, raw, document, relativePath };
    } catch (error) {
      return { path, raw: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }));
  const inventory: Record<string, string[]> = Object.create(null);
  for (const file of files) {
    if (file.document && file.relativePath) {
      (inventory[file.document.app.name] ??= []).push(file.relativePath);
    }
  }
  return { files, inventory };
}

// -------------------------------------------------------------- error panel

function IssuesPanel(props: { title: string; issues: Issue[] }): ReactNode {
  return (
    <div style={{ maxWidth: 720, margin: '48px auto', border: '1px solid var(--lp-border-primary)', borderRadius: 'var(--lp-radius-lg)', overflow: 'hidden', boxShadow: 'var(--lp-shadow-panel)' }}>
      <div style={{ ...micro, padding: '10px 14px', background: 'var(--lp-bg-raised)', color: 'var(--lp-accent-bad-text)' }}>
        fabrial refused — {props.title}
      </div>
      <ol style={{ margin: 0, padding: '12px 14px 12px 34px', background: 'var(--lp-bg-panel)' }}>
        {props.issues.map((issue, i) => (
          <li key={i} style={{ padding: '4px 0', color: 'var(--lp-text-body)', fontWeight: 400, lineHeight: 1.6 }}>
            <span style={{ color: 'var(--lp-accent-bad-text)', fontWeight: 700 }}>{issue.code}</span>{' '}
            {issue.message}
            {issue.path ? <span style={{ color: 'var(--lp-text-dim)' }}> · {issue.path}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function UnreachablePanel(props: { app: string; message: string; onRetry: () => void }): ReactNode {
  return (
    <div style={{ maxWidth: 720, margin: '48px auto', border: '1px solid var(--lp-border-primary)', borderRadius: 'var(--lp-radius-lg)', overflow: 'hidden', boxShadow: 'var(--lp-shadow-panel)' }}>
      <div style={{ ...micro, padding: '10px 14px', background: 'var(--lp-bg-raised)', color: 'var(--lp-accent-wait-text)' }}>
        app unreachable — {props.app}
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--lp-bg-panel)', color: 'var(--lp-text-body)', fontWeight: 400, lineHeight: 1.6 }}>
        <div>{props.message}</div>
        <button
          onClick={props.onRetry}
          style={{
            ...micro,
            marginTop: 10,
            padding: '6px 14px',
            cursor: 'pointer',
            background: 'none',
            color: 'var(--lp-text-primary)',
            border: '1px solid var(--lp-border-idle)',
            borderRadius: 'var(--lp-radius-md)',
          }}
        >
          retry
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- launcher

interface LauncherRow {
  app: string;
  path: string;
  title: string;
  ok: boolean;
  detail: string;
}

function Launcher(): ReactNode {
  const [rows, setRows] = useState<LauncherRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { files, inventory } = await fetchFabrialInventory();
      const descriptors = new Map<string, AppDescriptor | Error>();
      const out: LauncherRow[] = [];
      for (const file of files) {
        const { path } = file;
        try {
          if (file.error) throw file.error;
          const raw = file.raw as Fabrial;
          const appName = raw.app.name;
          if (!descriptors.has(appName)) {
            descriptors.set(appName, await fetchDescriptor(appName).catch((e: Error) => e));
          }
          const descriptor = descriptors.get(appName)!;
          if (descriptor instanceof Error) {
            out.push({ app: appName, path, title: raw.title ?? path, ok: false, detail: `app unreachable: ${descriptor.message}` });
            continue;
          }
          const result = validateFabrial(raw, loupeStd, descriptor.verbs, undefined, inventory);
          out.push(
            result.ok
              ? { app: appName, path, title: raw.title ?? path, ok: true, detail: `${Object.keys(raw.elements).length} elements` }
              : { app: appName, path, title: raw.title ?? path, ok: false, detail: result.issues.map((i) => `${i.code}: ${i.message}`).join(' · ') },
          );
        } catch (e) {
          out.push({ app: '?', path, title: path, ok: false, detail: e instanceof Error ? e.message : String(e) });
        }
      }
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div
        style={{
          ...micro,
          fontSize: 'var(--lp-size-14)',
          color: 'var(--lp-text-heading)',
          letterSpacing: 'normal',
          padding: '28px 16px 12px',
          borderBottom: '1px solid var(--lp-border-hairline)',
        }}
      >
        loupe — apps × fabrials
      </div>
      {rows === null ? (
        <div style={{ ...rowStyle, color: 'var(--lp-text-dim)' }}>reading fabrials…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...rowStyle, color: 'var(--lp-text-dim)' }}>no .fabrial.json files under fabrials/</div>
      ) : (
        rows.map((row) => (
          <div key={row.path} style={rowStyle}>
            <span style={{ ...micro, width: 120, color: 'var(--lp-accent-person)', flex: 'none' }}>{row.app}</span>
            {row.ok ? (
              <a href={`#/${row.app}/${row.path}`} style={{ color: 'var(--lp-text-primary)', textDecoration: 'none', borderBottom: '1px solid var(--lp-border-idle)' }}>
                {row.path}
              </a>
            ) : (
              <span style={{ color: 'var(--lp-text-muted)', textDecoration: 'line-through' }}>{row.path}</span>
            )}
            <span style={{ color: row.ok ? 'var(--lp-text-dim)' : 'var(--lp-accent-bad-text)', fontWeight: 400, flex: 1 }}>
              {row.detail}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ------------------------------------------------------------------- screen

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'refused'; title: string; issues: Issue[] }
  | { kind: 'failed'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'ready'; fabrial: Fabrial; inventory: Record<string, string[]> };

function Screen(props: { app: string; fabrialPath: string; params: Record<string, string> }): ReactNode {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One client per app mount — a fresh wsClient per render would tear down and
  // recreate the WS subscription on every status-line update.
  const client = useMemo(() => wsClient(`/apps/${encodeURIComponent(props.app)}`), [props.app]);

  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const descriptor = await fetchDescriptor(props.app);
        const { files, inventory } = await fetchFabrialInventory();
        const targetPath = props.fabrialPath.split('/').map(decodeURIComponent).join('/');
        const file = files.find((entry) => entry.path === targetPath)
          ?? files.find((entry) => entry.document?.app.name === descriptor.app.name && entry.relativePath === targetPath);
        if (!file) throw new Error(`fabrial "${targetPath}" is absent from app "${descriptor.app.name}"`);
        if (file.error) throw file.error;
        const raw = file.raw;
        const result = validateFabrial(raw, loupeStd, descriptor.verbs, undefined, inventory);
        if (!alive) return;
        if (!result.ok) setState({ kind: 'refused', title: props.fabrialPath, issues: result.issues });
        else setState({ kind: 'ready', fabrial: result.fabrial, inventory });
      } catch (e) {
        if (!alive) return;
        const message = e instanceof Error ? e.message : String(e);
        setState(isUnreachable(e) ? { kind: 'unreachable', message } : { kind: 'failed', message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.app, props.fabrialPath, attempt]);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), status.tone === 'error' ? 6000 : 2500);
    return () => clearTimeout(timer);
  }, [status]);

  if (state.kind === 'loading') return <div style={{ ...rowStyle, color: 'var(--lp-text-dim)' }}>validating…</div>;
  if (state.kind === 'refused') return <IssuesPanel title={state.title} issues={state.issues} />;
  if (state.kind === 'unreachable') {
    return <UnreachablePanel app={props.app} message={state.message} onRetry={() => setAttempt((n) => n + 1)} />;
  }
  if (state.kind === 'failed') {
    return (
      <IssuesPanel title={props.fabrialPath} issues={[{ code: 'bad-envelope', message: state.message }]} />
    );
  }

  return (
    <div style={shellStyle}>
      <div style={{ ...rowStyle, ...shellHeaderStyle, flexWrap: 'wrap', minWidth: 0, overflowWrap: 'anywhere', padding: '6px 16px', background: 'var(--lp-bg-raised)' }}>
        <a href="#/" style={{ ...micro, textDecoration: 'none', color: 'var(--lp-text-muted)' }}>
          ← loupe
        </a>
        <span style={micro}>
          {props.app} / {props.fabrialPath}
        </span>
        <span style={{ flex: 1 }} />
        {status ? (
          <span style={{ ...micro, color: status.tone === 'error' ? 'var(--lp-accent-bad-text)' : 'var(--lp-accent-done)' }}>
            {status.text}
          </span>
        ) : null}
      </div>
      <div style={shellBodyStyle}>
      <LoupeRenderer
        fabrial={state.fabrial}
        catalog={loupeStd}
        components={components}
        client={client}
        projectionParams={props.params}
        instance={props.app}
        fabrialInventory={state.inventory}
        onVerbResult={(verb: string, result: VerbOk) =>
          setStatus({ text: `${verb} → ${result.records.map((r) => r.stream).join(', ') || 'ok'} · seq ${result.seq}`, tone: 'ok' })
        }
        onVerbError={(verb: string, error: VerbError) => setStatus({ text: `${verb} refused: ${error.error.message}`, tone: 'error' })}
      />
      </div>
    </div>
  );
}

function App(): ReactNode {
  const route = useHashRoute();
  return (
    <div style={page}>
      {route.app && route.fabrialPath ? (
        <Screen
          key={`${route.app}/${route.fabrialPath}?${new URLSearchParams(route.params).toString()}`}
          app={route.app}
          fabrialPath={route.fabrialPath}
          params={route.params}
        />
      ) : (
        <Launcher />
      )}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
