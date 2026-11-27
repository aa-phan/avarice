---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 47
subsystem: testing
tags: [node-test, redaction, credential-grammar, seatbelt-sandbox, process-race, planted-regression]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: the redacting artifact store (04-18), the credential reference grammar (04-15), the moved-roots sandbox deny list (02-20, 04-30), the approval consume race (04-16) and the retrieval counter race (04-28)
provides:
  - "artifact-redaction kind scan that counts every artifacts.put call per file, resolves the shorthand { kind, runId } through its helper's call sites, and fails when it resolved fewer calls than the file holds"
  - "credential-ref grammar tests that assert the error kind invalid for every refused input, with no early return"
  - "moved-roots denial cases that need status failed and a permission message, with /bin/ls and /bin/cat positive controls under the same sandbox"
  - "race tests whose children print leftBarrierAt, calledAt and returnedAt and which fail with 'the race was not exercised' when no calls overlapped"
affects: [04-54]

actuals:
  tokens: 18600
  tasks: 3
  commits: 3
plan_head_before: e6e426c8273a6af00717e297bc614c4e92786eab
plan_head_after: 040c75453a8b0019d8724bbc6ad6a27b533a86a7

tech-stack:
  added: []
  patterns:
    - "a security test is proven by a planted regression: the old test passes against it, the strengthened test fails, the failure is recorded as RED evidence, the plant is reverted before the commit"
    - "a race test asserts that the processes overlapped (intersecting call intervals, or interleaved grants) with a bounded retry, and keeps its exactness assertions on every attempt"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-47-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-47-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-47-red-task3.json
  modified:
    - test/integration/artifact-redaction.test.ts
    - test/unit/credential-ref.test.ts
    - test/integration/run-sandbox-other-profiles.test.ts
    - test/fault/retrieval-race.test.ts
    - test/fault/approval-consume.test.ts
    - test/helpers/retrieval-race-child.ts
    - test/helpers/approval-consume-child.ts

key-decisions:
  - "The kind scan reads call arguments with a balanced-parenthesis reader instead of a regular expression, so a call whose options are { kind, runId } is read, and one call site it cannot read leaves the whole call unresolved rather than reporting a guessed kind"
  - "The scan's floor is the list of the 13 kinds the code stores today (named, not counted), so a call site the scan stops reading fails by name"
  - "A denial in the sandbox test is status failed plus /operation not permitted|permission denied/i; the node reader script now prints the error message as well as its code so it meets the same assertion"
  - "Times in the race children are performance.timeOrigin + performance.now() (sub-millisecond, comparable between processes), not Date.now(), because a call to the store can finish inside one millisecond"
  - "retrieval-race counts a race as overlapping calls of different processes OR interleaved grants in return order, as the plan allows; approval-consume needs overlapping intervals in at least one round"

patterns-established:
  - "Retry only the evidence of a race, never the exactness assertions: every attempt must still show exactly one winner per approval and an exact counter"

requirements-completed: [SEC-1, SEC-2, SEC-3, FR-12, CON-11]

coverage:
  - id: D1
    description: "The redaction kind scan reads every artifacts.put call in src, shorthand forms included, and fails when it resolves fewer calls than a file holds; removing restricted-patch or manual-context from the redacted kinds fails it"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/artifact-redaction.test.ts#the artifact kinds the code stores (source scan)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The credential reference tests assert the error kind invalid for every refused input; a parser answering denied for keychain:../x fails them"
    requirement: SEC-2
    verification:
      - kind: unit
        ref: "test/unit/credential-ref.test.ts#parseCredentialRef (SEC-2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The moved-roots denial cases pass only on a permission failure with status failed, and /bin/ls and /bin/cat succeed under the same sandbox on an allowed path"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/run-sandbox-other-profiles.test.ts#through the real sandbox (CS-7, AC-6)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The approval and retrieval-counter race tests show that calls overlapped (or grants interleaved) and fail with 'the race was not exercised' when the processes run one after the other"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/fault/approval-consume.test.ts#two processes consume one approval: exactly one gets it (T-04-42)"
        status: pass
      - kind: integration
        ref: "test/fault/retrieval-race.test.ts#six processes search one run at once: the counter is exact (CS-16)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 47: Strengthened security oracles Summary

**Four security test oracles (redaction kind scan, credential grammar kind, moved-roots denial, process races) that now fail when their control fails, each proven against a planted regression that the old test let through.**

## Performance

- **Duration:** about 20 min (start time not recorded at launch; first commit 16:06 -06:00, last 16:12)
- **Completed:** 2026-11-22T22:12Z
- **Tasks:** 3
- **Files modified:** 7 test files, 3 red records; no file under src/ changed

## Accomplishments

- WR-39: the kind scan counts `artifacts.put` calls per file and resolves `{ kind, runId }` through the enclosing helper's call sites (`storeText` in manual-inputs.ts, `storeOutput` in restricted.ts). With `restricted-patch` or `manual-context` removed from `REDACTED_TEXT_KINDS` it fails naming the kind and file; the old scan passed because its regular expression needed a literal `kind:`.
- WR-40: five early-return guards in credential-ref.test.ts are one `invalidOf` helper that asserts the kind `invalid`. A parser planted to answer `denied` for `keychain:../x` fails the test; the old test passed 12 of 12 because the loop returned at the third input.
- WR-41: a `denied()` helper requires status `failed` and a permission message; `/bin/ls` and `/bin/cat` controls pass on the run clone under the same sandbox. A broken `/usr/bin/false` in the denial cases passed the old test and fails the new one.
- WR-42: both children print `leftBarrierAt`, `calledAt` and `returnedAt`; both tests fail with "the race was not exercised" when the children run one after the other, after at most 5 attempts.

## Task Commits

1. **Task 1: redaction kind scan (WR-39)** - `a03fdf6` (test)
2. **Task 2: credential grammar and moved-roots denial (WR-40, WR-41)** - `bf92fa7` (test)
3. **Task 3: race tests prove the processes raced (WR-42)** - `040c754` (test)

**Plan metadata:** the docs commit that follows this file.

## TDD Gate Compliance

Test-only plan: each task is one `test(04-47)` commit that holds the strengthened test and its red record; no `feat` commit exists because no source under src/ changed. The red record of each task is the strengthened test failing against a planted regression in the working tree, which was reverted before the commit (as `flagged_assumptions` states). `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (reason `target_test_failed`) for all three records.

## RED evidence

| Task | Planted regression | Old test | Strengthened test |
|------|--------------------|----------|-------------------|
| 1 | `restricted-patch` deleted from `REDACTED_TEXT_KINDS` (also `manual-context`, checked separately) | 8 of 8 pass | fails: `artifact kind restricted-patch (src/app/run-stages/restricted.ts) is neither a map kind nor in REDACTED_TEXT_KINDS` |
| 2a | `src/domain/credential-ref.ts` answers `denied` for `keychain:../x` | 12 of 12 pass | fails: actual `denied`, expected `invalid` |
| 2b | the five `/bin/ls`, `/bin/cat` denial commands replaced by `/usr/bin/false` | 31 of 31 pass | fails on the permission-message assertion |
| 3 | both race tests start their children one after the other | 5 of 5 pass | both fail: `the race was not exercised` after 5 attempts with 0 overlap |

`git diff --stat -- src` is empty at the end of every task, so `redacting-artifact-store.ts` and `credential-ref.ts` show no diff.

## Files Created/Modified

- `test/integration/artifact-redaction.test.ts` - balanced-parenthesis put-call reader, per-file call count, shorthand resolution, helper self-test, kind list in place of the floor of 7
- `test/unit/credential-ref.test.ts` - `invalidOf` helper replacing five early returns
- `test/integration/run-sandbox-other-profiles.test.ts` - `denied()` helper, `/bin/ls` and `/bin/cat` control, node reader prints the error message
- `test/fault/approval-consume.test.ts`, `test/fault/retrieval-race.test.ts` - overlap and interleave evidence, 5 bounded attempts
- `test/helpers/approval-consume-child.ts`, `test/helpers/retrieval-race-child.ts` - per-call timestamps
- `.planning/phases/04-.../04-47-red-task{1,2,3}.json` - RED records

## Decisions Made

See `key-decisions`. For coverage.md (plan 04-54): artifact-redaction.test.ts 8 to 10 tests (+2), run-sandbox-other-profiles.test.ts 31 to 32 (+1), credential-ref, approval-consume and retrieval-race unchanged in count; net +3 tests.

## Deviations from Plan

### Plan assumption corrected

**1. [Plan assumption] The Task 2 plant "a nonexistent program" does not pass the old test**
- **Found during:** Task 2
- **Issue:** the sandbox executor answers a missing program with an `unavailable` error, which the old `check()` helper already asserts against (`assert.ok(result.ok)`), so the old test fails on that plant and cannot show the weakness.
- **Fix:** planted `/usr/bin/false` instead (a broken program that exits 1 with no permission message), which the old test accepts. Both outcomes are in 04-47-red-task2.json.
- **Files modified:** none beyond the planned ones
- **Committed in:** `bf92fa7`

**2. [Rule 3 - Blocking] The node reader script of the sandbox test printed only the error code**
- **Found during:** Task 2
- **Issue:** `denied()` requires "Operation not permitted" or "Permission denied" and the script wrote `EPERM` alone.
- **Fix:** the script writes `code: message`; the existing `/EPERM|EACCES/` and canary assertions still hold.
- **Committed in:** `bf92fa7`

**3. Added a self-test of the scan** (Task 1): a test that feeds the scan a helper with a constant and a literal call site and one with an unreadable call site, so the shorthand resolution itself is under test. Not in the plan; adds one test.

**Total deviations:** 1 plan assumption corrected, 1 blocking fix, 1 added test. **Impact:** none on scope; no source change.

## Issues Encountered

- The worktree guard refuses compound shell commands, so the `git diff --quiet` checks of the plan's `<verify>` were run as `git diff --stat -- src` (empty output) and the full verification as separate commands. Same facts, different form.
- The tracer gate for Task 1 was met by re-running its verify after the commit: 10 of 10 pass.

## Verification

- `node --test` over the five files: 59 tests, 59 pass, 0 fail, 0 skipped. The two race files were run 4 times on the real code, all pass.
- `npm run typecheck` clean, `npm run check:boundaries` ok (132 files).
- Not run: the full `npm test` suite (orchestrator instruction: over an hour here).

## Known Stubs

None.

## Threat Flags

None. T-04-129 (weak oracles) is mitigated: each strengthened test was proven red against a planted regression, recorded, and reverted.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for the next plan of the phase. The race tests can fail under extreme load when no attempt overlaps; that is the stated honest outcome (flagged assumption), not a defect.

## Self-Check: PASSED

- FOUND: the three red records and the seven test files listed above
- FOUND commits: a03fdf6, bf92fa7, 040c754 (ancestors of HEAD)
- `git diff --stat -- src` empty

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
