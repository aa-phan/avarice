---
phase: 03-decisions-independent-work-and-amendments
plan: 32
subsystem: documentation
tags: [docs-system, cli-reference, config-reference, checks-and-evidence, containment, integrations, overview, interactive-shell]
requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: the built commands, gates, notification adapters and amendment rules of plans 03-01 to 03-74, and the worklist and subsystem document of plan 03-31
provides:
  - seven docs/system reference documents drafted from the code at eda64a6 (drafted, not yet reviewed)
  - every worklist row assigned to plan 03-32 marked drafted (22 of 22), none pending
  - findings 22 to 27 in the worklist for plan 03-33
affects: [03-33]
tech-stack:
  added: []
  patterns: [documentation grounded in the code at HEAD, reference documents linking to the subsystem document instead of restating it]
key-files:
  created: []
  modified:
    - docs/system/cli-reference.md
    - docs/system/interactive-shell.md
    - docs/system/containment.md
    - docs/system/config-reference.md
    - docs/system/checks-and-evidence.md
    - docs/system/integrations.md
    - docs/system/overview.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-31-doc-worklist.md
key-decisions:
  - "The terminal identity rule has one home, a new containment.md section, and every command section links to it instead of restating it."
  - "A document that the code made stale in a line the worklist did not name (the routine preset, the start summary, the admitted host versions, the AVARICE_RUN readers, the skill quirk) was corrected in place, because the document belongs to this plan."
status: complete
duration: 15 min
completed: 2026-11-14
actuals:
  tokens: 52000
  tasks: 3
  commits: 4
plan_head_before: eda64a6c5d51c31e0123ab496592319df58f9670
plan_head_after: b590cbd65141ed5b52cc7827b98a3e0056b66b35
---

# Phase 3 Plan 32: Documentation pass 2 of 3 Summary

The phase's reference surfaces are drafted in docs/system from the code: fifteen CLI commands with flags, exit codes and output lines, the Decide shell action, the profile notify keys, gates G1 and G3, the baseline and D-35 statements, the resume launch line, leading assignments in command identity, the osascript, launchctl and plutil integrations, and the Notifier port with the decision subsystem in the overview.

## Documents drafted

- **docs/system/cli-reference.md.** New sections for `contract amend` (every flag the parser accepts, the preview lines, the confirmation, the exit codes), `decide` (arguments, the record view, the prompt and its `amend` entry, the pick-up lines, the answers that apply nothing), `digest`, `schedule install` and `remove` (the agent file, the two tools, every refusal) and `cancel`. The summary, dispatch, argument rules, usage-check list and exit-code table now cover fifteen command names, and which commands need a terminal. `status` and `inbox` state the added JSON keys (`items`, `decisions`, `notifications`, `cancelRequestedAt`, `checksNotRun`, the inbox's `items`, `options`, `command`, `notification`), the added human lines and the `not run: not required` forms. The `start` summary block was corrected to the `index:` and `item` lines the code prints.
- **docs/system/interactive-shell.md.** The Decide action (the table, the prompt, the hand-over to `decide`), amend and the other owner commands reached through the command line, eight menu items, and the completion list of fifteen names.
- **docs/system/containment.md.** A new section, "Owner commands and the terminal identity rule" (the three refusals in order, the process chain read with `ps`, the data-root owner check, what is recorded); the resume launch line, the reap by `--resume`, leading `NAME=value` assignments in rule 7, the scope paragraph and the Commands bullet; subagent budgets across items.
- **docs/system/config-reference.md.** A "The `notify` section" table with every key, its type, default and constraint; the check environment and `agentCommands` assignment rules; the routine preset values for several items (120 minutes, `2n + 1`, `400n`, `10n`, 10.00 USD, one repair per check); the readers of `AVARICE_RUN`; the test-only `AVARICE_TEST_NOTIFIER`; the environments of `osascript`, `launchctl`, `plutil` and the LaunchAgent; new limits.
- **docs/system/checks-and-evidence.md.** Gate G1 with its plan reader and six rules, the repair and gate G3 with the reproducer fields and three rules, the integrity gate map, what each item starts from, the baseline statement made exact, the check environment reaching the unit's command, `not run: not required`, stale rows after an amendment, and quirks.
- **docs/system/integrations.md.** `osascript`, `launchctl`, `plutil` and launchd as external systems with how each failure shows, `ps` for the process chain, the resume flag, the final text tail, the Notifier port, five admitted host versions, and failure rows.
- **docs/system/overview.md.** Fifteen commands, the Notifier port, the decision subsystem in the boundary and the import map, and the LaunchAgent write.

All seven carry no path, function name, plan ID or threat ID outside their openings (checked by grep over the added lines).

## Worklist and findings

All 22 rows assigned to 03-32 are `drafted`; `grep -E '\| 03-3[12] \|.*pending'` finds none. The worklist gained a section of findings 22 to 27 for plan 03-33: `contract amend` makes no data-root owner check; a failed replacing `schedule install` leaves no loaded job; `schedule` alone refuses every flag; the `osascript` path is read once per command; `digest` exits 70 when any destination failed; and the corrections listed under Deviations. Entry 5 of the earlier list is resolved in the document.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's check] The untouched-ledgers check compares with `main`.**
- **Found during:** Task 3
- **Issue:** README.md, coverage.md and findings.md differ from `main` because plans 03-69 and 03-71 edited them, so `git diff --quiet main` can never pass.
- **Fix:** Run against the plan base (eda64a6) instead. It printed `proposals-and-ledgers-untouched`: none of the proposals under docs/, README.md, coverage.md or findings.md changed in this plan.

**2. [Rule 1 - Stale document] Lines the worklist did not name were false at HEAD.**
- **Found during:** Tasks 2 and 3
- **Issue:** The routine preset table (60 minutes, 3 invocations, 5.0 USD), the `start` summary (a `model:` line, no `index:` or `item` lines), the admitted host versions in integrations.md (four of five), `AVARICE_RUN` blocking only the shell and `install-host`, and the skill quirk that called `contract amend` unknown.
- **Fix:** Corrected in the documents this plan owns, from the code, and listed as finding 27. This includes the 60-minute line that the context note named.
- **Files modified:** cli-reference.md, config-reference.md, integrations.md
- **Commit:** a492372, 2043fd3

**3. [Rule 3 - Blocking] The branch name is not in the per-agent namespace.**
- **Found during:** every commit
- **Issue:** The pre-commit assertion expects `agent-*` in a worktree. This worktree's branch is `worktree-phase-03`, the branch the orchestrator named, which is not protected.
- **Fix:** Committed on it as the orchestrator directed; no branch was created or switched.

**4. [Rule 3 - Skipped step] Requirements were not marked complete.**
- **Found during:** state updates
- **Issue:** The plan lists requirement IDs, but the orchestrator's instruction leaves REQUIREMENTS.md unchanged, and these IDs belong to the code plans that built them.
- **Fix:** `requirements.mark-complete` was not run. The tool's bump of the `Plan: N of 73` line in STATE.md was restored to `Plan: 3 of 73`.

## Known Stubs

None. No code was changed.

## Threat Flags

None. This plan changed no code and no trust boundary. Threat T-03-63 is mitigated as the plan says: every statement was drafted from the command, argument, gate and config code, and plan 03-33 compares and has each document reviewed before coverage.md marks it.

## Authentication gates

None.

## Self-Check: PASSED

- Documents modified exist: cli-reference.md, interactive-shell.md, containment.md, config-reference.md, checks-and-evidence.md, integrations.md, overview.md, and the worklist.
- Commits d817486, a492372, 2043fd3 and b590cbd are on the branch (`git log eda64a6..HEAD`). The fourth only states that the osascript path is read once.
- `git rev-list --count eda64a6..HEAD` was 4 before this file: the three task commits and that follow-up.
- The plan's three automated checks printed `decide-traced`, no `MISSING` line, and `no-pending-rows`.
