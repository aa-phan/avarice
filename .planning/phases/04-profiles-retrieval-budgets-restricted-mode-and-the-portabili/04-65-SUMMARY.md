---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 65
subsystem: evaluation-harness
tags: [eval-retrieval, ac8, adr-017, brief-coverage, rejudgement, gap-closure, G-04-3]

requires:
  - phase: 04
    provides: "plan 04-61: rejudgeWithCoverage, loadCoverage, loadAmendment, briefFor scope text; plan 04-64: eval-coverage.json and the owner-approved eval-success-amendment.json"
provides:
  - "eval-verdict-adr017.json: the 18 recorded AC-8 runs re-judged with brief coverage under the approved amendment, with a unit test that it equals the harness output"
  - "ADR-017 (Accepted): the amended success and partial rules, the restated arm figures, the AC-8 verdict and the D-08 outcome"
  - "The proposal's score sentence in docs/operations-and-testing.md states the amended rule and links ADR-017"
affects: [04-67, 04-68, 04-69]

actuals:
  tokens: 9000
  tasks: 2
  commits: 3
plan_head_before: 766525a19988c9ec5d8cb97701f4660b656738ff
plan_head_after: a9cba5aaaade76cee4a8690ccda881a4fc94efc3

tech-stack:
  added: []
  patterns:
    - "A committed verdict file is pinned by a unit test that recomputes it from the committed inputs with the harness function"

key-files:
  created:
    - test/benchmark/phase4/eval-verdict-adr017.json
    - docs/decisions/ADR-017-ac8-brief-coverage.md
  modified:
    - test/unit/eval-retrieval.test.ts
    - docs/operations-and-testing.md

key-decisions:
  - "Restated AC-8 figures (successes of 6): A 0, B 2, C 3, with partial runs A 2, B 2, C 1; the verdict stays a pass through B at 94.4% of A's tokens"
  - "The D-08 rule keeps the knowledge pass on because C succeeds more often than B (3 against 2); ADR-015's reason was C's lower token count"
  - "ADR-017 states the triviality plainly: with A at 0 the success clause holds for any pack arm, so the pass rests on the token bound"
  - "ADR-015 and ADR-016 are not edited; ADR-017 supersedes the success definition (D-07, the task list's successRule) and the success counts they report"

requirements-completed: [FR-3, FR-22]

coverage:
  - id: D1
    description: "eval-verdict-adr017.json deep-equals rejudgeWithCoverage over the committed results, tasks, coverage and amendment files; every partial run had a recorded success; partial runs are T01-A, T01-B, T02-C, T05-A, T05-B"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#keeps the committed ADR-017 re-judgement equal to what the harness computes from the recorded runs, the coverage record and the approved amendment"
        status: pass
    human_judgment: false
  - id: D2
    description: "ADR-017 is Accepted, carries the restated figures that match the arms block of the verdict, and the proposal's score sentence links it; ADR-015, ADR-016 and docs/requirements.md are unchanged"
    requirement: FR-22
    verification:
      - kind: other
        ref: "grep -q Accepted ADR-017 && grep -q ADR-017 docs/operations-and-testing.md && git diff --stat ed9e123..HEAD -- ADR-015 ADR-016 docs/requirements.md prints nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "eval-tasks.json, eval-results.json and eval-verdict-adr016.json are byte-identical to the planning base; briefFor holds no clause forbidding a test the brief asks for"
    requirement: FR-22
    verification:
      - kind: other
        ref: "git diff --stat ed9e123..HEAD -- the three files prints nothing; grep -v '^\\s*//' scripts/eval-retrieval.ts | grep -c 'do not write it' prints 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether the prose of ADR-017 reads clearly to the owner and states the owner's decision faithfully"
    requirement: FR-3
    verification: []
    human_judgment: true
    rationale: "A decision record is accepted by its owner reading it; a fresh prose review of the new document is the documentation plan's"

duration: 12min
completed: 2026-11-25
status: complete
---

# Phase 4 Plan 65: AC-8 re-judgement under the approved amendment and ADR-017 Summary

**The 18 recorded AC-8 runs re-judged with brief coverage give successes A 0, B 2, C 3 of 6 (recorded 2, 4, 4); the verdict stays a pass through B at 94.4% of A's tokens, the knowledge pass stays on, and ADR-017 records it, with no spend and no re-run.**

## Performance

- **Duration:** 12 min (2026-11-25T06:03Z to 06:15Z, approximate)
- **Tasks:** 2 (one tracer with TDD, one auto)
- **Files modified:** 4 (two created, two modified)

## Accomplishments

- Wrote `eval-verdict-adr017.json` as the output of `rejudgeWithCoverage` over the four committed files (nothing hand-edited), and a unit test that deep-equals it with a fresh computation, names decision ADR-017, and checks that every partial run had a recorded success.
- Wrote ADR-017 in the ADR-016 format: context (the two causes), eight numbered decisions, consequences with owned negatives, three alternatives each with its strongest argument for, references.
- Replaced the score sentence in `docs/operations-and-testing.md` and nothing else in that file.
- Confirmed the run instructions: `briefFor` no longer holds "do not write it".

## Restated figures (from eval-verdict-adr017.json)

| Arm | Runs | Recorded successes | Successes now | Partial | Tokens | Share of A |
|-----|------|--------------------|---------------|---------|--------|------------|
| A | 6 | 2 | 0 | 2 | 19,833,920 | 1.0000 |
| B | 6 | 4 | 2 | 2 | 18,715,894 | 0.9436 |
| C | 6 | 4 | 3 | 1 | 17,557,851 | 0.8852 |

- **AC-8 verdict:** pass via B, "arm B succeeds at least as often as A at 94.4% of A's tokens". C also qualifies.
- **D-08 knowledge outcome:** on, "arm C succeeds more often than B".
- **Partial runs:** T01-A, T01-B, T02-C, T05-A, T05-B (all recorded successes). The figures equal those 04-64 predicted.

## TDD record (Task 1)

RED (commit `b7a3637`): `node --test test/unit/eval-retrieval.test.ts` gave 78 tests, 77 pass, 1 fail: "keeps the committed ADR-017 re-judgement equal to what the harness computes ..." with `ENOENT: no such file or directory, open '.../test/benchmark/phase4/eval-verdict-adr017.json'`.

GREEN (commit `745fc2c`): the verdict file written by a scratch script outside the repository (`/tmp/gsd-04-65/gen.mjs`, calls `rejudgeWithCoverage` and writes two-space JSON with a final newline); 78 of 78 pass, `npm run typecheck` clean.

## Task Commits

1. **Task 1: Tracer, the verdict and its committed-file test** - `b7a3637` (test, RED), `745fc2c` (feat, GREEN)
2. **Task 2: ADR-017 and the proposal's score sentence** - `a9cba5a` (docs)

**Plan metadata:** the docs commit that follows this summary.

## Files Created/Modified

- `test/benchmark/phase4/eval-verdict-adr017.json` - the re-judgement with partial runs
- `test/unit/eval-retrieval.test.ts` - the committed-file test
- `docs/decisions/ADR-017-ac8-brief-coverage.md` - the decision record
- `docs/operations-and-testing.md` - the score sentence only

## Decisions Made

See `key-decisions`. The ADR date is 2026-11-23, the date of the owner's decision, as the plan states; the ADR also records that the owner approved the coverage record and amendment wording on 2026-11-25.

## Deviations from Plan

None - plan executed exactly as written. Two small interpretations, no rule triggered: the RED and GREEN steps are separate commits (a `test` commit then a `feat` commit) as in plans 04-61 and 04-64; the verification's `git diff --quiet` checks were run as `git diff --stat` (empty output) because the environment's command guard refuses the compound form.

## Issues Encountered

None. The precondition (approvedBy count 1) held.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access pattern. T-04-174 mitigations held: the verdict is the harness's output over the approved files and a unit test equals it, the ADR table matches the verdict's arms block, and the pinned files, ADR-015, ADR-016 and docs/requirements.md show no diff since ed9e123.

## Documentation surfaces

For plans 04-68 and 04-69:

- **`docs/system/findings.md`, AC-8 line:** the proposal's score sentence in `docs/operations-and-testing.md` (line 153) now states the amended rule and links ADR-017, so the 04-61 finding "still says the accepted change in reviewer judgment" is resolved on the proposal side; the code and `docs/system/` describe the same rule. Note for the owner that `docs/requirements.md` AC-8 wording is unchanged and still speaks of success without the brief clause.
- **`docs/system/findings.md`, harness line:** `scripts/eval-retrieval.ts` `briefFor` scope text changed after the 18 recorded runs, and `rejudgeWithCoverage` computes the committed `eval-verdict-adr017.json`; the recorded runs were given the earlier text (stated in ADR-017).
- **`docs/system/README.md` proposal-counterparts table:** a row for ADR-017 (`docs/decisions/ADR-017-ac8-brief-coverage.md`) beside ADR-015 and ADR-016, and the documents table if the evaluation document names the three ADR-017 files; `docs/system/coverage.md` records any count it keeps for ADRs or benchmark files.
- **Figures to carry into any `docs/system/` evaluation document:** successes A 0, B 2, C 3 of 6; partial A 2, B 2, C 1; AC-8 pass via B at 94.4%; knowledge pass on because C succeeds more often than B.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-04-3 is closed. No blockers. The documentation plans (04-68, 04-69) can cite the surfaces above.

## Self-Check: PASSED

- Files exist: eval-verdict-adr017.json, ADR-017, the test file and docs/operations-and-testing.md edits.
- Commits `b7a3637`, `745fc2c`, `a9cba5a` are ancestors of HEAD.
- `node --test test/unit/eval-retrieval.test.ts` 78 pass, 0 fail; typecheck clean; `"decision": "ADR-017"` count 1; ADR-017 contains "Accepted"; the pinned files and the accepted ADRs show no diff since ed9e123.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-25*
