// catalog-core lane: token-exact layout impls (design doc §4). This index must
// keep exporting `layout` — the frozen react barrel assembles the ImplRecord
// the renderer mounts from it.
import type { ReactNode } from 'react';
import type { ImplRecord } from '@loupe/spec';
import { Stack } from './Stack.tsx';
import { Row } from './Row.tsx';
import { Grid } from './Grid.tsx';
import { Panel } from './Panel.tsx';
import { Band } from './Band.tsx';
import { InsetHeader } from './InsetHeader.tsx';
import { SidePanel } from './SidePanel.tsx';
import { StickyFooter } from './StickyFooter.tsx';
import { Spacer } from './Spacer.tsx';
import { ScrollArea } from './ScrollArea.tsx';

export { Stack, Row, Grid, Panel, Band, InsetHeader, SidePanel, StickyFooter, Spacer, ScrollArea };
export { boxStyle } from './box.ts';
export type { BoxProps } from './box.ts';

export const layout: ImplRecord<ReactNode> = {
  Stack,
  Row,
  Grid,
  Panel,
  Band,
  InsetHeader,
  SidePanel,
  StickyFooter,
  Spacer,
  ScrollArea,
};
