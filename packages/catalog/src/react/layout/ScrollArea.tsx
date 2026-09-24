import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { ScrollAreaProps } from '../../defs/index.ts';

/** Single-axis scroll container (route canvas, sheet body). */
export const ScrollArea: ComponentImpl<ReactNode, ScrollAreaProps> = ({ props, children }) => {
  const axis =
    props.axis === 'x'
      ? { overflowX: 'auto' as const, overflowY: 'hidden' as const, minWidth: 0 }
      : { overflowY: 'auto' as const, overflowX: 'hidden' as const, minHeight: 0, minWidth: 0 };
  return (
    <div
      data-lp="ScrollArea"
      style={props.grow === true ? { ...axis, flex: '1 1 0%', minHeight: 0, minWidth: 0 } : axis}
    >
      {children}
    </div>
  );
};
