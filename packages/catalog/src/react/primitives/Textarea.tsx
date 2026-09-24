import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { TextareaImplProps } from '../../defs/index.ts';
import { fontBase, radius, weight } from './style.ts';

/**
 * Draft input bound to a ui-doc path. The renderer resolves the def's bindUi
 * pointer to a UiBinding {value, set} before calling this impl. Ink (page)
 * background per the comp; committing content is always a verb — the draft is
 * lossable ephemera by design.
 */
export const Textarea: ComponentImpl<ReactNode, TextareaImplProps> = ({ props }) => {
  const { bindUi, placeholder, borderTone, minHeight } = props;
  return (
    <textarea
      data-lp="Textarea"
      value={typeof bindUi.value === 'string' ? bindUi.value : ''}
      placeholder={placeholder}
      onChange={(e) => bindUi.set(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()} // focusing must not press an enclosing row
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        ...fontBase,
        display: 'block',
        boxSizing: 'border-box',
        width: '100%',
        minHeight: minHeight ?? 62,
        padding: '7px 9px',
        fontSize: 'var(--lp-size-12)',
        fontWeight: weight.body,
        lineHeight: 1.5,
        background: 'var(--lp-bg-page)',
        color: 'var(--lp-text-primary)',
        border: `1px solid ${borderTone === 'agent' ? 'var(--lp-border-violet)' : 'var(--lp-border-primary)'}`,
        borderRadius: radius.md,
        boxShadow: 'none',
        outline: 'none',
        resize: 'vertical',
      }}
    />
  );
};
