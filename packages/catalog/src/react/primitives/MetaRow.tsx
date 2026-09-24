import { Fragment, type ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { MetaRowProps } from '../../defs/index.ts';
import { fontBase, weight } from './style.ts';

/** Metadata parts joined by “·” separators in muted (ticket/artifact headers). */
export const MetaRow: ComponentImpl<ReactNode, MetaRowProps> = ({ props }) => {
  const { parts } = props;
  return (
    <div
      data-lp="MetaRow"
      style={{
        ...fontBase,
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 6,
        fontSize: 'var(--lp-size-11)',
        fontWeight: weight.body,
        color: 'var(--lp-text-secondary)',
      }}
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span data-lp="MetaRow-sep" style={{ color: 'var(--lp-text-muted)' }}>
              ·
            </span>
          )}
          <span>{part}</span>
        </Fragment>
      ))}
    </div>
  );
};
