# fabrials/

One JSON file per screen. A fabrial is a pure function of served state and may
mutate only through verbs (the constitutional rule — root README); its ui doc
holds lossable view ephemera only.

- `grill/board.fabrial.json` — answering an agent's grilling questions (app
  `grill`, projection `board`): a rail of questions grouped by round with the
  served round phrase, the chosen question's body and the agent's
  recommendation rendered by `ProseDoc`, cursor + keyboard flow (`context`,
  `advance`, `Hotkeys`), and a footer that answers through `question.answer`
  — take the recommendation, pick an option, or write your own in a
  `Textarea` draft held in the ui doc — or retracts through
  `question.retract`. Pins `loupe-std@2.0.0`.

**Links between screens.** A `Link` element renders a real
`<a href="#/<app>/<fabrial>">` the browser follows. It is an element, not an
action: the grammar has no navigation action and a `Link` cannot sit in an
`on.press` array. Its `href` is a `$route` expression naming a fabrial of the
same app and its params; the renderer resolves it against the instance it is
mounted under, so a second instance of the same app (another name in
`apps/host/host.config.json`) links into its own screens unchanged. A route
target must exist in that app's fabrial inventory, which `validate.mjs`
checks.

Check them all headlessly (exit 1 on any issue, no servers needed):

```
node fabrials/validate.mjs
```

It runs the full `validateFabrial(fabrial, loupeStd, manifest)` from
`@loupe/spec`. When an app is running (bases from
`apps/host/host.config.json`, overridable via `LOUPE_<APP>_BASE`) it
validates against the **live** `GET /loupe/app` descriptor; otherwise it
falls back to the inline per-app manifests in `validate.mjs`, which must not
drift from the apps.

Authoring guide: `docs/authoring-fabrials.md`. Component index:
`docs/catalog.md`. Grammar and envelope: `packages/spec/README.md` and the
generated schemas in `schema/`.
