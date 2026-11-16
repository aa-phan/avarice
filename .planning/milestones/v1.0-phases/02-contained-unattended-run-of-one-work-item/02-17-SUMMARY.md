---
phase: 02-contained-unattended-run-of-one-work-item
plan: 17
subsystem: run-kernel
tags: [resume, kill-points, ac-3, reap, reconcile, s-3, con-13, con-16, nfr-6, fake-run-host]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-12 run supervisor and lease, 02-13 running and verifying stages with the mid-commit, mid-verify and mid-handoff fault points, 02-15 interrupted status, 02-16 discardAttempt and the one CON-16 retry"
provides:
  - "src/app/run-resume.ts: reconcileRun (the supervisor prelude: reap, spend orphaned reservations, reconcile by state) and resumeRun"
  - "avarice resume <run_id> [--wait]: spawns the detached supervisor; `onb_` IDs keep the Phase 1 path; supervise always runs the prelude"
  - "src/app/run-stages/item.ts reconcileItem: an interrupted attempt is read as inconclusive, discarded and retried once; the supervisor's own commit is recognised by its Avarice-Run and Avarice-Attempt trailers; a foreign commit blocks"
  - "RunWorkspace.headTrailers; budget.ts chargeRunOrphans"
  - "test/helpers/fault-run.ts: RUN_KILL_POINTS (24), runRunWithFault, resumeRunCli, normalizeRunResult, runStatusJson, ledgerInterruption"
  - "Tests: test/fault/run-killpoints.test.ts (AC-3 24/24), test/fault/run-budgets.test.ts, test/integration/run-resume.test.ts"
affects: [02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 98000
  tasks: 3
  commits: 3
plan_head_before: 5c50c9f1ea937b251b366e061bcdf45e8d48bd48
plan_head_after: 735668499d0a376056fcb48c273ad64a11895820
commits: 3

tech-stack:
  added: []
  patterns:
    - "Resume is one ordered prelude under the lease: reap by session ID (every reap before any row is marked), spend the dead supervisor's reservations, then reconcile by state; a failed prelude records a failed `resume:reconcile` step, which `resume --wait` reads to exit 70"
    - "An interrupted unit is never reconstructed from its transcript: it is classified inconclusive, put back to its own snapshot and retried once; an attempt that never launched a unit is not a failure and does not use the retry"
    - "A commit on the clone is the item's only when its trailers name this run and the open attempt (T-02-57); the hand-off is repeated idempotently when its record is missing"

key-files:
  created:
    - src/app/run-resume.ts
    - test/integration/run-resume.test.ts
    - test/fault/run-killpoints.test.ts
    - test/fault/run-budgets.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-17-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-17-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-17-red-evidence-task3.json
  modified:
    - src/app/budget.ts
    - src/app/run-stages/item.ts
    - src/app/run-stages/finish.ts
    - src/adapters/git/run-workspace.ts
    - src/ports/run-workspace.ts
    - src/cli/commands/resume.ts
    - src/cli/commands/start.ts
    - src/cli/commands/supervise.ts
    - src/cli/spawn-supervisor.ts
    - test/helpers/fault-run.ts
    - test/helpers/fake-run-host.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "A kill during an invocation is reconciled as inconclusive (discard and the one retry), not reconstructed: the conservative reading of the recovery table, costing at most one retry"
  - "The mid-handoff kill point moved between the fetch and its record (the window where an external effect is unrecorded), so resume repeats the idempotent fetch (created false); the old position after the record is now `mid-handoff#2`"
  - "A resume spends the orphaned reservation of a killed invocation as soon as it has reaped, so a retry that is then refused (invocations=1) still shows the killed invocation as used (CON-13)"
  - "An attempt with no launch:run step ran nothing: it is not classified, not counted in the attempt history, and does not use the item's one retry"
  - "A prelude failure is reported through a failed `resume:reconcile` run step; `resume --wait` turns it into exit 70, a second kill of the supervisor stays exit 3"

requirements-completed: [FR-7, NFR-6, CON-13, FR-2]

coverage:
  - id: D1
    description: "A run killed during verification is shown paused (verification interrupted); resume moves it verifying -> paused -> verifying, inserts an inconclusive row for each check of the interrupted pass without a completed row, re-verifies on the same commit and reaches ready_for_review, printing the interrupted attempt equal to the ledger's open attempt (S-3)"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a run killed during verification is shown paused, then re-verified on resume (S-3, AC-3; tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AC-3: for each of the 24 points of RUN_KILL_POINTS the run is never shown ready_for_review before resume, resume identifies the interrupted attempt (or the interrupted action when none is open) as the ledger holds it, and the resumed run has the same committed tree, file list, evidence statuses and gate verdicts as an uninterrupted run"
    requirement: "NFR-6"
    verification:
      - kind: integration
        ref: "test/fault/run-killpoints.test.ts (prints `AC-3: 24/24 interrupted attempts identified`)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A surviving host is reaped by session ID before anything is reconciled (ordering edge); a reap that fails stops the resume with exit 70, the launch still started, the host alive and the clone untouched"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a supervisor killed inside the unit leaves its host running"
        status: pass
    human_judgment: false
  - id: D4
    description: "The supervisor's own commit made before the kill is recognised by its trailer and kept without a second commit; a commit with no matching trailer blocks with enforcement_failure; an interrupted hand-off is repeated idempotently"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a supervisor killed between the commit and its record; #a commit on the clone that the supervisor did not make; #a supervisor killed between the fetch and its record"
        status: pass
    human_judgment: false
  - id: D5
    description: "Budgets persist across the kill: the killed invocation is charged (2 invocations used, cost at least its reservation), limits unchanged, nothing refunded; with invocations=1 the retry is refused as a budget_exhausted decision and the killed invocation stays spent"
    requirement: "CON-13"
    verification:
      - kind: integration
        ref: "test/fault/run-budgets.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Adjacency, empty and concurrency edges: killed between the two commits of `context-pack`, killed at the baseline checkpoint, and resume while another holder has a live lease (exit 3, `lease must expire first`, nothing changed)"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts (edges, and the live-lease test of the tracer describe)"
        status: pass
    human_judgment: false
  - id: D7
    description: "CON-16 is only partly demonstrated by this plan: the discard of a crashed unit killed at its discard-attempt checkpoint resumes and retries; requirements.ready-ids reports CON-16 blocked (other plans of the phase still own it), so it is not marked complete here"
    requirement: "CON-16"
    verification:
      - kind: other
        ref: "test/integration/run-resume.test.ts#a unit that crashed and a supervisor killed at its discard-attempt checkpoint"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real `claude` host's detached process tree, its session-ID command line and a real kill are not exercised: the fake host leaves a node process carrying `--session-id` and the production reapBySessionId ends it"
    requirement: "FR-7"
    verification:
      - kind: other
        ref: "live cases of plans 02-20 and 02-21"
        status: unrun
    human_judgment: true
    rationale: "Offline the survivor is a stand-in; whether a real host's children all carry the session ID and are found by the reap is observed only live"

duration: about 2 h
completed: 2026-11-06
---

# Phase 2 Plan 17: Resume and the AC-3 kill-point suite Summary

**Killing the supervisor anywhere and running `avarice resume <run_id>` continues the run: surviving hosts are reaped by session ID first, an interrupted unit is discarded to its snapshot and retried once, the supervisor's own commit is recognised by its trailer, a verification killed mid-pass is shown paused and re-verified, and across 24 kill points the interrupted attempt is identified 24 of 24 times with a result equal to an uninterrupted run**

## Performance

- **Duration:** about 2 h (the clock at plan start was not recorded; completed 2026-11-06)
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto)
- **Files:** 3 task commits (about 98 000 tokens by chars/4 over the diff)

## Accomplishments

- **Tracer (S-3).** With `AVARICE_FAULT=mid-verify` the detached supervisor dies after the first of two checks. `start --wait` exits 3, `status` shows `paused (verification interrupted)`, `resume <id> --wait` prints `resuming from verifying (next: verify:checks)`, `interrupted attempt <att> at verify:checks` and `ready_for_review`. The ledger shows `verifying>paused (verification interrupted)`, `paused>verifying`, `verifying>ready_for_review`; the check without a completed row has an `inconclusive` row, then both checks pass again at the same commit, which is the one handed off.
- **Resume entry.** `resume` dispatches by prefix: `run_` continues a run, anything else is the unchanged Phase 1 path. A live lease is refused (exit 3, `lease must expire first`, nothing changed); a stop state is reported without a lease; `--wait` follows the run; an unknown run is exit 64. `supervise` always runs the `reconcileRun` prelude.
- **Reap first.** Every `launch:*` step left `started` is ended by its session ID before any row is marked or the clone is read; a failing reap exits 70 with every row still `started`, the host alive and the clone byte-identical. Events: `invocation.reaped`, then `invocation.interrupted` naming the invocation (the budget's orphan event cannot).
- **Interrupted unit.** Item `delegated` is read as inconclusive: classification recorded, clone back to the attempt's snapshot, one retry (attempt `con16-retry`); a second interruption is a repeated_failure decision; a moved HEAD is enforcement_failure. The run is shown `running>paused (interrupted)>running` around it.
- **Commit and hand-off.** A commit made before the kill is recorded from its `Avarice-Attempt` trailer with no second commit; an amended commit without the trailer blocks with `enforcement_failure` and hands nothing off. The hand-off is repeated with `created: false`.
- **Budgets (CON-13).** The orphaned reservation of a killed invocation is spent as soon as it is reaped: 2 invocations after the retry, cost at least the reservation, every limit unchanged, nothing refunded; with `invocations=1` the retry is refused (`budget_exhausted`) and the killed invocation shows as used.
- **AC-3.** `test/fault/run-killpoints.test.ts` kills a run at each of 24 points (one profile per point, serial, lease 400 ms plus a 1.5 s margin), checks the store's integrity, that status names the ledger's open attempt, step and action, that resume prints the same, and that the committed tree, file list, evidence statuses and gate verdicts equal an uninterrupted run. Output: `AC-3: 24/24 interrupted attempts identified`.

## Task Commits

1. **Task 1 (tracer): resume, reap, verification reconcile** - `59eebe0` (feat)
2. **Task 2: reconcile an interrupted unit, commit and hand-off** - `420271d` (feat)
3. **Task 3: AC-3 suite and budgets** - `7356684` (test)

`commits: 3`, measured as `git rev-list --count 5c50c9f1ea937b251b366e061bcdf45e8d48bd48..HEAD` before this summary commit.

RED evidence: `02-17-red-evidence-task1.json` (10 tests, 4 pass, 6 fail at the base), `-task2.json` (24 tests, 16 pass, 8 fail against the Task 1 commit with the item reconcile a stub), `-task3.json` (the suite run against a scratch copy of the plan base source: mid-verify and mid-commit fail).

Tracer gate (config absent, `end-of-phase`, automated-only verify): the verify command was re-run after Task 1 (46 tests pass) and expansion continued.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Helpers landed in Task 1**
- The tracer test needs `runRunWithFault`, `resumeRunCli` and the fake host's reap and kill-in-unit options, which the plan lists under Tasks 2 and 3. They were written in Task 1 (`fault-run.ts`, `fake-run-host.ts`); Task 3 extended them (`mid-handoff#2`, `extraArgs`).

**2. [Rule 1 - Bug] mid-handoff fired after the hand-off was recorded**
- **Issue:** plan 02-13 placed the point after the step record, so no kill could leave the fetch unrecorded and nothing was "repeated idempotently".
- **Fix:** `mid-handoff` now sits between the fetch and its record; `mid-handoff#2` keeps the old position. Both are in RUN_KILL_POINTS (24 entries). **Files:** src/app/run-stages/finish.ts. **Commit:** 420271d.

**3. [Rule 2 - Missing critical] Orphaned reservation spent at resume**
- A retry refused for budget left the killed invocation `reserved`, not `used`, so status under-reported spend. `chargeRunOrphans` (budget.ts, shared code path with the reservation) spends it right after the reap. **Commit:** 7356684.

**4. [Rule 1 - Bug] An attempt that never launched burned the retry**
- A kill at `after-checkpoint:launch:run` (no unit started) would have counted as a failed attempt. Attempts with no `launch:run` step are not classified and are left out of the history. **Commit:** 7356684.

**5. [Rule 3 - Blocking] Footprint control**
- `test/unit/footprint.test.ts` listed `start.ts` as the only importer of the detached-spawn module; `resume.ts` is a second, as the plan requires. The control's real rules (one detached spawn, fixed arguments) are unchanged. **Commit:** 7356684.

**6. [Rule 1 - Test defect] Survivor lifetime**
- The fake host's survivor process lived 120 s; under the full suite the describes' setup took longer and the survivor expired before its test. It now lives 30 min and every suite ends its survivors in `after`. No product code involved.

### Plan inconsistencies reconciled

**7. [Plan note] `resume` exit 70 for a failed reap**
- The supervisor is detached, so its exit code is lost. The prelude records a failed `resume:reconcile` step and `resume --wait` reports it (exit 70); a supervisor killed again with no such step stays exit 3.
**8. [Plan note] RUN_KILL_POINTS has 24 entries, not the plan's 23-plus**
- The plan's list plus the two `mid-handoff` forms; `context-pack` appears as the plain, `#2` and `after-transition:running` forms.

**Total deviations:** 8 (3 Rule 1, 1 Rule 2, 2 Rule 3, 2 notes).

## Authentication Gates

None.

## Issues Encountered

- Full suite after the last code commit: 2174 tests; the first run had 5 failures, 3 of them this plan's (the survivor expiry and the footprint control, fixed in 7356684). The other two are the known load-sensitive `test/mutation/fail-closed.test.ts` FC-10/WR-07 case: the file passes when run without the load (50 of 50 together with the footprint file, after the fix), and it was not edited. The full suite was not re-run after the last fix; the three files it touched were re-run individually. Phase 1 `test/fault/killpoints.test.ts` and `budgets.test.ts` passed unchanged under the plan's two-file run (43 of 43); the load flake carried from 02-15 did not reproduce, so it was not diagnosed further.
- The harness refused heredocs and a `sed -i` program; edits were made with the Edit tool.
- No live model was called: D-15 spend unchanged (1.2155 USD of 25 after 02-09).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-02-56: reap by session ID before any read or relaunch, a failed reap stops the resume (tested with the host alive and the clone digest unchanged). T-02-57: the trailer must name the run and the open attempt, else enforcement_failure (tested with an amended commit). T-02-58: inconclusive rows, and G4 reads only the fresh pass. T-02-SC: no package was installed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 02-18 onward. `avarice resume <run_id>` now works for runs (the 02-15 carry note).
- The live plans (02-20 to 02-22) exercise a real host's process tree and a real kill (D8).

## Self-Check: PASSED

- FOUND: src/app/run-resume.ts, test/integration/run-resume.test.ts, test/fault/run-killpoints.test.ts, test/fault/run-budgets.test.ts, 02-17-red-evidence-task{1,2,3}.json
- FOUND commits: 59eebe0, 420271d, 7356684 (ancestors of HEAD, after 5c50c9f)
- Plan verification: run-resume, run-discard-retry, resume-reap, run-supervisor, lease: 74 pass, 0 fail; run-killpoints (27 pass, `AC-3: 24/24`) and run-budgets (4 pass); killpoints and budgets of Phase 1 unchanged: 43 pass; `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (79 files)
