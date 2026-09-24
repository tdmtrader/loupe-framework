// catalog-core lane: token-exact primitive impls (design doc §4, classic
// design language). This index must keep exporting `primitives` — the frozen
// react barrel assembles the ImplRecord the renderer mounts from it.
import type { ReactNode } from 'react';
import type { ImplRecord } from '@loupe/spec';
import { Text } from './Text.tsx';
import { MicroLabel } from './MicroLabel.tsx';
import { Prose } from './Prose.tsx';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { Numeral } from './Numeral.tsx';
import { Pip } from './Pip.tsx';
import { Divider } from './Divider.tsx';
import { MetaRow } from './MetaRow.tsx';
import { Digest } from './Digest.tsx';
import { Link } from './Link.tsx';
import { Textarea } from './Textarea.tsx';

export { Text, MicroLabel, Prose, Badge, Button, Chip, Numeral, Pip, Divider, MetaRow, Digest, Link, Textarea };
export { accentVar, badgeTriad, bgVar, fontBase, microLabelStyle, padCss, sizeVar, tierVar } from './style.ts';
export type { Triad } from './style.ts';

export const primitives: ImplRecord<ReactNode> = {
  Text,
  MicroLabel,
  Prose,
  Badge,
  Button,
  Chip,
  Numeral,
  Pip,
  Divider,
  MetaRow,
  Digest,
  Link,
  Textarea,
};
