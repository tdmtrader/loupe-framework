import type { ReactNode } from 'react';
import type { ComponentImpl } from '@loupe/spec';
import type { SidePanelProps } from '../../defs/index.ts';

/** Left/right rail on bg.panel: scrollable body + a footer slot (triage queue, files panel). */
export const SidePanel: ComponentImpl<ReactNode, SidePanelProps> = ({ children, slots }) => (
  <div
    data-lp="SidePanel"
    style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      background: 'var(--lp-bg-panel)',
    }}
  >
    <div data-lp="SidePanel-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {children}
    </div>
    {slots?.footer}
  </div>
);
