// §3.3 Actions — the values in `on`; single or array, run in order.
import { z } from 'zod';
import { zCondition, zExpression } from './expression.ts';

/** ui-doc pointer keys are absolute ("/cursorId"). */
export const zUiDocPointer = z.string().regex(/^\//, 'ui pointers are absolute (start with "/")');

/** Merge-set into the ui doc; value null deletes. The ONLY client-side effect in the dialect. */
export const zUiSet = z.record(zUiDocPointer, zExpression);
export type UiSet = z.infer<typeof zUiSet>;

export const zUiAction = z.strictObject({ ui: zUiSet });
export type UiAction = z.infer<typeof zUiAction>;

export const zConfirm = z.strictObject({
  title: z.string(),
  message: zExpression,
});
export type Confirm = z.infer<typeof zConfirm>;

/** Pending is presentation only: label swap / disable while the dispatch is in flight. */
export const zPending = z.strictObject({
  label: z.string().optional(),
  disable: z.literal(true).optional(),
});
export type Pending = z.infer<typeof zPending>;

/** Dispatch through the client (§5.4). `done.ui` runs on success. */
export const zVerbAction = z.strictObject({
  verb: z.string(),
  params: z.record(z.string(), zExpression),
  confirm: zConfirm.optional(),
  pending: zPending.optional(),
  done: z.strictObject({ ui: zUiSet }).optional(),
});
export type VerbAction = z.infer<typeof zVerbAction>;

/** Renderer-computed relative cursor move over a projection list. Ui-doc write only. */
export const zAdvance = z.strictObject({
  /** Absolute projection pointer to an array of objects. */
  list: z.string().regex(/^\//, 'advance.list is an absolute projection pointer'),
  /** Item field whose value the cursor stores (same role as repeat.key). */
  key: z.string().min(1),
  /** Absolute ui-doc pointer holding the current key value (or null). */
  cursor: zUiDocPointer,
  dir: z.enum(['next', 'prev']),
  /** Item-scoped inclusion Condition — identical semantics to repeat.filter. */
  filter: zCondition.optional(),
});
export type Advance = z.infer<typeof zAdvance>;

export const zAdvanceAction = z.strictObject({ advance: zAdvance });
export type AdvanceAction = z.infer<typeof zAdvanceAction>;

export const zAction = z.union([zUiAction, zVerbAction, zAdvanceAction]);
export type Action = z.infer<typeof zAction>;

/** A handler: one action or an ordered list. */
export const zActions = z.union([zAction, z.array(zAction)]);
export type Actions = z.infer<typeof zActions>;
