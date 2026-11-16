---
phase: 03-decisions-independent-work-and-amendments
plan: 49
subsystem: exit-benchmark
status: complete
tags: [exit-run, portfolio, d-03-relaxed, relax-record, write-set-check, run-1-in-place, owner-decision, offline]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-48: run 1's second stop on item C; plan 03-47: the 4.95 USD authorization; plan 03-46: the second-stop finish judge"
provides:
  - "test/integration/run-finish-in-place.test.ts and 03-49-finish-analysis.json: run 1's shape measured offline (scenarios P, U, N, Y) and run 1's stored contract and decision read from the owner's ledger"
  - "the exit tools' `relax` subcommand and a relaxed finish judge (an extra decision counts only through the owner's relax record), and a write-set check in the dry run and in `brief-check`"
  - "03-49-brief-check.json and 03-49-brief-check-after.json: the three briefs' write-set findings at the pin, before and after the owner's change to run 3"
  - "run 3's brief changed with the owner's approval (digest sha256:fe8742f4...); 03-49-dry-run.json records the three digests"
  - "03-49-exit-authorization.json: selection answer-2-in-place, superseding 03-47-exit-authorization.json"
affects: [03-50, 03-30, 03-31, 03-32, 03-33, phase-3-exit]

actuals:
  tokens: 60000
  tasks: 3
  commits: 7
plan_head_before: 491cfd621526acbd56c1c27ad4ef183e515d350d
plan_head_after: 12b3660879e2ad27d1044b7d0c1c94b43b23fd56

key-files:
  created:
    - test/integration/run-finish-in-place.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-49-finish-analysis.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-49-brief-check.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-49-brief-check-after.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-49-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-49-exit-authorization.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts
    - test/unit/exit-drafts.test.ts
    - test/benchmark/phase3/p3-run3-theme-toggle.md

key-decisions:
  - "Owner decision 2026-11-10 (Task 3): answer-2-in-place. The owner answers C's decision with option 2 in their own terminal (plan 03-50); D-03 is relaxed for run 1 only; Claude records the relax record in 03-50; the owner updates tests/e2e/copy-email.spec.ts after review."
  - "Run 2's brief stays unchanged. Run 3's brief takes R3-3 and R3-1 (R3-2 dropped) and its new digest is approved."
  - "Finding for the documentation plans: a declared, non-required check (test:e2e) is never run by the supervisor, so a delivered tree can fail it with nothing recorded."

requirements-completed: []

coverage:
  - id: D1
    description: "Run 1's shape offline: the protected add-write is refused with nothing written, the amend-then-answer sequence on an unprotected path is measured, and answering option 2 reaches ready_for_review inside the write set"
    verification:
      - kind: test
        ref: "test/integration/run-finish-in-place.test.ts (scenarios P, U, N, Y), commit 2fbb7bc"
        status: pass
    human_judgment: false
  - id: D2
    description: "The finish judge accepts a run the owner relaxed under D-03 only through an explicit relax record, and the dry run flags a brief whose change collides with a file outside its Write list"
    verification:
      - kind: test
        ref: "test/unit/exit-evidence.test.ts (relaxed finish judge, relax subcommand, write-set check), commits 4d5caaf and bc768d4"
        status: pass
      - kind: other
        ref: "03-49-brief-check.json lists tests/e2e/copy-email.spec.ts:5 for run 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "Run 3's brief no longer collides with a protected spec or tests/unit/use-theme.test.tsx for either option of item B"
    verification:
      - kind: other
        ref: "03-49-brief-check-after.json (assessment, real collisions 0) and git grep of the pin for the assertions option 2 could touch"
        status: pass
    human_judgment: true
    rationale: "The tool lists every name the Behavior mentions, kept or changed, so it still reports 47 findings for run 3; the claim of no real collision rests on the classification recorded in the file and on the owner's reading of the new option 2"
  - id: D4
    description: "The owner's choice and the approved brief digests are recorded in an authorization file the exit tools accept"
    verification:
      - kind: other
        ref: "node scripts/exit-run-phase3-tools.ts field --authorization-file 03-49-exit-authorization.json (host.claudeBin, perRunCapUsd 4.95, ceilingUsd 25); every brief digest equals the one in 03-49-dry-run.json"
        status: pass
    human_judgment: false

duration: continuation from the owner's reply of 2026-11-10 to 2026-11-11T00:15Z (earlier tasks 2026-11-10)
completed: 2026-11-11
---

# Phase 3 Plan 49: Run 1 finished in place, offline analysis, exit tools and the owner's decision Summary

**Offline, run 1's exact shape shows that adding the e2e spec to the write set is refused by design, and that answering C's option 2 finishes inside the write set; the exit tools now record the owner's relaxation of D-03 and check a brief's write set at the pin; the owner chose answer-2-in-place, run 3's brief was changed so neither of its owner choices can collide with a protected spec, and a new authorization is on file. No spend, no product change.**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Task 2 TDD, Task 3 the owner's decision, answered).
- **Spend in this plan:** 0 USD. Phase 3 stands at 11.1923 of 25 USD. Run 1 has 3.8871 of its 4.95 USD cap left; worst case with runs 2 and 3 at 4.95 each is 24.9794 USD.
- **Product code:** `git diff --exit-code 5ed69e0 -- src` is clean. No portfolio write: the portfolio's HEAD, status, refs and checkout digest are equal before and after every check (composite `sha256:36b38e48...`, HEAD `9f63d91`, 6 refs).
- **Commits:** 7 (`2fbb7bc`, `4d5caaf`, `bc768d4`, `9229acf`, `7fb9670`, `ce51b9b`, `12b3660`).

## What was measured (Task 1, `2fbb7bc`)

The offline suite plays the model with the fake run host and runs the real CLI, supervisor, ledger, gates and git, on run 1's shape (A and B committed, C parked on a pause-origin acceptance decision). The record is `03-49-finish-analysis.json`.

- **P, the protected add-write.** `contract amend --add-write tests/e2e/copy-email.spec.ts` (and `tests/e2e/x.spec.ts`, and `tests/e2e/**`) exits **64**, not 3, with `invalid add-write: ... is a protected path`. No confirmation is asked, the contract stays at version 1, and the decision, gate and evidence rows are byte-identical. A path outside the conventions' write set is refused the same way.
- **U, an unprotected path inside the conventions.** The amend works (contract v2, `files.write` and `files.create` added, `scope-conformance` invalidated, one stale gate row for G2). The owner's first answer is then stale: `decide` exits 3, no answer is applied, and a successor decision is opened with the first answer kept as context. The owner must answer the successor, after which the run reaches `ready_for_review`.
- **N, no amendment.** `decide <C's decision> 2 --wait` exits 0; C's resumed unit changes only paths inside the write set; the run reaches `ready_for_review` at contract v1 with commits for A, B and C. The declared check `test:e2e` is never run by the supervisor (`src/app/checks.ts` `checksToRun` runs only required and target checks), so the delivered tree fails it when run by hand and nothing records that.
- **Y, answering option 1.** Added during the plan. The answer widens nothing: the hook denies any write to `tests/e2e/**` (rule `protected-path`) whatever the owner answers. The live outcome after that denial is not predicted.
- **Owner's ledger, read-only.** Run `run_01M73RX3RF0ZJETYWVF52WFZ5B` holds contract version 1, protects `tests/e2e/**`, its write set lacks `tests/e2e/copy-email.spec.ts`, `test:e2e` is declared and not required, and C's decision `dec_01M73THARNM0VENR94QDX62BJ3` carries no amend command (`amend` is never offered).

## The exit tools (Task 2, `4d5caaf` red, `bc768d4` green)

- **`relax`.** `relax --evidence F --run-id R --decision D [--decision D2] --ref TEXT --by owner` writes `{ by: owner, ref, decisions, at }` into the run's entry and nothing else. `judgeFinish` accepts a second pause decision only through a valid relax record that names the owner's decision reference and the extra decision IDs, and each extra decision must be answered by the owner on the terminal. An amendment is accepted only as contract version 2 with `authorized_by`, `reason` and `diff`. Without the record the judge refuses as before.
- **Write-set check.** The dry run and a new `brief-check` subcommand read git objects at the pin only. They take the names the Behavior puts in backticks and the strings it quotes, look them up in every tracked file outside the brief's Write list, and report each hit as a problem when the file is protected or outside the conventions' write set. For run 1 it reports `tests/e2e/copy-email.spec.ts:5` (the `COPY_FALLBACK` value). `03-49-brief-check.json` holds the three briefs' findings at the pin; run 2 is clean.

## The owner's decision (Task 3)

The owner's replies of 2026-11-10:

1. **Run 1: answer-2-in-place.** The owner runs `decide dec_01M73THARNM0VENR94QDX62BJ3 2` in their own terminal in plan 03-50 (with `AVARICE_CLAUDE_BIN=/Users/aphan/.local/share/claude/versions/2.1.319`, no `CLAUDE_CONFIG_DIR`). C finishes inside the write set. Claude records the D-03 relaxation with the relax record in 03-50. The owner updates `tests/e2e/copy-email.spec.ts` after review.
2. **Run 2's brief stays unchanged** (digest `sha256:f0c9395b...`). Run 1's brief is unchanged too (`sha256:1a30e04c...`).
3. **Run 3's brief: R3-3 and R3-1 applied, R3-2 dropped.** The new digest is approved: `sha256:fe8742f43a9b1bfd2a01c8f1fbce1e6bccfa361807ae38b0906b20133f4052bd` (was `sha256:4019f329...`). Commit `ce51b9b`.
4. **Finding for the documentation plans (03-31 to 03-33) and `findings.md`:** a declared, non-required check (`test:e2e`) is never run by the supervisor, so a delivered tree can fail it with nothing recorded. Recorded in STATE.md; no product change.

### Run 3's item B, as changed

Item B's opening and its two options now read, verbatim:

> Item B: `ThemeToggle` is a toggle button with `aria-pressed` and the fixed name "Dark theme". Two accessible variants of the toggle-button pattern are acceptable and the choice is the owner's; stop and ask which one before changing anything. In both, the name "Dark theme" and `aria-pressed` stay exactly as they are:
> 1. Keep the toggle-button pattern: the fixed name "Dark theme" with `aria-pressed`.
> 2. The same toggle button with a spoken description added: the name "Dark theme" and `aria-pressed` as in option 1, plus a visually hidden description "Switches between the light and dark theme", linked with `aria-describedby`. The toggle is rendered in two bars, so each instance needs its own unique id for the description.

`tests/unit/use-theme.test.tsx` is added to the Write list, after `tests/unit/theme-toggle.test.tsx`. The planted "stop and ask which one" instruction and `expectedDecisions: 1` are unchanged.

I designed option 2 from the specs' actual assertions, read at the pin `9f1cd8d` through git objects. The seven protected e2e specs find the toggle by role and the name "Dark theme" and read `aria-pressed`, the thumb (`[data-part="theme-thumb"]`), the track (`.theme-track`) and the groove (`.theme-groove`); the unit test reads the name and `aria-pressed` on two toggles. None reads the toggle's accessible description, its text or its child nodes, and no unit test renders the header or pill bars. The one exact text match nearby is `getByText('Theme', { exact: true })` on the pill panel's label, which a longer description does not match. The `aria-describedby` assertions at the pin (`rail.spec.ts`, `sections.test.tsx`) belong to the project sleeves.

### Result of the re-check for run 3 (`03-49-brief-check-after.json`)

- **Runs 1 and 2:** unchanged digests and findings (run 1: one protected finding, `tests/e2e/copy-email.spec.ts:5`, the owner-judged case; run 2: none).
- **Run 3:** no real collision for either option with a protected spec or with `tests/unit/use-theme.test.tsx` (now in the Write list, so no longer a finding). The tool still reports 47 findings, because it lists every name the Behavior mentions whether the brief keeps or changes it: `aria-pressed` and "Dark theme" (both options say they stay), `data-theme` (item A keeps its value) and the new needle `aria-describedby`, held only by the project sleeves. The file classifies each finding as kept or added, checks that no needle is changed or removed, and records the grep of the pin for assertions on what option 2 adds (none on the toggle).

## 03-49-exit-authorization.json

Selection `answer-2-in-place`; `decisionRef` is the owner's replies of 2026-11-10 on top of STATE.md `5ed69e0`; brief paths and digests as above; `perRunCapUsd` 4.95; `ceilingUsd` 25; `spentUsdSoFar` 11.1923; run 1's remaining budget 3.8871; host pin 2.1.319 at `/Users/aphan/.local/share/claude/versions/2.1.319`; the brief-change approval; `ownerConfirmedAt` 2026-11-11T00:00:06Z; it supersedes `03-47-exit-authorization.json`. The task's checks pass: `field` reads the bin, cap and ceiling, and every brief digest equals the one in `03-49-dry-run.json`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A `brief-check` subcommand**
- **Found during:** Task 2
- **Issue:** the plan asked to run the write-set check on the three briefs without the rest of the dry run; the dry run's other checks write nothing but also fail on an unrelated state.
- **Fix:** `brief-check` runs only the write-set check and the portfolio snapshots (commit `bc768d4`).
- **Files modified:** `scripts/exit-run-phase3-tools.ts`

**2. [Rule 3 - Blocking] `authorizationOf` admits the in-place selections**
- **Found during:** Task 3
- **Issue:** the owner asked for `selection: answer-2-in-place`, and the tools (`field`, `authorize`, `evidence`) refused any selection but `approve`, so plans 03-50 and 03-30 could not read the file.
- **Fix:** red test `9229acf`, then `7fb9670`: `approve`, `answer-2-in-place` and `amend-unprotected-path` authorize a start; every other selection is still refused. Cases in `test/unit/exit-evidence.test.ts`.
- **Files modified:** `scripts/exit-run-phase3-tools.ts`, `test/unit/exit-evidence.test.ts`

**3. [Rule 3 - Blocking] The brief-digest test follows the new dry run**
- **Found during:** Task 3
- **Issue:** `test/unit/exit-drafts.test.ts` checked every brief's digest against `03-28-dry-run.json`; run 3's approved change made it fail.
- **Fix:** a new dry run, `03-49-dry-run.json`, records the three digests, and the test reads it (commit `ce51b9b`). The earlier dry-run files are untouched. The new dry run exits 1 by design: every problem it lists is the write-set check's (run 1's one owner-judged finding and run 3's 47 kept-name findings); its preflight, staleness, conventions, compile and `promptScope` results are all ok, 0 USD spent, no host launched. Its `fullCapsFit: false` (three fresh runs at 4.95) does not apply, because run 1 is not a fresh run (worst case 24.9794 of 25 USD).
- **Files modified:** `test/unit/exit-drafts.test.ts`

### Plan expectations that measured differently

- **Exit code 64, not 3,** for the protected add-write (usage error, `invalid add-write`), with nothing written. The scenario P assertions pin 64.
- **The non-required check is never run** by the supervisor; the plan expected "a non-required check failing" to be recorded. It is not recorded anywhere (finding 4 above).
- **Scenario Y** (answering option 1) was added; it was not in the plan.
- **The plan's verify `git diff --exit-code 5ed69e0 -- src test/benchmark/phase3`** now differs for `p3-run3-theme-toggle.md` by design, because the owner approved that change at Task 3. `src/` is unchanged.
- **`collect`'s contract fact** and the write-set heuristic details (names read from backticks and double quotes; a finding is a problem when protected or outside the conventions) are recorded in the analysis and the tool's comments. The first check, `03-49-brief-check.json`, is left as the record the owner decided from; the re-check is a new file.

**Total deviations:** 3 auto-fixed (Rule 3), 5 plan expectations that measured differently. **Impact:** none on scope; no `src/` change and no spend.

## Known Stubs

None.

## Issues Encountered

- The live outcome of answering option 2 is not predicted offline: the live C unit, resumed after the answer, must end with a VERIFICATION that G2 accepts, and its verifier read `gaps_found` for the same e2e gap before the question. Plan 03-50 finds out.
- The dry run's write-set check cannot tell a name a brief keeps from one it changes, so it reports problems for run 3 that are not collisions. A tool that reads "keep" from the brief is not built; the classification in `03-49-brief-check-after.json` stands in for it.

## Next Phase Readiness

Ready for plan 03-50: the owner runs `decide dec_01M73THARNM0VENR94QDX62BJ3 2` in their own terminal, then Claude finishes run 1 with `--finish` and records the relax record, then starts run 2 and run 3 under this authorization. Plans 03-29, 03-42, 03-45 and 03-48 stay halted until then; 03-30 stays blocked.

## Self-Check: PASSED

All ten created or modified files exist and all seven commits are on the branch (`git log 491cfd6..HEAD`).
