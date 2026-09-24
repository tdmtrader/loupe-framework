#!/usr/bin/env node
// fabrials/validate.mjs — the headless authoring check ("fabrials are
// authored headlessly from hour zero"). Runs from repo root or
// anywhere: `node fabrials/validate.mjs`. Exit 1 on any issue.
//
// Full validation via the spec engine: validateFabrial(fabrial, loupeStd,
// manifest) with the frozen issue codes (@loupe/spec engine/validate-fabrial).
//
// Verb manifests: when an app is running (bases from
// apps/host/host.config.json, overridable via LOUPE_<APP>_BASE env) the
// fabrial is validated against its LIVE `GET /loupe/app` descriptor. The
// INLINE manifests below — transcribed from each app (apps/grill) — are the
// offline authoring contract and must not drift from the apps.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = await import(new URL('../packages/spec/src/index.ts', import.meta.url));
const { loupeStd } = await import(new URL('../packages/catalog/src/defs/index.ts', import.meta.url));

// ---------------------------------------------------------------- manifests

/** JSON-Schema (draft 2020-12) helper for a flat object param shape. */
const params = (props, required) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});
const S = { str: { type: 'string' }, int: { type: 'integer' }, strOrNull: { type: ['string', 'null'] } };

/** apps/grill — an agent's grilling questions and a human's answers. */
const grillVerbs = [
  {
    name: 'question.ask',
    description: 'ask the human a question (appends questions.jsonl)',
    params: params(
      {
        id: S.str,
        round: S.int,
        title: S.str,
        body: S.str,
        recommendation: S.str,
        options: { type: 'array', items: params({ id: S.str, label: S.str }, ['id', 'label']) },
      },
      ['id', 'round', 'title', 'body', 'recommendation'],
    ),
    records: [{ stream: 'questions.jsonl' }],
  },
  {
    name: 'question.withdraw',
    description: 'withdraw a question (appends a withdrawal line to questions.jsonl)',
    params: params({ id: S.str }, ['id']),
    records: [{ stream: 'questions.jsonl' }],
  },
  {
    name: 'question.answer',
    description: 'answer a question (appends answers.jsonl) — the latest answer stands',
    // `option_id` and `note` are nullable, as the live descriptor types them:
    // the screen binds the note straight from the ui doc.
    params: params(
      { question_id: S.str, choice: { enum: ['recommended', 'option', 'other'] }, option_id: S.strOrNull, note: S.strOrNull },
      ['question_id', 'choice'],
    ),
    records: [{ stream: 'answers.jsonl' }],
  },
  {
    name: 'question.retract',
    description: 'retract the standing answer (appends a retraction to answers.jsonl)',
    params: params({ question_id: S.str }, ['question_id']),
    records: [{ stream: 'answers.jsonl' }],
  },
];

const MANIFESTS = { grill: grillVerbs };

// ------------------------------------------------------------ live manifests
//
// Integration upgrade: when an app is running (bases from
// apps/host/host.config.json, overridable via LOUPE_<APP>_BASE env), validate
// against its LIVE `GET /loupe/app` descriptor. The inline manifests above
// remain the offline authoring fallback.

const LIVE = {}; // app name -> { verbs, base }
try {
  const hostConfig = JSON.parse(
    await readFile(new URL('../apps/host/host.config.json', import.meta.url), 'utf8'),
  );
  for (const [name, { base }] of Object.entries(hostConfig.apps ?? {})) {
    const envKey = `LOUPE_${name.replace(/-/g, '_').toUpperCase()}_BASE`;
    const b = process.env[envKey] ?? base;
    try {
      const res = await fetch(`${b}/loupe/app`, { signal: AbortSignal.timeout(800) });
      if (res.ok) {
        const descriptor = await res.json();
        if (Array.isArray(descriptor.verbs)) LIVE[name] = { verbs: descriptor.verbs, base: b };
      }
    } catch {
      // app not running — inline manifest fallback
    }
  }
} catch {
  // no host config — inline manifests only
}

// ---------------------------------------------------------------- key parity
//
// "Verbs carry their keys" (docs/authoring-fabrials.md §Style rules) is a rule
// no schema enforces: a Button may print `keyHint: "W"` with nothing bound, and
// Hotkeys may bind a key no button advertises. Both are silent, and both were
// live in this repo. Every key a fabrial PRINTS must be a key it BINDS, and
// every non-arrow key it binds must be one it prints.
//
// Printed and bound spellings differ by design — a button prints `⇧B` where
// Hotkeys binds `shift+b` — so both sides normalise before comparison.
const KEY_SYMBOLS = [
  ['⇧', 'shift+'],
  ['⌘', 'meta+'],
  ['⌥', 'alt+'],
  ['⌃', 'ctrl+'],
];
const KEY_ALIASES = { esc: 'escape', return: 'enter', '⏎': 'enter', spacebar: 'space' };

function normaliseKey(k) {
  let out = String(k).trim().toLowerCase().replace(/\s+/g, '');
  for (const [symbol, word] of KEY_SYMBOLS) out = out.split(symbol).join(word);
  return KEY_ALIASES[out] ?? out;
}

// Arrows are printed once as a legend ("↑↓ move"), never as a per-verb hint,
// so they are bound without being printed by design.
const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/**
 * Returns { issues, unchecked }. `unchecked` names the elements whose keyHint
 * is an EXPRESSION rather than a literal — a hint produced from a repeat
 * carries a bound value this check cannot resolve. Those are reported, never
 * skipped: a blind spot printed is a blind spot; a blind spot omitted reads as
 * coverage.
 */
function keyParity(fabrial) {
  const printed = new Map();
  const bound = new Map();
  const unchecked = [];
  for (const [id, el] of Object.entries(fabrial.elements ?? {})) {
    const props = el.props ?? {};
    const hints = [];
    if (el.type === 'Button' && props.keyHint !== undefined) hints.push(props.keyHint);
    if (el.type === 'VerbBar' && Array.isArray(props.actions)) {
      for (const a of props.actions) if (a?.keyHint !== undefined) hints.push(a.keyHint);
    }
    for (const hint of hints) {
      if (typeof hint === 'string') printed.set(normaliseKey(hint), id);
      else unchecked.push(id);
    }
    if (el.type === 'Hotkeys' && Array.isArray(props.keys)) {
      for (const k of props.keys) if (typeof k?.key === 'string') bound.set(normaliseKey(k.key), id);
    }
  }
  const issues = [];
  // A literal hint with no binding is unambiguous: the key is printed and dead.
  for (const [key, id] of printed) {
    if (!bound.has(key)) {
      issues.push({ code: 'key-hint-unbound', elementId: id, message: `prints key "${key}" that no Hotkeys entry binds` });
    }
  }
  // The other direction is only conclusive when every hint in the fabrial was
  // literal. A bound key with no literal hint may still be printed by a repeat
  // whose keyHint this check cannot resolve — reporting that as a failure would
  // make the rule unsatisfiable for a repeated picker (a drop-reason list, say).
  // So it degrades to a named blind spot rather than a false verdict.
  const unmatchedBinds = [];
  for (const [key, id] of bound) {
    if (ARROW_KEYS.has(key)) continue;
    if (printed.has(key)) continue;
    if (unchecked.length > 0) unmatchedBinds.push(key);
    else issues.push({ code: 'key-bound-unprinted', elementId: id, message: `binds key "${key}" that no button prints` });
  }
  return { issues, unchecked, unmatchedBinds };
}

// -------------------------------------------------------------------- runner

async function* fabrialFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.fabrial.json')) {
      yield path.join(entry.parentPath ?? entry.path, entry.name);
    }
  }
}

let failed = false;
const files = [];
for await (const f of fabrialFiles(here)) files.push(f);
files.sort();

if (files.length === 0) {
  console.error('no *.fabrial.json files found under fabrials/');
  process.exit(1);
}

// Read every document before validating: a route may target a later file.
const documents = new Map();
const inventory = Object.create(null);
for (const file of files) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    documents.set(file, { raw });
    const parsed = spec.zFabrial.safeParse(raw);
    if (parsed.success) {
      const app = parsed.data.app.name;
      const prefixed = path.relative(here, file).replace(/\\/g, '/').replace(/\.fabrial\.json$/, '');
      const prefix = `${app}/`;
      const target = prefixed.startsWith(prefix) ? prefixed.slice(prefix.length) : prefixed;
      (inventory[app] ??= []).push(target);
    }
  } catch (error) {
    documents.set(file, { error });
  }
}

for (const file of files) {
  const rel = path.relative(path.dirname(here), file);
  let issues = [];
  let uncheckedHints = [];
  let unmatchedBinds = [];
  const { raw, error } = documents.get(file);
  if (error) {
    issues = [{ code: 'bad-envelope', message: `not JSON: ${error.message}` }];
  }

  if (raw !== undefined) {
    const parsed = spec.zFabrial.safeParse(raw);
    if (!parsed.success) {
      issues = parsed.error.issues.map((i) => ({
        code: 'bad-envelope',
        message: `${i.path.join('.')}: ${i.message}`,
      }));
    } else {
      const fabrial = parsed.data;
      const live = LIVE[fabrial.app.name];
      const manifest = live?.verbs ?? MANIFESTS[fabrial.app.name];
      if (!manifest) {
        issues = [{ code: 'unknown-verb', message: `no inline manifest for app "${fabrial.app.name}"` }];
      } else {
        const result = spec.validateFabrial(fabrial, loupeStd, manifest, undefined, inventory);
        if (!result.ok) issues = result.issues;
        else {
          const parity = keyParity(fabrial);
          issues = parity.issues;
          uncheckedHints = parity.unchecked;
          unmatchedBinds = parity.unmatchedBinds;
        }
      }
    }
  }

  const source =
    raw !== undefined && LIVE[raw?.app?.name] ? `live ${LIVE[raw.app.name].base}` : 'inline manifest';
  if (issues.length) {
    failed = true;
    console.error(`FAIL ${rel} (${source})`);
    for (const i of issues) {
      console.error(`  [${i.code}] ${i.elementId ? `(${i.elementId}) ` : ''}${i.message}`);
    }
  } else {
    console.log(`ok   ${rel} (${source})`);
    if (uncheckedHints.length > 0) {
      const who = [...new Set(uncheckedHints)].join(', ');
      const keys = unmatchedBinds.length > 0 ? `; unmatched bound keys: ${unmatchedBinds.join(', ')}` : '';
      console.log(`     unchecked: ${uncheckedHints.length} key hint(s) bound, not literal (${who})${keys}`);
    }
  }
}

console.log(`mode: full · catalog ${loupeStd.name}@${loupeStd.version} · ${files.length} fabrial(s)`);
process.exit(failed ? 1 : 0);
