import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { DividerProps } from '../../defs/index.ts';

/** Vertical 1px hairline divider (top bars, review headers). */
export const Divider: ComponentImpl<ReactNode, DividerProps> = () => (
  <span
    data-lp="Divider"
    style={{ display: 'inline-block', width: 1, height: 18, background: 'var(--lp-border-primary)', flex: 'none' }}
  />
);
