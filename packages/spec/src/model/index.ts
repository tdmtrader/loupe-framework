// @loupe/spec/model — the frozen dialect model (scaffold-owned; amendments
// are integration-owner-only). Zero React, zero DOM.
export { zJson, zJsonObject } from '@loupe/protocol';
export type { Json, JsonObject } from '@loupe/protocol';

export {
  zPointer,
  zBindExpr,
  zUiExpr,
  zRouteExpr,
  zIndexExpr,
  zTemplateExpr,
  zLiteral,
  zOperand,
  CONDITION_OPS,
  zCondition,
  zLeafExpr,
  zInnerCondExpr,
  zCondExpr,
  zExpression,
  zPropValue,
} from './expression.ts';
export type {
  BindExpr,
  UiExpr,
  IndexExpr,
  TemplateExpr,
  Operand,
  ConditionOp,
  Condition,
  LeafExpr,
  InnerCondExpr,
  CondExpr,
  Expression,
  PropValue,
} from './expression.ts';

export {
  zUiDocPointer,
  zUiSet,
  zUiAction,
  zConfirm,
  zPending,
  zVerbAction,
  zAdvance,
  zAdvanceAction,
  zAction,
  zActions,
} from './action.ts';
export type {
  UiSet,
  UiAction,
  Confirm,
  Pending,
  VerbAction,
  Advance,
  AdvanceAction,
  Action,
  Actions,
} from './action.ts';

export { zElementId, zVisible, zRepeat, zContext, zElement } from './element.ts';
export type { ElementId, Visible, Repeat, Context, ElementSpec } from './element.ts';

export { LOUPE_DIALECT_VERSION, zSemver, zCatalogPin, zAppBinding, zFabrial } from './envelope.ts';
export type { CatalogPin, AppBinding, Fabrial } from './envelope.ts';

export { UI_POINTER_MARK, uiPointer, isUiPointerSchema, HASH_HREF_MARK, hashHref, isHashHrefSchema } from './ui.ts';
export type { UiPointer, UiBinding, HashHref } from './ui.ts';

export { defineCatalog } from './catalog.ts';
export type { ItemSlotDef, ComponentDef, Catalog } from './catalog.ts';

export type { ComponentImplArgs, ComponentImpl, ImplRecord } from './impl.ts';

export { ISSUE_CODES } from './validate.ts';
export type { IssueCode, Issue, ValidateResult, ResolveScope } from './validate.ts';
