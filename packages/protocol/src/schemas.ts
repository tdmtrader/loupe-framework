// The wire contract, §5 of the design doc. Zod schemas + inferred types.
// Everything an app must speak lives here; vectors/*.json are the executable
// conformance suite both sides round-trip.
import { z } from 'zod';
import { zJson, zJsonObject, zJsonSchema } from './json.ts';

/** Params for a projection fetch / verb dispatch: a JSON object. */
export const zParams = zJsonObject;
export type Params = z.infer<typeof zParams>;

/** Per-projection(+params) monotonic sequence number. */
export const zSeq = z.number().int().nonnegative();

// ---------------------------------------------------------------- RFC 6902

export const zPatchOp = z.strictObject({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string(),
  value: zJson.optional(),
  from: z.string().optional(),
});
export type PatchOp = z.infer<typeof zPatchOp>;

/**
 * A JSON Patch op template for verb `optimistic` declarations: identical in
 * shape to PatchOp, but string values (including `path`) may contain
 * `${params.x}` placeholders the client substitutes with dispatch params.
 */
export const zPatchTemplate = zPatchOp;
export type PatchTemplate = PatchOp;

// ------------------------------------------------------------ app descriptor

export const zAppInfo = z.strictObject({
  name: z.string(),
  version: z.string(),
});
export type AppInfo = z.infer<typeof zAppInfo>;

export const zProjectionDecl = z.strictObject({
  name: z.string(),
  /** Names of accepted query params (e.g. review takes ticketId). */
  params: z.array(z.string()).optional(),
});
export type ProjectionDecl = z.infer<typeof zProjectionDecl>;

export const zVerbDecl = z.strictObject({
  /** e.g. "finding.decide" */
  name: z.string(),
  description: z.string().optional(),
  /** Published as wire JSON Schema (draft 2020-12; MCP-ready). */
  params: zJsonSchema,
  /** App-declared optimistic overlay patches (never fabrial-invented). */
  optimistic: z.array(zPatchTemplate).optional(),
  /** Append-only streams this verb writes. */
  records: z.array(z.strictObject({ stream: z.string() })).optional(),
});
export type VerbDecl = z.infer<typeof zVerbDecl>;

export const zCapabilities = z.looseObject({
  ws: z.boolean(),
});
export type Capabilities = z.infer<typeof zCapabilities>;

/** GET /loupe/app */
export const zAppDescriptor = z.strictObject({
  protocol: z.number().int().positive(),
  app: zAppInfo,
  projections: z.array(zProjectionDecl),
  verbs: z.array(zVerbDecl),
  capabilities: zCapabilities,
});
export type AppDescriptor = z.infer<typeof zAppDescriptor>;

// ------------------------------------------------------- projection envelope

/** GET /loupe/state/:projection[?params][&after=seq] (200; 304 until seq advances) */
export const zProjectionEnvelope = z.strictObject({
  projection: z.string(),
  seq: zSeq,
  state: zJson,
});
export type ProjectionEnvelope = z.infer<typeof zProjectionEnvelope>;

// ---------------------------------------------------------- records envelope

/**
 * GET /loupe/records/:stream?after=seq — the poll twin of the `record` frame
 * (track "the agent inhabits the same state", R1). `records` are the ones
 * appended since `after`, each with the seq it was stamped with, and `seq` is
 * the server's head at the moment of answering: the next `after`. The server
 * keeps a bounded in-process ring per stream, so an `after` older than what
 * the ring still holds answers 410 with the same shape — `records` empty and
 * `note` saying which seq is the oldest still held — and the caller
 * re-snapshots. The ring is a wake-up channel, not a second log: the files
 * are the history, and a restart empties it by design.
 *
 * Each `record` is a JSON OBJECT, never a bare scalar and never null: a record
 * is a line of a .jsonl stream, the append-record floor below reads two named
 * fields off it, and `null` is spoken for — it is the client's re-snapshot
 * signal (see LoupeClient.records), so an app that could put a null on the
 * wire could make its own append look like a gap.
 */
export const zRecordsEnvelope = z.strictObject({
  stream: z.string(),
  seq: zSeq,
  records: z.array(z.strictObject({ seq: zSeq, record: zJsonObject })),
  /** Served only beside an empty `records` that is empty for a reason (410). */
  note: z.string().optional(),
});
export type RecordsEnvelope = z.infer<typeof zRecordsEnvelope>;

// ----------------------------------------------------------------- WS frames

/**
 * A `sub` (and its `unsub`) names EITHER a projection, with the params that
 * key it, OR a stream — never both. Two strict shapes in a union are how the
 * schema says so: a frame carrying both keys matches neither and is dropped
 * like any other bad frame. A projection subscription is answered with a
 * `state` frame and re-pushed on every change; a stream subscription is
 * answered with nothing and then receives a `record` frame for every record
 * a verb appends to that stream (track "the agent inhabits the same state",
 * R1). Two shapes share one `t`, which zod's discriminated union refuses, so
 * these are plain unions.
 */
export const zProjectionSubFrame = z.strictObject({
  t: z.literal('sub'),
  projection: z.string(),
  params: zParams.optional(),
});
export const zStreamSubFrame = z.strictObject({
  t: z.literal('sub'),
  stream: z.string(),
});
export const zSubFrame = z.union([zProjectionSubFrame, zStreamSubFrame]);
export const zProjectionUnsubFrame = z.strictObject({
  t: z.literal('unsub'),
  projection: z.string(),
  params: zParams.optional(),
});
export const zStreamUnsubFrame = z.strictObject({
  t: z.literal('unsub'),
  stream: z.string(),
});
export const zUnsubFrame = z.union([zProjectionUnsubFrame, zStreamUnsubFrame]);
/** client → server */
export const zClientFrame = z.union([zSubFrame, zUnsubFrame]);
export type ClientFrame = z.infer<typeof zClientFrame>;

export const zStateFrame = z.strictObject({
  t: z.literal('state'),
  projection: z.string(),
  seq: zSeq,
  state: zJson,
  params: zParams.optional(),
});
export const zPatchFrame = z.strictObject({
  t: z.literal('patch'),
  projection: z.string(),
  seq: zSeq,
  patch: z.array(zPatchOp),
  params: zParams.optional(),
});
/**
 * One record a verb appended, pushed to every socket subscribed to its
 * stream. Emitted on the verb path AFTER the snapshots that dispatch caused
 * and stamped with the same post-execution `seq` the dispatcher is answered,
 * so a record frame and the state frame it caused are ordered and comparable
 * — and two records from one dispatch share a seq. `record` is whatever the
 * app wrote, so long as it is an object (the append-record floor below is the
 * only other thing loupe says about it; `zRecordsEnvelope` above says why the
 * object is not negotiable). Additive under PROTOCOL_VERSION 1: it reaches
 * only a socket that sent `{t: 'sub', stream}`, and a client that did not ask
 * never parses one.
 */
export const zRecordFrame = z.strictObject({
  t: z.literal('record'),
  stream: z.string(),
  record: zJsonObject,
  seq: zSeq,
});
export type RecordFrame = z.infer<typeof zRecordFrame>;
/**
 * server → client. Servers MAY always send full `state` frames — a snapshot is
 * a root-replace patch; @loupe/serve does snapshot-only by default. A client
 * detecting a seq gap re-requests full state. Errors never drop the socket.
 */
export const zServerFrame = z.discriminatedUnion('t', [zStateFrame, zPatchFrame, zRecordFrame]);
export type ServerFrame = z.infer<typeof zServerFrame>;

// -------------------------------------------------------------- verb dispatch

/** POST /loupe/verbs/:verb request body. */
export const zVerbRequest = z.strictObject({
  params: zParams,
});
export type VerbRequest = z.infer<typeof zVerbRequest>;

/**
 * An outcome record: what the verb appended, and where. The same object-only
 * `record` the frame and the poll twin carry — this is where a record enters
 * the harness, so it is the earliest place to say a record is a jsonl line.
 */
export const zWrittenRecord = z.strictObject({
  stream: z.string(),
  record: zJsonObject,
});
export type WrittenRecord = z.infer<typeof zWrittenRecord>;

export const zVerbOk = z.strictObject({
  ok: z.literal(true),
  seq: zSeq,
  records: z.array(zWrittenRecord),
});
export type VerbOk = z.infer<typeof zVerbOk>;

export const zVerbError = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    /** Machine code — see ERROR_CODES for the protocol-level set; apps add domain codes. */
    code: z.string(),
    message: z.string(),
  }),
});
export type VerbError = z.infer<typeof zVerbError>;

export const zVerbResult = z.union([zVerbOk, zVerbError]);
export type VerbResult = z.infer<typeof zVerbResult>;

/**
 * Protocol-level error codes (HTTP 400/404/409/500 family). Apps may answer
 * with their own domain codes (e.g. "unknown_finding") — the set is open.
 */
export const ERROR_CODES = {
  unknownProjection: 'unknown_projection',
  unknownVerb: 'unknown_verb',
  invalidParams: 'invalid_params',
  conflict: 'conflict',
  internal: 'internal',
  notImplemented: 'not_implemented',
} as const;
export type ProtocolErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ------------------------------------------------------- append-record floor

/**
 * The append-record floor: the *minimum* `foldLatest` needs, and the only
 * thing loupe says about the contents of an append-only stream.
 *
 * A record carries `at` (an ISO-8601 timestamp string — UTC, so it sorts
 * lexicographically) and `actor` (a string; the fold's tiebreak on equal
 * `at`). Everything above the floor is the app's payload: loupe defines no
 * record types of its own, so apps define their own record shapes on top of
 * this one, including whichever field carries the fold identity (named per
 * fold via `FoldKeys.id`).
 *
 * Deliberately loose, not strict: the floor is a lower bound on a record,
 * never the whole of one. `FoldKeys` exists because an app may spell these
 * two fields differently; `at`/`actor` are the floor's canonical names.
 */
export const zRecordFloor = z.looseObject({
  at: z.string(),
  actor: z.string(),
});
export type RecordFloor = z.infer<typeof zRecordFloor>;
