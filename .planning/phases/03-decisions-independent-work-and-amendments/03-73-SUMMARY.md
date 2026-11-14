---
phase: 03-decisions-independent-work-and-amendments
plan: 73
subsystem: exit-run2-attempt4
tags: [exit, run2, attempt4, amend-stale, d-26, d-27, d-28, d-33, d-35, d-36, passed, live-spend]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-72's owner-confirmed reset of run 3 and the owner's keep-cap spend choice, plan 03-71's fix that keeps test:e2e off the unit's command list, plan 03-69's launch line, plan 03-56's authorization
provides:
  - "03-57-evidence-exit.json: run 2's attempt 4, the first of the new D-26 epoch: paused as planned, owner amend and both answers, finished passed"
  - "test/containment/live-spend-phase3.jsonl: the attempt's start and finish spend lines under plan 03-73"
  - "Live evidence that plan 03-71's fix holds: test:e2e was not on the unit's command list, the prompt named it under the not-judged line, no agent ran it"
affects: [03-74, 03-59, 03-60, 03-31, 03-32, 03-33]

actuals:
  tokens: 9000
  tasks: 3
  commits: 2
plan_head_before: cf9417581096ca3efc33fb90c14194c49c3bb31b
plan_head_after: 7bfda7f11208339bdfa772b1124b7ff742154e8e

tech-stack:
  added: []
  patterns: ["a live attempt as one bounded start, the owner's own-terminal amend and answers, one finish, and the owner's ruling before any further spend"]

key-files:
  created: []
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "Run 2's attempt 4 passed and the owner confirmed it with `continue`: run 2 counts toward 3 of 3 in the new D-26 epoch and the order 2, 3, 1 goes on to run 3 (plan 03-74)"
  - "Run 1 headroom after this attempt is 6.4222 USD (25 - 4.50 - 14.0778): the most run 3 may spend before run 1's start is refused with exit 75 (D-05, D-33)"

requirements-completed: [RC-6, AUT-5, AUT-3, AUT-16]

coverage:
  - id: D1
    description: "Run 2's attempt 4 started once under 03-56-exit-authorization.json on the pinned 2.1.319 host, admitted as run2 attempt 4, and stopped at the planted pause on item B's one pause-origin decision (contract version 1) with item A done and test:e2e reported not run: not required"
    requirement: AUT-5
    verification:
      - kind: other
        ref: "03-73 Task 1 automated check over 03-57-evidence-exit.json (paused-as-expected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The amended run reached ready_for_review at contract version 2 (owner:aphan, reason, files.write and files.create diff), the original decision stale with its answer kept, its successor answered by the owner on the terminal, B resumed, G4 passed, test:e2e not run (D-35), finish judge with no problem"
    requirement: AUT-3
    verification:
      - kind: other
        ref: "03-73 Task 3 automated check over 03-57-evidence-exit.json (run2 attempt 4 passed, resumed, contract version 2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Spend within the caps: this plan 0.9668 USD of 4.50, Phase 3 ledger 14.0778 USD of 25, run 1 headroom 6.4222 USD"
    requirement: AUT-16
    verification:
      - kind: other
        ref: "03-73 Task 3 spend check over test/containment/live-spend-phase3.jsonl"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether the pass is accepted and run 3 may begin is the owner's decision (D-26, D-27, D-36)"
    verification: []
    human_judgment: true
    rationale: "A decision reserved to the owner; recorded as the owner's reply `continue`, not asserted by automation"

duration: "about 21 min of live run (03:28Z start, 03:42Z finish); the plan spans three dispatches and the owner's checkpoints"
completed: 2026-11-14
status: complete
---

# Phase 3 Plan 73: Run 2's Attempt 4 Summary

**Run 2's attempt 4, the first of the new D-26 epoch, started once (by the owner, after a classifier denial), paused as planned on item B, was amended and answered by the owner in their own terminal, and finished ready_for_review at contract version 2 with no problem, item A done in one attempt and test:e2e kept off the unit's command list; the owner ruled `continue`.**

## Performance

- **Live run:** started 2026-11-14T03:28:20Z, finished 2026-11-14T03:42:26Z (about 14 min of wall clock; the unit's work took about 7 min in total, the rest was the owner's answers)
- **Tasks:** 3
- **Files modified:** 2 (the evidence file, the spend ledger)

## Accomplishments

- Run `run_01M7C1JN8KNG3TXP4Z93CZPY90`, run 2, attempt 4 (the first slot of the new epoch, which the owner's product-defect ruling of run 3's attempt 2 began), plan 03-73, host 2.1.319, cap 4.50 USD. Authorize admitted it as `run2 attempt 4`. Attempt 3 (plan 03-68) passed before the new epoch and no longer counts.
- Start (Task 1, commit 15b7900): stopped at the planted pause, `stopOk` true, 0 problems. Item A done in one attempt (commit recorded in the entry) and item B blocked on one pause-origin decision, `dec_01M7C1W1J0X5SRGB2G2G8W0AR7` (numbered choice, contract version 1). `test:e2e` reported "not run: not required" (D-35). Equal checkout digests. One notification, delivered.
- The owner started the run themselves. Claude Code's permission classifier denied the executor's attempt to run the start command, so the owner ran the plan's exact command in this session with the `!` prefix. It was started once and never again.
- Owner actions (Task 2, in the owner's own terminal, Claude ran none of them): `contract amend` with `--add-write tests/unit/date-copy.test.ts` (contract version 1 to 2, owner:aphan, reason "let item B cover the date copy test"); `decide` on the original decision, which went stale; `decide` on its successor `dec_01M7C23SMRSTWAGSWB9F172JK7`, answered `1` by `owner:aphan` through the terminal (2026-11-14T03:38:38Z). The choice was the date copy format `<Month YYYY>`, for example `December 2026`.
- Finish (Task 3, commit 7bfda7f): `ready_for_review`, `passed` true, `stopOk` true, `problems` [], `resumed` true, contract version 2. Item B done in 2 attempts (the second a resume). The run commit is `04ac67f0d2b4ad27483ef159d4fb4eafbaadad3d`, clean. Gates: G0, G1 and G2 for A passed; A's G2 has a later stale row after the amendment; G1, G2 for B and G4 passed. Two notifications, both delivered. `format:check` is `failed` and marked `preExisting`; every other required check passed. `test:e2e` still "not run: not required". The only new ref is the run branch `avarice/run_01M7C1JN8KNG3TXP4Z93CZPY90`.

## Live evidence for plan 03-71's fix

The fix held live. `test:e2e` was not on the unit's command list; the prompt named `test:e2e` under the not-judged line; no agent ran it. These are recorded, not gated.

## The owner's commands and replies

- Run: the original decision `dec_01M7C1W1J0X5SRGB2G2G8W0AR7` is `stale` with its answer `1` kept; the successor `dec_01M7C23SMRSTWAGSWB9F172JK7` is `answered` `1` by `owner:aphan` on the terminal, and records `supersedes` the original.
- Contract: version 2, `authorizedBy` `owner:aphan`, reason "let item B cover the date copy test", diff `files.create` and `files.write` each adding `tests/unit/date-copy.test.ts`.
- The `--finish` exit code was not separately captured for this summary; the finish judge's record in the entry (`passed` true, `problems` []) and Task 3's automated check are the evidence.

## The owner's ruling, verbatim

At the Task 3 checkpoint (`checkpoint:decision`, `gate="blocking-human"`) the owner, Aaron Phan, selected `continue`. The reply, verbatim: "continue". Its meaning, the plan's pass option: "Run 2 passed: confirm and go on to run 3 (plan 03-74)". The plan writes a ruling with `classify --confirm` only for an option other than `continue`, and `classify` refuses a passed entry, so no classification record exists or was written; the pass is the entry's `passed: true` and this reply. The reply authorizes recording the ruling and closing this plan only. It does not start plan 03-74 or any run, and none was started.

## Spend and the run 1 headroom (D-05, D-33)

- Attempt 4 cost 0.9668 USD: 0.1542 at the start plus 0.8126 at the finish (cap 4.50; entry budgets: costUsd 0.966775 of 4.5, 3 of 5 invocations, 8 of 20 subagents, 81 of 800 tool calls).
- Phase 3 ledger sum: 14.0778 USD of 25 across 55 lines. This plan's spend: 0.9668 USD (at most 4.50).
- Run 1 headroom: 25 - 4.50 - 14.0778 = 6.4222 USD, the most run 3 may spend before run 1's start is refused with exit 75. It is above 0, so run 1 still fits as authorized.

## Profile config and what plan 03-74 needs

- The profile config `~/.config/avarice/profiles/personal-local/config.json` had no notify block during this run and was byte-identical to `config.json.before-run3`. Both notifications were therefore delivered. Run 2's judge counts the notification row and does not read its delivery, so this did not change the verdict.
- Plan 03-74 needs the forced banner failure set again: `notify.local.osascriptPath` at `/nonexistent/osascript` and `notify.batchWindowMinutes` at 1. Only the owner edits the file.
- Read-only observation when this summary was written (the file's modification time is 21:48 local, after the finish): the owner has begun adding a `notify` block with those two values, but the file as saved is not valid JSON. The `notify` block follows the `workRoot` line without a comma after it, and `jq` reports a parse error at line 6. Claude did not edit the file. The owner needs to add the comma before running any `avarice` command or plan 03-74, because an unparseable profile config would fail them.

## Task Commits

1. **Task 1: Tracer, run 2's attempt 4 started once to its planted pause** - `15b7900` (chore)
2. **Task 2 and the finish (Task 3, first half): the owner's amend and both answers on record, run finished and judged passed** - `7bfda7f` (chore)
3. **Task 3 (second half): the owner's `continue`** - recorded in this summary; no evidence-file change is made for a pass

**Plan metadata:** the docs commit that adds this SUMMARY, followed by the STATE and ROADMAP update.

## Files Created/Modified

- `.planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json` - run 2's attempt 4 entry (start, owner actions, finish)
- `test/containment/live-spend-phase3.jsonl` - the start and finish spend lines under plan 03-73

## Decisions Made

- Run 2 counts toward 3 of 3 in the new epoch on the owner's `continue`; the order 2, 3, 1 proceeds to run 3 (plan 03-74), which this plan neither started nor authorized beyond recording the ruling.
- No classification was written: the plan's pass branch uses none, and the tool refuses one on a passed entry.

## Deviations from Plan

### Auto-fixed Issues

None. One departure in how the start ran, not a code deviation: the executor's start command was denied by the permission classifier, and the owner ran it themselves with the `!` prefix (see Accomplishments). The plan's bounds held: one start, no rerun.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None on the outcome.

## Issues Encountered

- The classifier denial of the executor's start (above).
- The profile config's malformed JSON (above), found read-only after the finish.

## Authentication Gates

None.

## Known Stubs

None. No code was changed.

## Threat Flags

None. This plan changed no code, endpoint or trust boundary. T-03-216 to T-03-219 held: equal checkout digests, only the run's branch is new, the owner alone amended and answered, spend stayed within 4.50 and 25 USD, and run 2's attempt 3 is not counted in the new epoch.

## Documentation surfaces for plans 03-31 to 03-33

This plan changed no code, so no `docs/system/` document needs a change from it. The live run confirmed behavior that `docs/system/runs.md` ("The unit (`running`)") and `docs/system/checks-and-evidence.md` ("The baseline", "The sandbox every command runs in") already document, and plans 03-61, 03-64, 03-69 and 03-71 carry the surfaces they changed. The plans 03-31 to 03-33 documentation work may cite this run as evidence for the stale-decision path, the contract amendment, D-35's "not run: not required" report and the fix that keeps test:e2e off the unit's command list. No finding for `docs/system/findings.md` arose.

## Next Phase Readiness

- Ready for plan 03-74 (run 3's attempt 3), which the owner's `continue` clears and this plan does not start. Run 3 may spend at most 6.4222 USD before run 1's start would be refused (exit 75). The owner must first re-force the banner failure in the profile config, with valid JSON.
- `run_01M7C1JN8KNG3TXP4Z93CZPY90` is `ready_for_review`; its branch `avarice/run_01M7C1JN8KNG3TXP4Z93CZPY90` in `~/aa-phan-portfolio-v2` may be deleted by the owner after review.
- `.planning/milestone.lock` was left untouched.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-14*

## Self-Check: PASSED

- Commits 15b7900 and 7bfda7f are ancestors of HEAD, and `git rev-list --count cf94175..HEAD` was 2 before this SUMMARY.
- Task 3 checks: run 2's attempt 4 passed, ready_for_review, resumed, contract version 2, no problem; Phase 3 spend 14.0778 USD, this plan 0.9668 USD, run 1 headroom 6.4222 USD.
