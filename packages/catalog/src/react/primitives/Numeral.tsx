import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { NumeralProps } from '../../defs/index.ts';
import { accentVar, fontBase, weight } from './style.ts';

/** 24/900 stat numeral + 11/400 phrase — “every number is a sentence” (principle 8). */
export const Numeral: ComponentImpl<ReactNode, NumeralProps> = ({ props }) => {
  const { value, label, color } = props;
  return (
    <div data-lp="Numeral" style={{ ...fontBase, display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span
        data-lp="Numeral-value"
        style={{
          fontSize: 'var(--lp-size-24)',
          fontWeight: weight.max,
          lineHeight: 1,
          color: accentVar(color) ?? 'var(--lp-text-body)',
        }}
      >
        {value}
      </span>
      {label !== undefined && (
        <span
          data-lp="Numeral-label"
          style={{ fontSize: 'var(--lp-size-11)', fontWeight: weight.body, color: 'var(--lp-text-secondary)' }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
