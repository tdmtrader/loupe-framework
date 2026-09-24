# No session object

Everything durable is keyed by app-domain keys and folded server-side into
projections; cursor, pane and drafts are ui-doc ephemera and never cross the
wire. We rejected a server-side session because a second copy of view state
beside the projection is exactly the derivation-drift the constitution
forbids (stance r1f3).
