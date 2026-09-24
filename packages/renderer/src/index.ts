// @loupe/renderer — the ~800 LOC element-walk runtime (renderer-spec lane).
// The LoupeRenderer props interface is the mount seam the host uses.
export { LoupeRenderer } from './renderer.tsx';
export type { LoupeRendererProps } from './renderer.tsx';
export { ErrorPanel, ConfirmDialog, ConnectionBand } from './chrome.tsx';
export { setAtPointer, deleteAtPointer, applyUiSet } from './ui-doc.ts';
export { instantiatePatchTemplate, applyPatchOps } from './patch.ts';
