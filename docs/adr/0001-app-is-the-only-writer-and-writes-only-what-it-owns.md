# The app is the only writer, and it writes only what it owns

An app fronting files shared with another system could have appended
wherever it was useful. We decided instead that an app's whole write surface
is one gate listing the streams it originates; every other file is opened
read-only, with no exception. The alternative, ad hoc appends where they are
convenient, was rejected because two writers with different ideas of a file's
shape is how shared data silently corrupts. The gate is one list per app
(`OWNED_STREAMS`, e.g. `apps/grill/src/streams.ts`) in front of its single
append function.
