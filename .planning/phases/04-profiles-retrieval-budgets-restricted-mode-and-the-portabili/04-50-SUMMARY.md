---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 50
subsystem: testing
tags: [ac-8, adr-016, evaluation-harness, retrieval-budget, token-bound]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: the recorded three-arm evaluation (eval-results.json), ADR-015, the review ledger of plan 04-52 and the SC3 documentation of plan 04-53
provides:
  - ADR-016, which sets the AC-8 token bound at 95% of the baseline's tokens (inclusive) and supersedes only ADR-015's AC-8 consequence
  - AC-8 row of docs/requirements.md, the AC-8 sentence of docs/operations-and-testing.md and Phase 4 success criterion 2 stating the same bound
  - the named constant AC8_TOKEN_BOUND_PERCENT in the evaluation harness, with a no-spend re-judge of recorded runs
  - test/benchmark/phase4/eval-verdict-adr016.json, the recorded runs judged at the new bound (B passes at 94.4%)
affects: [04-54, phase-4-verification, ac-8]

actuals:
  tokens: 3900
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Bound as a whole-number percentage constant with integer cross-multiplication, so an inclusive comparison is exact"
    - "Re-judgement of recorded evidence into a new file; the recorded results file is read only"

key-files:
  created:
    - docs/decisions/ADR-016-ac8-token-bound.md
    - test/benchmark/phase4/eval-verdict-adr016.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-50-decision-context.json
  modified:
    - scripts/eval-retrieval.ts
    - test/unit/eval-retrieval.test.ts
    - docs/requirements.md
    - docs/operations-and-testing.md
    - .planning/ROADMAP.md

key-decisions:
  - "AC-8 token clause is 95% of the baseline's tokens, inclusive (owner decision, ADR-016); the success clause is unchanged"
  - "ADR-015 is not edited; ADR-016 supersedes only its AC-8 consequence and the knowledge-pass default stays on"
  - "WR-28, WR-29, WR-32 and WR-36 stay deferred as plan 04-52 recorded them (branch a does not fix them)"

patterns-established:
  - "Owner decisions that change a proposal row are recorded in an ADR before the proposal edit"

requirements-completed: [FR-3, FR-22]

coverage:
  - id: D1
    description: "The owner's AC-8 decision is recorded in ADR-016 (Accepted, decider Aaron Phan, supersedes only ADR-015's AC-8 consequence) before the proposal edit"
    requirement: "FR-3"
    verification:
      - kind: other
        ref: "grep -c ADR-015 docs/decisions/ADR-016-ac8-token-bound.md (4); git diff --quiet f0318887 -- docs/decisions/ADR-015-knowledge-pass-default.md (exit 0)"
        status: pass
    human_judgment: true
    rationale: "Whether the recorded wording states the owner's intent is a judgment only the owner can make; the verifier should confirm the ADR reads as intended"
  - id: D2
    description: "The AC-8 row, the evaluation proposal sentence and ROADMAP SC2 state the 95% inclusive bound and cite ADR-016"
    requirement: "FR-3"
    verification:
      - kind: other
        ref: "grep -c ADR-016 docs/requirements.md (1); grep -c ADR-016 .planning/ROADMAP.md (1)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The harness verdict uses the named inclusive bound; exactly 95% passes, one token over fails; B is named when B and C both qualify; an arm A with no tokens never passes"
    requirement: "FR-3"
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#passes when arm B succeeds as often as A at no more than the AC-8 bound of A tokens (ADR-016: 95%), and fails one token above it"
        status: pass
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#names B when B and C both qualify, and fails with a reason that names the bound when neither does"
        status: pass
    human_judgment: false
  - id: D4
    description: "The recorded runs are re-judged at the new bound without spend into eval-verdict-adr016.json, and eval-results.json is byte for byte unchanged"
    requirement: "FR-22"
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#re-judges the recorded runs under the ADR-016 bound without spending and without touching the results file"
        status: pass
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#keeps the committed re-judgement equal to what the harness computes from the recorded runs"
        status: pass
      - kind: other
        ref: "shasum -a 256 test/benchmark/phase4/eval-results.json = 3b40148356b2f2dd7420d18ed6e6d36b7e6d73378fe8f4d52deeba5fa9e5b5e8 before and after"
        status: pass
    human_judgment: false

duration: 8h
completed: 2026-11-22
status: complete
plan_head_before: f0318887bee9d51e55169eddf83753992574acb2
plan_head_after: 843c8397bccdc475b9a33bb11c1081e3c12c9b9d
---

# Phase 4 Plan 50: AC-8 token bound decision Summary

**AC-8's token clause is now "no more than 95% of the baseline's tokens, inclusive" by the owner's recorded decision (ADR-016), and the 18 recorded runs re-judge as a pass through arm B at 94.4%, with no spend and the recorded results file untouched.**

## Performance

- **Duration:** about 8 h elapsed, of which the plan waited on the owner's decision checkpoint; working time is a fraction of that
- **Started:** 2026-11-22T23:39:36Z (decision context written); continuation resumed after the owner's answer on 2026-11-22
- **Completed:** 2026-11-22
- **Tasks:** 2 executed (Task 1 decision, Task 2 branch a); Tasks 3 and 4 not applicable
- **Files modified:** 8 (3 created, 5 modified, excluding this summary)

## Branch taken

Branch **a**, "Change the bound or the requirement (new ADR)".

Owner decision, quoted verbatim (Aaron Phan, 2026-11-22):

- Option: "a: new bound (ADR-016)"
- Parameter: "≤ 95% of baseline"

Meaning: AC-8 becomes "a pack arm matches the baseline's success with no more than 95% of the baseline's tokens", with an inclusive bound.

## Accomplishments

- Task 1: the decision context (`04-50-decision-context.json`, commit `5987561`, written before the checkpoint) carried the recomputed arm figures (A 2 of 6 and 19,833,920 tokens; B 4 of 6 and 94.4%; C 4 of 6 and 88.5%), run states, tokensComplete, the spend so far (16.02 of 40 USD), the WR-36 transcript scan (0 of 18 runs read the held-out file through git history), and the statement that the recorded runs predate the whole-file read caps enforced from plan 04-55 on. It offered no cap change as an option. The owner's answer is recorded above.
- Task 2 (TDD): ADR-016 written first (Accepted, decider Aaron Phan, dated 2026-11-22, supersedes only ADR-015's AC-8 consequence; ADR-015 untouched), then the AC-8 row of `docs/requirements.md`, Phase 4 SC2's token clause in `.planning/ROADMAP.md`, the harness bound and the re-judge, and `eval-verdict-adr016.json`.
- Verdict under the new bound: pass through B at 94.4% of A's tokens (0.6 points inside the bound). C at 88.5% also qualifies; B is named because it is judged first. ADR-016 records, as a negative consequence with Aaron Phan as owner, that the bound was set after the result was known and B clears it narrowly.

## Task Commits

1. **Task 1: Owner decision on AC-8** - `5987561` (docs, decision context, before the checkpoint); the answer is recorded in this summary and in ADR-016
2. **Task 2 (branch a), RED** - `0c8a792` (test)
3. **Task 2 (branch a), GREEN** - `658c81f` (feat: bound constant, re-judge, eval-verdict-adr016.json)
4. **Task 2 (branch a), ADR** - `ee37da8` (docs: ADR-016)
5. **Task 2 (branch a), alignment** - `843c839` (docs: requirements row, evaluation proposal sentence, ROADMAP SC2)

**Plan metadata:** the commit that adds this summary, STATE.md and ROADMAP.md follows.

Order note: the plan's threat T-04-133 asks for ADR-016 before the proposal edit. The ADR commit (`ee37da8`) precedes the requirements edit (`843c839`). The harness commits came first because the TDD cycle was done first; they change no proposal text.

## Not applicable

- **Task 3 (branch c, owner override and deferral):** not applicable; the owner chose a. `04-VERIFICATION.md` and the SC2 override are not touched.
- **Task 4 (branch b, harness fixes and re-run specification):** not applicable; the owner chose a. No `04-50-rerun-spec.md` was written and no spend was authorized.

## Final disposition of WR-28, WR-29, WR-32 and WR-36

Left **deferred** exactly as plan 04-52 recorded them (target: before any further AC-8 run). `04-REVIEW-DISPOSITION.md`, `04-REVIEW-FIX.md` and `deferred-items.md` were not edited by this plan. None of the four changes the recorded verdict (all 18 runs ended in `ready_for_review` or `blocked_on_decision` with `tokensComplete` true, and every arm ran 6 tasks).

## TDD record (Task 2)

- **RED (`0c8a792`):** four tests in `test/unit/eval-retrieval.test.ts`: the inclusive bound at 95% (1,900 of 2,000 passes, 1,901 fails, constant equals 95), B named when B and C both qualify with a failure reason that names the bound, the no-spend re-judge of the recorded runs with the results digest unchanged, and the committed re-judgement equal to the harness's output. The existing "half" test was rewritten to the new bound, as the plan allows where the bound changed. Run result before the change: all four failed. Semantic assessment: the first two failed on their planned assertions (constant `undefined !== 95`; `false !== true` for a pass at 90% of A's tokens), the third failed because `rejudgeResultsFile` did not exist, the fourth because `eval-verdict-adr016.json` did not exist. The target tests executed and failed for the intended reason; no zero-test, syntax or fixture fault. The `check tdd-red-evidence` classifier was not run because the plan is `type: execute` with one `tdd="true"` task, not a `type: tdd` plan.
- **GREEN (`658c81f`):** `AC8_TOKEN_BOUND_PERCENT = 95` replaces the literal factor of 2 (comparison `arm.tokens * 100 <= a.tokens * 95`, exact in integers); `rejudge` and `rejudgeResultsFile` judge runs through the existing `summarize` and `verdict`. `node --test test/unit/eval-retrieval.test.ts`: 63 tests, 63 pass, 0 fail.
- **REFACTOR:** none needed.

## Files Created/Modified

- `docs/decisions/ADR-016-ac8-token-bound.md` - the decision record
- `scripts/eval-retrieval.ts` - `AC8_TOKEN_BOUND_PERCENT`, `Rejudgement`, `rejudge`, `rejudgeResultsFile`; the verdict failure reason names the bound
- `test/unit/eval-retrieval.test.ts` - the four tests above
- `test/benchmark/phase4/eval-verdict-adr016.json` - bound, per-arm shares, verdict and knowledge outcome, with the source digest
- `docs/requirements.md` - AC-8 row
- `docs/operations-and-testing.md` - AC-8 sentence in the context retrieval evaluation section
- `.planning/ROADMAP.md` - Phase 4 success criterion 2 token clause only
- `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-50-decision-context.json` - the facts the owner decided on

## Decisions Made

- AC-8 token clause: 95% of the baseline's tokens, inclusive (owner, ADR-016).
- The re-judge is an exported function pair and writes nothing itself; `eval-verdict-adr016.json` was generated by calling `rejudgeResultsFile` on the recorded file. No command-line mode was added, so no flag needs documenting.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Aligned the AC-8 sentence in docs/operations-and-testing.md**
- **Found during:** Task 2 (grep of the proposal documents for AC-8)
- **Issue:** `docs/operations-and-testing.md` states the AC-8 pass rule with "no more than 50% of its tokens", which would contradict the requirements row and ADR-016. The plan's file list names only `docs/requirements.md`.
- **Fix:** One clause changed to "no more than 95% of its tokens, inclusive" with a link to ADR-016. This is a design-decision change, which CLAUDE.md allows a proposal document to follow when the decision is recorded.
- **Files modified:** `docs/operations-and-testing.md`
- **Committed in:** `843c839`

---

**Total deviations:** 1 auto-fixed (1 missing critical consistency edit)
**Impact on plan:** one sentence; no scope growth. Three other proposal files mention AC-8 without a bound (`docs/implementation-plan.md`, `docs/extensions.md`, `docs/reference-system-comparison.md`) and were left alone.

## Issues Encountered

- The worktree sandbox refused compound git commands and the root-pin script; the pin was checked by hand (`git rev-parse --show-toplevel` printed `/Users/aphan/avarice/.claude/worktrees/phase-04`) and the guard script itself ran once successfully earlier in the session.
- The `duration` figure spans the wait for the owner's answer.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. The re-judge reads a local file and opens no new endpoint, auth path or write location.

## Surfaces for plan 04-54 (documentation plan)

- AC-8 outcome for `docs/system/findings.md`: the requirement now reads 95% inclusive (ADR-016); the recorded evaluation passes through B at 94.4%. If a `docs/system/` document describes the evaluation harness or AC-8, it states the new bound, the constant `AC8_TOKEN_BOUND_PERCENT`, and the re-judge pair (`rejudge`, `rejudgeResultsFile`); no command-line flag was added. The grep of `docs/system/` found no existing mention of the harness.
- Open consequences ADR-016 names for the owner: the post-result choice of the bound, the narrow 0.6 point margin, the small sample, and the missing measurement under the whole-file read caps.
- WR-28, WR-29, WR-32 and WR-36 remain deferred rows in the review ledger.

## Next Phase Readiness

- SC2's AC-8 part is closed by a recorded owner decision. `04-VERIFICATION.md` still lists the SC2 gap as written by the earlier verification; the verifier should treat it as closed by ADR-016 on the next pass.
- Plan 04-54 (documentation) is next.

## Self-Check: PASSED

- Files exist: ADR-016, `eval-verdict-adr016.json`, `04-50-decision-context.json`, this summary (checked with `[ -f ]` below).
- Commits `5987561`, `0c8a792`, `658c81f`, `ee37da8`, `843c839` are ancestors of HEAD.
- `eval-results.json` sha256 `3b40148356b2f2dd7420d18ed6e6d36b7e6d73378fe8f4d52deeba5fa9e5b5e8` before and after; `git diff --quiet` against the plan's base for it and for ADR-015 exits 0.
- `node --test test/unit/eval-retrieval.test.ts`: 63 pass, 0 fail. `npm run typecheck`: clean. `npm run check:boundaries`: ok.
- The Phase 4 spend ledger gained no line; no live call, `--live` or `--authorize` was run.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
