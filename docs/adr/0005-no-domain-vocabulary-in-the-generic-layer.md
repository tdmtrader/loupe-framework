# No domain vocabulary in the generic layer

The protocol, spec, catalog and renderer packages carry only mechanism: the
append-record floor (`at`, `actor`), the fold, the expression grammar, the
component set. Words such as finding, disposition, ticket or question live in
the app that owns them. We rejected sharing convenient domain types through
the protocol package because loupe is a platform the shipped apps merely
exercise; the moment a domain word enters the generic layer, every other app
inherits it (stance r3f1).
