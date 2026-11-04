---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-04T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - docs/containment.md
  - src/adapters/git/repo-facts.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/hook-policy.ts
  - src/adapters/host-claude/settings.ts
  - src/app/invocation.ts
  - src/app/resume.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - test/fault/killpoints.test.ts
  - test/helpers/fake-agent-host.ts
  - test/helpers/fault-run.ts
  - test/integration/claude-host.test.ts
  - test/integration/hook.test.ts
  - test/integration/ignored-writes.test.ts
  - test/integration/resume-reap.test.ts
  - test/integration/staging-adapters.test.ts
  - test/mutation/fail-closed.test.ts
  - test/unit/claude-settings.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/invocation-scope.test.ts
  - test/unit/repo-facts.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-04
**Depth:** standard (incremental: gap-closure plans 01-21..01-24 since b4b112c)
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Prior findings:

- **CR-01 (intel and knowledge hosts not reaped on resume): resolved.** `reapStartedLaunches` (`src/app/resume.ts:51-81`) reaps every `launch:*` row left `started` before any stage runs, completes all reaps before marking any row, fails closed on a reap error, and leaves a `launch:map` row of a `mapping` or `paused` onboarding for `reconcileInvocation`. `reapBySessionId` is shared with the fake host, and the kill-point tests exercise it with a real surviving process and a decoy.
- **CR-03 (staging diff blind to gitignored files): resolved.** `--ignored=traditional` with `--untracked-files=all` (`staging-base.ts:115`) lists each ignored file as a `!` record. I confirmed this on git 2.39.5. `parseStatus` reads `!` as untracked, and `collectRepoFacts` still runs status without an ignored mode, so the user's checkout is unaffected.
- **CR-02 (read confinement was deny-list only): partly resolved.** The allow-list in `readRule`, the work-root `denyRead` and own-staging `allowRead` pair, and option-value and `--` operand parsing all work as designed for the cases they model. I probed `hook-decision.ts` directly, and recursive `grep` can still escape the new `shell-recursive-read` control. This is CR-01 below. WR-01 and WR-02 are related gaps in the same parser.

Residual risks already stated in `docs/containment.md` (`git show <rev>:<path>`, `git log -p`, host Grep-tool recursion) are not re-listed.

## Critical Issues

### CR-01: `grep -d RECURSE` and `--directories=Recurse` bypass the recursive-grep secret-glob check

**File:** `src/domain/hook-decision.ts:380-385`
**Issue:** `directoriesRecurse` compares the `-d` and `--directories` value with `=== 'recurse'`, which is case-sensitive and exact. Two real greps recurse on other spellings:

- macOS `/usr/bin/grep` (BSD 2.6.0-FreeBSD) matches the action case-insensitively. I ran `/usr/bin/grep -d RECURSE SECRETVAL .` and `--directories=Recurse`, and both recursed and printed `./sec.env`.
- GNU grep resolves `--directories` with `XARGMATCH`, which accepts an unambiguous abbreviation such as `rec`.

`recursive` then comes out false, `recursiveRule` returns `null`, and the only check left is the named-operand check. That check judges `.` or `src` as a directory root and never applies the secret globs below it. I ran the decision against a policy with the production secret globs (`**/.env`, `**/*.pem`, ...):

```
grep -d recurse PASSWORD .          -> deny  shell-recursive-read
grep -d RECURSE PASSWORD .          -> allow shell-identity
grep --directories=Recurse PASSWORD -> allow shell-identity
grep -dRECURSE PASSWORD src         -> allow shell-identity
```

The last three read every secret-bearing file under staging. The shell-side secret-glob guard is therefore defeated by changing the case of one word, on the platform's default grep. Operand confinement is unaffected, because `grep -d RECURSE x /home/u` is still denied as `outside-read-set`.
**Fix:** Fail closed. Treat any `-d` or `--directories` value that is not exactly `read` or `skip` (compared case-insensitively) as recursive:
```ts
const NON_RECURSIVE_ACTIONS = new Set(['read', 'skip']);
const isRecursiveAction = (value: string): boolean => !NON_RECURSIVE_ACTIONS.has(value.toLowerCase());
const directoriesRecurse =
  shortValues.some((v) => v.flag === 'd' && isRecursiveAction(v.value)) ||
  longNamed('--directories', 5).some((l) => isRecursiveAction(l.value ?? positional[0] ?? ''));
```
Add unit cases for `-d RECURSE`, `-dRecurse`, `--directories=Recurse`, `--dir=RECURSE`, `-d rec` and `--directories rec x .`.

## Warnings

### WR-01: A long option with a separate value shifts the grep pattern and hides the real walk root

**File:** `src/domain/hook-decision.ts:326-331, 390-394`
**Issue:** `parseReadArgs` treats `--name value` as a flag plus a positional word. `recursiveRule` then takes `positional.slice(1)` as the walked roots, assuming the first positional is the pattern. For `grep -r --exclude-dir x PATTERN` the positionals are `[x, PATTERN]`, so the walked list becomes `[PATTERN]`. `PATTERN` is not a directory, and the real walk root, the working directory (staging), is never judged. This applies to every grep long option that takes a separate value: `--include`, `--exclude`, `--exclude-dir`, `--max-count`, `--context`, `--after-context`, `--before-context`, `--label`, `--binary-files` and `--devices`. I confirmed it with a policy whose secret globs have no `**` (for example `.env`, `config/*.key`):
```
grep -r PASSWORD                      -> deny  shell-recursive-read
grep -r --exclude-dir x PASSWORD      -> allow shell-identity   (walks staging, reads .env)
grep -r --max-count 1 PASSWORD        -> allow shell-identity
grep -r --include "*.ts" PASSWORD     -> allow shell-identity
```
The current contract preset (`onboarding-contract.ts:124`) starts every glob with `**/`, and `globMayMatchBelow` returns true for any `**` segment. That masks the defect today. It becomes live when a non-`**` glob is added, and it is independent of CR-01.
**Fix:** In `recursiveRule`, always judge the working directory as a root when the operand list cannot be proven complete, instead of only when no operands remain. Better, give grep a table of long options that take a separate value and consume the next word for them:
```ts
const GREP_LONG_VALUE_OPTIONS = ['--include', '--exclude', '--exclude-dir', '--include-dir', '--max-count', '--context', '--after-context', '--before-context', '--label', '--binary-files', '--devices', '--directories', '--regexp', '--file', '--exclude-from'];
```
At minimum, push `cwd` onto `walked` whenever any long option appeared without an `=` value.

### WR-02: The recursive-grep detector models BSD and GNU grep, but Claude Code's Bash tool may run `grep` as embedded `ugrep`

**File:** `src/domain/hook-decision.ts:321-332, 380-385`
**Issue:** The Bash tool in this environment defines a shell function `grep` that execs the host binary as `ugrep` with `-G --ignore-files --hidden -I`. If the contained invocation's shell has the same shim, the parser's model of grep is wrong in ways that matter. Behavior I observed by running the host binary as ugrep in a scratch directory:

- `-5 PATTERN .` recurses to depth 5. The hook skips `-[0-9]+` arguments (line 332) and does not treat them as recursion.
- `-d dereference-recurse` is a valid ugrep action that follows links. It is not recognized, and neither is `-d recurse` once case folding is dropped.
- A bare `grep PATTERN .` with no `-r` searched the files directly inside `.`, and printed `sec.env`. The hook treats `.` as a plain operand and applies no secret glob to it.

I could not confirm that the contained invocation's shell snapshot carries this function. The integration tests use a fake `claude`, and `docs/containment.md` does not mention it. If it is active, the recursion and secret-glob control for `grep` is weaker than the tests assume.
**Fix:** Establish which `grep` the contained shell runs, for example by calling `grep --version` through the real host in the launch self-test, and record the result in `docs/containment.md`. The safer option is to remove `grep` from `READ_ONLY_COMMANDS` and rely on the Grep tool, whose root path the hook judges. If `grep` stays, treat any digit-only option, any `-d` or `--directories` value other than `read` or `skip`, and any directory operand as recursive, and judge directory operands against the secret globs.

### WR-03: `ScopeInput.workRoot` is optional, so omitting it silently drops the work-root deny

**File:** `src/domain/invocation-scope.ts:186, 237-242`
**Issue:** The new CON-1 control exists only when the caller passes `workRoot`. The comment says `prepareInvocation` "always passes it", but nothing enforces that. A future caller, or a refactor of `prepareInvocation`, that omits the field gets a scope with no work-root deny and no own-staging `allowRead`. The fallback shape is also fail-open for settings: `allowRead` is then omitted from the sandbox filesystem. The only consumer today is `src/app/invocation.ts:84`, so no current path is exposed. The optionality exists only so that unit tests can model "no profile".
**Fix:** Make `workRoot: string` required in `ScopeInput`, and have the unit helpers pass a dummy root where they want the old shape. If it stays optional, `computeInvocationScope` should return an error or throw rather than produce a weaker scope.

### WR-04: Integration assertion that the settings carry no containing Read deny is vacuous

**File:** `test/integration/claude-host.test.ts:231-235`
**Issue:** The predicate `staging.startsWith(rule.slice('Read(//'.length, -3))` can never be true. `rule.slice(7, -3)` of `Read(//Users/x/work/**)` is `Users/x/work/`, with no leading `/`, while `staging` is absolute (`/Users/x/work/onb/staging`). I confirmed that `startsWith` returns false. The `some(...)` is therefore always false, so `assert.equal(..., false)` passes even if the production code re-adds `Read(//<work root>/**)`. The unit test in `claude-settings.test.ts` pins the same property on a fixed fixture, so coverage is not zero. But the integration test claims to verify the production path and does not.
**Fix:** Compare with the leading slash restored, or parse the rule properly:
```ts
const containsStaging = (rule: string): boolean => {
  const m = /^Read\(\/(\/.*)\/\*\*\)$/.exec(rule);
  return m !== null && (staging === m[1] || staging.startsWith(`${m[1]}/`));
};
assert.equal(settings.permissions.deny.some(containsStaging), false, '...');
```

## Info

### IN-01: Every recursive grep is denied under the production secret globs, and the test rewrite hides it

**File:** `src/domain/hook-decision.ts:363-372`, `test/mutation/fail-closed.test.ts:221`
**Issue:** `globMayMatchBelow` returns true as soon as any glob segment contains `**`. All six preset secret globs start with `**/`, so `grep -r` is denied for every operand under staging, including a single file or `src`. `hook-decision.test.ts:270` asserts this for `grep -rn "a|b" src`. The MF-04 test was edited from `grep -rn ... src` to `grep -n ... src/a.ts` to keep it passing. The behavior is fail-closed and probably intended, but it is not stated in `docs/containment.md`. A mapper that tries `grep -r` burns tool calls on denials before it falls back to the Grep tool.
**Fix:** Document in the containment table that recursive shell `grep` over staging is always denied with the preset globs and the Grep tool is the supported route. Alternatively, refine the check: a `**/x` glob can match below a directory only if the directory actually contains a matching file, which the hook cannot list, so keep the deny but say so.

### IN-02: Resume marks a launch `interrupted` even when no reap happened

**File:** `src/app/resume.ts:29, 63-79`
**Issue:** `reapInterrupted` returns `ok` without reaping when `deps.host.reap` is undefined or the row has no `sessionId`. `reapStartedLaunches` then marks the row `interrupted` as though the host had been ended, and the stage relaunches. The comment says a host that cannot be ended stops the resume, but the capability-absent case is silently treated as success. The production `ClaudeHostAdapter` always implements `reap`, so this only affects other hosts and malformed rows.
**Fix:** Return an error for a `started` launch whose host cannot reap, or leave such a row `started` and record an `invocation.reap_skipped` warning event.

### IN-03: `SHORT_VALUE_OPTIONS` is exported but unused outside its module

**File:** `src/domain/hook-decision.ts:288`
**Issue:** The table is exported but only `parseReadArgs` in the same file reads it, and no test references it. `find` and `git rev-parse` have no entries, so they are parsed as taking no short values. That is safe, because every such word is still judged as a path, but the table's coverage claim is not tested.
**Fix:** Drop the `export`, or add a unit test that pins each entry's value letters.

---

_Reviewed: 2026-11-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
