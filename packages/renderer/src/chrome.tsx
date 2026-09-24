// Renderer-drawn chrome: the validation error panel, the confirm dialog, and
// the connection band. Token-styled (--lp-* custom properties from
// @loupe/tokens); no raw hex — comp values ride along as var() fallbacks.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * What the panel renders: every validation Issue is one, plus renderer-only
 * runtime codes (e.g. "render-error" from the error boundary) that are not
 * part of the frozen validation IssueCode set.
 */
export interface PanelIssue {
  code: string;
  message: string;
  path?: string;
  elementId?: string;
}

const panelStyle: CSSProperties = {
  background: 'var(--lp-bg-panel)',
  color: 'var(--lp-text-primary)',
  border: '1px solid var(--lp-tone-bad-border)',
  borderLeft: 'var(--lp-accent-width-structural, 3px) solid var(--lp-accent-bad)',
  borderRadius: 'var(--lp-radius, 0)',
  fontFamily: 'var(--lp-font-family)',
  fontWeight: 'var(--lp-font-weight-default, 700)' as CSSProperties['fontWeight'],
  letterSpacing: 'var(--lp-letter-spacing)',
  fontSize: 'var(--lp-size-12, 12px)',
  padding: '12px 16px',
  maxWidth: '68ch',
};

const microLabel: CSSProperties = {
  fontSize: 'var(--lp-size-10, 10px)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--lp-tracking-section, .12em)',
  color: 'var(--lp-tone-bad-text)',
  marginBottom: 8,
};

export function ErrorPanel(props: {
  fabrialName: string;
  pinned?: string;
  loaded?: string;
  issues: readonly PanelIssue[];
}): ReactNode {
  return (
    <div data-testid="lp-error-panel" role="alert" style={panelStyle}>
      <div style={microLabel}>fabrial refused to mount</div>
      <div style={{ marginBottom: 4 }}>{props.fabrialName}</div>
      {props.pinned !== undefined && (
        <div style={{ color: 'var(--lp-text-secondary)', marginBottom: 8 }}>
          pins {props.pinned}
          {props.loaded !== undefined ? ` · loaded ${props.loaded}` : ''}
        </div>
      )}
      <ol style={{ margin: 0, paddingLeft: '2ch', color: 'var(--lp-text-body)' }}>
        {props.issues.map((issue, i) => (
          <li key={i} style={{ margin: '2px 0' }}>
            <span style={{ color: 'var(--lp-tone-bad-text)' }}>{issue.code}</span>
            {issue.path !== undefined || issue.elementId !== undefined ? (
              <span style={{ color: 'var(--lp-text-dim)' }}>
                {' '}at {issue.path ?? issue.elementId}
              </span>
            ) : null}
            {': '}
            {issue.message}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: string;
  onResolve: (confirmed: boolean) => void;
}): ReactNode {
  return (
    <div
      data-testid="lp-confirm-scrim"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--lp-scrim, rgba(0,0,0,.55))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        data-testid="lp-confirm-dialog"
        role="dialog"
        aria-label={props.title}
        style={{
          background: 'var(--lp-bg-raised)',
          color: 'var(--lp-text-primary)',
          border: '1px solid var(--lp-border-primary)',
          borderRadius: 'var(--lp-radius, 0)',
          fontFamily: 'var(--lp-font-family)',
          fontWeight: 'var(--lp-font-weight-default, 700)' as CSSProperties['fontWeight'],
          letterSpacing: 'var(--lp-letter-spacing)',
          fontSize: 'var(--lp-size-12, 12px)',
          padding: '14px 16px',
          minWidth: 280,
          maxWidth: '62ch',
        }}
      >
        <div style={microLabel}>{props.title}</div>
        <div style={{ color: 'var(--lp-text-body)', marginBottom: 12 }}>{props.message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="lp-confirm-cancel"
            onClick={() => props.onResolve(false)}
            style={{
              background: 'transparent',
              color: 'var(--lp-text-secondary)',
              border: '1px solid var(--lp-border-idle)',
              borderRadius: 'var(--lp-radius, 0)',
              font: 'inherit',
              letterSpacing: 'inherit',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            cancel
          </button>
          <button
            type="button"
            data-testid="lp-confirm-ok"
            onClick={() => props.onResolve(true)}
            style={{
              background: 'var(--lp-tone-agent-fill)',
              color: 'var(--lp-text-inverse)',
              border: '1px solid var(--lp-tone-agent-border)',
              borderRadius: 'var(--lp-radius, 0)',
              font: 'inherit',
              letterSpacing: 'inherit',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {props.title}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The connection band: a fixed strip under the top edge while the app is
 * unreachable (amber tint = waiting-on-the-world). Overlay, not in-flow — no
 * layout shift on appear/clear; z 900 sits under the confirm scrim's 1000.
 */
export function ConnectionBand(props: { state: 'reconnecting' | 'gone' }): ReactNode {
  const pipRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const animation = pipRef.current?.animate(
      [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
      { duration: 1600, iterations: Infinity },
    );
    return () => animation?.cancel();
  }, []);
  return (
    <div
      data-testid="lp-conn-band"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 16px',
        background: 'var(--lp-bg-tint-amber, #30220A)',
        borderBottom: '1px solid var(--lp-tone-wait-border, #6E4500)',
        color: 'var(--lp-accent-wait-text, #F2BF6B)',
        fontSize: 'var(--lp-size-10, 10px)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 'var(--lp-tracking-section, .12em)',
        fontFamily: 'var(--lp-font-family)',
      }}
    >
      <span
        ref={pipRef}
        aria-hidden="true"
        style={{ width: 6, height: 6, background: 'var(--lp-accent-wait, #DE951D)' }}
      />
      {props.state === 'reconnecting'
        ? 'app unreachable — retrying…'
        : 'app unreachable — still retrying · the app may be down'}
    </div>
  );
}
