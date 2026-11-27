---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 66
subsystem: testing
tags: [node-22, node-26, node-test, fixtures, glob, test-flakes, engines-floor]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: plans 04-56 to 04-65 (the final code and tests the two legs ran against)
provides:
  - scratch-repository test scripts and direct spawns that run on Node 22.22.3 and Node 26.9.0 (quoted glob, no directory argument)
  - a settled event-count snapshot in run-independent-work.test.ts
  - two load-dependent test races closed (restricted-onboarding cleanup, maxConcurrentChecks overlap)
  - 04-66-node-legs.json, the recorded full-suite legs on both Node lines at one commit
affects: [04-68 documentation plan, Phase 5 deferred items]

actuals:
  tokens: 9000
  tasks: 3
  commits: 5
plan_head_before: 7ee7c529585811204c54d915bb3a90dc67ecdc57
plan_head_after: f38e4ee

tech-stack:
  added: []
  patterns:
    - "A scratch package.json test script is `node --test \"test/**/*.test.ts\"`: both Node lines expand the quoted glob themselves; a directory argument is expanded by Node 26 only"
    - "A test that starts a detached supervisor passes --wait, or waits for it, before its cleanup hook runs"
    - "A timing overlap between two child processes is made deterministic by gating one on the other's end, never by a longer sleep"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-66-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-66-node-legs.json
  modified:
    - test/helpers/run-fixtures.ts
    - test/helpers/live-phase3-fixtures.ts
    - test/helpers/fake-run-host.ts
    - test/containment/live-run.test.ts
    - test/integration/live-phase3-case-design.test.ts
    - test/integration/run-independent-work.test.ts
    - test/integration/restricted-onboarding.test.ts
    - test/integration/resource-degradation.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/deferred-items.md

key-decisions:
  - "The quoted glob replaces the directory argument everywhere, as the plan binds; no file under src/ and not package.json (engines stays >=22.22.3) changed"
  - "The two load-dependent failures the legs surfaced were fixed in their test files (the plan's rule for fixture and timing bugs), and both legs were run again from the start each time"

patterns-established:
  - "Full-suite legs run from a script file in the background, one after the other, logs outside the repository"

requirements-completed: [OPS-6]

coverage:
  - id: D1
    description: "run-status.test.ts passes 27 of 27 on Node 22.22.3 and Node 26.9.0 (it failed 15 of 27 on Node 22.22.3 before)"
    requirement: OPS-6
    verification:
      - kind: unit
        ref: "node --test test/integration/run-status.test.ts on v22.22.3 (# pass 27, # fail 0) and v26.9.0 (pass 27, fail 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No fixture or direct spawn passes a directory to node --test; run-independent-work.test.ts snapshots its event count only after the count settles"
    requirement: OPS-6
    verification:
      - kind: unit
        ref: "node --test test/integration/live-phase3-case-design.test.ts test/integration/run-independent-work.test.ts test/unit/fake-run-host.test.ts test/unit/json-shapes.test.ts on both lines (77 of 77)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full suite exits 0 with 0 failed and 0 cancelled on Node 22.22.3 and Node 26.9.0 at one commit, and both legs are recorded"
    requirement: OPS-6
    verification:
      - kind: integration
        ref: "04-66-node-legs.json: node --test --test-reporter=tap, 5722 tests, 5645 pass, 0 fail, 0 cancelled, 77 skipped on each line, exit 0"
        status: pass
    human_judgment: false

duration: 137min
completed: 2026-11-25
status: complete
---

# Phase 4 Plan 66: The suite on the Node 22.22.3 floor Summary

**The run, supervisor and fault fixtures now use the quoted glob `node --test "test/**/*.test.ts"`, so the full suite exits 0 with 0 failed and 0 cancelled on Node 22.22.3 and on Node 26.9.0 (5722 tests each), recorded in 04-66-node-legs.json; two load-dependent races found by the legs were fixed in their test files.**

## Performance

- **Duration:** 137 min (most of it the full-suite legs, 24 to 27 min each)
- **Started:** 2026-11-25T06:31:35Z
- **Completed:** 2026-11-25T08:48:05Z
- **Tasks:** 3
- **Files modified:** 11 (9 test and planning files modified, 2 records created)

## Accomplishments

- G-04-4 closed. The root cause was the scratch repository's `npm test` script, `node --test test/`: Node 26 expands a directory to its default test pattern, Node 22 spawns the directory itself and fails with MODULE_NOT_FOUND, so the required check failed and every run ended `blocked_on_decision`. RED on Node 22.22.3: run-status.test.ts failed 15 of 27 (04-66-red-task1.json); GREEN: 27 of 27 on both lines.
- All other call sites fixed: the two package.json strings in live-phase3-fixtures.ts, the two scratch projects in test/containment/live-run.test.ts (not listed in the plan; the plan's own grep found them), the script `editPackageJson` writes in fake-run-host.ts (still with `--test-name-pattern=nothing`), the s21 spawn in live-phase3-case-design.test.ts (the pattern as one argv word, no shell) and the two assertions in that file that named the old script.
- run-independent-work.test.ts takes `eventsBefore` only after the event count is the same on two reads 250 ms apart (at most 20 reads, with a message if it never settles).
- Full suite, both lines, one commit (3a6c10c), run one after the other: 5722 tests, 1199 suites, 5645 pass, 0 fail, 0 cancelled, 77 skipped, 0 todo.

| Leg | Binary | Started (UTC) | Finished (UTC) | Duration | Exit |
| --- | --- | --- | --- | --- | --- |
| Node 22.22.3 | node-v22.22.3-darwin-arm64 (official build, SHASUMS256 verified in the UAT; fixed path present, no re-fetch needed) | 08:00:48 | 08:24:38 | 1,430,088 ms (23.8 min) | 0 |
| Node 26.9.0 | /opt/homebrew/bin/node | 08:24:38 | 08:47:35 | 1,376,880 ms (22.9 min) | 0 |

## Task Commits

1. **Task 1: tracer, the run fixture's test script** - `9fde92e` (fix; includes the RED record 04-66-red-task1.json)
2. **Task 2: the other call sites and the event-count race** - `e31fcdc` (fix)
3. **Task 3: the full suite on both lines, recorded** - `f38e4ee` (test; 04-66-node-legs.json). Two fixes made while getting the legs green: `8cc376b` (restricted-onboarding cleanup race) and `3a6c10c` (maxConcurrentChecks overlap)

**Plan metadata:** the docs commit that carries this SUMMARY.

The legs ran at commit 3a6c10c. The only later commit (f38e4ee) adds the legs record itself, so the recorded `commit` is the one the suites ran on.

## Files Created/Modified

- `test/helpers/run-fixtures.ts` - RUN_REPO_FILES test script is the quoted glob
- `test/helpers/live-phase3-fixtures.ts` - the same script in both scratch projects
- `test/helpers/fake-run-host.ts` - `editPackageJson` writes the glob form
- `test/containment/live-run.test.ts` - the same script in the two scratch projects (live-gated tests)
- `test/integration/live-phase3-case-design.test.ts` - spawn with the pattern as one argv word; assertions name the new script
- `test/integration/run-independent-work.test.ts` - settled event-count snapshot
- `test/integration/restricted-onboarding.test.ts` - last test passes `--wait`; the cleanup hook retries the removal
- `test/integration/resource-degradation.test.ts` - the two-at-a-time test gates c1 on c2's end
- `.planning/.../deferred-items.md` - the 04-58 ENOTEMPTY entry marked resolved
- `.planning/.../04-66-red-task1.json`, `04-66-node-legs.json` - the RED run and the two recorded legs

## Decisions Made

- The glob is used exactly as the plan bound it; `engines`, package.json and src/ are untouched (`git diff 7ee7c52..HEAD` shows tests, planning files only).
- Both flakes the legs found were treated as test-file timing bugs (the plan's rule) and fixed at the cause rather than by retrying the leg or widening a timeout: the cleanup race by making the test wait for the supervisor it starts, the overlap by making c1 wait for c2's end instead of sleeping longer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] restricted-onboarding.test.ts cleanup hook failed with ENOTEMPTY**
- **Found during:** Task 3, first Node 22.22.3 leg (5645 pass, 1 fail: the file-level `after` hook; exit 1)
- **Issue:** the last test started a run with `start` and no `--wait`, so the detached supervisor was still running when the `after` hook removed the scratch roots and recreated `config/profiles/...` and `data/state.db` in them. A first attempt (retries only, `maxRetries: 20`) still failed alone on Node 22, with a 42 s hook, which showed the supervisor outlived the retries and the cause was the missing wait, not load.
- **Fix:** `start(f, envOf(f), '--wait')` in that test, plus the retrying remove in the hook. The file passes 14 of 14 on both lines.
- **Files modified:** test/integration/restricted-onboarding.test.ts, deferred-items.md (the entry logged by 04-58 is now `resolved`)
- **Committed in:** 8cc376b

**2. [Rule 1 - Bug] resource-degradation.test.ts overlap assertion failed under load on Node 26.9.0**
- **Found during:** Task 3, second pair of legs (Node 22 leg passed, Node 26 leg 5644 pass, 1 fail)
- **Issue:** `with maxConcurrentChecks 2 two run at once ...` needs c2 to start while c1 (a 900 ms sleep) is still running; in four passes on the loaded machine c2's process started after c1 had ended (or ended after it). The file passes alone (30 of 30) on Node 26.9.0.
- **Fix:** the checks script takes an optional gate; in that test c1 waits (at most 20 s) for c2's end before it ends, so the overlap does not depend on process start speed. `peak(all) == 2` still proves the two ran together, and the one-at-a-time test is unchanged. The three tests pass on both lines alone.
- **Files modified:** test/integration/resource-degradation.test.ts
- **Committed in:** 3a6c10c

**3. [Rule 3 - Blocking] Two more call sites than the plan lists**
- **Found during:** Task 2 (the plan's own grep)
- **Issue:** test/containment/live-run.test.ts holds two scratch `package.json` strings with `node --test test/`, and live-phase3-case-design.test.ts asserts the old script text in two places.
- **Fix:** same glob in the two strings; the assertions now expect the glob script.
- **Committed in:** e31fcdc

---

**Total deviations:** 3 auto-fixed (2 bugs in tests, 1 blocking call-site gap)
**Impact on plan:** All within the plan's stated rule for fixture and timing bugs. Each fix required both legs to run again, which is why Task 3 ran three pairs of legs (the first two pairs are not recorded; the record is the third, at one commit). No scope creep, no src/ edit.

## Issues Encountered

- **Legs run three times.** Pair 1 (commit e31fcdc): Node 22 leg failed on the restricted-onboarding hook (the race logged in deferred-items.md by 04-58); the Node 26 leg was not run. Pair 2 (commit 8cc376b): Node 22 green, Node 26 failed on the maxConcurrentChecks overlap test. Pair 3 (commit 3a6c10c): both green. The failing logs were kept under /Users/aphan/.claude-edu/jobs/5be29488/tmp/logs/first and /second, outside the repository.
- **Load-dependent tests remain a class.** The legs show this machine's full-suite load can expose start-speed assumptions; WR-38 (doctor probe timeout) in deferred-items.md is the other known one and did not fail in the recorded legs.
- **Project-root pin guard.** The harness refuses the guard script's multi-command form in this worktree, so the pin was checked by hand: `git rev-parse --show-toplevel` equals the pinned root `/Users/aphan/avarice/.claude/worktrees/phase-04` and HEAD is on `worktree-phase-04`, before the first edit and before each commit.

## Known Stubs

None.

## Documentation surfaces

For plan 04-68:

- No docs/system statement about supported Node versions needs a change: docs/system/integrations.md (Node 22.22.3 or newer), config-reference.md (`>=22.22.3`, not compared at runtime) and findings.md (engines not enforced at runtime) remain true.
- The suite now has a recorded pass on the floor version. If docs/system/coverage.md records a whole-suite test count (5722 tests, 77 skipped at this commit, on both lines), compare it with this record.
- docs/operations-and-testing.md and ADR-001 are proposal documents and are not edited.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

G-04-4 is closed with a recorded run on Node 22.22.3 and Node 26.9.0. Ready for 04-67 and the documentation plan 04-68.

## Threat Flags

None.

## Self-Check: PASSED

- Files: 04-66-red-task1.json, 04-66-node-legs.json, and the eight modified test files exist and are committed.
- Commits 9fde92e, e31fcdc, 8cc376b, 3a6c10c, f38e4ee are ancestors of HEAD; `git rev-list --count 7ee7c52..HEAD` is 5 at the time of writing.
- 04-66-node-legs.json passes the plan's verify check; package.json engines still reads `>=22.22.3` and `git diff ed9e123..HEAD -- package.json` is empty; no file under src/ changed in this plan.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-25*
