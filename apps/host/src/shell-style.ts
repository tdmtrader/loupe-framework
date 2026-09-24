// Shell sizing for a mounted fabrial. Its own module, with no side effects, so
// a node-project test can import the values: main.tsx calls createRoot at
// module scope and would throw on `document` under vitest's node environment.
//
// A fabrial is a full screen, not a document. It needs a definite height to lay
// out against, or the `grow` box-channel prop has nothing to claim and the
// footer floats wherever the content happened to end. The shell owns the
// viewport; the fabrial owns everything inside it.
import type { CSSProperties } from 'react';

/** Fixed-height flex column. The shell itself never scrolls — its rails do. */
export const shellStyle: CSSProperties = {
  height: '100dvh',
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

/** The breadcrumb band: never grows, never shrinks. */
export const shellHeaderStyle: CSSProperties = { flex: 'none' };

/**
 * The fabrial's box: takes the rest and may shrink below its content, which is
 * what lets a rail inside it scroll instead of pushing the page taller.
 */
export const shellBodyStyle: CSSProperties = {
  flex: '1 1 0%',
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};
