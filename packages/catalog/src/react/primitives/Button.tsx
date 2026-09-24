import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { ButtonProps } from '../../defs/index.ts';
import { buttonBaseStyle, buttonVariantStyle } from './style.ts';

const FILLED_VARIANTS = new Set(['primary', 'confirm', 'agent']);

/**
 * Verb button. Filled variants (primary/confirm/agent) always carry ink text;
 * ghost is idle-border gray; danger is ghost-red, never filled (principle 14).
 * keyHint prints dim inside the label (principle 9). Emits `press`.
 * Base + variant styling is shared with VerbBar via style.ts (§1.9 canon).
 */
export const Button: ComponentImpl<ReactNode, ButtonProps> = ({ props, emit }) => {
  const { label, variant, keyHint, disabled, flex } = props;
  const filled = FILLED_VARIANTS.has(variant);
  return (
    <button
      data-lp="Button"
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) emit('press');
      }}
      style={{
        ...buttonBaseStyle,
        ...buttonVariantStyle(variant),
        padding: flex ? '8px 0' : buttonBaseStyle.padding,
        flex: flex ? 1 : undefined,
        boxShadow: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : undefined,
      }}
    >
      {label}
      {keyHint !== undefined && (
        <span
          data-lp="Button-keyHint"
          style={filled ? { marginLeft: 6, opacity: 0.6 } : { marginLeft: 6, color: 'var(--lp-text-muted)' }}
        >
          {keyHint}
        </span>
      )}
    </button>
  );
};
