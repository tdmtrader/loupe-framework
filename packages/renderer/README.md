# @loupe/renderer

`<LoupeRenderer>` — mounts one validated fabrial against one `LoupeClient`.
It walks the element map, resolves expressions against the latest projection
snapshot (plus the optimistic overlay), mounts catalog impls, and translates
component events into verb dispatches. It holds no domain state — only the ui
doc (lossable view ephemera, reset on remount by design).

Semantics it reuses from `@loupe/spec` rather than reimplementing:
`resolve`, `expandRepeat`, `evaluateVisible`, `advanceCursor`,
`resolveContextItem`, `validateFabrial`.

Renderer-drawn chrome (token-styled, exported for hosts): `ErrorPanel`
(validation refusal — total, never a half-screen), `ConfirmDialog` (the
`confirm` action gate), and `ConnectionBand` (fixed overlay strip while the
client reports `reconnecting`/`gone`; a 1.5 s grace hides sub-second blips;
clients without the `connection` observable are assumed connected).

Verb flow: optional confirm → optional optimistic patch overlay (discarded on
authoritative seq, error, or 2 s timeout) → dispatch → `done.ui` on success.
Ui-doc helpers (`applyUiSet`, `setAtPointer`) and patch instantiation are
exported for tests.

Test: `pnpm --filter @loupe/renderer test`.
