// @loupe/protocol — the wire contract, nothing else. Scaffold-frozen.
export { PROTOCOL_VERSION } from './version.ts';
export { zJson, zJsonObject, zJsonSchema } from './json.ts';
export type { Json, JsonObject, JsonSchema } from './json.ts';
export {
  zParams,
  zSeq,
  zPatchOp,
  zPatchTemplate,
  zAppInfo,
  zProjectionDecl,
  zVerbDecl,
  zCapabilities,
  zAppDescriptor,
  zProjectionEnvelope,
  zRecordsEnvelope,
  zProjectionSubFrame,
  zStreamSubFrame,
  zSubFrame,
  zProjectionUnsubFrame,
  zStreamUnsubFrame,
  zUnsubFrame,
  zClientFrame,
  zStateFrame,
  zPatchFrame,
  zRecordFrame,
  zServerFrame,
  zVerbRequest,
  zWrittenRecord,
  zVerbOk,
  zVerbError,
  zVerbResult,
  zRecordFloor,
  ERROR_CODES,
} from './schemas.ts';
export type {
  Params,
  PatchOp,
  PatchTemplate,
  AppInfo,
  ProjectionDecl,
  VerbDecl,
  Capabilities,
  AppDescriptor,
  ProjectionEnvelope,
  RecordsEnvelope,
  ClientFrame,
  RecordFrame,
  ServerFrame,
  VerbRequest,
  WrittenRecord,
  VerbOk,
  VerbError,
  VerbResult,
  ProtocolErrorCode,
  RecordFloor,
} from './schemas.ts';
export type { LoupeClient, ConnectionState } from './client.ts';
export { foldLatest } from './fold.ts';
export type { FoldKeys } from './fold.ts';
export {
  protocolJsonSchemas,
  appDescriptorJsonSchema,
  verbDeclJsonSchema,
} from './json-schemas.ts';
