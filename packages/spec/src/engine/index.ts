// Engine barrel — renderer-spec lane owns this directory and may extend it;
// these four exports are the frozen minimum (shared types in ../model).
export { resolve } from './resolve.ts';
export { expandRepeat, evaluateCondition, evaluateVisible } from './helpers.ts';
export type { RepeatItem } from './helpers.ts';
export { advanceCursor, resolveContextItem } from './helpers.ts';
export type { ContextHit } from './helpers.ts';
export { validateFabrial } from './validate-fabrial.ts';
export { emitJsonSchemas } from './emit-json-schemas.ts';

// Lane additions (renderer + CLI reuse; not part of the frozen minimum).
export { getPointer, getAtTokens, pointerTokens, isAbsolutePointer } from './pointer.ts';
export { validateFabrialPartial } from './validate-fabrial.ts';
export { isPlainObject, unwrapField } from './util.ts';
export { fabrialJsonSchema } from './emit-json-schemas.ts';
