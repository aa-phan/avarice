---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 52
subsystem: review-ledger
tags: [code-review, disposition, fix-report, triage, gap-closure]
requires:
  - phase: 04-40 to 04-49, 04-51, 04-55
    provides: the commits and red records that fixed the review's critical and warning findings
provides:
  - "04-REVIEW-FIX.md: 38 Fixed Issues entries and 1 Skipped Issues entry, each with plan, commits and the test that failed before the fix"
  - "04-REVIEW-DISPOSITION.md: no CR or WR row open (5 critical fixed; of 42 warnings 32 fixed, 1 skipped, 9 deferred), IN-03 fixed, 27 info rows open"
  - "deferred-items.md: one line per deferred warning with its target"
affects: [04-50, 04-53, 04-54]
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: f6d3224a5acb5f914a5ed786e505843e3754f522
plan_head_after: 54d693e8d741446071ee789551d6ac7eb260f00f
tech-stack:
  added: []
  patterns:
    - "a finding is recorded fixed only with a commit that names it, a red test record, and a parseable ledger row"
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-FIX.md
  modified:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-DISPOSITION.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/deferred-items.md
key-decisions:
  - "WR-39 to WR-42 are test-only fixes: their red evidence is the strengthened test failing against a defect planted in the working tree and reverted, recorded as such in the fix report"
  - "IN-03 is recorded fixed without a separate red record: the pre-fix row text fails the new enforcement-map assertion by reading, and the report says so"
  - "WR-28, WR-29, WR-32 and WR-36 are deferred to plan 04-50, which may move them to fixed"
requirements-completed: [FR-12, SEC-6]
coverage:
  - id: D1
    description: "Every critical and warning finding of 04-REVIEW.md has a recorded disposition: 37 fixed, 1 skipped, 9 deferred, none open"
    requirement: FR-12
    verification:
      - kind: other
        ref: "the plan's task 2 verification script: 47 CR and WR rows parse with the gate's row pattern, none open, every fixed row has a fix-report entry, every skipped or deferred row has a reason"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every fixed row names commits that exist and the test that failed before the fix"
    requirement: FR-12
    verification:
      - kind: other
        ref: "git cat-file -e over the 65 distinct hashes in 04-REVIEW-FIX.md: 0 missing; 38 of 38 fixed entries carry a test line; 38 of 38 headings equal the review's"
        status: pass
    human_judgment: false
duration: not captured
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 52: Code review findings recorded with their fixes Summary

**All 5 critical and 42 warning findings of the phase review now have an evidenced decision: 37 fixed with commits and red-test records (plus IN-03), WR-34 skipped as a procedural guard, and 9 deferred with a reason and a target.**

## Performance

- **Duration:** not captured (no start time was recorded for this run)
- **Completed:** 2026-11-22
- **Tasks:** 2 (one tracer, one auto)
- **Files:** 4 (one new, two edited, this summary)

## Accomplishments

- **Tracer, CR-01.** `04-REVIEW-FIX.md` was created with the CR-01 entry (plan 04-40, five commits, two red tests); the CR-01 row and its frontmatter entry read `fixed`. The task's verification failed before the edit (exit 1) and passed after it. Commit `a0f8c3b`.
- **Whole ledger.** The triage table was applied to every CR and WR row. The fix report holds 38 `### ID: title` entries under `## Fixed Issues` (titles equal the review's headings; each entry names its plan, its commits and the test that failed before the fix, with the red record file where one exists) and WR-34 under `## Skipped Issues`. Commit `54d693e`.
- **Counts.**

| Disposition | Findings |
|---|---|
| fixed | CR-01 to CR-05; WR-01 to WR-13, WR-15 to WR-22, WR-24, WR-25, WR-27, WR-30, WR-31, WR-33, WR-35, WR-39 to WR-42 (32 warnings); IN-03 |
| skipped (accepted) | WR-34 |
| deferred | WR-14, WR-23, WR-26, WR-28, WR-29, WR-32, WR-36, WR-37, WR-38 |
| open | 27 info rows (IN-01, IN-02, IN-04 to IN-28), outside this gap |

The ledger frontmatter reads `open: 27`, `total: 75`.

- **Evidence checks.** 65 distinct commit hashes in the fix report all resolve (`git cat-file -e`), all after the planning base `792536d`. No entry cites a planning-documents commit as a fix.

## Task Commits

1. **Task 1: Tracer - CR-01 recorded end to end** - `a0f8c3b` (docs)
2. **Task 2: Record every critical and warning finding, and the deferred items** - `54d693e` (docs)

## Deferred warnings (for the owner and plan 04-54's findings pass)

| ID | Reason | Target |
|---|---|---|
| WR-14 | a requested promotion that never started is not reported; nothing runs and no data changes | Phase 5 (delivery and data safety) |
| WR-23 | byte fidelity of a non-UTF-8 restricted patch | Phase 5 (data safety) |
| WR-26 | doctor availability only; the registry read itself fails closed | Phase 5 (corrupted-store diagnosis and restore) |
| WR-28 | AC-8 summary arithmetic; no effect on the recorded verdict | plan 04-50 |
| WR-29 | AC-8 token comparison uses totals; equal task counts in the recorded runs | plan 04-50 |
| WR-32 | a paid run is discarded when judge preparation throws; no effect on the recorded verdict | plan 04-50 |
| WR-36 | the arm repository keeps denied files in history; plan 04-50's decision context scans whether a run read the held-out file | plan 04-50 |
| WR-37 | fake-remote duplicate fault changes nothing (NFR-4 proof) | Phase 7 |
| WR-38 | doctor tests flake under load | Phase 5 |

**Rows plan 04-50 may move to fixed:** WR-28, WR-29, WR-32 and WR-36 (if the owner chooses branch b). Nothing in this plan read an output of plan 04-50. No security-relevant warning is deferred: WR-11 was fixed by plan 04-55 (`9eace81`, `a65c2c7`, `99f5e2a`, `cefb2e2`).

## Decisions Made

- **Test-only fixes (WR-39 to WR-42).** Plan 04-47 changed no source: each fix is a strengthened test, and its red evidence is the test failing against a defect planted in the working tree and reverted. The fix report states this for each entry rather than presenting it as a failure on unfixed source.
- **IN-03 evidence.** No red record exists for the enforcement-map assertions. The fix report says so and gives the reading evidence: the row before `606c69b` was "Evaluates policy in the PreToolUse hook the host runs", which fails the first assertion `51633f3` added.
- **WR-27 evidence.** The red record `04-45-red-task2.json` names the WR-25 case as its target; the WR-27 case failed in the same run on its message assertion. The entry names both.
- **CR-04 second red.** Plan 04-48's second red record (`fb44006`) is also a planted defect, because the behavior already held; the entry says so.

## Deviations from Plan

None - plan executed exactly as written. Every row the triage marks fixed has a landing commit and none of the plans' SUMMARY files says a fix did not land, so no fixed row was changed to deferred.

## Known Stubs

None.

## Threat Flags

None. The plan's threat T-04-140 (a finding recorded fixed with no fix behind it) is mitigated: every fixed row has an existing commit naming its ID, a red-test line, and passes the plan's verification script.

## Issues Encountered

- The worktree sandbox refuses compound shell commands that name git or run node with a computed program, so the pin guard, `git` calls and the verification script were run as separate plain commands, and the build and acceptance scripts were kept outside the repository.
- The pin script `root-pin.sh` ran and matched the pinned root before each write and commit.

## Next Phase Readiness

- Plan 04-50 can move WR-28, WR-29, WR-32 and WR-36 to fixed in `04-REVIEW-DISPOSITION.md` and add their entries to `04-REVIEW-FIX.md`.
- Plan 04-53 (documentation) and 04-54 (findings pass) can read the deferred list above and `deferred-items.md`.

## Self-Check: PASSED

- `04-REVIEW-FIX.md`, `04-REVIEW-DISPOSITION.md`, `deferred-items.md` exist; the verification script exits 0 (47 rows, none open, 37 fixed, 1 skipped, 9 deferred).
- Commits `a0f8c3b` and `54d693e` are ancestors of HEAD; all 65 hashes cited in the fix report resolve.
