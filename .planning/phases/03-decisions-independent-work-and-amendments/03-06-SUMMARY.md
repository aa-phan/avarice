---
phase: 03-decisions-independent-work-and-amendments
plan: 06
subsystem: domain
status: complete
tags: [gates, g1, g3, integrity-gates, reproducer, quick-plan, pure-domain]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: evaluateG2 and the GateVerdict shape in src/domain/gates.ts, compareInventories and InventoryFailureRule in src/domain/test-inventory.ts, storedText and the quick record parsers in src/domain/quick-record.ts, digestOf and sha256Hex in src/domain/digest.ts, ROUTINE_PRESET.verification.integrityGates in src/domain/run-contract.ts
provides:
  - src/domain/gates.ts (G1_RULES, G1Facts, G1Options, evaluateG1, PLAN_CITES_ACCEPTANCE_HARD, G3_RULES, G3Facts, evaluateG3, INTEGRITY_GATE_RULES, integrityFailures, GateVerdict.advisories)
  - src/domain/quick-record.ts (QuickPlan, QuickPlanCheckpoint, parseQuickPlan)
  - src/domain/reproducer.ts (Reproducer, ReproducerInput, buildReproducer, extractFailingTests)
affects: [03-18, 03-19, 03-13, the documentation plan 03-31]

actuals:
  tokens: 19000
  tasks: 3
  commits: 6
plan_head_before: a1149cec133157bd33b753d5213050a3721d2313
plan_head_after: 7f62d416146c87329a11de74b7bff656de96382a
commits: 6

tech-stack:
  added: []
  patterns:
    - "G1 and G3 are pure verdicts in the evaluateG2 shape: measured facts in, failures in a fixed rule order out, every input list sorted before it is judged"
    - "A model-written plan can fail G1 and never pass it: a missing plan fails closed, and a plan's own auto_select or acceptance citation never satisfies an owner-choice or scope rule"
    - "An advisory is a finding recorded beside a passing verdict (GateVerdict.advisories, present only when non-empty) so existing deep-equal verdict tests hold"
    - "The integrity gate map names rules as gate:rule[:inventory-rule] strings and a test resolves each one against the real rule lists"
    - "A reproducer stores the digest of the output and never the output text"
    - "RED stubs export every planned name so tests fail on assertions, not on load"

key-files:
  created:
    - src/domain/reproducer.ts
    - test/unit/reproducer.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-06-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-06-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-06-red-evidence-task3.json
  modified:
    - src/domain/gates.ts
    - src/domain/quick-record.ts
    - test/unit/gates.test.ts
    - test/unit/quick-record.test.ts

key-decisions:
  - "plan-cites-acceptance starts as an advisory behind PLAN_CITES_ACCEPTANCE_HARD = false (flagged assumption; spike S3-A in plan 03-13 flips it). The evaluator takes an options.citesAcceptanceHard override so a test, and later the stage, can run the hard mode"
  - "An item whose spec files are derived (derived includes files) is judged by plan-within-write-scope only; an explicit spec with no derived files is judged against the spec files as globs, and an empty explicit list fails every path"
  - "A plan path that is absolute, holds a .. segment or a backslash is outside the contract whatever the globs say; a leading ./ is dropped before judging (T-03-11)"
  - "A missing plan returns plan-present alone: with no plan text there is nothing else to judge, and the verdict still fails"
  - "G3 repair-limit fails when repairAttempts >= limit, so the routine preset's repairAttemptsPerCheck of 0 fails on the first look, matching 'a failing required check ends the run'"
  - "G3 failing-test-unchanged is judged at file level (flagged assumption A7): any change to a file holding a failing test, in any status, fails unless authorizedTestPaths names that exact path"
  - "no-test-deletion maps to G2 removed-test, G2 lowered-test-count, G3 failing-test-present and G3 failing-test-unchanged, a superset of the plan's listed pair, because deleting the failing test or lowering the file count is test deletion"
  - "integrityFailures attributes a G2 test-inventory failure to a gate by the inventory rule name in the failure detail, and ignores a gate it has no mapping for; the completeness test, not the function, keeps the preset and the map in step"
  - "extractFailingTests reads vitest FAIL lines (only with a test path after the file) and TAP not ok lines (not TODO or SKIP); the node:test spec reporter's failure marker is left out because its closing 'failing tests:' list would read as test IDs"

requirements-completed: [AUT-10, AUT-16, RC-7]

coverage:
  - id: D1
    description: "parseQuickPlan reads a quick PLAN's files_modified (inline and block form), task files, checkpoint:decision tasks with option IDs and auto_select (attribute or element), and cited acceptance IDs; text over 64 KiB is cut, null text is a null plan"
    requirement: "AUT-16"
    verification:
      - kind: unit
        ref: "test/unit/quick-record.test.ts#parseQuickPlan"
        status: pass
    human_judgment: false
  - id: D2
    description: "evaluateG1 judges a unit's plan in the fixed order plan-present, plan-within-write-scope, plan-within-spec, decision-checkpoint-unresolved, owner-choice-unasked, plan-cites-acceptance; a path outside the write and create globs or the explicit spec fails, a silently resolved checkpoint fails, an unasked owner choice fails, and input order never changes the verdict"
    requirement: "AUT-16"
    verification:
      - kind: unit
        ref: "test/unit/gates.test.ts#evaluateG1 (tracer: write scope, item spec, an unasked owner choice)"
        status: pass
      - kind: unit
        ref: "test/unit/gates.test.ts#evaluateG1 (decision checkpoints and the acceptance citation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "evaluateG3 fails repair-limit, failing-test-present and failing-test-unchanged, and passes a change to a failing test's file only when an amendment authorized that path"
    requirement: "AUT-10"
    verification:
      - kind: unit
        ref: "test/unit/gates.test.ts#evaluateG3"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each of the five integrity gates of the routine preset maps to rules that exist, and integrityFailures names the integrity gates a set of verdicts broke"
    requirement: "RC-7"
    verification:
      - kind: unit
        ref: "test/unit/gates.test.ts#the integrity gates of the routine preset"
        status: pass
    human_judgment: false
  - id: D5
    description: "buildReproducer gives the check, joined command, exit code, output digest, failing test IDs and a sorted capped diff with a digest of the whole list, and carries no field holding the output text; extractFailingTests reads vitest and node:test TAP output best effort"
    requirement: "AUT-10"
    verification:
      - kind: unit
        ref: "test/unit/reproducer.test.ts#buildReproducer"
        status: pass
      - kind: unit
        ref: "test/unit/reproducer.test.ts#extractFailingTests"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-08
---

# Phase 3 Plan 06: Gates G1 and G3, integrity gate map and reproducer Summary

**Pure G1 (plan) and G3 (repair) gate verdicts in the evaluateG2 shape, a quick PLAN parser, a map from the five routine integrity gates to the rules that enforce them, and a text-free smallest reproducer**

## Performance

- **Duration:** 35 min
- **Started:** 2026-11-09T00:41:00Z (estimated; the start time was not captured)
- **Completed:** 2026-11-09T01:17:00Z
- **Tasks:** 3 (all TDD; 6 commits, RED then GREEN per task)
- **Files modified:** 9 (4 source and test files edited, 2 created, 3 RED evidence records)

## Accomplishments

- `parseQuickPlan` turns a quick PLAN's text into the paths, decision checkpoints and acceptance IDs a gate reads, cutting text over 64 KiB and never throwing. Unclosed tags cost one scan, not one per tag.
- `evaluateG1` judges a unit's plan against the item spec and the write scope in a fixed rule order. A path outside `files.write` and `files.create` (protected globs win), or outside explicit spec files, fails; a `checkpoint:decision` without `auto_select` that the unit resolved without pausing fails; an owner-choice criterion with no answered decision fails. A missing plan fails closed.
- `plan-cites-acceptance` is an advisory (`GateVerdict.advisories`, `passed` stays true) while `PLAN_CITES_ACCEPTANCE_HARD` is false, and a failure under `options.citesAcceptanceHard`.
- `evaluateG3` fails `repair-limit`, `failing-test-present` and `failing-test-unchanged`; an amendment-authorized test path is the one exemption.
- `INTEGRITY_GATE_RULES` attaches each of the five preset integrity gates to rules that exist, a test fails when a listed gate maps to nothing, and `integrityFailures` names the gates a set of verdicts broke.
- `buildReproducer` and `extractFailingTests` give a bounded reproducer that stores the output's digest and never its text.

## Task Commits

1. **Task 1: tracer, a quick PLAN parsed and judged by G1** - `2e06a15` (test, RED), `17b497a` (feat)
2. **Task 2: remaining G1 rules, G3 and the integrity gate map** - `ec4ff74` (test, RED), `ada3956` (feat)
3. **Task 3: the smallest reproducer and failing test extraction** - `0cb2359` (test, RED), `7f62d41` (feat)

**Plan metadata:** recorded in the docs commit that carries this summary.

## Files Created/Modified

- `src/domain/gates.ts` - G1 and G3 verdicts, the advisory field, the integrity gate map and `integrityFailures`
- `src/domain/quick-record.ts` - `QuickPlan` and `parseQuickPlan`
- `src/domain/reproducer.ts` - `Reproducer`, `buildReproducer`, `extractFailingTests`
- `test/unit/gates.test.ts`, `test/unit/quick-record.test.ts`, `test/unit/reproducer.test.ts` - the tests
- `.planning/phases/03-decisions-independent-work-and-amendments/03-06-red-evidence-task{1,2,3}.json` - RED evidence, each `RED_EVIDENCE_OK` under `gsd-tools check tdd-red-evidence`

## Decisions Made

See `key-decisions` in the frontmatter. The three that a later plan must know: `plan-cites-acceptance` is advisory until spike S3-A flips the constant; G3 judges the failing test at file level; and the routine preset's `repairAttemptsPerCheck` of 0 makes `repair-limit` fail on the first look.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] G1 treats an absolute path, a `..` segment and a backslash as outside the contract**
- **Found during:** Task 1 (G1 write scope)
- **Issue:** The glob matcher turns `**` into `.*`, so a plan path such as `../outside.ts` would match a `**` write glob. T-03-11 (a plan that silently widens scope) is rated high and mitigated by G1 failing closed.
- **Fix:** `planPathProblem` rejects those forms before any glob is consulted, and a leading `./` is dropped first. A test covers all four spellings and the `./` case.
- **Files modified:** `src/domain/gates.ts`, `test/unit/gates.test.ts`
- **Committed in:** `17b497a`

**2. [Rule 2 - Missing critical functionality] `no-test-deletion` also maps to G2 `lowered-test-count` and G3 `failing-test-present`**
- **Found during:** Task 2 (integrity map)
- **Issue:** The plan listed `removed-test` and `failing-test-unchanged` only. Deleting the failing test is caught by `failing-test-present`, and dropping a test file by `lowered-test-count`; leaving them out would make the gate blind to both.
- **Fix:** Both added to the map; the completeness test resolves each against the real rule lists.
- **Files modified:** `src/domain/gates.ts`
- **Committed in:** `ada3956`

### Environment notes (not plan deviations)

- The per-plan commit ledger file (`gsd-plan-head-before-03-06` under the git dir) could not be written: the session is confined to the worktree and the git dir sits in the shared checkout. `plan_head_before` and the commit count are measured from the `HEAD` captured at start (`a1149ce`) with `git rev-list --count a1149ce..HEAD`, which gives 6.
- Commit trailers follow the orchestrator's instruction (`Co-Authored-By: Claude Opus 5.5`), matching every earlier commit on this branch.

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both strengthen the fail-closed direction the threat model asks for. No scope creep: all changes are inside the plan's six files.

## Issues Encountered

None. Verification: the plan's verify commands pass (`node --test` over gates, quick-record, reproducer, test-inventory, evidence; `node scripts/check-boundaries.ts`; `npx tsc -p .`), and the full unit suite (`npm run test:unit`) passes with 1558 tests.

## Known Stubs

None. The RED-phase stubs were replaced in each task's GREEN commit.

## Threat Flags

None. No new network endpoint, auth path, file access or schema at a trust boundary. T-03-10 and T-03-11 are mitigated by the rules above.

## Documentation surfaces

For the documentation plan 03-31 (`docs/system/`; this worktree has no `docs/system/`, so nothing was written there):

- **G1 rules, in order:** `plan-present`, `plan-within-write-scope` (protected globs win; absolute, `..` and backslash paths are outside), `plan-within-spec` (judged only when the item spec files are not derived), `decision-checkpoint-unresolved` (fails only when the unit progressed), `owner-choice-unasked`, `plan-cites-acceptance` (advisory unless the hard mode is on). Facts: plan, globs, item spec, outcome, owner choices, item acceptance IDs. A missing plan returns `plan-present` alone.
- **G3 rules, in order:** `repair-limit` (attempts reached the limit), `failing-test-present` (a failing test ID gone after the repair), `failing-test-unchanged` (file-level; an amendment-authorized path is exempt). Facts: repair attempts, limit, failing test IDs, inventory after, test files of failing tests, changed paths, authorized test paths.
- **Verdict shape:** `GateVerdict.advisories` is present only when non-empty.
- **Integrity map:** `no-new-overrides` to G2 `no-new-overrides`; `no-test-deletion` to G2 `removed-test` and `lowered-test-count`, G3 `failing-test-present` and `failing-test-unchanged`; `no-skip-markers` to G2 `new-skip-marker`; `scope-conformance` to G1 `plan-within-write-scope`, G2 `scope-conformance` and `deletion-scope`; `prune-is-decision` to G2 `prune-is-decision`. `integrityFailures` names the broken gates of a verdict set.
- **Quick PLAN parser:** reads `files_modified` (inline or block), `<files>` lists, `checkpoint:decision` tasks (option IDs, `auto_select` as an attribute or element), and `AC<n>` IDs; 64 KiB cap.
- **Reproducer fields:** `check`, `command` (argv joined, at most 1000 characters), `exitCode`, `outputDigest` (`sha256:` of the output), `failingTests` (vitest `FAIL` and TAP `not ok`, at most 20, 200 characters each), `diff.paths` (sorted, at most 20) and `diff.digest` (of the whole sorted list). No field holds the output text.
- **Findings for `docs/system/findings.md`:** `docs/contracts-and-state.md` (G1 row, line 699) says "plan references the contract's acceptance IDs" as a plain rule; the built G1 treats it as an advisory until spike S3-A (plan 03-13) proves a live quick PLAN cites contract acceptance IDs.

## Next Phase Readiness

Plans 03-19 (repair, G1 wiring) and 03-18 (a decision from a G1 failure) can call `evaluateG1`, `evaluateG3`, `integrityFailures` and `buildReproducer`. Spike S3-A (03-13) decides `PLAN_CITES_ACCEPTANCE_HARD`.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-08*

## Self-Check: PASSED

All created files exist on disk, the six commits are ancestors of `HEAD`, and the plan's verification commands pass.
