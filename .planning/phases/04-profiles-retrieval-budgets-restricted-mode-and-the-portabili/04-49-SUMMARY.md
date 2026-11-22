---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 49
subsystem: security
tags: [retrieval, broad-discovery, grep-glob, knowledge-cost-cap, fail-closed, wr-05, wr-06]
requires:
  - phase: 04-40
    provides: the hook-decision changes this plan builds on (same file)
provides:
  - "normalizeToolCall judges a Grep glob with the every-file test and the brace rule, as it already judged a Glob pattern"
  - "knowledgeChunkLimit returns 0 for a negative, zero or non-finite cost cap"
  - "the knowledge stage ends absent with budget_exhausted before it builds a corpus when the chunk limit is 0"
affects: [04-53]
actuals:
  tokens: 5200
  tasks: 2
  commits: 5
plan_head_before: 871ef28da389e84dd091de03112e3d6b387d9637
plan_head_after: 0eab5a5c125986e5f4df25c3bdac27e460837668
tech-stack:
  added: []
  patterns:
    - "a filter that cannot be shown to narrow the search is no filter: the hook judges a brace group as the widest set it could name"
    - "a cap computed from a remaining budget is 0 when nothing is left, never NaN"
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-49-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-49-red-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/domain/knowledge-corpus.ts
    - src/app/stages/index-knowledge.ts
    - test/integration/hook-retrieval.test.ts
    - test/unit/hook-decision.test.ts
    - test/unit/knowledge-cost-cap.test.ts
    - test/integration/knowledge-cost-cap.test.ts
key-decisions:
  - "The stop without a cost cap reuses the existing absent reason budget_exhausted (already used by the knowledge invocation when its reservation is refused); no new outcome kind"
  - "A non-finite cap, Infinity included, gives a chunk limit of 0: the plan names non-finite caps, and an unbounded cap is not one the contract can grant"
requirements-completed: [CON-10, OPS-5]
coverage:
  - id: D1
    description: "In a run without broadDiscovery a Grep at the clone root whose glob is *, **, **/*, *.*, ./**/* or {*,.*} is denied with the broad-discovery rule and charges nothing; with broadDiscovery the first is charged to retrieval.searches and retrieval.broadDiscovery and a second is refused as spent"
    requirement: CON-10
    verification:
      - kind: test
        ref: "test/integration/hook-retrieval.test.ts#tracer: a Grep whose glob matches every file is a broad discovery (WR-06, CON-10, T-04-131)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A Grep with a real glob (*.ts, src/**/*.ts) or a type, stays a filtered search charged to retrieval.searches only; a Glob holding a brace group is unfiltered"
    requirement: CON-10
    verification:
      - kind: test
        ref: "test/unit/hook-decision.test.ts#maps Claude tool names to normalized calls and resolves relative paths against cwd"
        status: pass
    human_judgment: false
  - id: D3
    description: "knowledgeChunkLimit is 0 for -0.1, -3, 0, NaN, -Infinity and Infinity, and unchanged for positive caps"
    requirement: OPS-5
    verification:
      - kind: test
        ref: "test/unit/knowledge-cost-cap.test.ts#is 0 when no positive cost cap is left: a negative, zero or non-finite cap fits no chunk, and is never NaN (WR-05, OPS-5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "An onboarding whose cost row is overrun builds no corpus, starts no knowledge invocation and records absent / budget_exhausted with a detail naming the missing cost cap; an onboarding with budget left behaves as before"
    requirement: OPS-5
    verification:
      - kind: test
        ref: "test/integration/knowledge-cost-cap.test.ts#starts no knowledge invocation, builds no corpus, and the knowledge index step names the budget"
        status: pass
      - kind: test
        ref: "test/integration/knowledge-pass.test.ts (unchanged)"
        status: pass
    human_judgment: false
duration: not captured
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 49: Two caps that failed open now fail closed Summary

**A Grep whose glob matches every file, or holds a brace group, is now a whole-repository discovery and is refused or charged as one (WR-06); and a knowledge pass with no positive cost cap left returns a chunk limit of 0 and stops before it builds an uncapped corpus (WR-05).**

## Performance

- **Duration:** not captured (no start time was recorded for this run)
- **Completed:** 2026-11-22
- **Tasks:** 2 (one tracer, one auto), each with a committed failing test first
- **Files:** 7 changed (3 source, 4 test), plus 2 RED records

## Accomplishments

- **WR-06, tracer.** In `normalizeToolCall` a Grep is filtered only by a type or by a glob that narrows the files; a Glob is filtered only by a pattern that narrows them below its root. "Narrows" means the text is non-empty, does not match `MATCHES_EVERY_FILE` and holds no `{`. So `*`, `**`, `**/*`, `*.*`, `./**/*` and `{*,.*}` at the clone root are denied with `retrieval:broad-discovery-not-authorized` without `broadDiscovery`, and with it the first is charged to `retrieval.searches` and `retrieval.broadDiscovery` and a second is `retrieval:broad-discovery-spent`. `*.ts`, `src/**/*.ts` and a type still charge `retrieval.searches` only.
- **WR-05.** `knowledgeChunkLimit` returns 0 unless the cap is a positive finite number, before the formula (a negative cap made `** (1/exponent)` NaN, and `Math.max(1, NaN)` is NaN, which removed the corpus cap). The knowledge stage returns the existing `absent` outcome with reason `budget_exhausted` right after the limit is computed, before it selects, materializes or stores a corpus.

## TDD record

| Task | RED commit | RED evidence (`RED_EVIDENCE_OK`) | GREEN commit |
|---|---|---|---|
| 1 | `f51a6cd` | `04-49-red-task1.json`: a Grep with glob `*` at the clone root was allowed instead of denied as broad discovery | `5e39274` |
| 2 | `cf1e41d`, corrected by `0ec480c` | `04-49-red-task2.json`: with the cost row overrun the pass built and stored an uncapped corpus manifest (`no corpus manifest was written` failed `true !== false`); unit test: `knowledgeChunkLimit(-0.1)` was NaN | `0eab5a5` |

No REFACTOR commits. The first RED test of task 2 (`cf1e41d`) failed for the wrong reason: it overran the cost row before the contract stored it, so the budget rows did not exist yet and the cap stayed at the contract's 0.2 USD. GREEN was held back; `0ec480c` replaces the setup with a SQLite trigger that overruns the `costUsd` row as it is created, and RED was re-proved against the unchanged source (the evidence file records this).

## Verification

- `node --test` on `hook-retrieval`, `hook-decision`, `retrieval-race`, `knowledge-cost-cap` (unit and integration) and `knowledge-pass`: 240 of 240 pass. Also `hook.test.ts`, `fail-closed.test.ts` and `eval-retrieval.test.ts` (150 of 150) after task 1.
- `npm run typecheck` clean; `npm run check:boundaries` ok (132 files). The full suite was not run (over an hour here).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The first RED test of task 2 did not reach the behavior it named**
- **Found during:** Task 2 (GREEN)
- **Issue:** the integration test passed by neither route: its `UPDATE budgets` ran before the rows existed, so the pass saw the 0.2 USD contract cap and the knowledge host was called once for the ordinary reason.
- **Fix:** a trigger on `budgets` overruns `costUsd` on insert; the test asserts no host call, no manifest and a `no cost cap is left` detail. RED re-proved before GREEN.
- **Files modified:** `test/integration/knowledge-cost-cap.test.ts`
- **Commit:** `0ec480c`

**2. [Plan wording] No knowledge invocation started even before the fix**
- **Found during:** Task 2 (RED)
- **Issue:** the plan says an overrun row makes the host call count 0 after the fix. Before the fix the call count was already 0, because the reservation refuses a spent cost row; what failed open was the corpus (an uncapped one was built and stored).
- **Fix:** the target assertion is "no corpus manifest was written"; the call count stays asserted. The stop also moves from the invocation to before the corpus.

**3. [Plan wording] `MATCHES_EVERY_FILE` already held the `./` form**
- The regex already had `(\.\/)?`; only the brace rule and the Grep use were added. The `./**/*` case is covered by tests.

**Total deviations:** 1 auto-fixed, 2 plan-wording notes. **Impact:** none on scope.

## Documentation surfaces (for plan 04-53)

- **Broad-discovery rule for Grep.** An unfiltered search is now also one whose Grep glob matches every file (`*`, `**`, `**/*`, `*.*`, with or without a leading `./`) or whose Grep glob or Glob pattern holds a brace group; the hook does not expand braces, so a brace search at the clone root asks for the broad-discovery authorization (the fail-safe direction). A named type still filters. Rules and charges are unchanged: `retrieval:broad-discovery-not-authorized`, `retrieval:broad-discovery-spent`, `retrieval.searches`, `retrieval.broadDiscovery`.
- **Knowledge stop without budget.** The knowledge pass computes its chunk limit from the smaller of the contract's per-invocation cap and what is left of the run's cost budget; a limit of 0 (no positive finite cap) ends the knowledge index as absent with reason `budget_exhausted` and a detail that no cost cap is left, before any corpus or manifest is written. A positive cap still plans at least one chunk.

## Known Stubs

None.

## Threat Flags

None. T-04-131 and T-04-132 are mitigated and tested.

## Issues Encountered

None beyond the RED correction above.

## TDD Gate Compliance

RED (`test(04-49)`) precedes GREEN (`feat(04-49)`) for both tasks.

## Self-Check: PASSED
