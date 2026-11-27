---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 64
subsystem: evaluation-harness
tags: [eval-retrieval, brief-coverage, success-amendment, owner-approval, gap-closure, G-04-3]

requires:
  - phase: 04
    provides: "plan 04-61: briefBullets, editedPaths, loadCoverage, loadAmendment, judgeWithCoverage, rejudgeWithCoverage, loadApprovedTasks"
provides:
  - "eval-coverage.json: every bullet of the brief of each of the 18 recorded AC-8 runs, with a status and evidence, pinned to the sha256 of the results and of the task list"
  - "eval-success-amendment.json: the amended success rule and the partial rule, pinned to the task list's sha256, owner-approved (Aaron Phan, 2026-11-25T05:57:45Z)"
  - "D-07 amendment line in 04-CONTEXT.md and the benchmark README rows for the three ADR-017 files"
affects: [04-65, ADR-017, eval-verdict-adr017.json]

actuals:
  tokens: 8100
  tasks: 3
  commits: 3
plan_head_before: e471dd4b030b6bd28667a89747996eef5a6c3246
plan_head_after: 5f600e783faa5ad478d5d2a8c33d10b5772a6450

tech-stack:
  added: []
  patterns:
    - "A success-rule change lives in an amendment file pinned to the unedited task list's digest and carries its own approvedBy and approvedAt, null until the owner's blocking-human checkpoint"

key-files:
  created:
    - test/benchmark/phase4/eval-coverage.json
    - test/benchmark/phase4/eval-success-amendment.json
  modified:
    - test/benchmark/phase4/README.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-CONTEXT.md

key-decisions:
  - "Owner approved the amended success rule and the coverage record as drafted, with no changes (reply \"approve\", 2026-11-25T05:57:45Z)"
  - "Judgment call T04-A: a strict YYYY-MM reading of the brief; judgment call T05 bullet 1: delivered via sizes=\"20px\" (both shown to and accepted by the owner)"

requirements-completed: [FR-3, FR-22]

coverage:
  - id: D1
    description: "eval-coverage.json records all 18 runs, every brief bullet with a status and non-empty evidence, and loadCoverage accepts it"
    requirement: "FR-22"
    verification:
      - kind: other
        ref: "node --input-type=module: loadCoverage(eval-coverage.json, results sha256, tasks, readCoverageRuns(...).runs) prints 18 runs"
        status: pass
    human_judgment: false
  - id: D2
    description: "eval-success-amendment.json carries the owner's approval and loadAmendment accepts it as approved against the tasks digest"
    requirement: "FR-22"
    verification:
      - kind: other
        ref: "node --input-type=module: loadAmendment(eval-success-amendment.json, tasks.digest) prints approved; grep -c '\"approvedBy\": \"Aaron Phan\"' prints 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "eval-tasks.json, eval-results.json and eval-verdict-adr016.json are byte-identical to the planning base ed9e123"
    requirement: "FR-22"
    verification:
      - kind: other
        ref: "git diff --quiet ed9e123..HEAD -- the three files exits 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether each bullet judgment in the coverage record is right"
    requirement: "FR-3"
    verification: []
    human_judgment: true
    rationale: "The owner reviewed every partly bullet with its evidence at the checkpoint and approved; a later spot-check is the owner's, not a gate"

duration: "about 10 min of active work, plus the owner's wait at the checkpoint"
completed: 2026-11-25
status: complete
---

# Phase 4 Plan 64: Brief coverage of the 18 recorded runs and the owner-approved amended success rule Summary

**Per-bullet brief coverage of the 18 recorded AC-8 runs and a count-as-partial success rule, pinned to the untouched task list and approved by the owner, so plan 04-65 can re-judge with no spend and no re-run.**

## Performance

- **Duration:** about 10 minutes of active work (first commit 2026-11-24T22:11Z, approval commit 2026-11-25T05:59Z); the interval between is the owner's wait at the checkpoint
- **Tasks:** 3 (one tracer, one blocking-human decision checkpoint, one auto)
- **Files modified:** 4 (two created, two modified)

## Accomplishments

- Recorded, for each of the 18 runs, every bullet of its brief with a status (delivered, partly, skipped) and evidence (transcript path and lines, and one sentence), judged by rules fixed before judging and the same for every arm.
- Drafted the amended success rule and the partial rule in a separate file pinned to the tasks file's sha256, so the pinned task list stays byte-identical.
- Obtained the owner's re-approval at the blocking-human checkpoint and recorded it in the amendment; the harness refuses the file until both approval fields are set, and now accepts it.
- Recorded the D-07 amendment in 04-CONTEXT.md and the three ADR-017 files in the benchmark README.

## The owner's approval

Owner's reply, verbatim: "approve"

Time of the reply (RFC 3339 UTC): 2026-11-25T05:57:45Z. Recorded as approvedBy "Aaron Phan" and approvedAt "2026-11-25T05:57:45Z".

The owner was shown the successRule and partialRule text, the eval-tasks.json pin (sha256 3de7b1080203809485fbf4f7b968e9e29703490494a019b0750e2f1050f15d92), the 18-run outcome table, the 9 partly-delivered bullets and their cause, the restated figures, the triviality note, and the two judgment calls (T04-A strict YYYY-MM; T05 bullet 1 via sizes="20px"). The owner approved the wording and the record as drafted, with no changes. The owner's decision to count as partial (2026-11-23) was already taken; the checkpoint approved the wording and the record.

Digests of the approved record, from a read-only re-judgement run in this plan (nothing written):

- eval-coverage.json: f704343603878a975d3b2acff939d04502dff34c02f844008b8fa8f31414861b
- eval-success-amendment.json (approved): ecc3ada17f471cddfa7d4b0f59be08bcb52cf30f22fe1299a038922ac4b3e669
- eval-results.json: 3b40148356b2f2dd7420d18ed6e6d36b7e6d73378fe8f4d52deeba5fa9e5b5e8

## Outcome of each recorded run, from the record

Every one of the 9 non-delivered bullets is "partly": the run wrote the unit tests the bullet names but no end-to-end test file, so no bullet is skipped.

| Task | Arm | Recorded success | Outcome | Non-delivered bullet |
|------|-----|------------------|---------|----------------------|
| T01 | A | true | partial | unit and e2e coverage for the reduced-then-off case: unit only |
| T01 | B | true | partial | the same: unit only |
| T01 | C | false | failure | the same: unit only (checks failed, so a failure whatever the coverage) |
| T02 | A | false | failure | e2e drag, modifier and repeat cases plus unit coverage: unit only |
| T02 | B | false | failure | the same: unit only |
| T02 | C | true | partial | the same: unit only |
| T03 | A | false | failure | none |
| T03 | B | true | success | none |
| T03 | C | true | success | none |
| T04 | A | false | failure | none |
| T04 | B | true | success | none |
| T04 | C | true | success | none |
| T05 | A | true | partial | unit check on every picture source; e2e density cases at pixel ratio 1 and 3: unit only |
| T05 | B | true | partial | the same: unit only |
| T05 | C | false | failure | the same: unit only |
| T06 | A | false | failure | none |
| T06 | B | false | failure | none |
| T06 | C | true | success | none |

## Restated figures (for plan 04-65)

| Arm | Runs | Recorded successes | Restated successes | Partial | Tokens | Share of A |
|-----|------|--------------------|--------------------|---------|--------|------------|
| A | 6 | 2 | 0 | 2 | 19,833,920 | 1.0000 |
| B | 6 | 4 | 2 | 2 | 18,715,894 | 0.9436 |
| C | 6 | 4 | 3 | 1 | 17,557,851 | 0.8852 |

- **AC-8 verdict:** pass, via arm B, "arm B succeeds at least as often as A at 94.4% of A's tokens". Arm C also meets both clauses (88.5% of A's tokens). The ADR-016 verdict was a pass as well.
- **Triviality:** with A at 0 successes the success clause holds trivially for B and C; the pass rests on the token bound, not on B or C beating A.
- **D-08 knowledge outcome:** on, "arm C succeeds more often than B" (3 against 2; recorded 4 against 4 gave a different reason).
- Recorded figures were A 2, B 4, C 4 of 6.

## Task Commits

1. **Task 1: Tracer, the coverage record of the 18 runs and the draft amendment** - `f930282` (feat), `1f0baa8` (fix, the evidence states what each final result says about the e2e test)
2. **Task 2: Owner re-approval (checkpoint:decision, blocking-human)** - no commit; resolved by the owner's reply "approve"
3. **Task 3: The owner's approval recorded in the amendment** - `5f600e7` (feat)

**Plan metadata:** the docs commit that follows this summary.

## Files Created/Modified

- `test/benchmark/phase4/eval-coverage.json` - per-run, per-bullet coverage with evidence for the 18 recorded runs
- `test/benchmark/phase4/eval-success-amendment.json` - the amended success rule and partial rule, approved
- `test/benchmark/phase4/README.md` - Files table rows for the three ADR-017 files; the Success rule points to the amendment
- `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-CONTEXT.md` - the "D-07 amended" line under D-07

## Decisions Made

- Approved as drafted by the owner with no changes (see above).
- Two judgment calls, shown to and accepted by the owner: T04 arm A read strictly as YYYY-MM; T05 bullet 1 counted delivered via sizes="20px".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's verify called loadCoverage in the old three-argument form**
- **Found during:** Task 1 and Task 3 verification
- **Issue:** the plan's verify wrote loadCoverage(file, sha, digest). Plan 04-61 defined loadCoverage(file, resultsSha256, tasks, runs).
- **Fix:** the verify was run as 04-61 defined it, loadCoverage(file, resultsSha256, tasks, readCoverageRuns(...).runs), which prints 18. loadAmendment(file, tasks.digest) is unchanged and was run as written.
- **Files modified:** none (the check only)
- **Committed in:** not applicable

**2. [Rule 1 - Bug] Evidence wording corrected after the first commit**
- **Found during:** Task 1 review
- **Issue:** the first coverage evidence did not state what each final result says about the e2e test.
- **Fix:** evidence strings in eval-coverage.json reworded.
- **Files modified:** test/benchmark/phase4/eval-coverage.json
- **Committed in:** `1f0baa8`

---

**Total deviations:** 2 auto-fixed (both Rule 1)
**Impact on plan:** none on scope. No model start, no spend, no re-run.

## Issues Encountered

None. The scratch generator under /tmp/gsd-04-64 was not re-run after the checkpoint, so the approval fields were set by a single edit and nothing else in the amendment changed.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access pattern; the evidence strings cite paths and line numbers and copy no source text beyond a short phrase (T-04-168).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-65 can run rejudgeWithCoverage over eval-results.json, eval-tasks.json, eval-coverage.json and the approved eval-success-amendment.json, then write eval-verdict-adr017.json, ADR-017 and the proposal sentence. G-04-3 is closed by 04-65, so this plan's gap_ids is empty.
- The restated figures above are what 04-65 should reproduce; a different result there is a defect to surface.

## Self-Check: PASSED

- Files exist: eval-coverage.json, eval-success-amendment.json, README.md, 04-CONTEXT.md.
- Commits `f930282`, `1f0baa8`, `5f600e7` are ancestors of HEAD.
- loadCoverage prints 18; loadAmendment accepts the amendment; `"approvedBy": "Aaron Phan"` count is 1; the three pinned files are unchanged since ed9e123.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-25*
