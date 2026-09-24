import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { InsetHeaderProps } from '../../defs/index.ts';
import { fontBase, microLabelStyle, weight } from '../primitives/style.ts';

/** Full-bleed micro-label row on bg.inset (“in commit…”, “settled”). */
export const InsetHeader: ComponentImpl<ReactNode, InsetHeaderProps> = ({ props }) => {
  const { label, right } = props;
  return (
    <div
      data-lp="InsetHeader"
      style={{
        ...fontBase,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        background: 'var(--lp-bg-inset)',
        borderTop: '1px solid var(--lp-border-hairline)',
        borderBottom: '1px solid var(--lp-border-hairline)',
        padding: '5px 12px',
      }}
    >
      <span data-lp="InsetHeader-label" style={microLabelStyle('section')}>
        {label}
      </span>
      {right !== undefined && (
        <span
          data-lp="InsetHeader-right"
          style={{ fontSize: 'var(--lp-size-10)', fontWeight: weight.body, color: 'var(--lp-text-dim)' }}
        >
          {right}
        </span>
      )}
    </div>
  );
};
