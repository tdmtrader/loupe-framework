# The catalog exposes semantic tones only

Every colour-ish component prop is a token name from a closed enum (tone,
accent, tier, bg), never hex, and never a domain grading such as severity.
Mapping severity to tone is the app's job, done in its projection. We
rejected letting components understand grading vocabularies because it would
smuggle domain words into the catalog and let a fabrial compute what the
projection should have served (stance r3f2).
