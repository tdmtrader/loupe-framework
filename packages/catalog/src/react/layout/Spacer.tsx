import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { SpacerProps } from '../../defs/index.ts';

/** Flex spacer (top bars). */
export const Spacer: ComponentImpl<ReactNode, SpacerProps> = () => (
  <div data-lp="Spacer" style={{ flex: 1 }} />
);
