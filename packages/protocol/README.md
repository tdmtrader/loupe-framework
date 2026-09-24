# @loupe/protocol

The wire contract, nothing else. Scaffold-frozen; both sides import it and
neither redefines it.

- **Schemas** (Zod + inferred types) for every wire shape: `zAppDescriptor`
  (`GET /loupe/app`), `zProjectionEnvelope` (`GET /loupe/state/:name`),
  `zVerbRequest`/`zVerbResult` (`POST /loupe/verbs/:name`), the WS frames
  (`zClientFrame`, `zServerFrame`), `zPatchTemplate`/`zPatchOp` (optimistic
  patch templates), `ERROR_CODES`, `PROTOCOL_VERSION`.
- **`LoupeClient`** — the transport seam the renderer consumes:
  `describe / snapshot / subscribe / dispatch`, plus the optional
  `connection` liveness observable (`ConnectionState =
  'connected' | 'reconnecting' | 'gone'`; client-local inference, nothing on
  the wire). Implementations live in `@loupe/client`; a third-party client
  implements this interface and nothing else.
- **`foldLatest`** — the single specification of fold semantics (r1f8):
  latest-wins by `at`, ties broken by lexicographic `actor`. Mechanism, not
  vocabulary: any app with an append-only log wants it. Adapters that fold
  record streams must use it (or pass its shared test vector,
  `vectors/fold.json`).
- **`zRecordFloor`** — the minimum `foldLatest` needs from a record: `at` (ISO
  string) and `actor` (string). That is the *whole* of what loupe says about
  the contents of an append-only stream; apps define their own record shapes
  on top, and name the fold identity field via `FoldKeys.id`. The protocol
  ships no domain record types — record vocabulary (findings, dispositions,
  resolutions and the like) belongs to the app, not the platform.

Test: `pnpm --filter @loupe/protocol test`.
