---
phase: quick-261104-l3t
plan: 01
subsystem: containment / PreToolUse hook
tags: [containment, hook, grep, bfs, WR-02, P-3, CON-1, CON-2]
status: complete
requires: [261104-jnc]
provides:
  - "Shell grep denied shell-not-allowed in every spelling and binary (WR-02, P-3)"
  - "find -rm denied shell-find-action (CON-2)"
affects: [src/domain/hook-decision.ts, src/domain/invocation-scope.ts, docs/containment.md]
key-files:
  modified:
    - src/domain/invocation-scope.ts
    - src/domain/hook-decision.ts
    - test/unit/hook-decision.test.ts
    - test/unit/invocation-scope.test.ts
    - test/mutation/fail-closed.test.ts
    - test/integration/hook.test.ts
    - test/integration/claude-host.test.ts
    - docs/containment.md
decisions:
  - "Option (b): drop grep from READ_ONLY_COMMANDS instead of establishing which grep the contained shell runs"
  - "Delete the grep option model (LONG_VALUE_OPTIONS, grep short options, recursiveRule, globMayMatchBelow) rather than leave it dormant"
  - "Add -rm to FIND_DENIED_ACTIONS (bfs alias of -delete)"
actuals:
  tokens: 40000
  tasks: 3
  commits: 5
plan_head_before: 3c059077b41e3955989c3de64ee14079229d0024
plan_head_after: 07e6a34644938e4e51d9f7382c01e6967365bb9f
---

# Phase quick-261104-l3t Plan 01: Resolve WR-02 by dropping shell grep Summary

Shell `grep` is removed from READ_ONLY_COMMANDS, so `checkSegment` returns `shell-not-allowed` for every grep spelling before any option is parsed. The verdict no longer depends on which binary the Bash tool's `grep` function would run. The now-unreachable grep option model is deleted from hook-decision.ts, bfs's `find -rm` is refused, and the CON-1 row states what remains.

## Commits (5, measured from the ledger)

| Hash | Message |
|------|---------|
| 2882541 | test(261104-l3t): failing tests for shell grep denied by name (WR-02) |
| 99dd4fb | fix(261104-l3t): drop grep from the read-only commands so shell grep is denied by name (WR-02, P-3) |
| e695710 | test(261104-l3t): failing tests for the bfs -rm find action |
| bce30bb | refactor(261104-l3t): remove the grep option model the hook can no longer reach; deny bfs -rm (WR-02, CON-2) |
| 07e6a34 | docs(261104-l3t): CON-1 states shell grep is denied by name; command row names the bfs and ugrep shims (WR-02) |

The RED run for Task 1 showed 31 of 230 tests failing (the new grep and READ_ONLY_COMMANDS cases). The GREEN commit brought all 230 to pass. The RED run for Task 2 showed the `-rm` cases and the FIND_DENIED_ACTIONS list failing, and GREEN fixed them.

## Verification results

- `npx tsc -p .`: exit 0.
- `node scripts/check-boundaries.ts`: `check-boundaries: ok (53 file(s))`.
- `git diff --quiet 974d8b1 -- package.json package-lock.json src/adapters/host-claude/settings.ts`: exit 0 (no diff).
- Full suite (`npm test`): tests 1270, suites 266, **pass 1248, fail 0, cancelled 0, skipped 22, todo 0**. The plan's baseline was 1240 passing; the count moved because the recursive-grep tests were deleted and the generated WR-02 cases were added. Skipped is 22, the plan's ceiling.
- The five hook-related files alone (hook-decision, invocation-scope, fail-closed, hook integration, claude-host): 230 tests, 230 pass, 0 fail, 0 skipped.
- Grep option model removal check (LONG_VALUE_OPTIONS export, grep key in SHORT_VALUE_OPTIONS, `function recursiveRule`, `function globMayMatchBelow`): printed `grep option model removed`.
- CON-1 and command row check against docs/containment.md: `containment rows ok`.

## Evidence

All commands were run in the executor's own Bash tool (Claude Code, zsh), cwd /Users/aphan/avarice.

### What `grep`, `find` and `rg` resolve to

```
$ type grep; type find; type rg
grep is a shell function from ~/.claude-edu/shell-snapshots/snapshot-zsh-1793388396859-60f8mr.sh
find is a shell function from ~/.claude-edu/shell-snapshots/snapshot-zsh-1793388396859-60f8mr.sh
rg is a shell function from ~/.claude-edu/shell-snapshots/snapshot-zsh-1793388396859-60f8mr.sh
```

### Versions

```
$ /usr/bin/grep --version
grep (BSD grep, GNU compatible) 2.6.0-FreeBSD
$ claude --version
2.1.318 (Claude Code)
```

### The snapshot function bodies (function line to closing brace; long lines cut at 420 characters)

`find` (snapshot line 248):

```
function find {
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=~/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command find ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"}
  elif [[ "$OSTYPE" == "msys" ]] || ... ; then
    ARGV0=bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"}
  else
    (exec -a bfs "$_cc_bin" -S dfs -regextype findutils-default ${1+"$@"})
  fi
}
```

`grep` (snapshot line 260) is the per-call dispatch between the two implementations:

```
function grep {
  local _cc_a
  for _cc_a in ${1+"$@"}; do
    case "$_cc_a" in -*-filter*|-*-pager*|-*-view*|-*-format-open*|-*-config*|---*|-@*|-*-save-config*|-[Zz]*|-[!-]*[Zz]*|--null|--null-data) command grep ${1+"$@"}; return ;; esac
  done
  local _cc_bin="${CLAUDE_CODE_EXECPATH:-}"
  [[ -x $_cc_bin ]] || _cc_bin=~/.local/bin/claude
  if [[ ! -x $_cc_bin ]]; then command grep ${1+"$@"}; return; fi
  if [[ -n ${ZSH_VERSION:-} ]]; then
    ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl ${1+"$@"}
  elif ... (msys/cygwin/win32 branch: same ugrep invocation)
  else
    (exec -a ugrep "$_cc_bin" -G --ignore-files --hidden -I --exclude-dir=.git ... ${1+"$@"})
  fi
}
```

So one shell picks between the embedded ugrep (default) and `/usr/bin/grep` (when an argument matches the case pattern) on every call.

### ugrep and bfs option facts

```
$ grep --help 2>&1 | /usr/bin/grep -n -E -- '--filter=|--depth=|dereference-recurse'
145:            `dereference-recurse', read all files under each directory,
151:    --depth=[MIN,][MAX], -1, -2, -3, ... -9, -10, -11, ...
153:            where -1 (--depth=1) searches the specified path without recursing
240:    --filter=COMMANDS
248:            the pathname to search.  For example, --filter='pdf:pdftotext % -'
259:            extension specified in --filter=COMMANDS, the corresponding command

$ find -help 2>&1 | /usr/bin/grep -n -E -- '^ *-(rm|delete)$'
185:  -delete
186:  -rm
```

### Before and after decision probe

Pure `decideToolCall`, production-shaped policy (readOnly = READ_ONLY_COMMANDS), cwd = staging, using the probe command from the plan.

| Command | Before (HEAD 974d8b1 production line) | After (07e6a34) |
|---------|----------------------------------------|------------------|
| `grep -5 PASSWORD .` | allow:shell-identity | deny:shell-not-allowed |
| `grep PASSWORD .` | allow:shell-identity | deny:shell-not-allowed |
| `grep -d dereference-recurse PASSWORD .` | deny:shell-recursive-read | deny:shell-not-allowed |
| `grep -n x src/a.ts` | allow:shell-identity | deny:shell-not-allowed |
| `cat src/a.ts \| grep -n x` | allow:shell-identity | deny:shell-not-allowed |
| `"grep" -r x .` | deny:shell-recursive-read | deny:shell-not-allowed |
| `find . -rm` | allow:shell-identity | deny:shell-find-action |
| `find . -delete` | deny:shell-find-action | deny:shell-find-action |
| `cat src/a.ts` | allow:shell-identity | allow:shell-identity |

Raw output, before:

```
grep -5 PASSWORD . -> allow:shell-identity
grep PASSWORD . -> allow:shell-identity
grep -d dereference-recurse PASSWORD . -> deny:shell-recursive-read
grep -n x src/a.ts -> allow:shell-identity
cat src/a.ts | grep -n x -> allow:shell-identity
"grep" -r x . -> deny:shell-recursive-read
find . -rm -> allow:shell-identity
find . -delete -> deny:shell-find-action
cat src/a.ts -> allow:shell-identity
```

Raw output, after:

```
grep -5 PASSWORD . -> deny:shell-not-allowed
grep PASSWORD . -> deny:shell-not-allowed
grep -d dereference-recurse PASSWORD . -> deny:shell-not-allowed
grep -n x src/a.ts -> deny:shell-not-allowed
cat src/a.ts | grep -n x -> deny:shell-not-allowed
"grep" -r x . -> deny:shell-not-allowed
find . -rm -> deny:shell-find-action
find . -delete -> deny:shell-find-action
cat src/a.ts -> allow:shell-identity
```

## What was not established, and why it no longer matters

The contained invocation's shell (`claude -p`, `--setting-sources ""`, allowlisted environment) was **not** inspected. No live contained run was made, so whether it carries the same `grep` and `find` shell functions is not established. For `grep` this no longer matters: the hook denies the word `grep` by name before any option is parsed, so the verdict is the same whether the shell would run ugrep, BSD grep or GNU grep.

The residual left by WR-02 is now only the Grep-tool caveat that the CON-1 row already lists: Grep-tool recursion inside staging relies on the host applying the secret-glob Read deny rules. For `find`, the hook denies every write or exec action in bfs's action list (`-exec` family, `-ok` family, `-delete`, `-rm`, `-fprint` family, `-fls`), and the `-files0-from` file read stays denied `shell-option-value`.

## Deviations from Plan

None to the plan's behavior. Two minor execution notes:

- Task 2's `-rm` GREEN and the parser deletion were committed together in `bce30bb` (the plan allowed either one or two commits).
- A pre-existing comment example in `parseReadArgs` (`-rnf/path`) named a grep cluster; it was rewritten to `-pO/path` (a `git log` cluster) so no grep reference remains in hook-decision.ts. This is part of the comment rewrite the plan required.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file-access surface was introduced; the change only removes an admitted command and adds one find denial.

## Threat model dispositions

- T-l3t-01, T-l3t-02 (mitigate): grep removed from READ_ONLY_COMMANDS; one test per form at unit, adapter-policy (claude-host) and real-hook levels, including `grep --filter=x:cat x src/a.ts`.
- T-l3t-03 (mitigate): `-rm` added to FIND_DENIED_ACTIONS; unit tests and the list pin cover it.
- T-l3t-04 (mitigate): the invocation-scope test fails on any grep-family READ_ONLY_COMMANDS entry; the dormant model is deleted.
- T-l3t-05, T-l3t-06, T-l3t-07, T-l3t-SC (accept): unchanged; package.json and package-lock.json show no diff.

## Self-Check: PASSED

- Commits 2882541, 99dd4fb, e695710, bce30bb, 07e6a34 are on the current branch (`git rev-list --count 3c05907..HEAD` = 5).
- Modified files exist: the eight files listed in the frontmatter.
- Pre-existing working-tree changes (.planning/state.json, .planning/config.json, .planning/milestone.lock) were not staged or committed.
