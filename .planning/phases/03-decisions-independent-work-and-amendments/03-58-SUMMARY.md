---
phase: 03-decisions-independent-work-and-amendments
plan: 58
subsystem: exit-run3-attempt1
tags: [exit, run3, attempt1, d-26, d-27, d-28, d-29, d-33, d-36, brief-harness-defect, halted]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-68's run 2 attempt 3 (passed, confirmed by the owner) and plan 03-56's authorization
provides:
  - "03-57-evidence-exit.json: run 3's attempt 1, its stop, Claude's proposal (product-defect) and the owner's confirmed ruling (brief-harness-defect, overriding the proposal)"
affects: [03-59, 03-60, gap-plan]

actuals:
  tokens: 4000
  tasks: 3
  commits: 2
plan_head_before: ec5fc0efa5a05b75045fd53df872592416757197
plan_head_after: 5527e8170c206a192c2c1b4571023109186fa73b

key-files:
  created: []
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "Run 3's attempt 1 stopped unexpectedly at its start (two open pause decisions, not one), so Task 2 was not presented and Task 3 became the owner's ruling on the stop: brief-harness-defect, option brief-harness-defect-fix-first"

requirements-completed: []

completed: 2026-11-12
status: halted
---

# Phase 3 Plan 58: Run 3's attempt 1 started once, stopped on item A's human_needed verification, ruled a brief-harness-defect (fix first) Summary

**Run 3's attempt 1 stopped on two open pause decisions instead of the one its brief plants. The cause was that the unit's verifier and executor subagents had no content-search route: the Grep tool was absent from their sessions and shell `grep` is denied by design. The owner ruled this a brief or harness defect and chose to fix it before any re-run; the follow-up is a gap plan and run 3's re-run comes before run 1.**

## Profile config (read-only)

The owner's profile config at `~/.config/avarice/profiles/personal-local/config.json` held `notify.local.osascriptPath` = `/nonexistent/osascript` and `notify.batchWindowMinutes` = 1 when Task 1 started, so the precondition held. Claude edited no profile file. It still holds both forced values now (see the reminder below).

## Task 1 (tracer, commit 85e8130)

- Run `run_01M78966NJ0SW8NB54564MFFZW`, run 3, attempt 1, plan 03-58, host 2.1.319, cap 4.50 USD, expects `silence`. Started once. Spend 0.2520 USD of 4.50; Phase 3 ledger 12.8938 USD of 25.
- The run stopped `blocked_on_decision` on two open pause decisions. The evidence entry records four problems:
  1. the run has 2 decisions, 2 open; D-02 wants exactly one, open;
  2. the decision lists 0 choice options, not the two wordings;
  3. item B is independent of the decision and is `blocked_on_decision`, not `done`;
  4. the run has 2 notification rows, not one.
- Decisions: item A `dec_01M789NHY4VJXZBCGKXTQMH8NW` (`verification-human-needed`, free-text only); item B `dec_01M789NR2ES83AXM6DECC2FER2` (the planted numbered choice with its two wordings). Both banners were queued with lastError `osascript-missing`, so the forced failure held.
- Item A's change was made (THEME_ATTRIBUTE exported and used in `src/lib/theme.ts`; typecheck, lint, test and the other required checks passed; `format:check` failed and was reported pre-existing). Its verifier wrote `human_needed` because it could not search the repo for THEME_ATTRIBUTE outside the file; it asked a human to run `grep -rn THEME_ATTRIBUTE src`.
- Checkout digests were equal before and after, and no new ref appeared. The silence step was not run: it needs the one expected decision.

## Claude's proposal (D-26), and the owner's override

Claude proposed `product-defect` (stopped by item A's own VERIFICATION status `human_needed`, pause signal `verification-human-needed`, not a gate; at `src/domain/invocation-scope.ts:82`, `src/domain/outcome.ts:116`, `src/app/run-stages/item.ts:390`, `test/benchmark/phase3/p3-run3-theme-toggle.md:13`; docs/system conformant, `docs/system/runs.md`). Claude's proposal named one point it could not establish: whether the verifier subagent had no Grep tool, or tried shell grep and was refused, because the transcript was not in the evidence. It offered `brief-harness-defect` as the alternative reading.

The owner replied, verbatim: "brief-harness-defect-fix-first". This overrides Claude's proposal. The record is the owner's class, not Claude's: `classification.confirmed` is `by: owner`, `class: brief-harness-defect`, `overrides: product-defect`, `ref` quoting the reply, the plan 03-58 Task 3 checkpoint and the date 2026-11-12 (commit 5527e81). The tools' classify record has no evidence field, so the evidence below is quoted here.

## The orchestrator's transcript evidence (resolves the "not established" point)

The orchestrator read run 3's host transcripts, read-only, under `/Users/aphan/.claude-edu/projects/-Users-aphan--local-share-avarice-work-personal-local-run-01M78966NJ0SW8NB54564MFFZW-clone/` (session `616c89e9-5e1e-4b80-b688-3465a6939b45` and its `subagents/`):

- Every Grep tool call by the verifier subagent (`agent-aa10144838527a9e4`) and the executor subagents (`agent-ad36b9e87cb661fc0`, `agent-af85207ef6cb8515a`) failed with `<tool_use_error>Error: No such tool available: Grep. Grep is not available in this session — search file contents with grep via the Bash tool instead.</tool_use_error>`.
- Every shell `grep` they then tried (for example `grep -rn "data-theme" src tests index.html 404.html` and `grep -rl THEME_ATTRIBUTE src tests index.html 404.html`) was refused by the PreToolUse hook: `avarice: shell-not-allowed: this command is not admitted; ...`.
- So the run had no content-search route at all: the Grep tool was absent from those sessions, and shell grep is denied by design. The verifier's `human_needed`, and the unplanned pause `dec_01M789NHY4VJXZBCGKXTQMH8NW` that followed, came from that.

This corrects one detail of Claude's proposal: Claude read "searches go through the Grep tool" as the working route. In the run's sessions that route did not exist. The tool error itself told the agents to use shell `grep`, which the hook then refused, so the two instructions contradict each other.

## Task 2

Not presented. The start stopped unexpectedly, so the precondition (`silent-and-open-as-expected`) did not hold. Claude ran no `avarice cancel`, `contract amend`, `decide` or `resume`, and no `--silence` or `--finish`.

## Task 3 (the owner's ruling)

The owner replied `brief-harness-defect-fix-first` (halt, fix it, re-run run 3 before run 1). Recorded with `classify --confirm --by owner --class brief-harness-defect`. Automated checks: `run3-stop-ruled:brief-harness-defect`; Phase 3 spend 12.8938 USD (at most 25), this plan 0.2520 USD (at most 4.50).

## Spend and what remains

- Run 3 attempt 1: 0.2520 USD of 4.50. Ledger 12.8938 of 25. Run 1 headroom: 25 - 4.50 - 12.8938 = 7.6062 USD (run 1's start is refused with exit 75 below zero, D-05, D-33).
- Run 3 has 1 failed attempt in its epoch, so its re-run is attempt 2 of 2 (D-29 as amended by D-36). A second failure would end the exit for the owner and need a reset with D-37's proofs.

## Why this plan is halted, and the follow-ups

The stop is evidence, not a pass (D-28). Nothing was started or spent after the ruling.

1. A gap plan fixes the content-search route: the Grep tool's availability in the unit's and its subagents' sessions, and/or a documented admitted search path, so a unit and its verifier can search repo contents. It comes with an offline, no-spend reproduction that shows the unit's sessions can search before any live spend. The plan names this; the owner schedules it.
2. Run 3's re-run (attempt 2 of 2) comes before run 1; the order is strict (D-33). Any change to run 3's brief goes through the D-31 gate and a fresh D-04 approval.
3. `run_01M78966NJ0SW8NB54564MFFZW` stays `blocked_on_decision` until the owner cancels it in their own terminal. Claude never cancels.
4. Reminder for the owner: the profile config still forces the banner failure (`osascriptPath` `/nonexistent/osascript`, `batchWindowMinutes` 1). Restore it, or keep it for the re-run, with:
   `cp ~/.config/avarice/profiles/personal-local/config.json.before-run3 ~/.config/avarice/profiles/personal-local/config.json`

Plans 03-59 and 03-60 stay blocked.

## Documentation surfaces for plans 03-31 to 03-33

No code changed in this plan, so no `docs/system` surface changed here. The gap plan will need to describe how the unit and its subagents get a content-search route (`docs/system/runs.md`, "The unit") and, if the admitted-command set changes, the matching text on admitted commands.

## Deviations from Plan

None. The plan's unexpected-stop branch (Task 1 to Task 3) and its `brief-harness-defect-fix-first` option were followed as written; the SUMMARY status is halted with the follow-up named.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits 85e8130 and 5527e81 are ancestors of HEAD; `git log ec5fc0e..HEAD` showed exactly 85e8130 before the ruling commit.
- `classification.confirmed.by` is `owner` with class `brief-harness-defect` in run 3's newest entry.
- Task 3 checks passed: `run3-stop-ruled:brief-harness-defect`; spend within caps.
