---
phase: 02-contained-unattended-run-of-one-work-item
plan: 14
subsystem: run-kernel
tags: [checks, onb-10, validation, baseline, d-12, dependency-install, egress-proxy, test-inventory, aut-9, g2, g4, fake-run-host]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-06 allowlisting egress proxy and CommandSpec.allowLoopbackPorts (S2-C: npm ci works through the proxy), 02-11 run hook, 02-13 the vertical slice (stages, G2, G4, runRequiredChecks, fake run host), 02-05 baselineDelta, compareInventories, evaluateG2 and evaluateG4, 02-03 check_validations and insert-only evidence"
provides:
  - "src/app/check-validation.ts: validateChecks (ONB-10), CHECK_VERDICTS, blockingOf"
  - "src/app/checks.ts: runRequiredChecks with phase base|item|final and the preExisting flag, installDependencies, measureInventory, recordedBase, recordedInventory, preExistingAt, cachedVerdicts"
  - "contract_ready actions install-deps, validate-checks, baseline (run steps deps:install, checks:validate, baseline); stage loop treats a skipped step as done"
  - "RunWorkspace: prepareValidationClone, statusAll, listFiles; prepareClone takes a null branch"
  - "Evidence: kind test-inventory (artifact test-inventory), kind diff for `diff:<path> unchanged`, environment flag preExisting, label/phase in every check row's environment; event check.validated"
  - "Fake run host options deleteTest, addSkip, addTest, editPackageJson, addOverride; createDeps egress override (test entries only)"
affects: [02-15, 02-16, 02-17, 02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 100000
  tasks: 3
  commits: 3
plan_head_before: bc763f2150c19163489ce6777cdb6614a303725e
plan_head_after: 5e6a2dd4363cdb210bd18c74a47027095099535f
commits: 3

tech-stack:
  added: []
  patterns:
    - "A declared check is repository code: it is validated in a scratch clone (writes anywhere in the clone, empty-allowlist proxy) before it can become evidence, and a check without an `active` verdict is never run"
    - "The baseline is measured, not assumed: the required checks run once at the pin and the unit is judged against those rows; pre-existing is a flag on a failed row, never a status"
    - "The only network a run step has is one loopback port in front of a proxy admitting the registry hosts on 443, for the install; the agent invocation has no proxy variable and no network scope"
    - "The inventory is measured by AVARICE after the invocation has ended, and the list command runs only for a unit that already passes every other G2 rule"

key-files:
  created:
    - src/app/check-validation.ts
    - test/integration/check-validation.test.ts
    - test/integration/run-deps.test.ts
    - test/integration/run-gates.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-14-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-14-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-14-red-evidence-task3.json
  modified:
    - src/app/checks.ts
    - src/app/run-stages/prepare.ts
    - src/app/run-stages/item.ts
    - src/app/run-stages/finish.ts
    - src/app/run-stages/blocked.ts
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts
    - src/adapters/git/staging-clone.ts
    - src/cli/composition.ts
    - test/helpers/run-fixtures.ts
    - test/helpers/fake-run-host.ts
    - test/integration/run-baseline-workflow.test.ts
    - test/integration/run-supervisor.test.ts
    - .planning/WINDOWS.md

key-decisions:
  - "Verdicts are cached per project, pin, check name and the digest of that ONE check's spec (not of the whole checks list), so editing one check's argv in a later conventions commit re-validates only that check; `unavailable` is never cached because nothing is known"
  - "The baseline opens the run's first attempt (evidence names an attempt) and the unit adopts it while it has not started, so a run without a retry still has exactly one attempt; a retry opens another"
  - "G2 evaluates in stages: the other rules, then the inventory, then the required checks, so the repository's list command and checks run only for a unit that already passes everything before them"
  - "If the egress proxy cannot be started during validation (a process with no network cannot even listen on loopback, as in the offline S-12 wrapper) the check runs with no network at all and detection narrows to the sandbox's error text; nothing can leak"
  - "G2 holds the checks delta, so a brief that targets a check failing at the pin stops at G2 checks-delta (target-not-passed), not at G4 as the plan's behaviour line says (same finding as 02-13)"

patterns-established:
  - "Pre-existing failures are named in the ready_for_review transition event (`preExisting`) and flagged in the evidence row environment"
  - "`diff:<path> unchanged` is deterministic evidence derived from `diff <pin> HEAD`; any other diff rule has no evidence and never satisfies a criterion"

requirements-completed: [ONB-10, AUT-8, AUT-9, FR-5, CON-8]

coverage:
  - id: D1
    description: "A run whose untargeted check already fails at the pin reaches ready_for_review: both declared checks validated active, base evidence test failed and format failed, final evidence test passed and format failed with preExisting true, G4 passed, format named in the ready_for_review transition, one attempt for the run"
    requirement: "AUT-8"
    verification:
      - kind: integration
        ref: "test/integration/check-validation.test.ts#a run whose untargeted check already fails at the pin reaches ready_for_review (tracer, D-12, AUT-8) (7 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A brief that also targets the failing check blocks the run (target-not-passed in the checks delta)"
    requirement: "AUT-8"
    verification:
      - kind: integration
        ref: "test/integration/check-validation.test.ts#a brief that targets the check that fails at the pin blocks the run (D-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ONB-10 verdicts: active, rejected unexpected-write (adjacency dist-evil/x vs dist/**), rejected network by proxy and by error text, unavailable (sandbox-exec forced to /usr/bin/false, not cached), optional rejection leaves the run going, required rejection blocks before any launch or baseline, declared order, cache reuse and per-check re-validation"
    requirement: "ONB-10"
    verification:
      - kind: integration
        ref: "test/integration/check-validation.test.ts (Task 2 describes, 13 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A run-time check may write only its declared paths and the scratch directory; a write elsewhere fails under the sandbox (EPERM in the output artifact) and its evidence is failed"
    requirement: "CON-8"
    verification:
      - kind: integration
        ref: "test/integration/check-validation.test.ts#a run-time check may write only its declared paths and the scratch directory (CON-8)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The dependency install runs in the run clone before any invocation through the registry-only proxy, records lockfile digest, exit, duration and attempts by host, installs again in the validation clone, is skipped with reason no-dependencies, and a refused host, a failing install, a missing sandbox and a missing proxy each block with the stated reason and class; the unit invocation has no proxy variable and no network scope"
    requirement: "ONB-10"
    verification:
      - kind: integration
        ref: "test/integration/run-deps.test.ts (8 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The test inventory is measured by AVARICE at base and after the unit; G2 fails removed-test, new-skip-marker, scope-conformance on package.json and no-new-overrides; `test:<text>` is satisfied from the after-inventory with the test check passed; `diff:<path> unchanged` is a deterministic diff row"
    requirement: "AUT-9"
    verification:
      - kind: integration
        ref: "test/integration/run-gates.test.ts (10 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real repository (the portfolio: 12 required checks, format:check failing at the pin, caches under node_modules, npm ci against the real registry, a real vitest list command) has not been exercised: the fixtures are small scripts and a local registry"
    requirement: "ONB-10"
    verification:
      - kind: other
        ref: "plans 02-20 to 02-22 (live) and the exit plan's check that the list command works offline under the sandbox at the pin"
        status: unrun
    human_judgment: true
    rationale: "Whether the portfolio's real checks validate as active (declared writes complete, no network attempt) and whether `vitest list` works under the sandbox is observed only on the real repository; the plan's flagged assumption says the exit plan verifies it"

duration: about 85 min (including a network interruption that stopped the first attempt mid-Task 2)
completed: 2026-11-05
---

# Phase 2 Plan 14: The checks pipeline - validation, baseline, install and inventory Summary

**A run now validates every declared check in a scratch clone before trusting it (ONB-10), measures the baseline at the pin so a check that already fails is reported as pre-existing instead of blocking or hiding (D-12), installs dependencies through a registry-only proxy (D-11), and measures the test inventory itself so a unit cannot pass by deleting or skipping tests (AUT-9)**

## Performance

- **Duration:** about 85 min of wall time, including the network interruption (`ENOTFOUND`) that stopped the first executor after the Task 2 tests were written; the coordinator resumed it
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto)
- **Files:** 21 changed in the three commits (1902 insertions, 73 deletions; about 100 000 tokens by chars/4 over the diff, including tests)

## Accomplishments

- **Tracer (D-12, AUT-8).** With conventions `test` (fails at the pin: that is the bug) and `format` (a script that exits 1 and writes nothing) and a brief targeting `test`, `start --wait` reaches ready_for_review. Both checks are validated `active`; base evidence is test failed and format failed; final evidence is test passed and format failed with `preExisting: true`; G4 passes; the ready_for_review transition names `format`. With the brief also targeting `format` the run ends blocked (decision), with `format (target-not-passed)` in the checks delta. A second run on the same pin reuses both verdicts (`reused: 2`, no new row).
- **ONB-10.** `validateChecks` runs each check without a cached verdict, in declared order, in a detached validation clone at the pin with the dependencies installed. Unexpected writes are found by comparing `statusAll` (tracked, untracked and ignored, file by file) before and after, minus the check's declared `writes` globs (`dist-evil/x` is not under `dist/**`). Network is found by an empty-allowlist proxy (hosts it saw) and by the sandbox's error text (`ENOTFOUND|EAI_AGAIN|getaddrinfo|connect EPERM|ECONNREFUSED`). A required or targeted check that is not `active` blocks in `blocked_on_decision (decision)` with a permission decision before any launch or baseline; an optional rejection is recorded and left out. `runRequiredChecks` runs only `active` checks, so a check that never validated can never be evidence.
- **Baseline.** `baseline` runs the required and targeted checks at the pin in the run clone and stores them as evidence labelled `base`; G2 and G4 read them back with `recordedBase`. The two stubs of plan 02-13 (all-passed base in `gateUnit` and `verifyAndGate`) are replaced.
- **Install (D-11, T-02-47).** `install-deps` runs the declared install in the run clone: one loopback port, a proxy whose allowlist is the registry hosts on 443, writes only to `node_modules` and the scratch directory, install scripts off (`npm_config_ignore_scripts`), HOME and the npm cache in scratch. The step records the lockfile digest, exit, duration and each attempt by host. Failures: no sandbox or proxy is an `enforcement_failure`; a refused host is a decision (permission) naming it; any other failure a decision (repeated_failure).
- **Inventory (AUT-9).** `measureInventory` records the list command's IDs (up to 50 000), skip and focus markers per test file and the test file count as an artifact plus a `test-inventory` evidence row, at the pin and after the unit. G2 compares them (`removed-test`, `new-skip-marker`, `lowered-test-count`); a package.json edit (protected) fails `scope-conformance` and an override fails `no-new-overrides`. `test:<text>` is satisfied by an ID containing the text in the after-inventory when the test check passed at head; `diff:<path> unchanged` becomes a deterministic `diff` evidence row (passed when the unit left the path alone).

## Task Commits

1. **Task 1 (tracer): validate-checks and baseline** - `ec499c0` (feat)
2. **Task 2: dependency install through the proxy and the validation test matrix** - `d6c4fc3` (feat)
3. **Task 3: test inventory, `test:` and `diff:` mapping, G2 integrity cases** - `5e6a2dd` (feat)

`commits: 3`, measured as `git rev-list --count bc763f2150c19163489ce6777cdb6614a303725e..HEAD` before this summary commit.

RED evidence (`02-14-red-evidence-task{1,2,3}.json`): Task 1 8 tests, 0 pass, 8 fail against the plan base; Task 2 30 tests, 23 pass, 7 fail against the Task 1 commit (the 22 check-validation tests pass at base because the plan's Task 1 action already includes `validateChecks` in full, so those are recorded as pinning, not as RED); Task 3 10 tests, 3 pass, 7 fail against the Task 2 commit (two G2 rules already held from 02-13 and are pinned, and one negative case holds trivially).

Tracer gate (config absent, `end-of-phase`, automated-only verify): the verify commands were re-run after Task 1 (47 tests) and passed, so expansion continued.

## Files Created/Modified

See key-files. In one line each: `check-validation.ts` the ONB-10 verdicts; `checks.ts` the sandboxed checks, install and inventory; `prepare.ts` the three contract_ready actions; `item.ts` and `finish.ts` the baseline and inventory in G2 and G4; `run-workspace` the validation clone and `statusAll`/`listFiles`; the three test files the behaviour lines.

## Decisions Made

See key-decisions. Points to know downstream:

- **02-15 (status, inbox):** pre-existing failures are in the ready_for_review `run.transition` event (`preExisting`, comma-separated names) and in `environment_json.preExisting` of the final check rows. Validation verdicts are in `check_validations` and the `checks:validate` step; blocks from validation or install carry `data.gate` `checks:validate` or `deps:install`.
- **02-16 (CON-16 retry):** the first attempt is opened by the `baseline` action (reason `initial`) and adopted by the unit; the retry opens a second attempt in `attemptUnit`. After a discard, the retry's G2 reruns the inventory and checks against the same base rows.
- **02-17 (recovery):** a run killed in `contract_ready` repeats an action whose step is not `completed` or `skipped`; a repeated `baseline` adds duplicate base rows and the latest row per check counts; a repeated `install-deps` is idempotent apart from the proxy attempts. The initial attempt exists only from the `baseline` action on, so the install and validation blocks (which come before it) have no attempt to end; the `verify-enforcement` block, which comes after it, ends the open attempt itself.
- **02-18 (docs/containment.md):** list the registry allowance as a supervisor-step exception (`install-deps` and the install in the validation clone only), and state that network detection for a check that swallows the error and passes is detection-only (prevention is the sandbox).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistency] A target check failing at base and head stops at G2, not G4**
- **Found during:** Task 1
- **Issue:** the behaviour line says the brief that also targets `format` gives a G4 failure `checks-delta` naming format. G2 holds the checks delta (docs/contracts-and-state.md; the same finding as plan 02-13 deviation 1), so the unit stops at G2 before the commit and G4 is never reached.
- **Fix:** the test asserts G2 `checks-delta` with `format (target-not-passed)`, run blocked (decision), no commit. Stricter, not looser.
- **Files modified:** test/integration/check-validation.test.ts
- **Commit:** ec499c0

**2. [Rule 3 - Blocking] The evidence of a check needs an attempt, and the baseline runs before the unit's attempt exists**
- **Found during:** Task 1
- **Issue:** `evidence.attempt_id` is NOT NULL and a base row is recorded in `contract_ready`.
- **Fix:** `baseline` opens the first attempt and the running stage adopts it (see key-decisions), so existing tests that read the run's one attempt still hold. `verify-enforcement` ends the open attempt when it blocks.
- **Files modified:** src/app/run-stages/prepare.ts, src/app/run-stages/item.ts
- **Commit:** ec499c0

**3. [Rule 3 - Blocking] Files, ports and fixtures the plan's list did not name**
- **Issue:** the plan lists `src/ports/run-workspace.ts` for `prepareValidationClone` and `statusAll` only. Scanning test files by glob needs a file list (`listFiles`); a block before the run reaches `running` needs the clone on the run row (`blockRun` gained an optional `place`); the install test's registry is a local port the conventions cannot name (`createDeps` gained a test-only `egress` override); `staging-clone.ts` takes a null branch for the detached validation clone.
- **Files modified:** src/ports/run-workspace.ts, src/adapters/git/run-workspace.ts, src/adapters/git/staging-clone.ts, src/app/run-stages/blocked.ts, src/cli/composition.ts
- **Commit:** ec499c0, d6c4fc3

**4. [Rule 2 - Missing critical functionality] Validation without a proxy**
- **Found during:** Task 1 (the offline S-12 test)
- **Issue:** under the no-network test wrapper the process cannot listen on loopback, so the validation proxy cannot start and every run would block `unavailable`.
- **Fix:** when the proxy cannot start the check runs with no network at all (no loopback port), so nothing can leak; detection falls back to the sandbox error text. In normal runs the proxy is used.
- **Files modified:** src/app/check-validation.ts
- **Commit:** ec499c0

**5. [Rule 3 - Blocking] Existing tests assumed the old checkpoint order and counted every check row**
- **Issue:** `run-supervisor.test.ts` and `run-baseline-workflow.test.ts` listed the checkpoints without `install-deps`, `validate-checks`, `baseline`, and three assertions counted check rows including the new base rows.
- **Fix:** the expected lists include the three actions; the counts exclude rows labelled `base`. No assertion about the lease, fence, kill points or the detached supervisor changed.
- **Files modified:** test/integration/run-supervisor.test.ts, test/integration/run-baseline-workflow.test.ts
- **Commit:** ec499c0, d6c4fc3

**6. [Plan note] Per-check cache key, `unavailable` not cached, no per-check steps**
- The plan says verdicts are cached per "checks digest" and also that editing one check re-validates only that check; both hold only with a per-check digest, so that is the key. `unavailable` is not stored (the ledger refuses a second row for a key, and the next run must look again). Per-check order is recorded as `check.validated` events and in the `checks:validate` step's list rather than one run step per check.

**Total deviations:** 6 (1 plan inconsistency, 1 Rule 2, 3 Rule 3, 1 note). **Impact:** none on a plan truth; deviation 1 makes a target stop one gate earlier.

## Authentication Gates

None.

## Issues Encountered

- A network error (`ENOTFOUND`) stopped the first executor mid-Task 2. The coordinator resumed it; the on-disk files were checked and nothing was half-written.
- The harness refuses heredocs and compound git commands, so files were appended with the editing tools and the RED base was extracted with `git archive` in separate commands.
- Full suite after Task 3: 2051 tests, 2026 pass, 0 fail, 25 skipped (live and network cases). The load-sensitive `fail-closed` and `claude-host` timing tests did not fail.
- No live model was called, so nothing was added to the Phase 2 spend ledger; D-15 total unchanged at 1.2155 USD of 25.

## Known Stubs

None. The stub of plan 02-13 (empty inventory, all-passed base) is removed and its `.planning/WINDOWS.md` entry 3 is marked fixed. Unmeasured at base: when a declared list command fails at the pin the base inventory is recorded `unavailable` with no IDs, which can only make later comparison weaker for removed IDs (marker and file-count checks still apply); noted for the exit plan's offline `vitest list` check.

## Threat Flags

None beyond the plan's register. T-02-45: declared checks are validated in a scratch clone with diff and proxy observation and are inactive until `active`; run-time writePaths are declared writes only (tested, EPERM). T-02-46: the inventory is measured by AVARICE at base and after, and removed IDs, new markers, lowered counts and protected config fail G2 (tested). T-02-47: install scripts are off, the allowlist is the registry hosts on 443, credential directories are unreadable, attempts are recorded (tested with a refused host). T-02-48: the preExisting flag is on the failed row and in the hand-off event (tested). T-02-SC: AVARICE installed no package; the target's install runs only in run and validation clones.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 02-15 (inbox and status read the decisions and the preExisting list), 02-16 (retry notes above), 02-17 (recovery notes above).
- The portfolio's real checks, `npm ci` against the real registry and its list command are exercised only in the live plans; see coverage D7.

## Self-Check: PASSED

- FOUND: src/app/check-validation.ts, src/app/checks.ts, test/integration/check-validation.test.ts, test/integration/run-deps.test.ts, test/integration/run-gates.test.ts, 02-14-red-evidence-task1.json, 02-14-red-evidence-task2.json, 02-14-red-evidence-task3.json
- FOUND commits: ec499c0, d6c4fc3, 5e6a2dd (ancestors of HEAD, after bc763f2)
- Acceptance: `grep -c "check_validations\|recordCheckValidation" src/app/check-validation.ts` is at least 1 (the file calls `recordCheckValidation`); run-deps.test.ts asserts no proxy variable in the unit invocation's environment; run-gates.test.ts has one test per behaviour line and each asserts a rule name from the gate row
- Plan verification re-run after the last code commit: `npx tsc -p .` clean, `node scripts/check-boundaries.ts` ok (76 files), `node --test` of check-validation, run-gates, run-deps, run-baseline-workflow and allowlist-proxy: 77 pass, 0 fail; full suite 2051 tests, 0 fail
