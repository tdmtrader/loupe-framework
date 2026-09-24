// Optimistic overlay mechanics (§5.4 step 4): instantiate an app-declared
// PatchTemplate with the dispatch params, apply it as a shadow overlay over
// the latest snapshot. Best-effort by design — wrong optimism self-heals the
// moment authoritative state arrives, so failed ops are skipped, not thrown.
import type { Json, PatchOp, PatchTemplate } from '@loupe/protocol';
import { getPointer, isPlainObject, pointerTokens } from '@loupe/spec';

const WHOLE_PLACEHOLDER = /^\$\{params\.([^}]+)\}$/;
const INLINE_PLACEHOLDER = /\$\{params\.([^}]+)\}/g;

function substituteString(s: string, params: Record<string, Json>): Json {
  const whole = WHOLE_PLACEHOLDER.exec(s);
  if (whole !== null) return params[whole[1] as string] ?? null; // keep the param's type
  return s.replace(INLINE_PLACEHOLDER, (_m, name: string) => {
    const v = params[name];
    return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

function substituteValue(v: Json, params: Record<string, Json>): Json {
  if (typeof v === 'string') return substituteString(v, params);
  if (Array.isArray(v)) return v.map((m) => substituteValue(m, params));
  if (isPlainObject(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, m]) => [k, substituteValue(m, params)]));
  }
  return v;
}

/** Instantiate ${params.x} placeholders in paths and values. */
export function instantiatePatchTemplate(
  template: readonly PatchTemplate[],
  params: Record<string, Json>,
): PatchOp[] {
  return template.map((op) => {
    const out: PatchOp = { op: op.op, path: String(substituteString(op.path, params)) };
    if (op.from !== undefined) out.from = String(substituteString(op.from, params));
    if (op.value !== undefined) out.value = substituteValue(op.value, params);
    return out;
  });
}

/**
 * A valid array index token (same rule as pointer.ts getAtTokens): "0" or a
 * non-zero-padded decimal. Anything else (e.g. "", "x", a missing template
 * param) makes the whole op a skip — Number('') is 0 and splice(NaN, …) acts
 * on index 0, so lax coercion would corrupt element 0.
 */
const ARRAY_INDEX_RE = /^(0|[1-9]\d*)$/;

/** Mutate-in-place set/remove used on an already-cloned overlay document. */
function setInPlace(doc: Json, ptr: string, value: Json, insert: boolean): void {
  const tokens = pointerTokens(ptr);
  if (tokens.length === 0) return;
  let cur: Json = doc;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(cur)) {
      if (!ARRAY_INDEX_RE.test(token)) return;
      cur = cur[Number(token)] as Json;
    } else if (isPlainObject(cur)) {
      cur = cur[token] as Json;
    } else {
      return;
    }
    if (cur === null || cur === undefined) return;
  }
  const last = tokens[tokens.length - 1] as string;
  if (Array.isArray(cur)) {
    if (last === '-') cur.push(value);
    else if (!ARRAY_INDEX_RE.test(last)) return;
    else if (insert) cur.splice(Number(last), 0, value);
    else cur[Number(last)] = value;
  } else if (isPlainObject(cur)) {
    cur[last] = value;
  }
}

function removeInPlace(doc: Json, ptr: string): void {
  const tokens = pointerTokens(ptr);
  if (tokens.length === 0) return;
  let cur: Json = doc;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(cur)) {
      if (!ARRAY_INDEX_RE.test(token)) return;
      cur = cur[Number(token)] as Json;
    } else if (isPlainObject(cur)) {
      cur = cur[token] as Json;
    } else {
      return;
    }
    if (cur === null || cur === undefined) return;
  }
  const last = tokens[tokens.length - 1] as string;
  if (Array.isArray(cur)) {
    if (!ARRAY_INDEX_RE.test(last)) return;
    cur.splice(Number(last), 1);
  } else if (isPlainObject(cur)) {
    delete cur[last];
  }
}

/**
 * Apply RFC 6902 ops over a snapshot, returning a new document (the shadow
 * overlay). Failed/missing paths skip silently — optimism is presentation.
 */
export function applyPatchOps(state: Json, ops: readonly PatchOp[]): Json {
  const doc = structuredClone(state) as Json;
  for (const op of ops) {
    switch (op.op) {
      case 'add':
        setInPlace(doc, op.path, structuredClone(op.value ?? null) as Json, true);
        break;
      case 'replace':
        setInPlace(doc, op.path, structuredClone(op.value ?? null) as Json, false);
        break;
      case 'remove':
        removeInPlace(doc, op.path);
        break;
      case 'copy': {
        const v = getPointer(doc, op.from ?? '');
        if (v !== undefined) setInPlace(doc, op.path, structuredClone(v) as Json, true);
        break;
      }
      case 'move': {
        const v = getPointer(doc, op.from ?? '');
        if (v !== undefined) {
          removeInPlace(doc, op.from ?? '');
          setInPlace(doc, op.path, v, true);
        }
        break;
      }
      case 'test':
        break; // overlay is best-effort; tests don't gate it
    }
  }
  return doc;
}
