---
phase: 03-decisions-independent-work-and-amendments
plan: 18
subsystem: run-supervisor
status: complete
tags: [decisions, independent-work, park, supervisor, lease, blocked_on_decision, notifications]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the scheduler rules and runDisposition (03-04), classifyDecision, buildDecisionRecord, blockScope and the shared state digest (03-05), the park port (03-09), the spike verdicts for a unit that must ask (03-13), the multi-item stage (03-14), the notification service (03-16)"
provides:
  - "blockItem and blockRun: an item that must ask is parked and blocked alone with a full decision record; every other blocked reason still stops the run"
  - "park.ts (parkItem, latestParkOf, parkStepOf) and schedule.ts (scheduleOf, isBlockedRunContinuable)"
  - "the supervisor's pickup of an answered blocked run, and its release and re-check of a blocked one"
  - "an answered item runs again as a fresh unit with the question and the owner's answer as data (attempt reason answer)"
  - "the undeliverable end: running -> failed naming the undelivered items and the withdrawn decisions"
  - "a resume that finishes an item block it finds in flight, and RUN_NEXT_ACTIONS.running with park"
affects: [03-19, 03-20, 03-22, 03-31]

actuals:
  tokens: 41500
  tasks: 3
  commits: 5
plan_head_before: 711a323ec7e8c76516d78040eca41527d2b2be4e
plan_head_after: 7715f551c4e7048de0bf4deb7c1bbad8fa09e378
commits: 5

tech-stack:
  added: []
  patterns:
    - "The step comes first: the park step is recorded `started` with the block descriptor before the park checkpoint, so a kill at any point after it resumes by writing the decision from the step, never by running the unit again"
    - "Block, release, re-check: the lease is released on a blocked run and the items and decisions are read again; `decide` answers and then starts a supervisor when no lease is held, so whichever side runs second sees the other's write"
    - "One scheduler read (scheduleOf) shared by the running stage, the item block and the supervisor's pickup"

key-files:
  created:
    - src/app/run-stages/park.ts
    - src/app/run-stages/schedule.ts
    - test/helpers/independent-work.ts
    - test/integration/run-independent-work.test.ts
    - test/fault/run-park.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-18-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-18-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-18-red-evidence-task3.json
  modified:
    - src/app/run-stages/blocked.ts
    - src/app/run-stages/item.ts
    - src/app/run-service.ts
    - src/app/run-resume.ts
    - src/app/run-gsd-config.ts
    - src/app/invocation.ts
    - src/domain/run-lifecycle.ts
    - test/helpers/fault-run.ts
    - test/unit/run-gsd-config.test.ts
    - test/unit/run-lifecycle.test.ts
    - test/fault/run-killpoints.test.ts
    - test/fault/run-budgets.test.ts
    - test/fault/run-discard-retry.test.ts
    - test/integration/run-outcomes.test.ts
    - test/integration/run-baseline-workflow.test.ts
    - test/integration/run-supervisor.test.ts
    - test/containment/live-run.test.ts
    - test/containment/LIVE-CASES.md

key-decisions:
  - "An item-local block writes its park step `started` (with the signal, the issue and the evidence the decision will say) before the park checkpoint, then parks, then records the step `completed`; a resume finishes the block from that step"
  - "A blocked run is picked up only when it stopped at an item decision while it ran its items (the block came from running, or paused during a resume's reconcile); a block from the preparation actions or verification, and every reason other than decision, stays a stop state"
  - "Budget endings are now class budget (withdraw only, amendable), as the decision policy and research table say; Phase 2's class permission for them is replaced in six offline tests and one live case"
  - "An item's retry history restarts at its answer attempt, so the unit that answers has its own CON-16 retry"
  - "The fresh unit's prompt carries the question the unit asked and the owner's answer (a choice by its label) as data under the resume data line, because a fresh unit has no memory of asking"
  - "blockRun keeps the class-named form for the run-wide callers that predate signals (preparation, verification, discard); the item and the budget and enforcement endings of the running stage name the structural signal"

patterns-established:
  - "Item-local block reasons are exactly `decision` (blockScope); every other reason stops the run"
  - "A decision belongs to an item when the item is the first of its affected items (the item, then its transitive dependents)"

requirements-completed: []

coverage:
  - id: D1
    description: "S-17 offline: with A, B (depends on A), C (independent) and D (depends on B) and a pause on B, B is parked and blocked on one decision with options, consequences, B and D as affected items and the shared state digest; C is done with its own G2 evidence and commit; no commit touches B or D; D never starts; the run ends blocked_on_decision with one batched banner"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-independent-work.test.ts#S-17 offline: B pauses, C completes with evidence, D waits, the run blocks with one banner (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two items that ask are blocked on a decision each and the run sends one banner counting both (batched notice, D-22, D-24)"
    requirement: "AUT-4"
    verification:
      - kind: integration
        ref: "test/integration/run-independent-work.test.ts#two items that ask send one banner for both decisions (D-22, D-24)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A supervisor started on a blocked run returns with no lease and no write while the decision is open; once answered it takes the run, moves it blocked_on_decision -> running, runs B as a fresh unit with the question and answer as data, drops B's park ref, runs D and reaches ready_for_review"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-independent-work.test.ts#a supervisor started on a blocked run (D-16)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A withdrawn decision leaves nothing ready: blocked_on_decision -> running -> failed with the undelivered items B and D and the withdrawn decision named in the event"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-independent-work.test.ts#a withdrawn decision ends the run failed with the undelivered items named"
        status: pass
    human_judgment: false
  - id: D5
    description: "An answer that lands between the lease release and the re-check is taken by the same supervisor process (lease fence 2, no new spawn); a unit that asked before any work parks an empty delta"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-independent-work.test.ts#block, release, re-check: an answer that lands after the release is not lost (research Pattern 2)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A supervisor killed after the park checkpoint, between the park step and the decision, or after the lease release of a blocked run resumes to the blocked state of the uninterrupted run, and B is never run twice"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/fault/run-park.test.ts#a supervisor killed inside the block resumes to the same blocked state, and B is not run again"
        status: pass
    human_judgment: false
  - id: D7
    description: "The prompt of a fresh unit carries the owner's answer after the acceptance criteria under the fixed data line, cut, flattened and escaped as a resume prompt's is"
    requirement: "AUT-1"
    verification:
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#runUnitPrompt with the owner answer of an item that asked (plan 03-18, T-03-14)"
        status: pass
    human_judgment: false
  - id: D8
    description: "AUT-3 stays `unclassified` in the coverage report: S-17 is its criterion, and it holds offline here; the live run of S-17 on a real model is a later plan's case"
    requirement: "AUT-3"
    verification: []
    human_judgment: true
    rationale: "The offline suite proves the supervisor, ledger and git behavior with a scripted host; whether a real model asks in the shape the detector reads is the live S-17 case, not run in this plan"

duration: 120 min (approximate; the start time was not recorded)
completed: 2026-11-09
---

# Phase 3 Plan 18: Item-local decisions with independent work continuing Summary

**An item whose unit must ask is parked and blocked on its own full decision record while independent items finish with their own evidence and commits; the run is blocked without polling, wakes only when an answer makes an item ready, runs the answered item as a fresh unit with the answer, and ends failed with the undelivered items named when a decision is withdrawn.**

## Performance

- **Duration:** about 120 min (approximate)
- **Completed:** 2026-11-09
- **Tasks:** 3 (a tracer and two auto tasks, each with a RED commit or a RED record)
- **Files modified:** 26 (8 created, 18 modified)
- **Commits:** 5 (the plan metadata commit follows)

## Accomplishments

- **Item-local block (D-09, AUT-2, AUT-3).** `blockItem` parks the item's delta, opens one decision built by `classifyDecision` and `buildDecisionRecord` (options, a consequence for each, the item and its transitive dependents as affected items, the shared `computeStateDigest`), ends the attempt, queues the notice, moves the item to `blocked_on_decision` and moves the run on by what the scheduler says. `blockRun` is the run-wide block and fills the same record. Pause, denied, no_progress, a loop limit, a second failure and a G2 failure (other than a scope breach) are item-local; a moved HEAD, a spent budget, a host refusal and a scope breach stay run-wide.
- **S-17 offline.** With A, B (depends on A), C and D (depends on B) and a pause on B: B is `blocked_on_decision` with a park step naming its path and a park ref in the clone, C is done with passed check evidence and its own commit, the commits touch neither B's nor D's files, D never starts, and the run is blocked with one delivered banner.
- **Block, release, re-check (research Pattern 2, D-16).** A supervisor on a blocked run whose decision is open returns with no lease and no write. One that reaches `blocked_on_decision` releases its lease, reads the items and decisions again, and goes on in the same process only if an answer landed in that window (tested with a hook in the window: lease fence 2, no second process). The pickup rule is `isBlockedRunContinuable`, shared with `decide` (plan 03-19).
- **The answered item.** B runs again as a fresh unit (attempt reason `answer`) whose prompt carries the question it asked and the owner's answer as data under the fixed data line; the decision ID is on the `launch:run` step and B's park ref is dropped when the attempt starts. A withdrawn decision ends the run `failed` with `undelivered` and `withdrawn` in the transition event.
- **Crash safety.** The supervisor was killed after the park checkpoint, between the park step and the decision, and after the lease release; each resume reaches the blocked state of the uninterrupted run (normalized comparison of items, attempts, decisions, park steps, park ref, commits, gates, invocations and notices) and B runs once.

## Task Commits

1. **RED for Tasks 1 and 2** - `f17e6fd` (test): S-17, the pickup, the withdrawn decision and the release window against a clean export of HEAD (6 of 7 and 3 of 4 fail on assertions)
2. **Task 1: tracer, S-17 offline** - `8d0c999` (feat): park.ts, schedule.ts, blocked.ts, item.ts, invocation.ts, run-gsd-config.ts, and the offline tests whose expected class or checkpoint list changed
3. **Task 2: block, release, re-check; pickup; the answered item; the undeliverable end** - `52ee818` (feat): run-service.ts and the prompt unit tests
4. **RED for Task 3** - `2d48e0d` (test): the three kill points against a clean export of HEAD
5. **Task 3: crash safety of park, next actions, kill points** - `7715f55` (feat): run-resume.ts, run-lifecycle.ts and the tests that name the action list

**Plan metadata:** the docs commit that carries this file, STATE.md and ROADMAP.md.

## Decisions Made

See `key-decisions` above. The two that matter most to later plans: a blocked run is continued only from a block that came from `running` (or `paused` during a resume's reconcile), so `decide` must use `isBlockedRunContinuable` and not re-derive the rule; and budget decisions are class `budget`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A shared scheduler read in a new file**
- **Found during:** Task 1
- **Issue:** `blocked.ts` needs the scheduler's answer after an item block, and `item.ts` (which owned `schedule`) imports `blocked.ts`.
- **Fix:** `src/app/run-stages/schedule.ts` holds `scheduleOf` and `isBlockedRunContinuable`; the stage, the block and the supervisor all read through it.
- **Commit:** 8d0c999

**2. [Rule 2 - Missing critical] The park step is written before the checkpoint**
- **Found during:** Task 3 design
- **Issue:** the plan orders checkpoint, park, step. A kill right after the checkpoint would leave nothing that says what the decision should contain (the pause text is not in the classify step), and the resume would have to run the unit again.
- **Fix:** the step is recorded `started` with the block descriptor (signal, issue, evidence, data) first, then the checkpoint, then the park, then the step is completed. The resume parks again (the workspace returns the same record for the same content) and writes the decision from the step.
- **Commit:** 8d0c999

**3. [Rule 1 - Bug] Every reason-decision block must park, not only the item routes the plan names**
- **Found during:** Task 1
- **Issue:** the plan names `routeOutcome`; the G2 failure and the "interrupted again" reconcile also end in reason `decision`. Left on the run-wide block they would leave the item's delta in the tree that the next item runs on, and a strays check would then refuse that item's commit.
- **Fix:** they use `blockItem` with the attempt's snapshot as base. The attempt-unit "brief too long" ending does too.
- **Commit:** 8d0c999

**4. [Rule 2 - Missing critical] A resume finishes a block that was in flight on an implemented item**
- **Found during:** Task 3
- **Issue:** an item blocked at its gate is `implemented`, which `reconcileRunning` did not look at; the stage would have re-run its gate on the parked (clean) tree and committed nothing.
- **Fix:** `implemented` items are reconciled; one with a park step finishes its block.
- **Commit:** 7715f55

**5. [Rule 1 - Bug] The retry of the unit that answers**
- **Found during:** Task 2
- **Issue:** the attempt that asked would count as a first failure of the unit that answers, so a crash of the answering unit would end in a decision with no CON-16 retry.
- **Fix:** the item's attempt history starts at its last `answer` attempt.
- **Commit:** 8d0c999

**6. [Plan reading] `blockRun` keeps `decisionClass` for the callers that predate signals**
- The plan says the signal replaces `BlockOptions.decisionClass`. The run-wide callers in the preparation stage, the verification stage and the discard recovery name a class; `BlockOptions` now takes either, and a class becomes the signal of that class (permission, repeated failure, scope expansion, or a free-text acceptance decision). The running stage names signals.

**7. [Plan-directed change to existing tests] Budget endings are class `budget`**
- The plan's routing table sends a spent budget to the `budget` signal, whose class is `budget`. Six offline assertions (`run-outcomes` twice, `run-budgets`, `run-discard-retry`, `run-baseline-workflow`) and the live case `s15-budget-permission` (assertion and `LIVE-CASES.md` row) expected `permission` and now expect `budget`. The live case was not run.
- Two checkpoint lists in `run-supervisor.test.ts` gain `park`, because a one-item block now parks before it stops.

**8. [Scope] A test hook in the release window**
- `RunSupervisorOptions.afterRelease` runs between the release and the re-check, beside the `after-release:blocked` kill point, so a test can land an answer in that window. Nothing in production sets it.

**Total deviations:** 5 auto-fixed (2 missing critical, 2 bug, 1 blocking), 3 plan readings. **Impact:** none on the plan's truths; the park step order and the reconcile of implemented items make the crash-safety truth hold at the first kill point.

## Spike S3-A findings applied

- A unit that must ask can end `no_progress` with no PLAN: the pause is read from `outcome.question` (the classifier's pause signal), and the test where B asks before any work parks an empty delta and opens the decision. There is no G1 in the codebase yet, so nothing here can fail a paused unit for an absent PLAN.
- A resumed unit can end `denied` with PLAN and SUMMARY but no VERIFICATION: this plan resumes no session (plan 03-22 does); the answered unit is fresh and judged from the clone by G2 as any unit.
- `PLAN_CITES_ACCEPTANCE_HARD` is untouched (false).

## Documentation surfaces (for plan 03-31)

`docs/system/` exists in this checkout but was not edited: the plan defers it to the phase's documentation plan, as plans 03-02 to 03-17 did. What it must cover:

- **Run transitions:** `running -> running` after an item blocks (next action `context-pack`, names the next item); `running -> blocked_on_decision` with reason `decision` and event data `decisionIds` (and `decisionId`, `class`, `itemId` when an item block moved it); `blocked_on_decision -> running` by the supervisor's pickup with event data `resumedFrom`; `running -> failed` with `undelivered` (item IDs) and `withdrawn` (decision IDs); `paused -> blocked_on_decision` and `paused -> running` after a resume finishes a block.
- **Run steps and checkpoints:** step `park` (`started` with the block descriptor, then `completed` with `ref`, `commit`, `tree`, `baseHead`, `paths`, `pathCount`), checkpoint `park` (after `classify` in `RUN_NEXT_ACTIONS.running`), step `launch:run` and its completed result carry `answeredDecisionId` for the attempt that carries an answer; fault points `mid-park` and `after-release:blocked`; the park ref `refs/avarice/park/<runId>/<itemId>` in the clone.
- **Attempts:** reason `answer` for the first attempt of an item after its decision was answered; the item's retry history starts there.
- **Decision record (item-local):** class from the signal (acceptance for a pause, permission for a denial, repeated_failure for no progress, a loop limit or a second failure, budget for a spent budget, permission for enforcement); options (the unit's numbered choices, free text when none, withdraw only for the non-pause classes); a consequence for each option; `affectedItems` is the item then its transitive dependents; `stateDigest` is `computeStateDigest`; the pause text is stored as the issue; the amend command keeps the `<decision-id>` placeholder until printed.
- **Pickup rule:** `isBlockedRunContinuable`: reason `decision`, the block came from `running` or `paused`, and an item is ready or no decision is open; the supervisor and `decide` share it. The supervisor releases its lease on a blocked run and re-reads before it returns.
- **Notices:** an item block queues one `decisions` notice (D-24); the supervisor flushes the queue at item boundaries when the window has passed and `notifyRunStop` raises one banner for all queued notices.
- **Prompt:** a fresh unit after an answer carries "You stopped to ask the owner a question earlier..." and the decision data line, the question it asked and the answer.
- **Findings to record:** a supervisor killed after the lease release of a blocked run leaves its queued notice pending (no banner); `resume` of a blocked run only reports it; `avarice inbox` still lists the decision.

## Issues Encountered

- `test/integration/claude-host.test.ts` ("follows SIGTERM with SIGKILL after the grace") failed once in the full parallel run (SIGTERM seen where SIGKILL was expected) and passed on its own and was not touched by this plan: a timing flake under load.
- The plan-commit ledger file (`gsd-plan-head-before-03-18`) was not written before the first commit; the base recorded here is the HEAD the plan started from (`711a323`), read from the start-of-run status.
- Commit trailers follow the harness attribution (Sonnet 5.5); the orchestrator prompt named another model line.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The new surface (a park ref in the run clone, a decision record built from model text stored as data, a supervisor pickup of a blocked run) is inside the plan's trust boundaries and T-03-33 to T-03-35.

## Threat mitigations

- **T-03-33:** the readiness rule keeps B and D out while the decision is open; S-17 asserts no commit touches either and D never starts.
- **T-03-34:** block, release, re-check with the pickup rule shared with `decide`; tested with an answer landing in the release window and a kill at `after-release:blocked`.
- **T-03-35:** the delta is parked before the next item runs and the commit set is the item's own snapshot; the strays check still refuses a commit with an outside path.

## Next Phase Readiness

Ready for 03-19 (`decide`, using `isBlockedRunContinuable` and the record fields above) and 03-22 (the resumed-session path in front of the fresh unit; the park step and `latestParkOf` give the record to unpark, and the fresh unit stays the fallback). Requirements AUT-1 to AUT-4 are declared by other incomplete plans, so none is marked complete here.

## Self-Check: PASSED

Created files exist (park.ts, schedule.ts, the helper, the two test files, three RED evidence files); commits `f17e6fd`, `8d0c999`, `52ee818`, `2d48e0d` and `7715f55` are ancestors of HEAD; `npx tsc -p .` and `scripts/check-boundaries.ts` are clean; the plan's verification set (72 tests: run-independent-work, run-park, run-scheduler, run-supervisor, run-killpoints) passes; the unit suite (1801) passes; the integration and fault suites pass except one load flake that passes alone.
