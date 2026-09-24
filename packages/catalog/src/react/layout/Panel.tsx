import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { PanelProps } from '../../defs/index.ts';
import { fontBase, microLabelStyle, radius, shadow, weight } from '../primitives/style.ts';

/**
 * Titled panel on panel/inset bg. The title renders as a section micro-label
 * (principle 2); footnote is teaching prose in place (principle 12).
 */
export const Panel: ComponentImpl<ReactNode, PanelProps> = ({ props, children }) => {
  const { title, note, bg, footnote } = props;
  return (
    <div
      data-lp="Panel"
      style={{
        ...fontBase,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 14,
        background: bg === 'inset' ? 'var(--lp-bg-inset)' : 'var(--lp-bg-panel)',
        border: '1px solid var(--lp-border-primary)',
        borderRadius: radius.lg,
        boxShadow: shadow.panel,
      }}
    >
      {title !== undefined && (
        <div data-lp="Panel-title" style={microLabelStyle('section')}>
          {title}
        </div>
      )}
      {note !== undefined && (
        <div
          data-lp="Panel-note"
          style={{ fontSize: 'var(--lp-size-11)', fontWeight: weight.body, color: 'var(--lp-text-secondary)' }}
        >
          {note}
        </div>
      )}
      {children}
      {footnote !== undefined && (
        <div
          data-lp="Panel-footnote"
          style={{
            fontSize: 'var(--lp-size-11)',
            fontWeight: weight.body,
            lineHeight: 1.6,
            color: 'var(--lp-text-secondary)',
            maxWidth: 'var(--lp-prose-max-ch)',
          }}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};
