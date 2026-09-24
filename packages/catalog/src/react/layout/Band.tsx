import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { BandProps } from '../../defs/index.ts';
import { padCss } from '../primitives/style.ts';

/** Raised full-width strip (bg.raised) with a bottom hairline. */
export const Band: ComponentImpl<ReactNode, BandProps> = ({ props, children }) => (
  <div
    data-lp="Band"
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      flexShrink: 0,
      minWidth: 0,
      alignItems: 'center',
      gap: 12,
      background: 'var(--lp-bg-raised)',
      borderBottom: '1px solid var(--lp-border-primary)',
      padding: padCss(props.pad) ?? '10px 16px',
    }}
  >
    {children}
  </div>
);
