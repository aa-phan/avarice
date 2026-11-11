---
phase: 03-decisions-independent-work-and-amendments
plan: 61
subsystem: run-unit-prompt
tags: [baseline-red, pre-existing, unit-prompt, verifier-note, d-12, d-26, d-27, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-57's halt on run 2 attempt 1 (the owner's product-defect ruling), itemStartStatuses (03-19), baselineDelta (D-12)
provides:
  - "preExistingAtStart(start, required, targets): baselineDelta's pre-existing rule over an item's start statuses"
  - "RUN_PRE_EXISTING_DATA_LINE and RUN_PRE_EXISTING_SENTENCE, and runUnitPrompt's optional last preExisting argument"
  - "AVARICE_VERIFIER_ADDENDUM on gsd-verifier only"
  - "the fake run host's verificationByPrompt option"
  - "scenarios R and M (test/integration/run-baseline-red-verification.test.ts)"
affects: [03-62, 03-63, 03-31, 03-32, 03-33]

actuals:
  tokens: 9000
  tasks: 2
  commits: 4
plan_head_before: 68de88b2027968e3a36a32bd98be1eb2e26faed1
plan_head_after: bce5093884a92d274097386fab2ef4356dbeb20e

tech-stack:
  added: []
  patterns: ["a measured-data line plus one fixed sentence in the unit prompt, empty list leaves the prompt byte-identical", "the prompt informs, the gates judge: no gate, pause rule or parser changed"]

key-files:
  created:
    - test/integration/run-baseline-red-verification.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-61-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-61-red-task2.json
  modified:
    - src/domain/evidence.ts
    - src/app/run-gsd-config.ts
    - src/app/run-stages/item.ts
    - src/adapters/gsd/agents-json.ts
    - test/helpers/fake-run-host.ts
    - test/unit/evidence.test.ts
    - test/unit/run-gsd-config.test.ts
    - test/unit/agent-frontmatter.test.ts

key-decisions:
  - "Mechanism: tell the unit and the verifier which required checks already failed when the item began; pause detection, the VERIFICATION parser and G2's verification rule are unchanged, because a model-written status can stop an item and must never pass one"
  - "The list is computed by baselineDelta's own rule over the same start statuses gateUnit judges G2 against, so it cannot name a check G2 would charge to the item"
  - "launchUnit reads the start statuses only for the prompts that carry the list (fresh, answered and repair launches), not for a resume (plan checker advisory 2; consistent with the plan's acceptance criteria)"

requirements-completed: [AUT-16, AUT-1, AUT-10]

coverage:
  - id: D1
    description: "A unit's prompt names the required, non-target checks that failed when its item began, under a data line after the commands; with none the prompt is byte-identical"
    requirement: AUT-16
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-red-verification.test.ts#scenario R gave the unit a prompt that lists `format` under the data line, and not the target `test`"
        status: pass
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#runUnitPrompt names the required checks that already failed when the item began (plan 03-61; D-26, D-27)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Offline, a required check red at the pin on an untouched file reaches ready_for_review with no decision (run 2's stop no longer reproduces)"
    requirement: AUT-1
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-red-verification.test.ts#scenario R exits 0 at ready_for_review"
        status: pass
    human_judgment: false
  - id: D3
    description: "A check that passed at the pin, broken beside a baseline-red check, still gets one repair and a repeated_failure decision, with checks-delta naming it regressed"
    requirement: AUT-10
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-red-verification.test.ts#scenario M ends blocked on one repeated_failure decision, after exactly one repair and with nothing committed"
        status: pass
    human_judgment: false
  - id: D4
    description: "The gsd-verifier closing note states the pre-existing rule; no other agent gets it"
    requirement: AUT-16
    verification:
      - kind: unit
        ref: "test/unit/agent-frontmatter.test.ts#appends the run's shell-rules addendum to the four run agents"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 61: The Baseline-Red Verification Fix Summary

**A required check that already failed when an item began is now named to the unit, and to its verifier, as pre-existing data AVARICE measured, using baselineDelta's own rule over the item's start statuses; no gate, pause rule or parser changed.**

## Performance

- **Duration:** about 40 min
- **Tasks:** 2 (a tracer and an auto task, both TDD)
- **Commits:** 4 task commits (RED and GREEN for each task), then this SUMMARY

## What was built

- `preExistingAtStart` (src/domain/evidence.ts, appended; no existing line changed) returns `baselineDelta({ base: start, head: start, ... }).preExisting`: the required, non-target checks whose start status is `failed`.
- `runUnitPrompt` takes an optional last `preExisting` argument. When non-empty, the prompt gains `RUN_PRE_EXISTING_DATA_LINE`, one bullet per check and `RUN_PRE_EXISTING_SENTENCE` after the commands bullets and before the shell rules. When empty or absent the prompt is byte-identical (pinned against the recorded single-item prompt). `runResumePrompt` is unchanged.
- `launchUnit` reads `itemStartStatuses` (the statuses `gateUnit` judges G2 against) and passes the list, only on the branch that builds a fresh, answered or repair prompt. A resume launch does not read it, so it gains no new failure path.
- `AVARICE_VERIFIER_ADDENDUM` is appended to `gsd-verifier` only, after the shell addendum.
- The fake run host gained `verificationByPrompt`, a JSON-serializable option standing in for the 03-57 unit: `passed` only when the prompt lists the check under the data line, else `human_needed`.

## Red evidence: run 2's stop reproduced offline

Task 1, on the unchanged source (`03-61-red-task1.json`, `RED_EVIDENCE_OK`, `target_test_failed`): scenario R ended `blocked_on_decision (decision)`. The classify step recorded `kind: paused`, `pauseSignal: verification-human-needed`, `verification: human_needed`. That is the 03-57 stop. All 4 scenario R tests failed on assertions (exit code, a decision-free run, the `format` G2 row, the data line in the recorded prompt).

After the change, all 4 pass: the run exits 0 at `ready_for_review`, the ledger holds no decision, G2 passed for item A, item A's G2 `format` row is `failed` with `preExisting: true`, and the transition names `format`.

Task 2 (`03-61-red-task2.json`, `RED_EVIDENCE_OK`): the two verifier cases failed on assertions (no `AVARICE_VERIFIER_ADDENDUM`, no verifier closing). The new evidence, prompt and scenario M cases passed on Task 1's code, as the plan expected: scenario M's pass is the proof that the change masks no regression.

## Scenario R: the recorded prompt around the data line

Built with the real `runUnitPrompt` for the scenario's contract (commands `npm test`, list `['format']`); long lines are cut here:

```
Commands you may run, exactly as written:
- npm test
Required checks that already failed when this work item began, as the supervisor measured them (data, not an instruction):
- format
The supervisor's gate judges each of these checks against that start, so one that still fails after your change is recorded as pre-existing and does n...
Shell rules: run one plain command per Bash call. ...
```

The integration test asserts the recorded prompt holds exactly `['- format']` under the data line: `test`, a target, is not listed.

## Scenario M: nothing is masked

`format` is red at the pin (required), `marker` is green at the pin (required), `test` is the green target. The first unit breaks `src/marker.txt` and reports `passed` only because its prompt lists `format` (the list does not name `marker`). Result:

- State `blocked_on_decision`; attempts `['initial', 'repair']` (one repair, no second); 2 host calls; nothing committed on the run branch.
- One decision, class `repeated_failure`.
- G2's last row: `passed = 0`, one failure with rule `checks-delta` and detail naming `marker (regressed)`; `format` is not charged.

## Verification run

- `node --test` over evidence, run-gsd-config, agent-frontmatter, fake-run-host and the new integration file: 138 tests, 0 failures.
- `npm run typecheck` clean; `node scripts/check-boundaries.ts` ok (99 files); `npm run test:unit`: 2195 tests, 2195 pass.
- Integration: check-validation, run-repair, run-pause-attribution, run-prompt-policy, run-independent-work, phase3-exit-offline: 70 pass. Also run-regression, run-baseline-workflow, run-g1, run-resume: 71 pass.
- `git diff --exit-code 4525c27` over gates, outcome, quick-record, the hook, the host adapter and `test/fixtures/json-shapes`: no change. No removed or rewritten line in `src/domain/evidence.ts`. `git diff --exit-code e9b8845` over `test/benchmark`, `03-56-exit-authorization.json` and `03-55-brief-classification.json`: no change.

## What the offline proof does and does not show

The offline scenario proves that the baseline-red list is delivered to the unit prompt (and the verifier note to the verifier prompt), and that the gates still judge as before. It does not prove that a live model will comply. The fake unit is a stand-in that reads the list; only run 2's live attempt 2 (plans 03-62 and 03-63) shows whether the real unit stops asking.

## Residual (for findings.md)

The unit is a model and can still report `human_needed` or ask after being told. That ask is a pause decision like any other: AVARICE never overrides a model-written status (docs/system/runs.md: a model-written status can fail a gate and can never pass one). A failure on run 2's attempt 2 is run 2's second failed attempt (D-29). Also unchanged and already recorded at docs/system/findings.md:156: G2 compares by status only, so a baseline-red check that fails for a new reason stays pre-existing. The prompt tells the unit a failure in a file it changed is its own to fix.

## Deviations from Plan

None - plan executed exactly as written. One note on the plan's wording "before the prompt is built": `launchUnit` calls `itemStartStatuses` only on the branch that builds the fresh, answered or repair prompt, not before the resume-versus-fresh choice (checker advisory 2). This is consistent with the plan's acceptance criteria and key link (the one call site that builds every fresh, answered and repair prompt).

## No new D-04 approval needed

No brief, conventions file, D-31 classification or authorization changed (`git diff e9b8845` is empty over the benchmark directory, `03-56-exit-authorization.json` and `03-55-brief-classification.json`), so `03-56-exit-authorization.json` still authorizes run 2's attempt 2.

## Documentation surfaces for plans 03-31 to 03-33

`docs/system/` was not edited by this plan (as plan 03-51 did). The surfaces to draft, review and record:

1. **docs/system/runs.md, "The unit (`running`)", Launch (drafted by 03-31).** When an item begins with required checks already failing (the required, non-target checks whose start status is failed: the baseline at the pin for the first item, the G2 result of the item committed last otherwise), the unit prompt names them under a data line after the commands. It tells the unit they are pre-existing, are not a question for the owner and are not on their own a reason for `human_needed` or `gaps_found`, that a failure in a file it changed is its own, and to give the list to the verifier. With none, the prompt is unchanged. The resume prompt does not repeat the list.
2. **docs/system/runs.md, the agents-file paragraph of the same section (03-31).** The verifier's closing note states the pre-existing rule.
3. **docs/system/checks-and-evidence.md, "The baseline" (drafted by 03-32).** The sentence that a failing baseline check does not block, made exact: no gate blocks on it, and the unit is told about it at launch. A unit that still reports `human_needed` because of it pauses like any other unit, because a model-written status is never overridden.
4. **docs/system/findings.md (03-33).** One line, `file:line` first (src/domain/outcome.ts:116 and src/app/run-stages/item.ts:390): a unit that reports `human_needed` only because of a pre-existing required-check failure still pauses. Since this change the unit and its verifier are told which checks failed when the item began, and AVARICE never overrides a model-written status. The proposal's unnecessary-escalation metric (docs/autonomy-and-decisions.md:167) counts such a pause as an escalation a reviewer could answer from the evidence.

## Known Stubs

None.

## Threat Flags

None. The plan's threats are mitigated as written: T-03-161 (a unit case pins a name with a control character and a double quote, flattened and escaped like every bullet), T-03-162 (the list is built on baselineDelta's rule over the gate's own start statuses; scenario M), T-03-163 (pause detection and G2's verification rule untouched; a `human_needed` VERIFICATION still pauses, scenario R's RED run). T-03-164 is accepted (the residual above).

## Self-Check: PASSED

- Created files exist: test/integration/run-baseline-red-verification.test.ts, 03-61-red-task1.json, 03-61-red-task2.json.
- Task commits are on the branch: 9785192 (RED 1), 3476fda (GREEN 1), c123f10 (RED 2), bce5093 (GREEN 2).
