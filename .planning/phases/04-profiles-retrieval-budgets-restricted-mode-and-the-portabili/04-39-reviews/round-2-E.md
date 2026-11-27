# Round 2, group E review

Documents reviewed (sha256 at review time):

- docs/system/indexes-and-context.md f2f42953db3ff671fbd9005a08bec4506373ef5a202bac9a8de48cf7bf277c0c
- docs/system/onboarding.md 61c29ca5212cf325600cdc95f0b612ef8e614e4a4a5d996c3062f431589af3d3
- docs/system/runs.md b08aac78036381980c91cea55ec011185c044ca352f6b0d6bd4f81dafdc30441
- docs/system/checks-and-evidence.md 27757927e700c6f0ae0f0a0a75f79eeea3f91e8ff302bf2ed87d6e5f6cd85c90
- docs/system/processes.md d73dedef1ea3ad06457bb0d86861c89028e28f4f1e572cba1b724d573da46f15

Severity: BLOCKER (a claim the code contradicts, or a hard-rule breach), WARNING (likely rework), NIT (polish).

## Round-1 findings

- 1 BLOCKER (manual evidence kinds and `external`): resolved. `src/domain/evidence.ts:11` names `mutation` as the only kind never written; `src/app/manual-inputs.ts:306` writes `independence: 'external'`; the document says so and lists manual rows under `inconclusive`.
- 2 WARNING (sentence length): resolved apart from the NITs below. A scan of running prose (links stripped, code fences and table rows excluded) finds only the module-list openings and NITs 1 to 3.
- 3 WARNING (corpus formula duplicated): resolved. onboarding.md links to indexes-and-context.md#the-cost-cap; the constants and the 9, 15 and 23 chunk limits match `src/domain/knowledge-corpus.ts:176` (recomputed).
- 4 WARNING (`ContextSource.refresh` in prose): resolved; the name no longer appears in the five documents.
- 5 NIT (four cases): resolved. processes.md step 9 names four cases and points to runs.md for the fifth; the reasons match `src/app/run-stages/item.ts` (session-gone, crashed, unpark-conflict, park-missing, interrupted).
- 6 NIT (drift anchor column): resolved. A sentence under the table states what the anchor is for, and every listed source path exists.

## Findings

### 1. NIT, onboarding.md line 245 (project record contents)
Claim: one sentence of about 140 words enumerates the record. Evidence: a reference list inside one colon sentence, which the reference-list carve-out allows; the author deferred it. Fix: a bullet list would read better; optional.

### 2. NIT, processes.md line 134 (privileged action, step 2)
Claim: "For a privileged form in a run, the hook writes an approval request (or names the one still waiting) and the denial in one transaction, and tells the agent ..." is 37 words, two over the cap. Fix: split before "and tells the agent".

### 3. NIT, onboarding.md line 289 (a list item)
Claim: "A user-edited or unknown-format map is regenerated in staging ... the final outcome waits for GSD's drift check in staging." is 36 words. Fix: split at the semicolon.

## Verified and deliberately not flagged

Checked against the code at HEAD, all matching: install timeout 15 minutes and lockfile cap 32 MiB (`src/app/checks.ts:388`); validation reasons and the 20 path and 10 host caps (`src/app/check-validation.ts:52`); evidence kinds and independence values; the restricted run stage (three artifacts, 256 KiB cap, `src/app/run-stages/restricted.ts:36`); the context pack cap of 8192 tokens and the 32 KiB prompt (`src/app/run-gsd-config.ts:53`, consistent with config-reference.md); onboarding subagent derivation (`src/domain/onboarding-contract.ts`; defaults 12/6, 2/6, 0/3 recomputed); the knowledge cost model and chunk limits; the resume fallback reasons; the nine diagram sources and the drift-anchor paths exist.
Mechanical sweep: no em dash, en dash or ` -- `; no phase, plan, threat, ticket or SHA text in prose; no function or method names in prose; no question headings; module paths only in the openings and the diagram index (explained under the table). The long Launch prompt paragraph of runs.md and the freshness table of indexes-and-context.md were sampled, not read against every line of code.
Read-only: no tracked file changed; this report is the only file written.

Verdict: PASS
