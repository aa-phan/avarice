---
phase: 03-decisions-independent-work-and-amendments
plan: 02
subsystem: database
status: complete
tags: [sqlite, ledger, migration, decisions, attempts]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: the run ledger (runs, work items, decisions opened in state open), assertItemTransition, schema version 2
provides:
  - Migration 0003 (schema version 3) adding attempts.item_id, decisions.supersedes, runs.cancel_requested_at/by and the notifications table, forward-only
  - answerDecision, reopenStaleDecision and withdrawDecision on the ledger port and the SQLite adapter, each one transaction under the run lock
  - The per-item attempt key (RunAttemptInput.itemId, AttemptRow.itemId, listRunAttempts item filter, NULL read as item A)
affects: [03-03, 03-12, 03-14, 03-20, every plan that reads decisions or attempts, the documentation plan 03-31]

actuals:
  tokens: 17900
  tasks: 3
  commits: 5
plan_head_before: 5bd22b5a6a59f43b50ca0cb68169fab1f1e8d4b3
plan_head_after: e7b8bb99fa66c7d50862ea147d861529d32d96b0
commits: 5

tech-stack:
  added: []
  patterns:
    - "A decision state change is one tx(): lockRun, a guarded UPDATE ... WHERE state = 'open', then events; the contract-version check sits inside the transaction"
    - "applyItemTransition is the single place a work item changes state; transitionWorkItem and answerDecision both call it"
    - "insertDecisionRow is the single decision INSERT; openDecision and the stale re-open both call it"
    - "Events carry IDs, codes and counts only; free text lives in the row (decisions.answer)"

key-files:
  created:
    - src/adapters/sqlite/migrations/0003-decisions.ts
    - test/integration/decision-ledger.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-02-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-02-red-evidence-task2.json
  modified:
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/cli/composition.ts
    - test/fault/migrations.test.ts
    - test/integration/run-ledger.test.ts
    - test/integration/run-start.test.ts
    - test/integration/ledger-status.test.ts
    - test/integration/init.test.ts
    - test/helpers/hook-fixture.ts
    - scripts/hook-bench.ts

key-decisions:
  - "answerDecision releases an item only when it is blocked_on_decision and no other open decision of the run lists it; the decision.answered event carries itemsReleased as a count, and the per-item work_item.transition events carry the decisionId"
  - "reopenStaleDecision keeps the received answer, answerer, time and channel on the stale row and leaves the successor's answer columns empty; the successor opens with the stale decision's urgency and no attempt ID"
  - "A decision of another run is not_found, a decision in any state but open is conflict, and a contract version other than the caller's is conflict; each writes nothing"

requirements-completed: []

coverage:
  - id: D1
    description: "Migration 0003: a fresh store reaches version 3 in one run; a version 2 store upgrades with a backup first, every row kept and the new columns NULL"
    requirement: "AUT-2"
    verification:
      - kind: integration
        ref: "test/fault/migrations.test.ts#migrates a version 2 store to version 3"
        status: pass
      - kind: integration
        ref: "test/integration/decision-ledger.test.ts#upgrades a version 2 store"
        status: pass
    human_judgment: false
  - id: D2
    description: "answerDecision answers an open decision and releases exactly the items no other open decision holds, refuses a non-open decision and a moved contract version, and keeps the answer text out of events"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decision-ledger.test.ts#answerDecision (tracer)"
        status: pass
    human_judgment: false
  - id: D3
    description: "reopenStaleDecision (old answer kept, successor with supersedes), withdrawDecision (items keep state), and the per-item attempt key with NULL read as item A"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/decision-ledger.test.ts#reopenStaleDecision, #withdrawDecision, #the per-item attempt key (D-12)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 02: Decision state changes and migration 0003 Summary

**Migration 0003 and three atomic ledger methods (answerDecision, reopenStaleDecision, withdrawDecision) make answered, stale and withdrawn decisions reachable, with a per-item attempt key and the schema at version 3.**

## Performance

- **Duration:** about 55 min (start 2026-11-08T23:50Z, end 2026-11-09T00:46Z, dominated by one 7-minute full suite run)
- **Tasks:** 3 of 3
- **Commits:** 5 task commits (2 RED, 2 GREEN, 1 test-list), plus the metadata commit
- **Files:** 4 created, 10 modified

## Accomplishments

- `0003-decisions.ts` adds `attempts.item_id`, `decisions.supersedes`, `runs.cancel_requested_at`, `runs.cancel_requested_by`, the `notifications` table (methods arrive in plan 03-12) and two indexes (`attempts_item`, `notifications_state`). `MIGRATIONS` in `src/cli/composition.ts` now has three entries; a version 2 store gets a backup and keeps every row.
- `answerDecision` runs in one transaction under the run lock: the decision must belong to the run (else `not_found`) and be `open`, the run's highest contract version must equal `expectContractVersion` (both else `conflict`), the UPDATE is guarded by `state = 'open'`, and each affected item that is `blocked_on_decision` and not listed by another open decision goes to `ready` through `applyItemTransition` (which calls `assertItemTransition`). One `decision.answered` event carries `{ runId, decisionId, channel, itemsReleased }`; the answer text is only in `decisions.answer`.
- `reopenStaleDecision` marks an open decision `stale` with answer, answerer, time and channel kept, then opens a successor with the same class, issue, options, consequences, affected items, recommendation, authorized default and urgency, the new state digest, contract version and evidence refs, and `supersedes` set to the old ID. Events: `decision.stale`, then `decision.opened` with `supersedes`. Affected items keep their state.
- `withdrawDecision` moves an open decision to `withdrawn` (reason `owner` or `cancel`) with a `decision.withdrawn` event; affected items keep their state. AUT-12 cancel will call it.
- `recordRunAttempt` stores `item_id`; `listRunAttempts(runId, { itemId })` filters by item and item `A` also matches NULL rows. No stage passes an item yet (plan 03-14).
- Refactors with no behaviour change: `applyItemTransition` (shared by `transitionWorkItem` and `answerDecision`) and `insertDecisionRow` (shared by `openDecision` and the re-open).

## TDD gate

RED task 1: `test/integration/decision-ledger.test.ts` (8 tests) against a stub `MIGRATION_0003` (`SELECT 1;`) and an `answerDecision` stub returning `invalid: not implemented`; all 8 failed on assertions or `no such table: notifications`. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` for `03-02-red-evidence-task1.json`. RED task 2: the file grew to 13 tests; with `reopenStaleDecision` and `withdrawDecision` stubbed and `itemId` not stored, 6 failed on assertions and the 7 task-1 tests passed; `RED_EVIDENCE_OK` for `03-02-red-evidence-task2.json`. GREEN commits `2261791` and `29f2a35`. The tracer gate (task 1 `<verify>` re-run end to end) passed before task 2 started.

## Task Commits

1. **Task 1: tracer, migration 0003 and answerDecision** - `d24b495` (test, RED), `2261791` (feat, GREEN)
2. **Task 2: stale re-open, withdraw, per-item attempt key** - `291641c` (test, RED), `29f2a35` (feat, GREEN)
3. **Task 3: every explicit migration list and the suite at version 3** - `e7b8bb9` (test)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tests that pin schema version 2 outside the plan's file list**
- **Found during:** Task 3 (full suite)
- **Issue:** `test/integration/init.test.ts` (two tests: `schema version:  2` in the init output, `schema_version` 2, two `schema_migrations` rows) failed once the production `MIGRATIONS` list reached version 3. `test/integration/ledger-status.test.ts` also pinned version 2, two migration rows and a "newer build" row at version 3 (in the plan's list, but the newer-build case is a version-4 row now).
- **Fix:** expectations moved to version 3 and three migration rows; the newer-build store gets a version 4 row; the title of the status test names plan 03-02.
- **Files modified:** test/integration/init.test.ts, test/integration/ledger-status.test.ts
- **Commit:** e7b8bb9

**2. [Plan wording] `test/fault/migrations.test.ts` migration list**
- **Found during:** Task 1 (its verify command runs this file, and the CLI-path case upgrades through the production list)
- **Issue:** the plan assigns the migration-list edit and the version 3 cases of this file to Task 3, but Task 1's own verify runs the file and failed on the version expectation the moment `composition.ts` shipped three migrations.
- **Fix:** made the file's edits in Task 1's GREEN commit: `SHIPPED` is the three-migration list, a `V2_SHIPPED` list keeps the version 1 to 2 cases about what 0002 does, the fresh store ends at version 3, the CLI path at version 3, and a new version 2 to 3 upgrade case. Task 3 then only touched the remaining files.
- **Files modified:** test/fault/migrations.test.ts
- **Commit:** 2261791

**3. [Plan wording] Acceptance count for `MIGRATION_0003` in `composition.ts`**
- `grep -n "MIGRATION_0003" src/cli/composition.ts` prints two lines (the import and the list entry), not one. Both are required; the criterion's intent (the list includes it) holds.

**Total deviations:** 3 (1 Rule 3, 2 plan-wording). **Impact:** none on scope.

## Issues Encountered

- Full `npm test` (2653 tests): 2595 pass, 3 failed on the first run. Two were the init tests above (fixed). The third, `test/mutation/fail-closed.test.ts` "does not cache a probe that timed out twice (WR-07)", is the known load-sensitive file; it passed alone (35 of 35). The full suite was not re-run after the init fix; `test/integration/init.test.ts` (19 of 19), the plan's verify files (169 of 169 before the init edit and unaffected by it), `tsc -p .` and `check-boundaries` pass.
- The version 2 upgrade case seeds its rows with raw SQL: after this plan `recordRunAttempt` and the decision INSERT write the new columns, so the ledger cannot write to a store that has not been migrated.

## Documentation surfaces (for plan 03-31)

`docs/system/` was not edited in this plan; the documentation plan writes these from the code:

- **Tables and columns:** `attempts.item_id` (NULL reads as item A), `decisions.supersedes`, `runs.cancel_requested_at`, `runs.cancel_requested_by`, table `notifications` (notification_id, run_id, kind, destination, subject_ids_json, state, attempts, next_attempt_at, last_error, created_at, updated_at, delivered_at; no methods yet), indexes `attempts_item` and `notifications_state`. Schema version 3; backup before the upgrade. `avarice init` and `status` now report version 3.
- **Port methods:** `answerDecision` (needs `expectContractVersion`, channel `terminal`), `reopenStaleDecision`, `withdrawDecision` (reason `owner` or `cancel`), `RunAttemptInput.itemId`, `AttemptRow.itemId`, `DecisionRow.supersedes`, `listRunAttempts(runId, { itemId })`.
- **Events:** `decision.answered` `{ runId, decisionId, channel, itemsReleased }`, `decision.stale` `{ runId, decisionId, channel }`, `decision.withdrawn` `{ runId, decisionId, reason }`, `decision.opened` gains `supersedes` on a re-open, `attempt.started` gains `itemId` when given, `work_item.transition` gains `decisionId` when an answer releases the item.
- **Findings to revisit:** `docs/system/findings.md` says answered, stale and withdrawn decisions are unreachable; that line is now false and moves or closes. Decision states and the "decision records" description need the three transitions.

## Known Stubs

None. The RED stubs (`SELECT 1;`, the `not implemented` methods) were replaced before each GREEN commit. The `notifications` table has no reader or writer yet by design (plan 03-12).

## Threat Flags

None. No new network endpoint, auth path or file access. T-03-03 (racing or duplicate answers) is mitigated by the single transaction with `state = 'open'` and the in-transaction contract-version check (tests: second answer and moved contract version return `conflict` and write nothing). T-03-04 (answer text in the event chain) is mitigated: a test scans every event's data for the answer text. T-03-SC: no package installs.

## Next Phase Readiness

Plan 03-20 (`decide`) can validate identity, option and digest and call these methods; plan 03-14 can pass `itemId` to attempts; plan 03-12 can add the notification methods on the table; the cancel plan can call `withdrawDecision` with reason `cancel`. The store is at schema version 3 everywhere.

## Self-Check: PASSED

Created files exist (0003-decisions.ts, decision-ledger.test.ts, both RED evidence records); commits d24b495, 2261791, 291641c, 29f2a35, e7b8bb9 are on the branch; every file that names `MIGRATION_0002` also names `MIGRATION_0003`; `tsc -p .` and `check-boundaries` clean; verify files 169 of 169 green.
