---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 36
subsystem: testing
tags: [ac-8, evaluation-harness, retrieval, knowledge-pass, d-08, evidence]
requires:
  - phase: 04
    provides: plan 04-31 evaluation harness and approved task list, plans 04-34 and 04-35 (live-spend ledger, ceiling)
provides:
  - "AC-8 measured over 6 portfolio tasks: verdict fails on tokens (B 94.4 percent, C 88.5 percent of A, bound 50 percent)"
  - "D-08 applied: the knowledge pass stays on, default unchanged"
  - "per-run evidence of 19 runs under 04-36-evidence (decision records, rows, steps, events, host transcripts), redacted and bounded"
  - "the three harness fixes the runs needed (tool-cache writes, prettier ignore, brief scope paragraph) and the evidence capture"
affects: [04-37, 04-39, ADR-015]
actuals:
  tokens: 16872
  tasks: 3
  commits: 22
plan_head_before: e0986bd13f7e6359be30c6ea1b4d99a795da6552
plan_head_after: 4afbcaae1470f8890cfcc9d3545f680cfc06a4bc
tech-stack:
  added: []
  patterns: ["copy the run's own records into a redacted, capped evidence directory before the scratch is removed", "a brief wrapper that states the checks that can run, the same for every arm"]
key-files:
  created:
    - test/benchmark/phase4/eval-results.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-evidence-eval.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-pilot.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-pilot-results.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-portfolio6-t01-blocked-results.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-diagnostic2-results.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-evidence/
  modified:
    - scripts/eval-retrieval.ts
    - test/unit/eval-retrieval.test.ts
    - test/containment/live-spend-phase4.jsonl
key-decisions:
  - "AC-8 judged over the 6 portfolio tasks (owner ruling 2): it fails, B and C match A's success (4 of 6 against 2 of 6) at 94 and 89 percent of A's tokens"
  - "D-08 rule applied as written: C has no success gain over B and costs fewer tokens, so the knowledge pass stays on and adapters.knowledgePass keeps its default true"
  - "The stop of the first portfolio-6 attempt is classified as the brief (harness) and fixed with a scope paragraph in briefFor, not as a product defect"
requirements-completed: [FR-3, FR-22]
coverage:
  - id: D1
    description: "AC-8 is measured over the owner-ruled 6-task set and the verdict is recorded by the harness's verdict function"
    requirement: FR-3
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#carries the AC-8 verdict and the D-08 outcome at the top level, equal to the summary, with the header and the runs kept"
        status: pass
      - kind: other
        ref: "node -e (the plan's verify) over test/benchmark/phase4/eval-results.json prints {\"ac8\":false,\"knowledge\":\"on\"}"
        status: pass
    human_judgment: true
    rationale: "A 6-task, one-repository sample with 6 of 18 runs ended by a verifier or gate stop; whether it answers SC2 is the owner's reading, and the spot-check of three successful runs is the owner's human check"
  - id: D2
    description: "The D-08 rule is applied and the knowledge-pass default follows it (unchanged: on)"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#verdict (AC-8) and knowledgeRule (D-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The harness keeps per-run evidence before it removes a scratch, redacted with the AVARICE redactor and capped at 5 MB a run"
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#the per-run evidence the harness keeps (plan 04-36, owner ruling 3)"
        status: pass
      - kind: integration
        ref: "node --test test/integration/redaction-suite.test.ts (5 of 5) and a findSecrets scan of 278 evidence files, 46.8 MB, 0 hits"
        status: pass
    human_judgment: false
duration: "5h 44m (the continuation after owner ruling 3, 2026-11-20T02:06Z to 07:50Z; the plan began 2026-11-18)"
completed: 2026-11-20
status: complete
---

# Phase 4 Plan 36: AC-8 evaluation and the D-08 knowledge-pass decision Summary

**AC-8 fails on the token half over 6 portfolio tasks (arms B and C succeed twice as often as A, 4 of 6 against 2 of 6, but use 94 and 89 percent of A's tokens against a 50 percent bound), and the D-08 rule keeps the knowledge pass on; the harness now keeps redacted per-run evidence, which classified the stop that halted the first portfolio-6 attempt as the brief.**

## Performance

- **Duration:** 5h 44m for the continuation after owner ruling 3 (2026-11-20T02:06Z to 07:50Z); the plan began 2026-11-18
- **Tasks:** 3 (task 1 the dry run, task 2 the owner's authorization checkpoint, task 3 the evaluation)
- **Commits:** 22 measured from the ledger base (`e0986bd`, itself a 04-36 commit, so 23 in all), plus the close-out commit
- **Files modified:** 3 code and test files, 6 planning records, the 19-directory evidence tree

## Accomplishments

- **Verdict (AC-8):** FAIL. A 2 of 6 successes, 19,833,920 tokens. B 4 of 6, 18,715,894 tokens (94.4 percent of A). C 4 of 6, 17,557,851 tokens (88.5 percent of A). Success matches (B and C at least A), the token bound does not.
- **D-08 outcome:** knowledge pass stays ON. C shows no success gain over B (4 and 4) and costs fewer tokens than B, so the rule does not say off. `adapters.knowledgePass` keeps its default `true`; nothing under `src/` changed in this plan.
- **Evidence capture** (owner ruling 3): before a run's scratch is removed, the harness copies the decision records, run, work-item, attempt, step and contract rows, all events (hook decisions among them) and the host transcript into `04-36-evidence/<task>-<arm>`, redacted and capped at 5 MB. 19 run directories, none truncated.
- **Diagnosis:** the first portfolio-6 attempt stopped on T01 in all three arms. The kept evidence classified the cause as the **brief** (below), fixed offline; portfolio-6 then ran 18 of 18 with no stop.

## Owner rulings and task-set changes (20 to 9 to 6)

| # | When | Reply (verbatim) | Effect |
|---|------|------------------|--------|
| 1 | 2026-11-19T04:47:08Z | "authorize balanced-9 pilot 11.70 total 33.00." | task set 20 to **balanced-9** (T01, T04, T06, T07, T10, T13, T16, T17, T20), pilot 11.70 USD, plan total 33.00, guard 36.93, AC-8 judged over 9 tasks; harness changes authorized (`--task-ids`, `--merge`, arm C onboarding cap 0.90 to 1.10) |
| 2 | 2026-11-19T17:48:42Z | "diagnose, then portfolio-6" | task set 9 to **portfolio-6** (T01 to T06, one repository), AC-8 over 6 tasks; one diagnostic of T01 arm B authorized |
| 3 | 2026-11-20T02:06:38Z | "keep evidence, diagnose" | the evidence capture, the three blocked T01 entries moved aside, one diagnostic of T01 arm B (cap 0.40), then resume on a harness-side cause |

`eval-tasks.json` and its sha256 (`3de7b108...15d92`) were never edited; the sets are selected with `--task-ids`. All three rulings were recorded in `04-36-evidence-eval.json` before any spend that depended on them.

## Offline probe (no model, no spend)

Each balanced-9 task's parent was put through the harness's own judging path. The held-out test fails at the parent for all 9 tasks (no free success). On 6 of the 9 (T07, T10, T13: no `requests` or `gspread` in the PATH python3; T16, T17, T20: a Postgres `TEST_DATABASE_URL` in vitest's globalSetup) success is impossible in this harness for every arm, independent of retrieval. Only the portfolio tasks (T01, T04, T06, and with them T02, T03, T05) are judgeable, which is why ruling 2 narrowed the set.

## Diagnostics and classifications

1. **Pre-model block (diagnostic 1, T01 arm B, `--keep`, 0.0839 USD).** Every run ended `blocked_on_decision` before any model call. The run validates each required check once in a clone and rejects a check that writes a path it does not declare; `tsc -b` writes `node_modules/.tmp/*.tsbuildinfo` and vitest writes `node_modules/.cache`, `.vite`, `.vite-temp`, `.vitest-cache`, and the harness's conventions declared no `writes`. **Classification: harness defect** (the arm repository's conventions). Fix `e76f7cc` (RED `a0c1989`): `conventionsFor` declares those globs as `writes` for a repository with an npm lockfile.
2. **Post-model block (diagnostic 2, T01 arm B, evidence on, 0.2025 USD).** The unit changed `src/anim/MotionFeatures.tsx`, added a unit test, all four required checks passed (316 tests), then the GSD quick verifier could not verify the e2e bullet of the brief ("Add unit and e2e coverage for the reduced-then-off case"; its spec is a denied read and `npm run test:e2e` is neither a required check nor an allowed command), wrote `status: human_needed`, and the run opened an acceptance decision (run transition signal `verification-human-needed`). The one hook denial (Bash `ls -d .planning/quick/*/`, rule `shell-syntax`) was recovered from. **Classification: the brief** (harness), not a product defect (a `human_needed` verification pausing is documented behaviour) and not a design decision. T02 and T05 briefs ask for e2e work too. Fix `12b5d19` (RED `e6d3b5a`): `briefFor` keeps the commit message whole and adds one scope paragraph, the same for every task and arm, naming the required checks and ruling end-to-end or browser tests out of scope.

The T01 arm C stop of the first attempt (a 6-turn, 12.5 s haiku invocation, 2 hook and 2 host denials, class `permission`) lost its transcript with the scratch and is not classified; no run of the resumed portfolio-6 ended that way.

## Results: per task and arm (portfolio-6, `eval-results.json`)

S = judged success. `no branch` = the run ended on a decision and left nothing to judge. Tokens are the run's own invocations.

| Task | A | B | C |
|------|---|---|---|
| T01 | S (2,486,811) | S (3,129,909) | no branch: verifier `human_needed` (two behaviours reviewed in code, not covered by a test) |
| T02 | no branch: verifier `human_needed` (only reason: `.planning/config.json` modified at session start) | no branch: `repeated_failure`, 3 consecutive hook denials (the verifier subagent's `git -C <clone> diff, status, show`, rule `shell-not-allowed`, then `ListAgents` and `SendMessage`) | S (2,372,642) |
| T03 | no branch: gate G2, VERIFICATION `gaps_found` (format:check failing on `Sleeve.tsx`; the unit could run only the four named commands) | S (2,877,492) | S (3,210,746) |
| T04 | no branch: verifier `human_needed` (could not run the other gates) | S (3,399,716) | S (2,382,964) |
| T05 | S (3,993,902) | S (3,669,406) | no branch: verifier `human_needed` |
| T06 | branch, judged no success (test and held-out failed) | branch, judged no success (test and held-out failed) | S (2,545,102) |

| Arm | Successes | Run tokens | Share of A | Run cost | Mean run cost | Mean setup (onboarding, A's map) | Mean cost per run with setup | No branch |
|-----|-----------|-----------|------------|----------|---------------|----------------------------------|------------------------------|-----------|
| A | 2 of 6 | 19,833,920 | 100 percent | 1.0592 | **0.1765 USD** | 0.1904 | 0.3669 | 3 |
| B | 4 of 6 | 18,715,894 | 94.4 percent | 0.8342 | **0.1390 USD** | 0.1174 | 0.2564 | 1 |
| C | 4 of 6 | 17,557,851 | 88.5 percent | 0.8663 | **0.1444 USD** | 0.8293 | 0.9737 | 2 |

Stop conditions of the resumed run: 6 of 18 without a branch (4 verifier `human_needed`, 1 loop limit, 1 gate G2), 0 `budget_exhausted`, 0 judging errors (below the 9-of-18 stop); no task ended without a branch in all three arms; the cap bound (24.60 USD) fit throughout. Three successful runs for the owner's spot-check, drawn at random from the 10: **T01-B** (`run_01M7VE1FD4W0XB8JVCV66Z00GK`), **T04-C** (`run_01M7VR7YZ4QR908ENT6WPN0JG8`), **T05-A** (`run_01M7VS76KK7S2AGASBZ4W1JX5M`). The result is pending the owner and does not change the verdict (D-07).

## Arm definitions against the spec's three arms

A: the baseline (D-06), `adapters.context` empty, the GSD codebase map the agent finds in its own checkout (generated at the parent when it has none, committed before the onboarding). B: the pack from the code-only graph (`gsd-intel`, `gsd-graph`, `knowledgePass` false). C: the same pack with the knowledge graph (`knowledgePass` true). Every arm runs in its own scratch repository at the task's parent; the held-out test is copied into a separate judging clone only after the agent stopped.

## Spend

| | Phase 4 | Plan 04-36 |
|---|---------|-----------|
| Pilot (3 blocked T01 runs, setups) | | 0.8853 |
| First portfolio-6 attempt (T01, 3 arms) | | 1.3354 |
| Diagnostic 1 (T01 arm B) | | 0.0839 |
| Diagnostic 2 (T01 arm B, evidence on) | | 0.2025 |
| Portfolio-6, 18 runs (runs 2.7597, setup 6.8225 of which arm C onboarding 4.9755) | | 9.5822 |
| **Total** | **16.0159 of 40** (94 ledger lines, guard 36.93) | **12.0892 of 33.00** |

## Harness changes (`scripts/eval-retrieval.ts`, tests in `test/unit/eval-retrieval.test.ts`, 46 tests)

- `--task-ids`, `--merge`, arm C onboarding cap 1.10 (ruling 1); `.avarice/` in `.prettierignore` at the setup commit (a defect found before any spend); declared tool-cache `writes` (diagnostic 1); the brief scope paragraph (diagnostic 2); `--evidence-dir`, `captureEvidence`, `settleScratch` (ruling 3, `AVARICE_DEBUG_TRANSCRIPTS=1` so the whole redacted transcript is stored); `resultsDocument` writing `verdict` and `knowledgeRule` at the top level, which the plan's automated check reads.
- Verification: unit suite 2875 of 2875, `npm run typecheck` clean, `npm run check:boundaries` clean, redaction suite 5 of 5.

## Commits

Task commits (this continuation): `e4e6796` ruling 3; `8ac3a84` RED and `e1a9fce` GREEN (evidence capture); `e6d3b5a` RED and `12b5d19` GREEN (brief scope paragraph); `9b7472b` and `4edfa44` diagnostic 2 record and evidence; `acf2f7c` RED and `fc9476d` GREEN (verdict at top level); `4afbcaa` portfolio-6 results and evidence. Earlier in the plan: `e0986bd`, `745ef8c`, `68f46e3`, `d27fa26`, `88023b5`, `0819735`, `7c0add9`, `b7ae073`, `3b03f17`, `a0c1989`, `e76f7cc`, `8636bc5`, `4bb0995`.

## TDD Gate Compliance

RED then GREEN held for each harness change: the evidence capture (`8ac3a84`, `e1a9fce`), the brief scope paragraph (`e6d3b5a`, `12b5d19`), the results document (`acf2f7c`, `fc9476d`). Each RED failed on the planned target (a missing function, an unknown flag, a missing paragraph). One test constant was corrected after its RED commit (the results-document test's arm C tokens, 450 to 350, so the planned outcome was `on`); the correction is in the GREEN commit and did not change what the RED run showed.

## Deviations from Plan

The plan said a 3-task pilot then the remaining 17 tasks into one results file. It ran differently, by owner ruling, and the deviations are recorded above (task set 20 to 9 to 6, a different results file, three authorized diagnostics).

**1. [Rule 3 - Blocking] Tool caches rejected the required checks** found during the pilot. Fix `e76f7cc`.
**2. [Rule 3 - Blocking] The conventions file failed the repository's prettier check** found before any spend. Fix `0819735`.
**3. [Rule 1 - Bug] The brief asked for work the harness cannot run** found by diagnostic 2. Fix `12b5d19`.
**4. [Rule 2 - Missing critical functionality] The harness removed a run's evidence with its scratch** (ruling 3). Fix `e1a9fce`.
**5. [Rule 1 - Bug] The results file lacked the `verdict` and `knowledgeRule` keys the plan's verify reads.** Fix `fc9476d`; the file was rewritten once through `resultsDocument` (summary asserted equal).
**6. [process]** the move of the blocked T01 entries to `04-36-portfolio6-t01-blocked-results.json` was staged before the RED commit `e6d3b5a` and landed in it.

**Total deviations:** 5 auto-fixed, 1 process note. **Impact:** none under `src/`; the approved task list is untouched.

## Limits

- 6 tasks on one repository; one task is 17 percent of a rate. The other repositories cannot be judged in this harness.
- 6 of 18 runs ended on a verifier or gate stop and count as non-successes whatever the cause. A lost 3 of 6 this way, which depresses A's rate and so favours the success half of AC-8 for B and C; the token half fails regardless.
- Token totals are the host-reported totals of each run's own invocations; setup (onboarding, map generation) is reported separately and not in the verdict. Arm C's onboarding averages 0.8293 USD against 0.1174 for B.
- The offline test shows the brief carries the scope paragraph; the resumed run shows it worked for T01 arms A and B. Verifier `human_needed` stops still happened in 4 runs for other reasons.
- Evidence transcripts carry the portfolio text the runs read, which the AC-5 secret rules do not address (see Threat Flags).

## Observations for plan 04-37 (not changed here, nothing under src/ was touched)

- **Findings candidate:** AVARICE writes the GSD settings into the clone's tracked `.planning/config.json` before the unit runs (D-17), so `git status` shows it modified at session start. Units and verifiers report it ("modified from the start, not caused by this change") and the verifier's `human_needed` follows in 3 of the 6 no-branch runs (T02 A: its only stated reason; T04 A and T05 C: noted). Evidence: `04-36-evidence/T02-A`, `T04-A`, `T05-C`.
- **Findings candidate:** a verifier subagent's calls count toward the invocation's consecutive-denial limit; `git -C <path>` is refused as `shell-not-allowed`, and 3 consecutive refusals ended T02 B in a `repeated_failure` decision (`04-36-evidence/T02-B`).
- **docs/system surfaces for 04-37:** none of `docs/system/` mentions the evaluation harness, `adapters.knowledgePass` or AC-8; 04-37 records the D-08 outcome as ADR-015 (knowledge pass stays on) and, if it documents the harness, `runs.md` (the `verification-human-needed` pause and the loop limit), `containment.md` (shell rules `shell-syntax`, `shell-not-allowed`), `data-model.md` (artifact kinds `transcript` and `transcript-summary`, the `AVARICE_DEBUG_TRANSCRIPTS` opt-in), `config-reference.md` (`adapters.knowledgePass`), `coverage.md` and `findings.md` for the two candidates above.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure | `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-evidence/*/transcripts/` | 19 committed directories (about 46 MB) hold host transcripts that include text of the owner's private portfolio repository that each run read. Secret patterns are redacted (0 hits); repository source is not. The branch has not been pushed; the owner decides before any push whether to keep, trim or ignore this directory. |

## Self-Check: PASSED

Verified: `eval-results.json` holds 18 runs and prints `{"ac8":false,"knowledge":"on"}` through the plan's verify command; `04-36-evidence` holds 19 run directories; commits `e4e6796`, `8ac3a84`, `e1a9fce`, `e6d3b5a`, `12b5d19`, `9b7472b`, `4edfa44`, `acf2f7c`, `fc9476d`, `4afbcaa` are on the branch; `phase4Spent()` 16.0159 of 40.
