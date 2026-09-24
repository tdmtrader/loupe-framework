// §3.2 — Element: a node in the flat ID-keyed adjacency map.
import { z } from 'zod';
import { zActions, zUiDocPointer } from './action.ts';
import { zCondition, zPropValue } from './expression.ts';

export const zElementId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'element ids are kebab-case');
export type ElementId = z.infer<typeof zElementId>;

/** Absent = visible. Invisible elements do not mount. */
export const zVisible = z.union([
  z.boolean(),
  zCondition,
  z.strictObject({ $and: z.array(zCondition) }),
  z.strictObject({ $or: z.array(zCondition) }),
]);
export type Visible = z.infer<typeof zVisible>;

/**
 * Renders the element once per array item at `path`. `key` names the item
 * field used for React keys — required by validation (issue
 * missing-repeat-key; optional here so the validator can emit that code
 * rather than a bare envelope failure). `filter` is an item-scoped Condition.
 */
export const zRepeat = z.strictObject({
  path: z.string(),
  key: z.string().optional(),
  filter: zCondition.optional(),
});
export type Repeat = z.infer<typeof zRepeat>;

/**
 * Puts "the current item" into scope: the first item of the projection array
 * at `list` whose `key` field deep-equals the ui value at `at`. Null/missing
 * ui value, or no match ⇒ the element mounts with NO item in scope (relative
 * binds resolve undefined; relative conditions are false). Exactly a repeat
 * that expands to at most one item — minus the mounting.
 */
export const zContext = z.strictObject({
  list: z.string().regex(/^\//, 'context.list is an absolute projection pointer'),
  key: z.string().min(1),
  at: zUiDocPointer,
});
export type Context = z.infer<typeof zContext>;

export const zElement = z
  .strictObject({
    /** Must exist in the pinned catalog. */
    type: z.string(),
    props: z.record(z.string(), zPropValue).optional(),
    children: z.array(zElementId).optional(),
    /** Slot names must be declared by the catalog entry. */
    slots: z.record(z.string(), z.array(zElementId)).optional(),
    visible: zVisible.optional(),
    repeat: zRepeat.optional(),
    /** Puts the current cursor item into scope for props, actions, and descendants. */
    context: zContext.optional(),
    /** Event names must be declared by the catalog entry (events or eventsFrom). */
    on: z.record(z.string(), zActions).optional(),
  })
  .refine((el) => el.repeat === undefined || el.context === undefined, {
    message: 'an element takes at most one of repeat / context (both define the item scope)',
  });
export type ElementSpec = z.infer<typeof zElement>;
