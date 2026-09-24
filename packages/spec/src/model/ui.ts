// The branded ui-doc pointer prop type + the binding the renderer hands impls.
import { z } from 'zod';
import type { Json } from '@loupe/protocol';

export const UI_POINTER_MARK = 'loupe:uiPointer';

/**
 * A branded ui-doc pointer for form-component props (e.g. Textarea.bindUi).
 * In a fabrial the prop value is a literal absolute pointer into the ui doc;
 * the renderer resolves it to a UiBinding {value, set} before calling the
 * impl (committing content is always a verb — the draft is lossable ephemera).
 */
export function uiPointer() {
  return z
    .string()
    .regex(/^\//, 'ui pointer must be absolute (start with "/")')
    .describe(UI_POINTER_MARK)
    .meta({ loupe: 'uiPointer' })
    .brand<'UiPointer'>();
}
export type UiPointer = z.infer<ReturnType<typeof uiPointer>>;

/** True if a def prop schema is a uiPointer() (the renderer swaps in a UiBinding). */
export function isUiPointerSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const s = schema as { meta?: () => Record<string, unknown> | undefined; description?: string };
  const meta = typeof s.meta === 'function' ? s.meta() : undefined;
  return meta?.['loupe'] === 'uiPointer' || s.description === UI_POINTER_MARK;
}

/** What an impl receives where its def declared a uiPointer() prop. */
export interface UiBinding {
  value: Json | undefined;
  set: (value: Json) => void;
}

export const HASH_HREF_MARK = 'loupe:hashHref';

/**
 * A branded in-app hash href for navigation-ish props (e.g. Link.href).
 *
 * Two halves, and the validator needs both because it only ever type-checks
 * LITERALS. A literal must begin `#/` — the host's own route form
 * (`apps/host/src/main.tsx` writes exactly that) — which the regex below
 * refuses `https://…` and `javascript:…` for, with no extra code. The DYNAMIC
 * half is the rule `checkProps` adds beside the `isUiPointerSchema` branch: a
 * dynamic `href` may be `{"$bind": …}` or `{"$ui": …}` and nothing else.
 *
 * WHY `$template` IS REFUSED, since it is the one that will look harmless to
 * whoever reads this next. `$template` is the only grammar form that
 * ASSEMBLES a string out of parts (`engine/resolve.ts`), so it is the only
 * one that can produce `javascript:` out of pieces that each look innocent.
 * A served string is served whole and is loupe's own words; an assembled one
 * is partly the document's. Widening this list is how the guard stops being a
 * guard — the component's runtime re-check exists because even a `$bind` may
 * carry foreign content, and the two together are the whole defence.
 */
export function hashHref() {
  return z
    .string()
    .regex(/^#\//, 'href must be an in-app route beginning "#/"')
    .describe(HASH_HREF_MARK)
    .meta({ loupe: 'hashHref' })
    .brand<'HashHref'>();
}
export type HashHref = z.infer<ReturnType<typeof hashHref>>;

/** True if a def prop schema is a hashHref() (the validator narrows its dynamic forms). */
export function isHashHrefSchema(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const s = schema as { meta?: () => Record<string, unknown> | undefined; description?: string };
  const meta = typeof s.meta === 'function' ? s.meta() : undefined;
  return meta?.['loupe'] === 'hashHref' || s.description === HASH_HREF_MARK;
}
