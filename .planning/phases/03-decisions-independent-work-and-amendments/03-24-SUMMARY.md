---
phase: 03-decisions-independent-work-and-amendments
plan: 24
subsystem: run-supervisor
status: complete
tags: [cancel, aut-12, lease, abort, kill-points, pty, withdraw, s-20, owner-decision-3]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "requestRunCancel, RunRow.cancelRequestedAt and the cancel columns (03-12); withdrawDecision with reason cancel (03-02); the decide command's terminal identity rule and spawn pattern (03-20); the resume of an answered item and RESUME_KILL_POINTS (03-22); CommandExtras and the digest (03-23)"
provides:
  - "`avarice cancel <run> [--wait]`: cancels a run in any non-terminal state, with or without a live supervisor; exit 0 cancelled or requested, 3 a run that has ended or a wait that did not reach cancelled, 64 usage, refusal or unknown run, 70 internal"
  - "src/app/cancel.ts: cancelRun, finishCancel, cancelUnderLease, completeCancel, isCancelPending"
  - "the supervisor acts on a request: the lease timer aborts the unit, the attempt ends `cancelled`, the loop finishes the cancel before each stage, after each stage and at entry, and looks once more after releasing the lease"
  - "src/app/run-context.ts: makeRunContext and holderId, moved out of run-service.ts so the cancel and the supervisor commit through one fenced context; RunStageContext.cancelRequested"
  - "reapRunLaunches exported from run-resume.ts; fault points mid-cancel and after-cancel-request; CANCEL_KILL_POINTS and runOnTerminal in the fault helpers"
affects: [03-25, 03-31, 03-33]

actuals:
  tokens: 18300
  tasks: 3
  commits: 7
plan_head_before: 968aa7ada7b0c081ffdfe1e3b2cbffb49e53325e
plan_head_after: 43d623683e5068252289c71a508be9d2a1db915f
commits: 7

tech-stack:
  added: []
  patterns:
    - "A cancel is a request first and an act second: the request is committed before anything else is touched, the lease is looked at again after it, and whoever holds (or next takes) the lease carries it out, so a run with a request never goes on with work"
    - "finishCancel is idempotent: it withdraws only decisions still open, ends only attempts still open and moves a terminal run nowhere, so a cancel killed at any point is finished by a second `cancel` or by the next supervisor start"
    - "A unit aborted by the owner is told apart from one aborted by a lost lease: the lease timer sets one flag for the cancel, the context exposes it, and only the cancel path ends the attempt cancelled instead of failing the stage"
    - "A command that must be killed at its own fault point while it needs a terminal runs on a real pseudo-terminal (pty-drive.py) from the fault suite"

key-files:
  created:
    - src/app/cancel.ts
    - src/app/run-context.ts
    - src/cli/commands/cancel.ts
    - test/helpers/cancel-cli.ts
    - test/integration/run-cancel.test.ts
    - test/fault/run-cancel.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-24-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-24-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-24-red-evidence-task3.json
  modified:
    - src/app/run-service.ts
    - src/app/run-stages/item.ts
    - src/app/run-stages/stage.ts
    - src/app/run-resume.ts
    - src/cli/main.ts
    - test/helpers/fault-run.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "The request is always committed first, also when nobody holds the lease: a `cancel` that dies after withdrawing leaves a request standing, so `supervise` (not only `cancel` again) finishes it, and the run never resumes work"
  - "`cancel` looks at the lease after it records the request, and a supervisor looks at the row once more after it releases the lease; between the two, a request cannot be left with nobody to carry it out"
  - "A cancel with no live lease takes the run lease for its own work, capped at 60 seconds, so a cancel that dies never leaves a supervisor-length lease behind"
  - "A cancel with a live lease only records the request; the supervisor's lease timer (every ttl/3) aborts the unit, so the host is ended by the same abort path a lost lease uses, and the attempt ends `cancelled` with its invocation charged"
  - "A supervisor that starts on a run with a request standing cancels it before the prelude and every stage, after reaping any host the earlier holder left and charging its orphaned reservation (the cancel never runs a reconcile)"
  - "`cancel --wait` follows a requested cancel to `cancelled`; when the lease lapses with the run not cancelled (the supervisor died) it carries the cancel out itself"
  - "The kill points are CANCEL_KILL_POINTS, not RUN_KILL_POINTS: the kill suite runs every RUN_KILL_POINTS entry against a run that is never cancelled and asserts the count, as 03-18 and 03-22 did for their points"
  - "The footprint pin now names the cancel service as the one other caller of withdrawDecision, and pins that it withdraws only with reason `cancel` and never answers or reopens a decision"

patterns-established:
  - "cancel exit codes: 0 cancelled or requested; 3 the run has ended already (`already <state>`) or a --wait that did not reach cancelled; 64 usage, a refusal (AVARICE_RUN, no terminal, a run's process tree, not the owner's profile) or an unknown run; 70 internal or a reap that failed"

requirements-completed: [AUT-12]

coverage:
  - id: D1
    description: "`avarice cancel <run>` on the S-17 run blocked on B, with no live supervisor, exits 0 printing `run <runId>: cancelled; 1 decision withdrawn`, withdraws the decision with reason cancel, ends every attempt, moves the run to cancelled with the lease free, leaves the checkout digest equal and the run clone and its branch in place; a second cancel exits 3 `already cancelled` and writes nothing; `resume` reports the run stopped"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-cancel.test.ts#cancel: a run blocked on a decision, with no live supervisor, is cancelled from a terminal (tracer; AUT-12, S-20)"
        status: pass
    human_judgment: false
  - id: D2
    description: "cancel refuses under AVARICE_RUN, without a terminal on either stream and from a run's process tree, and for a missing, repeated, malformed or unknown run ID, each with exit 64 and no row written"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-cancel.test.ts#cancel refuses outside a person at a terminal, and writes nothing (CS-11, T-03-48)"
        status: pass
    human_judgment: false
  - id: D3
    description: "With a live supervisor whose unit hangs, `cancel --wait` prints `cancel requested` then `cancelled`; the lease timer aborts the unit, the attempt ends cancelled, no classify or discard checkpoint and no second launch:run step exists, the invocation stays charged (used 1, reserved 0), no gate judged the unit and no host process carrying the session remains"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-cancel.test.ts#cancel with a live supervisor in the middle of a unit: the unit is aborted, ended cancelled and never retried (AUT-12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A request that lands as item A finishes cancels the run before B launches (A committed, B, C and D still ready, one host call), and a supervisor that starts on a run with a request standing cancels it at entry with no stage and no unit"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-cancel.test.ts#cancel between items and at the start of a supervisor: no further unit is launched (AUT-12)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Edges: two open decisions are withdrawn in decision-ID order with two events; a run with no open decision, no lease and a surviving host is reaped and cancelled with nothing withdrawn and the invocation charged; a failed, closed or cancelled run exits 3 and writes nothing; a request committed right after the stage's transition applies to the new state, and a cancel that commits first fences the stage's transition out"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/fault/run-cancel.test.ts#ordering, #empty, #terminal, #adjacency"
        status: pass
    human_judgment: false
  - id: D6
    description: "Kill points: a supervisor killed at mid-cancel, and `cancel` itself killed at mid-cancel on a real pseudo-terminal, are finished by `cancel` again or by `supervise` with no second withdrawal, no new unit and one transition to cancelled; `cancel` killed at after-cancel-request leaves the request, and the next supervisor start cancels at entry, reaps the surviving host and launches nothing"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/fault/run-cancel.test.ts#mid-cancel, #after-cancel-request"
        status: pass
    human_judgment: false
  - id: D7
    description: "The cancel service withdraws decisions only with reason cancel and never answers or reopens one, and calls no file-deleting function; the footprint test pins the first and a grep shows the second"
    requirement: "AUT-12"
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts#the cancel service only withdraws, with the reason cancel, and never answers or reopens a decision"
        status: pass
    human_judgment: false
  - id: D8
    description: "That a cancel of a run driving a real model and a real contained host ends the unit and its process group in practice, and that the printed lines read well to the owner"
    requirement: "AUT-12"
    verification: []
    human_judgment: true
    rationale: "Offline the fake host proves the abort, the reap by session ID and the ledger, with the production reaper; no live run is cancelled mid-unit, and wording is the owner's call"

duration: about 41 min of work, plus about 40 min of full and fault suite runs
completed: 2026-11-09
---

# Phase 3 Plan 24: Safe cancellation of a run Summary

**`avarice cancel <run> [--wait]` cancels a run in any non-terminal state: with no live supervisor it reaps surviving hosts, withdraws every open decision in ID order and moves the run to cancelled; with one it records a request that the supervisor's lease timer turns into an abort, an attempt that ends cancelled and a cancel finished through its own fence. Nothing in the user's checkout or the run clone is touched, and a cancel killed at any point is finished by `cancel` or `supervise`.**

## Performance

- **Started:** 2026-11-09T12:14:31Z
- **Completed:** 2026-11-09T12:55Z (the commits; the suites ran about 40 minutes of that)
- **Tasks:** 3 of 3 (a tracer and two auto tasks, each with a RED commit)
- **Commits:** 7 (three RED, three GREEN, one test fix), plus the metadata commits
- **Files:** 16 touched (9 created including three RED records, 7 modified)

## Accomplishments

- **No supervisor (tracer).** `cancelRun` records the owner's request, looks at the lease again, and when nobody holds it takes the lease (at most 60 s), ends every `launch:*` step left started by reaping the host through its session ID (`reapRunLaunches`, the reap `resume` uses), charges the orphaned reservation, withdraws the open decisions in decision-ID order (reason `cancel`, one `decision.withdrawn` event each), ends the open attempt `cancelled`, moves the run to `cancelled` through the fenced context and releases the lease. A run that has ended is a `conflict` and nothing is written. The command refuses under the terminal identity rule before the profile resolves and then for a profile that is not the user's own.
- **A live supervisor.** `cancel` only records the request. The supervisor's lease timer reads the run row each tick (ttl/3) and aborts the unit's signal, as a lost lease does, but flags it as a cancel. After the host call returns, a cancel-flagged abort ends the attempt `cancelled` (the invocation was settled and stays charged) and returns without classifying, discarding, routing or retrying. The loop looks for a request before each stage, after each stage returns (before the no-progress check, and when a stage failed) and at entry, finishes the cancel through its fence and stops. After it has released the lease it looks once more.
- **Safe at any point.** `finishCancel` is idempotent. `mid-cancel` (after the withdrawals, before the transition) and `after-cancel-request` leave a request that `cancel` again, or the next `supervise`, finishes with one withdrawal in all, one transition to cancelled and no new unit; a supervisor start with a request standing cancels before its prelude, after reaping and charging.
- **Nothing lost (S-20, T-03-47).** The user's checkout digest is equal before and after, and the run clone directory, its HEAD and its branch are still there; `src/app/cancel.ts` calls no file-deleting function and no workspace method that changes files.

## TDD gate

- **Task 1 (tracer):** target test "exits 0 and prints one result line: the run is cancelled and one decision was withdrawn" failed (8 of 10: `unknown command 'cancel'`, exit 64); `RED_EVIDENCE_OK`. RED `71463bc`, GREEN `c683ef1`. **Tracer gate:** the task's verify re-run passed end to end before expansion (10 of 10): "Tracer verified end-to-end - expanding".
- **Task 2:** target test "`cancel --wait` records the request, says so, and follows the run to cancelled" failed on elapsed time (the unit hung for its whole 40 s limit); the between-items and entry cases failed on the final state and the launched-unit count; `RED_EVIDENCE_OK`. RED `0ef223b`, GREEN `6f18570`.
- **Task 3:** target test "running `cancel` again completes it with no second withdrawal" failed (the pty-driven command ran to the end instead of being killed); 4 of 14 failed, the ordering, empty, terminal and adjacency tests passing against the Task 1 and 2 code as edge guards; `RED_EVIDENCE_OK`. RED `6b2668e`, GREEN `6675145`.
- **Fix after the full suite:** `43d6236` (test only), see Issues Encountered.

## Task Commits

1. **Task 1: tracer, cancel of a blocked run with no live supervisor** - `71463bc` (test, RED), `c683ef1` (feat)
2. **Task 2: cancel with a live supervisor in the middle of a unit** - `0ef223b` (test, RED), `6f18570` (feat)
3. **Task 3: races, edges and kill points** - `6b2668e` (test, RED), `6675145` (feat)
4. **Suite fix:** `43d6236` (test)

## Files Created/Modified

- `src/app/cancel.ts` - `cancelRun`, `finishCancel`, `cancelUnderLease`, `completeCancel`, `isCancelPending`; the fault points
- `src/app/run-context.ts` - `makeRunContext`, `holderId` (moved from run-service.ts)
- `src/app/run-service.ts` - lease timer reads the request; the loop, entry and post-release checks
- `src/app/run-stages/item.ts` - an abort that is a cancel ends the attempt `cancelled`; `stage.ts` - `cancelRequested?()`
- `src/app/run-resume.ts` - `reapRunLaunches` exported; `src/cli/commands/cancel.ts`, `src/cli/main.ts` - the command and `COMMANDS`
- `test/integration/run-cancel.test.ts`, `test/fault/run-cancel.test.ts`, `test/helpers/cancel-cli.ts`, `test/helpers/fault-run.ts` (`CANCEL_KILL_POINTS`, `runOnTerminal`), `test/unit/footprint.test.ts`

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `makeContext` and `holderId` moved to `src/app/run-context.ts`**
- **Found during:** Task 1
- **Issue:** `cancelRun` needs the same fenced context the supervisor builds, and `run-service.ts` imports `cancel.ts` for `finishCancel`, so importing the private `makeContext` back would be a cycle.
- **Fix:** the function (renamed `makeRunContext`) and `holderId` live in a new module both import; `RunStageContext` gains an optional `cancelRequested()` (optional, because two existing tests build contexts by hand).
- **Files modified:** src/app/run-context.ts, src/app/run-service.ts, src/app/run-stages/stage.ts
- **Committed in:** c683ef1

**2. [Rule 1 - Bug] The live-supervisor cases could take the no-supervisor road under load**
- **Found during:** the full suite after Task 3 (2 failures: `launch:run (attempt 3) cannot be reaped: the host has no reap`)
- **Issue:** the fake unit blocks the supervisor's event loop for about a second, and the suite's 400 ms lease could lapse, so `cancel` saw no live lease, took the road that reaps, and the in-process command had a host with no reap. The code is right (a lapsed lease is another holder's to take, and the cancel fences the old supervisor out); the cases assumed a live supervisor.
- **Fix:** those cases start their supervisor with a 3 s lease, wait 4.5 s for a killed one to lapse, and pass the in-process cancel a host with a reap.
- **Files modified:** test/fault/run-cancel.test.ts, test/integration/run-cancel.test.ts
- **Committed in:** 43d6236

### Plan wording and judgment calls

**3. Kill points not added to `RUN_KILL_POINTS`.** The plan says to add them; `test/fault/run-killpoints.test.ts` runs every entry against the single-item reference run and asserts the count, and a run that is never cancelled never reaches them. They are `CANCEL_KILL_POINTS` beside `PARK_KILL_POINTS` and `RESUME_KILL_POINTS`, named by `test/fault/run-cancel.test.ts` (which is also in the kill-point verify set).
**4. The request is committed first even when nobody holds the lease** (the plan's order is request only for a live lease). It lets `supervise`, not only `cancel`, finish a cancel that died after withdrawing.
**5. Two kill points are driven on a real pseudo-terminal** (`runOnTerminal`, python3), because `cancel` refuses without one and the point kills its own process; the cases skip with a reason when python3 is missing.
**6. Three small additions outside the plan's file list:** `test/helpers/cancel-cli.ts` (shared reads), the footprint pin (`test/unit/footprint.test.ts` named the cancel service as a future caller), and the cancel's 60 s lease cap.
**7. `docs/system/` not edited.** The directory exists in this checkout, but as in plans 03-07 to 03-23 the surfaces are listed below for the documentation plan 03-31.

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug in the cases), 5 judgment calls. **Impact:** none on the plan's truths.

## Issues Encountered

- The full suite (3401 tests, 787 s) had two failures, both of the load-sensitive live-supervisor cases of this plan, fixed in `43d6236`; the other 3339 passed and 60 skipped. After the fix both new files pass 31 of 31, and the plan's verification set (run-cancel integration and fault, run-supervisor, run-lease-loss, run-killpoints, run-resume, resume-reap, decide, run-independent-work) passes.
- A race this plan found and closed rather than left: a request that lands after the supervisor's last look and before its release. `cancel` looks at the lease after it records the request, and the supervisor looks at the row after it releases the lease, so one of the two always sees the other.
- Compound shell commands with a heredoc or several `git` calls were refused by the session's command checks; the files were written with the Edit and Write tools and the checks were split.

## Documentation surfaces

For plan 03-31 (and `docs/system/findings.md` entries for plan 03-33):

- **Command:** `avarice cancel <runId> [--wait]` (refuses `AVARICE_RUN`, a non-terminal stream and a run's process tree before the profile resolves; owner's own profile only). Output: `run <runId>: cancelled; N decision(s) withdrawn` when it carried the cancel out; `run <runId>: cancel requested` when a supervisor holds the lease, then with `--wait` `run <runId>: cancelled`. Exit 0 cancelled or requested; 3 `run <runId> is already <state>` (failed, cancelled, closed) or a wait that ended with the run not cancelled; 64 usage, refusal or `no run`; 70 internal or a reap that failed. COMMANDS grows from 14 to 15. **Findings line for 03-33:** `avarice cancel` is not in the proposal's CLI table (owner decision 3 of 2026-11-08), at `src/cli/commands/cancel.ts:1`.
- **States and rows:** every non-terminal state may move to `cancelled`; the run row's `cancel_requested_at` and `cancel_requested_by` (03-12) are written by the first request; the open attempt ends with outcome `cancelled`; the run transition to `cancelled` carries `{ withdrawn }`, a next action `none` and no reason; the work items, the park refs, the clone and its branch are left as they were.
- **Events:** `run.cancel_requested { runId, requestedBy }` (03-12), `decision.withdrawn { runId, decisionId, reason: 'cancel' }` once per decision in decision-ID order, `attempt.ended { outcome: 'cancelled' }`, `invocation.reaped` and `invocation.interrupted` when a host was reaped, `run.transition { to: 'cancelled', withdrawn }`; no new event kind and no new table.
- **Supervisor behavior:** the lease timer (ttl/3) reads the run row and aborts the unit on a request; an aborted unit is neither classified nor retried nor discarded and its invocation stays charged; the loop checks before each stage, after each stage, after a failed stage and at entry (before the prelude, after the reap and the orphan charge); after the lease is released the supervisor looks once more; `cancel` looks at the lease after recording the request; the cancel's own lease is at most 60 s.
- **Fault points:** `after-cancel-request`, `mid-cancel` (env `AVARICE_FAULT`), `CANCEL_KILL_POINTS` in the fault helpers; the recovery is `cancel` again or `supervise`.
- **Coverage counts that move:** CLI commands +1; run states entered by a command: `cancelled`; fault points +2; attempt outcomes: `cancelled`.
- **Residual to record as a finding:** a cancel requested while a live supervisor runs only reaches `cancelled` when that supervisor's next tick or check sees it; a supervisor stopped but not dead (a stopped process holding a fresh lease) leaves `cancel` at `cancel requested` until the lease lapses, and `cancel --wait` finishes it then.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-03-47 (data loss): `cancel` writes ledger rows only, the checkout digest is asserted equal and the clone, its HEAD and its branch asserted present, and a grep finds no `rmSync`, `unlinkSync` or `rmdirSync` in `src/app/cancel.ts`. T-03-48 (the run cancelling itself, a racing transition undoing a cancel): `refuseOutsideTerminal` before the profile resolves (tested for the run marker, a pipe on each stream and a run's process tree), the version guard and lease fence on every transition (the adjacency tests), an idempotent `finishCancel` and the kill-point tests. T-03-SC: no package installs.

## Next Phase Readiness

Ready for 03-25 and for the documentation plan 03-31 (surfaces above). Requirement AUT-12 is declared by other incomplete plans of the phase, so `requirements.ready-ids` reports 0 of 1 ready and REQUIREMENTS.md is not changed here.

## Self-Check: PASSED

- The nine created files (three sources, the helper, two test files and three RED records) exist on disk.
- Commits `71463bc`, `c683ef1`, `0ef223b`, `6f18570`, `6b2668e`, `6675145` and `43d6236` are ancestors of HEAD; `git rev-list --count 968aa7a..HEAD` gave 7 before this file was committed, matching `commits: 7`.
- `npx tsc -p .` reports no error and `node scripts/check-boundaries.ts` is ok (97 files); `grep -nE "rmSync\(|unlinkSync\(|rmdirSync\(" src/app/cancel.ts` prints nothing.
- The plan's verify commands pass: the three tasks' sets (`run-cancel` integration 17 tests, `run-cancel` fault 14 tests, `run-supervisor`, `run-lease-loss`, `run-killpoints`: 62 of 62 for the kill-point verify) and the unit directory (1826 of 1826 before the footprint test grew by one case).
- The full `node --test` run before the last fix: 3339 pass, 60 skipped, 2 failures, both the live cases fixed in `43d6236` and passing since.
