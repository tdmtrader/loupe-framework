import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { ProseProps } from '../../defs/index.ts';
import { fontBase, tierVar, weight } from './style.ts';

/** 12/400 prose at lh 1.6–1.7 with a ch-capped measure (principle 7). */
export const Prose: ComponentImpl<ReactNode, ProseProps> = ({ props }) => {
  const { text, maxCh, tier, strike } = props;
  return (
    <div
      data-lp="Prose"
      style={{
        ...fontBase,
        minWidth: 0,
        overflowWrap: 'anywhere',
        fontSize: 'var(--lp-size-12)',
        fontWeight: weight.body,
        lineHeight: 'var(--lp-prose-line-height)',
        maxWidth: `${maxCh ?? 68}ch`,
        color: tierVar(tier ?? 'body'),
        textDecoration: strike ? 'line-through' : undefined,
      }}
    >
      {text}
    </div>
  );
};
