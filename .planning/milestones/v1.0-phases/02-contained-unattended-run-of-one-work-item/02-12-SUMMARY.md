---
phase: 02-contained-unattended-run-of-one-work-item
plan: 12
subsystem: run-kernel
tags: [supervisor, detached-process, lease, run-stages, kill-points, g0, budgets, invocation, d-18, con-3, con-13]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-03 run ledger (leases with fence, checkpoints, run steps, gate results, budgets), 02-07 RunWorkspace clone, 02-08 run scope and prompt, 02-10 start and its stored contract"
provides:
  - "src/app/run-service.ts: runSupervisor (lease loop, renewal every ttl/3, release in finally, no-progress guard, contract file rewrite), RUN_STAGES, registerRunStage, RunOutcome"
  - "src/app/run-stages/stage.ts: RunStageContext (checkpoint, transition, note, fence and kill points), RunStage, RunTransitionOptions"
  - "src/app/run-stages/prepare.ts: contractReadyStage over RUN_NEXT_ACTIONS.contract_ready, registerContractReadyAction; actions prepare-workspace (run clone at the pin) and verify-enforcement (G0 gate result, blocked_on_decision/enforcement_failure or running)"
  - "src/cli/spawn-supervisor.ts: spawnSupervisor (detached, stdio ignored, cwd the data root, unref'd), waitForRun, isProcessAlive; command `avarice supervise <runId>`; `avarice start [--wait]`"
  - "src/app/budget.ts: reserveRunInvocation over one shared reserveFrom; src/app/invocation.ts: prepareRunInvocation, completeRunInvocation over one shared finishInvocation"
  - "Run steps supervisor:spawn and workspace:prepare; gate row G0; evidence 02-12-red-evidence-task{1,2,3}.json"
affects: [02-13, 02-14, 02-15, 02-16, 02-17, 02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 38000
  tasks: 3
  commits: 3
plan_head_before: 240a93742cc9c3854c0a24ff4dc51b18d78720df
plan_head_after: 8db2f46cf1a53006ce02ed71b281bb92b80ac209
commits: 3

tech-stack:
  added: []
  patterns:
    - "One fault mechanism: the run stage context calls the exported faultPoint of onboarding-service.ts, so run checkpoints and transitions fire after-checkpoint:<action> and after-transition:<state> with no fault code in a stage"
    - "A stage registry per state (RUN_STAGES) and an action registry per stage (registerContractReadyAction): later plans add configure-gsd, install-deps, validate-checks, baseline and the running and verifying stages by registering, not by editing the loop"
    - "One reservation core and one settle-and-record core under both the onboarding and the run entry points; the owner differences (rows, wall clock cap, step sink, retention, event owner IDs) are data"
    - "The supervisor's only caller is the start command: the one deliberate detached spawn lives in src/cli and is held to its own rules by the footprint test"

key-files:
  created:
    - src/app/run-service.ts
    - src/app/run-stages/stage.ts
    - src/app/run-stages/prepare.ts
    - src/cli/spawn-supervisor.ts
    - src/cli/commands/supervise.ts
    - test/integration/run-supervisor.test.ts
    - test/integration/run-invocation.test.ts
    - test/helpers/probe-supervisor-entry.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-12-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-12-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-12-red-evidence-task3.json
  modified:
    - src/app/budget.ts
    - src/app/invocation.ts
    - src/app/onboarding-service.ts
    - src/app/run-start.ts
    - src/cli/commands/start.ts
    - src/cli/main.ts
    - test/integration/run-start.test.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "A run is driven by a detached `avarice supervise <runId>` that `start` spawns with process.argv[1] as the entry, in its own process group, stdio ignored, cwd the data root, unref'd; the three profile roots are passed explicitly and NODE_TEST_CONTEXT is removed from its environment; a missing or relative entry refuses the spawn (start exits 70 with the run stored in contract_ready)"
  - "waitForRun calls a non-stop run interrupted only when the recorded PID is dead AND the lease is not live (expiry before now, or released), so a killed supervisor is reported after at most one lease TTL and a supervisor that finished cleanly in a state with no stage (running, until plan 02-13) is reported the same way"
  - "verify-enforcement is gate G0's dynamic half: it re-runs checkG0Static on the stored contract, adds a host-enforcement failure when descriptor.attributes.enforcement is not `enforced`, records the G0 row, and blocks with enforcement_failure (host) or decision (a static failure) before any invocation; the run row's workspace_path and branch are written by that transition, not by prepare-workspace"
  - "A run request names its owner through ownerKind and ownerId and carries the run ID in onboardingId (the field is required by the port and the adapter reads the owner fields for a run); the run scope is built from realpath forms of the clone, scratch directory, work root, data root, repository, home and GSD directories (02-01 finding)"
  - "prepareRunInvocation reads the GSD directories from the run's gsd:inspect step when one exists, else from deps.gsd.inspect(); the configure stage of a later plan records the step"

patterns-established:
  - "Stage actions are skipped when their run step is completed (a resume repeats nothing); an action that ends in a transition has no step and the stage stops after it"
  - "The supervisor rewrites a missing contract-v<n>.json from the ledger once it holds the lease, before the prelude and the stages (02-10 carry-over)"

requirements-completed: [FR-2, FR-7, CON-13, CON-3, NFR-6]

coverage:
  - id: D1
    description: "start returns after spawning a detached supervisor (different PID, own process group, stdio /dev/null, cwd the data root) and records supervisor:spawn with its PID; --wait polls the ledger and exits 0 at ready_for_review and 3 otherwise; a missing or relative entry refuses the spawn"
    requirement: "FR-2"
    verification:
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts#start --wait / spawnSupervisor"
        status: pass
    human_judgment: false
  - id: D2
    description: "The supervisor takes the run lease, renews it, runs the stage for the committed state, releases the lease, and fails with an internal error when a stage makes no progress; a run already in a stop state runs nothing"
    requirement: "FR-2"
    verification:
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts#supervise: the stage loop under the run lease"
        status: pass
    human_judgment: false
  - id: D3
    description: "Run checkpoints and transitions fire the generic kill points: a kill at after-checkpoint:prepare-workspace leaves contract_ready with the lease held and no clone; a kill at after-checkpoint:verify-enforcement is reported as interrupted"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts (kill at after-checkpoint:prepare-workspace; interrupted line)"
        status: pass
    human_judgment: false
  - id: D4
    description: "contract_ready runs prepare-workspace (clone at the pin on avarice/<runId>) and verify-enforcement (G0 row; blocked_on_decision with enforcement_failure without an enforced host, running with one); checkpoints are prepare-workspace, verify-enforcement, then the transition's"
    requirement: "CON-3"
    verification:
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts#start --wait tracer; supervise with an enforced host"
        status: pass
    human_judgment: false
  - id: D5
    description: "Run invocations reserve from the run's own rows before launch (grant, refusal at the fourth, caps by what is left), record launch:run before the request is returned, settle after, charge a killed or failed-with-unknown-effect invocation its reservation, charge an orphaned reservation on the next reserve; no limit is refunded or raised; Phase 1 budget suites pass unchanged"
    requirement: "CON-13"
    verification:
      - kind: integration
        ref: "test/integration/run-invocation.test.ts (13 tests); test/fault/budgets.test.ts (unedited)"
        status: pass
    human_judgment: false
  - id: D6
    description: "invocation.finished for a run carries runId, attemptId and invocationId as event columns and in its data, and no onboarding ID; the transcript artifact has retention run"
    requirement: "NFR-6"
    verification:
      - kind: integration
        ref: "test/integration/run-invocation.test.ts#completeRunInvocation"
        status: pass
    human_judgment: false
  - id: D7
    description: "A second supervise for a run whose lease is live exits 3 with 'lease must expire first', records no checkpoint and does not take the lease; an expired lease is taken over at fence 2; SIGKILL of start --wait leaves the supervisor running"
    requirement: "FR-2"
    verification:
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts#one supervisor per run; the run outlives the command that started it"
        status: pass
    human_judgment: false

duration: 25 min
completed: 2026-11-05
---

# Phase 2 Plan 12: The detached run supervisor, contract_ready actions and run budgets Summary

**`avarice start` now hands the run to a detached `avarice supervise <runId>` that holds the run lease, drives checkpointed stages with the generic kill points, clones the workspace at the pin and blocks the run with `enforcement_failure` when the host is not enforced; run invocations reserve, record and settle against the run's own budget through the same code as onboarding**

## Performance

- **Duration:** about 25 min (start 2026-11-05T20:42Z, end 21:07Z)
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto)
- **Files:** 19 changed in the three commits (1801 insertions, 37 deletions; about 38 000 tokens by chars/4 over the diff)

## Accomplishments

- **Tracer.** On a scratch project with no admitted host, `start --brief b.md --policy routine --wait` exits 3: line 1 is `run <id>: contract_ready`, the last line `run <id>: blocked_on_decision (enforcement_failure)`. The ledger holds a G0 gate result with passed 0 and the one failure `host-enforcement`, the clone at `{workRoot}/<runId>/clone` on `avarice/<runId>` at the pin, `runs.workspace_path` and `runs.branch` set, checkpoints `prepare-workspace`, `verify-enforcement`, `none`, steps `supervisor:spawn` and `workspace:prepare`, and the lease released. Without `--wait`, start exits 0 right after the spawn and the same state is reached in the background. With the fake host (enforced) the run reaches `running`, the supervisor stops with `no stage for running` and exits 3 (plan 02-13 adds that stage).
- **Process model (D-18, SC 6).** `spawnSupervisor` starts `node [execArgv] <entry> supervise <runId>` detached, stdio ignored, cwd the data root, unref'd; a probe test shows a different PID, its own process group led by the child, `/dev/null` for all three streams and the data root as cwd. SIGKILL to `start --wait` leaves the supervisor alive and the run reaches its stop state.
- **Supervisor kernel.** `runSupervisor` mirrors `runOnboarding`: lease (free or strictly expired), unref'd renewal every ttl/3, stage per committed state, no-progress guard, release in `finally`; it reuses the exported `faultPoint` and `leaseTtlMs`. A run in a stop state takes no lease. A second `supervise` on a live lease exits 3 with `lease must expire first`; with `AVARICE_LEASE_TTL_MS=200` a later supervise takes the lapsed lease at fence 2 and repeats only the side effect that was killed.
- **Carry-over from 02-10.** After taking the lease the supervisor rewrites a missing `contract-v<n>.json` from the ledger (0600, temp then rename, byte-identical to the stored body) before anything is launched.
- **contract_ready.** `contractReadyStage` walks `RUN_NEXT_ACTIONS.contract_ready`, checkpoints before each registered action and skips an action whose step is completed. `prepare-workspace` and `verify-enforcement` are registered here; the other four names are for later plans.
- **Dead supervisor reported.** With `AVARICE_FAULT=after-checkpoint:verify-enforcement`, `start --wait` prints `run <id>: interrupted in contract_ready (next: verify-enforcement)` and `continue with: avarice resume <id>` and exits 3 once the lease has lapsed.
- **Run budgets.** `reserveFrom` is the one orphan-charge, cap and reserve path under `reserveInvocation` (onboarding, event data unchanged) and `reserveRunInvocation` (wall clock at most the contract's 60 min, cost at most 2.00 USD, both capped by what is left). `prepareRunInvocation` builds the run scope from the stored contract and the clone in realpath form, reserves, and records `launch:run` attempt N as `started` with invocation, session, attempt and item IDs before it returns a request with purpose `run`, `ownerKind` run and the work item's model. `completeRunInvocation` shares `finishInvocation` with `completeInvocation`: killed invocations are charged the larger of reported cost and reservation, a host error is recorded `failed` and returned unchanged, the transcript artifact has retention `run`, and `invocation.finished` carries `runId`, `attemptId` and `invocationId`. `test/fault/budgets.test.ts` is byte-identical to the plan base.

## Task Commits

1. **Task 1 (tracer): detached supervisor, run stages, contract_ready actions, supervise command, start --wait** - `530880e` (feat)
2. **Task 2: run-aware budget reservation and invocation bookkeeping** - `1ba7ff4` (feat)
3. **Task 3: lease and process guarantees (tests)** - `8db2f46` (test)

`commits: 3`, measured as `git rev-list --count 240a93742cc9c3854c0a24ff4dc51b18d78720df..HEAD` before this summary commit.

RED evidence: `02-12-red-evidence-task1.json` (the new test file cannot load: `src/cli/spawn-supervisor.ts` does not exist) and `02-12-red-evidence-task2.json` (the run-invocation test cannot link: no `reserveRunInvocation`, `prepareRunInvocation` or `completeRunInvocation`). `02-12-red-evidence-task3.json` is mutation evidence, not a failing run: the Task 1 tracer needs the supervisor loop, the unref'd timer, the release in `finally` and the interrupted rule, so the four new tests passed on first run. To show they discriminate, three behaviours were broken in turn (lease not released: 4 tests fail; `detached: false`: the process-group test fails; the resume line removed: the exact-line test fails) and a fourth mutant (a refused lease ignored) was found equivalent because the lease renewal, the checkpoint fence guard and the transition fence guard each stop the second supervisor on their own.

Tracer gate (config absent, `end-of-phase`, automated-only verify): the verify commands (run-supervisor, run-start, tsc, boundaries) were re-run after Task 1 and passed (36 tests), so expansion continued.

## Files Created/Modified

See key-files. The one-line purpose of each new file: `run-service.ts` the lease loop and registry; `run-stages/stage.ts` the stage contract; `run-stages/prepare.ts` the contract_ready actions; `spawn-supervisor.ts` the detached spawn and the ledger wait; `commands/supervise.ts` the command; `probe-supervisor-entry.ts` a test entry that records what a detached child sees.

## Decisions Made

See key-decisions. Points to know downstream:

- Plan 02-13 registers the `running` and `verifying` stages with `registerRunStage` and calls `prepareRunInvocation` and `completeRunInvocation`. `prepareRunInvocation` needs an attempt recorded with `recordRunAttempt` first, and a `gsd:inspect` run step or `deps.gsd`; the configure-gsd action (a later contract_ready action) should record `gsd:inspect` with `gsdCoreDir` and `agentsDir`.
- A run in `running` with no registered stage ends its supervisor cleanly; `start --wait` reports that as `interrupted in running (next: context-pack)` until 02-13 lands.
- `verify-enforcement` records a new G0 row each time it runs. A kill between the gate insert and the transition repeats it on resume, so a run can carry two G0 rows (insert-only rows tell the truth: it was evaluated twice).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The footprint test (NFR-1) forbids any detached child**
- **Found during:** Task 1 (full-suite run)
- **Issue:** `test/unit/footprint.test.ts` fails any source file containing `detached: true` except two group-leader adapters. The plan requires exactly that line in `src/cli/spawn-supervisor.ts` (acceptance: `grep -c "detached: true"` is 1).
- **Fix:** the file is exempted the way plan 02-06 exempted the allowlist proxy, and a new describe holds it to its own rules: one `detached: true`, one `spawn(` call, `stdio: 'ignore'`, `child.unref()`, no listener or network call, fixed arguments `[...process.execArgv, entry, 'supervise', runId]`, and imported by `start.ts` only. Every other source file is still scanned; the "no command leaves a process behind" tests are unchanged.
- **Files modified:** test/unit/footprint.test.ts
- **Commit:** 530880e

**2. [Rule 3 - Blocking] One run-start test raced the supervisor `start` now spawns**
- **Found during:** Task 1
- **Issue:** "26 commits outside .avarice/ and .planning/ refuse; 25 start" took row counts right after a successful start while the new detached supervisor was still adding events (7 instead of 4).
- **Fix:** that first start runs with `--wait` (no admitted host, so exit 3 and a blocked run) so the ledger is quiet before the counts are compared with the refused second start. The assertions about the refusal are unchanged.
- **Files modified:** test/integration/run-start.test.ts
- **Commit:** 530880e

**3. [Rule 3 - Blocking] writeContractFile had to be reachable from the supervisor**
- **Found during:** Task 1 (the 02-10 carry-over)
- **Issue:** the contract file writer was private to `run-start.ts`, which is not in the plan's file list; the supervisor must write the same file the same way.
- **Fix:** `writeContractFile` is exported and takes the contract version (default 1); `leaseTtlMs` is exported from `onboarding-service.ts` as the plan says. Behaviour of `start` is unchanged.
- **Files modified:** src/app/run-start.ts, src/app/onboarding-service.ts
- **Commit:** 530880e

**4. [Rule 3 - Process] Task 3 has no failing run**
- **Found during:** Task 3
- **Issue:** the behaviour was built with the tracer, so a red run is not available. See the RED evidence note above; the evidence file records the mutants instead and says why.
- **Commit:** 8db2f46

**Total deviations:** 4 (all Rule 3). **Impact:** none on scope or on a plan truth; the first narrows an NFR-1 guard to one named file with its own assertions, the others are file-list consequences.

## Authentication Gates

None.

## Issues Encountered

- `test/mutation/fail-closed.test.ts` (known load-sensitive) was not hit: the two full-suite runs passed it (1925 tests, 1900 pass, 0 fail, 25 skipped live and network cases).
- A harness note: heredocs that also mention `git` or `sed -i` were refused, so file edits went through Write, Edit and small script files; `git rev-parse --show-toplevel` printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before the first write and before each commit.
- `requirements.ready-ids` reported 0 of 5 ready (FR-2, FR-7, CON-13, CON-3, NFR-6 are shared with later plans), so no requirement was marked complete.
- No live model was called, so nothing was added to the Phase 2 spend ledger (the D-15 total is unchanged by this plan).

## Known Stubs

None. `running`, `verifying` and the other contract_ready actions (`configure-gsd`, `install-deps`, `validate-checks`, `baseline`) have no handler yet by design; plans 02-13 to 02-16 register them, and the supervisor says `no stage for <state>` and stops cleanly until then.

## Threat Flags

None beyond the plan's register. T-02-38 (two supervisors): a live lease refuses the second one at acquisition, renewal and every fenced write, tested; T-02-39 (unenforced host): G0 blocks with `enforcement_failure` before any invocation and records the gate; T-02-40 (a supervisor running unseen): the PID is a run step, `waitForRun` reports a dead one, and the contract wall clock bounds invocations. The new surface is the detached child process, which runs only this program's own `supervise` command with a run ID and is pinned by the footprint test. No package was installed (T-02-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 02-13: register `running` and `verifying` with `registerRunStage`; the supervisor, lease, kill points, clone and G0 exist, and `prepareRunInvocation` and `completeRunInvocation` are the run's reservation and bookkeeping.
- Plans that add contract_ready actions call `registerContractReadyAction(name, handler, { step })` from a module `prepare.ts` (or the stage's owner) imports; a name must be one of `RUN_NEXT_ACTIONS.contract_ready`, which already orders them (`configure-gsd`, `install-deps`, `validate-checks`, `baseline` before `verify-enforcement`).

## Self-Check: PASSED

- FOUND: src/app/run-service.ts, src/app/run-stages/stage.ts, src/app/run-stages/prepare.ts, src/cli/spawn-supervisor.ts, src/cli/commands/supervise.ts, test/integration/run-supervisor.test.ts, test/integration/run-invocation.test.ts, test/helpers/probe-supervisor-entry.ts, 02-12-red-evidence-task1.json, 02-12-red-evidence-task2.json, 02-12-red-evidence-task3.json
- FOUND commits: 530880e, 1ba7ff4, 8db2f46 (the three most recent entries of the phase branch log, after 240a937)
- Plan verification re-run after the last commit: `node --test` whole suite 1925 tests, 1900 pass, 0 fail, 25 skipped; `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (70 files). Acceptance: `grep -c "detached: true" src/cli/spawn-supervisor.ts` is 1; `grep -c faultPoint src/app/run-service.ts` is 5 and the file defines no second fault mechanism (no AVARICE_FAULT); `grep -c "reserveRunInvocation(" src/app/invocation.ts` is 1; `git diff 240a937..HEAD -- test/fault/budgets.test.ts` prints nothing; run-supervisor.test.ts asserts the supervisor PID differs from the start PID and the process group differs from the test's; run-invocation.test.ts covers grant, refusal at the fourth, orphan charge, killed charge and the event correlation IDs.
