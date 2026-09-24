import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { TextProps } from '../../defs/index.ts';
import { accentVar, fontBase, sizeVar, tierVar, weightFor } from './style.ts';

/** General text at a tier of the seven-tier gray ramp (12/700 default). */
export const Text: ComponentImpl<ReactNode, TextProps> = ({ props }) => {
  const { text, tier, size, weight, tone, upper, strike } = props;
  return (
    <span
      data-lp="Text"
      style={{
        ...fontBase,
        minWidth: 0,
        overflowWrap: 'anywhere',
        fontSize: sizeVar(size ?? 12),
        fontWeight: weightFor(weight),
        color: accentVar(tone) ?? tierVar(tier ?? 'primary'),
        textTransform: upper ? 'uppercase' : undefined,
        textDecoration: strike ? 'line-through' : undefined,
      }}
    >
      {text}
    </span>
  );
};
