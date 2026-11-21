# Plan 04-39 documentation review records

Plan base commit: `9268945` (HEAD when this plan began; the code does not change in this plan).
Diff base for the phase: `9836e22` (`git merge-base main HEAD`). The documents under review are `git diff 9836e22 -- docs/system`: four new documents (`profiles-and-credentials.md`, `policy-and-approvals.md`, `doctor.md`, `portability.md`) and the twelve existing documents the phase changed, with one new diagram source (`approve-privileged-action.puml`) read with `processes.md`.

## Preparation before the reviews

- `findings.md`: 18 lines added under "Proposal drift" and 1 closed limit line under "From containment", one for every code-versus-proposal difference the phase decided or found: the AC-8 baseline, the evaluation arms, the graph refresh without `graphify update`, the effective pack budget, transcript retention, the concurrent checks default, the event table degradation, artifact eviction, the restricted launch line and end state, derived record incompatibility, the doctor sample output, planning initialization, the missing `export` command, the enforcer vocabulary, adopted provenance and the fixed `files.read`, the scoped map's reads, and `git-files` against `Workspace.search`. Lines the earlier plans had logged were not repeated (the context ceiling above the run prompt, the missing evaluation harness document, the policy and approval lines).
- `findings.md`: 9 older lines closed with "No longer holds at <commit>" and the line that now holds: `profile-paths.ts:91`, `onboarding-contract.ts:128`, `preflight.ts:50`, `mapping.ts:56`, the two `claude-host.ts` transcript lines, `docs/containment.md:148`, and the two adoption lines (`project-record.ts:198`, `activate.ts:209`) that the same change resolved. `profile-paths.ts:90` and `claude-host.ts:244` (the `question` line) were already closed and were re-checked against the current code. The moved-root limit had no line; its closure is recorded beside the containment lines.
- `README.md`: both tables list the four new documents and ADR-014 and ADR-015; the `processes.md` row counts nine flows; the `extensions.md` row names `doctor.md` for version compatibility.
- Worklist rows `deferred 04-39` and `logged` for findings are `closed 04-39` (17 rows, plus row 45 for the README). Rows 2, 18, 51, 114, 145 and 150 are counts for the coverage recount in Task 3.
- Mechanical house-rule check of the 18 documents of groups A to E (paths outside the opening, function names, phase numbers, plan and threat IDs, commit hashes, dashes, link targets and anchors): one fix, the test paths in the enforcement map's proof column of `policy-and-approvals.md`, now named in words. The remaining matches are intended: GSD and system binary paths in `integrations.md`, `containment.md`, `cli-reference.md` and `config-reference.md`, the module list of each flow in the diagram index of `processes.md`, configuration keys and JSON field names (not function names), and `--` inside quoted command lines.
- The four new documents still carry the mark "drafted, not yet reviewed" under the title. It is removed with the status change in `coverage.md`, after the group passed.

## Review groups

Fresh `technical-writer:prose-reviewer` runs are made by the orchestrator; the author of the drafts and of this preparation does not review them. Each round stores its report verbatim as `round-<n>-<group>.md` in this directory and adds a row below. A reviewer reads every claim of its documents against the code at HEAD (the code is the authority, `findings.md` is a ledger to be checked, not a source), and returns each issue as BLOCKER, WARNING or OBS under the severity mapping of `technical-writer:reviewing-technical-prose`, with a verdict per document.

| Group | Documents | Kind |
|---|---|---|
| A | `docs/system/profiles-and-credentials.md`, `docs/system/policy-and-approvals.md` | new |
| A | `docs/system/findings.md` | changed |
| B | `docs/system/doctor.md`, `docs/system/portability.md` | new |
| B | `docs/system/overview.md`, `docs/system/README.md` | changed |
| C | `docs/system/containment.md`, `docs/system/data-model.md`, `docs/system/integrations.md` | changed |
| D | `docs/system/cli-reference.md`, `docs/system/config-reference.md`, `docs/system/interactive-shell.md` | changed |
| E | `docs/system/indexes-and-context.md`, `docs/system/onboarding.md`, `docs/system/runs.md`, `docs/system/checks-and-evidence.md`, `docs/system/processes.md` with `docs/system/diagrams/approve-privileged-action.puml` | changed (diagram new) |

Round budget: at most three rounds per group, each by a fresh reviewer that has not seen the earlier rounds' reasoning. Every BLOCKER and WARNING of a round is fixed (or answered with the code evidence that shows the claim holds) before the next round, and the next round reviews the changed documents again in full. Files are named `round-1-<group>.md`, `round-2-<group>.md` and `round-3-<group>.md`. A group that is still not clean after round 3 is reported to the owner with its open items, and its documents are marked `reviewed with open items` in `coverage.md`.

Verdict rule: a group passes when its last round records no BLOCKER and no WARNING; OBS items may stay. A document is marked `reviewed` in `coverage.md` only after its group passed, with a note naming the round files. A document that changes after a passing round (a fix for another group's finding, a later edit) returns to `drafted` until a fresh reviewer has checked it again.

## Review rounds

| Round | Group | Report | sha256 of the reviewed documents | Verdict | Found and done |
|---|---|---|---|---|---|
| 1 | A | `round-1-A.md` (report sha256 `14bbf0c6…`) | `profiles-and-credentials.md` fa789146…, `policy-and-approvals.md` 7dcc306a…, `findings.md` b5b48d79… | FAIL | 0 BLOCKER, 4 WARNING, 8 NIT; all BLOCKER and WARNING fixed in `88a2994`, dispositions in `round-1-dispositions.md` |
| 1 | B | `round-1-B.md` (report sha256 `18446948…`) | `doctor.md` 1c470bd3…, `portability.md` 8193c42f…, `overview.md` eb9d2078…, `README.md` f87c3e38… | FAIL | 1 BLOCKER, 8 WARNING, 9 NIT; all BLOCKER and WARNING fixed in `30edf0b`, dispositions in `round-1-dispositions.md` |
| 1 | C | `round-1-C.md` (report sha256 `a7b77ed1…`) | `containment.md` ea33b95d…, `data-model.md` e7a42e7b…, `integrations.md` 5f192d35… | FAIL | 0 BLOCKER, 7 WARNING, 1 NIT; all BLOCKER and WARNING fixed in `c2e2823`, dispositions in `round-1-dispositions.md` |
| 1 | D | `round-1-D.md` (report sha256 `0aed5faf…`) | `cli-reference.md` 31aad86b…, `config-reference.md` fc1411d0…, `interactive-shell.md` 324b86ff… | FAIL | 2 BLOCKER, 4 WARNING, 4 NIT; all BLOCKER and WARNING fixed in `f33d27a`, dispositions in `round-1-dispositions.md` |
| 1 | E | `round-1-E.md` (report sha256 `ec81ac42…`) | `indexes-and-context.md` 83a698ea…, `onboarding.md` 07ae6c13…, `runs.md` 93369ba2…, `checks-and-evidence.md` 5e34cf9d…, `processes.md` 38c57f2f… | FAIL | 1 BLOCKER, 3 WARNING, 2 NIT; all BLOCKER and WARNING fixed in `ffbc9dd`, dispositions in `round-1-dispositions.md` |
| 2 | A | `round-2-A.md` (report sha256 `ebc7fd27…`) | `profiles-and-credentials.md` 6ad4ceba…, `policy-and-approvals.md` d8dd84cf…, `findings.md` 584b2440… | FAIL | 0 BLOCKER, 1 WARNING, 3 NIT; WARNING and two NITs fixed in `797e579`, one NIT deferred, dispositions in `round-2-dispositions.md` |
| 2 | B | `round-2-B.md` (report sha256 `2ccefc88…`) | `doctor.md` 53fc0221…, `portability.md` b02efd3d…, `overview.md` cae4b39c…, `README.md` b9614888… | PASS | 0 BLOCKER, 0 WARNING, 2 NIT; NITs deferred, documents not edited |
| 2 | C | `round-2-C.md` (report sha256 `d6518e52…`) | `containment.md` 9688bc84…, `data-model.md` abbd06a0…, `integrations.md` f7f9a9ba… | FAIL | 0 BLOCKER, 1 WARNING, 3 NIT; all fixed in `5026ed6` (one NIT in part), dispositions in `round-2-dispositions.md` |
| 2 | D | `round-2-D.md` (report sha256 `1766b691…`) | `cli-reference.md` d33adcfb…, `config-reference.md` 1caf4388…, `interactive-shell.md` db03b0b5… | PASS | 0 BLOCKER, 0 WARNING, 2 NIT; NITs deferred, documents not edited |
| 2 | E | `round-2-E.md` (report sha256 `6b68504d…`) | `indexes-and-context.md` f2f42953…, `onboarding.md` 61c29ca5…, `runs.md` b08aac78…, `checks-and-evidence.md` 27757927…, `processes.md` d73dedef… | PASS | 0 BLOCKER, 0 WARNING, 3 NIT; NITs deferred, documents not edited |
