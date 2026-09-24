# Fabrials pin their catalog

A fabrial's envelope names the catalog and version it was authored against.
Loading fails, totally and legibly, unless the loaded catalog has the same
name, the same major, and minor/patch at or above the pin; there is never a
partial render. The alternative, best-effort rendering of unknown components,
was rejected because a half-rendered triage screen can mislead a human into
a wrong decision, which is the one failure loupe exists to prevent (stance
r1f6).
