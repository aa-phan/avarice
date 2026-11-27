# Round 3 dispositions

Group A passed round 3 (0 BLOCKER, 0 WARNING, 3 NIT) and its documents are not edited. Group C failed with 3 WARNINGs and 2 NITs; each was checked against the code at HEAD before a document changed. Group C gets one extra round (round 4) under the owner's ruling recorded in `README.md`. Nothing is marked reviewed by this file.

## Group C

| Id | Severity | Disposition | Note |
|---|---|---|---|
| W1 | WARNING | Fixed | `doctor` compares the running Node version with the package's engines rule (`doctor.ts` `nodeSatisfies`, error "does not satisfy the engines rule"). `nodeSatisfies` judges only a rule of the form `>=x.y.z`; any other rule shape, an absent rule or a version string that does not parse returns true. `integrations.md` now says opening the ledger makes no Node version comparison, and that `doctor` is the one place that does, with that limit. |
| W2 | WARNING | Fixed | The 36-word sentence is split; the first sentence is 31 words and a second says no test checks it. |
| W3 | WARNING | Fixed | Confirmed: `retrieval-guard.ts` `beginRead` has no caller outside tests, and the two rows are created by `budget.ts` but nothing spends them. `containment.md` now says in the opening that the two have a row in the run's ledger that nothing spends (see below), matching the "created and never spent" paragraph and the Quirks line. |
| N1 | NIT | Fixed in part | `integrations.md` no longer lists the SQLite version thresholds and links to the runtime gate in `data-model.md`, which keeps the list. The same list in `config-reference.md` (group D) is not edited, to keep the group D pass valid; carried to the documentation plan's final pass. The mount rule, 5 MiB output cap and probe retry are stated where each document's own subject needs them and agree with the code; left. |
| N2 | NIT | Fixed | `integrations.md` states the Glob and Grep comment once, briefly, and links to the launch-line list in `containment.md`. |
