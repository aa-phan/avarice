---
phase: 02-contained-unattended-run-of-one-work-item
plan: 05
subsystem: domain
tags: [evidence, gates, g2, g4, baseline-delta, acceptance-mapping, test-inventory, outcome, pause]

requires:
  - phase: 01-onboarding
    provides: the Result type, the glob matcher, the facts-in verdict-out classifyOutcome pattern
provides:
  - "evidence.ts: EVIDENCE_STATUSES, evidenceStatusOf, revisionOf, baselineDelta (D-12), mapAcceptance"
  - "test-inventory.ts: SKIP_FOCUS_MARKERS, scanMarkers, compareInventories"
  - "gates.ts: G2_RULES, G4_RULES, evaluateG2, evaluateG4, GateVerdict"
  - "outcome.ts: classifyOutcome with a structural paused kind, detectPause"
affects: [02-13, 02-14, 02-15, 02-21]

actuals:
  tokens: 15400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Gates are pure functions over measured facts; failures come one per rule in a fixed rule order, and every list is sorted before it is judged"
    - "Pre-existing is a flag on an evidence row, never a status (Pitfall 9); only a failure measured at base and at head may carry it"
    - "A model-written artifact (GSD VERIFICATION, SUMMARY, review) can fail a gate but never satisfies acceptance"

key-files:
  created:
    - src/domain/evidence.ts
    - src/domain/test-inventory.ts
    - src/domain/gates.ts
    - test/unit/evidence.test.ts
    - test/unit/test-inventory.test.ts
    - test/unit/gates.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-05-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-05-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-05-red-evidence-task3.json
  modified:
    - src/domain/outcome.ts
    - test/unit/outcome.test.ts

key-decisions:
  - "A target check is held to the same bar whether or not it is also a required check: baselineDelta examines required plus targets"
  - "A head failure is pre-existing only when the base failure was measured; an unmeasured, inconclusive, unavailable or skipped base makes it blocking `regressed`"
  - "G2 checks protected globs before write, create and artifact globs, so a protected path fails scope-conformance even when an artifact or `**` write glob covers it; a protected deletion fails both scope-conformance and deletion-scope"
  - "An added path needs a create or artifact glob and a modified path a write or artifact glob; an unknown change status fails scope-conformance (fail closed)"
  - "pauseSignal is a structural fact; the numbered-choice text shape needs a question line ending in `?` then choices numbered 1..n (n >= 2), read from the last 2000 characters only"

patterns-established:
  - "Idempotency by construction: sort, then judge, so reordering facts cannot change a verdict"

requirements-completed: [AUT-7, AUT-8, AUT-9, FR-5, FR-6]

coverage:
  - id: D1
    description: "Check results become evidence statuses (six values only), and revisions are git:<40 hex> or tree:sha256:<64 hex> with refused encodings"
    requirement: FR-6
    verification:
      - kind: unit
        ref: "test/unit/evidence.test.ts#evidenceStatusOf (AUT-8), #revisionOf (FR-6)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The D-12 baseline delta blocks regressions, target failures and non-conclusive required checks and calls only base-and-head failures pre-existing"
    requirement: AUT-9
    verification:
      - kind: unit
        ref: "test/unit/evidence.test.ts#baselineDelta (D-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Acceptance mapping is satisfied only by deterministic passed evidence; model-review, gsd-verdict and non-passed rows never satisfy it"
    requirement: AUT-7
    verification:
      - kind: unit
        ref: "test/unit/evidence.test.ts#mapAcceptance (AUT-7, AUT-8)"
        status: pass
    human_judgment: false
  - id: D4
    description: "G4 fails by named rule for each of revision, delta, acceptance, stale or inconclusive, diff gate, decisions and budgets, and is order independent"
    requirement: AUT-7
    verification:
      - kind: unit
        ref: "test/unit/gates.test.ts#evaluateG4"
        status: pass
    human_judgment: false
  - id: D5
    description: "G2 fails by named rule for outcome, scope, deletion, test inventory, GSD verification, overrides, PRUNE and delta, and is order independent"
    requirement: AUT-9
    verification:
      - kind: unit
        ref: "test/unit/gates.test.ts#evaluateG2"
        status: pass
    human_judgment: false
  - id: D6
    description: "The test inventory scan and comparison catch removed tests, new skip or focus markers and a lowered test file count"
    requirement: AUT-9
    verification:
      - kind: unit
        ref: "test/unit/test-inventory.test.ts (scanMarkers, compareInventories)"
        status: pass
    human_judgment: false
  - id: D7
    description: "classifyOutcome returns paused from a structural pauseSignal after failed and before progressed, HEAD-moved still first, with every Phase 1 outcome test unchanged"
    requirement: FR-5
    verification:
      - kind: unit
        ref: "test/unit/outcome.test.ts#classifyOutcome with a pause signal, #detectPause"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-05
status: complete
commits: 3
plan_head_before: 2c1adccf816039dfa3255294f261a7f700945949
plan_head_after: 8bdd2306400b272675bb672b35e10b552ce818ea
---

# Phase 2 Plan 05: Evidence, gates G2 and G4, outcome pause Summary

**Pure domain judges for a run: six-status evidence with git/tree revisions, the D-12 baseline delta, acceptance mapping that only deterministic passed evidence can satisfy, test-inventory comparison, gates G2 and G4 with named failures in fixed order, and a classifyOutcome that returns `paused` from structural signals only**

## Performance

- **Duration:** about 25 min (the start was not timestamped; estimated from the first read to the last commit)
- **Completed:** 2026-11-05T18:47Z
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto, all with RED first)
- **Files:** 11 (1143 insertions, 5 deletions, the deletions being the rewritten rule-order comment in outcome.ts)

## Accomplishments

- `evidenceStatusOf` maps passed to passed, failed to failed, timed_out and cancelled to inconclusive, spawn_error and a missing sandbox to unavailable, and any unknown value to inconclusive, never passed. `revisionOf` yields `git:<40 hex>` only for a committed clean tree, otherwise `tree:sha256:<64 hex>`, and refuses a head or digest that is not lowercase hex of the exact length.
- `baselineDelta` implements D-12 and the prohibition on relabelling: a failed, unavailable or inconclusive required check is never made pre-existing unless it failed at base and at head and is not a brief target. `mapAcceptance` accepts only `check:`, `test:` and `diff:` references backed by deterministic, passed rows (or the passed after-inventory); a model-review or gsd-verdict row never counts.
- `evaluateG4` and `evaluateG2` return `{ passed, failures: { rule, detail }[] }` with one failure per rule in the order of `G4_RULES` and `G2_RULES`. Each rule has a test that fails it alone, plus order-independence and idempotency tests with reversed path and fact lists.
- `compareInventories` reports `removed-test`, `new-skip-marker` and `lowered-test-count`; `scanMarkers` finds 12 marker forms (JS runners and the two Python ones) with 1-based lines and is conservative about comments.
- `classifyOutcome` gains `paused` after `failed` and before `progressed`; the HEAD-moved rule is still first. `detectPause` reads waiting JSON, VERIFICATION `human_needed`, STATE needs-human, then the numbered-choice shape of a 2000-character tail.

## Task Commits

1. **Task 1: Tracer, check results at base and head become evidence, a D-12 delta and a G4 verdict** - `46ed1de` (feat)
2. **Task 2: Test inventory comparison and G2** - `dfced50` (feat)
3. **Task 3: classifyOutcome gains a structural `paused` and detectPause** - `8bdd230` (feat)

RED evidence: `02-05-red-evidence-task1.json` (evidence and gates modules missing, both test files fail to load), `-task2.json` (test-inventory module missing, gates.ts has no G2 exports), `-task3.json` (outcome.ts has no detectPause).

Tracer gate: the tracer's verify (`node --test` on the evidence and gates tests) was re-run end to end and passed (40 tests) before the expansion tasks started.

## Verification

- `node --test` on the four unit files: 123 tests, 0 failed. Full `node --test`: 1696 tests, 1674 passed, 0 failed (the rest skipped, live cases gated by `AVARICE_LIVE`).
- `node scripts/check-boundaries.ts` ok (61 files). `npx tsc -p .` clean.
- Acceptance: `git diff --numstat -- test/unit/outcome.test.ts` is `98 0` (only added lines); `grep -n "if (headMoved) return result('failed')"` still matches at line 61, ahead of the `paused` rule; `grep -c "G2_RULES" src/domain/gates.ts` is 3; `grep -c "'stale'" src/domain/evidence.ts` is 1 and EVIDENCE_STATUSES holds exactly the six statuses; test-inventory.test.ts reports 25 tests (at least 10 required); gates.test.ts has a failing case for each of the 8 G2 rules and each of the 7 G4 rules.

## Deviations from Plan

None - plan executed exactly as written. Choices the plan left open (listed under key-decisions) were made inside its stated behavior.

## Known Stubs

None.

## Issues Encountered

- The harness refused compound shell commands and heredocs in a worktree-isolated session, so files were written with the Write and Edit tools and git commands were run one at a time; the root-pin guard (`git rev-parse --show-toplevel`) printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before every write batch and commit.

## Authentication Gates

None.

## Threat Flags

None. The plan adds pure functions and no new endpoint, auth path, file access or schema.

## Next Phase Readiness

Plans 02-13 and 02-14 can call `evaluateG2` and `evaluateG4` with measured facts: they must supply `changes` from the diff (a rename as delete plus add), `inventory` from `compareInventories`, `delta` from `baselineDelta`, and rows with `independence: 'deterministic'` only for checks AVARICE ran. A caller that sets `preExisting: true` on a row must also have recorded the base failure.

## Self-Check: PASSED

- FOUND: src/domain/evidence.ts, src/domain/test-inventory.ts, src/domain/gates.ts, test/unit/evidence.test.ts, test/unit/test-inventory.test.ts, test/unit/gates.test.ts, 02-05-red-evidence-task{1,2,3}.json
- FOUND commits: 46ed1de, dfced50, 8bdd230 (ancestors of HEAD)
