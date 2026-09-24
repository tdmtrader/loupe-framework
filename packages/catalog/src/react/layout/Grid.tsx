import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { GridProps } from '../../defs/index.ts';
import { bgVar } from '../primitives/style.ts';

/**
 * CSS grid with a raw template string (comp templates flow through, e.g.
 * "248px 1fr 1fr 1.3fr 88px"). cellBorders renders 1px hairline separators by
 * letting border.primary show through a 1px gap.
 */
export const Grid: ComponentImpl<ReactNode, GridProps> = ({ props, children }) => {
  const { template, gap, cellBorders, bg, grow } = props;
  return (
    <div
      data-lp="Grid"
      style={{
        display: 'grid',
        gridTemplateColumns: template,
        gap: gap ?? (cellBorders ? 1 : undefined),
        background: cellBorders ? 'var(--lp-border-primary)' : bgVar(bg),
        // Stretch inside flex parents (Band/Row/Stack) so fr columns get real
        // width; inert outside flex contexts. `grow` additionally claims the
        // remaining main-axis space and allows shrink (1.2.0).
        flex: grow === true ? '1 1 0%' : '1 1 auto',
        minWidth: 0,
        minHeight: grow === true ? 0 : undefined,
      }}
    >
      {children}
    </div>
  );
};
