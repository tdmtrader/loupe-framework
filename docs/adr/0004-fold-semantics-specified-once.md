# Fold semantics are specified exactly once

Latest-wins folding over append-only records is defined once in the protocol
package: latest by `at`, ties broken by lexicographic `actor`, with a shared
test vector every app must pass. Each app defining its own fold was rejected
because two folds over the same stream drift, and the drift is invisible
until two screens disagree (stance r1f8).
