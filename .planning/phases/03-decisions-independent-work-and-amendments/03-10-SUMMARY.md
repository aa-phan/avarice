---
phase: 03-decisions-independent-work-and-amendments
plan: 10
subsystem: domain
status: complete
tags: [amendment, run-contract, invalidation, budgets, acceptance]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-03 (RunContract.contractVersion as a number, BUDGET_OVERRIDE_NAMES, globWithin, checkG0Static, work items with acceptance)
provides:
  - "applyAmendment(contract, request, context): contract version n+1 with the same policyRevision, a field-level diff and the D-20 invalidation classes, or an invalid error naming the flag"
  - "classifyInvalidation(diff): the D-20 table read off the diff's field paths, in a fixed class order"
  - "staleTargets(invalidates, evidence, gates): the evidence IDs and gate names that get an appended stale row; never an update or a delete"
  - "budgetRowChanges(diff, next): the ledger budget rows (name, new limit, exactness) a budget amendment changes"
  - "parseAcceptanceSection exported from the brief parser (the former private readAcceptance)"
affects: [03-12, 03-15, 03-31]

requirements-completed: []

actuals:
  tokens: 12000
  tasks: 2
  commits: 4
plan_head_before: 92e424f70ca5808d52189189270da796c1b9297e
plan_head_after: 7e8f1f65687e792bfa3ed7bcde4daa7823829f73
commits: 4

tech-stack:
  added: []
  patterns:
    - "An amendment never mutates its input: structuredClone, then field-level edits that each push a FieldDiff entry; a request that changes nothing is refused as `nothing to amend`"
    - "Invalidation is a selection over the diff and the ledger rows; the selector returns IDs only, so the insert-only evidence and gate tables only ever receive appended rows"

key-files:
  created:
    - src/domain/amendment.ts
    - test/unit/amendment.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-10-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-10-red-evidence-task2.json
  modified:
    - src/domain/brief.ts
    - test/unit/brief.test.ts

key-decisions:
  - "A per-invocation cost cap above the per-run cap, or a concurrent subagent cap above the total, is refused after an amendment instead of being moved the way the compiler moves it, so an amendment never edits a field the request did not name"
  - "A check amendment rebuilds verification.requiredChecks in declaration order (the compiler's order) and leaves execution.checks[].required alone; requiredChecks is the field every consumer reads"
  - "Invalidation classes are reported in one fixed order (gates, acceptance-mappings, checks-rerun, scope-conformance, check-evidence, approvals), which is the type's declaration order, so equal amendments give equal lists"
  - "staleTargets reads the latest contract version present in the evidence rows, skips rows already stale, and judges a gate by its latest row (the ledger lists gate rows oldest first); the acceptance-mappings class lists evidence rows that map at least one criterion"
  - "The amended contract's compiledAt is the context's nowIso; the diff does not report compiledAt or contractVersion"
  - "--item is ignored for an ID the contract already has (that ID keeps its item); an item that names no work item is refused even then"

patterns-established:
  - "The domain cannot import src/app, so budgetRowChanges repeats the mapping budgetRowsOfRun uses; a unit test compares the two row by row so they cannot drift"

coverage:
  - id: D1
    description: "A budget amendment (raise or lower) returns contract version n+1 with the same policyRevision, the diff, no invalidation and the ledger rows to change; bad values, an unknown name, an empty request and a bad reason are refused naming their field; the input is not mutated"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/amendment.test.ts#applyAmendment tracer: a budget raise produces contract version 2 (RC-6, D-19)"
        status: pass
    human_judgment: false
  - id: D2
    description: "--add-write widens files.write and files.create only inside the conventions write set and off protected globs; --check +name/-name edits the required list and keeps at least one; an acceptance file changes or adds criteria on the right item; G0 runs on the result"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/amendment.test.ts#applyAmendment: --add-write (D-20 scope, T-03-16), #applyAmendment: --check +name / -name (D-20 required checks, AUT-16), #applyAmendment: --acceptance (D-20 acceptance, G0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each D-20 row (acceptance, writable or protected paths, required checks, policy revision, budgets and notifications) has a test asserting its invalidation classes, and combined requests give the union in fixed order"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/amendment.test.ts#classifyInvalidation: the D-20 table, #applyAmendment: combined requests"
        status: pass
    human_judgment: false
  - id: D4
    description: "staleTargets lists the evidence IDs and gate names that get an appended stale row for each class and never proposes an update or delete (T-03-17)"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/amendment.test.ts#staleTargets: appended rows only (T-03-17)"
        status: pass
    human_judgment: false
  - id: D5
    description: "parseAcceptanceSection is exported from brief.ts and gives the criteria and refusals parseBrief gave through readAcceptance"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/brief.test.ts#parseAcceptanceSection: the acceptance line parser (RC-6)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 10: Contract amendment, pure domain logic Summary

**applyAmendment computes contract version n+1, its field-level diff and its D-20 invalidation classes for budget, write-scope, required-check and acceptance changes, with no I/O; staleTargets selects the evidence and gate rows that get an appended stale row.**

## Performance

- **Tasks:** 2 (a tracer for budgets, then scope, checks and acceptance with the selector)
- **Files:** 6 (4 source and test, 2 RED evidence records)
- **Duration:** about 35 minutes (the start time was not recorded; estimated from the commit times)
- **Completed:** 2026-11-09

## Accomplishments

- Budget amendments raise or lower any of the seven `--budget` names to a finite value above 0 (a whole number for counts), with no upper bound (D-19). The diff names the contract path; `budgetRowChanges` names the ledger row and its new limit for the five budgets the ledger keeps.
- `--add-write` adds globs to `files.write` and `files.create` only when each sits inside the conventions write set and off the protected globs (T-03-16). A glob the contract already holds is skipped.
- `--check +name` and `--check -name` edit `verification.requiredChecks`; an undeclared name, a name given both ways and a request that would leave no required check are refused naming `check`.
- An acceptance file is parsed with the brief's own line parser. An existing ID takes the new text and references on its own item; a new ID goes to the item named by `item` (implied on a one-item run, required otherwise).
- `checkG0Static` runs on every amended contract; its failures refuse the amendment under field `g0`.
- `classifyInvalidation` and `staleTargets` implement the D-20 table and the appended-row selector.

## Task Commits

1. **Task 1 RED:** `b20b453` - failing tracer tests for a budget raise (typed stubs)
2. **Task 1 GREEN:** `35cb434` - applyAmendment writes version n+1 for a budget change
3. **Task 2 RED:** `fbff286` - failing tests for scope, check and acceptance amendments
4. **Task 2 GREEN:** `7e8f1f6` - scope, check and acceptance amendments with D-20 invalidation

The tracer gate: Task 1's verify (`node --test test/unit/amendment.test.ts && node scripts/check-boundaries.ts`) passed end to end before Task 2 began.

## Deviations from Plan

None - plan executed exactly as written. Two small judgement calls inside the plan's room are recorded under key-decisions (cost and concurrency consistency refused rather than adjusted; a fixed class order that matches the type declaration).

## Verification

- `node --test test/unit/amendment.test.ts test/unit/brief.test.ts test/unit/run-contract.test.ts`: 194 pass, 0 fail
- Whole unit suite: 1773 pass, 0 fail; `test/integration/run-start.test.ts`: 26 pass
- `npx tsc -p .`: no errors; `node scripts/check-boundaries.ts`: ok (86 files)

## Known Stubs

None.

## Threat Flags

None. The plan adds no endpoint, file access or schema; the amend command that exposes it is plan 03-15.

## Documentation surfaces (for plan 03-31)

Written into `docs/system/` by the documentation plan, from the code:

- **Amendable fields:** the seven budgets (`wallClockMinutes`, `invocations`, `toolCalls`, `subagentsTotal`, `subagentsConcurrent`, `costUsdPerInvocation`, `costUsdPerRun`), write globs (added only), required checks (`+name` and `-name` on declared checks), and acceptance criteria (changed or added, never deleted). Not amendable here: the policy revision, protected globs, notifications, exclusions, work-item structure.
- **Amendment rules:** the reason is required and at most 500 characters; a request that changes nothing is refused; budgets carry no upper bound but a per-invocation cost cap may not exceed the per-run cap and the concurrent subagent cap may not exceed the total; an added write glob must be inside the conventions write set and off protected globs; a run keeps at least one required check; an amended contract must pass the static G0 conditions; the next version keeps the policy revision and takes the amendment time as `compiledAt`.
- **Invalidation classes:** acceptance gives gates, acceptance-mappings and checks-rerun; write paths give scope-conformance; required checks give check-evidence; a policy revision change gives gates and approvals (not producible by `applyAmendment`; the classifier handles it for the plan that changes the policy); budgets, notifications and exclusions give nothing. The stale selector lists check evidence for check-evidence, mapped evidence for acceptance-mappings, passed gates for gates, and G2 and G4 for scope-conformance.
- The `docs/system` statement that only a human outside the run raises a limit stays true; the Ledger port comment already says so. D-19 (raise or lower, no upper bound, confirmation in plan 03-15) is the decision to cite.

## Next Phase Readiness

Plan 03-12 (already holds `amendRunContract`) and plan 03-15 (the amend command) can call `applyAmendment`, write `diff` to `contracts.diff_json`, call `budgetRowChanges` for the budget rows, and append stale rows for the IDs `staleTargets` returns. `RC-6` is left unmarked in REQUIREMENTS.md because `requirements.ready-ids` reports it not ready (other plans declare it).

## Self-Check: PASSED

- src/domain/amendment.ts, test/unit/amendment.test.ts, 03-10-red-evidence-task1.json, 03-10-red-evidence-task2.json: found
- Commits b20b453, 35cb434, fbff286, 7e8f1f6: found on the branch
