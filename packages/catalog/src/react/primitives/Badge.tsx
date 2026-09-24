import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { BadgeProps } from '../../defs/index.ts';
import { badgeTriad, fontBase, radius, transform, triadLocals, weight } from './style.ts';

/**
 * Tri-tone badge. The triad is resolved internally from the tone name
 * (principle 6); the fabrial names a tone and never a color.
 *
 * `outline` is the same everywhere: deep border, pale text, no ground. What
 * `filled` MEANS is the theme's call — classic paints the bright slab with
 * ink text, a quieter theme paints the soft tint with toned text — so the two
 * stay distinguishable (that is the severity ladder) without the loud one
 * being loud by construction. The triad ships to CSS as per-element locals
 * and the theme's two mix ratios interpolate between them.
 */
export const Badge: ComponentImpl<ReactNode, BadgeProps> = ({ props }) => {
  const { label, tone, filled } = props;
  const triad = badgeTriad(tone);
  return (
    <span
      data-lp="Badge"
      style={{
        ...fontBase,
        ...triadLocals(triad),
        display: 'inline-block',
        fontSize: 'var(--lp-size-10)',
        fontWeight: weight.strong,
        textTransform: transform.badge,
        letterSpacing: 'var(--lp-tracking-interactive)',
        padding: '1px 7px',
        borderRadius: radius.pill,
        whiteSpace: 'nowrap',
        ...(filled
          ? {
              background:
                'color-mix(in srgb, var(--lp-t-fill) var(--lp-badge-fill-alpha), var(--lp-t-soft))',
              color:
                'color-mix(in srgb, var(--lp-t-text) var(--lp-badge-fg-tone), var(--lp-text-inverse))',
              border: '1px solid transparent',
            }
          : { background: 'transparent', color: triad.text, border: `1px solid ${triad.border}` }),
      }}
    >
      {label}
    </span>
  );
};
