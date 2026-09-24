// RFC 6901 JSON Pointer resolution, plus the dialect's relative-pointer rule:
// a pointer without a leading "/" resolves against the repeat/itemSlot scope
// item ("" = the item itself). Missing pointers resolve to undefined.
import type { Json } from '@loupe/protocol';

const unescape = (token: string): string => token.replaceAll('~1', '/').replaceAll('~0', '~');

/** Split an absolute ("/a/b") or relative ("a/b") pointer into tokens. "" → []. */
export function pointerTokens(ptr: string): string[] {
  if (ptr === '') return [];
  const body = ptr.startsWith('/') ? ptr.slice(1) : ptr;
  return body.split('/').map(unescape);
}

/** Walk a document by pointer tokens; undefined on any miss. */
export function getAtTokens(doc: Json | undefined, tokens: string[]): Json | undefined {
  let cur: Json | undefined = doc;
  for (const token of tokens) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      cur = cur[Number(token)];
    } else {
      cur = Object.hasOwn(cur, token) ? cur[token] : undefined;
    }
  }
  return cur;
}

/** Resolve a pointer against a document (absolute and relative read the same doc). */
export function getPointer(doc: Json | undefined, ptr: string): Json | undefined {
  return getAtTokens(doc, pointerTokens(ptr));
}

/** True for absolute (projection-rooted / ui-doc) pointers. */
export function isAbsolutePointer(ptr: string): boolean {
  return ptr.startsWith('/');
}
