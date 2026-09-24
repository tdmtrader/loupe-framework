# loupe-std@1.4.0 — component index

The one catalog fabrials pin. Defs (Zod prop schemas + declared events/slots)
live in `packages/catalog/src/defs/`; React impls in
`packages/catalog/src/react/`. The Zod schemas are the source of truth for
prop shapes — this index names them; read the def for constraints.

Every color-ish prop takes a **token name** from a closed enum (`tone`,
`accent`, `tier`, `bg`), never hex; components resolve tone triads
internally. `1.0.0 → 1.1.0`: additive `scrollIntoView` on the Stack/Row box
channel. `1.1.0 → 1.2.0`: additive `grow` on the
box channel and on `Grid`/`ScrollArea`. `1.2.0 → 1.3.0`: additive `ProseDoc`,
a reading surface with its own measure. `1.3.0 → 1.4.0`: additive `Link` (an
in-app `<a href>` to another fabrial) and additive `outline`/`anchor` on
`ProseDoc`.

## Primitives (`defs/primitives.ts`)

| Component | Props | Events | Notes |
|---|---|---|---|
| `Text` | `text, tier, size, weight, tone, upper, strike` | — | General text on the seven-tier gray ramp |
| `MicroLabel` | `text, tracking, tone` | — | 10px/700 uppercase micro-label; uppercase is the transform, not the text |
| `Prose` | `text, maxCh, tier, strike` | — | 12/400, lh 1.6–1.7, ch-capped measure (default 68ch) |
| `Badge` | `label, tone, filled` | — | Tri-tone badge; triads resolved internally |
| `Button` | `label, variant, keyHint, disabled, flex` | `press` | Verb button; `danger` is ghost-red, never filled; `keyHint` prints dim in the label |
| `Chip` | `label, active, tone` | `press` | Inverted-when-active toggle (tabs, scope chips, sev pickers) |
| `Numeral` | `value, label, color` | — | 24/900 stat + 11/400 phrase — every number is a sentence |
| `Pip` | `state, size, hollow` | — | 10×10 / 12×12 square progress/agent pip |
| `Divider` | — | — | Vertical 1px hairline |
| `MetaRow` | `parts` | — | Parts joined by `·` separators in muted |
| `Digest` | `value, pairWith` | — | Person-blue sha text; `pairWith` renders the `a → b` pair form |
| `Link` | `href, label, tone` | — | In-app `<a href>` to another fabrial (≥ 1.4.0). `href` is a literal `#/…`, a `$bind` or a `$ui` — the validator refuses any other literal and any `$template`; the impl renders a plain label and no anchor for a runtime href not beginning `#/` |
| `Textarea` | `bindUi, placeholder, borderTone, minHeight` | — | Draft input bound to a ui-doc path; committing is always a verb |

## Layout (`defs/layout.ts`)

Stack and Row share the **box channel**: `gap, align, pad, bg, borders,
accent, accentWidth, accentEdge, opacity, scrollIntoView, grow`. Both are
pressable
— they intercept clicks only when the fabrial binds `press`, so clicks on
decorative inner boxes bubble to the enclosing pressable element.
`scrollIntoView` scrolls the element into view on the rising edge only
(false→true, block `nearest`) — bind the cursor condition to it (≥ 1.1.0).
`grow` claims the remaining main-axis space of a flex parent and resets
`min-height`/`min-width` to 0, so a rail inside scrolls instead of pushing
the page taller (≥ 1.2.0); it is also accepted by `Grid` and `ScrollArea`.

| Component | Props | Events / slots | Notes |
|---|---|---|---|
| `Stack` | box channel + `direction` | `press` | Flex container, default column |
| `Row` | box channel | `press` | Horizontal flex row (cursor rows, cards) |
| `Grid` | `template, gap, cellBorders, bg, grow` | — | CSS grid with a raw template string |
| `Panel` | `title, note, bg, footnote` | — | Titled panel; title renders as MicroLabel; footnote is teaching prose |
| `Band` | `pad` | — | Raised full-width strip with a bottom hairline |
| `InsetHeader` | `label, right` | — | Full-bleed micro-label row on bg.inset |
| `SidePanel` | — | slot `footer` | Left/right rail on bg.panel, scrollable body |
| `StickyFooter` | `note, noteTone` | slot `actions` | Raised sticky footer: status note + actions |
| `Spacer` | — | — | Flex spacer |
| `ScrollArea` | `axis, grow` | — | Single-axis scroll container |

## Interactive (`defs/interactive.ts`)

| Component | Props | Events / slots | Notes |
|---|---|---|---|
| `Board` | `lanes, columns, openCardId, laneOrderVerb, cardMoveVerb` | events `cardMove, laneMove`; itemSlots `laneHeader, card, laneOpen` | Owns the HTML5 drag lifecycle and nothing else; drop emits one semantic event, no client reordering — authoritative order returns via projection |
| `VerbBar` | `label, actions` | `eventsFrom: actions[].event` | Co-located verb row; buttons print their keyHints; `actions` must be a literal array |
| `Hotkeys` | `keys` | `eventsFrom: keys[].key` | Renders nothing; emits each key as an event (`"shift+b"` syntax); `when` is a fabrial-authored Condition; suspended while an input has focus; `keys` must be a literal array |

## Visual (`defs/visual.ts`)

| Component | Props | Events / slots | Notes |
|---|---|---|---|
| `RouteGraph` | `nodes, edges, terminals, size, selectedId, annotations` | event `nodeSelect`; itemSlot `node` (scope `{node, terminal, selected}`) | Absolute node layer over one SVG bezier-edge layer; positions come from the projection, no auto-layout |
| `DiffBlock` | `file, lines, notes, composeAt, maxLines` | event `linePress {file, line, side}`; itemSlots `note` (scope `{note}`), `compose` | 56px/22px/1fr diff grid, colored from the diff token septet; interleaves matching notes after their anchor lines |
| `ProseDoc` | `blocks, maxCh, outline, anchor` | — | A reading surface for a parsed document: takes the projection's block array and styles it from the token ramp. Measure 72–96ch, its own — `Prose` stays 62–76ch. Inline code is distinguished by ground, never by font (one typeface). `outline` is the served `{id,label,tier}` heading map (≥ 1.4.0) — the component renders no outline itself; `anchor` scrolls the matching heading into view on a rising edge |
| `OverlaySheet` | `open, width, side` | event `dismiss` | Scrim + portal-mounted fixed right sheet (560px, radius 0, no shadow); scrim click and Escape emit `dismiss` |

## Event declaration rules

`on` keys are validated against the entry's static `events` list, or against
`eventsFrom: {prop, field}` — in which case that prop must be a **literal**
array in the fabrial. Any element may carry `children`; `slots` and
`itemSlots` names must be declared by the entry. itemSlot scopes are declared
as Zod schemas in the def and become the relative-pointer scope of the slot
subtree.
