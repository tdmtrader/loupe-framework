import { useEffect, useRef, type ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { RowProps } from '../../defs/index.ts';
import { boxStyle } from './box.ts';

/**
 * Horizontal flex row; pressable (cursor rows, cards). Carries the left
 * accent-bar state channel (accent/accentWidth/accentEdge). Emits `press` —
 * but only intercepts clicks when the fabrial bound one (hasAction), so
 * clicks on decorative inner rows bubble to the enclosing pressable element.
 * (hasAction is absent outside the renderer — tests/styleguide — where the
 * old always-pressable behavior is kept.) `scrollIntoView` follows the
 * cursor: rising-edge only (false→true), block 'nearest' so redundant calls
 * are no-ops.
 */
export const Row: ComponentImpl<ReactNode, RowProps> = ({ props, children, emit, hasAction }) => {
  const { scrollIntoView, ...box } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef(false);
  useEffect(() => {
    if (scrollIntoView === true && prevRef.current !== true) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
    prevRef.current = scrollIntoView === true;
  });
  const pressable = hasAction === undefined ? true : hasAction('press');
  return (
    <div
      ref={ref}
      data-lp="Row"
      onClick={
        pressable
          ? (e) => {
              e.stopPropagation();
              emit('press');
            }
          : undefined
      }
      style={{ display: 'flex', flexDirection: 'row', minWidth: 0, ...boxStyle(box, 'center') }}
    >
      {children}
    </div>
  );
};
