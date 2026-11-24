---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 57
subsystem: privileged-command-classifier
tags: [shell-parsing, approval-gate, gh, git-alias, here-document]
gap_closure: true
gap_ids: [G-04-2-GWR-01, G-04-2-GWR-03, G-04-2-GIN-01]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: plan 04-54 and 04-56 (the approval and attended-test changes this plan starts from)
provides:
  - "gh options between a group and its subcommand are skipped, and -R/--repo is bound as repo in either position"
  - "a git alias or config include defined on the command's own line makes the line unparseable"
  - "an unquoted here-document substitution is scanned once, so one $(git push) is one approval"
affects: [04-62, 04-63, 04-67]

plan_head_before: 21159eff0e69edb90e4d8dd16a77bf36e08add2c
plan_head_after: bb186b02f6340ed326cc65b6fa27c943599c3609

actuals:
  tokens: 8000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "fail closed: a same-line alias or include is unparseable, which both callers refuse"
    - "de-duplicate by source offset instead of skipping a scan that is needed for completeness"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-57-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-57-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-57-red-task3.json
  modified:
    - src/domain/privileged-commands.ts
    - test/unit/privileged-commands.test.ts

key-decisions:
  - "The environment an enclosing command gives an inner one is read for a same-line alias too (GIT_CONFIG_KEY_0=alias.p bash -c 'git p'), but it is not bound a second time: the enclosing command binds its own env."
  - "The substitution record is keyed by start offset and terminator, not by offset alone: a backquote and a `$(` that open at the same offset cannot share a result."
  - "The expansion scan of an unquoted here-document body is kept; the two scans share one record per substitution."

requirements-completed: [FR-12, SEC-6]

coverage:
  - id: D1
    description: "gh pr -R x/y create, gh pr --repo=x/y merge 1, gh release -R x create v1 and gh pr -Rx/y edit 3 classify as scm.pr.create, scm.pr.merge, release.publish and scm.pr.update with the repository bound, and the option binds the same before or after the subcommand (GWR-01)"
    requirement: "FR-12"
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#a gh option between the group and the subcommand does not hide the subcommand (GWR-01, FR-12, T-04-150)"
        status: pass
      - kind: integration
        ref: "test/unit/privileged-commands.test.ts#the differential oracle: every privileged command a shell runs on the corpus is one classifyLine returns (T-04-106), under bash and zsh"
        status: pass
    human_judgment: false
  - id: D2
    description: "A git alias or config include defined on the same line (-c, --config-env, GIT_CONFIG_KEY_n, GIT_CONFIG_PARAMETERS, also inside a shell string, after env and through an outer assignment) is unparseable with a reason that names it (GWR-03)"
    requirement: "SEC-6"
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#a git alias or config include defined on the same line is refused as unparseable (GWR-03, FR-12, T-04-151)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unquoted here-document body yields each substitution once, including one after an apostrophe, and two different substitutions still yield two commands (GIN-01)"
    requirement: "FR-12"
    verification:
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#an unquoted here-document body yields each substitution once (GIN-01, FR-12, T-04-152)"
        status: pass
      - kind: unit
        ref: "test/unit/privileged-commands.test.ts#reads a line of 65,536 characters made of quotes, parentheses and dollar signs in under 200 ms (CR-01)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-24
status: complete
---

# Phase 4 Plan 57: Privileged-command scanner, gh options, same-line git alias, here-document double scan Summary

**The privileged-command classifier now sees `gh pr -R x/y create`, refuses a git alias or config include defined on the same line, and counts a here-document `$(git push)` once.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-11-24T22:00:42Z
- **Completed:** 2026-11-24T22:07:15Z
- **Tasks:** 3
- **Files modified:** 2 source and test files, 3 red-run records

## Accomplishments

- GWR-01: `classifyGh` walks the options between the group and the subcommand (`-R` and `--repo` take the next word, `--repo=x` and `-Rx` are one word, other `-` words are skipped alone), then parses those options together with the words after the subcommand, so `repo` is bound wherever `-R` is written. `gh api` is unchanged. Four corpus lines run under the bash and zsh oracle.
- GWR-03: `classifyGit` takes the program's env words and returns unparseable, before the subcommand test, for a `-c` or `--config-env` key (attached or separate) starting `alias.`, `include.` or `includeif.`, a `GIT_CONFIG_KEY_<n>` value with such a key, or a `GIT_CONFIG_PARAMETERS` value holding `alias.` or `include`. Env inherited from an enclosing shell string is read too.
- GIN-01: `scanSubstitution` records the position after each substitution by start offset and terminator, so the command scan and the expansion scan of an unquoted here-document body share one result and add the command once. The expansion scan stays, so `it's $(git push)` is still found.

## Task Commits

1. **Task 1: gh options before the subcommand (GWR-01)** - `e5fd2d3` (test), `2c8c3ac` (fix)
2. **Task 2: same-line git alias or include (GWR-03)** - `844cc4e` (test), `1dd8ac1` (fix)
3. **Task 3: one scan per substitution (GIN-01)** - `e45d02e` (test), `bb186b0` (fix)

**Plan metadata:** recorded in the docs commit that follows this file.

The Task 1 tracer was re-run end to end after its fix (107 tests, typecheck clean) before Task 2 started.

## Files Created/Modified

- `src/domain/privileged-commands.ts` - gh group option skipping, same-line alias and include refusal, per-offset substitution record, header comment updated
- `test/unit/privileged-commands.test.ts` - four oracle corpus lines and three describe blocks, one per finding
- `04-57-red-task1.json`, `04-57-red-task2.json`, `04-57-red-task3.json` - the failing run recorded before each fix

## Decisions Made

See `key-decisions`. The plan's fail-closed reading of GWR-03 and the de-duplicate-not-skip reading of GIN-01 were followed as written.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] An outer assignment reaches the inner command of a shell string**
- **Found during:** Task 2
- **Issue:** The plan reads the program's own env words. `GIT_CONFIG_KEY_0=alias.p bash -c 'git p'` defines the alias on the same line through the inherited environment, and the inner `git p` would have passed unclassified.
- **Fix:** `classifyWords` and `classifyString` carry an `inherited` env list into a shell string or `eval`; it is read for the alias check only and not bound again.
- **Files modified:** `src/domain/privileged-commands.ts`
- **Verification:** the "refuses the same forms inside a shell string, after env, and when an outer assignment reaches the inner command" unit case
- **Committed in:** `1dd8ac1`

**2. [Rule 1 - Correctness] The substitution record is keyed by terminator as well as offset**
- **Found during:** Task 3
- **Issue:** The plan says one record per start offset. A `$(` and a backquote open at different offsets, but the terminator also decides how the text is read; sharing a result across terminators at one offset would be wrong.
- **Fix:** key is `offset:terminator`. Behaviour for the here-document case is as planned.
- **Files modified:** `src/domain/privileged-commands.ts`
- **Committed in:** `bb186b0`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 correctness). **Impact on plan:** both tighten the planned behavior; no scope creep.

## Issues Encountered

- The harness refused `git -C`, `.git`-directory writes and multi-line heredocs mentioning git, so the per-plan ledger file under the shared `.git` directory could not be written. `plan_head_before` is the planning-base HEAD `21159ef`, read before the first change, and `commits: 6` is `git rev-list --count 21159ef..HEAD`.
- The root-pin guard was run as separate plain commands (`git rev-parse --show-toplevel` returned the pinned root; branch `worktree-phase-04`) for the same reason.
- Full `npm test` was not run. The plan's verification set was: the whole privileged-commands test file (126 tests, bash and zsh oracles, 65,536-character timing case), `npm run typecheck`, and `test/integration/hook-privileged.test.ts`, `test/unit/hook-decision.test.ts` and `test/unit/approval.test.ts` (283 tests), all green.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the changes only widen what the classifier refuses or names.

## Documentation surfaces (for plan 04-67)

- gh options between the group and the subcommand: `gh pr -R x/y create`, `gh pr --repo=x/y merge 1`, `gh release -R x create v1` are classified, and `repo` is bound the same whether the option comes before or after the subcommand.
- A git alias or config include defined on the command's own line is refused as unparseable. Reason text: "the line defines a git alias or a config include, which cannot be checked; run the command it stands for". Forms: `-c` and `--config-env` keys starting `alias.`, `include.`, `includeif.`; `GIT_CONFIG_KEY_<n>` with such a key; `GIT_CONFIG_PARAMETERS` holding `alias.` or `include`; also through an outer assignment to a shell string.
- A here-document substitution is counted once: one `$(git push)` in an unquoted body is one privileged command and one approval.

## Residual wording for plan 04-63 (enforcement map)

- An alias or config include set by an earlier separate call (`git config alias.p push`, then `git p`) is not seen; the line digest does not cover it.
- `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM` and `GIT_CONFIG` naming a file stay bound as env words only; the file's content (an alias inside it) is not read.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 04-62 (brace and glob expansion) and 04-63 (wrappers and launchers) can now edit `src/domain/privileged-commands.ts` and its test file in that order.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-24*

## Self-Check: PASSED

Created files and commits were checked after this file was written (see the self-check run in the plan's final report).
