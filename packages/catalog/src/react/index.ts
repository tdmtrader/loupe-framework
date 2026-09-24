// FROZEN react barrel (scaffold-owned): assembles the impls record the
// renderer mounts. The four sub-directories are feature-lane territory
// (catalog-core: primitives + layout; catalog-interactive; catalog-visual) —
// each must keep exporting its impls record from its index.ts.
import type { ReactNode } from 'react';
import type { ImplRecord } from '@loupe/spec';
import { primitives } from './primitives/index.ts';
import { layout } from './layout/index.ts';
import { interactive } from './composites/interactive/index.ts';
import { visual } from './composites/visual/index.ts';

export const components: ImplRecord<ReactNode> = {
  ...primitives,
  ...layout,
  ...interactive,
  ...visual,
};
