---
phase: 02-contained-unattended-run-of-one-work-item
plan: 29
subsystem: git-adapters
tags: [git, sha-256, commit-id, rangeerror, path-confinement, checkout-digest, run-refs]
requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: GitRunSource and CloneRunWorkspace from plan 02-07, checkout-digest from plan 01-19
provides:
  - COMMIT_SHA of 40 lowercase hex digits and a head read that refuses a SHA-256 repository, naming the object format
  - oldestCommitTime, a single-pass minimum, so staleness cannot throw on a long history
  - checkRelative splitting on a slash only, so a file named a\b is one segment
  - RUN_REF_PATTERN, an anchored single-segment run-ref allowance, and checkoutDigest taking globs and patterns
affects: [02-35 documentation pass, 02-REVIEW disposition record]
gap_closure: true
gap_ids: [G-02-H4]
actuals:
  tokens: 9000
  tasks: 3
  commits: 6
plan_head_before: a6cff1a058ae65ffee7086961d0f606b52f32fbf
plan_head_after: 2e0bda14c3d9116df65e02efa878ee09d9a5c7d0
tech-stack:
  added: []
  patterns:
    - "one narrow commit-id pattern shared by every git adapter; a wider repository kind is refused at the first read"
    - "a single-pass reduction instead of a spread over an unbounded list"
    - "an exact RegExp for a ref allowance, a glob only where the caller asked for one"
key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-29-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-29-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-29-red-evidence-task3.json
  modified:
    - src/adapters/git/staging-base.ts
    - src/adapters/git/run-source.ts
    - scripts/checkout-digest.ts
    - scripts/exit-run-phase2-tools.ts
    - test/integration/run-source.test.ts
    - test/integration/run-workspace.test.ts
    - test/integration/run-source-untouched.test.ts
    - test/unit/checkout-digest.test.ts
    - docs/system/integrations.md
key-decisions:
  - "Narrow COMMIT_SHA to 40 hex and refuse a SHA-256 HEAD at the first read, rather than widen six domain patterns for a repository onboarding cannot map"
  - "Do not add the review's `refsAllowed <= 1` assertion: the Phase 2 exit evidence tool already fails any new ref other than refs/heads/avarice/<runId>"
requirements-completed: [RC-2, CON-2, CON-16]
coverage:
  - id: D1
    description: "A real SHA-256 repository is refused by GitRunSource.head with an invalid error on field head that names SHA-256; staleness and conventionsAt given a 64-hex HEAD are invalid; COMMIT_SHA accepts 40 lowercase hex only (R-WR-06)"
    requirement: RC-2
    verification:
      - kind: integration
        ref: "test/integration/run-source.test.ts#a SHA-256 repository is refused at the first read (R-WR-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "oldestCommitTime of 150000 lines returns the minimum times 1000 without throwing; none and non-numeric lines give null (R-WR-07)"
    requirement: RC-2
    verification:
      - kind: integration
        ref: "test/integration/run-source.test.ts#oldestCommitTime (R-WR-07)"
        status: pass
    human_judgment: false
  - id: D3
    description: "checkRelative splits on a slash only; a run-added file named a\\b is read, listed and discarded as itself and a tracked a/b is untouched (R-IN-04)"
    requirement: CON-16
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#checkRelative splits on a slash only (R-IN-04)"
        status: pass
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#a run-added file named a\\b is read, listed and discarded as that one file"
        status: pass
    human_judgment: false
  - id: D4
    description: "--allow-run-refs leaves out only refs/heads/avarice/run_ plus one segment; a nested ref still counts; --allow-ref keeps its glob meaning (R-IN-09)"
    requirement: CON-2
    verification:
      - kind: unit
        ref: "test/unit/checkout-digest.test.ts#--allow-run-refs does not hide a nested ref under the run prefix"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/system/integrations.md states the 40-digit commit id and the SHA-256 refusal in plain words"
    requirement: RC-2
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and style; the fresh prose review and coverage.md entry belong to plan 02-35"
duration: 55min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 29: Git adapters and run-ref allowance Summary

**A real SHA-256 repository is refused at the first commit read with the object format named, staleness no longer throws past 125000 commits, a file named `a\b` is never acted on as `a/b`, and `--allow-run-refs` no longer hides refs nested under the run prefix.**

## Performance

- **Duration:** about 55 min (start time was not captured as a variable; estimated from the session)
- **Completed:** 2026-11-08
- **Tasks:** 3 (one tracer, two auto; all TDD, six commits)
- **Files modified:** 9 source, test and doc files, plus 3 RED evidence files

## Findings fixed

| Finding | Status | Fix |
|---|---|---|
| R-WR-06 (WR-06) | fixed | COMMIT_SHA is 40 lowercase hex; GitRunSource.head returns invalid on field `head` naming SHA-256 for a 64-hex HEAD, so run start exits with its internal code (70) before any row or file is created. No new refusal code. |
| R-WR-07 (WR-07) | fixed | oldestCommitTime scans once; the spread over the times is gone. A 150000-line input returns the minimum. |
| R-IN-04 (IN-04) | fixed | checkRelative splits on `/` only. Because the commit path check joins the segments with `/`, a commit of `a\b` also no longer turns into a commit of `a/b`. |
| R-IN-09 (IN-09) | fixed | RUN_REF_PATTERN `^refs/heads/avarice/run_[A-Za-z0-9_]+$` replaces RUN_REF_GLOB for `--allow-run-refs`; `--allow-ref` keeps its glob semantics. |

**Suggestion not taken (for plan 02-35):** the review's second R-IN-09 suggestion, asserting `refsAllowed <= 1`, is not added. The Phase 2 exit evidence tool already fails any new ref other than `refs/heads/avarice/<runId>` (scripts/exit-run-phase2-tools.ts, about lines 699-706), so the assertion would repeat a check that exists.

## TDD record

- **Task 1 RED** (`a895af3`): on a real `git init --object-format=sha256` repository (git 2.39.5, not skipped), head returned ok with 64 hex, staleness and conventionsAt accepted it, and COMMIT_SHA accepted 64 hex. Three planned assertions failed, the fixture control and the ordinary-repository control passed. Evidence: 02-29-red-evidence-task1.json. **GREEN** (`8cefde8`).
- **Task 2 RED** (`a48cd66`): checkRelative('a\\b') returned two segments and readText of `a\b` returned the content of the tracked `a/b`. The oldestCommitTime cases failed only as a file-level link failure (the named export did not exist), recorded as not RED authority; the run-workspace failures are the authority. The discard half of the backslash case is not reached at base because the readText assertion fails first; it passes after the fix. Evidence: 02-29-red-evidence-task2.json. **GREEN** (`808467b`).
- **Task 3 RED** (`b4a380a`): adding `avarice/run_Y/extra` left the refs digest unchanged under `--allow-run-refs`. Evidence: 02-29-red-evidence-task3.json. **GREEN** (`2e0bda1`).
- No REFACTOR commits.

## Task Commits

1. **Task 1: SHA-256 refusal (R-WR-06)** - `a895af3` (test), `8cefde8` (feat)
2. **Task 2: oldest time and slash-only split (R-WR-07, R-IN-04)** - `a48cd66` (test), `808467b` (feat)
3. **Task 3: anchored run-ref allowance (R-IN-09)** - `b4a380a` (test), `2e0bda1` (feat)

**Plan metadata:** the docs(02-29) commit that holds this file, STATE.md and ROADMAP.md.

## Files Created/Modified

- `src/adapters/git/staging-base.ts` - COMMIT_SHA of 40 hex; checkRelative split on `/` only
- `src/adapters/git/run-source.ts` - head() refusal; exported oldestCommitTime
- `scripts/checkout-digest.ts` - RUN_REF_PATTERN; checkoutDigest takes globs and patterns; header updated
- `scripts/exit-run-phase2-tools.ts` - passes RUN_REF_PATTERN (see deviation 1)
- `test/integration/run-source.test.ts`, `test/integration/run-workspace.test.ts`, `test/unit/checkout-digest.test.ts`, `test/integration/run-source-untouched.test.ts` - the new cases and the pattern import
- `docs/system/integrations.md` - commit-id format and the SHA-256 refusal

## Decisions Made

- Narrow the shared pattern to 40 hex (as triaged) and refuse at the first read; widening six domain patterns would buy nothing while onboarding cannot map a SHA-256 repository.
- Onboarding preparation already refuses a 64-digit pin through the pin check, with the generic "a full lowercase commit SHA is required" reason, not one naming the object format. The documentation says exactly that; only run start names the object format. A naming message at onboarding was left out as outside the plan.
- Do not add the `refsAllowed <= 1` assertion (reason above).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] scripts/exit-run-phase2-tools.ts also imported RUN_REF_GLOB**
- **Found during:** Task 3
- **Issue:** the exit evidence tool, not listed in the plan's files, imported and used RUN_REF_GLOB; removing the export would break it and the plan's acceptance grep (`grep -rn "RUN_REF_GLOB" scripts test` prints nothing) would fail.
- **Fix:** it imports and passes RUN_REF_PATTERN instead.
- **Files modified:** scripts/exit-run-phase2-tools.ts
- **Verification:** `npx tsc -p .` clean; the grep over scripts, test, src and docs prints nothing.
- **Committed in:** `2e0bda1`

**2. [Wording] oldestCommitTime comment avoids the literal spread text**
- The plan's verify greps `Math.min(...` in run-source.ts and expects no match; the first comment quoted it. The comment was reworded in the same GREEN commit (`808467b`).

---

**Total deviations:** 1 auto-fixed (1 blocking), 1 wording adjustment
**Impact on plan:** none on behavior; one extra file touched to keep the tool compiling.

## Issues Encountered

- Full suite (`npm test`): 2554 tests, 2498 pass, 55 skipped, 1 fail. The failure was the known load-sensitive ENOTEMPTY in the `after` cleanup of test/integration/run-start.test.ts (`rmSync` of an `avarice-cli-*` temp directory). That file passes alone (26 of 26). No other known flaky test (claude-host SIGTERM, fail-closed, killpoints) failed.
- The session's command filter refused the root-pin script and some compound shell lines; the equivalent check (`git rev-parse --show-toplevel` equals the pinned root) was run before each commit instead.

## Known Stubs

None.

## Threat Flags

None. The plan's register (T-02-101 to T-02-104) is mitigated by the tests named under Task 1 to 3.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02-35 (documentation pass) reviews the integrations.md prose with a fresh prose reviewer, records the `refsAllowed <= 1` reason, and edits coverage.md. No blocker.

## Self-Check: PASSED

All created and modified files exist on disk; commits a895af3, 8cefde8, a48cd66, 808467b, b4a380a and 2e0bda1 are on the branch; `npx tsc -p .` is clean; the six-file targeted verification passes.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-08*
