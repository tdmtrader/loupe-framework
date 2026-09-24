// §3.3 — the pure expression evaluator. resolve(expr, scope) → value.
// Resolution is pure: a re-render is a re-run over a new snapshot.
//
// Shape detection is strict: an object is an expression only if it matches one
// of the closed forms exactly ({$bind}, {$ui}, {$index:true}, {$template},
// {$cond,$then,$else}). A Condition object ({$bind|$ui, <op>}) in prop
// position (e.g. Hotkeys keys[].when) evaluates to a boolean — the catalog
// def declares the resolved type (z.boolean()). Everything else is data:
// arrays and records resolve their members, primitives are themselves.
import type { Json } from '@loupe/protocol';
import {
  CONDITION_OPS,
  type Condition,
  type ConditionOp,
  type PropValue,
  type ResolveScope,
} from '../model/index.ts';
import { zRouteExpr } from '../model/expression.ts';
import { getPointer, isAbsolutePointer } from './pointer.ts';
import { deepEqual, isPlainObject } from './util.ts';

// ------------------------------------------------------------ shape detection

const hasExactKeys = (obj: Record<string, unknown>, keys: string[]): boolean => {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => own.includes(k));
};

export type ExprKind = 'bind' | 'ui' | 'index' | 'template' | 'cond' | 'condition' | 'route';

/**
 * Classify a value as one of the dynamic forms, or null if it is plain data.
 * ("condition" = a bare Condition object in prop position → boolean.)
 */
export function exprKind(v: unknown): ExprKind | null {
  if (!isPlainObject(v)) return null;
  if (hasExactKeys(v, ['$route']) && zRouteExpr.safeParse(v).success) return 'route';
  if (hasExactKeys(v, ['$bind']) && typeof v['$bind'] === 'string') return 'bind';
  if (hasExactKeys(v, ['$ui']) && typeof v['$ui'] === 'string') return 'ui';
  if (hasExactKeys(v, ['$index']) && v['$index'] === true) return 'index';
  if (hasExactKeys(v, ['$template']) && typeof v['$template'] === 'string') return 'template';
  // $cond must carry a valid Condition — otherwise the object is plain data,
  // so a malformed conditional degrades instead of crashing evaluation.
  if (hasExactKeys(v, ['$cond', '$then', '$else']) && isConditionShape(v['$cond'])) return 'cond';
  if (isConditionShape(v)) return 'condition';
  return null;
}

/** A Condition: exactly one of $bind/$ui plus exactly one operator key. */
export function isConditionShape(v: unknown): v is Condition {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  const sources = keys.filter((k) => k === '$bind' || k === '$ui');
  const ops = keys.filter((k) => (CONDITION_OPS as readonly string[]).includes(k));
  return sources.length === 1 && ops.length === 1 && keys.length === 2;
}

/** True if any dynamic form ($bind/$ui/$index/$template/$cond/Condition) occurs anywhere inside. */
export function containsDynamic(v: PropValue): boolean {
  if (exprKind(v) !== null) return true;
  if (Array.isArray(v)) return v.some(containsDynamic);
  if (isPlainObject(v)) return Object.values(v).some((m) => containsDynamic(m as PropValue));
  return false;
}

// ---------------------------------------------------------------- evaluation

function readPointer(ptr: string, scope: ResolveScope): Json | undefined {
  if (isAbsolutePointer(ptr)) return getPointer(scope.state, ptr);
  if (ptr === '') return scope.item;
  return getPointer(scope.item, ptr);
}

function readUi(ptr: string, scope: ResolveScope): Json | undefined {
  return getPointer(scope.ui, ptr);
}

const TEMPLATE_RE = /\$\{([^}]*)\}/g;

function stringify(v: Json | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function resolveTemplate(template: string, scope: ResolveScope): string {
  return template.replace(TEMPLATE_RE, (_m, inner: string) => {
    if (inner.startsWith('ui:')) return stringify(readUi(inner.slice(3), scope));
    return stringify(readPointer(inner, scope));
  });
}

function compare(op: 'gt' | 'gte' | 'lt' | 'lte', a: Json | undefined, b: Json | undefined): boolean {
  const comparable =
    (typeof a === 'number' && typeof b === 'number') ||
    (typeof a === 'string' && typeof b === 'string');
  if (!comparable) return false;
  switch (op) {
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
  }
}

/** Evaluate a Condition against a scope (shared by visible/filter/$cond/prop-position conditions). */
export function evaluateConditionInternal(condition: Condition, scope: ResolveScope): boolean {
  // Total by construction: a malformed condition (no source) is simply false.
  if (condition.$bind === undefined && condition.$ui === undefined) return false;
  const source =
    condition.$bind !== undefined
      ? readPointer(condition.$bind, scope)
      : readUi(condition.$ui as string, scope);
  const op = (CONDITION_OPS as readonly string[]).find(
    (o) => (condition as Record<string, unknown>)[o] !== undefined,
  ) as ConditionOp | undefined;
  if (op === undefined) return false;
  switch (op) {
    case 'eq':
      return deepEqual(source, resolve(condition.eq as PropValue, scope));
    case 'neq':
      return !deepEqual(source, resolve(condition.neq as PropValue, scope));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compare(op, source, resolve(condition[op] as PropValue, scope));
    case 'in': {
      const members = (condition.in ?? []).map((m) => resolve(m as PropValue, scope));
      return members.some((m) => deepEqual(source, m));
    }
    case 'exists': {
      const present = source !== undefined && source !== null;
      return condition.exists === true ? present : !present;
    }
  }
}

/**
 * Pure expression evaluator: resolve(expr, {state, ui, item?, index?}) → value.
 * Missing pointers resolve to undefined (templates render "").
 */
export function resolve(expr: PropValue, scope: ResolveScope, context?: { instance: string }): Json | undefined {
  const kind = exprKind(expr);
  switch (kind) {
    case 'route': {
      if (!context?.instance) throw new Error('$route requires explicit mounting instance context');
      const { $route: route } = zRouteExpr.parse(expr);
      const params = Object.entries(route.params ?? {}).map(([key, value]) => {
        const resolved = resolve(value, scope, context);
        if (typeof resolved !== 'string') throw new Error(`$route param "${key}" must resolve to a string`);
        return `${encodeURIComponent(key)}=${encodeURIComponent(resolved)}`;
      });
      const path = route.fabrial.split('/').map(encodeURIComponent).join('/');
      return `#/${encodeURIComponent(context.instance)}/${path}${params.length ? `?${params.join('&')}` : ''}`;
    }
    case 'bind':
      return readPointer((expr as { $bind: string }).$bind, scope);
    case 'ui':
      return readUi((expr as { $ui: string }).$ui, scope);
    case 'index':
      return scope.index;
    case 'template':
      return resolveTemplate((expr as { $template: string }).$template, scope);
    case 'cond': {
      const c = expr as { $cond: Condition; $then: PropValue; $else: PropValue };
      return evaluateConditionInternal(c.$cond, scope)
        ? resolve(c.$then, scope, context)
        : resolve(c.$else, scope, context);
    }
    case 'condition':
      return evaluateConditionInternal(expr as Condition, scope);
    case null:
      break;
  }
  if (Array.isArray(expr)) {
    return expr.map((v) => resolve(v, scope, context) ?? null);
  }
  if (isPlainObject(expr)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(expr)) {
      const resolved = resolve(v as PropValue, scope, context);
      if (resolved !== undefined) out[k] = resolved;
    }
    return out;
  }
  return expr as Json;
}
