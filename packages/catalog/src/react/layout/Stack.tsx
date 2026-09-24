import { useEffect, useRef, type ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { StackProps } from '../../defs/index.ts';
import { boxStyle } from './box.ts';

/**
 * Flex container (default column) carrying the shared box channel. Pressable
 * like Row, but only intercepts clicks when the fabrial actually bound
 * `press` (hasAction) so clicks inside plain Stacks bubble to an enclosing
 * pressable element. `scrollIntoView` follows the cursor: rising-edge only
 * (false→true), block 'nearest' so redundant calls are no-ops.
 */
export const Stack: ComponentImpl<ReactNode, StackProps> = ({ props, children, emit, hasAction }) => {
  const { direction, scrollIntoView, ...box } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const prevRef = useRef(false);
  useEffect(() => {
    if (scrollIntoView === true && prevRef.current !== true) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
    prevRef.current = scrollIntoView === true;
  });
  const pressable = hasAction === undefined ? false : hasAction('press');
  return (
    <div
      ref={ref}
      data-lp="Stack"
      onClick={
        pressable
          ? (e) => {
              e.stopPropagation();
              emit('press');
            }
          : undefined
      }
      style={{ display: 'flex', flexDirection: direction ?? 'column', minWidth: 0, ...boxStyle(box) }}
    >
      {children}
    </div>
  );
};
