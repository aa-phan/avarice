---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 29
subsystem: containment-hook
tags: [hook, retrieval-budget, broad-discovery, atomic-spend, subagent-race, con-10, con-11, typescript]
status: complete

requires:
  - phase: 04
    provides: "plan 04-28: contract budgets.retrieval and the retrieval.* budget rows"
  - phase: 04
    provides: "plan 04-19: the hook entry's decision transaction and the attended/run split"
  - phase: 04
    provides: "plan 04-12: the run contract and computeRunScope inputs"
provides:
  - "HookPolicy.retrieval { searches, broadDiscovery }, set only by computeRunScope from budgets.retrieval and written by the hook policy writer; absent for onboarding purposes and for contracts compiled before 04-28"
  - "every Grep and Glob of such a run charges retrieval.searches in the same BEGIN IMMEDIATE transaction as toolCalls, all rows or none (chargeRows in the hook entry)"
  - "hook rules budget:retrieval.searches, retrieval:broad-discovery-not-authorized, retrieval:broad-discovery-spent"
  - "NormalizedToolCall search gains an optional unfiltered marker; HookDecision gains alsoCharges and a wider budget name"
affects: [04-30, 04-34, 04-38]

actuals:
  tokens: 13250
  tasks: 2
  commits: 3
plan_head_before: f9486b1b1cf8d51a9a2f2716a9eb00286526221e
plan_head_after: d32a8da7e4b1cc8172f09882564384484809b7cc
commits: 3

tech-stack:
  added: []
  patterns:
    - "A call that charges several budget rows checks every row and then writes every row inside the one transaction, so it is never half charged"
    - "A policy-gated rule: the hook applies the retrieval rules only when the policy file carries the block, so onboarding policy files stay byte-identical"

key-files:
  created:
    - test/integration/hook-retrieval.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-29-red-task1.json
  modified:
    - src/domain/hook-decision.ts
    - src/hook/pre-tool-use.ts
    - src/domain/invocation-scope.ts
    - src/adapters/host-claude/hook-policy.ts
    - test/unit/hook-decision.test.ts

key-decisions:
  - "Retrieval rules are policy-gated: no retrieval block in the policy means the Phase 1 search rules apply alone, so a contract compiled before plan 04-28 (no retrieval rows) runs as before"
  - "A multi-row charge is check-all-then-write-all inside the hook's BEGIN IMMEDIATE transaction; the rows are checked in the order toolCalls, retrieval.searches, retrieval.broadDiscovery and the first without room names the denial"
  - "A broad search is an unfiltered search whose root is the clone: no path or the clone root as the path (resolved through the canonical-path helper, so `.` and a trailing slash count), and no glob or type filter for a Grep"
  - "For a Glob the pattern is the filter, so a pattern that names every file below its root (`*`, `**`, `**/*`, `*.*`) counts as no filter; an absolute pattern is judged by what follows its literal root"
  - "A denied search charges nothing, not even toolCalls; an allowed retrieval-charged call records alsoCharged in its hook.decision event"

patterns-established:
  - "RED evidence for a tracer whose later behavior cases are already covered by the same GREEN: the later task's tests pass at once and are checked by a mutation instead"

requirements-completed: [CON-10, CON-11]

coverage:
  - id: D1
    description: "A run's Grep and Glob calls are charged to retrieval.searches with toolCalls in one transaction; the call after the limit is denied budget:retrieval.searches and the row ends at its limit; a refused search charges no tool call"
    requirement: "CON-11"
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#allows three scoped searches and denies the fourth with budget:retrieval.searches; the row ends at used 3"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#charges a Glob the same way"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unfiltered whole-repository Grep or Glob is denied retrieval:broad-discovery-not-authorized unless the contract authorizes it, then allowed once and denied retrieval:broad-discovery-spent; a scoped search is unaffected"
    requirement: "CON-10"
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#denies a Grep with no path and no filter as retrieval:broad-discovery-not-authorized, charging nothing"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#with broadDiscovery true allows the first unfiltered search once, charging searches and broadDiscovery, and denies the second as retrieval:broad-discovery-spent"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#treats a root search filtered by a glob, a type or a directory as scoped"
        status: pass
    human_judgment: false
  - id: D3
    description: "The contract's retrieval limits reach the hook policy file for a run scope only; onboarding purposes and contracts without budgets.retrieval keep a policy file with no retrieval key and unchanged hook decisions"
    requirement: "CON-10"
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#writes the contract searches and broadDiscovery for a run, and nothing for a contract compiled before them"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#a policy without a retrieval block allows an unfiltered Grep and charges toolCalls only"
        status: pass
    human_judgment: false
  - id: D4
    description: "S-16 agent side: six parallel hook processes with three searches each against retrieval.searches 10 are allowed exactly 10 in total (10 iterations), the row's used equals the allowed count, and with six Agent calls under subagentsConcurrent 2 two are admitted and every subagent's searches draw on the same counter"
    requirement: "CON-11"
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#six processes issuing 3 scoped searches each against retrieval.searches 10: exactly 10 allowed, 8 denied, used 10, over 10 iterations"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#six subagents as Agent calls under subagentsConcurrent 2: two are admitted, and every search of all six draws on the same 10, over 10 iterations"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-17
---

# Phase 4 Plan 29: Hook retrieval limits on the agent's own searches Summary

**The hook now charges every Grep and Glob of a run to the run's `retrieval.searches` row in the same atomic transaction as `toolCalls` (all rows or none, exact across six parallel subagent processes), and refuses an unfiltered whole-repository search unless the contract authorizes one, then allows it once.**

## Performance

- **Duration:** about 25 min (start time not recorded; estimated from the first commit)
- **Completed:** 2026-11-17T12:45:00Z
- **Tasks:** 2 (one tracer with RED then GREEN, one race-test task)
- **Files modified:** 7 (2 created, 5 modified, not counting this summary and the planning state)

## Accomplishments

- **Policy.** `HookPolicy.retrieval { searches, broadDiscovery }` is validated by `parseHookPolicy`, set by `computeRunScope` from the contract's `budgets.retrieval`, and written by the policy writer. A contract with no `budgets.retrieval` and every onboarding purpose write no key, so their policy files and hook decisions are unchanged.
- **Charge.** `decideToolCall` marks a search of a run with retrieval limits as also charging `retrieval.searches` (and `retrieval.broadDiscovery` for a broad one). The hook entry's new `chargeRows` checks every named row and then writes every row inside the decision transaction. A search that is refused for want of a search unit charges no tool call; a missing row is a broken ledger and exits 2.
- **Broad discovery.** A Grep with no `glob` or `type`, or a Glob whose pattern names every file, rooted at the clone (no path, or the clone as the path in any spelling), is denied `retrieval:broad-discovery-not-authorized` unless `broadDiscovery` is true; then the first is allowed and the second is denied `retrieval:broad-discovery-spent`.
- **Race.** Six hook processes with three scoped searches each against a limit of 10 were allowed exactly 10 in each of 10 iterations, with `used` equal to the allowed count and the event chain intact. With six Agent calls under `subagentsConcurrent` 2, exactly two were admitted and the searches of all six shared the counter.

## Task Commits

1. **Task 1 (tracer): a run's Grep is charged to retrieval.searches and denied once the row is spent** - RED `a60056a` (test), GREEN `b5be005` (feat)
2. **Task 2: six parallel subagents against one counter** - `d32a8da` (test; green at once, see TDD Gate Compliance)

**Plan metadata:** the commit of this summary (docs: complete plan)

## TDD Gate Compliance

Task 1 has its `test(04-29)` commit before its `feat(04-29)` commit. The RED record `04-29-red-task1.json` returns `RED_EVIDENCE_OK` (target: the fourth scoped Grep allowed, expected `budget:retrieval.searches`; 9 of 13 tests failed on assertions). One of the nine, the policy-file case, failed on a fixture fault in my test (a write glob without a directory listing), not on the planned assertion; it was fixed in the GREEN commit and the other eight failed on the planned behavior.

Task 2 is `tdd="true"` but its race test passes as soon as it is written, because Task 1's transaction already delivers the invariant (the plan's own split puts the implementation in Task 1). Instead of a RED record I checked that the tests discriminate: with the room check removed for `retrieval.searches` in `chargeRows`, five tests fail, including both race tests. No refactor commit.

## Files Created/Modified

- `src/domain/hook-decision.ts` - the retrieval policy type and parsing, the `unfiltered` marker on a normalized search, `alsoCharges`, the three rule constants and the broad classification
- `src/hook/pre-tool-use.ts` - `chargeRows` (all rows or none), `spentDecision`, `alsoCharged` on the allow event
- `src/domain/invocation-scope.ts` - `InvocationScope.retrieval`, `computeRunScope` sets it from the contract
- `src/adapters/host-claude/hook-policy.ts` - writes the block
- `test/integration/hook-retrieval.test.ts` - 15 tests including the two race cases
- `test/unit/hook-decision.test.ts` - one assertion gains `unfiltered: true` (the normalized shape of a Grep with only a pattern)

## Decisions Made

See `key-decisions`. The policy-setting ones are repeated below.

## Decisions needing owner review

1. **What an agent-side "broad discovery" is for a Glob.** The plan defines it as a Grep or Glob with no path (or the clone root) and no glob or type filter, but a Glob's pattern is its filter. I treat a Glob whose pattern names every file below its root (`*`, `**`, `**/*`, `*.*`, with an optional leading `./`) as unfiltered and any other pattern (`**/*.ts`, `src/**`) as filtered. An absolute pattern is judged by what follows its literal root, and that root decides where it is rooted. A narrower rule (Glob never broad) would leave the gate vacuous for Glob; a wider one (any root Glob broad) would starve normal units.
2. **A denied search charges nothing.** A search refused as broad-not-authorized, or for a spent row, charges no `toolCalls` either. That matches the existing deny behavior (a deny charges nothing), but it means a run that loops on refused searches does not exhaust its tool calls by them; the loop limits (consecutive denials, 3 by preset) end it.
3. **Order of refusal when several rows are spent.** `toolCalls` first (so the Phase 1 `budget_exhausted` is unchanged), then `retrieval.searches`, then `retrieval.broadDiscovery`.
4. **The attended session is not covered.** The hook's attended mode (the owner's own session) enforces approvals only and has no contract, so it applies no retrieval rule; the plan did not ask for one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A pinned normalized-shape assertion**
- **Found during:** Task 1 (GREEN)
- **Issue:** `test/unit/hook-decision.test.ts` pins `normalizeToolCall('Grep', { pattern: 'x' }, STAGING)` with `deepEqual`; the new `unfiltered` marker changes that shape on purpose.
- **Fix:** added `unfiltered: true` to the one expected value. No other assertion changed.
- **Files modified:** test/unit/hook-decision.test.ts
- **Committed in:** b5be005

**2. [Rule 1 - Bug] My policy-file test used an incomplete workspace listing**
- **Found during:** Task 1 (GREEN)
- **Issue:** the RED test's run scope input named a write glob under `src` without a directory listing, so `computeRunScope` threw before reaching the plan's behavior.
- **Fix:** the test input lists `src`.
- **Files modified:** test/integration/hook-retrieval.test.ts
- **Committed in:** b5be005

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug in my own test). **Impact on plan:** none; the plan's truths are unchanged. `docs/system/` is not updated here: the plan names plan 04-38 as the documentation owner (see below).

## Known Stubs

None.

## Issues Encountered

None. The full `npm test` was not run (about 18 minutes); the orchestrator runs it at the end of the wave. Run here: `node --test test/integration/hook-retrieval.test.ts test/integration/hook.test.ts` (70 pass), the unit suite (2,698 pass), the hook-touching integration suites (`claude-host`, `hook-read-digest`, `host-search-tools`, `run-loops`, `run-prompt-policy`, `transcript-retention`, `live-phase3-case-design`, `containment/failclosed`) and the plan 04-22 suites `profile-isolation` and `redaction-suite` (156 pass), plus the `run-*` integration files, `retrieval-caps`, `fault/budgets`, `fault/run-budgets` and `fault/retrieval-race` (621 pass); `npm run typecheck` and `npm run check:boundaries` are clean.

## Documentation surfaces (for plan 04-38)

- **containment.md (hook):** the decision rules gain `budget:retrieval.searches` (deny, decided by the hook entry when it charges the row), `retrieval:broad-discovery-not-authorized` (deny, pure rule) and `retrieval:broad-discovery-spent` (deny, decided by the hook entry). **New hook rule count: 38 distinct rule IDs (6 allow, 33 deny, one on both), up from 35.** The command in `coverage.md` counts 37, because its pattern does not match a rule name that contains a dot (`budget:retrieval.searches`); either widen the pattern to allow `.` or record the 38 with that note. The Quirks and the "contract surface" paragraph (`docs/system/containment.md:212`) carry the count; `docs/system/coverage.md:29` and `:53` too.
- **policy file:** optional `retrieval { searches, broadDiscovery }`, run purpose only, absent for a contract with no `budgets.retrieval`; the hook-decision event of an allowed retrieval-charged call carries `alsoCharged` (`["retrieval.searches"]`, plus `"retrieval.broadDiscovery"` for a broad one).
- **What counts as broad on the agent side:** Grep with no `glob` and no `type`, or Glob with a match-everything pattern, rooted at the clone; the first is allowed only with `broadDiscovery`, and once.
- **Shared counter:** the agent's searches and AVARICE's own context assembly (plan 04-28) spend the same `retrieval.searches` row; subagents share the parent's counter (CON-15).
- **coverage.md / findings:** the matrix row "Retrieval scope and cost" can name `test/integration/hook-retrieval.test.ts`. No code-versus-proposal disagreement was found.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-34's live cases can confirm the flagged assumption that GSD's own agents search filtered paths and so are not starved by the broad-discovery rule.
- Nothing blocks the next plan.

## Threat Flags

None. The new surface (a policy field, three rule IDs) is inside the plan's threat model (T-04-80, T-04-81).

## Self-Check: PASSED

The created files (`test/integration/hook-retrieval.test.ts`, `04-29-red-task1.json`) exist, the three task commits (`a60056a`, `b5be005`, `d32a8da`) are on the branch, and the RED record returns `RED_EVIDENCE_OK`.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
