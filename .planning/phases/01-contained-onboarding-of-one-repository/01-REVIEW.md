---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-04T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - docs/containment.md
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - test/containment/failclosed.test.ts
  - test/integration/claude-host.test.ts
  - test/integration/hook.test.ts
  - test/mutation/fail-closed.test.ts
  - test/mutation/scope-and-validation.test.ts
  - test/unit/claude-settings.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/invocation-scope.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-04
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This is an incremental review of the changes since d8a6f0c: quick tasks 261104-jnc and 261104-l3t, which close gap P-3. They drop `grep` from `READ_ONLY_COMMANDS`, delete the grep option model (`recursiveRule`, `globMayMatchBelow`, the `flags`, `shortValues` and `longs` fields of `ReadArgs`), deny bfs's `find -rm`, and make `ScopeInput.workRoot` required.

I traced every shell path through `checkSegment` after the change.

- **Grep denial.** Every spelling reaches `entry === undefined` and returns `shell-not-allowed` before any option is parsed. That covers `grep`, a quoted `"grep"` (the lexer strips quotes), `/usr/bin/grep`, `egrep`, `fgrep`, `rg`, `ugrep`, `git grep`, and grep after a pipe. A backslash-prefixed `\grep` is refused earlier by the lexer as `shell-syntax`. Nothing admitted afterwards recurses and reads file content. `ls`, `find`, `wc`, `head`, `tail` and `cat` do not, and `git log -p` and `git show` stay documented bypasses. Removing the recursion rules therefore does not open a new read path.
- **bfs find.** I ran the host `find` (bfs) here. It rejects `--print`, so the `--` spelling of an action is not a bypass. The `-files0-from` form is refused because the `-` is not alphanumeric (`shell-option-value`), and `find -f PATH` is judged as a positional. `-rm` is the only bfs action missing from the old list.
- **Verification.** `npm run typecheck` passes and the unit, integration, mutation and containment suites pass (1171 pass, 0 fail, 22 skipped).

No blocker was found. The findings below are one correctness-adjacent gap in the work-root change, one test-guard weakness, and maintainability items left behind by the deletion.

## Warnings

### WR-01: `workRoot` is required by type only; an empty or relative value silently produces a policy that denies everything

**File:** `src/domain/invocation-scope.ts:188-190, 241-243`
**Issue:** Making `workRoot` a required `string` closes the "caller forgot it" hole. It does not close "caller passed a useless value". `trimTrailingSlashes('')` returns `''`, which goes into `denyRead`. In the hook, `under(path, '')` evaluates `path.startsWith('/')`, so every absolute path is under the root `''`. `readRule` then returns `deny-read` for anything not under `allowRead`. That includes `readRoots` (the gsd-core and agents directories), which do not appear in `allowRead`. The sandbox `denyRead` gets an empty-string entry as well.

The failure direction is closed, so this is not a leak. But the effect is an invocation that cannot read its own skills or GSD directory, and the cause (an empty work root) is nowhere in the denial output. Before this change the optional field made the same mistake a no-op. The only guard is upstream, in `root-rules.ts` at `avarice init`. `computeInvocationScope` is a pure domain function that also takes `repoPath`, `dataRoot` and `home` unvalidated, but those did not become new silent-outage vectors in this change.
**Fix:** Assert the invariant where the type now promises it:
```ts
if (!input.workRoot.startsWith('/')) throw new Error('computeInvocationScope: workRoot must be an absolute path');
```
Alternatively, return a `Result`, as the other domain validators do. Add a unit test for `''` and for a relative path.

### WR-02: The WR-03 type guard is not exercised by `npm test`

**File:** `test/unit/invocation-scope.test.ts:309-313`
**Issue:** The test "cannot be called without a work root" is an `@ts-expect-error` over a literal that is never run. `npm test` is `node --test`, which strips types and never invokes `tsc`. Under `node --test` the test body is a no-op that always passes. Its protection exists only if `npm run typecheck` runs in CI or a pre-commit hook. Nothing in `package.json` chains the two. If `workRoot` became optional again, the suite would stay green and only `typecheck` would notice. The test's name and its docs claim ("WR-03", "the type rejects") overstate what `node --test` verifies.
**Fix:** Either chain the check (`"test": "tsc -p . && node --test"`) or add a runtime assertion next to the type one, for example `assert.throws(() => computeInvocationScope({ ...input, workRoot: undefined as never }))`. That second option only works together with the fix in WR-01. State in the test comment that it is checked by `npm run typecheck`.

## Info

### IN-01: Stale comment cites an option form that no longer has a value-taking owner

**File:** `src/domain/hook-decision.ts:361-362`
**Issue:** The comment says "A word like `-f/home/u/.netrc` ... is judged as a path". That was grep's `-f`. No remaining `SHORT_VALUE_OPTIONS` entry has `f` (`git ls-files` has `xX`). Today `-f/home/u/.netrc` is refused earlier as `shell-option-value` because `/` is not alphanumeric. It is never judged as a path. The comment also cites a case the tests no longer exercise.
**Fix:** Use a live example, such as `-O/home/u/.netrc` for `git log` or `-n/path` for `head`. This is the same example the updated test at `test/unit/hook-decision.test.ts:374` uses.

### IN-02: Redundant local and an unused export left behind by the deletion

**File:** `src/domain/hook-decision.ts:288, 366-367`
**Issue:** `const named = checkRead(...); return named;` is a pointless temporary now that the `recursiveRule` branch is gone. `SHORT_VALUE_OPTIONS` is `export`ed but is referenced only inside `hook-decision.ts`. No test or other module imports it, and the grep shows no other consumer.
**Fix:** `return checkRead(...)`. Drop `export` unless a test is meant to pin the table.

### IN-03: Misindented line, and the doc cites a test that does not cover the claim

**File:** `test/integration/hook.test.ts:442`, `docs/containment.md` (CON-1 row, last column)
**Issue:** `workRoot: join(fx.dir, 'work'),` is indented two spaces short of its sibling properties in the `writeHookPolicy carries the concurrency limit` block. The CON-1 "Bypass and failure tests" cell lists `test/unit/claude-settings.test.ts` together with `test/unit/invocation-scope.test.ts` for "no grep-family entry in the read-only commands". `claude-settings.test.ts` contains no mention of grep. The assertion lives in `invocation-scope.test.ts` and `claude-host.test.ts` (`!policy.commands.readOnly.includes('grep')`).
**Fix:** Re-indent the line. In the doc, attribute the "no grep-family entry" assertion to `invocation-scope.test.ts` and `claude-host.test.ts` only.

### IN-04: The agent gets no hint that shell grep is gone

**File:** `src/domain/invocation-scope.ts:67-69`
**Issue:** Shell `grep` is now denied by name with the generic rule `shell-not-allowed`. The comment says "Searches go through the Grep tool", but nothing the agent sees says so. A mapper or intel agent trained to run `grep` through Bash will retry and spend tool calls before it switches tools. Denials are not charged to a budget, but the agent still pays context and turns for each one. This is a usability and robustness concern, not a containment one.
**Fix:** If the invocation prompt or the hook's deny reason can carry text, add one line, for example "shell grep is not available; use the Grep tool". If not, record it in the containment doc as a known operational consequence.

---

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
