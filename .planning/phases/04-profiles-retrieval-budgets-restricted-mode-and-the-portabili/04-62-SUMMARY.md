---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 62
subsystem: privileged-command-classifier
tags: [shell-parsing, approval-gate, brace-expansion, glob, enforcement-map]
gap_closure: true
gap_ids: [G-04-2-GWR-02]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: plan 04-57 (gh options, same-line alias, one scan per substitution), the classifier and test file this plan edits
provides:
  - "a brace expansion or a glob that decides which command runs is refused as unparseable"
  - "a brace expansion anywhere in a privileged command is refused; a glob after a privileged subcommand stays bound as written"
  - "the privileged-approval row and the classifier header name the refused positions and the glob residual"
affects: [04-63, 04-67]

plan_head_before: d2dd941df1e7d92042d55bbe8516cb1c24f2a0e8
plan_head_after: 80901193e22a5394b4f30ba7d031f3e9d42fa803

actuals:
  tokens: 9000
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "expansion flags travel beside each word through commandsOf, leaving the word's text unchanged"
    - "fail closed: an expansion word where it could change the command is unparseable, which both callers refuse"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-62-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-62-red-task2.json
  modified:
    - src/domain/privileged-commands.ts
    - src/domain/enforcement-map.ts
    - test/unit/privileged-commands.test.ts
    - test/unit/enforcement-map.test.ts

key-decisions:
  - "A case pattern ended by a stray parenthesis carries no expansion flags, so a default arm such as `*)` is not refused as a glob in the program position. The shell never runs such a command."
  - "A `${...}` parameter expansion and the special parameters `$*` and `$?` are not expansions, so `${A:-a,b}` and `echo $?` keep their answers."
  - "The oracle counts an unparseable answer as covering every invocation of a line, as the plan states, because both callers refuse such a line."

requirements-completed: [FR-12, SEC-6]

coverage:
  - id: D1
    description: "git pus{h,}, {git,push} origin main, g{i,}t push, git pu?h, git -C dir* push and git push origin {main,dev} classify as unparseable with a reason naming a brace expansion or a glob; the gh and npm equivalents are refused at their group, option, subcommand and word positions; mkdir -p src/{a,b}, git add src/{a,b}.ts, [ -f x ] && echo ok, gh api repos/{owner}/{repo}/issues, echo {a,b} and a case default arm keep their answers (GWR-02)"
    requirement: "FR-12"
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#a brace expansion or a glob that decides which command runs is refused as unparseable (GWR-02, FR-12, T-04-163)"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#the differential oracle: every privileged command a shell runs on the corpus is one classifyLine returns (T-04-106), under bash and zsh"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#reads a line of 65,536 characters made of quotes, parentheses and dollar signs in under 200 ms (CR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The privileged-approval row's bypass text says a brace expansion or a glob in a command, prefix or subcommand position and a brace expansion anywhere in a privileged command is refused as unreadable, and names a glob in the arguments after a privileged subcommand as bound as written (GWR-02, SEC-6)"
    requirement: "SEC-6"
    verification:
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts#the privileged-approval row says what the gate does and does not do (SEC-6, IN-03, plan 04-51)"
        status: pass
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts and test/unit/hook-decision.test.ts, unchanged and green with the refusal in place"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-25
status: complete
---

# Phase 4 Plan 62: Brace and glob expansion words in the privileged-command classifier Summary

**The classifier refuses a line whose brace expansion or command-position glob could form a privileged command (`git pus{h,}`, `{git,push} origin main`, `git pu?h`), refuses any brace expansion inside a privileged command, and the enforcement map says a glob after the subcommand is bound as written.**

## Performance

- **Duration:** about 20 min
- **Tasks:** 2 (a tracer and an auto task, each with a RED commit)
- **Files modified:** 4 source and test files, 2 red-run records

## Accomplishments

- GWR-02: `readWord` notes, for each word, whether it holds outside quotes and escapes a brace group (a `{` with a later `}` and a `,` or `..` between) or a glob (`*`, `?`, or `[` with a later `]`). The flags travel beside each command's words through `commandsOf` (a parallel `marks` list); no word's text changes. The scan is linear in the word (a state machine, no search back), so the 65,536-character timing cases stay under 200 ms; two new timing cases cover words of braces, commas, dots and brackets.
- The refusal positions follow the plan: the program word and every word before it (assignment, wrapper, wrapper option or operand, including the words an `env -S` string replaces and the made-up `sh -c` of `flock`); git's global options, their values and the subcommand; gh's group, options before the subcommand and subcommand; npm's words up to and including the subcommand, or all words when it has none; and a brace expansion anywhere in a command that is privileged. The reason is "a brace expansion or a glob decides which command runs; write the command without it".
- A glob after the subcommand of a privileged command is still bound as its literal text (`git push origin refs/heads/*` keeps `refspec` as written). `mkdir -p src/{a,b}`, `git add src/{a,b}.ts`, `[ -f x ] && echo ok`, `gh api repos/{owner}/{repo}/issues` and `echo {a,b}` keep the answer none.
- The differential oracle counts an unparseable answer as covering the line; the corpus gains `git pus{h,}` (1 run), `{git,push} origin main` (1) and `g{i,}t push` (0), and passes under bash and zsh.
- The privileged-approval row's `bypassLimitation` and the classifier header name the refused positions and the glob residual; the enforcement-map test asserts both.

## Task Commits

1. **Task 1: tracer, a brace or glob that forms a privileged command is refused (GWR-02)** - `d7c26c2` (test, red), `6d74e0f` (fix)
2. **Task 2: the row names the refused positions and the glob residual (GWR-02)** - `0bc645a` (test, red), `8090119` (feat)

The tracer was re-run end to end after its fix (138 tests in the classifier file, 283 in the hook and approval files, typecheck clean) before Task 2 started: tracer verified, expanding.

## Files Created/Modified

- `src/domain/privileged-commands.ts` - expansion flags per word, `programWords` marks in lockstep with its word list, `parseArgs` records positional indices, the three program classifiers refuse expansion words at their positions, header comment updated
- `src/domain/enforcement-map.ts` - the privileged-approval row's bypass text
- `test/unit/privileged-commands.test.ts` - three corpus lines, the oracle's unparseable-covers rule, the GWR-02 describe, two timing cases
- `test/unit/enforcement-map.test.ts` - two assertions on the row
- `04-62-red-task1.json`, `04-62-red-task2.json` - the failing runs recorded before each fix

## Decisions Made

See `key-decisions`. The assignment-word rule of the plan (an expansion word in an assignment before the program is refused, although the shell does not expand assignment words) was followed as written; it refuses a line such as `URL=http://x/?a=1 curl x`, which is the fail-closed direction and is named below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Correctness] A case pattern ended by a stray parenthesis carries no expansion flags**
- **Found during:** Task 1
- **Issue:** The scanner reads `*)` of `case x in a) echo 1;; *) echo 2;; esac` as a command whose only word is `*`. Under the plan's program-position rule that word is a glob and the whole line would be refused. A case default arm is common in ordinary owner commands and the shell never runs such a command.
- **Fix:** when a `)` that closes no group and no substitution ends a command, the flags of that command's words are cleared. The words and their classification are unchanged.
- **Files modified:** `src/domain/privileged-commands.ts`
- **Verification:** the "keeps the answers of lines that only look like expansions" case includes the default-arm line
- **Committed in:** `6d74e0f`

**2. [Rule 1 - Correctness] `$*` and `$?` and `${...}` are not expansion words**
- **Found during:** Task 1
- **Issue:** a naive read of `*` and `?` flags `echo $?` and `${B#*/}`, and `{`, `,` flag `${A:-a,b}`, which refuses ordinary lines and a push that names a branch by parameter.
- **Fix:** the special parameters `$*` and `$?` and the body of a `${...}` are read without flags.
- **Files modified:** `src/domain/privileged-commands.ts`
- **Verification:** the "does not read a quoted, escaped, parameter or special-parameter character as an expansion" case
- **Committed in:** `6d74e0f`

---

**Total deviations:** 2 auto-fixed (both correctness). **Impact on plan:** both narrow the refusal to the forms the plan describes; no scope creep.

## Issues Encountered

- The harness refuses compound git commands and shell heredocs and sed edits on the classifier path, so the per-plan ledger file under the shared git directory was not written. `plan_head_before` is the HEAD read before the first change (`d2dd941`), and `commits: 4` is `git rev-list --count d2dd941..HEAD` before this file's commit.
- The root-pin guard was run as the plain command `git rev-parse --show-toplevel`, which returned the pinned root; branch `worktree-phase-04`.
- Full `npm test` was not run. The verification set was the plan's: `test/unit/privileged-commands.test.ts`, `test/unit/enforcement-map.test.ts`, `test/integration/hook-privileged.test.ts`, `test/unit/hook-decision.test.ts` (409 tests), `test/unit/approval.test.ts` (with the hook files, 283 tests), `npm run typecheck`, `npm run check:boundaries`, all green.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the change only widens what the classifier refuses.

## Documentation surfaces (for plan 04-67)

- Refused positions: a brace expansion or a glob in the program word or any word before it (an assignment, a wrapper, a wrapper's option or operand); in git's global options, their values and the subcommand; in gh's group, options before the subcommand and subcommand; in npm's words up to and including its subcommand (every word when it has none). A brace expansion anywhere in a privileged command (`git push origin {main,dev}`) is refused too. Each is `unparseable` with the reason "a brace expansion or a glob decides which command runs; write the command without it", so both the hook and the run decision refuse the line.
- What counts as an expansion word: outside quotes and not after a backslash, a brace group (a `{` with a later `}` and a `,` or `..` between them) or a glob (`*`, `?`, or a `[` with a later `]` in the same word). Not expansion words: a lone `[` (the test command), `{owner}` (no comma), the reserved words `{` and `}`, the body of `${...}`, `$*` and `$?`, and the words of a case pattern ended by `)`.
- Unchanged answers: brace words in the arguments of other programs (`mkdir -p src/{a,b}`, `git add src/{a,b}.ts`, `echo {a,b}`) are none.
- Differential oracle: an unparseable answer of `classifyLine` covers every privileged invocation of that line, because both callers refuse an unparseable line; a line the oracle runs is either classified with the action or refused.
- Residual: pathname globbing in the arguments after a privileged subcommand (`git push origin refs/heads/*`) is bound as written, so an approval binds the pattern and not the files the shell matches. Plan 04-63 rewrites the row's full residual list and keeps this item.
- Over-refusal to be aware of: an assignment word before the program that holds a `?` or `*` (`URL=http://x/?a=1 curl x`) is refused, as the plan states, although the shell does not expand assignment words. Zsh-only forms (extended globs, `=cmd`) are not read as expansions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-63 (wrappers, launchers, shell strings and the rest of the residual list) can edit `src/domain/privileged-commands.ts`, its test file and the privileged-approval row next. `programWords` now returns `marks` beside `words`, and `flockWords` returns `{ words, from }`; a new wrapper form must keep the two lists in step (the `drop` helper does this).

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-25*

## Self-Check: PASSED

Created files and commits were checked after this file was written (see the self-check run in the plan's final report).
