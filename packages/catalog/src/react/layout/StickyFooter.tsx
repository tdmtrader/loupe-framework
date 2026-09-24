import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { StickyFooterProps } from '../../defs/index.ts';
import { accentVar, fontBase, weight } from '../primitives/style.ts';

/** Raised sticky footer: toned status note + an actions slot (principle 12). */
export const StickyFooter: ComponentImpl<ReactNode, StickyFooterProps> = ({ props, slots }) => {
  const { note, noteTone } = props;
  return (
    <div
      data-lp="StickyFooter"
      style={{
        ...fontBase,
        position: 'sticky',
        bottom: 0,
        flex: '0 0 auto',
        minWidth: 0,
        maxHeight: '45dvh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--lp-bg-raised)',
        borderTop: '1px solid var(--lp-border-primary)',
        padding: '10px 12px',
      }}
    >
      {note !== undefined && (
        <div
          data-lp="StickyFooter-note"
          style={{
            flexShrink: 0,
            overflowWrap: 'anywhere',
            fontSize: 'var(--lp-size-11)',
            fontWeight: weight.strong,
            color: accentVar(noteTone) ?? 'var(--lp-text-secondary)',
          }}
        >
          {note}
        </div>
      )}
      {slots?.actions !== undefined && (
        <div data-lp="StickyFooter-actions" style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, minWidth: 0, gap: 8 }}>
          {slots.actions}
        </div>
      )}
    </div>
  );
};
