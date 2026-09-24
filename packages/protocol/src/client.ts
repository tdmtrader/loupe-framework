import type { Json, JsonObject } from './json.ts';
import type { AppDescriptor, Params, VerbResult } from './schemas.ts';

/** Client-local liveness inference — nothing on the wire carries this. */
export type ConnectionState = 'connected' | 'reconnecting' | 'gone';

/**
 * The transport seam (§5.3/§5.5). v1 ships httpClient (fetch + ?after=seq
 * poll) and wsClient (subscribe/state frames, http fallback) in @loupe/client;
 * MCP later is a third implementation of this same interface.
 */
export interface LoupeClient {
  describe(): Promise<AppDescriptor>;
  snapshot(projection: string, params?: Params): Promise<{ seq: number; state: Json }>;
  /** WS or poll under the hood. Returns an unsubscribe function. */
  subscribe(projection: string, params: Params, cb: (seq: number, state: Json) => void): () => void;
  /**
   * The other half of subscribe (track "the agent inhabits the same state",
   * R2): every record appended to `stream` since `after`, then each one as it
   * lands, in order, with the seq the dispatch that wrote it was answered.
   * WS `record` frames or the `/loupe/records` poll twin under the hood —
   * hidden behind this seam exactly as subscribe hides its transport. A record
   * is an object (a jsonl line), and `null` is the ONE out-of-band signal in
   * its place: it says the server no longer holds what happened between the
   * cursor and `seq` (the ring overflowed), the cursor has already moved to
   * `seq`, and the caller should re-snapshot the projection it cares about
   * before trusting what comes next. Because the wire shapes refuse a null
   * record, a caller reading `record === null` as "gap" is never wrong. The
   * renderer never calls this; nothing in the fabrial dialect can reach it.
   * Returns an unsubscribe function.
   */
  records(
    stream: string,
    after: number,
    cb: (seq: number, record: JsonObject | null, stream: string) => void,
  ): () => void;
  dispatch(verb: string, params: Params): Promise<VerbResult>;
  /**
   * Optional liveness observable. cb fires immediately with the current state,
   * then on every transition. Absent (third-party/MCP clients) ⇒ the renderer
   * assumes 'connected'. Client-local inference only — no wire change.
   */
  connection?(cb: (state: ConnectionState) => void): () => void;
}
