// @loupe/spec — the fabrial dialect. Scaffold-frozen barrel:
// - ./model is the frozen interface (envelope/element/expression/action
//   schemas, catalog defs, issue codes, shared types) — integration-owner-only.
// - ./engine is the shipped implementation (validate/resolve/helpers/emit);
//   it may add exports to ./engine/index.ts without touching this file.
export * from './model/index.ts';
export * from './engine/index.ts';
