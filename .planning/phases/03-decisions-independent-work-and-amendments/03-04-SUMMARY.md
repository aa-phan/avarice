---
phase: 03-decisions-independent-work-and-amendments
plan: 04
subsystem: domain
status: complete
tags: [scheduler, work-items, decisions, lifecycle, pure-domain]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: WorkItemState, ITEM_EDGES and assertItemTransition in src/domain/run-lifecycle.ts
provides:
  - src/domain/work-items.ts, the scheduler as one pure function (ItemFacts, DecisionFacts, transitiveDependents, blockedItems, readyItems, RunDisposition, runDisposition, isContinuableBlocked)
  - The item edge implemented -> delegated (one bounded repair, AUT-10); the work item state count stays 6
affects: [03-12, 03-14, 03-18, the documentation plan 03-31]

actuals:
  tokens: 4800
  tasks: 2
  commits: 4
plan_head_before: aa0122b4851d9dd71541a3dc9527216b9b946d70
plan_head_after: a22ea6f223bff37b782e61bfc028d6a2db2ad01b
commits: 4

tech-stack:
  added: []
  patterns:
    - "The scheduler reads plain fact records (ItemFacts, DecisionFacts), sorts every input by declaration order then id before judging, and never reads the ledger itself"
    - "Readiness is one rule: state ready, every dependency done, and no open decision on the item or on an item it transitively depends on"
    - "RED stubs export every planned name so the tests fail on assertions, not on load"

key-files:
  created:
    - src/domain/work-items.ts
    - test/unit/work-items.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-04-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-04-red-evidence-task2.json
  modified:
    - src/domain/run-lifecycle.ts
    - test/unit/run-lifecycle.test.ts

key-decisions:
  - "runDisposition checks in-flight items first (delegated, implemented, gated, first in declaration order), then the first ready item, then all-done, then blocked (any open decision, ids sorted), else undeliverable listing every item not done"
  - "isContinuableBlocked is exactly: an item is ready, or no open decision remains; a run with no open decision and nothing ready is continuable so the supervisor can report undeliverable"
  - "transitiveDependents excludes a root unless another path leads back to it (a dependency cycle), and ignores ids that name no item"
  - "Only decisions in state open block work; answered, stale and withdrawn decisions are ignored by the scheduler"

requirements-completed: [AUT-3, AUT-10, AUT-12]

coverage:
  - id: D1
    description: "readyItems returns an item only when its state is ready, every dependency is done and no open decision lists it or an item it depends on, in declaration order, whatever the input order"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/work-items.test.ts#readyItems"
        status: pass
      - kind: unit
        ref: "test/unit/work-items.test.ts#transitiveDependents"
        status: pass
    human_judgment: false
  - id: D2
    description: "runDisposition gives continue, start, all-done, blocked or undeliverable, and isContinuableBlocked is true exactly when an item is ready or no open decision remains"
    requirement: "AUT-12"
    verification:
      - kind: unit
        ref: "test/unit/work-items.test.ts#runDisposition"
        status: pass
      - kind: unit
        ref: "test/unit/work-items.test.ts#isContinuableBlocked"
        status: pass
    human_judgment: false
  - id: D3
    description: "The item lifecycle allows implemented -> delegated for a bounded repair and still refuses it from gated, done and blocked_on_decision; the state count stays 6"
    requirement: "AUT-10"
    verification:
      - kind: unit
        ref: "test/unit/run-lifecycle.test.ts#work item transition table"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-08
---

# Phase 3 Plan 04: Scheduler and repair edge Summary

**One pure function decides the next work item, the visible blocked state and the undeliverable end after a withdrawal, and the item lifecycle gains the single implemented -> delegated repair edge.**

## Performance

- **Duration:** about 12 min of work (start about 2026-11-09T00:46Z, end 2026-11-09T00:58Z), plus a full-suite run that finished in the background
- **Tasks:** 2 of 2
- **Commits:** 4 task commits (2 RED, 2 GREEN), plus the metadata commit
- **Files:** 4 created, 2 modified

## Accomplishments

- `src/domain/work-items.ts` is pure and imports only `run-lifecycle.ts` for the `WorkItemState` type. `readyItems` returns an item only when its state is `ready`, every item in its `dependsOn` is `done`, and no open decision lists it or any item it depends on (`blockedItems` adds the transitive dependents of each open decision's affected items). Results come back in declaration order, ties broken by item id.
- `runDisposition` returns one of five results: `continue` an in-flight item, `start` the first ready item, `all-done`, `blocked` with the sorted ids of the open decisions, or `undeliverable` with every item not done (the state after a withdrawn decision with nothing else able to run).
- `isContinuableBlocked` is the supervisor and `decide` pickup rule (D-16): an item is ready, or no open decision remains.
- `ITEM_EDGES` gains `['implemented', 'delegated']` with a comment naming AUT-10 and D-11 and stating that gate G3 and the invocation budget enforce the repair limit, not the table. `gated -> delegated`, `done -> delegated` and `blocked_on_decision -> delegated` stay refused; `WORK_ITEM_STATES.length` is still 6.
- Every scheduler case runs over reversed and rotated input and checks a deep-equal result, which is the T-03-07 mitigation (dependent work never starts while a decision is open, whatever the row order).

## TDD gate

RED task 1: `test/unit/work-items.test.ts` (24 tests) against a stub module whose functions returned empty or fixed values; 18 failed on assertions and the 6 passing held only for the stub's own answer. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` for `03-04-red-evidence-task1.json`; the semantic assessment is in the record. RED task 2: with the edge absent, the new repair test and the exhaustive item-edge test failed on assertions (46 of 48 passed); `RED_EVIDENCE_OK` for `03-04-red-evidence-task2.json`. GREEN commits `b1e63ef` and `a22ea6f`. The tracer gate (task 1 `<verify>` plus `tsc -p .`) was re-run end to end before task 2 started and passed.

## Task Commits

1. **Task 1: tracer, readyItems and runDisposition** - `5075246` (test, RED), `b1e63ef` (feat, GREEN)
2. **Task 2: the repair edge implemented -> delegated** - `ada00e7` (test, RED), `a22ea6f` (feat, GREEN)

## Files Created/Modified

- `src/domain/work-items.ts` - the scheduler: fact types, `transitiveDependents`, `blockedItems`, `readyItems`, `runDisposition`, `isContinuableBlocked`
- `test/unit/work-items.test.ts` - 24 tests over the A/B/C/D scenario, chains, cycles, withdrawn and answered decisions, and shuffled input
- `src/domain/run-lifecycle.ts` - the `implemented -> delegated` edge and the comment above `WORK_ITEM_STATES`
- `test/unit/run-lifecycle.test.ts` - the expected edge list names the new edge; a test for the repair edge and three refusals
- `.planning/phases/03-decisions-independent-work-and-amendments/03-04-red-evidence-task1.json`, `...-task2.json` - RED evidence

## Decisions Made

See `key-decisions` in the frontmatter. The two the next plans lean on: `blocked` is reported only when no item is in flight or ready and an open decision exists, and `isContinuableBlocked` is true when no open decision remains even if nothing is ready, so the supervisor reaches `undeliverable` instead of waiting forever.

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan wording] `test/unit/transitions.test.ts` was not edited**
- **Found during:** Task 2
- **Issue:** the plan lists it among the item-edge tests to update, but that file tests only the onboarding lifecycle (`TRANSITIONS`, `assertTransition`) and names no work item edge. The item edge list is asserted in `test/unit/run-lifecycle.test.ts`, which was updated. The file still runs in the plan's verify command and passes.
- **Files modified:** none

**Total deviations:** 1 (plan wording). **Impact:** none on scope.

## Issues Encountered

None. Full `node --test` run after Task 2: 2678 tests, 2623 pass, 0 fail, 55 skipped (the existing live and platform skips). `tsc -p .` and `node scripts/check-boundaries.ts` (80 files) pass.

## Documentation surfaces (for plan 03-31)

`docs/system/` was not edited in this plan; the documentation plan writes these from the code:

- **Readiness rule:** an item is ready to run only when its state is `ready`, every item it depends on is `done`, and no open decision lists it or any item it transitively depends on; items are taken in brief declaration order. Decisions in state answered, stale or withdrawn never block.
- **Dispositions:** continue an in-flight item (delegated, implemented or gated, first in declaration order), start the first ready item, all-done, blocked (nothing ready and at least one open decision; the run waits visibly, no polling), undeliverable (nothing ready, no open decision, some item not done, as after a withdrawn decision). A run in `blocked_on_decision` is continuable exactly when an item is ready or no open decision remains.
- **New edge:** work item `implemented -> delegated` for one bounded repair of an item whose required check newly failed; the limit is gate G3 and the invocation budget. `docs/system/runs.md` states the item moves strictly `ready` to `delegated` to `implemented` to `gated` to `done` with only the discard edge back, and says a run with more than one item stops with an internal error; both statements change once the stages (plan 03-14) use the scheduler.

## Known Stubs

None. The RED stub module was replaced by the real implementation in `b1e63ef`. Nothing calls the scheduler yet by design; the running stage (plan 03-14) and the supervisor and `decide` pickup (plan 03-18) are its first callers.

## Threat Flags

None. No new network endpoint, auth path or file access; the module is pure. T-03-07 (dependent work started while its decision is open) is mitigated: readiness requires every dependency done and no open decision on the item or an ancestor, tested with a chain, a second open decision and shuffled input. T-03-SC: no package installs.

## Next Phase Readiness

Plan 03-14 can call `runDisposition` on every pass of the running stage with `ItemFacts` built from the ledger's work item rows, and plan 03-18 can call `isContinuableBlocked` for supervisor and `decide` pickup. The repair delegation (`implemented -> delegated`) is accepted by `transitionWorkItem` through `assertItemTransition`; nothing performs it until gate G3 lands.

## Self-Check: PASSED

- Created files exist: `src/domain/work-items.ts`, `test/unit/work-items.test.ts`, both RED evidence records.
- Commits `5075246`, `b1e63ef`, `ada00e7`, `a22ea6f` are ancestors of HEAD.
- Acceptance criteria re-run: both RED evidence records have exit code 1 and `RED_EVIDENCE_OK`; `grep -n "'implemented', 'delegated'" src/domain/run-lifecycle.ts` prints one line (154); `node scripts/check-boundaries.ts` passes with `src/domain/work-items.ts` in its scan.
