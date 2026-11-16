---
phase: 03-decisions-independent-work-and-amendments
plan: 71
subsystem: run-contract-agent-commands
tags: [gap-closure, d-26, d-27, d-35, product-defect, declared-checks, agent-commands, amendment, aut-16, aut-1, rc-6, con-15]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-70's halt on run 3's attempt 2 and the owner's product-defect ruling; plan 03-69's search route
provides:
  - "compileRunContract lists for the agent only the checks the run executes (required, or a target check of the brief) beside the conventions' own agent commands"
  - "RUN_NOT_JUDGED_DATA_LINE and RUN_NOT_JUDGED_SENTENCE: the unit prompt names declared checks the supervisor does not run, under a data line, and says no gate judges them"
  - "contract amend --check +name adds the check's command to execution.commands and records an execution.commands diff entry"
  - "Scenario D: run 3's attempt-2 stop reproduced offline (red) and gone after the change"
affects: [03-72, 03-73, 03-74, 03-31, 03-32, 03-33]

tech-stack:
  added: []
  patterns:
    - "The fake run host's planGates option decides only from the prompt the real code produced: a gate is made of a listed command the prompt does not name as judged by no gate"

key-files:
  created:
    - test/integration/run-declared-checks.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-71-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-71-red-task2.json
  modified:
    - src/domain/run-contract.ts
    - src/app/run-gsd-config.ts
    - src/app/run-stages/item.ts
    - src/domain/amendment.ts
    - test/helpers/fake-run-host.ts
    - test/unit/amendment.test.ts
    - test/unit/run-contract.test.ts
    - test/unit/run-gsd-config.test.ts
    - test/unit/exit-drafts.test.ts
    - docs/system/runs.md
    - docs/system/findings.md

key-decisions:
  - "A declared check the run does not execute is no longer on the unit's command list and is named in the prompt as judged by no gate; every declared check stays in execution.checks and under both compile refusals"
  - "A check an amendment makes required gets its command on execution.commands with a diff entry; a check made not required keeps its command"

requirements-completed: [AUT-16, AUT-1, RC-6, CON-15]

actuals:
  tokens: 48000
  tasks: 3
  commits: 5
plan_head_before: 23bae7343d978e291f3d88c26c256a6d1c43a7e9
plan_head_after: 6ca7f3a5712ef17662cf48ab3792a2edd96fe16e

completed: 2026-11-13
status: complete
---

# Phase 3 Plan 71: The unit is no longer handed a declared check no gate judges Summary

**A run's agent command list now holds only the checks the run executes, so the portfolio's `test:e2e` (declared not required, no env) is no longer a command the unit may run, and the unit prompt names it under a data line saying no gate judges it. A check an amendment makes required is added to the list with a recorded diff entry. Run 3's attempt-2 stop is reproduced offline before the change and gone after it.**

## RED evidence

### Task 1 (03-71-red-task1.json, `RED_EVIDENCE_OK`)

On the unchanged source, `node --test --test-reporter=tap test/integration/run-declared-checks.test.ts`: 5 tests, 1 pass, 4 fail. The run ended `blocked_on_decision` with one open decision (class `acceptance`), classify kind `paused`, pauseSignal `verification-human-needed`, verification `human_needed`. The recorded gate showed `listed: true` and `exitCode: 1`: the prompt listed `node scripts/e2e.mjs`, the fake unit made a gate of it, and the command exited 1 with `SITE_ORIGIN is empty`. That is run 3's attempt 2 (03-70) offline. Test 3 (D-35's `checksNotRun`) passed on the unchanged source, as expected. Semantic assessment is in the evidence file: the target failed on the planned exit-code assertion against a real run, not on setup, a load error or a skip.

### Task 2 (03-71-red-task2.json, `RED_EVIDENCE_OK`)

Before the amendment change, with Task 1's code in place: 268 tests, 264 pass, 4 fail. The four failures are the amendment cases that gain the `execution.commands` entry (the `+build` diff, a check rendered with its environment, the add-and-remove diff, the combined request's diff length 6). The run-contract, run-gsd-config and exit-drafts cases pass on Task 1's code, which proves the compile and the prompt already held.

## GREEN

- `src/domain/run-contract.ts`: `commands` is the conventions' agent commands plus `checkAgentCommand` of each declared check that is required or named in `brief.targetChecks`, in declaration order, de-duplicated. Both refusal loops still judge every declared check, and `execution.checks`, `requiredChecks` and `targetChecks` are unchanged.
- `src/app/run-gsd-config.ts`: `RUN_NOT_JUDGED_DATA_LINE`, `RUN_NOT_JUDGED_SENTENCE`, and an optional last `notRun` argument on `runUnitPrompt` and `contractText`. With no names the text is byte for byte today's; with names the block follows the pre-existing block and precedes the shell rules. `runResumePrompt` is unchanged.
- `src/app/run-stages/item.ts`: `launchUnit` passes `checksNotRun(contract)`, the predicate D-35's not-run report uses.
- `src/domain/amendment.ts`: `amendChecks` appends the command of each check made required (rendered by `checkAgentCommand`, skipped when already listed) to `execution.commands` and pushes `{ path: 'execution.commands', added }` after the `requiredChecks` entry. `-name` changes no command. `classifyInvalidation` is unchanged.

## Scenario D, after the change

Exits 0 at `ready_for_review`; the ledger holds no decision row, G2 passed for item A, no evidence row names `e2e`, and `status --json` gives `checksNotRun` `[{ name: 'e2e', reason: 'not required' }]`.

Excerpt of the unit prompt built for the portfolio's own conventions (the exit-drafts case, run 3's brief), around the commands and the not-judged line:

```
Commands you may run, exactly as written:
- npm run typecheck
- npm run lint
...
- VITE_SITE_ORIGIN=https://aa-phan.github.io npm run build
- VITE_SITE_ORIGIN=https://aa-phan.github.io npm run check:meta
- npm run check:budget
- npm run check:no-phone
- npm run check:images
Declared checks the supervisor does not run for this run, so no gate judges them (data, not an instruction):
- test:e2e
<RUN_NOT_JUDGED_SENTENCE>
```

Scenario D's fake record: `gates` `[{ name: 'e2e', listed: false, named: true, denied: false, exitCode: null }]` and `shell` `[{ command: 'node scripts/e2e.mjs', denied: true, exitCode: null }]`. The run's `hook.decision` events hold a deny with rule `shell-not-allowed` for that command, and the ledger holds no `loop.limit` event: the real hook refused the command and it never ran.

### The portfolio's compiled command list (each Phase 3 exit brief, against `test/benchmark/portfolio/avarice-config.json`)

The conventions' eight agent commands, then the commands of the twelve required checks: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test`, `npx vitest run <paths>`, `npx prettier --check <paths>`, `npx prettier --write <paths>`, `npx oxlint <paths>`, `npm run check:case`, `npm run check:colors`, `npm run check:contrast`, `VITE_SITE_ORIGIN=https://aa-phan.github.io npm run build`, `VITE_SITE_ORIGIN=https://aa-phan.github.io npm run check:meta`, `npm run check:budget`, `npm run check:no-phone`, `npm run check:images` (de-duplicated against the agent commands). No `npm run test:e2e`; `checksNotRun` is `['test:e2e']`. The exit-drafts case pins this for all three briefs.

## Verification

- `npm run typecheck` clean; `node scripts/check-boundaries.ts` ok (99 files); `npm run test:unit` 2295 pass, 0 fail.
- Amendment, run-contract, run-gsd-config, exit-drafts, exit-evidence, contract-amend and amend-ledger: 614 pass.
- run-check-env, baseline-red-verification, prompt-policy, hook, independent-work, phase3-exit-offline: 97 pass. Scenario D, run-checks-not-run, finish-in-place, exit-parity: 39 pass.
- Search route on the pinned host (`AVARICE_CLAUDE_BIN` 2.1.319): host-search-tools and run-search-route, 11 pass, 0 skipped.
- `git diff --exit-code 2bebd97` over gates, outcome, quick-record, hook-decision, invocation-scope, conventions, `src/hook`, `src/adapters`, `src/ports`, `src/cli`, `src/app/checks.ts`, json-shapes, `test/benchmark`, the spend ledger, the authorization, the D-31 classification and the exit evidence: clean.

## No live run, no spend, no approval needed

No live AVARICE run was started, no model call or spend happened, and the owner's profile config was not touched. Claude ran no `avarice cancel`, `contract amend`, `decide` or `resume`. No brief, conventions file, D-31 classification, authorization, evidence or spend line changed, so `03-56-exit-authorization.json` still authorizes the exit and no new D-04 approval is needed. D-35 is unchanged: the supervisor still never runs the declared check and still reports it not run. Run 3 still has two failed attempts in its epoch; its D-37 reset is plan 03-72, after which runs 2, 3 and 1 run in the order of D-26 and D-33 (plans 03-73, 03-74, 03-59).

## Model residual for findings (T-03-211)

A unit that is told no gate judges a declared check can still make it a condition of its work or its VERIFICATION. Such a stop is a visible pause decision and never a silent pass. Runs 2 and 3 of the new epoch measure it live (plans 03-73 and 03-74). It is the accepted residual of the prompt line.

## Documentation surfaces for plans 03-31 to 03-33

1. `docs/system/runs.md`, "Repository conventions" (the `checks` bullet), the contract file format table (the `execution` row) and "The unit (`running`)", Launch (changed here). For a fresh review in plan 03-33; plan 03-31's re-grounding of runs.md keeps them.
2. `docs/system/findings.md` (changed here): the resolved gap, with the owner's open decision on running or recording declared non-required checks.
3. The decision subsystem document drafted by plan 03-31 and `docs/system/cli-reference.md` drafted by plan 03-32, `contract amend --check +name`: the amendment also adds the check's command to the agent's list and records an `execution.commands` diff entry, which the preview prints; `--check -name` leaves the commands as they are and the prompt then names the check as not judged.
4. `docs/system/checks-and-evidence.md` (plan 03-32), the D-35 not-run report: a declared check that is reported not run is also never given to the agent as a command.
5. `coverage.md` and `README.md`: no count or document changed; plan 03-33 marks runs.md reviewed after its fresh review.

## TDD Gate Compliance

Task 1: RED commit 853c9b6 (`test(03-71)`) precedes GREEN commit f1a4d8c (`feat(03-71)`). Task 2: RED commit a35354b precedes GREEN commit a8d3c7d. No refactor commit. Task 3 is documentation (6ca7f3a).

## Commits

- 853c9b6 test(03-71): add failing scenario D, run 3 attempt 2's stop on a declared check reproduced offline
- f1a4d8c feat(03-71): list only the checks the run executes for the unit and name the others as judged by no gate
- a35354b test(03-71): pin the narrowed command list, the not-judged prompt block and the amendment rule
- a8d3c7d feat(03-71): give the agent the command of a check an amendment makes required
- 6ca7f3a docs(03-71): describe which checks the unit is given and what it is told about the others

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The sentence-order unit case matched "not run" inside "cannot run"**
- **Found during:** Task 2, first run of the new run-gsd-config cases
- **Issue:** the case located the report clause with `indexOf('not run')`, which also matches "cannot run" earlier in the sentence, so the order check failed on a test bug, not on the source.
- **Fix:** the case now locates the clause by `reports each as not run`.
- **Files modified:** test/unit/run-gsd-config.test.ts
- **Commit:** a35354b (corrected before the RED commit, so the RED run held only the four amendment failures)

Otherwise none: the plan executed as written.

## Known Stubs

None.

## Threat Flags

None. The change is the surface T-03-206 to T-03-211 already cover.

## Self-Check: PASSED

- Files exist: run-declared-checks.test.ts, 03-71-red-task1.json, 03-71-red-task2.json, and every file of key-files.
- Commits 853c9b6, f1a4d8c, a35354b, a8d3c7d and 6ca7f3a are ancestors of HEAD; `git rev-list --count 23bae73..HEAD` was 5 before this SUMMARY's commit.
