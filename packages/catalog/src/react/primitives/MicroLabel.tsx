import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { MicroLabelProps } from '../../defs/index.ts';
import { accentVar, microLabelStyle } from './style.ts';

/** 10px/700 uppercase micro-label — the wayfinding system (principle 2). */
export const MicroLabel: ComponentImpl<ReactNode, MicroLabelProps> = ({ props }) => {
  const { text, tracking, tone } = props;
  return (
    <span data-lp="MicroLabel" style={microLabelStyle(tracking ?? 'section', accentVar(tone))}>
      {text}
    </span>
  );
};
