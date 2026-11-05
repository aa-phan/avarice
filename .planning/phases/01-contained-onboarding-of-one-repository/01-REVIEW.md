---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-05T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - docs/containment.md
  - scripts/assert-exit.ts
  - scripts/exit-run.sh
  - src/adapters/exec/sandboxed-executor.ts
  - src/app/invocation.ts
  - src/app/stages/index-knowledge.ts
  - src/cli/args.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - src/domain/knowledge-extraction.ts
  - src/domain/normalized-root.ts
  - test/fault/budgets.test.ts
  - test/integration/knowledge-pass.test.ts
  - test/mutation/fail-closed.test.ts
  - test/unit/checkout-digest.test.ts
  - test/unit/cli-args.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/normalized-root.test.ts
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-05
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Incremental review of `git diff a9a8f0c..HEAD`. These are the fixes for IN-01 to IN-06 and for WR-05 to WR-08. I read each change against the code that calls it and the code it calls. I found no critical defects, one warning and five minor items.

Checked and found correct:

- **IN-04 (narrowed catches).** `RootRefusedError` is thrown only from `normalizedAbsoluteRoot`. `prepareInvocation` computes the scope before `reserveInvocation`, so a rethrown defect leaves nothing reserved. The `dataRoot: undefined` test throws inside the `try`, because `dataRoot` is first used at the `computeInvocationScope` call. It therefore exercises the rethrow branch. The stage-level test does the same through a non-object manifest entry, which makes the planner's sort throw.
- **IN-02 (shared root check).** The helper keeps the old behaviour and each caller keeps its own label. The unit test pins both messages.
- **WR-05 (null-prototype flags).** No code in `src` or `test` iterates `flags` with prototype methods, uses `in`, or deep-equals it against a plain object. Assignment of `__proto__` on a null-prototype object creates an ordinary own key.
- **WR-06 (`gsd_run` argument checks).** The lexer strips quotes before `checkSegment`, so `"--cwd"` cannot get past the option allow-list. Only the longest matching verb is used. `--budget --cwd`, a missing value, `--x=y` and `--` are all refused. Expanding words are refused. The `VAR=$(gsd_run ...)` assignment form reaches the same checks. I found no bypass.
- **IN-05 (document node count gate).** The invariant `documentNodes >= documentsExpected - unread` holds in `graph-merge.ts` and `documentCoverage`, as long as manifest source paths are unique (see IN-04 below).
- **WR-08 (spend authorization).** NaN, infinity, negative and non-numeric spent, expected and cap values are now refused, and the tests cover each.

## Warnings

### WR-01: The sandbox probe retry blocks the event loop for up to 20 s on every call, and a failed probe is never cached

**File:** `src/adapters/exec/sandboxed-executor.ts:107-123` (callers at lines 140 and 149)
**Issue:** `probe` uses `spawnSync` with timeouts of 5 s and then 15 s. When both attempts end in a timeout, a signal or a spawn error, the result is `false` and is not cached. That is deliberate (WR-07). But `descriptor` and every `run()` call re-enter the probe. With a persistently hung or erroring launcher, each call blocks the whole process for up to 20 s.
- `run()` is asynchronous and each command has its own timeout and kill timers. A synchronous stall delays those timers for every command running at the same time. Wall-clock enforcement then slips by up to 20 s per refused call.
- The spawn-error case (for example `ENOENT` or `EACCES` on the launcher path) cannot succeed on a retry, yet it is retried and never cached.
- `descriptor` can report `enforcement: none` for one read and `enforced` for the next within one onboarding, so the recorded capability depends on timing.

**Fix:** Cache a spawn error (`ran.error` with code `ENOENT` or `EACCES`) as a verdict. For a timeout or signal, remember the failure time and answer `false` without spawning again for a short window, for example 30 s. Alternatively, run the probe asynchronously. Add a test that a second call inside that window does not respawn the launcher.

## Info

### IN-01: `exit-run.sh` still defaults a missing or falsy `spentUsdSoFar` to 0 and accepts loosely coerced values

**File:** `scripts/exit-run.sh:85-88`
**Issue:** `Number(a.spentUsdSoFar || 0)` treats an absent, `null`, `false` or `""` field as nothing spent. It does not distinguish "nothing spent" from "not recorded". `Number()` also accepts `true` (1), `[]` (0), `["3"]` (3) and `"  "` (0). For a guard whose purpose is to stop overspend, the remaining coercion is looser than the WR-08 message suggests. `capUsd` is coerced the same way. Separately, `EXIT_RUN_EXPECTED_USD=0` becomes 12 through `|| 12`. That fails conservative, but the `expected >= 0` check can never see a 0.
**Fix:** Require `typeof a.capUsd === 'number'` and `typeof a.spentUsdSoFar === 'number'`, with `spentUsdSoFar` mandatory. Use `process.env.EXIT_RUN_EXPECTED_USD ?? '12'` so that an explicit 0 and an empty string are judged rather than defaulted.

### IN-02: `intel patch-meta` with no operand passes the write check vacuously

**File:** `src/domain/hook-decision.ts:312-315`
**Issue:** `checkWrite([])` returns `null`, so `gsd_run intel patch-meta` with no file is admitted. GSD may default the target or fail. Whichever it does, the hook has not judged the file that will be written. The WR-06 intent is that a write verb names a file inside the write set.
**Fix:** For a verb in `GSD_WRITE_OPERAND_VERBS`, return `shell-gsd-option` (or a new rule) when `operands.length === 0`, and add a test case.

### IN-03: The per-verb tables in `hook-decision.ts` are keyed by strings that duplicate the verb list in `invocation-scope.ts`

**File:** `src/domain/hook-decision.ts:272-277` and `src/domain/invocation-scope.ts:117`
**Issue:** `GSD_VALUE_OPTIONS` and `GSD_WRITE_OPERAND_VERBS` name verbs as strings, separately from `GSD_BASE_VERBS` and `GSD_INTEL_VERBS`. A verb added to the read list later gets, silently, `--raw` as its only option and no write check. That is the safe direction for options but not for a verb that writes its operand. No test ties the tables to the list.
**Fix:** Add a unit test that every key of `GSD_VALUE_OPTIONS` and every entry of `GSD_WRITE_OPERAND_VERBS` is a member of `GSD_READ_VERBS`, so a rename or removal fails loudly. Better, declare the per-verb option and write metadata beside the verb list.

### IN-04: The IN-05 node-count gate assumes unique manifest paths, but `documentsExpected` counts entries

**File:** `scripts/assert-exit.ts:140-147`, with `src/domain/knowledge-validation.ts:71-78`
**Issue:** `documentCoverage` reports `expected: manifest.entries.length`, but it computes `unread` over the de-duplicated source paths. The code de-duplicates defensively. If a manifest ever held a repeated `sourcePath`, `documentsExpected - unread` would exceed the number of distinct covered documents, and the new `documentNodes < covered` check would fail a coherent record. I did not find a path that produces duplicates today.
**Fix:** Report `expected` as the number of distinct paths in `documentCoverage`, or state in the comment that manifest paths are unique and assert it where the manifest is built.

### IN-05: The WR-07 probe-timeout tests assume a stub shell script starts within 200 ms

**File:** `test/mutation/fail-closed.test.ts:314-323`
**Issue:** The "does not cache a probe that timed out twice" test, whose final probe uses `probeTimeoutsMs: [200, 400]`, asserts exactly 3 launcher runs. The stub runs `dirname`, `cat` and `echo` before `exit 0`. On a loaded machine the 200 ms attempt can time out, the retry makes the count 4, and the test fails with no code defect behind it. The first test has the same shape, with the first attempt at 300 ms intended to time out.
**Fix:** Count the retry and the clean answer separately. For example, assert `count >= 3` together with the `enforced` outcome, or give the final successful probe a generous timeout through a second executor instance.

---

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
