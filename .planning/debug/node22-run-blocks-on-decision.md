---
status: diagnosed
trigger: "Gap G-04-4 (UAT test 4): test suite passes on Node 26.9.0 but fails on Node 22.22.3 (engines >=22.22.3): 207 fail / 45 cancelled of 5475; runs end blocked_on_decision instead of ready_for_review"
created: 2026-11-24T05:30:00Z
updated: 2026-11-24T06:45:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED (see Resolution.root_cause)
test: n/a
expecting: n/a
next_action: none; diagnose-only. The temporary edit to test/helpers/run-fixtures.ts was reverted (working-tree diff is empty). /gsd-plan-phase --gaps plans the fix.

## Symptoms

expected: full suite `node --test` passes on Node 22.22.3 (package.json engines >=22.22.3)
actual: 207 fail, 45 cancelled of 5475 on Node 22.22.3; run-status.test.ts fails 15/27 (passes 27/27 on Node 26.9.0). First failure at run-status.test.ts:93: `start --wait` ends `blocked_on_decision (decision)` exit 3, expected `ready_for_review` exit 0.
errors: "ExperimentalWarning: SQLite is an experimental feature" printed on 22 (node:sqlite)
reproduction: `/Users/aphan/.claude-edu/jobs/5be29488/tmp/node-v22.22.3-darwin-arm64/bin/node --test test/integration/run-status.test.ts`
started: discovered during UAT 2026-11-23 (only Node 26 leg was recorded in plan 04-34)

## Eliminated

- hypothesis: node:sqlite API difference between 22.22.3 and 26.9.0 (the "SQLite is an experimental feature" warning)
  evidence: the warning is stderr noise only (spawned children pass --disable-warning=ExperimentalWarning); the ledger opened, the run started, and the only decision opened is a failed required check. With only the fixture's test script changed, Node 22 reaches ready_for_review (repro2.ts).
  timestamp: 2026-11-24T05:55Z
- hypothesis: mixed-version artifact (a bare `node` from PATH picking Node 26)
  evidence: the opposite. src/app/checks.ts:135 prepends dirname(process.execPath) to the check sandbox PATH, so `node` and `npm` inside the check ARE Node 22; that is why the Node 22 `--test <dir>` behavior is hit. No other spawn of bare `node` exists in src/ or bin/ (all other spawns use process.execPath).
  timestamp: 2026-11-24T05:46Z
- hypothesis: .ts type-stripping, fs/glob, Intl, Array/Set method or process API gap in 22.22.3
  evidence: 5146 tests pass on 22.22.3 including every unit test; a run that is allowed to proceed (glob-form test script) completes end to end on 22; the 651/654 pass in the patched re-run of all 48 failing files leaves no room for a broad API gap.
  timestamp: 2026-11-24T06:40:00Z

## Evidence

- timestamp: 2026-11-24T05:35Z
  checked: `<node22> --test test/integration/run-status.test.ts` (reproduces 12 pass / 15 fail). First failure run-status.test.ts:93 prints `run ...: blocked_on_decision (decision)` exit 3.
  found: reproduced exactly as in UAT.
  implication: deterministic (Bohrbug), not flaky.
- timestamp: 2026-11-24T05:40Z
  checked: temp script /Users/aphan/.claude-edu/jobs/5be29488/tmp/dbg22/repro.ts (outside repo) rebuilds the run-status fixture on Node 22 and dumps `decisions` from state.db
  found: exactly one decision, class `repeated_failure`, urgency blocking, issue = "gate G2 failed: required checks blocking against the baseline: test (target-not-passed) | reproducer: test (npm test) exited 1, failing tests: test, output sha256:31248a0ef2e5". Only option: withdraw.
  implication: the run never reaches ready_for_review because the fixture's required check `test` (npm test) exits 1 AFTER the fix too. "failing tests: test" is a TAP parse of a failure literally named `test` (the directory), not a real assertion.
- timestamp: 2026-11-24T05:45Z
  checked: fixture scratch repo package.json (test/helpers/run-fixtures.ts:30): `"test": "node --test test/"`. Ran `node --test test/` in the scratch repo on both Nodes.
  found: Node 22.22.3: `# Error: Cannot find module '<repo>/test'` (MODULE_NOT_FOUND), TAP `not ok 1 - test`, exit 1. Node 26.9.0: runs test/slug.test.ts normally. Also on Node 22 `test`, `./test` fail the same way; `test/**/*.test.ts`, `test/slug.test.ts` and no-arg discovery work.
  implication: Node 22 `--test <directory>` is treated as a file path to run; Node 26 expands the directory to the test files under it.
- timestamp: 2026-11-24T05:46Z
  checked: src/app/checks.ts:135 sandboxSetup
  found: `const path = [dirname(process.execPath), process.env['PATH'] ?? '/usr/bin:/bin'].join(':')` is the check sandbox PATH. The running (Node 22) binary's dir is first, so the bare `node` in `npm test` is Node 22 (npm's own shebang `env node` also resolves to it).
  implication: the whole check ran on Node 22; this is not a mixed-version artifact. It also means any `node` invoked by a check in the sandbox follows the Node under test.
- timestamp: 2026-11-24T05:55Z
  checked: falsification run of the same fixture (temp script repro2.ts, scratch repo package.json overridden via makeRunRepo's `extra`, no repo edits). Node 22.22.3 with `node --test test/**/*.test.ts`; Node 26.9.0 with the original `node --test test/` (control).
  found: Node 22 + glob form: `start --wait` exit 0, `ready_for_review`, zero decisions. Node 26 + directory form: exit 0, `ready_for_review`.
  implication: with only the test-script argument changed, Node 22 reaches ready_for_review; the directory-form argument is necessary for the failure (hypothesis survives its falsification test).
- timestamp: 2026-11-24T06:00Z
  checked: Node internals, dumped with `process.binding('natives')` (script dbg22/natives.cjs) for both binaries: internal/test_runner/runner `createTestFileList`
  found: Node 22.22.3 passes user patterns straight to `new Glob(patterns)`, so `test/` is a match for the directory itself and is then spawned as a file (-> MODULE_NOT_FOUND). Node 26.9.0 has an added block (comment: "A directory argument is expanded to search for the default test files within it, matching the behavior from before glob patterns were supported") that stat()s each pattern and rewrites a directory to `<dir>/<kDefaultPattern>`.
  implication: direct source-level confirmation of the 22-vs-26 difference; it is a test-runner behavior change, not sqlite, fs/glob, Intl, or type stripping. The first Node release carrying the expansion was not determined (only 22.22.3 and 26.9.0 were available); whether 24.15.0 (also named supported in ADR-001) has it is unverified.
- timestamp: 2026-11-24T06:05Z
  checked: grep of every failing file's imports (48 files with a located not-ok in node22-test.log: 207 testCodeFailure + 45 cancelledByParent = 252, matching the summary)
  found: every one of the 48 files references the run fixtures (makeRunRepo / RUN_REPO_FILES / startWithFakeRunHost / run-fixtures / onboardRunRepo / fault-run / independent-work); sampled unit/json-shapes.test.ts:229 and unit/fake-run-host.test.ts:279 show the same `blocked_on_decision` vs `ready_for_review` / exit 3 vs 0 signature. test/integration/live-phase3-case-design.test.ts:368 spawns `process.execPath --test --test-reporter=tap test/` directly (second call site of the same directory-form argument).
  implication: single common cause is plausible for the bulk; confirmed or refuted by the patched 48-file run below.
- timestamp: 2026-11-24T06:40Z
  checked: re-ran ALL 48 failing files together on Node 22.22.3 with a TEMPORARY one-line edit of test/helpers/run-fixtures.ts:30 (`node --test test/` -> `node --test test/**/*.test.ts`); log dbg22/n22-48files-patched.log
  found: 654 tests, 651 pass, 3 fail, 0 cancelled (was 207 fail + 45 cancelled). The 3 remaining: (a) and (b) live-phase3-case-design.test.ts:380 and :390 fail with `failed = ['test']`: line 368 `spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/'])` is a second call site of the same directory-form argument (unpatched in this experiment); (c) run-independent-work.test.ts:312 `nothing was written: 109 !== 108` (an event count grew by one between two reads), which passed 13/13 when that file was rerun alone on Node 22 with the same edit (dbg22/riw-n22-isolated-1.log), and passed in the original unpatched Node 22 run.
  implication: the directory-form `node --test test/` is the cause of ~249 of 252 failing/cancelled entries; (a)(b) are the same cause at a second call site; (c) is a separate, probably load-dependent timing race (start --wait polls every 250 ms and returns when the run blocks while the detached supervisor is still delivering the banner; the test snapshots the event count right after), not shown to be Node-22-specific.
- timestamp: 2026-11-24T06:44Z
  checked: revert of the temporary edit
  found: `git status --short` shows no modified tracked file; the diff is 0 lines. Only untracked .planning files remain.
  implication: no code change left in the worktree.

## Resolution

root_cause: >
  A fixture bug exposed by a Node test-runner change, not a product bug. The scratch repository every run/supervisor/fault test builds
  (RUN_REPO_FILES in test/helpers/run-fixtures.ts:30; also live-phase3-fixtures.ts:44,114) declares its required check as
  `npm test` = `node --test test/`, a directory positional argument. Node 26.9.0's test runner expands a directory argument to
  `<dir>/<default test pattern>` (internal/test_runner/runner createTestFileList, with a comment "matching the behavior from before glob patterns
  were supported"); Node 22.22.3 has no such block, passes `test/` to Glob as a pattern, and spawns the directory itself as a test file, which dies
  with MODULE_NOT_FOUND ("Cannot find module '<repo>/test'") and a TAP failure literally named `test`. The check runner puts
  dirname(process.execPath) first on the sandbox PATH (src/app/checks.ts:135), so the `node` inside `npm test` is the Node under test. The required
  check `test` therefore exits 1 at the baseline and after the fix; gate G2 fails with `test (target-not-passed)`, a blocking `repeated_failure`
  decision is opened (only option: withdraw), and the run ends blocked_on_decision (exit 3) where ready_for_review (exit 0) is expected. A second call
  site of the same form, test/integration/live-phase3-case-design.test.ts:368, fails the same way.
  Secondary (separate, minor, unconfirmed as Node-specific): run-independent-work.test.ts:312 event-count race (1 test), seen once in a 12-way parallel
  re-run, passes alone on Node 22.
fix: (not applied, diagnose-only)
verification: >
  Falsification: same fixture on Node 22 with only the test script changed to a glob form -> ready_for_review, exit 0, no decision (repro2.ts); Node 26
  with the original form -> ready_for_review (control). Bulk: all 48 failing files re-run on Node 22 with the one-line fixture edit -> 651/654 pass,
  0 cancelled; the 3 failures are explained above. The edit was reverted afterwards (working-tree diff empty).
files_changed: []
