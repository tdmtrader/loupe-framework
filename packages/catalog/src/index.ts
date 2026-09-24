// @loupe/catalog root barrel (scaffold-frozen): the catalog DEFS only.
// React impls are the separate "@loupe/catalog/react" entry so that nothing
// outside packages/catalog and apps/host pulls React by importing defs.
export * from './defs/index.ts';
