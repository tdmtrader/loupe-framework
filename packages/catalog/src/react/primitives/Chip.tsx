import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { ChipProps } from '../../defs/index.ts';
import { fontBase, radius, transform, weight } from './style.ts';

const CHIP_TONES: Record<string, string> = {
  neutral: 'var(--lp-text-secondary)',
  blocking: 'var(--lp-accent-bad)',
  notable: 'var(--lp-accent-wait)',
  minor: 'var(--lp-border-idle)',
};

/**
 * Inverted-when-active toggle chip: inactive = ghost (secondary text, idle
 * border); active = ink text on the tone color (principle 5 — inversion, not
 * decoration). Emits `press`.
 */
export const Chip: ComponentImpl<ReactNode, ChipProps> = ({ props, emit }) => {
  const { label, active, tone } = props;
  const c = CHIP_TONES[tone ?? 'neutral'];
  return (
    <button
      data-lp="Chip"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        emit('press');
      }}
      style={{
        ...fontBase,
        fontSize: 'var(--lp-size-10)',
        fontWeight: weight.strong,
        textTransform: transform.badge,
        letterSpacing: 'var(--lp-tracking-interactive)',
        padding: '2px 10px',
        borderRadius: radius.pill,
        boxShadow: 'none',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        ...(active
          ? { background: c, color: 'var(--lp-text-inverse)', border: `1px solid ${c}` }
          : { background: 'transparent', color: 'var(--lp-text-secondary)', border: '1px solid var(--lp-border-idle)' }),
      }}
    >
      {label}
    </button>
  );
};
