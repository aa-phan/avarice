---
phase: 03-decisions-independent-work-and-amendments
plan: 26
subsystem: testing
status: complete
tags: [offline-gate, exit-runs, s-18, aut-4, lost-wakeup, race, kill-points, reconcile, resume, d-03, d-04]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "independent work and the item-local block (03-18), repair and gates (03-19), the notification service and digest (03-16, 03-23), decide (03-20), the answered item's session resume (03-22), contract amend (03-15), cancel (03-24), the decide prompt (03-25)"
provides:
  - "the three D-03 exit runs offline through the CLI with the fake host (block and resume; an amendment between question and answer; a failing notifier, a passed batch window and a passed digest)"
  - "S-18 offline: 72 hours of injected clock, a digest at every digest time, every delivery failing, and the decision row byte-identical, every table but the notifications unchanged, D never attempted"
  - "AUT-4 boundaries: the batch window at 599999, 600000 and 600001 ms and a digest time at 12:29, 12:30 and 12:31 change notification rows only"
  - "the lost-wakeup race suite: six orderings of an answer against the supervisor, each ending ready_for_review with one resumed launch of B"
  - "kill-point coverage of the running, verifying and paused stages over the union of the five lists, and RECONCILE_KILL_POINTS with its own suite"
  - "`avarice resume` continues a blocked run whose decision was answered (a defect the race suite found)"
  - "03-26-offline-suite.json: the offline gate record"
affects: [03-27, 03-28, 03-29, 03-31]

actuals:
  tokens: 25000
  tasks: 3
  commits: 4
plan_head_before: 40d02d5b76b619d6d50afbe8800e035b3373f23f
plan_head_after: b62786356aee604ea37b260ea84b73ad863cba1c
commits: 4

tech-stack:
  added: []
  patterns:
    - "A test process held at a fault point: AVARICE_TEST_HOLD in the test CLI turns the SIGKILL of a fault point into a wait on a go file, so a test writes in the exact window between two writes of a detached supervisor, then lets it go (or kills it there)"
    - "AVARICE_TEST_EXIT_LOG in the test CLI records the exit code of every process, so the codes of detached supervisors no one waits for are readable"
    - "A lease sampler (watchLease) reads the run's lease on a timer and the suite checks the fences only grow and that no holder reappears after another held the lease"
    - "A movable clock that follows real time and adds an offset, so hours pass between two calls while leases and git keep working"

key-files:
  created:
    - test/integration/phase3-exit-offline.test.ts
    - test/integration/run-silence.test.ts
    - test/fault/decide-race.test.ts
    - test/fault/run-reconcile.test.ts
    - test/unit/killpoint-coverage.test.ts
    - test/helpers/decide-cli.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-26-offline-suite.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-26-red-evidence-task3.json
  modified:
    - test/helpers/fault-run.ts
    - test/helpers/test-cli.ts
    - src/app/run-resume.ts
    - src/cli/commands/resume.ts
    - docs/system/cli-reference.md
    - docs/system/runs.md

key-decisions:
  - "A blocked_on_decision run that isBlockedRunContinuable is resumable: `decide` starts no supervisor while a live lease is held, so an answer written under the lease of a supervisor that then died waited for nobody (nothing polls); `resume` now takes such a run through the live-lease refusal and the spawn, and `resume --wait` lets the supervisor take the run up before it judges the stop state, as `decide --wait` does"
  - "The paused stage's `reconcile` checkpoint had no kill point; RECONCILE_KILL_POINTS names it and test/fault/run-reconcile.test.ts kills a resume there and resumes again, after a unit in flight and after a verification in flight"
  - "The kill-point lists stay separate (RUN_KILL_POINTS, PARK_KILL_POINTS, RESUME_KILL_POINTS, CANCEL_KILL_POINTS, RECONCILE_KILL_POINTS) because the main kill suite runs every RUN_KILL_POINTS entry against one reference run; the coverage test checks the union and that each list is imported and run by its own suite"
  - "A passed deadline has no code path: the tests move an injected clock past the batch window and the digest times and check the decision row and every non-notification table are unchanged"

requirements-completed: []

coverage:
  - id: D1
    description: "The three exit runs of D-03 pass offline through the CLI: run 1 blocks B, completes the independent items, answers with `decide <id> 1`, resumes B's own recorded session and reaches ready_for_review with four commits; run 2 amends the contract between question and answer, the answer to the old decision exits 3 naming the re-opened one and applies nothing, and a second answer finishes the run with one stale and one answered decision; run 3 fails every delivery through a failing osascript path, passes the batch window and a digest time, shows the decision open with a failed notification in inbox and status, and an answer finishes the run"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/phase3-exit-offline.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "S-18 offline: with an open decision and a notifier that fails every delivery, 72 hours pass on an injected clock with a digest at every digest time and the batch window flushed; the decision row is byte-identical, answered_at, answered_by, answer and answer_channel stay NULL, every table but the notifications is unchanged, D has no attempt, and inbox and status list the decision with the failed notification"
    requirement: "AUT-4"
    verification:
      - kind: integration
        ref: "test/integration/run-silence.test.ts#S-18 offline: 72 hours of silence with a notifier that fails every delivery approve nothing (AUT-4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUT-4 boundary: at 599999, 600000 and 600001 ms after the first notice and at 12:29, 12:30 and 12:31 local, the decision row is byte-identical and only notification rows change"
    requirement: "AUT-4"
    verification:
      - kind: integration
        ref: "test/integration/run-silence.test.ts#AUT-4 boundary"
        status: pass
    human_judgment: false
  - id: D4
    description: "Lost-wakeup race: an answer before the block, between the block and the release, between the release and the look (the second supervisor finishing first, and the first looking again at once), and after a kill at the block (under the dead supervisor's live lease, continued by resume; after the lease lapsed, started by decide) always ends with the run ready_for_review, one resumed launch of B, five invocations charged, each item committed once, lease fences only growing, and every supervisor exiting 0 or 3"
    requirement: "AUT-3"
    verification:
      - kind: fault
        ref: "test/fault/decide-race.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every checkpoint the running, verifying and paused stages write has a kill point in the union of the five lists, each list is imported and run by its own suite, the literal checkpoint names the stages commit are all in RUN_NEXT_ACTIONS, and a resume killed at the reconcile checkpoint resumes to the uninterrupted result"
    requirement: "AUT-12"
    verification:
      - kind: unit
        ref: "test/unit/killpoint-coverage.test.ts"
        status: pass
      - kind: fault
        ref: "test/fault/run-reconcile.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "The offline gate passes: the new files, the kill-point suites and the whole suite (3461 tests, 3401 pass, 0 fail, 60 skipped), recorded in 03-26-offline-suite.json"
    requirement: "AUT-5"
    verification:
      - kind: command
        ref: "npm test"
        status: pass
    human_judgment: false

duration: about 70 min (approximate; the start time was not captured, estimated from the previous plan's end at 13:29Z and this plan's last commit at 14:40Z)
completed: 2026-11-09
---

# Phase 3 Plan 26: the offline gate before live spend Summary

**The phase's success criteria hold offline end to end: the three D-03 exit runs through the CLI, 72 hours of silence with a failing notifier approving nothing, six orderings of the `decide` race ending with one continuation, and a kill point for every running, verifying and paused checkpoint. The race suite found one real lost wakeup (a run killed at the block, answered under the dead supervisor's lease, was never picked up by `resume`), fixed RED-first.**

## Performance

- **Duration:** about 70 min (approximate)
- **Completed:** 2026-11-09
- **Tasks:** 3 (a tracer, S-18, the race and kill-point coverage)
- **Commits:** 4 task commits (the plan metadata commit follows)
- **Files:** 8 created, 6 modified

## Accomplishments

- **The exit runs (Task 1, tracer).** Run 1 is the four-item scenario with B asking: A and C complete, `decide <id> 1 --wait` starts the supervisor, which resumes the session the work item recorded (`resumeSessionId` equals `work_items.gsd_session`), the resumed unit sees B's parked file in the clone, and the run ends with four commits and one answered decision. Run 2 adds an `--add-write` amendment between the question and the answer: version 2 is recorded by the owner, stale G2 rows are appended, `decide <old> 1` exits 3 naming the successor and starts nothing, and `decide <new> 1` finishes the run. Run 3 uses a profile whose osascript path is a script that exits 1 and a one-minute batch window: three attempts are recorded per notice row, the clock moves to the next digest time, the digest fails and is recorded, the decision is open in `inbox --json` and `status --json` with a failed notification, and an answer finishes the run. All three passed on first execution (tests only).
- **S-18 and the boundaries (Task 2).** The 72-hour test steps an injected clock through every 12:30 and 17:30 (six digests) and the batch window; every delivery fails (21 attempts), no banner carries a decision ID or the question text, and a comparison of every table except the notifications (and the `notify.*` events) before and after is equal. The boundary cases are six separate tests: the batch window at 599999 (nothing happens, the notice stays pending, no banner tried), 600000 and 600001 ms (due, three failed attempts), and a digest at 12:29, 12:30 and 12:31 with `nextDigestAt` checked at each minute.
- **The race (Task 3).** Six tests with the real detached supervisor and the real `decide`: the answer lands while the supervisor runs C (no supervisor started, the live supervisor takes B next, one lease ever taken); between the block and the release (no supervisor started, the same supervisor takes the lease a second time); between the release and the look, once with the second supervisor finishing before the first looks (the first exits cleanly) and once with the first looking at once (one of two takes the lease, the other leaves); and after a kill at the block, once under the dead supervisor's live lease (decide starts nobody; `resume` continues once the lease lapses) and once after it lapsed (decide starts the supervisor). Every case asserts one resumed launch of B, five launches and five invocations charged with none reserved, one answered decision, each item committed once, no step or attempt left open, lease fences non-decreasing with no holder returning after another, and every supervisor exit code 0 or 3 (the test CLI logs them).
- **Kill-point coverage.** `test/unit/killpoint-coverage.test.ts` checks `after-checkpoint:<action>` for every entry of `RUN_NEXT_ACTIONS.running`, `.verifying` and `.paused` against the union of the lists, that an action outside RUN_KILL_POINTS sits in the list of its own scenario (park, unpark, reconcile) and nowhere in RUN_KILL_POINTS, that the counted and mid points (`mid-park`, `mid-unpark`, `mid-cancel`, `after-release:blocked`) are present, that each list is imported and run by its own suite, and that every literal checkpoint name the stages commit is listed. The kill suites (27 AC-3 cases of run-killpoints, park, resume-session, cancel and the new reconcile suite) pass: 76 of 76 with the race and coverage files.

## Task Commits

1. **Task 1: the three D-03 exit runs** - `16db833` (test; tests only, no RED to record)
2. **Task 2: S-18 and the AUT-4 boundaries** - `386de26` (test; tests only)
3. **Task 3: race, coverage, reconcile suite** - `82cbc65` (test, RED: the kill-at-the-block case failed), `b627863` (fix, GREEN)

**Plan metadata:** the docs commit that carries this file, 03-26-offline-suite.json, STATE.md and ROADMAP.md.

## TDD gate

- Tasks 1 and 2 add tests over code that already exists; they passed when first run, as the plan expects ("a failure is a defect"). A mutation spot check was not run.
- Task 3 RED `82cbc65`: `under the lease it still holds` failed with `resume` exiting 3 and printing `blocked_on_decision (decision)` (`03-26-red-evidence-task3.json` holds the TAP output and exitCode 1). The other five orderings passed.
- Task 3 GREEN `b627863`: the whole race file 6 of 6 after the fix (the first fix, in `resumeRun` alone, made `resume` spawn a supervisor but `resume --wait` returned at once on the stop state, so the wait was fixed second; one commit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A blocked run answered under a dead supervisor's lease was never continued**
- **Found during:** Task 3 (the kill-at-the-block ordering)
- **Issue:** `decide` starts a supervisor only when no live lease is held. A supervisor killed right after it moved the run to blocked_on_decision keeps its lease until it lapses; an answer written meanwhile starts nobody, and afterwards `avarice resume <run>` reported the blocked run as a stop state ("only reported, no lease, nothing changed"). Nothing polls, so the run stayed blocked with its decision answered: the lost wakeup of research Pitfall 3, through a window the plan's three live-process orderings do not close.
- **Fix:** `resumeRun` treats a `blocked_on_decision` run that `isBlockedRunContinuable` as resumable (the live-lease refusal and the spawn then apply as for any interrupted run); `resume --wait` lets the supervisor take a blocked run up before it judges the stop state, as `decide --wait` already does. A blocked run with nothing to continue is still only reported.
- **Files modified:** src/app/run-resume.ts, src/cli/commands/resume.ts, docs/system/cli-reference.md, docs/system/runs.md
- **Commit:** b627863

**2. [Rule 2 - Missing critical] The paused stage's `reconcile` checkpoint had no kill point**
- **Found during:** Task 3 (the coverage test over `RUN_NEXT_ACTIONS.paused`)
- **Issue:** the orchestrator's reading of the plan's coverage truth requires every checkpoint of the running, verifying and paused stages to have a kill point in the union of the lists. `reconcile` is written only by a resume, which no list reached.
- **Fix:** `RECONCILE_KILL_POINTS` (`after-checkpoint:reconcile`) in test/helpers/fault-run.ts and test/fault/run-reconcile.test.ts, which kills a unit in flight and a verification in flight, kills the first resume at the reconcile checkpoint, resumes again, and compares the result with an uninterrupted run (both pass).
- **Files modified:** test/helpers/fault-run.ts, test/fault/run-reconcile.test.ts
- **Commit:** 82cbc65

**3. [Rule 3 - Blocking] Test-only hooks and a shared helper outside the plan's file list**
- **Found during:** Task 3 and Task 1
- **Issue:** the plan's `files_modified` names test/helpers/fault-run.ts for "a hook that runs a callback at a named point", but a detached supervisor is another process: a callback in the test cannot run inside it. A kill cannot hold a window open either.
- **Fix:** test/helpers/test-cli.ts gains two env-gated hooks (AVARICE_TEST_HOLD turns the SIGKILL of the armed fault point into a wait on a go file; AVARICE_TEST_EXIT_LOG records every process's exit code), and fault-run.ts gains `makeHold`, `whenReached` (the callback hook), `watchLease` and `exitRecords`. No production file reads either variable; bin/avarice.ts is unchanged. test/helpers/decide-cli.ts (new) holds the in-process `decide`, `contract amend`, `inbox` and `status` drivers, the S-17 blocked-run starter and a movable clock that three of the new files share.
- **Files modified:** test/helpers/test-cli.ts, test/helpers/fault-run.ts, test/helpers/decide-cli.ts
- **Commits:** 16db833, 82cbc65

### Plan readings and judgment calls

**4. Kill-point lists (orchestrator instruction).** The plan's coverage truth says "RUN_KILL_POINTS"; plans 03-18, 03-22 and 03-24 deliberately put their new points in PARK_KILL_POINTS, RESUME_KILL_POINTS and CANCEL_KILL_POINTS, because the main kill suite runs every RUN_KILL_POINTS entry against one reference run. They stay where they are. The coverage test checks the union of the lists (plus RECONCILE_KILL_POINTS, deviation 2) and that each list is imported and run by its own suite (run-killpoints iterates RUN_KILL_POINTS; the other four name every point).

**5. Run 3 and S-18 raise the banners in this process.** A real osascript failure takes three attempts at 0, 10 and 60 seconds, and the supervisor and the `digest` command sleep for real. The tests build the composition with an injected clock, the real osascript adapter pointed at a script that exits 1 (run 3) or a failing Notifier port (S-18 and the boundaries), and replace only `notify.sleep` so a wait moves the injected clock. `inbox`, `status`, `decide` and `contract amend` run through production main(); the digest is `runDigest`, the function the command calls, so the command wrapper's exit 70 on failure is covered by digest.test.ts and not repeated.

**6. "Before the block".** No fault point lies between a decision being written and the run's transition to blocked_on_decision, so that ordering is the answer landing while the supervisor is still running C (held at `after-checkpoint:launch:run#3`, C delegated, the decision open, the run running under a live lease), which is the window before the block in which `decide` can write. `pickupOf` answers `live-supervisor` there and the scheduler takes B next.

**7. Six race tests, not four.** The release-and-look window is tested with the second supervisor finishing first and with the first looking again at once (both are possible; the second makes the lease conflict real), and the kill at the block is tested under the dead supervisor's live lease (needs `resume`, deviation 1) and after the lease lapsed (decide spawns).

**8. Lease exclusivity as far as a sampler sees it.** The ledger records no lease event, so `watchLease` samples the run row every 15 ms and the suite checks the fences never fall, one fence has one holder, and no holder returns after another held the lease; a take shorter than the sampling interval is invisible to it. The final `lease_fence` is also asserted where it is known (1 for the supervisor that never released, 2 for the one that took the lease again after the look).

**Total deviations:** 1 Rule 1, 1 Rule 2, 1 Rule 3, 5 plan readings. **Impact:** the plan's truths hold; the lost-wakeup defect was fixed in the owning code.

## Issues Encountered

- A failing race test left a 15 ms sampler interval running, which kept the test process alive for minutes (a hang, not a failure). The sampler is `unref`ed and every test stops it in a `finally`.
- Observed, not asserted or fixed: when a second supervisor finishes the run before the first looks again (ordering 3, first case), the first supervisor's stale outcome is `blocked_on_decision`, so `notifyRunStop` finds no open decision and queues a `blocked-run` notice for a run that is already ready for review. By reading `src/cli/commands/supervise.ts` and `describeStop` in src/app/notify.ts; it is a stale banner, not a wrong run state. Worth a line in `docs/system/findings.md` and a look by the owner.
- No load-sensitive failure occurred: the full suite and the targeted command each ran once, with no rerun.
- Commit trailers follow the orchestrator prompt (Claude Opus 5.5); the harness attribution named another model.

## Documentation surfaces (for plan 03-31)

`docs/system/` was edited only where this plan changed built behavior (the run path of `resume` in cli-reference.md and runs.md, deviation 1). The phase's documentation plan carries the rest, as plans 03-02 to 03-25 did:

- **resume of a blocked run:** a `blocked_on_decision` run is continued by `resume` when an answer made an item ready or left no decision open and no live lease is held; with a live lease it is refused (exit 3, lease must expire first); `--wait` first lets the supervisor take the run up.
- **Findings to record:** the stale `blocked-run` banner of a supervisor that looks again after another finished the run (src/cli/commands/supervise.ts, src/app/notify.ts `describeStop`); `decide` starts no supervisor under a live lease whose holder may be dead, so an answer waits for the lease to lapse and for `resume` or another `decide` (a run killed at the block).
- **Test surface (operations-and-testing material):** the `RECONCILE_KILL_POINTS` list and its suite; the offline gate record 03-26-offline-suite.json; the test CLI's two env-gated hooks (not production variables, so not config-reference rows).

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The only production change narrows a lost wakeup (a blocked, answered run now has a path to a supervisor) and adds no process, port, file or surface; the two test CLI hooks are read only by test/helpers/test-cli.ts.

## Threat mitigations

- **T-03-50:** the race suite covers every ordering named in the plan plus the release-and-look order both ways; a duplicate launch of B is asserted absent (one launch with the answered decision's ID, five launches in all, five invocations charged); the lease sampler checks monotone fences and a single holder per fence; every supervisor's exit code is 0 or 3.
- **T-03-SC:** no package installs.

## Next Phase Readiness

The offline gate is green and recorded; live work (plan 03-27) may start. AUT-3, AUT-4, AUT-5 and AUT-12 are declared by other incomplete plans, so `requirements.ready-ids` reports 0 of 4 ready and none is marked complete here.

## Self-Check: PASSED

Created and modified files exist (the five new test files, test/helpers/decide-cli.ts, the two edited helpers, the two source files, the two doc files, the offline-suite record and the RED record); commits `16db833`, `386de26`, `82cbc65` and `b627863` are on the branch; `npx tsc -p .` and `node scripts/check-boundaries.ts` (97 files) are clean; the plan's targeted command passes (76 of 76) and `npm test` passes (3461 tests, 3401 pass, 0 fail, 60 skipped).
