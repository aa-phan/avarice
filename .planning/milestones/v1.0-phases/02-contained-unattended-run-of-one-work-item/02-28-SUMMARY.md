---
phase: 02-contained-unattended-run-of-one-work-item
plan: 28
subsystem: cli-terminal-text
tags: [terminal-escape, stripControl, outcomeLines, bidi, zero-width, onboard, resume, supervise]
requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: shared OPS-7 style (resultLine, errorLine, stripControl) from plan 02-02
provides:
  - outcomeLines, the one printer of a command outcome shared by onboard, resume and supervise
  - every line onboard and resume print passes through control stripping
  - stripControl removes the full invisible-format class, written with \u escapes
affects: [02-35 documentation pass, 02-REVIEW disposition record]
gap_closure: true
gap_ids: [G-02-H4]
actuals:
  tokens: 6000
  tasks: 2
  commits: 4
plan_head_before: be2268f4409b2654361343a4bbe42e3c78d0577f
plan_head_after: 6a47d7865e848dbab37d961ee34217ef399fb9ab
tech-stack:
  added: []
  patterns:
    - "one pure printer for a command outcome; callers add the newline"
    - "regex classes of invisible characters written with \\u escapes, guarded by an ASCII-only source test"
key-files:
  created:
    - test/integration/cli-terminal-text.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-28-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-28-red-evidence-task2.json
  modified:
    - src/cli/render/style.ts
    - src/cli/commands/onboard.ts
    - src/cli/commands/resume.ts
    - src/cli/commands/supervise.ts
    - test/unit/render.test.ts
    - docs/system/cli-reference.md
key-decisions:
  - "Route the usage lines of onboard and resume through errorLine as well: the onboard usage line can echo a budget flag, and JSON.stringify does not escape bidi marks"
  - "The soft hyphen U+00AD stays out of the stripped class, as the plan specified"
requirements-completed: [OPS-7]
coverage:
  - id: D1
    description: "Every line onboard and resume print (outcome, note, errors, the onboarding resume branch) passes through the shared stripping; supervise shares the same outcome printer"
    requirement: OPS-7
    verification:
      - kind: unit
        ref: "test/unit/render.test.ts#outcome lines (R-WR-01, T-02-03)"
        status: pass
      - kind: integration
        ref: "test/integration/cli-terminal-text.test.ts#terminal text through the real CLI (R-WR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "stripControl removes U+061C, U+200B-U+200F, U+202A-U+202E, U+2060, U+2066-U+2069 and U+FEFF, and style.ts code lines hold only ASCII"
    requirement: OPS-7
    verification:
      - kind: unit
        ref: "test/unit/render.test.ts#invisible formatting characters (R-IN-03, T-02-100)"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/system/cli-reference.md states the stripped set and the onboard and resume coverage in plain words"
    requirement: OPS-7
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and style; the fresh prose review and coverage.md entry belong to plan 02-35"
duration: 40min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 28: Terminal text of onboard and resume Summary

**One shared outcomeLines printer puts every onboard, resume and supervise line through control stripping, and stripControl now removes the full bidi, zero-width, word-joiner and byte-order-mark class, written with \u escapes.**

## Performance

- **Duration:** about 40 min (start time was not captured as a variable; estimated from the session)
- **Completed:** 2026-11-08T01:49Z (last task commit)
- **Tasks:** 2
- **Files modified:** 9 (6 modified, 3 created)

## Accomplishments

- R-WR-01 fixed: `onboard` and the onboarding branch of `resume` print the outcome line, the note and every error line through `outcomeLines` and `errorLine`. An ESC sequence in a resume ID, a repository path, a recorded reason or a note no longer reaches the terminal. Exit codes are unchanged; text for clean input is byte-identical (the preflight, lease, ledger-status, index-stage and checkout-unchanged suites pass unchanged: 88 tests).
- `supervise` now prints through the same `outcomeLines`, so the three commands share one printer.
- R-IN-03 fixed: the class is `INVISIBLE_FORMAT`, written with `\u` escapes, covering U+061C, U+200B-U+200F, U+202A-U+202E, U+2060, U+2066-U+2069 and U+FEFF. The soft hyphen stays. A unit test asserts every code line of `style.ts` is ASCII.
- `docs/system/cli-reference.md` names the full stripped set and says the onboard and resume lines are covered.

## Task Commits

1. **Task 1 RED:** `3b182de` (test) - outcomeLines unit cases and the new real-CLI file
2. **Task 1 GREEN:** `04bed71` (feat) - outcomeLines; onboard, resume and supervise rewired
3. **Task 2 RED:** `47e5021` (test) - per-code-point cases and the ASCII-source test
4. **Task 2 GREEN:** `6a47d78` (feat) - INVISIBLE_FORMAT with escapes; cli-reference.md

**Plan metadata:** committed separately (docs: complete plan).

## Findings fixed, for plan 02-35's disposition record

- **R-WR-01 (WR-01): fixed.** Proven through the real CLI (`avarice resume` with an ESC in the ID, `avarice onboard` with an ESC in the path).
- **R-IN-03 (IN-03): fixed.** Proven per code point and by the ASCII-source test.

## Notes for plan 02-35

- **Test-file count:** one new test file, `test/integration/cli-terminal-text.test.ts`; there are now 118 `*.test.ts` files under `test/` (117 before).
- `docs/system/cli-reference.md` was edited (the stripping sentence in "Output style"); it needs the fresh prose review and its `coverage.md` entry. `coverage.md` was not touched, per the plan.
- **Full suite (`npm test`):** 2544 tests, 2486 pass, 3 fail, 55 skipped. The failures were load-sensitive and not caused by this change: the SIGTERM-grace case of `test/integration/claude-host.test.ts` (known), the `test/mutation/fail-closed.test.ts` cases (known; WR-07 probe timeout, FC-10), and a file-level `ENOTEMPTY` on the `after` cleanup of `test/integration/run-start.test.ts` (a detached supervisor still writing into the temp root while it was removed). `test/integration/run-start.test.ts`, `test/mutation/fail-closed.test.ts` and `test/integration/claude-host.test.ts` run together alone: 100 tests, 100 pass. `run-start.test.ts` is not on the plan's list of known load-sensitive files; this is its first recorded occurrence of the cleanup race.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Usage lines of onboard and resume also go through errorLine**
- **Found during:** Task 1
- **Issue:** The plan named the error lines but not the usage lines. The onboard usage line echoes the text from `parseBudgetFlags`, which includes the user's `--budget` value through `JSON.stringify`; that escapes ESC but not bidi or zero-width characters.
- **Fix:** `usage()` in both commands prints through `errorLine`. Output for clean input is identical.
- **Files modified:** src/cli/commands/onboard.ts, src/cli/commands/resume.ts
- **Verification:** the CLI suites that assert these lines pass unchanged
- **Committed in:** 04bed71

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** closes the same hole in the one remaining echoing line; no scope creep.

## Issues Encountered

- The plan's onboard case says a path made of a scratch directory plus `/x` ESC `[2Jy`. At base a path that does not exist exits 70 without echoing the path (`git could not run: ENOENT`), so the test creates the directory; the path is then echoed in `invalid repoPath: cannot inspect ...` with exit 64, the base exit code, which the test asserts before the ESC check.
- The RED run of task 1 includes a link-time failure of the unit file (missing export); the two CLI failures are the RED authority and are recorded as such.

## Known Stubs

None.

## Threat Flags

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for the remaining gap-closure plans and the documentation pass (02-35).

## Self-Check: PASSED

- Created files exist: test/integration/cli-terminal-text.test.ts, both red-evidence JSON files, this SUMMARY.
- Commits 3b182de, 04bed71, 47e5021, 6a47d78 are ancestors of HEAD.
