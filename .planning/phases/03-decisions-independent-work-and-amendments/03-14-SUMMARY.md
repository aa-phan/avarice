---
phase: 03-decisions-independent-work-and-amendments
plan: 14
subsystem: run-kernel
tags: [scheduler, work-items, multi-item, run-disposition, per-item-attempts, gsd-session, resume, fake-run-host]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "per-item attempts and transitionWorkItem gsdSession (03-02), brief items compiled to workItems (03-03), runDisposition (03-04), perItem fake host and items briefs (03-11)"
provides:
  - "start stores every compiled work item; the running stage runs them one at a time through runDisposition, one attempt, one G2 and one supervisor commit per item"
  - "running -> running between items, running -> verifying after the last; G4 and the final evidence are run-level"
  - "work_items.gsd_session written at delegation; GSD settings re-applied before each later item's snapshot"
  - "blockRun requires the item; resume reconciles the one in-flight item"
affects: [03-15, 03-16, 03-17, 03-18, 03-19, 03-20, 03-22, 03-31]

actuals:
  tokens: 14600
  tasks: 2
  commits: 4

plan_head_before: 725bcc005c7fe565635d2378467a3ceb3aabda5b
plan_head_after: 0377f97f48ab53264d873cf9e54eaadb12ee86e0

tech-stack:
  added: []
  patterns:
    - "The running stage asks the pure scheduler (runDisposition) on every pass and dispatches continue, start or all-done; blocked and undeliverable are loud internal errors until the decision plans"
    - "A unit prompt names its item (the Work item line) only when the contract has more than one item, so a brief without items keeps the Phase 2 prompt"
    - "Attempt ordinals stay the run's own count (steps are keyed by them); the reason and the CON-16 retry budget count one item's attempts"

key-files:
  created:
    - test/integration/run-scheduler.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-14-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-14-red-evidence-task2.json
  modified:
    - src/app/run-start.ts
    - src/app/run-stages/item.ts
    - src/app/run-stages/finish.ts
    - src/app/run-stages/prepare.ts
    - src/app/run-stages/blocked.ts
    - src/app/run-resume.ts
    - src/app/invocation.ts

key-decisions:
  - "The baseline attempt and any block before the first unit name the item the scheduler starts first (dependency order, then declaration order), not the first item declared, so that item's unit adopts the baseline attempt"
  - "A non-final item's attempt ends 'committed' at its commit; the last item's attempt still ends 'handed-off' at the hand-off, so a one-item run records what it always did"
  - "The unit prompt carries the Work item line only when the contract has more than one item"
  - "The interrupted final pass marks its unfinished checks run-level (no item), like the rows the pass itself writes"

requirements-completed: [AUT-3, AUT-16, RC-8]

coverage:
  - id: D1
    description: "A two-item brief goes from avarice start to ready_for_review with one unit, one G2 pass and one supervisor commit per item (subject the item title, Avarice-Run and Avarice-Attempt trailers naming that item's attempt); G4 passes once at the final commit with run-level evidence mapping both items' criteria"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-scheduler.test.ts#a two-item brief runs from start to ready_for_review, one unit, one G2 and one commit per item (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Items run in dependency order (B declared first, depending on A, runs second) with the baseline attempt belonging to the item that runs first"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-scheduler.test.ts#B is declared first and depends on A: A runs first, then B, and the baseline attempt belongs to A"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each item's unit is delegated under its own session ID, written to work_items.gsd_session and equal to the session of its launch:run step"
    requirement: "RC-8"
    verification:
      - kind: integration
        ref: "test/integration/run-scheduler.test.ts#writes the session ID of each launch into work_items.gsd_session"
        status: pass
    human_judgment: false
  - id: D4
    description: "A supervisor killed inside item B is resumed by reconciling item B (reap, discard to its snapshot, one CON-16 retry), not item A; an interrupted final pass inserts inconclusive evidence naming no item"
    requirement: "AUT-16"
    verification:
      - kind: integration
        ref: "test/integration/run-scheduler.test.ts#a supervisor killed inside item B resumes item B, not item A (D-09, FR-7)"
        status: pass
      - kind: integration
        ref: "test/integration/run-scheduler.test.ts#an interrupted final pass marks its unfinished checks for the run, not for an item (T-02-58, D-09)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A brief without items still runs as item A with the same steps, commits and outcomes as in Phase 2: the run, supervisor, resume, discard-and-retry, gate and kill-point suites pass unchanged"
    verification:
      - kind: integration
        ref: "node --test test/integration/run-outcomes.test.ts test/integration/run-supervisor.test.ts test/integration/run-resume.test.ts test/fault/run-discard-retry.test.ts test/integration/run-gates.test.ts test/fault/run-killpoints.test.ts"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-08
status: complete
---

# Phase 3 Plan 14: Multi-item kernel Summary

**A run with several work items now goes from `avarice start` to `ready_for_review` through the pure scheduler: one attempt, one contained unit, one G2 gate and one supervisor commit per item, in dependency and declaration order, with G4 judging the whole run once at the final commit.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-11-09T03:52:00Z
- **Completed:** 2026-11-09T04:33:00Z
- **Tasks:** 2
- **Files modified:** 10 (7 source, 1 test, 2 red-evidence records)

## Accomplishments

- `startRun` stores every compiled work item in the creation transaction; `runningStage` reads the items and the decisions, asks `runDisposition`, and continues, starts or finishes. `blocked` and `undeliverable` return an internal error naming the disposition until plans 03-18 and 03-19.
- Each item gets its own attempt (reason `initial`, then `con16-retry`, counted per item), its own `gsd:configure` step when the previous commit took `.planning/config.json` out of the clone, its model on the invocation, and its session ID in `work_items.gsd_session` from the moment it is delegated.
- The commit subject is the item's title; after the commit the run moves `running -> running` (next action `context-pack`, checkpoint item the next item) while an item remains and `running -> verifying` after the last.
- Final evidence, the interrupted-check rows and G4 name no item (run-level); `blockRun` requires an item and every caller names it; resume reconciles the single delegated or gated item.

## Task Commits

1. **Task 1: tracer, a two-item brief from start to ready_for_review** - RED `ad4e0d0` (test), GREEN `58dca65` (feat)
2. **Task 2: single-item sites, session IDs, dependency order, Phase 2 parity** - RED `21c62b5` (test), GREEN `0377f97` (feat)

**Plan metadata:** the docs commit that carries this file.

## Files Created/Modified

- `src/app/run-start.ts` - all compiled work items stored at start
- `src/app/run-stages/item.ts` - `loadUnit(ctx, row, itemId)`, `schedule`, the runDisposition dispatch, `latestAttemptOf`, per-item attempt history, `reapplyGsdSettings`, `promptItemOf`, the item-title commit subject, running -> running after a commit
- `src/app/run-stages/finish.ts` - run-level evidence and G4; the checkpoint item is the last attempt's
- `src/app/run-stages/prepare.ts` - `firstItemToRun`; the baseline attempt names it; pre-unit blocks pass it
- `src/app/run-stages/blocked.ts` - `BlockOptions.itemId` required
- `src/app/run-resume.ts` - the one in-flight item is reconciled; interrupted-check rows are run-level; a paused run goes back to verifying only when every item is done
- `src/app/invocation.ts` - `PrepareRunOptions.sessionId` (the caller may choose the session first)
- `test/integration/run-scheduler.test.ts` - 12 tests

## Decisions Made

- The baseline attempt names the item the scheduler starts first, so that item adopts it (the plan said first in declaration order, which breaks when B is declared first and depends on A).
- A non-final item's attempt is ended `committed` at its commit; the final attempt is still ended `handed-off`, so a one-item run's attempt outcomes are unchanged.
- The unit prompt carries the `Work item <ID>:` line only for a contract with more than one item; the fake host selects its per-item script from that line.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Baseline attempt and run-resume needed in Task 1**
- **Found during:** Task 1
- **Issue:** the tracer asserts attempts `A` and `B` by item ID, which needs the baseline attempt to name its item; `reconcileItem` gained an item argument, so `run-resume.ts` had to compile.
- **Fix:** `prepare.ts` (`firstItemToRun`, `initialAttempt` with an item) and a one-line `run-resume.ts` call-site change in Task 1; the real resume logic followed in Task 2.
- **Files modified:** src/app/run-stages/prepare.ts, src/app/run-resume.ts
- **Committed in:** 58dca65

**2. [Rule 3 - Blocking] `PrepareRunOptions.sessionId`**
- **Found during:** Task 2
- **Issue:** the session ID is created inside `prepareRunInvocation`, after the item is delegated; the plan asks for it on the work item at delegation.
- **Fix:** the caller chooses the session ID and passes it in; `prepareRunInvocation` uses it or makes one.
- **Files modified:** src/app/invocation.ts (not in the plan's file list)
- **Committed in:** 0377f97

**3. [Rule 1 - Plan correction] Interrupted-check evidence is run-level, not item B**
- **Found during:** Task 2
- **Issue:** the plan says the interrupted-check evidence names item B, but `markInterruptedChecks` runs only for a `verifying` run (no item in flight) and the rows mirror the final pass's own, which the same plan makes run-level.
- **Fix:** rows name no item; a test pins it.
- **Files modified:** src/app/run-resume.ts, test/integration/run-scheduler.test.ts
- **Committed in:** 0377f97

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 plan correction). **Impact on plan:** none on scope; the plan's behavior list holds.

## Issues Encountered

- One full-suite failure, `shell-supervisor` "a killed run is resumed from the shell" (`database is locked` under load); it passes alone (2/2).

## Verification

- `node --test test/integration/run-scheduler.test.ts`: 12/12
- Phase 2 suites: run-outcomes, run-supervisor, run-resume, run-discard-retry, run-gates (90 tests with the scheduler file): all pass; `test/fault/run-killpoints.test.ts`: 27/27
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts`: ok (86 files); the single-item-literal grep prints nothing
- Full suite: 3103 tests, 3042 pass, 60 skipped, 1 fail (the load-sensitive test above, green alone)

## TDD Gate Compliance

RED records `03-14-red-evidence-task1.json` and `03-14-red-evidence-task2.json` both return `RED_EVIDENCE_OK`; each RED commit precedes its GREEN commit.

## Known Stubs

None.

## Documentation surfaces (for plan 03-31)

- Steps: `gsd:configure` is recorded again per later item (result carries `attemptId` and `itemId`); `launch:run`, `snapshot`, `classify`, `commit` repeat per item attempt; `commit` and G2 rows name the item; final evidence, the final `gsd-verdict` row and G4 name none.
- Transitions: `running -> running` after an item's commit (nextAction `context-pack`, checkpoint item the next item); `running -> verifying` after the last.
- Commit subjects: the work item's title (the brief title for a brief without items), trailers `Avarice-Run` and `Avarice-Attempt` per item.
- Ledger: `work_items.gsd_session` set at delegation; attempts carry `item_id`, ordinals stay run-wide, reason counted per item; a non-final item's attempt ends `committed`.
- Prompt: the `Work item <ID>:` line appears only for a contract with several items.
- Known gap: `avarice start` still prints one `model:` line from the first item (src/cli/commands/start.ts).

## Threat Flags

None. T-03-24 holds (each item's commit set is its own `changedSince` snapshot filtered by scope, strays refuse the commit, G2 runs per item); T-03-25 holds (attempts and item-phase evidence carry the item ID, final evidence is run-level by design).

## Next Phase Readiness

Plans 03-15 onward can layer decisions, parking and repair on a kernel where each item is its own unit. `blocked` and `undeliverable` are still internal errors in the running stage by design.

## Self-Check: PASSED

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-08*
