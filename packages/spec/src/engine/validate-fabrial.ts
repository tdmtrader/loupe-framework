// §3 — full fabrial validation with the frozen Issue codes. Run at save time
// and again at load time; failure is total and legible, never a half-screen.
import { z } from 'zod';
import type { Json, JsonObject, JsonSchema, VerbDecl } from '@loupe/protocol';
import {
  LOUPE_DIALECT_VERSION,
  isHashHrefSchema,
  isUiPointerSchema,
  zFabrial,
  type Action,
  type Actions,
  type Catalog,
  type ComponentDef,
  type Condition,
  type ElementSpec,
  type Fabrial,
  type Issue,
  type PropValue,
  type ValidateResult,
  type Visible,
} from '../model/index.ts';
import { zRouteExpr } from '../model/expression.ts';
import { containsDynamic, exprKind } from './resolve.ts';
import { isPlainObject, unwrapField } from './util.ts';

// ------------------------------------------------------------------- utilities

const semverParts = (v: string): [number, number, number] => {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map(Number);
  return [maj, min, pat];
};

const TEMPLATE_UI_RE = /\$\{ui:([^}]*)\}/g;

/** First segment of an absolute ui pointer ("/cursorId/x" → "cursorId"). */
const uiRoot = (ptr: string): string | null => {
  if (!ptr.startsWith('/')) return null;
  const seg = ptr.slice(1).split('/')[0] ?? '';
  return seg.replaceAll('~1', '/').replaceAll('~0', '~');
};

// -------------------------------------------------------------------- context

interface Ctx {
  issues: Issue[];
  declaredUi: Set<string>;
  verbByName: Map<string, VerbDecl>;
}

function addIssue(ctx: Ctx, issue: Issue): void {
  ctx.issues.push(issue);
}

/** Check a used ui pointer against the envelope's declared ui keys. */
function checkUiPath(ctx: Ctx, ptr: string, elementId: string | undefined, path: string): void {
  const root = uiRoot(ptr);
  if (root === null || (root !== '' && !ctx.declaredUi.has(root))) {
    addIssue(ctx, {
      code: 'undeclared-ui-path',
      message: `ui path "${ptr}" is not declared in the envelope's ui object`,
      elementId,
      path,
    });
  }
}

/** Walk a PropValue tree collecting every ui-doc read ($ui exprs, condition sources, ${ui:…} templates). */
// Accepts Condition too: a Condition is walkable data here but is not part
// of the PropValue union (its zod-inferred optionals carry `undefined`).
function collectUiReads(ctx: Ctx, value: PropValue | Condition, elementId: string | undefined, path: string): void {
  const kind = exprKind(value);
  if (kind === 'ui') {
    checkUiPath(ctx, (value as { $ui: string }).$ui, elementId, path);
    return;
  }
  if (kind === 'template') {
    for (const m of (value as { $template: string }).$template.matchAll(TEMPLATE_UI_RE)) {
      checkUiPath(ctx, m[1] ?? '', elementId, path);
    }
    return;
  }
  if (kind === 'condition') {
    const cond = value as Condition;
    if (cond.$ui !== undefined) checkUiPath(ctx, cond.$ui, elementId, path);
    for (const opKey of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const) {
      const operand = cond[opKey];
      if (operand !== undefined) collectUiReads(ctx, operand as PropValue, elementId, `${path}.${opKey}`);
    }
    if (cond.in !== undefined) collectUiReads(ctx, cond.in as PropValue[], elementId, `${path}.in`);
    return;
  }
  if (kind === 'cond') {
    const c = value as { $cond: Condition; $then: PropValue; $else: PropValue };
    collectUiReads(ctx, c.$cond, elementId, `${path}.$cond`);
    collectUiReads(ctx, c.$then, elementId, `${path}.$then`);
    collectUiReads(ctx, c.$else, elementId, `${path}.$else`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectUiReads(ctx, v, elementId, `${path}[${i}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      collectUiReads(ctx, v as PropValue, elementId, `${path}.${k}`);
    }
  }
}

function collectVisibleUiReads(ctx: Ctx, visible: Visible, elementId: string, path: string): void {
  if (typeof visible === 'boolean') return;
  const conds: Condition[] =
    '$and' in visible && Array.isArray(visible.$and)
      ? visible.$and
      : '$or' in visible && Array.isArray(visible.$or)
        ? visible.$or
        : [visible as Condition];
  conds.forEach((c, i) => collectUiReads(ctx, c, elementId, `${path}[${i}]`));
}

// -------------------------------------------------- literal vs wire JSON Schema

const JSON_TYPE_OF = (v: Json): string =>
  v === null
    ? 'null'
    : Array.isArray(v)
      ? 'array'
      : typeof v === 'number'
        ? Number.isInteger(v)
          ? 'integer'
          : 'number'
        : typeof v;

/**
 * Minimal, conservative literal-vs-JSON-Schema check (type / enum / const /
 * properties / required / additionalProperties / items). Returns an error
 * string or null; undecidable constructs pass.
 */
export function literalMatchesSchema(value: Json, schema: JsonSchema): string | null {
  if (schema === true) return null;
  if (schema === false) return 'schema is false (no value permitted)';
  if (!isPlainObject(schema)) return null;
  const s = schema as JsonObject;
  if (s['const'] !== undefined && JSON.stringify(s['const']) !== JSON.stringify(value)) {
    return `expected const ${JSON.stringify(s['const'])}`;
  }
  if (Array.isArray(s['enum']) && !s['enum'].some((m) => JSON.stringify(m) === JSON.stringify(value))) {
    return `value ${JSON.stringify(value)} not in enum ${JSON.stringify(s['enum'])}`;
  }
  if (s['type'] !== undefined) {
    const allowed = Array.isArray(s['type']) ? (s['type'] as Json[]) : [s['type']];
    const actual = JSON_TYPE_OF(value);
    const ok = allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return `expected type ${allowed.join('|')}, got ${actual}`;
  }
  if (isPlainObject(value)) {
    const props = isPlainObject(s['properties']) ? (s['properties'] as JsonObject) : undefined;
    if (Array.isArray(s['required'])) {
      for (const req of s['required']) {
        if (typeof req === 'string' && !Object.hasOwn(value, req)) return `missing required "${req}"`;
      }
    }
    if (props !== undefined) {
      for (const [k, v] of Object.entries(value)) {
        if (Object.hasOwn(props, k)) {
          const err = literalMatchesSchema(v, props[k] as JsonSchema);
          if (err !== null) return `${k}: ${err}`;
        } else if (s['additionalProperties'] === false) {
          return `unexpected property "${k}"`;
        }
      }
    }
  }
  if (Array.isArray(value) && s['items'] !== undefined && typeof s['items'] !== 'boolean') {
    for (const [i, v] of value.entries()) {
      const err = literalMatchesSchema(v, s['items'] as JsonSchema);
      if (err !== null) return `[${i}]: ${err}`;
    }
  }
  return null;
}

// ----------------------------------------------------------------- graph pass

function graphChecks(ctx: Ctx, fabrial: Fabrial): void {
  const ids = new Set(Object.keys(fabrial.elements));
  const refsOf = (el: ElementSpec): string[] => [
    ...(el.children ?? []),
    ...Object.values(el.slots ?? {}).flat(),
  ];

  if (!ids.has(fabrial.root)) {
    addIssue(ctx, {
      code: 'dangling-ref',
      message: `root "${fabrial.root}" is not an element`,
      path: 'root',
    });
  }
  for (const [id, el] of Object.entries(fabrial.elements)) {
    for (const ref of refsOf(el)) {
      if (!ids.has(ref)) {
        addIssue(ctx, {
          code: 'dangling-ref',
          message: `"${id}" references missing element "${ref}"`,
          elementId: id,
          path: `elements.${id}`,
        });
      }
    }
  }

  // Cycles: coloring DFS over the whole graph.
  const color = new Map<string, 'gray' | 'black'>();
  const cyclic = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (color.get(id) === 'black') return;
    if (color.get(id) === 'gray') {
      const at = trail.indexOf(id);
      const cycle = trail.slice(at === -1 ? 0 : at).concat(id);
      const anchor = cycle[0] ?? id;
      if (!cyclic.has(anchor)) {
        cyclic.add(anchor);
        addIssue(ctx, {
          code: 'cycle',
          message: `element graph contains a cycle: ${cycle.join(' → ')}`,
          elementId: anchor,
        });
      }
      return;
    }
    color.set(id, 'gray');
    const el = fabrial.elements[id];
    if (el !== undefined) {
      for (const ref of refsOf(el)) {
        if (ids.has(ref)) visit(ref, [...trail, id]);
      }
    }
    color.set(id, 'black');
  };
  for (const id of ids) visit(id, []);

  // Orphans: unreachable from root.
  if (ids.has(fabrial.root)) {
    const reached = new Set<string>();
    const queue = [fabrial.root];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      if (reached.has(id)) continue;
      reached.add(id);
      const el = fabrial.elements[id];
      if (el !== undefined) for (const ref of refsOf(el)) if (ids.has(ref)) queue.push(ref);
    }
    for (const id of ids) {
      if (!reached.has(id)) {
        addIssue(ctx, {
          code: 'orphan',
          message: `element "${id}" is unreachable from root "${fabrial.root}"`,
          elementId: id,
        });
      }
    }
  }
}

// ------------------------------------------------------------- element checks

function checkProps(ctx: Ctx, id: string, el: ElementSpec, def: ComponentDef): void {
  const props = el.props ?? {};
  const schema = def.props;
  if (!(schema instanceof z.ZodObject)) {
    if (!containsDynamic(props)) {
      const parsed = schema.safeParse(props);
      if (!parsed.success) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `props fail the ${el.type} schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
          elementId: id,
          path: `elements.${id}.props`,
        });
      }
    }
    return;
  }
  const shape = schema.shape as Record<string, z.ZodType>;
  for (const key of Object.keys(props)) {
    if (!Object.hasOwn(shape, key)) {
      addIssue(ctx, {
        code: 'bad-props',
        message: `unknown prop "${key}" on ${el.type}`,
        elementId: id,
        path: `elements.${id}.props.${key}`,
      });
    }
  }
  for (const [key, fieldRaw] of Object.entries(shape)) {
    const field = unwrapField(fieldRaw);
    const value = props[key];
    const propPath = `elements.${id}.props.${key}`;
    if (value === undefined) {
      if (!fieldRaw.safeParse(undefined).success) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `missing required prop "${key}" on ${el.type}`,
          elementId: id,
          path: propPath,
        });
      }
      continue;
    }
    if (isUiPointerSchema(field)) {
      if (typeof value !== 'string' || !value.startsWith('/')) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `prop "${key}" on ${el.type} is a ui-doc pointer and must be a literal absolute pointer string`,
          elementId: id,
          path: propPath,
        });
      } else {
        checkUiPath(ctx, value, id, propPath);
      }
      continue;
    }
    // Link authoring must stay a direct route before generic dynamic props skip
    // schema checks. Route inventory and ui-path checks still walk the tree.
    if (el.type === 'Link' && key === 'href') {
      if (!zRouteExpr.safeParse(value).success) {
        addIssue(ctx, {
          code: 'bad-props',
          message: 'prop "href" on Link must be a direct $route',
          elementId: id,
          path: propPath,
        });
      }
      continue;
    }
    // The `hashHref()` branch, and it sits HERE — before the dynamic skip
    // below — for the same reason the uiPointer branch does: a prop the
    // validator must constrain cannot be one the validator declines to look
    // at. A literal falls through to the zod check (the `^#/` regex refuses
    // `https://example.com` and `javascript:alert(1)` with no extra code); a
    // dynamic value is narrowed to the two forms that carry a SERVED string
    // whole. `$template` is refused by name because it is the only form that
    // assembles one (see `hashHref` in model/ui.ts).
    if (isHashHrefSchema(field)) {
      const kind = exprKind(value);
      if (kind !== null && kind !== 'bind' && kind !== 'ui' && !(kind === 'route' && fieldRaw.safeParse(value).success)) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `prop "${key}" on ${el.type} is an href and may only be a literal "#/…", a $bind, a $ui or an admitted direct $route — this is a $${kind}`,
          elementId: id,
          path: propPath,
        });
        continue;
      }
      if (kind === null && containsDynamic(value)) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `prop "${key}" on ${el.type} is an href and may only be a literal "#/…", a $bind, a $ui or an admitted direct $route — this nests a dynamic value`,
          elementId: id,
          path: propPath,
        });
        continue;
      }
    }
    // Dynamic props are NOT schema-checked here or at runtime: the shape check
    // runs only over fully-literal values; resolved expression output goes to
    // the impl unvalidated (a post-resolve re-check is explicitly deferred).
    if (containsDynamic(value)) continue;
    const parsed = fieldRaw.safeParse(value);
    if (!parsed.success) {
      addIssue(ctx, {
        code: 'bad-props',
        message: `prop "${key}" on ${el.type}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        elementId: id,
        path: propPath,
      });
    }
  }
}

function collectedEventsFrom(
  ctx: Ctx,
  id: string,
  el: ElementSpec,
  def: ComponentDef,
): { names: Set<string>; decidable: boolean } {
  const names = new Set<string>();
  if (def.eventsFrom === undefined) return { names, decidable: true };
  const raw = (el.props ?? {})[def.eventsFrom.prop];
  if (raw === undefined) return { names, decidable: true };
  const nonliteral = (why: string): { names: Set<string>; decidable: boolean } => {
    addIssue(ctx, {
      code: 'eventsFrom-nonliteral',
      message: `prop "${def.eventsFrom?.prop}" on ${el.type} must be a literal JSON array (${why})`,
      elementId: id,
      path: `elements.${id}.props.${def.eventsFrom?.prop}`,
    });
    return { names, decidable: false };
  };
  if (exprKind(raw) !== null || !Array.isArray(raw)) return nonliteral('it declares event names');
  for (const item of raw) {
    if (!isPlainObject(item)) return nonliteral('each entry must be a literal object');
    const fieldValue = item[def.eventsFrom.field];
    if (typeof fieldValue !== 'string' || exprKind(fieldValue) !== null) {
      return nonliteral(`each entry's "${def.eventsFrom.field}" must be a literal string`);
    }
    names.add(fieldValue);
  }
  return { names, decidable: true };
}

function checkActions(ctx: Ctx, id: string, event: string, actions: Actions): void {
  const list: Action[] = Array.isArray(actions) ? actions : [actions];
  list.forEach((action, i) => {
    const base = `elements.${id}.on.${event}${Array.isArray(actions) ? `[${i}]` : ''}`;
    if ('ui' in action) {
      for (const [ptr, valueExpr] of Object.entries(action.ui)) {
        checkUiPath(ctx, ptr, id, `${base}.ui`);
        collectUiReads(ctx, valueExpr as PropValue, id, `${base}.ui.${ptr}`);
      }
      return;
    }
    if ('advance' in action) {
      // list absoluteness / key non-emptiness / dir enum are schema-enforced
      // (bad-envelope). No check that list matches any repeat — deliberate
      // non-coupling; advance addresses a projection list, not a screen region.
      checkUiPath(ctx, action.advance.cursor, id, `${base}.advance.cursor`);
      if (action.advance.filter !== undefined) {
        collectUiReads(ctx, action.advance.filter, id, `${base}.advance.filter`);
      }
      return;
    }
    // verb action
    const decl = ctx.verbByName.get(action.verb);
    if (decl === undefined) {
      addIssue(ctx, {
        code: 'unknown-verb',
        message: `verb "${action.verb}" is not in the app's verb manifest`,
        elementId: id,
        path: base,
      });
    } else {
      const schema = decl.params;
      collectUiReads(ctx, action.params as PropValue, id, `${base}.params`);
      if (isPlainObject(schema)) {
        const s = schema as JsonObject;
        if (Array.isArray(s['required'])) {
          for (const req of s['required']) {
            if (typeof req === 'string' && !Object.hasOwn(action.params, req)) {
              addIssue(ctx, {
                code: 'bad-verb-params',
                message: `verb "${action.verb}" requires param "${req}"`,
                elementId: id,
                path: `${base}.params`,
              });
            }
          }
        }
        const props = isPlainObject(s['properties']) ? (s['properties'] as JsonObject) : undefined;
        for (const [k, v] of Object.entries(action.params)) {
          if (props !== undefined && !Object.hasOwn(props, k) && s['additionalProperties'] === false) {
            addIssue(ctx, {
              code: 'bad-verb-params',
              message: `verb "${action.verb}" does not accept param "${k}"`,
              elementId: id,
              path: `${base}.params.${k}`,
            });
            continue;
          }
          if (props !== undefined && Object.hasOwn(props, k) && !containsDynamic(v as PropValue)) {
            const err = literalMatchesSchema(v as Json, props[k] as JsonSchema);
            if (err !== null) {
              addIssue(ctx, {
                code: 'bad-verb-params',
                message: `verb "${action.verb}" param "${k}": ${err}`,
                elementId: id,
                path: `${base}.params.${k}`,
              });
            }
          }
        }
      }
    }
    if (action.confirm !== undefined) {
      collectUiReads(ctx, action.confirm.message as PropValue, id, `${base}.confirm.message`);
    }
    if (action.done !== undefined) {
      for (const [ptr, valueExpr] of Object.entries(action.done.ui)) {
        checkUiPath(ctx, ptr, id, `${base}.done.ui`);
        collectUiReads(ctx, valueExpr as PropValue, id, `${base}.done.ui.${ptr}`);
      }
    }
  });
}

function elementChecks(ctx: Ctx, fabrial: Fabrial, catalog: Catalog): void {
  for (const [id, el] of Object.entries(fabrial.elements)) {
    const def: ComponentDef | undefined = catalog.components[el.type];

    if (el.repeat !== undefined && el.repeat.key === undefined) {
      addIssue(ctx, {
        code: 'missing-repeat-key',
        message: `repeat on "${id}" is missing "key" (the item field used for React keys)`,
        elementId: id,
        path: `elements.${id}.repeat`,
      });
    }
    if (el.props !== undefined) collectUiReads(ctx, el.props, id, `elements.${id}.props`);
    if (el.visible !== undefined) collectVisibleUiReads(ctx, el.visible, id, `elements.${id}.visible`);
    if (el.repeat?.filter !== undefined) {
      collectUiReads(ctx, el.repeat.filter, id, `elements.${id}.repeat.filter`);
    }
    if (el.context !== undefined) {
      // list absoluteness, key non-emptiness, and repeat exclusivity are
      // schema-enforced (bad-envelope); only the ui pointer needs declaring.
      checkUiPath(ctx, el.context.at, id, `elements.${id}.context.at`);
    }
    for (const [event, actions] of Object.entries(el.on ?? {})) {
      checkActions(ctx, id, event, actions);
    }

    if (def === undefined) {
      addIssue(ctx, {
        code: 'unknown-type',
        message: `type "${el.type}" is not in catalog ${catalog.name}@${catalog.version}`,
        elementId: id,
        path: `elements.${id}.type`,
      });
      continue;
    }

    checkProps(ctx, id, el, def);

    const declaredSlots = new Set<string>([
      ...(def.slots ?? []),
      ...Object.keys(def.itemSlots ?? {}),
    ]);
    for (const slotName of Object.keys(el.slots ?? {})) {
      if (!declaredSlots.has(slotName)) {
        addIssue(ctx, {
          code: 'undeclared-slot',
          message: `slot "${slotName}" is not declared by ${el.type}`,
          elementId: id,
          path: `elements.${id}.slots.${slotName}`,
        });
      }
    }

    const { names: dynamicEvents, decidable } = collectedEventsFrom(ctx, id, el, def);
    if (decidable) {
      const staticEvents = new Set(def.events ?? []);
      for (const event of Object.keys(el.on ?? {})) {
        if (!staticEvents.has(event) && !dynamicEvents.has(event)) {
          addIssue(ctx, {
            code: 'undeclared-event',
            message: `event "${event}" is not declared by ${el.type} (events or eventsFrom)`,
            elementId: id,
            path: `elements.${id}.on.${event}`,
          });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ top level

/**
 * Internal variant used by the CLI: catalog and/or manifest may be absent, in
 * which case the corresponding checks are skipped (envelope + graph + ui-path
 * checks always run).
 */
export function validateFabrialPartial(
  fabrial: unknown,
  catalog: Catalog | null,
  verbManifest: readonly VerbDecl[] | null,
  projections?: readonly string[] | null,
  inventory?: Readonly<Record<string, readonly string[]>>,
): ValidateResult {
  const parsed = zFabrial.safeParse(fabrial);
  if (!parsed.success) {
    const issues: Issue[] = parsed.error.issues.slice(0, 20).map((zi) => ({
      code: 'bad-envelope',
      message: zi.message,
      path: zi.path.map(String).join('.') || undefined,
    }));
    return { ok: false, issues };
  }
  const doc = parsed.data;
  const ctx: Ctx = {
    issues: [],
    declaredUi: new Set(Object.keys(doc.ui ?? {})),
    verbByName: new Map((verbManifest ?? []).map((v) => [v.name, v])),
  };

  if (doc.loupe !== LOUPE_DIALECT_VERSION) {
    addIssue(ctx, {
      code: 'bad-envelope',
      message: `unknown dialect version ${doc.loupe} (this loader speaks ${LOUPE_DIALECT_VERSION})`,
      path: 'loupe',
    });
  }

  // App projection check — only when the caller supplies the app's declared
  // projections (the renderer passes descriptor.projections; the CLI may not).
  if (projections !== undefined && projections !== null && !projections.includes(doc.app.projection)) {
    addIssue(ctx, {
      code: 'unknown-projection',
      message: `projection "${doc.app.projection}" is not declared by the app (declared: ${projections.join(', ') || 'none'})`,
      path: 'app.projection',
    });
  }

  if (catalog !== null) {
    const pin = doc.catalog;
    const [pMaj, pMin, pPat] = semverParts(pin.version);
    const [lMaj, lMin, lPat] = semverParts(catalog.version);
    const minorPatchOk = lMin > pMin || (lMin === pMin && lPat >= pPat);
    if (pin.name !== catalog.name || pMaj !== lMaj || !minorPatchOk) {
      addIssue(ctx, {
        code: 'catalog-pin-mismatch',
        message: `fabrial pins ${pin.name}@${pin.version}; loaded catalog is ${catalog.name}@${catalog.version} (need same name, same major, loaded minor/patch >= pinned)`,
        path: 'catalog',
      });
    }
  }

  // Inspect the entire expression-bearing tree, even without catalog/manifest.
  // Routes fail closed; values served later cannot change their literal target.
  const checkRoutes = (value: unknown, path: string): void => {
    if (exprKind(value) === 'route') {
      const { $route: route } = zRouteExpr.parse(value);
      if (!inventory || !Object.hasOwn(inventory, doc.app.name) || !inventory[doc.app.name]?.includes(route.fabrial)) {
        addIssue(ctx, {
          code: 'bad-props',
          message: `route target "${route.fabrial}" is absent from the inventory for app "${doc.app.name}"`,
          path,
        });
      }
      for (const [key, param] of Object.entries(route.params ?? {})) {
        if (typeof param === 'object' && '$ui' in param) {
          checkUiPath(ctx, param.$ui, undefined, `${path}.$route.params.${key}`);
        }
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((entry, i) => checkRoutes(entry, `${path}[${i}]`));
    else if (isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) checkRoutes(entry, `${path}.${key}`);
    }
  };
  checkRoutes(doc.elements, 'elements');
  graphChecks(ctx, doc);

  if (catalog !== null) {
    elementChecks(ctx, doc, catalog);
  } else if (verbManifest !== null) {
    // No catalog: still check ui reads + verbs.
    for (const [id, el] of Object.entries(doc.elements)) {
      if (el.props !== undefined) collectUiReads(ctx, el.props, id, `elements.${id}.props`);
      if (el.visible !== undefined) collectVisibleUiReads(ctx, el.visible, id, `elements.${id}.visible`);
      for (const [event, actions] of Object.entries(el.on ?? {})) checkActions(ctx, id, event, actions);
    }
  }

  return ctx.issues.length > 0 ? { ok: false, issues: ctx.issues } : { ok: true, fabrial: doc };
}

/**
 * validateFabrial(fabrial, catalog, verbManifest): full §3 validation, run at
 * save time and again at load time.
 */
export function validateFabrial(
  fabrial: unknown,
  catalog: Catalog,
  verbManifest: readonly VerbDecl[],
  projections?: readonly string[],
  inventory?: Readonly<Record<string, readonly string[]>>,
): ValidateResult {
  return validateFabrialPartial(fabrial, catalog, verbManifest, projections, inventory);
}
