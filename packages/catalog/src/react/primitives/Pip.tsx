import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { PipProps } from '../../defs/index.ts';
import { accentVar, radius } from './style.ts';

/** 10×10 or 12×12 square progress/agent pip; hollow = empty slot with a toned border. */
export const Pip: ComponentImpl<ReactNode, PipProps> = ({ props }) => {
  const { state, size, hollow } = props;
  const s = size ?? 12;
  const c = accentVar(state) ?? 'var(--lp-border-idle)';
  return (
    <span
      data-lp="Pip"
      style={{
        display: 'inline-block',
        width: s,
        height: s,
        borderRadius: radius.pill,
        ...(hollow ? { background: 'transparent', border: `1px solid ${c}` } : { background: c }),
      }}
    />
  );
};
