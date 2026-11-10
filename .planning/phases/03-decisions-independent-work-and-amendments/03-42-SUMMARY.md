---
phase: 03-decisions-independent-work-and-amendments
plan: 42
subsystem: exit-benchmark
status: halted
tags: [exit-run, portfolio, d-03-stop, resume, claude-config-dir, start-judge]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-40: the scoped item prompt and the pause attribution; plan 03-41: the dry run, the 5.62 USD authorization and the superseded evidence file"
provides:
  - "03-42-evidence-exit.json: run 1's record on the repeat, a D-03 stop at the finish stage with the diagnosis"
  - "a corrected start judge (judgeStart, judgeFinish and collect take the item that asked as the owner-choice item), with tests"
affects: [03-29, 03-30, phase-3-exit]

actuals:
  tokens: 30000
  tasks: 1
  commits: 5
plan_head_before: f57d65d549fce322792d4048dc88050fe0d59021
plan_head_after: a043e4eebab9a8c5c99f61bc618e21a28113f94a

key-files:
  modified:
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-42-evidence-exit.json
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "Owner decision (2026-11-10): fix the start judge, judge run 1's start again, and continue to the owner's answer. The first verdict stays in earlierJudgements as history."
  - "The plan stops at the finish stage of Task 2 under D-03. Run 2 was not started, 03-29-SUMMARY.md is untouched, and no decision was answered, amended, cancelled or resumed by Claude."

requirements-completed: []

coverage:
  - id: D1
    description: "Run 1 starts on the real portfolio and blocks only the owner-choice item on its own pause with item A committed"
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase3.sh --run test/benchmark/phase3/p3-run1-copy-fallback.md, judged again after the judge fix: problems [], stopOk true"
        status: pass
    human_judgment: false
  - id: D2
    description: "After the owner's answer, item B's own session resumes and run 1 reaches ready_for_review"
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase3.sh --finish run_01M71J9AVJ3N1BEKC4EM2P0GGF (exit 1, nine problems in 03-42-evidence-exit.json)"
        status: fail
    human_judgment: true
    rationale: "Not achieved: the resume found no conversation under the owner's terminal environment, and a fresh session then failed gate G2. A fix and the owner's decision on the repeat are needed (D-03, D-05)"

duration: run 1 start 2026-11-10T01:48:41Z; finish 2026-11-10T02:17:31Z to 02:21:08Z
completed: 2026-11-10
---

# Phase 3 Plan 42: Exit part 1 repeated, run 1 Summary

**Run 1 stopped on item B's own pause with item A committed, as expected, but after the owner's answer the host could not find item B's session, so the supervisor started a new one, which failed a gate: the repeat did not reach ready_for_review and the plan halts under D-03.**

## Performance

- **Tasks:** 1 of 3 executed. Task 2 (the owner's answer, then `--finish`) ran and failed its verification. Task 3 (run 2 and the resume of 03-29) was not run.
- **Live spend in this plan:** 1.0682 USD (start 0.2402, finish 0.8280). Phase 3 spend is now 9.1851 USD of 25 USD.
- **Host:** claude 2.1.319 at the pinned path; `AVARICE_LIVE_ADMIT_CLAUDE_VERSION` never set.

## What happened

### Task 1: the start (run `run_01M71J9AVJ3N1BEKC4EM2P0GGF`)

The run started at 01:48 and stopped `blocked_on_decision`: item A done with commit `107679f5f4bf21619e3a48937655d9b84509fa6a` (haiku, session `5b2c278f-...`, one attempt), item B blocked on one pause-origin decision (`dec_01M71JMC67N5M4NVZ329CHNBGV`, numbered-choice, contract version 1, two wordings), item C ready with no attempt, one notification. Checkout digest equal before and after; no new ref.

The start judge first flagged item C: it read the decision's affected set (B and C) as two "owner-choice" items. That was a judge defect, not a run defect (see Deviations). Commits `2c05791`, `947b889` and `65f3de1` fixed it, with failing cases first, and judged the stored run again: problems `[]`, `stopOk true`. The earlier verdict is kept in `earlierJudgements`.

Whether A's classify step carried `pauseAttributedTo`: no. Item A did not ask at all, which the plan names as the expected effect of the prompt fix.

### Task 2: the owner's answer and `--finish`

The owner answered `dec_01M71JMC67N5M4NVZ329CHNBGV` in their own terminal at 02:17:31Z: option `2` (`Couldn't copy the address. Opening your mail app to <address>.`), answered by `owner:aphan`, channel `terminal`.

`--finish` then ended `blocked_on_decision` again, cost 1.0682 USD for the run, nine problems:

| Attempt | Reason | Session requested | Host init sessions | Outcome |
| ------- | ------ | ----------------- | ------------------ | ------- |
| 3 | resume | `a8cdde62-fe5d-43e8-b962-3c22c3ff027e` (B's recorded session) | none | discarded after 1.6 s, cost 0 |
| 4 | answer | `9ea84e6b-56e8-4514-a727-a4d4da28984e` (new) | `9ea84e6b-...` | blocked: gate G2 failed |

Attempt 4 ran a full quick workflow (planner, checker, executor and verifier; 0.8280 USD) and opened a second decision, `dec_01M71M4PB9EQJFNH0S75HTYWSR` (origin `G2:gsd-verification`, "GSD VERIFICATION status is missing, not passed", free-text answer). Item B is blocked, item C never ran, there is no handed-off commit and no run branch ref in the portfolio. The checkout composite digest is equal before and after (`sha256:36b38e48...`), and no ref was added or changed. Notifications: two (one per decision), where the expected single block yields one.

## Diagnosis (D-03)

**The resume failed on its own terms.** The attempt-3 transcript is one `error_during_execution` result: `No conversation found with session ID: a8cdde62-fe5d-43e8-b962-3c22c3ff027e`. The session file exists at `~/.claude-edu/projects/<run clone>/a8cdde62-....jsonl`. The fresh session's file is at `~/.claude/projects/<run clone>/9ea84e6b-....jsonl`.

The cause is the host's configuration directory. The start ran from this executor session, where `CLAUDE_CONFIG_DIR=/Users/aphan/.claude-edu`, so B's first session was stored under `~/.claude-edu`. The owner's terminal ran `avarice decide` without that variable, so the supervisor it launched used the default `~/.claude`, where the session does not exist. `claude -p --resume` does not search across configuration directories.

So the run meets neither SC3 condition. The resumed session did not equal the recorded one, and the host init event did not report it (the resume produced no init). The supervisor's fallback (a fresh "answer" attempt in a new session, with the owner's answer in the prompt) is by design, but it is where the second failure came from: the fresh unit did not leave a passing GSD VERIFICATION, so gate G2 parked B on a new decision. That second failure is a consequence, not a separate cause, and has not been diagnosed further.

Neither failure is a defect of the plan's script: `--finish` judged what it found. The open points for a fix plan or the owner, none attempted here:

1. The supervisor does not record or pin the host's configuration directory with the run. A run started under one `CLAUDE_CONFIG_DIR` and answered under another loses its sessions. Options: record the directory at start and use it on every later launch; or fail `decide` visibly when the environment differs; or make the exit script print the `CLAUDE_CONFIG_DIR` the owner must keep.
2. The owner command the script prints names `AVARICE_CLAUDE_BIN` only. It could name `CLAUDE_CONFIG_DIR` too when set, or the repeat could start from a terminal with the owner's own environment.
3. Whether a failed resume should fall back to a fresh session silently (it cost 0.8280 USD here and ended in a gate decision) is a product question for the owner.

## State left behind

- Run 1 is `blocked_on_decision` in the owner's profile with the first decision answered (option 2) and one open gate decision `dec_01M71M4PB9EQJFNH0S75HTYWSR`. Nobody answered it. The owner may cancel the run with `avarice cancel`; its branch was never fetched.
- Run 2 was not started. 03-29-SUMMARY.md is unchanged and still `status: halted`, so plan 03-30 stays blocked.
- A repeat needs a new evidence file (the evidence file refuses a second start of the same brief digest) and the owner's spend decision (D-05): Phase 3 is at 9.1851 of 25 USD, headroom 15.8149. Two runs at 5.62 fit (11.24); three do not (16.86). D-03 counts a repeat from run 1, so the owner decides how the remaining headroom is used.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The start judge counted every item a decision affects as an owner-choice item**
- **Found during:** Task 1 (judging run 1's start)
- **Issue:** A pause decision on B lists B and C as affected. The judge took both as owner-choice items and reported item C as wrongly blocked, although C was ready with no attempt.
- **Fix:** `judgeStart`, `judgeFinish` and `collect` take the item that asked (the one whose attempt parked on the pause) as the owner-choice item. Failing cases first.
- **Files modified:** `scripts/exit-run-phase3-tools.ts`, `test/unit/exit-evidence.test.ts`
- **Commits:** `2c05791` (RED), `947b889` (GREEN), `65f3de1` (run 1 judged again)
- **Owner decision (2026-11-10):** "fix the judge, re-judge, continue". The first verdict is kept in `earlierJudgements`; nothing about the run itself changed.

**Total deviations:** 1 auto-fixed (Rule 1). **Impact:** none on the run; the verdict on the start is now the same one a correct reading of the brief gives.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. T-03-93 held (checkout digests equal before and after, no ref added or changed, nothing written to the portfolio). T-03-94 held (per-run cap 5.62 USD, run 1 total 1.0682 USD; the guard ran before the start). T-03-95 held (the owner answered in their own terminal; Claude ran only `--run` and `--finish`). T-03-96 held (03-29-SUMMARY.md untouched).

## Next Phase Readiness

Blocked. Run 1 did not reach ready_for_review, so 03-29 stays halted and plan 03-30 stays blocked. A fix for the configuration-directory loss (or the owner's choice to start and answer from one environment) and the owner's spend decision are needed before any repeat.

## Self-Check: PASSED

Files exist: `.planning/phases/03-decisions-independent-work-and-amendments/03-42-evidence-exit.json`, `test/containment/live-spend-phase3.jsonl`. Commits `e39e9a0`, `2c05791`, `947b889`, `65f3de1` and `a043e4e` are ancestors of HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10 (halted at Task 2)*
