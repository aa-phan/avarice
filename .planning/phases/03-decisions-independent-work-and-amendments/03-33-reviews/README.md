# Plan 03-33 documentation comparison and fresh reviews

Plan base commit: `187409e` (HEAD when this plan began; the code does not change in this plan).
Diff base for the phase: `fc15fea` (`git merge-base main HEAD`; `main` is at `fc15fea`). The phase's code diff is `git diff --stat fc15fea...HEAD -- src bin`: 77 files, 8989 insertions, 472 deletions. The drafts under review are `git diff fc15fea -- docs/system`.

## The comparison of the phase's diff with docs/system

Method: every changed file under `src` and `bin` was matched with a worklist row (`03-31-doc-worklist.md`, 70 rows, all `drafted`); the plans with no row were checked to have changed no built behaviour; every denominator in `docs/system/coverage.md` was recounted with its command; the probes below were run against the documents; every `file:line` citation in `docs/system/findings.md` was mapped from the commit that wrote the line to HEAD with `git diff -U0` hunks (a script of the plan's execution, not kept in the repository), and each citation whose line moved was re-pointed, each whose line was rewritten was read by hand.

### Gaps found and fixed

1. `docs/system/config-reference.md`, Summary: six `AVARICE_*` constants named, eight exist. `AVARICE_VERIFIER_ADDENDUM` (`src/adapters/gsd/agents-json.ts:28`) and `AVARICE_RUN_SHELL_ADDENDUM` (`src/domain/run-shell-rules.ts:48`) were missing. Fixed; the count is 17 names (9 variables read, 8 constants).
2. `docs/system/config-reference.md`, "Environment variables AVARICE sets for child processes", row "run supervisor (detached)": three overrides named; `supervisorEnv` also sets `CLAUDE_CONFIG_DIR` to the host configuration directory the run recorded (`src/cli/spawn-supervisor.ts:56`). Fixed.
3. `docs/system/README.md`: no row for the new decision document in the documents table, none in the proposal counterparts row for `docs/autonomy-and-decisions.md`; the opening, the runs, checks, data model, integrations, containment and processes rows described the earlier surface (five flows, one work item). Fixed; the row for `ADR-006` also names the new document.
4. `docs/system/coverage.md`: every denominator was at `40adc1f` with ten commands, 23 tables, 28 event kinds, 2 migrations, 11 ports, 13 external systems, 120 test files, 26,576 source lines. Recounted at `187409e`: 15 commands, 24 tables (22 written), 39 event kinds, 3 migrations, 12 ports plus the descriptor, 17 external system rows, 173 test files, 35,093 source lines, boundary lint 99 files, 17 `AVARICE_*` names, 9 profile config keys (4 dead, 5 `notify` keys read), 8 diagram sources, 11 work item edges, 5 decision classes, gate rules G1 6, G2 8, G3 3, G4 7. Unchanged: 14 and 29 onboarding states and transitions, 11 and 37 run states and transitions, 7 blocked reasons, 6 step statuses, 6 work item states, 35 hook rules, 3 index steps, 1 hook entry point, 10 other variables.
5. `docs/system/coverage.md`, Denominators, event kinds: the recorded command (`type: '<kind>'` declarations) finds 34 of the 39 kinds, because `amendment.requested`, `decision.duplicate`, `decision.rejected`, `notify.delivered` and `notify.failed` are written through other forms. Replaced by a command over the kind names that prints 39, with the two configuration names it also matches excluded. All 39 kinds in `docs/system/data-model.md` were checked to exist in the code.
6. `docs/system/coverage.md`, Per-document status: thirteen documents changed after their earlier review and the new document had no row. They are now `drafted`, with the earlier review notes kept, until the fresh reviews below mark them.
7. `docs/system/findings.md`: lines 129, 193 and 199 (named by the worklist) and lines 127, 132, 138, 141, 142 and 163 (found by the comparison) no longer held; each is annotated as no longer holding, with the commit. Entry 5 of the worklist (a wall clock of 60 minutes) was resolved in the document and needs no line.
8. `docs/system/findings.md`: More than 100 citations whose code moved were re-pointed to the current line (the script applied 112 edits; seven of them touched an older, already superseded citation and were reverted by hand); 13 whose line was rewritten were read by hand and re-pointed or annotated (the reap pattern now matches `--(session-id|resume)`, the block step moved, the usage check and `createDeps` moved, the work item check function moved).
9. `docs/system/unknowns.md`: lines 43, 49, 88, 103, 116, 120 and 121 named stale facts (three host versions, `failed` and `cancelled` never entered, unreachable decision states, `contract amend` unknown, ten commands and eleven ports, five diagrams, a 24-point fault suite). Corrected; the line about the counts was removed because the documents now carry them; one section of three entries was added for what the decision documents rest on without a live run.

### Entries the plan expected to be resolved that still hold

- `src/app/run-stages/prepare.ts:407`: the move from `contract_ready` to `blocked_on_decision` still calls the transition directly and opens no decision record. The citation was re-pointed; the entry stays open.
- `src/app/run-stages/finish.ts:246`: every failed G4 still opens a `repeated_failure` decision. The citation was re-pointed; the entry stays open.

### Probes that found no gap

Fifteen commands and their flags, the exit codes 0, 3, 64 and 70, the shell's eight menu items and fifteen completion names, the three migrations and their columns, indexes and the `ntf_` prefix, 24 step names of a run (each found in the code), the work item edges, five decision classes, gates G1 to G4 and their rule counts, five admitted host versions, twelve ports, the external systems and spawn sites (`ps`, `osascript`, `launchctl`, `plutil`, `pgrep`, `node`, `claude`, `git`, `sandbox-exec`, `mount`), the 27 run kill points, the eight diagram sources against eight flows, and the proposals under `docs/` (unchanged against `fc15fea`).

### Findings written

`docs/system/findings.md` gained 15 lines under "From autonomy-and-decisions" (worklist entries 9 to 18 and 22 to 26), one line for the declared non-required check, three lines under "From config-reference (run slice)" (the proposal's check environment and agent commands, the resolved leading assignment, the host environment against the check sandbox with the parity result), and ten lines under "Proposal drift" (notify home, amendment by reply, the budget comment, the three `human` class lists, S-50 timing, quiet hours, `cancel` missing from the proposal's table, the G1 advisory, the `decision:` form, withdraw ending the run `failed`). The parity run recorded no unit-versus-supervisor difference, so no further line was written for it.

### Deviations

- The plan's last check of Task 3 compares the proposals (and the ledgers) with `main`. The proposals are unchanged against `main` and against the plan base. README.md, coverage.md and findings.md differ from `main` because earlier plans of the phase edited them, so a check of those three against `main` cannot pass; it is run against the plan base.

## Review groups

Fresh `technical-writer:prose-reviewer` runs are made by the orchestrator; the author of the drafts and of this comparison does not review them. Each round stores its report verbatim as `round-<n>-<group>.md` in this directory and adds a row below.

| Group | Documents | Kind |
|---|---|---|
| A | `docs/system/autonomy-and-decisions.md` | new |
| A | `docs/system/findings.md`, `docs/system/unknowns.md` | changed |
| B | `docs/system/runs.md`, `docs/system/processes.md` with `docs/system/diagrams/run-decision-independent-work.puml`, `run-decide-resume.puml`, `run-amend-stale.puml`, `docs/system/data-model.md` | changed (diagrams new) |
| C | `docs/system/checks-and-evidence.md`, `docs/system/containment.md` | changed |
| D | `docs/system/cli-reference.md`, `docs/system/interactive-shell.md`, `docs/system/config-reference.md` | changed |
| E | `docs/system/integrations.md`, `docs/system/overview.md`, `docs/system/README.md` | changed |

Round budget (owner rule of the earlier documentation plan): a BLOCKER, or a WARNING about a code-behaviour claim, is fixed and forces a full fresh round; wording-only WARNINGs are fixed and checked by one more round; at most 5 full rounds per group, then the remaining items are reported for the owner and the documents are marked `reviewed with open items`.

## Review rounds

| Round | Group | Report | sha256 of the reviewed documents | Verdict | Found and done |
|---|---|---|---|---|---|
