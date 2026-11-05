---
phase: 02-contained-unattended-run-of-one-work-item
plan: 03
subsystem: persistence
tags: [run-lifecycle, sqlite, migration, ledger, checkpoints, leases, evidence, decisions]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: the SqliteLedger kernel (BEGIN IMMEDIATE transactions, version and fence guards, hash-chained events), forward-only checksummed migrate with VACUUM INTO backup, the onboarding lifecycle table pattern
provides:
  - src/domain/run-lifecycle.ts, the run state machine of docs/contracts-and-state.md as one pure table (RUN_STATES, RUN_TRANSITIONS, assertRunTransition, isRunStopState, isRunResumable, RUN_NEXT_ACTIONS, RUN_BLOCKED_REASONS, RUN_STEP_STATUSES) and the work item table (WORK_ITEM_STATES, assertItemTransition)
  - Migration 0002 (schema version 2), forward-only and checksummed: runs columns reason, workspace_path, branch, base_revision; tables run_steps, hook_reads, check_validations; indexes evidence_attempt and events_run; insert-only triggers on evidence and gate_results
  - 29 run methods on the Ledger port and SqliteLedger beside the untouched onboarding methods (runs, leases, checkpoints, contracts with budgets, steps, attempts, evidence, gate results, work items, decisions, check validations, hook reads)
  - ID prefixes ev_ and dec_
affects: [02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10, 02-11, 02-12, 02-13, 02-14, 02-15, 02-16, 02-17, 02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 58000
  tasks: 3
  commits: 3
plan_head_before: 340a82fe725a23fec4ca82fa2f28970b1e5aba53
plan_head_after: bef4985b0966548ba843009fd485faca9293f9ad
commits: 3

tech-stack:
  added: []
  patterns:
    - "Lease SQL is written once and parameterized by a LeaseTarget { table, key, lock } of closed literals; onboardings and runs share it, so the Phase 1 lease behaviour and the run lease behaviour cannot drift"
    - "One checkpoint writer (writeCheckpoint) serves both kinds; the sequence is max + 1 over a scope of run IDs (an onboarding shares one sequence with its carrier run, a run's scope is itself)"
    - "A Phase 1 carrier row (runs.state = 'onboarding') is invisible to every run method: lockRun reports it as not_found, listRuns filters it out"
    - "Evidence and gate rows are insert-only at two levels: no method updates them, and BEFORE UPDATE and BEFORE DELETE triggers refuse it"

key-files:
  created:
    - src/domain/run-lifecycle.ts
    - src/adapters/sqlite/migrations/0002-run.ts
    - test/unit/run-lifecycle.test.ts
    - test/integration/run-ledger.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-03-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-03-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-03-red-evidence-task3.json
  modified:
    - src/domain/ids.ts
    - src/cli/composition.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - test/fault/migrations.test.ts
    - test/integration/init.test.ts
    - test/integration/ledger-status.test.ts

key-decisions:
  - "Migration 0002 also carries insert-only triggers for evidence and gate_results (T-02-06); it was still unreleased, so the checksum rule is not touched"
  - "The work item table gains blocked_on_decision -> ready: the contract says an item is ready again once no open decision affects it, and without the edge a blocked item could never resume"
  - "transitionWorkItem counts an entry into delegated as one attempt on the item (work_items.attempts)"
  - "A run write that names an attempt must name one of that run's own attempts, else invalid (field attemptId)"
  - "Run events beyond the two the plan names: run.created, run.checkpoint, attempt.started, attempt.ended, evidence.recorded, gate.result, work_item.upserted, decision.opened, and contract.stored for run contracts; every one carries run_id (and attempt_id where known)"
  - "recordCheckValidation writes no event: a verdict is project-level cached data with no run; the app layer that runs the validation records the run's own events"

patterns-established:
  - "The adapter owns the closed value sets of the schema (evidence statuses and independence, decision classes and states, run step statuses) and refuses anything else with kind invalid and the field name"
  - "Every run method looks the run up first, so an unknown run or an onboarding carrier is not_found before any other check"

requirements-completed: [FR-2, FR-7, NFR-5, NFR-6, NFR-9, OPS-2, AUT-8]

coverage:
  - id: D1
    description: "The run state machine and the work item states are two pure tables: every diagram edge, the generic cancelled/paused/blocked_on_decision edges, paused -> verifying, refused edges, stop and resumable sets, next-action catalog"
    requirement: "FR-2"
    verification:
      - kind: unit
        ref: "test/unit/run-lifecycle.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration 0002 is forward-only: the committed v1 fixture migrates to v2 with a backup first and unchanged row counts, 0001 is untouched, a different recorded checksum for version 2 is refused, a fresh store reaches v2"
    requirement: "NFR-9"
    verification:
      - kind: integration
        ref: "test/fault/migrations.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A run transition writes the new state, a checkpoint and a run.transition event with the run ID in one transaction under the version and lease-fence guard; seq is continuous per run; a stale supervisor is fenced out"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-ledger.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Run leases, checkpoints, contracts with budgets, steps and listRuns (never an onboarding carrier row), including two connections racing an expired lease with exactly one winner"
    requirement: "NFR-5"
    verification:
      - kind: integration
        ref: "test/integration/run-ledger.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Evidence records revision, clean flag, tree digest, environment, contract version, policy revision, command, exit code and duration; the adapter refuses any status outside the six and any independence outside the three; evidence and gate rows are insert-only"
    requirement: "AUT-8"
    verification:
      - kind: integration
        ref: "test/integration/run-ledger.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Attempts, gate results, work items, decisions, check validations and hook reads have durable storage keyed by run, with events that carry run IDs"
    requirement: "OPS-2"
    verification:
      - kind: integration
        ref: "test/integration/run-ledger.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Kill-point atomicity of run writes (NFR-6): a run transition is one transaction, so a killed writer leaves the previous state; the run kill-point suite is plan 02-17"
    requirement: "NFR-6"
    verification:
      - kind: integration
        ref: "test/integration/run-ledger.test.ts"
        status: pass
    human_judgment: true
    rationale: "Atomicity is asserted here for refused writes (nothing written) but a kill of the process mid-transaction is only exercised by the run kill-point suite of plan 02-17"

duration: 19min
completed: 2026-11-05
status: complete
---

# Phase 2 Plan 03: Run lifecycle, migration 0002 and run ledger methods Summary

**The run state machine as a pure table, a forward-only migration 0002, and 29 ledger methods that write a run's state, checkpoints, leases, contracts with budgets, steps, attempts, insert-only evidence and gates, work items, decisions and check validations, all beside the unchanged onboarding methods.**

## Performance

- **Duration:** about 19 min (start time was not recorded; counted from the previous plan's last STATE write at 10:46Z to the last task commit at 11:05Z)
- **Completed:** 2026-11-05T11:06Z
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto, all with RED first)
- **Files modified:** 14 (2714 insertions, 37 deletions), including the three RED evidence files

## Accomplishments

- `src/domain/run-lifecycle.ts` lists the eleven states and every edge of the diagram in `docs/contracts-and-state.md`, then adds the generic edges the prose names (every non-terminal state to `cancelled`, `paused`, `blocked_on_decision`, never to itself) and `paused -> verifying`. `running -> running` is the only self-edge. Nothing leaves `failed`, `cancelled` or `closed`. The test writes the expected set out independently and checks all 121 ordered pairs.
- Migration 0002 adds what the plan lists and nothing else of the 0001 text changed: `git diff` on `0001-initial.ts` is empty, and a test pins its checksum to the one the committed v1 fixture recorded. The v1 fixture migrates to version 2, a `pre-migration-*.db` backup is written first, and every v1 row count is unchanged.
- `transitionRun` runs `assertRunTransition`, the version guard and the lease-fence guard, then updates the row, inserts the checkpoint (seq = max + 1 for the run, item and attempt when given) and appends a `run.transition` event with the run ID, all in one `BEGIN IMMEDIATE` transaction. Entry to `blocked_on_decision` needs a reason from the documented set; the reason is cleared on leaving.
- The lease, renewal, release and checkpoint code is shared with the onboarding methods through `LeaseTarget` and `writeCheckpoint`. The Phase 1 lease, status, budget and kill-point suites pass with the same behaviour.
- Evidence rows carry every field of the schema; the adapter refuses a status outside passed, failed, skipped, unavailable, inconclusive, stale and an independence outside deterministic, external, model-review, each with kind `invalid` and the field name.

## Task Commits

1. **Task 1: tracer, run lifecycle table, migration 0002 and the createRun, transitionRun, checkpoint round trip on a migrated v1 store** - `668afb0` (feat)
2. **Task 2: run leases, run checkpoints, run contracts with budgets, run steps, listRuns** - `64f0a57` (feat)
3. **Task 3: attempts, evidence, gate results, work items, decisions, check validations, hook reads** - `bef4985` (feat)

**Plan metadata:** the SUMMARY commit that follows this file (docs: complete plan).

RED evidence: `02-03-red-evidence-task1.json` (three files fail to load: the lifecycle module and 0002 do not exist), `02-03-red-evidence-task2.json` (18 of 28 run-ledger tests fail on the missing lease, checkpoint, contract, step and listRuns methods), `02-03-red-evidence-task3.json` (23 of 51 fail on the missing attempt, evidence, gate, item, decision, validation and hook-read methods).

Tracer gate: the Task 1 verify (lifecycle, migrations, run-ledger, boundaries, tsc, ledger-status, lease) re-ran green and the whole suite passed (1413 pass, 0 fail, 22 skipped), so the plan logged "Tracer verified end-to-end - expanding" and went on to Task 2.

## Files Created/Modified

- `src/domain/run-lifecycle.ts` - the two tables, blocked reasons, step statuses, next-action catalog
- `src/domain/ids.ts` - prefixes `ev_` and `dec_`
- `src/adapters/sqlite/migrations/0002-run.ts` - `MIGRATION_0002`
- `src/cli/composition.ts` - `MIGRATIONS = [MIGRATION_0001, MIGRATION_0002]`
- `src/ports/ledger.ts` - run types and the run half of the Ledger port (RunRow, NewRun, RunTransitionInput, RunCheckpointRow, EvidenceInput, EvidenceRow, GateResultInput, WorkItemRow, DecisionInput, DecisionRow, CheckValidationInput and the rest)
- `src/adapters/sqlite/ledger.ts` - the run methods, the shared lease and checkpoint helpers, the row mappers
- `test/unit/run-lifecycle.test.ts` - 17 tests; `test/integration/run-ledger.test.ts` - 51 tests; `test/fault/migrations.test.ts` - the v1 to v2 cases

## Decisions Made

- **Insert-only evidence enforced by the schema.** The plan says evidence and gate rows are insert-only and that T-02-06 is `mitigate`. A method that never updates them does not stop a later plan or a hook from doing so, so 0002 carries `BEFORE UPDATE` and `BEFORE DELETE` triggers for `evidence` and `gate_results`, as `events` already has. The migration was unreleased, so this does not edit an applied migration. If a later phase needs to prune old runs it adds a migration.
- **`blocked_on_decision -> ready` for work items.** The contract's own sentence ("an item is ready when ... no open decision affects it") needs it; Phase 3 `decide` has no other way to release an item.
- **Attempts on an item.** `work_items.attempts` is incremented when an item enters `delegated`, so a discard-and-retry shows as 2.
- **No lease required to transition.** Like the onboarding methods, a run with no lease has fence 0 and a transition presenting fence 0 is accepted; the supervisor of plan 02-07 acquires the lease first, and a taken-over lease fences the old holder out (tested).
- **Command stored as a JSON array.** `evidence.command` is `TEXT` in the DDL; the port takes `readonly string[]` and stores canonical JSON, so an argv with spaces survives.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Phase 1 tests that assert schema version 1 had to change**
- **Found during:** Task 1 (registering `MIGRATION_0002` in `MIGRATIONS` makes every fresh store version 2)
- **Issue:** `test/integration/init.test.ts` (`schema version: 1`, `schema_version` value, `schema_migrations` count) and `test/integration/ledger-status.test.ts` (same three, a "newer build" test that inserted version 2, and a reopen harness that migrated a v2 store with only 0001) fail by design once the store is version 2. The plan says the Phase 1 ledger-status suite passes unedited; that cannot hold for these assertions.
- **Fix:** the expected numbers became 2, the newer-build test inserts version 3, the reopen harness migrates with `[MIGRATION_0001, MIGRATION_0002]`. No behaviour assertion was weakened. `test/integration/lease.test.ts` and `test/fault/budgets.test.ts` are unedited.
- **Files modified:** test/integration/init.test.ts, test/integration/ledger-status.test.ts
- **Commit:** `668afb0`

**2. [Rule 3 - Blocking] The migration test for the v1 fixture was rewritten**
- **Found during:** Task 1
- **Issue:** `test/fault/migrations.test.ts` had "opens, migrates as a no-op, writes no backup" for the fixture and a "newer build" case that inserted version 2; both assume nothing is pending. The plan asks for exactly this update.
- **Fix:** the no-op case stays but runs with `[MIGRATION_0001]` only; new cases cover the v1 to v2 upgrade (backup, counts, columns, tables, indexes, triggers), a second migrate being a no-op, a fresh store reaching v2, a 0002 checksum mismatch naming version 2, `status` upgrading a v1 store, and the 0001 checksum pin. The "newer build" case now inserts version 3.
- **Commit:** `668afb0`, extended in `bef4985`

**3. [Rule 2 - Missing critical] Insert-only triggers for evidence and gate_results**
- **Found during:** Task 3 (threat T-02-06 has disposition `mitigate`)
- **Issue:** the plan's mitigation reads "Evidence and gate rows insert-only"; only the adapter honouring it leaves the property unenforced for every other writer.
- **Fix:** four triggers in migration 0002, tested with a raw `UPDATE` and `DELETE` for each table.
- **Files modified:** src/adapters/sqlite/migrations/0002-run.ts, test/fault/migrations.test.ts
- **Commit:** `bef4985`

**4. [Rule 2 - Missing critical] A run write may only name its own run's attempts**
- **Found during:** Task 1 and Task 2 (a checkpoint or transition carrying another run's attempt ID would corrupt the audit trail)
- **Fix:** `checkRunAttempt` refuses an attempt that is unknown or belongs to another run, kind `invalid`, field `attemptId`; the evidence and attempt methods refuse an attempt of an onboarding carrier as `not_found`.
- **Commit:** `668afb0`, `64f0a57`, `bef4985`

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing critical). **Impact:** none on scope; the first two only move version numbers in Phase 1 tests, the last two make plan mitigations real.

### Process notes

- The root-pin guard script (`root-pin.sh`) could not be run: this harness refuses `bash <script>` and direct execution of that file (`permission denied`, no execute bit). Its check was done by hand instead: `git rev-parse --show-toplevel` printed the pinned root `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before the first write and before each commit.
- The per-plan commit ledger file under the git directory could not be written (writes outside the worktree are refused). `plan_head_before` is `340a82f`, the HEAD when the plan began, and `commits: 3` was measured with `git rev-list --count 340a82f..HEAD` before this SUMMARY.
- Start time was not recorded at the start; the duration is estimated from the previous plan's STATE write.

## Issues Encountered

- `getCheckValidations` and `listHookReads` are pure reads with no refusal case, so the acceptance sentence "at least one refusal case each" is met by an empty-result case for these two; every writer and every run-scoped reader has a refusal test.
- No kill of a real process mid-transaction is exercised here (D7 in the coverage block); that is the run kill-point suite of plan 02-17. The transaction itself is the existing `tx` helper.
- The stored `reason` of a run lives in `runs.reason` (new column), whereas Phase 1 reads an onboarding's reason from its last transition event; the two designs coexist and the onboarding one is untouched.

## Verification

- `node --test test/unit/run-lifecycle.test.ts test/fault/migrations.test.ts test/integration/run-ledger.test.ts`: 89 of 89 pass
- `node --test test/integration/ledger-status.test.ts test/integration/lease.test.ts test/fault/budgets.test.ts test/fault/killpoints.test.ts`: pass (Phase 1 suites)
- Whole suite `node --test`: 1476 tests, 1454 pass, 0 fail, 22 skipped (live cases that need `AVARICE_LIVE=1`); includes `test/unit/localfs.test.ts` and `test/unit/store-mode.test.ts`
- `node scripts/check-boundaries.ts` and `npx tsc -p .`: clean
- Acceptance: `git diff 340a82f..HEAD -- src/adapters/sqlite/migrations/0001-initial.ts` prints nothing; `grep -c "MIGRATION_0002" src/cli/composition.ts` is 2; `grep -c "UPDATE evidence" src/adapters/sqlite/ledger.ts` is 0; run-lifecycle.test.ts checks every diagram edge and at least 8 named refused edges; the three RED evidence files name the failing tests.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-02-05 is mitigated (version and fence guard in the transaction, takeover only after strict expiry, tested with a taken-over lease), T-02-06 (insert-only methods and triggers; events stay hash-chained), T-02-07 (one transaction per migration, backup before, checksum refusal tested for version 2). No package was installed (T-02-SC) and no live model call was made, so nothing was added to the Phase 2 spend ledger.

## Next Phase Readiness

Ready for 02-04 and every plan that reads or writes a run. A plan that needs a run records it with `createRun`, takes the lease with `acquireRunLease`, and advances only through `transitionRun` and `recordRunCheckpoint`. Plan 02-05 will define `EVIDENCE_STATUSES` in `src/domain/evidence.ts`; the adapter keeps its own private copy of the same six values, which that plan may switch to the domain constant. Plan 02-11 writes `hook_reads` with its own SQL (the primary key is invocation, agent and path) and reads it back with `listHookReads`.

## Self-Check: PASSED

All created files exist on disk (`src/domain/run-lifecycle.ts`, `src/adapters/sqlite/migrations/0002-run.ts`, `test/unit/run-lifecycle.test.ts`, `test/integration/run-ledger.test.ts`, the three RED evidence files) and commits `668afb0`, `64f0a57` and `bef4985` are ancestors of HEAD on the phase branch.
