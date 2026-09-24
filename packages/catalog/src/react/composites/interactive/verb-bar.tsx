// VerbBar — the co-located verb row (design §3.3 Keyboard, §4).
//
// Renders props.actions [{label, keyHint?, variant, event}] as a button row;
// each button emits its literal `event` name and prints its keyHint muted
// inside the label (discoverability by co-location: the shortcut map and the
// printed hints share one fabrial source — `actions` is a literal array by the
// eventsFrom validation contract, so it is implemented here as plain data).
// Optional `label` renders as a micro-label prefix.
//
// Button variants follow the Button spec (design-language §1.9): filled
// (primary person-blue / confirm done-green / agent violet — always ink text)
// > ghost (idle border, body text) > danger ghost (red border, red text,
// never filled — principle 14). Radius 0, Inconsolata, uppercase 11/700/.09em.
import type { CSSProperties, ReactNode } from 'react';
import type { ComponentImplArgs } from '@loupe/spec';
import type { ButtonVariant } from '../../../defs/index.ts';
import { buttonBaseStyle, buttonVariantStyle, microLabelStyle } from '../../primitives/style.ts';

export interface VerbBarAction {
  label: string;
  keyHint?: string;
  variant: ButtonVariant;
  event: string;
}

interface VerbBarProps {
  label?: string;
  actions?: VerbBarAction[];
}

// Base + variant styling comes from style.ts so VerbBar buttons match Button
// (the §1.9 canon) exactly: transparent border on filled, 5px 12px, ghost =
// secondary text.
const buttonStyle = (variant: ButtonVariant): CSSProperties => ({
  ...buttonBaseStyle,
  ...buttonVariantStyle(variant),
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '6px',
});

export function VerbBar({ props, emit }: ComponentImplArgs<ReactNode>): ReactNode {
  const { label, actions } = props as VerbBarProps;
  return (
    <div
      data-lp-verb-bar=""
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--lp-space-tight)' }}
    >
      {label ? (
        <span style={{ ...microLabelStyle(), marginRight: '4px' }}>
          {label}
        </span>
      ) : null}
      {(actions ?? []).map((action) => (
        <button
          key={action.event}
          type="button"
          data-lp-verb={action.event}
          onClick={(e) => {
            e.stopPropagation(); // don't double-fire an enclosing pressable row
            emit(action.event);
          }}
          style={buttonStyle(action.variant)}
        >
          {action.label}
          {action.keyHint ? (
            <span data-lp-key-hint="" style={{ opacity: 0.6 }}>
              {action.keyHint}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
