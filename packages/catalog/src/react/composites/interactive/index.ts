// Interactive composites (catalog-interactive lane): Board (drag-drop),
// VerbBar, Hotkeys. Consumed by the frozen react barrel via this record.
import type { ReactNode } from 'react';
import type { ComponentImpl, ImplRecord } from '@loupe/spec';
import { Board } from './board.tsx';
import { VerbBar } from './verb-bar.tsx';
import { Hotkeys } from './hotkeys.tsx';

export const interactive: ImplRecord<ReactNode> = {
  Board: Board as ComponentImpl<ReactNode, never>,
  VerbBar: VerbBar as ComponentImpl<ReactNode, never>,
  Hotkeys: Hotkeys as ComponentImpl<ReactNode, never>,
};
