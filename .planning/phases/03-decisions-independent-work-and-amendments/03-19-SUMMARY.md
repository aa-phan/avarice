---
phase: 03-decisions-independent-work-and-amendments
plan: 19
subsystem: run-supervisor
status: complete
tags: [repair, regression, gate-g1, gate-g3, reproducer, aut-16, rc-7, kill-points]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "G1, G3, the reproducer and the integrity gate map as pure verdicts (03-06), the spike verdicts for a unit that must ask and PLAN_CITES_ACCEPTANCE_HARD false (03-13), the item-local block, park and the fresh unit after an answer (03-18), the repair edge of the item lifecycle and repairAttemptsPerCheck 1 (03-03, 03-04)"
provides:
  - "src/app/run-stages/repair.ts: itemStartStatuses, itemStartInventory, reproducerFor, repairUnit, repairsOf, the repair:reproducer step and the references and issue text a decision cites"
  - "Regression charging (AUT-16): the checks of an item are judged against the item's own start, the G2 result of the item committed last over the baseline"
  - "One bounded repair (AUT-10, D-11): a newly failing check gets one repair unit on the same item, judged by G3 and then by G2 against the item's base; one commit holds both units"
  - "A repair that weakens the check, or fails, ends in a repeated_failure decision with the smallest reproducer in its evidence and a repair:reproducer step"
  - "G1 before G2 on every progressed unit (D-02, D-07 stage 2): scope_expansion, plan-checkpoint and owner-choice decisions, an advisory for an uncited acceptance ID, and the spec:plan step (RC-7)"
  - "Kill points after-checkpoint:gate:g1, repair and gate:g3, and gate:g1, repair and gate:g3 as next actions of a running run"
affects: [03-20, 03-22, 03-31]

actuals:
  tokens: 38000
  tasks: 3
  commits: 6
plan_head_before: 6264d9fd220deedd056b225db26b6bd572cc0f0a
plan_head_after: 457ddb62960475b9f80dfea0977970c0d1fa9e1c
commits: 6

tech-stack:
  added: []
  patterns:
    - "An item's work is measured against one base snapshot (step item:base) whatever units follow it: G2, the park and the commit read changes since it, a repair's own snapshot serves its own G3 and discard only"
    - "The start of an item is the last committed item's G2 result over the baseline, for the check statuses and for the test inventory, so a regression is charged to the item that caused it and a failure that was already there is pre-existing"
    - "A repair is the one chance of a check: it is never discarded and retried, and every ending that the gates cannot judge is a decision that cites the reproducer it was started with"
    - "Both G3 and G2 are recorded for a repair whatever either says, and the decision names the failures of both"
    - "A decision G1 opens is tagged in its evidence references (g1:scope, g1:checkpoint, g1:owner-choice:<AC>:<key>), and the tag says which owner choices its answer settled"

key-files:
  created:
    - src/app/run-stages/repair.ts
    - test/helpers/repair-scenarios.ts
    - test/integration/run-regression.test.ts
    - test/integration/run-repair.test.ts
    - test/integration/run-g1.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-19-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-19-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-19-red-evidence-task3.json
  modified:
    - src/app/run-stages/item.ts
    - src/app/checks.ts
    - src/app/run-gsd-config.ts
    - src/domain/gates.ts
    - src/domain/reproducer.ts
    - src/domain/run-contract.ts
    - src/domain/run-lifecycle.ts
    - test/helpers/fault-run.ts
    - test/fault/run-killpoints.test.ts
    - test/fixtures/json-shapes/status-runs.json
    - test/integration/run-baseline-workflow.test.ts
    - test/integration/run-status.test.ts
    - test/unit/gates.test.ts
    - test/unit/reproducer.test.ts
    - test/unit/run-contract.test.ts
    - test/unit/run-lifecycle.test.ts

key-decisions:
  - "A check is repaired only when every blocking entry of the G2 delta is `regressed` and failed: a check that failed at the start too (target-not-passed), one that could not run or was inconclusive, and every non-checks-delta failure go straight to a decision (flagged assumption of the plan, made narrower)"
  - "G3's repairAttempts is the number of repairs the failing checks had before the one being judged (0 for the first), because evaluateG3 fails at repairAttempts >= limit; the limit of one is enforced by the routing, which offers no second repair for a check that has had one"
  - "authorizedTestPaths is empty: an amendment cannot name a test path to the repair yet (no amendment diff is stored per version), so G3 never lets a change to the failing test's file through"
  - "A repair that does not progress, is interrupted, or ends any way the gates cannot judge is a decision (blockItem against the item's base), never a CON-16 discard and retry"
  - "A spent invocations budget before the repair is the run-wide budget block (class budget, naming the invocations budget), as the CON-16 retry's is"
  - "Both gate rows (G3, then G2) are written for a repair even when G3 failed, so a skip marker shows G3 failing-test-unchanged and G2 new-skip-marker together"
  - "item:base is written by every unit that is not a repair (a retry and an answer attempt start from their own snapshot, which equals the item's base), not only the first"
  - "G1 never judges a unit that did not progress (S3-A): a paused unit is never failed for a PLAN it did not write; PLAN_CITES_ACCEPTANCE_HARD stays false and the advisory is stored in the G1 row as an entry marked advisory"
  - "An owner choice is settled by an answered acceptance decision of the item that is the unit's own question (no tag) or that G1 opened for exactly that criterion and key; a plan-checkpoint decision settles none"
  - "RUN_NEXT_ACTIONS.running lists the new actions in the order each first occurs in a run that needs all of them: gate:g1, gate:g2, repair, gate:g3, commit"

requirements-completed: []

coverage:
  - id: D1
    description: "S-52 offline: item B's first unit breaks the test item A added, B's G2 fails on checks-delta charged to B with failed evidence naming B, one repair attempt (reason repair) fixes it, G3 and G2 pass, B has one commit that holds the paths of both units, A's commit and G2 row are untouched, and the run reaches ready_for_review"
    requirement: "AUT-16"
    verification:
      - kind: integration
        ref: "test/integration/run-regression.test.ts#S-52 offline: B breaks a test A added, the failure is charged to B, one repair fixes it, A stays done (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Adjacency: a check that failed at base and still fails is pre-existing and starts no repair; a check that failed at base, passed after A and fails after B is charged to B because the start statuses are A's G2 result"
    requirement: "AUT-16"
    verification:
      - kind: integration
        ref: "test/integration/run-regression.test.ts#AUT-16 adjacency: a failure that was there before the item is not charged to it"
        status: pass
    human_judgment: false
  - id: D3
    description: "S-21 offline: a repair that deletes the failing test, marks it .skip, adds a VERIFICATION override or leaves the check failing is a case each, ends in a repeated_failure decision with withdraw only, the check name, the output digest and the failing test in its evidence references, a repair:reproducer step, G3 and G2 rows, the item parked, nothing committed and no second repair"
    requirement: "AUT-10"
    verification:
      - kind: integration
        ref: "test/integration/run-repair.test.ts#S-21 offline: each way a repair can weaken the check ends in a repeated_failure decision with the reproducer (T-03-36)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A spent invocations budget before the repair starts no repair and the decision names the budget; a first unit that adds an override, a PRUNE entry or an out-of-scope file opens a decision directly with no repair; a repair that puts the repository back to the pin ends in a decision, not an empty commit; a repair that fixes the code passes G3 and G2"
    requirement: "AUT-10"
    verification:
      - kind: integration
        ref: "test/integration/run-repair.test.ts#S-21 offline: when no repair runs, the decision says why"
        status: pass
      - kind: integration
        ref: "test/integration/run-repair.test.ts#a repair that puts the repository back to the pin leaves the item nothing to commit"
        status: pass
    human_judgment: false
  - id: D5
    description: "G1 before G2: a plan path outside the write set opens a scope_expansion decision whose consequences print the amend command with --add-write for the path, parks the item and never runs G2; an unresolved checkpoint:decision opens an acceptance decision with the plan's option IDs; an owner-choice criterion nobody asked opens a free-text acceptance decision and, once answered, the next unit passes the rule"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-g1.test.ts#G1 turns a plan that needs more than its spec into a decision (D-07, T-03-37)"
        status: pass
      - kind: integration
        ref: "test/integration/run-g1.test.ts#G1 asks for an owner choice the unit never asked (D-02)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A plan that cites no acceptance ID passes G1 with an advisory stored in the G1 row; a unit that paused has no G1 row; what a plan names for the derived spec fields (symbols, a config key, a reference) is recorded in a spec:plan step and the stored contract keeps its one version"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-g1.test.ts#G1 reads the plan as data, and never fails what it cannot judge"
        status: pass
    human_judgment: false
  - id: D7
    description: "A supervisor killed after the gate:g1, repair or gate:g3 checkpoint resumes to the committed tree, evidence statuses and gate verdicts of the uninterrupted S-52 run; all 27 kill points pass"
    requirement: "AUT-10"
    verification:
      - kind: fault
        ref: "test/fault/run-killpoints.test.ts#after-checkpoint:gate:g1, after-checkpoint:repair, after-checkpoint:gate:g3 (AC-3: 27/27 interrupted attempts identified)"
        status: pass
    human_judgment: false
  - id: D8
    description: "AUT-10 stays `unclassified` in the coverage report: S-21 is its criterion and it holds offline here; whether a real model, asked to repair, weakens the test is the live S-21 case, not run in this plan"
    requirement: "AUT-10"
    verification: []
    human_judgment: true
    rationale: "The offline suite proves the gates, the routing and the decision with a scripted host; how a real model behaves when asked to repair is measured by a live case a later plan runs"

duration: about 75 min (approximate; the start time was not recorded)
completed: 2026-11-09
---

# Phase 3 Plan 19: Bounded repair, regression charging and gate G1 Summary

**The checks of an item are judged against the item's own start, a check that item B broke gets exactly one repair unit that G3 and G2 judge against B's base, and a repair that weakens the test, or fails, ends in a decision that cites the reproducer; G1 judges every progressed unit's plan before G2 and turns an out-of-scope plan, an unresolved plan checkpoint and an unasked owner choice into decisions.**

## Performance

- **Duration:** about 75 min (approximate; the start time was not recorded; the first commit of the plan is 01:07 and the last 01:42 local)
- **Completed:** 2026-11-09
- **Tasks:** 3 (a tracer and two auto tasks, each TDD with a RED commit and a RED evidence record)
- **Files modified:** 29 (8 created, 21 modified, counting the three RED evidence records)
- **Commits:** 6 (the two docs commits follow)

## Accomplishments

- **Regression charging (AUT-16, D-11).** `itemStartStatuses` gives the statuses an item began with: the latest G2 check results of the item committed last, over the baseline measured at the pin. `gateUnit` runs the required checks with those as `base`, so a check that failed then and fails now is pre-existing (and flagged so) and one that passed then is charged to this item (`regressed`, evidence naming the item). The earlier item stays done, its commit and its G2 row untouched. `itemStartInventory` does the same for the test inventory, so an item that deletes a test an earlier item added is seen.
- **One bounded repair (AUT-10).** When every blocking entry of the delta is a regressed, failed check and `repairAttemptsPerCheck` and the invocations budget allow it, `repairUnit` takes the `repair` checkpoint, opens an attempt with the reason `repair`, moves the item implemented -> delegated, ends the repaired attempt `repaired` and writes a `repair:reproducer` step; the unit launches through the same path as any unit with the reproducer and `Fix the code. Do not delete, skip or change the failing test.` in its prompt as data. G2 then judges the whole tree against the item's base (`item:base`), and the one commit holds both units' paths (a file the repair undid is no change).
- **G3 and the decision (T-03-36).** `judgeRepair` takes the `gate:g3` checkpoint, measures the inventory once, evaluates G3 on the repair's own diff and records a G3 row; G2 is evaluated and recorded as well. A repair that deletes the failing test (G3 failing-test-present and failing-test-unchanged, G2 removed-test), marks it `.skip` (G3 failing-test-unchanged, G2 new-skip-marker), adds an override (G2 no-new-overrides) or leaves the check failing (G2 checks-delta, no second repair) ends in a `repeated_failure` decision, withdraw only, whose evidence references hold the failing evidence IDs, `check:<name>`, `output:sha256:...` and `test:<name>`, with the item parked and nothing committed.
- **G1 in the item flow (T-03-37).** `judgePlan` takes the `gate:g1` checkpoint, reads the unit's quick PLAN as data, judges it against the item spec and the contract's globs, and records a G1 row. A failure parks the item and opens the decision the failure names: `g1-scope` (scope_expansion, the amend command with `--add-write` for exactly the paths outside the write set), `g1-checkpoint` (acceptance, the plan's option IDs), `g1-owner-choice` (acceptance, free text), else a free-text acceptance decision. A plan that cites no acceptance ID passes with an advisory stored in the row.
- **RC-7 stage 2.** What the plan names for the spec fields the item left to derivation (`planNamedSpec`) goes to a `spec:plan` step marked `derivedFrom: plan`; the stored contract keeps its one version.
- **Crash safety.** A kill at `after-checkpoint:gate:g1`, `repair` or `gate:g3` resumes to the tree, evidence statuses and gate verdicts of the uninterrupted S-52 run (all 27 kill points pass). `reconcileDelegated` knows a repair attempt: one that never launched goes back to `implemented` and is repaired again, one whose unit progressed goes on to its gate, any other is the check's one chance spent and becomes a decision.

## Task Commits

1. **Task 1 RED** - `0b6dd08` (test): S-52 and the adjacency cases against the code before the plan (6 of 7 fail on assertions; the pre-existing guard passes)
2. **Task 1: tracer, S-52 offline** - `54cd379` (feat): repair.ts, the item flow, item:base, the item start statuses and inventory, the repair prompt, the node:test spec failure lines
3. **Task 2 RED** - `7b4db95` (test): the S-21 cases against the code before gate G3 was wired (5 of 9 fail; the four that pass are guards)
4. **Task 2: G3 and the decision with the reproducer** - `18a6ee2` (feat)
5. **Task 3 RED** - `5e390a8` (test): G1 cases and the three kill points against the code before gate G1 was wired (10 of 11 fail)
6. **Task 3: G1 in the item flow, spec:plan, kill points** - `457ddb6` (feat)

**Plan metadata:** the two docs commits that carry this file, STATE.md and ROADMAP.md.

## Decisions Made

See `key-decisions` in the frontmatter. The ones a later plan must know: a repair is offered only for a failed, regressed check; `authorizedTestPaths` is empty until an amendment can name a test path (plan 03-20 owns amendments); G3's `repairAttempts` counts repairs before the one judged; and a decision G1 opens is tagged in its evidence references, which is how `ownerChoicesOf` knows what an answer settled.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The reproducer reads the node:test spec reporter's failure lines**
- **Found during:** Task 1 (the repair prompt named no failing test)
- **Issue:** a check that runs `node --test` off a terminal writes the spec reporter (`✖ <name> (<n>ms)`), which `extractFailingTests` (plan 03-06) deliberately did not read, so a reproducer of the usual check named no test and G3 had nothing to judge.
- **Fix:** `extractFailingTests` reads those lines (once, though the closing list repeats them); a unit test covers the shape.
- **Files modified:** `src/domain/reproducer.ts`, `test/unit/reproducer.test.ts`
- **Commit:** 54cd379

**2. [Rule 1 - Bug] A repair that puts the repository back to the pin made the commit fail**
- **Found during:** Task 2 (the control case)
- **Issue:** with no in-scope change left, `workspace.commit` refused an empty path list and the supervisor stopped with an `invalid` error.
- **Fix:** after the gates pass, an item with no in-scope change since its base opens a `repeated_failure` decision (rule `nothing-to-commit` in the event data); a test covers it.
- **Files modified:** `src/app/run-stages/item.ts`, `test/integration/run-repair.test.ts`
- **Commit:** 18a6ee2

**3. [Rule 2 - Missing critical] The inventory an item starts from is the one the item before it ended with**
- **Found during:** Task 1 design
- **Issue:** G2 compared an item's inventory with the one measured at the pin, so item B could delete a test item A added without `removed-test` seeing it (and the failing test of a repair of B would not resolve).
- **Fix:** `itemStartInventory`, and `recordedInventory` takes an optional `workItem`.
- **Files modified:** `src/app/checks.ts`, `src/app/run-stages/repair.ts`
- **Commit:** 54cd379

**4. [Rule 3 - Blocking] Files outside the plan's list**
- `src/app/run-gsd-config.ts` (the repair data line and instruction in the unit prompt), `src/domain/gates.ts` (`g1PathBreaches`: the paths a failed G1's decision names, so the amend command asks for exactly them), `src/domain/run-contract.ts` (`planNamedSpec`: stage 2 of RC-7) and `src/domain/reproducer.ts`; unit tests for each.

**5. [Plan-directed change to existing tests] G1 writes a row and a checkpoint for every unit**
- `run-baseline-workflow` (the checkpoint list gains `gate:g1`), `run-status` (the gate list and the status text gain G1), `run-killpoints` (the reference gates gain G1), `run-lifecycle` (the next actions), the status JSON fixture `status-runs.json` (regenerated; one G1 entry and the checkpoint sequence number), and `run-baseline-workflow`'s decision-evidence assertion (the failing evidence IDs now come first and the reproducer references follow).

**6. [Plan reading] See the key decisions**
- The plan's assumption names "every G2 failure is checks-delta"; the build also needs the check to have failed and to have passed at the item's start. `authorizedTestPaths` is empty rather than read from an amendment diff, which nothing records yet. The kill-point scenario is the S-52 pair of items with a PLAN for each unit (the plan said a multi-item scenario) and its own reference run.

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical), 1 blocking addition of files, 2 plan readings, 1 set of plan-directed test changes. **Impact:** none on the plan's truths.

## Spike S3-A findings applied

- A unit that must ask can end with no PLAN: G1 runs only after a `progressed` classification, so a paused unit has no G1 row (tested: `a unit that paused is never failed for the plan it did not write`).
- `PLAN_CITES_ACCEPTANCE_HARD` is untouched (false); the advisory is stored in the G1 row.

## Documentation surfaces (for plan 03-31)

`docs/system/` exists in this checkout but was not edited: the documentation plan of the phase owns it, as for plans 03-02 to 03-18. What it must cover:

- **Gates:** G1 runs after every progressed unit (rows named `G1`, item and attempt named; failures and advisories in one list, an advisory entry marked `advisory`); G3 runs after every repair (row `G3`); G2 runs after both and now reads the item's start (statuses and inventory) instead of the pin. Rule lists, order and facts are those of plan 03-06; the integrity names a failed gate carries in the event data (`integrity`) come from the gate map.
- **Steps and checkpoints:** checkpoints `gate:g1`, `repair`, `gate:g3` (next actions of a running run, in the order `gate:g1, gate:g2, repair, gate:g3, commit`); steps `item:base` (`attemptId`, `itemId`: the attempt whose snapshot is the item's base), `repair:reproducer` (`attemptId`, `itemId`, `failedAttemptId`, `repairFor`, `reproducers`, `failingTestIds`, `testFiles`, `evidenceIds`; one per repair attempt, or one written for a decision when the gated attempt had none) and `spec:plan` (`attemptId`, `itemId`, `source`/`derivedFrom` plan, `fields`, `symbols`, `configKeys`, `references`; written only when the plan names something new for a derived field).
- **Attempts:** reason `repair` (the item's `implemented` -> `delegated` edge); the attempt that was repaired ends `repaired`; a repair attempt that never launched ends `discarded`; a repair is never retried (CON-16 does not apply) and does not spend the unit's retry.
- **Repair rules:** offered when every blocking check of the item is `regressed` and failed, each failing check has had fewer repairs than `repairAttemptsPerCheck` since the item last started over (an answered decision restarts the count), and the invocations budget has room; otherwise a decision (a spent budget is the run-wide `budget` block naming `invocations`). The repair prompt carries `RUN_REPAIR_INTRO`, the data line, the reproducer (check, command, exit code, failing tests, output digest, paths changed since the check last passed) and `RUN_REPAIR_SENTENCE`.
- **Decision classes:** `repeated_failure` (withdraw only) for a failed repair and for every checks-only G2 failure, with evidence references `ev_...`, `check:<name>`, `output:sha256:...`, `test:<name>`; from G1: `scope_expansion` (`g1-scope`, evidence tag `g1:scope`, amend command `--add-write` for the paths outside the write set, none when only the item's explicit spec was exceeded), `acceptance` for a plan checkpoint (options are the plan's option IDs, tag `g1:checkpoint`) and for an owner choice (free text, tags `g1:owner-choice:<AC>:<key>`).
- **Owner choices (D-02):** an item's `decision:<key>` criteria are asked when an answered acceptance decision of the item is the unit's own question, or G1's for that criterion and key.
- **Event data of an item block:** `gate` (G1, G2 or G3), `rules` (G3 and G2 rules prefixed when G3 failed), `integrity` (the integrity gates the verdicts broke).
- **Reproducer:** `extractFailingTests` reads node:test spec lines (`<cross> <name> (<n>ms)`), vitest FAIL lines and TAP `not ok` lines; failing test IDs are resolved to the inventory's IDs by exact match or a ` > <name>` suffix, and an unmatched name is not judged.
- **Findings to record:** G3's `repairAttempts` counts repairs before the one judged (the gate fails at `>=` limit); `authorizedTestPaths` is always empty until an amendment diff is stored per contract version; a spent invocations budget before a repair blocks the whole run (class budget) where an exhausted repair blocks the item; the plan's wording "G2 rerun against the item's base snapshot" is the item's base, not the repair attempt's snapshot.

## Issues Encountered

- Full suite (`node --test test/`): 3226 tests, 3166 pass, 0 fail, 60 skipped (the live cases behind `AVARICE_LIVE`). A first full run before the G1 wiring had two failures that were not caused by it: the decision-evidence assertion of `run-baseline-workflow` (changed on purpose, deviation 5) and `run-independent-work` "returns at once when the decision is still open" (event count 104 vs 103), a load flake that passes alone, as plan 03-18 recorded for another test.
- The plan-commit ledger file (`gsd-plan-head-before-03-19`) could not be written (the session is confined to the worktree); the base recorded here is the HEAD the plan started from, `6264d9f`.
- The commit trailers follow the orchestrator's instruction (Opus 5.5), matching the earlier commits of the plan; the harness attribution names another model line.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The new surface (a repair attempt and its reproducer step, a G1 gate row, a plan read as data) is inside the plan's trust boundaries and T-03-36 and T-03-37.

## Threat mitigations

- **T-03-36:** G3 on the repair's own diff and G2 against the item's base both run for every repair; deleting, skipping or editing the failing test, adding an override or leaving the check failing each end in a decision with the reproducer, one repair only (four cases in `run-repair.test.ts`).
- **T-03-37:** G1 runs before G2 on every progressed unit; a plan path outside the write set parks the item and opens a scope_expansion decision, and only an amendment can widen (`run-g1.test.ts`; the plan's text never changes the contract, the `spec:plan` step is data).

## Next Phase Readiness

Ready for 03-20 (amendments: `authorizedTestPaths` and the amend commands the G1 and repair decisions print) and 03-22 (the resumed-session path; a repair is a fresh unit, and an answered item still starts as an `answer` attempt). Requirements AUT-10, AUT-16 and RC-7 are declared by other incomplete plans, so none is marked complete here.

## Self-Check: PASSED

Created files exist (repair.ts, repair-scenarios.ts, the three test files, three RED evidence records); commits `0b6dd08`, `54cd379`, `7b4db95`, `18a6ee2`, `5e390a8` and `457ddb6` are ancestors of HEAD; `npx tsc -p .` and `scripts/check-boundaries.ts` are clean; the plan's verification set (run-regression, run-repair, run-g1, run-gates, run-killpoints with 27/27 points) passes; the full suite passes (3166 of 3226, 60 skipped live cases).
