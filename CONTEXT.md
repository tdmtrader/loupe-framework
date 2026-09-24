# Loupe

Screens as persisted, validated specs over apps that own all state. Loupe is
decoupled from the domains that use it: an app such as the shipped grill
example is a use of loupe, not part of it, and its words (question, answer,
round) do not belong here. This glossary is the vocabulary to hold before
authoring a fabrial or an app.

The invariant every term serves: a fabrial is a pure function of served
state and may mutate only through verbs. A bad fabrial renders wrong; it
cannot lose anything.

## Language

**Fabrial**:
One screen as one persisted, versioned JSON spec: a flat map of catalog elements
whose props are literals or expressions over a projection. A pure function of
served state; it mutates only through verbs.
_Avoid_: screen, UI, view, widget, page

**App**:
A server process that owns all domain state and speaks the wire contract. The
thing a user interacts with through a fabrial, and the only writer.
_Avoid_: backend, service, server

**Instance**:
One app over one store at one base URL, named by its entrypoint.
_Avoid_: deployment, environment, tenant

**Route**:
A `$route` expression naming a fabrial of the same app and its params,
resolved by the renderer against the mounting instance.
_Avoid_: link, href, URL

**Adapter**:
The part of an app that speaks to another system: reading its files or API
into the store, and writing back only what the app owns. An adapter is inside
an app, never an app itself.
_Avoid_: bridge, connector, integration

**Projection**:
A named, pure fold over an app's store, served under a monotonic `seq`. Every
derivation a screen shows is pre-composed here.
_Avoid_: state, read-model, view-model

**Snapshot**:
One projection as served at one `seq`.
_Avoid_: state

**Verb**:
A named action with schema'd params, declared by an app. The only path by
which state changes.
_Avoid_: action, command, mutation, endpoint

**Record**:
One appended fact, stamped with its actor and time. Records are never edited
or deleted; an undo is itself a record.
_Avoid_: event, entry, row

**Stream**:
A named append-only sequence of records that an app owns.
_Avoid_: log, file, table

**Store**:
Everything an app derives projections from. Verbs append to it; projections
fold it.
_Avoid_: database, model

**Element**:
One entry in a fabrial's map: an instance of a component with props.
_Avoid_: node, widget, control

**Component**:
A catalog definition an element instantiates: its props, events and slots.
_Avoid_: widget, control

**Catalog**:
The fixed, versioned set of components a fabrial pins.
_Avoid_: component library, design system

**Wire contract**:
The HTTP/WS surface every app implements: descriptor, projections, verbs, and
optional push. The contract is the platform; the serving helper is not.
_Avoid_: protocol, port, API

**Descriptor**:
What an app declares about itself: its name, its projections, and its verb
manifest.
_Avoid_: manifest (alone), metadata, config

**Verb manifest**:
The part of a descriptor a fabrial is validated against: each verb's name and
the schema of its params.
_Avoid_: API surface, verb list

**Seq**:
The monotonic version an app stamps on every projection change and record. A
subscription starts after one.
_Avoid_: version, revision, cursor

**Ui doc**:
The one client-local document for lossable view ephemera (cursor, open
panels, unsent drafts), reset on reload by design. If losing it would matter,
it is not ui doc.
_Avoid_: ui state, client state, local state

**Renderer**:
The thing that turns a fabrial plus a snapshot into a screen and translates
component events into verb dispatches. Holds no state but the ui doc.
_Avoid_: client, frontend, shell

**Chrome**:
What the renderer draws that no fabrial asked for: the error panel, the
confirm dialog, the connection band.
_Avoid_: shell, frame, overlay

**Theme**:
The token set a catalog renders under. The contract between a catalog and
its look; components name tokens, never colours.
_Avoid_: skin, palette, stylesheet

**Token**:
A named design value. A theme gives it a concrete value, a component names
it, and a fabrial never sees the value.
_Avoid_: variable, colour, CSS custom property

**Bind**:
A JSON Pointer from an element prop into the projection.
_Avoid_: selector, path, reference

**Advance**:
The renderer-computed cursor move along a served list. The one action that is
not a verb.
_Avoid_: navigate, step

**Actor**:
The identity stamped on a record.
_Avoid_: user, author, agent

**Subscription**:
A held await over one or more streams, returning when a record lands.
_Avoid_: watch, poll, listener
