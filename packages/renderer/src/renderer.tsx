// <LoupeRenderer> — walks a validated fabrial's element map, resolving
// expressions against the latest projection snapshot (plus the optimistic
// overlay), mounting catalog impls, and translating component events into
// verb dispatches through the client. Holds NO domain state — only the ui doc
// (lossable view ephemera, reset on remount by design).
import {
  Component,
  Fragment,
  createElement,
  memo,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react';
import type {
  AppDescriptor,
  ConnectionState,
  Json,
  JsonObject,
  LoupeClient,
  VerbDecl,
  VerbError,
  VerbOk,
} from '@loupe/protocol';
import {
  advanceCursor,
  evaluateVisible,
  expandRepeat,
  isUiPointerSchema,
  resolve,
  resolveContextItem,
  unwrapField,
  validateFabrial,
} from '@loupe/spec';
import type {
  Action,
  Actions,
  Catalog,
  ComponentImpl,
  ComponentImplArgs,
  ElementSpec,
  Fabrial,
  ImplRecord,
  Pending,
  ResolveScope,
  UiBinding,
  UiSet,
  VerbAction,
} from '@loupe/spec';
import { ConfirmDialog, ConnectionBand, ErrorPanel } from './chrome.tsx';
import { applyPatchOps, instantiatePatchTemplate } from './patch.ts';
import { applyUiSet, setAtPointer } from './ui-doc.ts';
import { cloneJson, looseDeepEqual } from './util.ts';

export interface LoupeRendererProps {
  /** A fabrial that already passed validateFabrial (the renderer re-validates on mount). */
  fabrial: Fabrial;
  catalog: Catalog;
  components: ImplRecord<ReactNode>;
  client: LoupeClient;
  /** Params for the bound projection (host route query), if it takes any. */
  projectionParams?: JsonObject;
  /** Explicit mounting instance; never inferred from the fabrial or projection. */
  instance?: string;
  /** App names mapped to their app-relative fabrial paths. */
  fabrialInventory?: Readonly<Record<string, readonly string[]>>;
  /** Outcome records surface here (host shows a transient status line). */
  onVerbResult?: (verb: string, result: VerbOk) => void;
  onVerbError?: (verb: string, error: VerbError) => void;
}

/** How long an optimistic overlay survives without authoritative confirmation. */
const OPTIMISM_TIMEOUT_MS = 2000;

/** How long a non-connected state must persist before the band shows (no flash on sub-second blips). */
const BAND_GRACE_MS = 1500;

// ------------------------------------------------------------- memoized leaf

type ImplFC = FC<ComponentImplArgs<ReactNode>>;

/**
 * Widen an ImplRecord entry back to a callable FC. The record erases each
 * impl's prop type to `never` (each component's P is its own); the renderer
 * re-attaches typed props at render time from the catalog-validated resolved
 * values, so this is the one place the erasure is undone.
 */
const asImplFC = (impl: ComponentImpl<ReactNode, never>): ImplFC => impl as unknown as ImplFC;

const memoCache = new WeakMap<object, ImplFC>();

/** Leaf impls (no children/slots/itemSlots) memoize on deep-equal resolved props. */
function memoizedLeaf(impl: ImplFC): ImplFC {
  const cached = memoCache.get(impl);
  if (cached !== undefined) return cached;
  const wrapped = memo(impl, (prev, next) => looseDeepEqual(prev.props, next.props)) as ImplFC;
  memoCache.set(impl, wrapped);
  return wrapped;
}

// ------------------------------------------------------------- error boundary

interface BoundaryState {
  message: string | null;
}

/**
 * Failure stays total and legible at runtime too: if resolve() or a component
 * impl throws during the element walk, the whole screen becomes an ErrorPanel
 * (never a blank unmount).
 */
class RenderErrorBoundary extends Component<
  { fabrialName: string; children?: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { message: null };

  static getDerivedStateFromError(e: unknown): BoundaryState {
    return { message: e instanceof Error ? e.message : String(e) };
  }

  override render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <ErrorPanel
          fabrialName={this.props.fabrialName}
          issues={[{ code: 'render-error', message: this.state.message }]}
        />
      );
    }
    return this.props.children;
  }
}

/** Defers the element walk into a child render so the boundary above can catch it. */
const ElementWalk: FC<{ run: () => ReactNode }> = ({ run }) => <>{run()}</>;

/** Deterministic (sorted-keys) serialization of projection params for the mount key. */
function stableParamsKey(v: Json | undefined): string {
  if (v === undefined) return '';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableParamsKey).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableParamsKey(v[k])}`)
    .join(',')}}`;
}

// ------------------------------------------------------------------ mount

export function LoupeRenderer(props: LoupeRendererProps): ReactNode {
  const { fabrial, catalog, client } = props;
  const [descriptor, setDescriptor] = useState<AppDescriptor | null>(null);
  const [describeError, setDescribeError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDescriptor(null);
    setDescribeError(null);
    client.describe().then(
      (d) => {
        if (live) setDescriptor(d);
      },
      (e: unknown) => {
        if (live) setDescribeError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  const validation = useMemo(
    () =>
      descriptor === null
        ? null
        : validateFabrial(
            fabrial,
            catalog,
            descriptor.verbs,
            descriptor.projections.map((p) => p.name),
            props.fabrialInventory,
          ),
    [fabrial, catalog, descriptor, props.fabrialInventory],
  );

  if (describeError !== null) {
    return (
      <ErrorPanel
        fabrialName={fabrial.fabrial}
        issues={[{ code: 'bad-envelope', message: `app unreachable: ${describeError}` }]}
      />
    );
  }
  if (descriptor === null || validation === null) {
    return <div data-testid="lp-loading" style={{ color: 'var(--lp-text-dim)' }} />;
  }
  if (!validation.ok) {
    return (
      <ErrorPanel
        fabrialName={fabrial.fabrial}
        pinned={`${fabrial.catalog.name}@${fabrial.catalog.version}`}
        loaded={`${catalog.name}@${catalog.version}`}
        issues={validation.issues}
      />
    );
  }
  // The key carries the projection params (stable serialization) so an
  // in-place params change remounts Mounted and resubscribes.
  return (
    <Mounted
      key={`${props.instance ?? ''}/${fabrial.fabrial}@${fabrial.version}?${stableParamsKey(props.projectionParams ?? {})}`}
      {...props}
      fabrial={validation.fabrial}
      verbs={descriptor.verbs}
    />
  );
}

// ------------------------------------------------------------------ runtime

interface OverlayEntry {
  id: number;
  ops: ReturnType<typeof instantiatePatchTemplate>;
  /** The dispatch response seq; null until the response arrives. */
  minSeq: number | null;
  timer: ReturnType<typeof setTimeout>;
}

interface InstanceScope {
  item?: Json;
  index?: number;
}

function Mounted(
  props: LoupeRendererProps & { fabrial: Fabrial; verbs: readonly VerbDecl[] },
): ReactNode {
  const { fabrial, catalog, components, client, projectionParams, onVerbResult, onVerbError } = props;
  const routeContext = props.instance === undefined ? undefined : { instance: props.instance };

  const verbByName = useMemo(() => new Map(props.verbs.map((v) => [v.name, v])), [props.verbs]);

  // --- served state -----------------------------------------------------
  const [snapshot, setSnapshot] = useState<{ seq: number; state: Json } | null>(null);
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    const unsub = client.subscribe(fabrial.app.projection, projectionParams ?? {}, (seq, state) => {
      snapshotRef.current = { seq, state };
      setSnapshot(snapshotRef.current);
      pruneOverlays(seq);
    });
    return unsub;
    // deliberately not depending on projectionParams identity: the host passes
    // a fresh object per render; params CONTENT changes remount via the
    // Mounted key (fabrial id + version + stable params serialization).
  }, [client, fabrial]);

  // --- connection state -------------------------------------------------
  // Optional liveness observable; a client without `connection` (third-party/
  // MCP) is assumed 'connected' and never shows a band.
  const [conn, setConn] = useState<ConnectionState>('connected');
  useEffect(() => client.connection?.(setConn), [client]);
  const [showBand, setShowBand] = useState(false);
  useEffect(() => {
    if (conn === 'connected') {
      setShowBand(false);
      return;
    }
    const t = setTimeout(() => setShowBand(true), BAND_GRACE_MS); // no flash on sub-second blips
    return () => clearTimeout(t);
  }, [conn]);

  // --- ui doc (client-local ephemera) ----------------------------------
  const [uiDoc, setUiDocState] = useState<Json>(() => cloneJson(fabrial.ui));
  const [uiActionError, setUiActionError] = useState<string | null>(null);
  const uiDocRef = useRef(uiDoc);
  const setUiDoc = (next: Json): void => {
    uiDocRef.current = next;
    setUiDocState(next);
  };

  // --- optimistic overlay ----------------------------------------------
  const overlaysRef = useRef<OverlayEntry[]>([]);
  const overlayIdRef = useRef(0);
  const [overlayVersion, bump] = useReducer((c: number) => c + 1, 0);
  const removeOverlay = (id: number): void => {
    const entry = overlaysRef.current.find((e) => e.id === id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    overlaysRef.current = overlaysRef.current.filter((e) => e.id !== id);
    bump();
  };
  function pruneOverlays(seq: number): void {
    for (const entry of [...overlaysRef.current]) {
      if (entry.minSeq !== null && seq >= entry.minSeq) removeOverlay(entry.id);
    }
  }
  useEffect(
    () => () => {
      for (const entry of overlaysRef.current) clearTimeout(entry.timer);
    },
    [],
  );

  const overlaid = useMemo(() => {
    if (snapshot === null) return null;
    let state = snapshot.state;
    for (const entry of overlaysRef.current) state = applyPatchOps(state, entry.ops);
    return state;
    // Every overlaysRef mutation comes with a bump(), so overlayVersion is a
    // faithful dependency even when a remove+add batch keeps length/ids equal.
  }, [snapshot, overlayVersion]);
  const overlaidRef = useRef(overlaid);
  overlaidRef.current = overlaid;

  // --- pending presentation --------------------------------------------
  const [pendingMap, setPendingMap] = useState<Record<string, Pending>>({});
  // Per-dispatch tokens: with overlapping dispatches from one element, only
  // the dispatch that OWNS the current pending entry may clear it on settle.
  const pendingTokenRef = useRef(new Map<string, number>());
  const dispatchSeqRef = useRef(0);
  const setPendingAt = (key: string, value: Pending | undefined): void => {
    setPendingMap((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  // --- confirm dialog ---------------------------------------------------
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const requestConfirm = (title: string, message: string): Promise<boolean> =>
    new Promise((res) => {
      setConfirm({
        title,
        message,
        resolve: (ok) => {
          setConfirm(null);
          res(ok);
        },
      });
    });

  // --- event-time scope lookup -----------------------------------------
  const scopesRef = useRef(new Map<string, InstanceScope>());

  /**
   * Build a resolve scope around an event-time InstanceScope. The relative
   * half (item/index) is the SNAPSHOT taken when the event fired; only the
   * state/ui halves are current, so absolute binds stay truthful.
   */
  const eventScope = (inst: InstanceScope, ui: Json, payload?: Json): ResolveScope => {
    const scope: ResolveScope = { state: overlaidRef.current ?? {}, ui };
    if (inst.item !== undefined) scope.item = inst.item;
    if (inst.index !== undefined) scope.index = inst.index;
    // A component event payload (Board cardMove {card, toLane}, DiffBlock
    // linePress {file, line, side}, RouteGraph nodeSelect {id}) becomes the
    // relative scope for that event's actions — same rule as itemSlot scopes.
    if (payload !== undefined) scope.item = payload;
    return scope;
  };

  // --- actions ----------------------------------------------------------
  function applyUiAction(set: UiSet, scope: ResolveScope): boolean {
    try {
      // Mount validation has already checked every action's route targets
      // against the source-app inventory. Resolution supplies the instance.
      setUiDoc(applyUiSet(uiDocRef.current, set, scope, routeContext));
      return true;
    } catch (e) {
      // Event handlers and async done.ui run outside React's render boundary.
      setUiActionError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function runActions(instanceKey: string, actions: Actions, payload?: Json): Promise<void> {
    const list: Action[] = Array.isArray(actions) ? actions : [actions];
    // The relative scope belongs to the EVENT, so it is read ONCE, here: a
    // verb early in the array re-derives the projection under the element
    // that dispatched it (e.g. a compose verb flips composeVisible and
    // the compose repeat unmounts), and scopesRef is rebuilt from scratch on
    // that render. Looking the instance up again per action would hand a
    // later action an empty scope — item-relative binds resolving to
    // undefined and the verb refused. Actions after the first bind what the
    // person pressed on, not what the first action's side effect produced.
    const inst = scopesRef.current.get(instanceKey) ?? {};
    let ui = uiDocRef.current;
    for (const action of list) {
      if ('ui' in action) {
        if (!applyUiAction(action.ui, eventScope(inst, ui, payload))) return;
        ui = uiDocRef.current;
      } else if ('advance' in action) {
        // Evaluates against the OVERLAID state (optimistic overlay included —
        // with an optimistic decide the item is already ineligible when the
        // advance after it runs). The scope carries no item/index: advance is
        // absolute-rooted even when fired from inside a repeat/detail scope.
        const next = advanceCursor(action.advance, { state: overlaidRef.current ?? {}, ui });
        if (next !== undefined) {
          // null is WRITTEN, never deleted, so declared-null ephemera and
          // `eq: null` visibility (the no-cursor placeholder) keep working.
          ui = setAtPointer(ui, action.advance.cursor, next);
          setUiDoc(ui);
        }
      } else {
        const proceed = await runVerb(instanceKey, inst, action, ui, payload);
        ui = uiDocRef.current; // done.ui may have advanced it
        if (!proceed) return; // declined confirm / error aborts the sequence
      }
    }
  }

  async function runVerb(
    instanceKey: string,
    inst: InstanceScope,
    action: VerbAction,
    ui: Json,
    payload?: Json,
  ): Promise<boolean> {
    const scope = eventScope(inst, ui, payload);

    if (action.confirm !== undefined) {
      const message = String(resolve(action.confirm.message, scope, routeContext) ?? '');
      const confirmed = await requestConfirm(action.confirm.title, message);
      if (!confirmed) return false;
    }

    const params: Record<string, Json> = {};
    for (const [k, expr] of Object.entries(action.params)) {
      const v = resolve(expr, scope, routeContext);
      if (v !== undefined) params[k] = v;
    }

    const pendingToken = (dispatchSeqRef.current += 1);
    pendingTokenRef.current.set(instanceKey, pendingToken);
    setPendingAt(instanceKey, action.pending ?? {});

    let overlayId: number | null = null;
    const decl = verbByName.get(action.verb);
    if (decl?.optimistic !== undefined && decl.optimistic.length > 0) {
      const id = (overlayIdRef.current += 1);
      overlayId = id;
      overlaysRef.current = [
        ...overlaysRef.current,
        {
          id,
          ops: instantiatePatchTemplate(decl.optimistic, params),
          minSeq: null,
          timer: setTimeout(() => removeOverlay(id), OPTIMISM_TIMEOUT_MS),
        },
      ];
      bump();
    }

    try {
      const result = await client.dispatch(action.verb, params);
      if (result.ok) {
        if (overlayId !== null) {
          const entry = overlaysRef.current.find((e) => e.id === overlayId);
          if (entry !== undefined) {
            entry.minSeq = result.seq;
            if ((snapshotRef.current?.seq ?? -1) >= result.seq) removeOverlay(overlayId);
          }
        }
        if (action.done !== undefined) {
          // `done.ui` runs after an await, and the dispatching element may have
          // unmounted meanwhile (deciding hides the decide bar). It resolves
          // against the same event-time relative scope — item-relative binds
          // like {"$bind": "id"} still see the item that fired — with the
          // ui/state halves refreshed to the latest.
          const doneScope = eventScope(inst, uiDocRef.current, payload);
          if (!applyUiAction(action.done.ui, doneScope)) return false;
        }
        onVerbResult?.(action.verb, result);
        return true;
      }
      if (overlayId !== null) removeOverlay(overlayId);
      onVerbError?.(action.verb, result);
      return false;
    } catch (e) {
      if (overlayId !== null) removeOverlay(overlayId);
      onVerbError?.(action.verb, {
        ok: false,
        error: { code: 'transport', message: e instanceof Error ? e.message : String(e) },
      });
      return false;
    } finally {
      if (pendingTokenRef.current.get(instanceKey) === pendingToken) {
        pendingTokenRef.current.delete(instanceKey);
        setPendingAt(instanceKey, undefined);
      }
    }
  }

  // --- element walk -----------------------------------------------------
  if (uiActionError !== null) {
    return <ErrorPanel fabrialName={fabrial.fabrial} issues={[{ code: 'render-error', message: uiActionError }]} />;
  }
  const state = overlaid;
  if (state === null) {
    return <div data-testid="lp-loading" style={{ color: 'var(--lp-text-dim)' }} />;
  }
  const rootScope: ResolveScope = { state, ui: uiDoc };
  scopesRef.current = new Map();

  const uiPointerProps = (type: string): Set<string> => {
    const def = catalog.components[type];
    const shape = (def?.props as { shape?: Record<string, unknown> } | undefined)?.shape;
    const out = new Set<string>();
    if (shape === undefined) return out;
    for (const [key, field] of Object.entries(shape)) {
      if (isUiPointerSchema(unwrapField(field))) out.add(key);
    }
    return out;
  };

  function renderElement(id: string, scope: ResolveScope, keyPrefix: string): ReactNode {
    const el: ElementSpec | undefined = fabrial.elements[id];
    if (el === undefined) return null;
    if (el.repeat !== undefined) {
      // `visible` on a repeated element gates the WHOLE repeat and is
      // evaluated in the enclosing scope (per-item gating is `filter`'s job —
      // inside the item scope the outer bindings would no longer resolve).
      if (!evaluateVisible(el.visible, scope)) return null;
      const items = expandRepeat(el.repeat, scope);
      return items.map(({ item, index, key }) =>
        renderInstance(
          id,
          el,
          { state: scope.state, ui: scope.ui, item, index },
          `${keyPrefix}${id}@${key}`,
          false,
        ),
      );
    }
    if (el.context !== undefined) {
      // Context puts "the current item" into scope for the element's props,
      // actions, and descendants. Unlike repeat, `visible` evaluates IN the
      // context scope (exactly one instance, so the item-aware gate is
      // well-defined; outer data stays reachable via absolute pointers).
      // Re-resolved every render, so the scope tracks the cursor; the
      // instanceKey is stable across cursor moves (no listener churn). An
      // event payload still wins over the context item in eventScope.
      const hit = resolveContextItem(el.context, scope);
      const ctxScope: ResolveScope =
        hit === null
          ? { state: scope.state, ui: scope.ui }
          : { state: scope.state, ui: scope.ui, item: hit.item, index: hit.index };
      return renderInstance(id, el, ctxScope, `${keyPrefix}${id}`);
    }
    return renderInstance(id, el, scope, `${keyPrefix}${id}`);
  }

  function renderInstance(
    _id: string,
    el: ElementSpec,
    scope: ResolveScope,
    instanceKey: string,
    checkVisible = true,
  ): ReactNode {
    if (checkVisible && !evaluateVisible(el.visible, scope)) return null;
    const inst: InstanceScope = {};
    if (scope.item !== undefined) inst.item = scope.item;
    if (scope.index !== undefined) inst.index = scope.index;
    scopesRef.current.set(instanceKey, inst);

    const impl = components[el.type];
    if (impl === undefined) {
      return (
        <div key={instanceKey} data-testid="lp-missing-impl" style={{ color: 'var(--lp-text-dim)' }}>
          no impl for {el.type}
        </div>
      );
    }

    const pointerProps = uiPointerProps(el.type);
    const resolved: Record<string, Json | UiBinding | undefined> = {};
    for (const [key, value] of Object.entries(el.props ?? {})) {
      if (pointerProps.has(key) && typeof value === 'string') {
        const ptr = value;
        resolved[key] = {
          value: (resolve({ $ui: ptr }, scope) ?? undefined) as Json | undefined,
          set: (v: Json) => setUiDoc(setAtPointer(uiDocRef.current, ptr, v)),
        } satisfies UiBinding;
      } else {
        resolved[key] = resolve(value, scope, routeContext);
      }
    }

    // Pending presentation: label swap / disable, purely visual (§5.4 step 3).
    const pending = pendingMap[instanceKey];
    if (pending !== undefined) {
      if (pending.label !== undefined) resolved['label'] = pending.label;
      if (pending.disable === true) resolved['disabled'] = true;
    }

    const emit = (event: string, payload?: Json): void => {
      const actions = el.on?.[event];
      if (actions !== undefined) void runActions(instanceKey, actions, payload);
    };

    const itemSlot = (name: string, scopeItem: Json, key: string): ReactNode => {
      const ids = el.slots?.[name];
      if (ids === undefined) return null;
      const slotScope: ResolveScope = { state: scope.state, ui: scope.ui, item: scopeItem };
      return (
        <Fragment key={key}>
          {ids.map((cid) => renderElement(cid, slotScope, `${instanceKey}/${name}@${key}/`))}
        </Fragment>
      );
    };

    const def = catalog.components[el.type];
    const itemSlotNames = new Set(Object.keys(def?.itemSlots ?? {}));
    let slots: Record<string, ReactNode> | undefined;
    for (const [slotName, ids] of Object.entries(el.slots ?? {})) {
      if (itemSlotNames.has(slotName)) continue; // rendered on demand via itemSlot()
      slots ??= {};
      slots[slotName] = (
        <Fragment>{ids.map((cid) => renderElement(cid, scope, `${instanceKey}/${slotName}/`))}</Fragment>
      );
    }

    const childNodes =
      el.children !== undefined && el.children.length > 0
        ? el.children.map((cid) => renderElement(cid, scope, `${instanceKey}/`))
        : undefined;

    const args: ComponentImplArgs<ReactNode> = {
      props: resolved as Record<string, unknown>,
      emit,
      hasAction: (event: string) => el.on?.[event] !== undefined,
      itemSlot,
    };
    if (childNodes !== undefined) args.children = <Fragment>{childNodes}</Fragment>;
    if (slots !== undefined) args.slots = slots;

    const isLeaf =
      childNodes === undefined && slots === undefined && itemSlotNames.size === 0;
    const Comp = isLeaf ? memoizedLeaf(asImplFC(impl)) : asImplFC(impl);
    return createElement(Comp, { ...args, key: instanceKey });
  }

  return (
    <RenderErrorBoundary fabrialName={fabrial.fabrial}>
      <ElementWalk run={() => renderElement(fabrial.root, rootScope, '')} />
      {showBand && conn !== 'connected' && <ConnectionBand state={conn} />}
      {confirm !== null && (
        <ConfirmDialog title={confirm.title} message={confirm.message} onResolve={confirm.resolve} />
      )}
    </RenderErrorBoundary>
  );
}
