// OverlaySheet — scrim + portal-mounted fixed right sheet (design §4,
// design-language §2.8): 560px, panel bg, 1px left border. Edges stay square
// (it spans the full viewport height — a radius there just clips the corners
// against nothing), but depth is the theme's: classic answers `none` and gets
// the original flat sheet. `open` controls mount; scrim click and Escape emit
// dismiss; the body scrolls; children render inside.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ComponentImplArgs } from '@loupe/spec';
import { lp } from './shared.ts';

export interface OverlaySheetProps {
  open: boolean;
  width?: number;
  side?: 'right';
}

export function OverlaySheet({
  props,
  children,
  emit,
}: ComponentImplArgs<ReactNode, OverlaySheetProps>): ReactNode {
  const open = props.open === true;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') emit('dismiss');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, emit]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        data-lp="overlay-scrim"
        onClick={() => emit('dismiss')}
        style={{ position: 'fixed', inset: 0, background: lp('scrim'), zIndex: 40 }}
      />
      <div
        data-lp="overlay-sheet"
        role="dialog"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: props.width ?? 560,
          zIndex: 41,
          background: lp('bgPanel'),
          borderLeft: `1px solid ${lp('borderPrimary')}`,
          boxShadow: lp('shadowOverlay'),
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
