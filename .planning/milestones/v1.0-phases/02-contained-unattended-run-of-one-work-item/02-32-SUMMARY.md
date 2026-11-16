---
phase: 02-contained-unattended-run-of-one-work-item
plan: 32
subsystem: budget-settlement
tags: [budgets, ledger-transaction, fault-injection, cost-charge, crash, gap-closure]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: budget reservation and settlement (02-17), killed-invocation cost rule (01-19 finding C), invocation charging on lease loss (02-30)
provides:
  - Ledger.settleBudgets(runId, charges, event?) and BudgetCharge: every charge and an optional event in one transaction, with chargeBudget's per-row rules
  - settleInvocation and chargeOrphans each make one settleBudgets call
  - wasKilled counts an outcome with resultSeen false, so a crash is charged its cost reservation
  - fault-injection tests on the real ledger (a trigger aborting the costUsd update)
  - containment.md, data-model.md and processes.md describe both behaviors
affects: [02-35 documentation pass, verify-work 2]

plan_head_before: 5d55ec5fce3976460e88e724a45578665aae7de7
plan_head_after: 4893dc09de3185816d32e264bf7b80885e4dad8c

actuals:
  tokens: 14000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "one ledger method applies a list of charges and an optional event inside one transaction; the single-charge method and the batch share one private per-row function"
    - "fault injection on the real store through a trigger added over a second node:sqlite connection and dropped in a finally"

key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-32-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-32-red-evidence-task2.json
  modified:
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/app/budget.ts
    - src/app/invocation.ts
    - test/fault/budgets.test.ts
    - test/fault/run-discard-retry.test.ts
    - docs/system/containment.md
    - docs/system/data-model.md
    - docs/system/processes.md

key-decisions:
  - "The orphan-conversion fault test drives the conversion through reserveInvocation on an onboarding fixture, not chargeRunOrphans: both call the same chargeOrphans, and chargeRunOrphans needs a stored run contract that only a full run fixture provides."
  - "Only one assertion changed because a crashed fake unit is now charged its reservation: run-discard-retry costUsd, 0.02 to 4."
  - "The orphan's uncharged wall clock stays as it is; docs/system/findings.md is not touched (owner decision)."

patterns-established:
  - "A multi-write budget operation goes through settleBudgets, never through consecutive chargeBudget calls"

requirements-completed: [CON-13, CON-16]

coverage:
  - id: D1
    description: "A settlement's charges (invocation from the reservation, wall clock, cost) are written in one ledger transaction: a failure injected at the cost write leaves every budget row as before, and a retry charges each amount once"
    requirement: "CON-13"
    verification:
      - kind: unit
        ref: "test/fault/budgets.test.ts#budget charges are one transaction (R-WR-05) > a failure at the cost write leaves a settlement uncharged as a whole, and a retry charges each amount once"
        status: pass
    human_judgment: false
  - id: D2
    description: "An orphan conversion's charges and its invocation.orphan-charged event are written in one transaction: a failure at the cost write leaves reserved, the cost row and the event log unchanged, and a retry charges once and writes one event"
    requirement: "CON-13"
    verification:
      - kind: unit
        ref: "test/fault/budgets.test.ts#budget charges are one transaction (R-WR-05) > a failure at the cost write leaves an orphan conversion and its event unwritten, and a retry charges the orphan once"
        status: pass
      - kind: unit
        ref: "test/fault/budgets.test.ts#budget charges are one transaction (R-WR-05) > settleBudgets rolls back every charge and the event when a reserved charge is larger than `reserved`"
        status: pass
    human_judgment: false
  - id: D3
    description: "An invocation that ends without a result event (exit 1, or exit 0) is charged the larger of its reported cost and its full reservation with basis reservation; one that reported a result keeps its reported cost; timeout and signal charges are unchanged"
    requirement: "CON-16"
    verification:
      - kind: unit
        ref: "test/fault/budgets.test.ts#a killed or interrupted invocation is charged its cost reservation > charges the reservation when the host ended without a result event, whether it exited non-zero or exited 0 (R-WR-04)"
        status: pass
      - kind: unit
        ref: "test/fault/budgets.test.ts#a killed or interrupted invocation is charged its cost reservation > charges the reported cost, with basis reported, when the host sent a result event and exited 0 (R-WR-04)"
        status: pass
      - kind: integration
        ref: "test/fault/run-discard-retry.test.ts#a second failure is a decision, not a second retry (FR-4: no competing retry loop)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/system containment.md, data-model.md and processes.md state the one-transaction settlement and the no-result charge"
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and style are checked by the fresh prose review in plan 02-35; only the plan's grep was run here."

duration: 55min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 32: Budget settlement Summary

**A settlement and an orphan conversion now commit as one ledger transaction through `Ledger.settleBudgets`, and an invocation that ended without a result event is charged its full cost reservation instead of 0.**

## Performance

- **Duration:** about 55 min (the full suite and the kill-point suites took most of the wait)
- **Completed:** 2026-11-08
- **Tasks:** 3
- **Files modified:** 11 (including the two RED evidence files)

## Accomplishments

- R-WR-05 fixed, including the settlement path the review did not name. `settleBudgets` runs every charge and the optional event inside one `tx`; `chargeBudget` and the batch share one private `applyCharge`, so the per-row rules (amount check, conflict when a reservation is short) are unchanged. `chargeOrphans` makes one call (invocations from the reservation, `costUsd` direct, the `invocation.orphan-charged` event) and `settleInvocation` makes one call with its three charges. `grep -c "chargeBudget(" src/app/budget.ts` prints 0.
- R-WR-04 fixed. `wasKilled` counts `details.resultSeen === false`, so a crash (non-zero exit, or exit 0 with no result) is charged `max(reported, reservation)` with basis `reservation`. A host that fails at startup and ends without a result now charges a full per-invocation cost reservation; its invocation unit is spent anyway.
- The orphan's wall clock is still not charged (the open line in `docs/system/findings.md` is unchanged).
- containment.md (Settlement paragraph), data-model.md (budgets list) and processes.md (onboarding settlement step and the crashed-unit flow) describe both behaviors without file paths or function names.

## Task Commits

1. **Task 1: Tracer, one transaction (R-WR-05)**
   - RED `d227960` (test): settlement and orphan cases with a trigger-injected failure
   - GREEN `18d8e89` (feat): `settleBudgets` in port and adapter, both callers, two unit cases
2. **Task 2: no-result charge (R-WR-04)**
   - RED `8a0bce6` (test): crashed no-result case, result-seen guard case
   - GREEN `e283a45` (fix): `wasKilled`, one updated assertion
3. **Task 3: docs/system** - `4893dc0` (docs)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Both TDD tasks have a `test(02-32)` commit before the GREEN commit. No refactor commits.

- **RED, Task 1** (`02-32-red-evidence-task1.json`): `node --test --test-reporter=tap test/fault/budgets.test.ts` at the base. 23 tests, 21 pass, 2 fail. The settlement case finds invocations at used 3 / reserved 0 and wall clock 1249 after the error (expected used 2 / reserved 1 / wall clock 15); the orphan case finds reserved 0 and used 3 (expected reserved 1 / used 2). `gsd_run check tdd-red-evidence` on the TAP report wrapped in the classifier's record shape returned `RED_EVIDENCE_OK` (target_test_failed). The settleBudgets unit cases were added with GREEN, as the plan says.
- **RED, Task 2** (`02-32-red-evidence-task2.json`): 27 tests, 26 pass, 1 fail with `exit 1 charged 0`; the result-seen guard case passes at base. `RED_EVIDENCE_OK`.

## Changed cost assertions (Task 2)

| Test | Old | New | Why |
|---|---|---|---|
| test/fault/run-discard-retry.test.ts, "a second failure is a decision..." (test renamed to say so) | `costUsd` 0.02 (both crashed attempts reported 0.01) | 4 | Each crashed attempt ended without a result and is charged its reservation, the routine preset's per-invocation cap of 2 |
| test/fault/budgets.test.ts, "still charges exactly the reported cost for a run that finished on its own" | none (the assertion is unchanged) | none | The case now sets `exitCode: 0, resultSeen: true` explicitly, because outcomeOf defaults to `resultSeen: false` |

No assertion in test/fault/run-budgets.test.ts, the kill-point suites or the hook suite changed. The `invocation.finished` expectations for timeout and signal cases are untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The orphan-conversion fault test uses reserveInvocation, not chargeRunOrphans**
- **Found during:** Task 1 (RED)
- **Issue:** the plan names `chargeRunOrphans`, which needs a stored run contract; the in-process fixture of this file is an onboarding, which has none.
- **Fix:** the test converts the orphan through `reserveInvocation`, which calls the same `chargeOrphans`. The RED evidence says so. `chargeRunOrphans` stays covered by the run kill-point suites (run-killpoints, run-budgets), which pass.
- **Files modified:** test/fault/budgets.test.ts
- **Committed in:** `d227960`

**Total deviations:** 1 auto-fixed (blocking). **Impact:** none on behavior; the code path under test is shared.

## Issues Encountered

- The plan-commit ledger file under the git directory could not be written from this session (the tool refused the path), so `plan_head_before` was taken from the HEAD recorded at the start (`5d55ec5`). `git rev-list --count 5d55ec5..HEAD` measured 5 before this SUMMARY's own commit.
- Full suite (`npm test`): 2591 tests, 2533 pass, 55 skipped, 3 fail. The three failures were the SIGTERM case of claude-host.test.ts (known), the WR-07 probe case of fail-closed.test.ts (known; FC-10 reported with it), and "a run started from the shell keeps going after the shell exits" in test/integration/shell-supervisor.test.ts (not on the known list). Run alone, test/integration/shell-supervisor.test.ts, test/integration/claude-host.test.ts and test/mutation/fail-closed.test.ts pass: 76 of 76. The shell test exercises a fake run reaching ready_for_review through the shell and does not depend on budget charging in a way this plan changed; I attribute it to load, not to this plan.
- AC-3 line printed: `AC-3: 24/24 interrupted attempts identified` (run-killpoints, run-discard-stale-fence and hook-decision: 209 of 209 pass).

## Findings status (for plan 02-35)

| Finding | Status |
|---|---|
| R-WR-05 (chargeOrphans in three writes) | Fixed, including settleInvocation, which the review did not name |
| R-WR-04 (crash with no result charged 0) | Fixed: an ending with no result is charged its reservation |
| Orphan's uncharged wall clock (findings.md, intent unknown) | Unchanged; owner decision |

docs/system documents changed for plan 02-35's fresh review: containment.md, data-model.md, processes.md. coverage.md was not touched.

## Known Stubs

None.

## Threat Flags

None. T-02-112 and T-02-113 are mitigated as planned.

## Self-Check: PASSED

- Created files exist: both RED evidence files and this SUMMARY.
- Commits `d227960`, `18d8e89`, `8a0bce6`, `e283a45` and `4893dc0` are ancestors of HEAD.
- Verification: budgets, run-invocation and ledger-and-record suites (46 of 46); budgets, run-budgets and run-discard-retry (45 of 45); kill-point, stale-fence and hook-decision (209 of 209, AC-3 24/24); `check-boundaries` ok; `tsc -p .` clean; the plan's two docs greps pass.
