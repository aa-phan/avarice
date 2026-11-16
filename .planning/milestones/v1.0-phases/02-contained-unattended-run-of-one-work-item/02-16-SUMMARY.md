---
phase: 02-contained-unattended-run-of-one-work-item
plan: 16
subsystem: run-kernel
tags: [con-16, discard-and-retry, loop-limit, budget-exhausted, source-untouched, s-42, s-20, fake-run-host]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-07 RunWorkspace snapshot and discard, 02-11 run hook loop limits (loop.limit event, continue false), 02-13 running stage and routing table, 02-14 baseline and checks"
provides:
  - "src/app/run-stages/discard.ts: discardAttempt (discard-attempt checkpoint, snapshot-bounded restore, `discard` step with sideEffect none, attempt ended `discarded`, item delegated -> ready)"
  - "src/app/run-stages/item.ts: routeOutcome is async; a crashed or wall-clock-killed unit with no moved HEAD is discarded and retried once (attempt reason `con16-retry`); a loop.limit event for the invocation escalates as repeated_failure"
  - "Ledger.findLoopLimit(invocationId): the first loop.limit event of an invocation"
  - "test/helpers/fake-run-host.ts options crash, timeoutMs, denyLoop, toolCallFlood, observe, perAttempt"
  - "Tests: test/fault/run-discard-retry.test.ts, test/integration/run-outcomes.test.ts, test/integration/run-source-untouched.test.ts"
affects: [02-17, 02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 30000
  tasks: 2
  commits: 2
plan_head_before: f32389506f4b4ae804ed5cf56f475cca5711191f
plan_head_after: 52c37877a2695788d4e6f039c6a31ca3ad58bee7
commits: 2

tech-stack:
  added: []
  patterns:
    - "Recovery is one ordered sequence behind a fenced checkpoint: `discard-attempt` checkpoint -> restore -> `discard` step -> attempt `discarded` -> item ready; a second call of the restore changes nothing, so a resume can repeat it"
    - "A crashed or killed unit is retried only on facts: no result, a non-zero exit or a signal, no moved HEAD, no host refusal, the invocations budget has room, and the attempt count is below 1 + contract retry; progressed, paused, denied, no_progress and host errors are never retried"
    - "Escalation precedence in routeOutcome: moved HEAD (containment) > spent budget (the cause of a long run of denials) > hook loop limit > paused > denied > no_progress > discard-and-retry > decision"

key-files:
  created:
    - src/app/run-stages/discard.ts
    - test/fault/run-discard-retry.test.ts
    - test/integration/run-outcomes.test.ts
    - test/integration/run-source-untouched.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-16-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-16-red-evidence-task2.json
  modified:
    - src/app/run-stages/item.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - test/helpers/fake-run-host.ts

key-decisions:
  - "The retry is the second and last attempt: a second crash or kill is a `decision` / repeated_failure decision whose issue names both attempt IDs and the kind each ended as; budgets already charged stay charged (2 invocations, the killed attempt's reservation)"
  - "A spent invocations budget blocks (budget_exhausted, class permission, naming invocations) BEFORE the discard, so the crashed unit's files are left in the clone for the owner; the plan's wording that a refused reservation is a repeated_failure decision is reconciled with S-15 (budget exhaustion is a permission decision)"
  - "budget_exhausted is routed before the loop limit: a spent budget denies every later call, so a long unit reaches three denials on the way, and the decision must name the budget, not the loop"
  - "The loop-limit check is made on the invocation's own loop.limit event, not on any model text; a unit that classified progressed but was stopped by the hook is escalated and never gated or committed"
  - "The discard step records `sideEffect: none` with its basis text (no network, push or change request in a Phase 2 invocation); nothing claims an external effect was rolled back"

requirements-completed: [CON-16, CON-9, CON-14, CON-3, AUT-7]

coverage:
  - id: D1
    description: "A unit that writes two files and crashes is discarded to its pre-launch snapshot (changed file restored, added file removed, `sideEffect: none`), the clone starts the retry from the snapshot bytes, and the one retry reaches ready_for_review committing only the fix"
    requirement: "CON-16"
    verification:
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#a crashed unit is discarded to its snapshot and retried once (CON-16, S-42; tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A unit killed by the wall clock (inconclusive, timedOut, SIGKILL) is discarded and retried the same way; the killed invocation is charged its reservation and stays charged"
    requirement: "CON-16"
    verification:
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#a unit killed by the wall clock is discarded and retried the same way (S-42)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A second failure is a repeated_failure decision naming both attempts; a moved HEAD, no_progress, a pause, a host error and a spent invocations budget are never discarded or retried; at most one retry per item"
    requirement: "CON-16"
    verification:
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#a second failure is a decision, not a second retry; what is never retried"
        status: pass
    human_judgment: false
  - id: D4
    description: "A file in the clone before the snapshot (the configure step's settings, a user-placed notes.txt) is byte-identical after the discard"
    requirement: "CON-9"
    verification:
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#a file the user placed in the clone before the snapshot survives the discard (CON-9, T-02-53)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The discard-attempt checkpoint is committed before the restore and the retry's launch:run checkpoint after the discard step is recorded completed; classify, discard-attempt, launch:run are adjacent"
    requirement: "CON-16"
    verification:
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#orders the checkpoints classify, discard-attempt, launch:run, and records the discard before the retry launches (ordering edge)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Three consecutive denials (the real hook's continue false and loop.limit event) end the run blocked (decision) as repeated_failure with `loop limit: 3 consecutive denials`, also for a unit that did its work; two denials do not stop it"
    requirement: "CON-14"
    verification:
      - kind: integration
        ref: "test/integration/run-outcomes.test.ts#a loop limit stops the run for escalation (CON-14)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A spent toolCalls budget ends blocked (budget_exhausted) with a permission decision naming toolCalls, the limit unchanged"
    requirement: "CON-14"
    verification:
      - kind: integration
        ref: "test/integration/run-outcomes.test.ts#an exhausted budget is a permission decision naming the budget (S-15)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Through a gate-failed run, a crash-and-retry run and a loop-limit run the source checkout (HEAD, index, tracked, untracked and ignored bytes, config, refs but the run branch) is byte-identical, the run clone still exists, and a git shim on PATH shows no reset, clean, checkout, restore or stash with the source as cwd (restore did run in the clone)"
    requirement: "CON-9"
    verification:
      - kind: integration
        ref: "test/integration/run-source-untouched.test.ts#the user checkout is byte-identical through a failed, a crashed-and-retried and a blocked run (S-20)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Concurrency edge: discard runs only inside a stage of the lease holder; a stale fence cannot commit the discard-attempt checkpoint"
    requirement: "CON-16"
    verification:
      - kind: other
        ref: "backstop: the checkpoint is committed with ctx.fence before the restore (discard.ts); the stale-fence refusal itself is proven by the lease and supervisor suites of plan 02-12, and a kill at after-checkpoint:discard-attempt by plan 02-17"
        status: unrun
    human_judgment: false
  - id: D10
    description: "A real model's crash or wall-clock kill, and the shell lines it improvises, are not exercised: the fake host plays the unit through the real hook entry"
    requirement: "CON-16"
    verification:
      - kind: other
        ref: "live cases of plans 02-20 and 02-21"
        status: unrun
    human_judgment: true
    rationale: "Offline, a crash is the fake host's exit 1 with no result and a kill is its SIGKILL report; whether a real claude process ends that way, and what a real killed unit left in the clone, is observed only live"

duration: 29 min
completed: 2026-11-06
---

# Phase 2 Plan 16: Discard-and-retry, loop limit and budget endings, and an untouched checkout Summary

**A crashed or wall-clock-killed unit is undone inside its own clone (snapshot-bounded, never touching what was there before) and retried exactly once; a hook loop-limit stop and an exhausted budget become named decisions; and a byte-level proof with a git shim shows the user's checkout is never reset, cleaned, checked out, restored or stashed through failure and recovery**

## Performance

- **Duration:** about 29 min (start about 2026-11-06T06:16Z, end 06:50Z)
- **Tasks:** 2 (Task 1 a tracer, Task 2 auto)
- **Files:** 10 changed in the two task commits (about 30 000 tokens by chars/4 over the diff)

## Accomplishments

- **Tracer (CON-16, S-42).** With `perAttempt: [{ crash: { afterFiles: ['src/slug.ts', 'src/extra.ts'] } }, <the fix>]` the run reaches `ready_for_review` (exit 0). Attempts: ordinal 1 `initial` ended `discarded`, ordinal 2 `con16-retry` ended `handed-off`. The `discard` step lists restored `['src/slug.ts']`, removed `['src/extra.ts']`, `sideEffect: none` and the basis text. The retry's host observed `src/slug.ts` with its pin bytes, `src/extra.ts` absent and `.planning/config.json` byte-identical to what attempt 1 saw. The clone's commit changes only `src/slug.ts`; both invocations are charged. Checkpoint order is `classify`, `discard-attempt`, `launch:run`, and the checkpoint is committed before the discard step completes, which completes before the retry's `launch:run` checkpoint.
- **Wall-clock kill.** A unit killed after `timeoutMs` (SIGKILL, `timedOut`, no result) classifies `inconclusive`, is discarded and retried the same way; the killed invocation is charged its reservation (cost is unknown for a kill) and wall clock, and stays charged.
- **One retry only (FR-4).** Both attempts crashing ends `blocked_on_decision (decision)` with one `repeated_failure` decision whose issue names both attempt IDs and `ended inconclusive` twice; 2 invocations and both attempts' reported cost stay charged; the second failure is not discarded. A moved HEAD (`enforcement_failure`, no discard step), no_progress, a pause and a host error each end after one attempt without a discard; a spent invocations budget blocks `budget_exhausted` (permission, naming `invocations`) before any discard.
- **User files survive (CON-9, T-02-53).** A `notes.txt` present in the clone before the unit's snapshot is byte-identical when the retry begins and when the run ends, and is in neither list of the discard step; so is the configure step's `.planning/config.json`.
- **Loop limit (CON-14).** `Ledger.findLoopLimit` reads the hook's `loop.limit` event for the invocation; it is recorded on the classify step and routes to `blocked_on_decision (decision)`, class `repeated_failure`, issue `loop limit: 3 consecutive denials`, whatever else the unit did (a unit that classified `progressed` is escalated, not gated or committed). Two denials do not stop it.
- **Budget decision (S-15).** `toolCalls=5` with six calls ends `blocked_on_decision (budget_exhausted)`, class `permission`, naming `toolCalls`; the limit is unchanged and the five allowed calls stay charged.
- **Source untouched (S-20, T-02-55).** For a gate-failed run, a crash-and-retry run and a loop-limit run on a source with an uncommitted tracked change, an untracked file and an ignored file, the checkout digest, the index hash, the config text and the ignored files' bytes are identical before and after; each run's clone still exists. A git shim first on PATH logged every git call of the CLI and the detached supervisor: some ran with the source as cwd (the shim is exercised), none of `reset clean checkout restore stash`; in the crash-and-retry run `restore` ran with the clone as cwd (the discard).

## Task Commits

1. **Task 1 (tracer): discard, retry, loop-limit routing, fake-host options** - `c26ccb2` (feat). The loop-limit routing shares `routeOutcome` with the retry, so it landed here.
2. **Task 2: loop-limit and budget endings, and S-20 tests** - `52c3787` (test)

`commits: 2`, measured as `git rev-list --count f32389506f4b4ae804ed5cf56f475cca5711191f..HEAD` before this summary commit.

RED evidence: `02-16-red-evidence-task1.json` is the new tracer file against the plan base source (14 tests, 2 pass, 12 fail). `02-16-red-evidence-task2.json` is the Task 2 files against the plan base source plus the new helper (10 tests, 6 pass, 4 fail); the six passing tests pin behaviour that already held (the 02-13 budget routing, a blocked run leaving the source alone) and the S-20 shim proves it by what git actually ran.

Tracer gate (config absent, `end-of-phase`, automated-only verify): the verify command was re-run after Task 1 and after the last routing edit (14 tests pass), and the 24 tests of `run-baseline-workflow.test.ts` pass, so expansion continued.

## Files Created/Modified

See key-files. In one line each: `discard.ts` the CON-16 recovery sequence; `item.ts` the retry, escalation and attempt-history routing; the two ledger files `findLoopLimit`; `fake-run-host.ts` the failure and loop options; the three test files S-42, the outcome decisions and S-20.

## Decisions Made

See key-decisions. Points to know downstream:

- **02-17 (recovery kill points).** Fault points `after-checkpoint:discard-attempt` (before the restore) and a kill after the restore but before the `discard` step are both resumable: `workspace.discard` called a second time changes nothing and returns empty lists. `discardAttempt` tolerates an attempt already ended and an item already `ready`. A resume that finds item `delegated` still returns the 02-13 error (an interrupted attempt); to resume from `discard-attempt` it must call `discardAttempt` with the attempt's recorded `snapshot` step, then `attemptUnit`. The retry attempt skips the second `context-pack` checkpoint, so `discard-attempt` is directly followed by `launch:run`.
- **02-17 (attempt reason).** The retry's attempt reason is `con16-retry` (constant `RETRY_REASON` in item.ts).
- **The second-failure decision** carries `data.attempts` and `data.kinds` on the run transition event (comma-separated), and the issue text names them for the owner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] budget_exhausted is routed before the loop limit**
- **Found during:** Task 1 (the 02-13 test "a budget spent inside the unit" regressed to `decision` after the loop-limit routing was added)
- **Issue:** a spent budget makes the hook deny every later call, so a long unit reaches three consecutive denials on the way; the loop limit then masked the budget as the cause.
- **Fix:** the loop-limit escalation applies unless the unit classified `budget_exhausted`; a moved HEAD stays first. A test pins the order (`toolCalls=2` with a full unit).
- **Files modified:** src/app/run-stages/item.ts, test/integration/run-outcomes.test.ts
- **Commit:** c26ccb2, 52c3787

**2. [Rule 3 - Blocking] Files the plan's list did not name**
- **Issue:** the stage needs the hook's `loop.limit` event, and the application layer reads the ledger only through the port; `findLoopLimit` had no home.
- **Fix:** `Ledger.findLoopLimit` in `src/ports/ledger.ts` and `src/adapters/sqlite/ledger.ts` (one read-only query). Also `.planning/phases/.../02-16-red-evidence-task{1,2}.json`.
- **Commit:** c26ccb2

### Plan inconsistencies reconciled

**3. [Plan note] Attempt 2's outcome is `handed-off`, not `progressed`**
- The plan's behaviour line says the retry's attempts row is `progressed`; the existing 02-13 hand-off ends the attempt `handed-off`. The test asserts `handed-off`; no code changed.

**4. [Plan note] A refused reservation for the retry is a budget decision, not a repeated_failure decision**
- Truth 3 lists "a refused reservation" with the second failure (class repeated_failure), Task 1 and Task 2 say budget_exhausted / permission (S-15). Implemented as S-15: before discarding, an invocations budget with no room blocks `budget_exhausted` / `permission` naming `invocations` and leaves the crashed unit's files in the clone; a wall-clock or cost refusal at the retry's reservation uses the existing 02-13 path (`budget_exhausted`, permission). A second failure of the unit itself is the repeated_failure decision.

**5. [Plan note] `preLaunch` became a test-side workspace wrapper, and two options were added**
- The snapshot is taken before the host is called, so a host-side `preLaunch` cannot place a file "before the snapshot". The user-file test runs the supervisor in-process and wraps `deps.runWorkspace.snapshot` so `notes.txt` is in the clone when the snapshot is taken. The fake host gained `observe` (record what the clone looked like when a unit began) and `perAttempt` (script attempt 1 and attempt 2 separately) instead of `preLaunch`.

**6. [Plan note] The retry commits no second `context-pack` checkpoint**
- The pack is rebuilt for the retry's prompt (its step is recorded again), but the stage goes `discard-attempt` -> `launch:run` with no `context-pack` checkpoint between, matching the plan's checkpoint order literally.

**7. [Process] The loop-limit routing landed with Task 1**
- It shares `routeOutcome` with the retry; the Task 2 commit adds the tests and RED evidence for it.

**Total deviations:** 7 (1 Rule 1, 1 Rule 3, 5 notes). **Impact:** none on a plan truth; deviation 1 makes the decision name the root cause (the budget) instead of its symptom.

## Authentication Gates

None.

## Issues Encountered

- The harness refused some compound shell forms and a heredoc-fed `python3 /dev/stdin`, which silently did not apply one edit; the edit was redone with the Edit tool and verified by `grep`.
- `src/slug.ts` in a crashed unit's partial write is appended with a marker line (`// partial write of a unit that stopped before it finished`) by the fake host; it is removed by the discard in every test.
- Full-suite result: see Self-Check.
- No live model was called, so nothing was added to the Phase 2 spend ledger; D-15 total unchanged (1.2155 USD of 25 after 02-09).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-02-53: the discard is bounded by the snapshot, refuses a moved HEAD, leaves ignored paths and pre-snapshot files, and is tested with a user-placed file. T-02-54: one retry per item, the invocations budget is checked before the discard, a loop limit escalates. T-02-55: only the workspace adapter runs recovery git, and the shim log shows none of the five subcommands with the source as cwd over three failure kinds. T-02-SC: no package was installed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 02-17 (kill points and resume): the recovery notes above name the resume entry and the fault points to add.
- A real model (plans 02-20 and 02-21) is not exercised here; D10 is the human-judgment item.

## Self-Check: PASSED

- FOUND: src/app/run-stages/discard.ts, test/fault/run-discard-retry.test.ts, test/integration/run-outcomes.test.ts, test/integration/run-source-untouched.test.ts, 02-16-red-evidence-task1.json, 02-16-red-evidence-task2.json
- FOUND commits: c26ccb2, 52c3787 (ancestors of HEAD, after f323895)
- Acceptance: `grep -c "con16-retry" src/app/run-stages/item.ts` is 1; run-discard-retry.test.ts asserts the bytes of the restored, removed and user-placed files, the attempts table and the checkpoint order; run-source-untouched.test.ts compares the full digests and asserts the shim saw git with the source as cwd and none of the five subcommands there
- Plan verification: `node --test` of run-discard-retry, run-outcomes, run-source-untouched, run-baseline-workflow and run-gates: 58 pass, 0 fail; `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (78 files)
- Full suite after the last code commit: 2119 tests, 2092 pass, 25 skipped (live and network cases), 2 fail. Both failures are the known load-sensitive `test/mutation/fail-closed.test.ts` FC-10/WR-07 cases (a sandbox probe timing out under full-suite load); the file re-run alone passes 35 of 35, and it was not edited.
