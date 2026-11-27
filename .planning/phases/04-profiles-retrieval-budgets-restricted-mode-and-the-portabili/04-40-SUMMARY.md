---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 40
subsystem: security
tags: [attended-hook, privileged-commands, shell-scanner, fail-closed, differential-oracle, cr-01, cr-02]
requires:
  - phase: 04-19
    provides: the privileged-command forms, the attended hook and the approval route
provides:
  - "classifyLine: tri-state classification (none, privileged with every command, unparseable with a reason) replacing the first-only classifier"
  - "one recursive shell-faithful scanner replacing the splitter, closingParen and closingBacktick"
  - "attended deny rule privileged:unparseable recorded as policy.denied; runs refuse an unparseable line as shell-syntax"
  - "test/helpers/shell-oracle.ts and a 65-line corpus checked against bash and zsh"
affects: [04-48, 04-51, 04-52, 04-53]
actuals:
  tokens: 14600
  tasks: 3
  commits: 6
plan_head_before: 1fbbf2de76200212039047d1ab0dd02bfe37995a
plan_head_after: 4df890373f0a8f09b8d7e3e3e0630a15c70a83eb
tech-stack:
  added: []
  patterns:
    - "a classifier limit or parse failure is a third answer, never an empty list"
    - "the shell itself is the oracle: fixed lines run under bash and zsh with logging stubs, and every privileged invocation must be one the classifier returned"
key-files:
  created:
    - test/unit/privileged-commands.test.ts
    - test/helpers/shell-oracle.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-40-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-40-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-40-red-task3.json
  modified:
    - src/domain/privileged-commands.ts
    - src/domain/hook-decision.ts
    - src/hook/pre-tool-use.ts
    - test/integration/hook-privileged.test.ts
key-decisions:
  - "classifyShellCommand now answers PrivilegedCommand, null or { unparseable } so the 17th prefix word cannot read as not privileged; isUnparseable narrows it"
  - "A here-document body is scanned twice: as commands (tolerant: an unterminated quote is a literal character, so a body line after an apostrophe is still read) and, for an unquoted delimiter, for the substitutions the shell would expand"
  - "$((...)) is scanned as a substitution holding a group, not as a separate arithmetic mode: the extra commands it yields are never privileged and a `<<` inside arithmetic cannot hide anything"
  - "The attended unparseable denial opens the store and records policy.denied but creates no approval request: nothing is named that the owner could approve"
requirements-completed: [FR-12, FR-13]
coverage:
  - id: D1
    description: "An attended Bash call longer than 65,536 characters, nested past 8 substitutions, with more than 16 prefix words, or with an unterminated quote or substitution is denied with privileged:unparseable and recorded as policy.denied"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#attended mode denies a line it cannot check instead of passing it silently (CR-01, FR-12, T-04-105)"
        status: pass
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#a line with more prefix words than the classifier reads is refused, not passed (CR-01, FR-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each limit is exact: 65,536 characters, 8 nested substitutions and 16 prefix words classify; one more is unparseable"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#the length limit is exact: 65,536 characters classify and one more is unparseable (CR-01, FR-12)"
        status: pass
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#the nesting limit is exact: 8 nested substitutions classify and 9 are unparseable (CR-01, FR-12)"
        status: pass
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#the prefix limit is exact: 16 leading wrapper words classify and 17 are unparseable (CR-01, FR-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The scanner reads quoting like the shell: a quoted parenthesis in a substitution, a comment with an apostrophe, a here-string, ANSI-C words, here-document bodies and process substitution; and a commit with a here-document message passes the attended hook silently"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#classifyLine finds the push the shell would run (CR-02, WR-01)"
        status: pass
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#attended mode allows the owner a commit whose message is a here-document with apostrophes (CR-02, T-04-107)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every privileged invocation that bash, and zsh, perform on a 65-line corpus with stub programs is one classifyLine returned"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#the differential oracle: every privileged command a shell runs on the corpus is one classifyLine returns (T-04-106)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The wrapper table answers only for its own keys, and time -p is a wrapper"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/unit/privileged-commands.test.ts#the wrapper table answers only for its own keys (WR-02)"
        status: pass
    human_judgment: false
duration: not captured
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 40: The attended gate fails closed on a line it cannot read Summary

**The privileged-command classifier is now three-valued and backed by one shell-faithful scanner: every limit and every unterminated construct is `unparseable`, the attended hook denies it with `privileged:unparseable` and records it, and the scanner agrees with bash and zsh on a 65-line differential corpus (CR-01, CR-02).**

## Performance

- **Duration:** not captured (no start time was recorded for this run)
- **Completed:** 2026-11-22
- **Tasks:** 3 (one tracer, two auto), each with a committed failing test first
- **Files:** 9 changed in the task commits (3 source files, 1 changed and 1 new test file, 1 new test helper, 3 red records)

## Accomplishments

- **Tracer, CR-01.** `classifyLine(command)` returns `none`, `privileged` with every command of the line in scan order, or `unparseable` with a reason. The first-only `classifyCommandLine` is removed; `decideShell` and `attendedPreToolUse` use `classifyLine`. In an attended session an unparseable line requires the session token, opens the store, appends one `policy.denied` (rule `privileged:unparseable`, scope `attended:<session>`, tool, reason, source `hook`, no command text) inside the transaction and prints the deny. A run refuses it with the existing `shell-syntax` rule, after its own 16,384-character check.
- **Scanner, CR-02 and WR-01.** One recursive scanner walks the text once per nesting level with single quotes, double quotes with substitutions, `$'...'` with decoded escapes (`$'\x67it'` is `git`), `$"..."`, backslash and backslash-newline, `#` comments at the start of a word, `$(`, `$((`, backticks (also nested and inside double quotes), `<(` and `>(`, redirections with their targets parsed as words and dropped, and here-documents (`<<`, `<<-`, quoted or not) whose bodies are read after the naming line. `echo $(echo ")"; git push)` is now `git.push`; `git commit -m "$(cat <<'EOF' ... EOF)"` with apostrophes, parentheses, a `# what's` line and the words git push mid-sentence is `none`.
- **Limits, WR-02 and `time -p`.** `MAX_PREFIX_WORDS` (16) is exported; a command with more prefix words is unparseable and carried up through `classifyShellCommand` as `{ unparseable }`. The wrapper table is read with `Object.hasOwn`, so `constructor -x` and `__proto__ git push` neither throw nor count as wrappers. `time` is a wrapper that skips `-p`.
- **Oracle.** `test/helpers/shell-oracle.ts` runs a line under `/bin/bash --noprofile --norc -c` and `/bin/zsh -f -c` with only logging stubs for git, gh and npm on PATH (plus env, nohup, cat, diff and bash helpers), in a temporary directory, with a minimal environment, `/dev/null` as standard input and a 10-second timeout. The corpus has 65 lines; the test passes under both shells on this machine.
- **Timing.** Four adversarial 65,536-character lines (balanced substitutions and groups, unclosed quotes, nested backquotes, a here-document body of quotes) classify in under 10 ms each against a 200 ms bar.

## TDD record

| Task | RED commit | RED evidence (`RED_EVIDENCE_OK`) | GREEN commit |
|---|---|---|---|
| 1 | `07c4cde` | `04-40-red-task1.json`: the attended hook printed nothing for a 70,000-character push line | `d7d1f06` |
| 2 | `ba65243` | `04-40-red-task2.json`: bash ran `git push` for `echo $(echo ")"; git push)` and the classifier said none | `a28082e` |
| 3 | `423006c` | `04-40-red-task3.json`: a push behind 17 wrapper words classified as none and `constructor -x` threw | `4df8903` |

No REFACTOR commits. The RED commit of task 1 carries a `classifyLine` skeleton that throws, so the unit file loads (the integration target fails on its own assertion); task 2's RED evidence names `under bash` as the target because the classifier rejects test names holding backslashes.

## Verification

- `node --test test/unit/privileged-commands.test.ts test/integration/hook-privileged.test.ts test/integration/hook.test.ts test/mutation/fail-closed.test.ts test/unit/hook-decision.test.ts`: 353 of 353 pass; after adding the `time` lines to the corpus the unit file passes 45 of 45.
- `npm run typecheck` clean; `npm run check:boundaries` ok (132 files); `grep -c "function closingParen"` prints 0; `grep -c MAX_PREFIX_WORDS` prints 4.
- Full unit, integration and mutation run: one failure, `limits.maxConcurrentChecks` in `test/integration/resource-degradation.test.ts` (a wall-clock ordering check of two concurrent checks). It passes 30 of 30 when run alone; it is load-sensitive and unrelated to this plan's files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Oracle run count is a lower bound, not an exact count**
- **Found during:** Task 2
- **Issue:** bash expands the target of a failing redirection twice, so `cat > $(git push) < /dev/null` runs the stub twice; an exact count of 1 failed on a correct classifier.
- **Fix:** the corpus check asserts at least `runs` privileged invocations for a line that names one and exactly none for a line that only mentions one; the subset check against `classifyLine` is unchanged.
- **Files modified:** `test/unit/privileged-commands.test.ts`
- **Commit:** `a28082e`

**2. [Rule 2 - Missing critical] `classifyShellCommand` could still answer "not privileged" for an unreadable command**
- **Found during:** Task 3
- **Issue:** the plan names `classifyLine` as the tri-state, but `classifyShellCommand(words)`, also exported, would have returned `null` for the 17th prefix word.
- **Fix:** it returns `PrivilegedCommand | null | { unparseable }` (`isUnparseable` narrows); `classifyLine` converts it. The oracle test and the existing table test were adjusted.
- **Files modified:** `src/domain/privileged-commands.ts`, `test/unit/privileged-commands.test.ts`
- **Commit:** `4df8903`

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact:** none on scope; both keep the plan's contract.

## Documentation surfaces (for plan 04-53)

- **Rule IDs.** Attended: `privileged:unparseable` (new rule value on the existing `policy.denied` kind, scope `attended:<session>`, event data: `ruleId`, `scope`, `tool`, `reason`, `source`; no approval request, no command text). Runs: an unparseable line is refused as `shell-syntax` (unchanged name), a privileged form as `privileged:<action>`.
- **Attended deny reason.** `avarice: privileged:unparseable: the command could not be checked for privileged actions (<reason>); split it into shorter commands, or write files with the Write tool`. Reasons: `the command is longer than 65,536 characters`, `more than 8 nested command substitutions`, `more than 16 assignment, reserved or wrapper words before the program`, `a single quote is not closed`, `a double quote is not closed`, `a $'...' string is not closed`, `a command substitution is not closed`, `a backquote is not closed`, `backquotes are nested more than two deep`.
- **What the scanner reads.** Single and double quotes, `$'...'` and `$"..."`, backslash and backslash-newline, `#` comments at a word start, `$(...)`, `$((...))`, backticks, process substitution, redirections (`<`, `>`, `>>`, `<&`, `>&`, `&>`, `<>`, `<<<`, with a descriptor number) with their targets, here-documents (`<<`, `<<-`, quoted or unquoted delimiter; the body is classified as commands and, when unquoted, for expansions), separators `;`, `&`, `|`, newline and parentheses, assignments, reserved words and the wrappers `env`, `command`, `exec`, `nohup`, `builtin`, `time` (with `-p`), `nice`, `sudo`.
- **Limits.** 65,536 characters, 8 nested substitutions (a here-document body counts as one level), 16 prefix words; the hook's 1 MiB input cap and the run's 16,384-character check are unchanged.
- **Remaining documented bypasses.** Names built at run time (a variable, an alias, a function), a script that pushes, and a shell started on a computed string.
- **Known limits of the scanner.** A here-document body is classified as commands even when its delimiter is quoted, so a body line that begins with a privileged command (for example a commit message line starting `git push`) is read as one; the owner approves it or rewords it. One approval is still consumed for the first privileged command of a line only (plan 04-48 extends it to every command); approvals do not yet bind the inputs that change a command's effect (plan 04-51).
- **Commits to cite (plan 04-52).** `d7d1f06` (CR-01), `a28082e` (CR-02, CR-01 nesting, WR-01 quoting), `4df8903` (CR-01 prefix limit, WR-02, WR-01 `time -p`).

## Known Stubs

None.

## Threat Flags

None. The plan's register (T-04-105, T-04-106, T-04-107) is covered; the oracle runs fixed strings under a shell with stub programs only.

## Issues Encountered

None beyond the load-sensitive timing test noted under Verification.

## Self-Check: PASSED
