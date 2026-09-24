// §3.3 — the closed expression grammar. Nothing else evaluates. There is no
// $bindState, no $computed, no arithmetic, no client write to projection paths
// — the loupe invariant enforced by grammatical absence.
import { z } from 'zod';
import { zJson, type Json } from '@loupe/protocol';

/**
 * A pointer: absolute JSON Pointer ("/a/b") into the projection snapshot or ui
 * doc, or a relative pointer ("a/b", "" = the item itself) inside a repeat /
 * itemSlot scope. No "../" — the grammar stays closed.
 */
export const zPointer = z.string();

/** Read from the projection snapshot (absolute) or scope item (relative). Read-only, always. */
export const zBindExpr = z.strictObject({ $bind: zPointer });
export type BindExpr = z.infer<typeof zBindExpr>;

/** Read from the client-local ui doc (absolute pointer). */
export const zUiExpr = z.strictObject({ $ui: zPointer });
export type UiExpr = z.infer<typeof zUiExpr>;

/** A same-app fabrial, resolved only against the renderer's mounting instance. */
export const zRouteExpr = z.strictObject({
  $route: z.strictObject({
    fabrial: z.string().regex(/^(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/?#\\]+(?:\/[^/?#\\]+)*$/, 'route target must be a nonempty app-relative path without dot segments, query or fragment'),
    params: z.record(z.string(), z.union([z.string(), zBindExpr, zUiExpr])).optional(),
  }),
});

/** The repeat position. */
export const zIndexExpr = z.strictObject({ $index: z.literal(true) });
export type IndexExpr = z.infer<typeof zIndexExpr>;

/** String interpolation: "…${/a/b}…${ui:/x}…"; null/undefined → "". */
export const zTemplateExpr = z.strictObject({ $template: z.string() });
export type TemplateExpr = z.infer<typeof zTemplateExpr>;

/**
 * Literal JSON: itself. Literal objects may not use $-prefixed keys at the
 * top level — every $-form is either one of the declared expression shapes or
 * invalid; there is no way to smuggle a $bindState/$computed past the grammar
 * as "data".
 */
export const zLiteral = zJson.refine(
  (v) =>
    !(
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).some((k) => k.startsWith('$'))
    ),
  { message: 'literal objects may not use $-prefixed keys ($bind, $ui, $index, $template, $cond, …)' },
);

/** A condition/params operand: a literal, or a $bind/$ui/$index read. */
export const zOperand = z.union([zBindExpr, zUiExpr, zIndexExpr, zLiteral]);
export type Operand = z.infer<typeof zOperand>;

export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * Condition = { "$bind"|"$ui": ptr, <op>: operand } with exactly one source
 * and exactly one op (op ∈ eq neq gt gte lt lte in exists).
 */
export const zCondition = z
  .strictObject({
    $bind: zPointer.optional(),
    $ui: zPointer.optional(),
    eq: zOperand.optional(),
    neq: zOperand.optional(),
    gt: zOperand.optional(),
    gte: zOperand.optional(),
    lt: zOperand.optional(),
    lte: zOperand.optional(),
    in: z.array(zOperand).optional(),
    exists: z.boolean().optional(),
  })
  .refine((c) => (c.$bind === undefined) !== (c.$ui === undefined), {
    message: 'condition takes exactly one of $bind / $ui',
  })
  .refine((c) => CONDITION_OPS.filter((op) => c[op] !== undefined).length === 1, {
    message: 'condition takes exactly one operator (eq neq gt gte lt lte in exists)',
  });
export type Condition = z.infer<typeof zCondition>;

/** Non-conditional expressions. */
export const zLeafExpr = z.union([zBindExpr, zUiExpr, zIndexExpr, zTemplateExpr, zRouteExpr, zLiteral]);
export type LeafExpr = z.infer<typeof zLeafExpr>;

/** The inner conditional of the single permitted nesting level: leaf branches only. */
export const zInnerCondExpr = z.strictObject({
  $cond: zCondition,
  $then: zLeafExpr,
  $else: zLeafExpr,
});
export type InnerCondExpr = z.infer<typeof zInnerCondExpr>;

/** {"$cond": Condition, "$then": V, "$else": V} — branches may nest one more $cond, no deeper (schema-enforced). */
export const zCondExpr = z.strictObject({
  $cond: zCondition,
  $then: z.union([zLeafExpr, zInnerCondExpr]),
  $else: z.union([zLeafExpr, zInnerCondExpr]),
});
export type CondExpr = z.infer<typeof zCondExpr>;

/** The whole closed grammar. */
export const zExpression = z.union([zBindExpr, zUiExpr, zIndexExpr, zTemplateExpr, zRouteExpr, zCondExpr, zLiteral]);
export type Expression = z.infer<typeof zExpression>;

/** A scalar literal in prop position (composites recurse through zPropValue). */
const zPropScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A prop value: an expression, or a literal composite that may carry
 * expressions (and, where a component declares it — e.g. Hotkeys `when` —
 * Conditions) anywhere inside. The grammar is closed recursively: literal
 * objects may not use top-level $-prefixed keys at ANY depth, so every $-form
 * inside a composite is one of the declared expression/Condition shapes or the
 * whole prop fails to parse. Dynamic props are checked against the component's
 * Zod schema at validate time with the expression placeholders still in place;
 * resolved values are NOT re-validated at runtime (a post-resolve re-check is
 * explicitly deferred).
 */
export type PropValue = Json | { [key: string]: PropValue } | PropValue[];
export const zPropValue: z.ZodType<PropValue> = z.lazy(() =>
  z.union([
    zBindExpr,
    zUiExpr,
    zIndexExpr,
    zTemplateExpr,
    zRouteExpr,
    zCondExpr,
    zCondition,
    zPropScalar,
    z.array(zPropValue),
    z.record(z.string(), zPropValue).refine(
      (obj) => !Object.keys(obj).some((k) => k.startsWith('$')),
      {
        message:
          'literal objects may not use $-prefixed keys ($bind, $ui, $index, $template, $cond, …)',
      },
    ),
  ]),
) as z.ZodType<PropValue>;
