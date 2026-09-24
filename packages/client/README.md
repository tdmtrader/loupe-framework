# @loupe/client

`LoupeClient` transports (the seam is defined in `@loupe/protocol`).

- **`httpClient(base, {pollMs?})`** — fetch + `?after=seq` polling.
- **`wsClient(base, {pollMs?})`** — WS subscribe/state frames with automatic
  http-poll fallback and backed-off WS retry (min(500·2^n, 8000) ms ± 20%
  jitter). While a socket is live the poll stops; re-sending `sub` on every
  reopen is the resync (the server answers with a full state frame).

Both implement the optional `connection` observable: liveness inferred from
the subscribe path only (`connected → reconnecting` on failure, `gone` after
30 s of non-contact, back to `connected` on any server answer). Initial state
is optimistically `connected`; the renderer's connection band consumes this.

Test: `pnpm --filter @loupe/client test`.
