// Visual composites (catalog-visual lane): RouteGraph, DiffBlock, ProseDoc,
// OverlaySheet.
// Exports the `visual` impls record consumed by the frozen react barrel.
import type { ReactNode } from 'react';
import type { ImplRecord } from '@loupe/spec';
import { RouteGraph } from './route-graph.tsx';
import { DiffBlock } from './diff-block.tsx';
import { ProseDoc } from './prose-doc.tsx';
import { OverlaySheet } from './overlay-sheet.tsx';

export const visual: ImplRecord<ReactNode> = {
  RouteGraph,
  DiffBlock,
  ProseDoc,
  OverlaySheet,
};
