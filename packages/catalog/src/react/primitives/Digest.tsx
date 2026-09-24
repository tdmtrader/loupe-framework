import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { DigestProps } from '../../defs/index.ts';
import { monoBase, weight } from './style.ts';

/**
 * Person-blue sha/digest text; pairWith renders the “a → b” pair form
 * (principle 11). Set in the CODE face — a digest is compared character by
 * character, so its columns must line up even when the UI face does not.
 */
export const Digest: ComponentImpl<ReactNode, DigestProps> = ({ props }) => {
  const { value, pairWith } = props;
  return (
    <span
      data-lp="Digest"
      style={{ ...monoBase, fontSize: 'var(--lp-size-11)', fontWeight: weight.body, color: 'var(--lp-accent-person)' }}
    >
      {value}
      {pairWith !== undefined && (
        <>
          {' '}
          <span data-lp="Digest-arrow" style={{ color: 'var(--lp-text-muted)' }}>
            →
          </span>{' '}
          {pairWith}
        </>
      )}
    </span>
  );
};
