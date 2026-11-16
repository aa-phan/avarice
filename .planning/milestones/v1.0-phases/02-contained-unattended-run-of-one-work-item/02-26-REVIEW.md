---
phase: 02-contained-unattended-run-of-one-work-item
plan: 02-26
reviewed: 2026-11-07T23:00:00Z
depth: standard
diff_range: f382d91..HEAD
files_reviewed: 5
files_reviewed_list:
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - test/helpers/scratch-repo.ts
  - test/integration/hook-git-secret-reads.test.ts
  - test/unit/hook-decision.test.ts
findings:
  critical: 1
  warning: 2
  info: 4
  total: 7
status: issues_found
---

# Plan 02-26 (CR-01 gap closure): Code Review Report

**Reviewed:** 2026-11-07
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The review covered the CR-01 changes: `checkGitObjects`, `GIT_OUTPUT_FORMS` and `checkGitOutput` in `src/domain/hook-decision.ts`, the `SHORT_VALUE_OPTIONS['git status']` change, the comment in `src/domain/invocation-scope.ts`, the `gitRun` helper, and the unit and integration tests. The plan's tests pass:

```
node --test test/unit/hook-decision.test.ts test/integration/hook-git-secret-reads.test.ts
# tests 203, pass 203, fail 0
```

The allow-list design is sound. The tested forms (`<rev>:<path>`, `:<path>`, `:N:<path>`, patch-producing `git log` options, `git status -v`, `git show` of a commit or a blob hash, pathspec magic, quoted wildcards, abbreviations, option order) are all refused. The check order in the code matches containment.md rules 12–13. The doc's check-order list matches the code too.

One remaining bypass makes the summary's claim "CR-01 is closed for the model's own tools and the admitted read-only commands" untrue for a realistic repository layout (CR-01 below). findings.md records it as "intent unknown". It is listed here as a blocker because the property this plan delivers depends on it and the fix is small. The two warnings are about tests that do not guard the property they report on, and about two option tables that have already drifted apart once (the `-u` defect fixed during this plan).

The reproductions below are code traces unless they say otherwise. The only commands I ran were the plan's own test suites.

## Critical Issues

### CR-01: The path in a git object name is matched against secret globs only after symlinks in the working copy are resolved, so a revision's secret blob can be printed

**File:** `src/domain/hook-decision.ts:510` (calls `readRule`, which matches globs on the canonical path at `src/domain/hook-decision.ts:237`)

**Issue:** `checkGitObjects` passes `absolutize(stagingPath, path)` to `checkRead`. `checkRead` canonicalizes the path through `canonicalAbsolute`, which replaces every existing component with its realpath, including the last one. `readRule` then matches the canonical path against `denyReadGlobs`. Git does not look at the working copy for `<rev>:<path>` or `:<path>`. It reads the blob stored under that name in the revision's tree or in the index. So when the working copy holds a symlink whose name matches a secret glob and whose target does not (for example `.env -> config/dev.env`; `dev.env` matches neither `**/.env` nor `**/.env.*` in the default `secretGlobs` at `src/domain/onboarding-contract.ts:124`), the hook judges `git show <older-rev>:.env` as a read of `config/dev.env` and allows it. Git then prints the `.env` blob from that revision, which may be a real secret file committed before it was replaced with a symlink. For `cat` this resolution is correct, because `cat` reads the link target. For an object name it is not, because the content comes from history, keyed by name.

The same applies to any directory-anchored secret glob when a directory in the path is a symlink in the working copy (findings.md line 182).

**Reproduction (traced, not executed):** a scratch repository with a commit that tracks a regular `.env` holding a sentinel, then a later commit that replaces `.env` with a symlink to `config/dev.env`. With the default secret globs, `decideToolCall({kind:'shell', command:'git show HEAD~1:.env', ...}, policy, canonicalAbsolute)` reaches `readRule` with the canonical path `<staging>/config/dev.env`, which no glob matches, and returns `allow`/`shell-identity`. `git show HEAD~1:.env` prints the sentinel.

**Fix:** for an object name, also match the lexically normalized, repository-relative path part against the secret globs, without filesystem resolution. Keep the existing canonical check for the allow-list and deny-read roots:

```ts
// in checkGitObjects, before the existing checkRead call
const lexical = normalizeLexically(path); // collapse '.', apply '..' on the string; refuse if it climbs above the root
if (lexical === null || matchesAny(lexical, policy.denyReadGlobs)) return 'deny-secret-read';
```

Add a unit test with an injected `canon` that maps `<staging>/.env` to a non-secret target. Add an integration case on a scratch repository whose history holds a real `.env` and whose working copy holds the symlink. Then update findings.md line 182 and the Limits/Quirks text in containment.md.

## Warnings

### WR-01: Some integration tests only record whether git printed the secret, so they cannot fail when it does

**File:** `test/integration/hook-git-secret-reads.test.ts:160-177` (also `:143-158`, `:180-189`)

**Issue:** `git show :sub` is allowed by the hook (diagnostic output: `git show :sub printed the sentinel of sub/.env: no; hook: allow shell-identity`). The test only reports git's behaviour through `t.diagnostic`. If another git version, or a configuration, makes the index form of a directory print a patch or blob content for the files below it, the suite stays green while the hook keeps allowing it. The "refused forms, git output reported" block asserts the hook's decision but not git's output. That is acceptable there, because those forms are denied. The `:sub` case is an allowed form, so it is the one that matters. The `.ENV` case asserts only when git happens to print the sentinel. That is correct, but it depends on the volume (case-sensitive or not) and the platform the suite runs on.

**Fix:** move `git show :sub` into the `admitted` list, where the absence of the sentinel is asserted. If its behaviour depends on the git version, have the hook refuse an index form that names a directory instead.

### WR-02: Two separate tables describe git's short-option grammar and disagree; a word the first table consumes as a value skips the object-name check

**File:** `src/domain/hook-decision.ts:339-347` (`SHORT_VALUE_OPTIONS`) and `src/domain/hook-decision.ts:533-558` (`GIT_OUTPUT_FORMS`); consumer at `src/domain/hook-decision.ts:628-634`

**Issue:** `parseReadArgs` uses `SHORT_VALUE_OPTIONS` to decide which following word is an option value. Only `parsed.positional` reaches `checkGitObjects`, so a word taken as a value is read-checked as a plain path but never parsed as `<rev>:<path>`. `checkGitOutput` uses a different table. The two disagree:
- `git status`: `SHORT_VALUE_OPTIONS` lists `M`. Git's `-M` (`--find-renames[=<n>]`) takes its value only attached, exactly like `-u`. The next word is an operand to git but a value to the hook. This is the same defect class as the `-u` bug fixed in this plan (deviations 1 and 2).
- `git log`: `nSGOLUMCBl` against `shortValued: 'n'`.
- `git show`: `nSGOLUMCBl` against no option at all.

Today the gap closes only because `checkGitOutput` refuses every letter except `n`. A future change that admits `-M` for `git status`, or `-C` or `-B` for `git log` (they are harmless rename-detection options, so someone is likely to add them), would reopen the bypass silently. No test pins the two tables to each other.

**Fix:** derive the value letters of the three git entries from `GIT_OUTPUT_FORMS` (`shortValued` takes the next word; `shortAttached` takes only the rest of the cluster), and drop the git rows from `SHORT_VALUE_OPTIONS`. Alternatively, have `checkGitObjects` judge every word that `checkGitOutput` treats as an operand. At minimum, remove `M` from `'git status'`, remove the `'git show'` row, and add a unit test asserting that every value letter in `SHORT_VALUE_OPTIONS['git …']` is either refused by `GIT_OUTPUT_FORMS` or listed in its `shortValued`.

## Info

### IN-01: Object paths are resolved from `stagingPath`, which assumes the top of the git working copy is the staging root

**File:** `src/domain/hook-decision.ts:509-510`

**Issue:** git resolves `<rev>:<path>` from the top of the repository that contains the shell's directory. If that directory is inside a nested repository under staging (a vendored repository with its own `.git`), git resolves from the nested top. The hook checks the path from staging and from the shell's directory, not from the nested top. Basename globs (`**/.env`) still match. A directory-anchored contract glob (`vendor/lib/secrets/**`) does not, when the shell's directory is below the nested top. The likelihood is low, because the model cannot change its directory with admitted commands.

**Fix:** document the assumption in rule 12, or refuse object names when the shell's directory is not the staging root.

### IN-02: Legitimate read-only git use that the hook refuses

**File:** `src/domain/hook-decision.ts:579-583`, `:543`, `:554`

**Issue:** long options with their value in the next word (`git log --max-count 5`, `--author name`, `--since 2.weeks`, `--grep fix`) are refused `shell-git-output`, as are a bare `git status --find-renames` and `git log --stat -M`. Option values such as `--grep=.env` are also judged as paths (rule 11) and refused `deny-secret-read`. All of these fail closed, so this is usability only. The model's corrective message does not say to use the `=value` form.

**Fix:** if the refusal stays, add a `reason` to `shell-git-output` denials (for example "use --name=value; the admitted options are …"), so the model does not keep retrying until it hits the loop limit.

### IN-03: `git rev-parse` and `git ls-files` are outside the output-form allow-list

**File:** `src/domain/hook-decision.ts:533-558`

**Issue:** the allow-list approach (prompted by git accepting abbreviated options) covers only `git log`, `git status` and `git show`. `git rev-parse` and `git ls-files` still accept any option apart from `GIT_DENIED_OPTIONS`. I know of no option of either that prints blob content today, but the design argument for an allow-list applies to them equally.

**Fix:** add `GIT_OUTPUT_FORMS` entries for both, at least for the options the GSD agents use, or record the reason for leaving them out next to the table.

### IN-04: Integration test setup runs when the test file is loaded, and the corpus helper cannot express quoted words

**File:** `test/integration/hook-git-secret-reads.test.ts:66-69`, `:76`, `:92`, `:114`, `:143`, `:161`, `:180`

**Issue:** `rig()` runs inside each `describe` body, so six scratch repositories and fixtures are created while the tests are being collected, even when a name filter selects none of them. If one `rig()` throws, collection of the whole file fails. `gitOutput` splits on single spaces, so any future corpus line with a quoted word runs different argv under git than the hook judged. The round-6 block works around this with a hand-written `gitRun` call.

**Fix:** create the repositories in `before` hooks. Have `gitOutput` reuse the hook's lexer, or take an argv array, so the words git runs are the words the hook judged.

---

_Reviewed: 2026-11-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
