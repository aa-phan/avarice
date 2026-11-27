# Round 4 dispositions

Group C failed round 4 with 1 WARNING and 2 NITs. The owner ruled "close drafted" (2026-11-22, see `README.md`): the findings are fixed against the code at HEAD, and the three documents are not marked reviewed. Nothing is marked reviewed by this file. Groups A, B, D and E passed and are not edited.

## Group C

| Id | Severity | Disposition | Note |
|---|---|---|---|
| W1 | WARNING | Fixed | Confirmed in `claude-host.ts`: the session ID is `resumeSessionId ?? sessionId ?? randomUUID()`, and a non-UUID value is refused as `invalid` (field `sessionId`, or `resumeSessionId` for a resume). A UUID is generated only when the caller gives none. `integrations.md` now says a caller-supplied ID must be a UUID or is refused as invalid, and that the adapter generates one only when none is given. This matches "Session ID" in `containment.md`. |
| N1 | NIT | Fixed | Confirmed in `invocation-scope.ts`: the intel purpose adds `intel patch-meta`, `intel validate` and `intel snapshot`; `intel validate` writes nothing, as the verb table in `integrations.md` says. The scopes table row in `containment.md` now reads "plus three intel GSD verbs". |
| N2 | NIT | Fixed | Confirmed in `runtime-support.ts`: a major below 3, or a 3.x line with no fixed patch or a patch below it, is `unsupported`; only 3.44.6 and later on the 3.44 line pass, so anything older than 3.44.6 is refused. The runtime gate in `data-model.md` now says so. |

The three edited documents have not been seen by a fresh reviewer after these fixes. They return to `drafted`-after-review state: `coverage.md` lists them as changed after review.
