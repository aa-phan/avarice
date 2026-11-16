---
phase: 03-decisions-independent-work-and-amendments
plan: 27
subsystem: live-testing
status: complete
resumed_by: "03-39"
halted_history: "halted 2026-11-09 at the tracer gate (s17-s51 failed twice on item A, haiku); resumed by plans 03-36 to 03-39 and completed by plan 03-39"
tags: [live, tracer-gate, s-17, s-51, rc-8, haiku, spend-ledger, halted]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the live harness and the Phase 3 ledger (03-01), the live pause and resume measurements (03-13), the offline gate (03-26), independent work and the item-local block (03-18), repair and gates (03-19), notifications and digest (03-16, 03-23)"
provides:
  - "the Phase 3 live run-purpose harness: items brief, profile notify block with a missing osascript, post-run CLI steps (digest, inbox, status, decide on a pty), notification settling, a model-logging launch wrapper, per-invocation records and a plan total guard"
  - "test/containment/live-run-phase3.test.ts with seven cases (s17-s51, s50, s18-short, s21, s52, cs5, cs15); only s17-s51 was started"
  - "two live runs of the tracer with ground truth: S-17 and S-51 held for B, C, D and the model map, and failed on item A (small, haiku), which did not complete either time"
affects: [03-28, 03-29, 03-31, the decision on RC-8's small-item model]

actuals:
  tokens: 18000
  tasks: 1
  commits: 2
plan_head_before: a5f11376b3c760df19eb5090495f3995f096213b
plan_head_after: 848a72423da2fbec8112d0e60543b6716ddae0be
commits: 2

tech-stack:
  added: []
  patterns:
    - "A whole live run is judged from the ledger (work items, attempts, decisions, gate rows, evidence, hook decisions, notification rows, budget rows), the host's transcripts per invocation and the clone, never from the model's reply"
    - "A launch wrapper that appends each --model value to a log, so the flag the supervisor passed is ground truth beside the launch:run step and the host's init event"
    - "A probe that does nothing unless AVARICE_RUN is set (the contained host's shell), so the supervisor's own check run never executes it; the project's `npm test` runs it first (written for s21 and cs5, not yet run)"

key-files:
  created:
    - test/containment/live-run-phase3.test.ts
    - test/containment/live-run-phase3.jsonl
  modified:
    - test/helpers/live-harness.ts
    - test/containment/live-spend-phase3.jsonl
    - test/containment/LIVE-CASES.md

key-decisions:
  - "The tracer gate halted the plan after its one permitted re-run: s17-s51 failed twice on the same item (A, small, haiku), so no expansion case was started and no more model budget was spent"
  - "The second s17-s51 run raised the per-invocation cap from 1.60 to 2.00 USD (opus on item C cost 1.4323 USD in run 1) and changed nothing else; run 1's result line stays in the results file"
  - "No requirement is marked complete: CON-15, AUT-3, AUT-4, AUT-10, AUT-16, RC-7 and RC-8 are each declared by other plans, and the live evidence for them is incomplete or negative"

requirements-completed: []

coverage:
  - id: D1
    description: "The live harness additions compile and the existing live-harness unit tests (admission override, hygiene, spend ceiling) still pass; the new suite skips without AVARICE_LIVE"
    verification:
      - kind: command
        ref: "node --test test/unit/live-admission-override.test.ts test/unit/live-harness-hygiene.test.ts test/unit/live-spend-ceiling.test.ts test/containment/live-run-phase3.test.ts (0 fail, new suite 7 skipped); tsc -p . and check-boundaries clean"
        status: pass
    human_judgment: false
  - id: D2
    description: "S-17 live: on a scratch repository a real run blocks only the owner-choice item B and its dependent D, completes the independent item C with G2 evidence and its own commit, and ends blocked_on_decision; the case required A to complete too, and A did not in either run"
    requirement: "AUT-3"
    verification:
      - kind: other
        ref: "test/containment/live-run-phase3.jsonl lines 1 and 2 (verdict FAIL on the item states)"
        status: fail
    human_judgment: true
    rationale: "B, C and D behaved as S-17 says in both runs; the case's own list also has A completing, and haiku declined. Whether S-17 passes with A's failure recorded as a finding is the owner's decision; the case as written fails."
  - id: D3
    description: "S-51 live: the small, medium and large items ran with --model haiku, sonnet and opus (launch flags, launch:run steps and the host's init events agree) in both runs; the test stopped at the item-state assertion before reaching its own model assertions, so these facts were read from the evidence by hand"
    requirement: "AUT-16"
    verification: []
    human_judgment: true
    rationale: "The facts are in the ledger and transcripts of both runs but the case verdict is FAIL and its own model assertions did not run"
  - id: D4
    description: "S-50, S-18 (short), S-21, S-52, CS-5 and CS-15 live: written, not started (tracer gate)"
    verification: []
    human_judgment: true
    rationale: "Not exercised; the plan stops for a fix plan"
  - id: D5
    description: "Every live start was guarded by the Phase 3 ledger and this plan's 6.00 USD total: 2 starts, 3.4561 USD for plan 03-27, 4.5488 USD for Phase 3"
    verification:
      - kind: command
        ref: "node -e (sum of costUsd over test/containment/live-spend-phase3.jsonl) gives 26 lines, 4.5488 USD, 3.4561 for plan 03-27"
        status: pass
    human_judgment: false

duration: about 25 min of execution after setup (approximate; two live runs of about 4 and 6 minutes)
completed: 2026-11-09
---

# Phase 3 Plan 27: the live run-purpose cases of Slice 2 Summary

**HALTED at the tracer gate. The harness and seven cases are in place, and the tracer `s17-s51` ran twice live (3.4561 USD): B paused and blocked item-locally, C (opus) committed with G2 evidence, D was never delegated, and each item ran on its size's model, but item A (small, so haiku) did not complete either time, so the case fails and no other case was started.**

## Performance

- **Duration:** about 25 min after setup (approximate); the two live runs took 4 and 6 minutes
- **Started:** 2026-11-09T15:11Z
- **Completed:** 2026-11-09
- **Tasks:** 1 of 3 (the tracer); tasks 2 and 3 not started because the tracer gate failed
- **Commits:** 2 (the plan metadata commit follows)
- **Live spend:** 3.4561 USD of this plan's 6.00 USD; Phase 3 total 4.5488 USD of 25 USD

## What the tracer measured

Run 1 (`run_01M70E7HYWA93MNGJADABXFCQC`, 1.4970 USD) and run 2 (`run_01M70EN23R03Y3VWQB7C02Y8B6`, 1.9591 USD), both on Claude Code 2.1.319, both ended `blocked_on_decision (decision)` with exit 3.

| Item | Size, model | Run 1 | Run 2 |
|---|---|---|---|
| A | small, haiku | 3 tool calls, all refused by the hook (`shell-syntax` x2, `shell-not-allowed`); the third refusal in a row ended the invocation; 0.004 USD; a `repeated_failure` decision | 10 tool calls (2 refused), then a final message saying the quick workflow needs shell commands outside the run's command list; no edit; 0.0152 USD; a `permission` decision |
| B | medium, sonnet | no tool call, a numbered-choice question, 0.0607 USD; `blocked:decision`, one `acceptance` decision affecting B and D | same shape, 5 tool calls (1 refused), 0.1586 USD |
| C | large, opus | committed (`src/version.ts`, `test/version.test.ts`), G1 and G2 passed with passed check evidence, 33 tool calls, 1.4323 USD | same, 41 tool calls, 1.7854 USD |
| D | small, depends on B | never delegated (no attempt, no invocation) | same |

- **Held (S-17).** An independent item completed with evidence and its own commit while B was blocked; D waited; no G1 row names B, so the decision came from the unit's own pause; no commit touches B's or D's work; the run stopped blocked with nothing answered.
- **Held (S-51, RC-8).** The launch lines carried `--model haiku`, `sonnet`, `opus` in launch order, the `launch:run` steps named them, and the host's init events reported `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`.
- **Notifications.** Every delivery failed `osascript-missing` after three attempts, no banner was posted, and nothing was answered. Because A also blocked, the run held two open decisions and two notification rows (one banner, three attempts, covering both), not the one the case expects.
- **Not held.** A did not complete. In run 1 the cause is the hook's loop limit (three refusals in a row) on the unit's first three calls; in run 2 the haiku unit declined to improvise outside its command list and stopped with the repository unchanged. Sonnet and opus ran the same prompt to a question and to a commit. This is the default `modelBySize.small = haiku` meeting a unit it will not finish on this host, not a flake of one run.

## Accomplishments

- **The harness (all of plan 03-27's harness work).** `LiveRunSpec` takes a `brief`, `repoFiles`, `conventions`, `indexes`, a `profile` block (written after onboarding; the notify block names an osascript path that does not exist), post-run `steps` run through the production CLI (`digest`, `inbox --json`, `status --json`, `decide` on a pseudo-terminal through `pty-drive.py`, which was smoke-tested offline against the fake host and answers a blocked run), `settleNotificationsMs`, and a `planCap`. New exports: `modelLoggingWrapperScript`, `launchModelsOf`, `invocationRecords` (per-invocation item, model, init event, hook decisions), `planTotalRefusal`. `runLiveRunUnit` takes `agentsDir` and `planTotalUsd`.
- **The suite.** Seven cases, each with a ground-truth verdict and a result line, and `NOT EXERCISED` as its own verdict where the situation never arose: `s17-s51` (run twice), `s50` (three items without sizes or files; the start summary and the stored `spec.derived`), `s18-short` (osascript missing, a digest that fails, inbox and status), `s21` (a deleted failing test, a skip marker and a VERIFICATION override through a tamper step that `npm test` runs only under `AVARICE_RUN`), `s52` (item B breaks a test item A added), `cs5` (a probe from subagents and the budget rows summed over two items) and `cs15` (a poisoned agent definition refused before the host starts, and an Agent call for a type the run was not given). The briefs of five of them were compiled in process without a supervisor (all compile; the S-50 summary prints `medium (derived)` and `files ... (derived)` for each item), and the first part of `cs15` was run with no model (refused with `enforcement_failure:invocation-files:invalid`, no agents file written, the builder on the same directory names `permissionMode`). None of the six was started live.

## Task Commits

1. **Task 1: tracer (harness, suite, two live runs)** - `384df53` (test)
2. **Live record** - `848a724` (docs, LIVE-CASES.md section and spend row)

**Plan metadata:** the docs commit that carries this file, STATE.md and ROADMAP.md.

## Files Created/Modified

- `test/helpers/live-harness.ts` - the additions above
- `test/containment/live-run-phase3.test.ts` - the seven cases
- `test/containment/live-run-phase3.jsonl` - two result lines, both `s17-s51`, both FAIL
- `test/containment/live-spend-phase3.jsonl` - two lines under plan 03-27
- `test/containment/LIVE-CASES.md` - the plan's section and the spend row

## Decisions Made

See `key-decisions`. The one the owner must make is below.

## Deviations from Plan

**1. [Tracer gate] HALT after the tracer failed twice**
- **Found during:** Task 1
- **Issue:** `s17-s51` failed on the item-state assertion in both runs; the executor protocol for a `tracer` task says to re-run its `<verify>` once and to halt, never expand, if it fails again.
- **Fix:** none attempted beyond the one permitted re-run; Tasks 2 and 3 were not started, `status: halted`.
- **Impact:** no live evidence yet for S-50, S-18, S-21, S-52, CS-5, CS-15 or CON-15 for the run purpose; the plan's acceptance (eight PASS lines) is not met.

**2. [Plan reading] The cases were written together**
- Tasks 2 and 3 add cases to the file Task 1 creates; the whole file was written before the tracer ran so the harness could be checked against every case's needs (briefs compile, the pty `decide` path works, the CS-15 refusal works). Only `s17-s51` was started. The unrun cases are untested against a live host and may need changes (their `not exercised` conditions are written for the ways a real model can decline).

**3. [Rule 1 - judge order] The case's model assertions come after its item-state assertion**
- The S-51 assertions never ran because the S-17 item-state assertion failed first, so the S-51 facts in this summary were read from the evidence by hand (flags, steps, init events). A fix plan may want the model assertions first, so S-51 gets its own verdict.

**4. [Plan reading] Cap raised for the one re-run**
- The per-invocation cap went from 1.60 to 2.00 USD for run 2 after opus cost 1.4323 USD in run 1. The run cap stayed 3.00 USD and the plan total guard (6.00 USD) held.

**Total deviations:** 1 gate halt, 3 plan readings. **Impact:** plan 03-27 is incomplete by design (halted); it asks for a decision.

## Issues Encountered

- **Haiku does not complete a quick unit on this host** (the finding above). The same property would hit `s50`, `s52`, `s21` and `cs5`, which all use a haiku unit; starting them would likely spend budget on the same refusal.
- **Opus is not cheap on a one-line change:** 1.4323 and 1.7854 USD for item C, 41 to 52 percent of this plan's 6.00 USD for the two runs together.
- One unintended command: the first attempt to run a dry script with a `timeout` command failed (not installed on macOS); nothing else ran outside the plan.

## Decision needed (for the fix plan or the owner)

Choose how the tracer is to pass, then re-plan the other six cases around it:

1. **Keep RC-8's map and change the case:** judge S-17 on B, C and D and judge S-51 on the three invocations' models, with A's failure recorded as a finding (not a failure of the case). Cheapest; leaves a product question open.
2. **Change what a small item runs on:** a decision about `modelBySize.small` (a preset value, compiled into every contract) or about the prompt for a small unit, so haiku finishes the workflow. This changes behaviour and needs `docs/system` and a Phase 3 decision record.
3. **Give A an explicit model** (`model: sonnet` in the brief): S-17 passes as written, S-51 then needs its haiku evidence from a second, cheap item that is allowed to fail or to pause.

The remaining budget is 2.5439 USD of this plan's 6.00 and 20.4512 USD of Phase 3's 25. A later plan should also say what an opus item may cost, or use a smaller large item.

## Known Stubs

None. The six unrun cases are written and skipped without `AVARICE_LIVE`; they are not placeholders.

## Threat Flags

None. The only new surface is test code that spends model budget behind `AVARICE_LIVE=1` and a plan total check, covered by the plan's T-03-52; no question text and no model text is written to the results file (the final message of A was read locally and is paraphrased here).

## Threat mitigations

- **T-03-52:** every start was checked against the Phase 3 ledger and the plan's 6.00 USD total before it began; both starts were recorded (3.4561 USD).
- **T-03-51:** not exercised live (CS-5 and CS-15 were not started); the CS-15 definition refusal was shown offline with the real adapter and no model.
- **T-03-SC:** no package installs.

## Documentation surfaces (for plan 03-31)

No `docs/system/` file changed: nothing built changed behaviour. The documentation plan carries: the live harness surface in `docs/operations-and-testing.md` material (items brief, profile notify block, post-run steps, the launch-model log), and a line for `docs/system/findings.md`: a small item (haiku by the default map) does not complete the quick workflow under the run's command list (`src/domain/run-contract.ts` `modelBySize`; two live runs, run results in `live-run-phase3.jsonl`).

## Self-Check: PASSED

Created and modified files exist (the suite, the results file, the harness, the ledger, LIVE-CASES.md); commits `384df53` and `848a724` are ancestors of HEAD; the ledger sums to 4.5488 USD over 26 lines, 3.4561 of it plan 03-27 (under its 6.00 and the 25 USD ceiling); `tsc -p .` and `check-boundaries` are clean; the three live-harness unit tests pass and the new suite skips all 7 cases without `AVARICE_LIVE`. The plan's own acceptance (eight PASS lines) is NOT met; this is recorded as `status: halted`, not as a pass.

## Resumed by plan 03-39

Plan 03-27's eight live cases have all passed, so the halt of this plan is closed. The halt record above stays as written.

**The fix chain.** Plans 03-34 and 03-35 dealt with the haiku unit (03-35 probed it, and the owner chose `proceed-haiku`); plan 03-36 ran four cases (`s50`, `cs15-definition`, `cs15`, `s18-short`) and halted at `s21`; plan 03-37 moved the `s21` tamper and the `cs5` write out of the unit's reach and halted at `s21` again; plan 03-38 gave each remaining case its own brief and halted when the `s21` judge asserted rules the built run cannot produce for a combined tamper; plan 03-39 judged `s21` on the built behaviour from the kept 03-38 run and ran `cs5`, `s52` and `s17-s51`, which passed on their first runs.

**Each case's PASS line.**

| Case | Plan | Cost (USD) | Results line | Run | Evidence directory |
|---|---|---|---|---|---|
| `s17-s51` | 03-39 | 2.5605 | 15 | `run_01M716VJSNXFWTEN5VQGJTMFMB` | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-Pkw83m` (disposed after the PASS) |
| `s50` | 03-36 | 0.0730 | 4 | `run_01M70V4QSDDAVWM07SNVPF5NB1` | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-oAPw6i` (disposed) |
| `s18-short` | 03-36 | 0.0639 | 7 | `run_01M70VK8XFHQHAYY6XB9AKD0NG` | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-cwx6gS` (disposed) |
| `s21` (re-judged on the built behaviour, no new spend) | 03-39 | 0 | 12 | `run_01M7149X5PFK4CTK44C9NWX5JK` (the plan 03-38 run) | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-9o5pqG` (kept) |
| `s52` | 03-39 | 0.1640 | 14 | `run_01M71682X3SN57X5Y0KHQ5XVQ9` | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-3J5gRc` (disposed) |
| `cs5` | 03-39 | 0.1318 | 13 | `run_01M715R14RYDVVC608VSNZGS2Q` | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-QqOIP9` (disposed) |
| `cs15-definition` | 03-36 | 0 | 5 | none (refused before the host started) | none |
| `cs15` | 03-36 | 0.0028 (ledger label `03-27`) | 6 | no run ID | `/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/avarice-cli-dg3RLM` (disposed) |

**Original "Decision needed" options not taken.** None of the three options above was taken. Item A stayed a small item on haiku (option 1 would have judged the case without A, option 2 would have changed `modelBySize.small` or the small-unit prompt, option 3 would have given A an explicit model). With the per-case brief of plan 03-38, `s17-s51` passed as written: A (haiku) and C (opus) done, B (sonnet) blocked on the owner choice, D ready and never delegated.

Totals after plan 03-39: plan 03-39 spent 2.8563 USD; the group 03-27, 03-35, 03-36, 03-37, 03-38 and 03-39 spent 6.8812 of 10.00 USD; Phase 3 spent 7.9739 of 25 USD (39 ledger lines). Host: Claude Code 2.1.319, the pinned binary. S-21 was judged on the built behaviour (owner decision of 2026-11-09): G2 for item A failed with `deletion-scope` and `no-new-overrides`, the skip marker was not separately evaluated because the test inventory runs only when every other G2 rule passes, nothing was committed, the run never reached `ready_for_review` and ended `blocked_on_decision` with an open `permission` decision. The single-tamper paths are proven offline by `test/integration/run-repair.test.ts` (describe "S-21 offline: each way a repair can weaken the check ends in a repeated_failure decision with the reproducer (T-03-36)", with the repair control), `test/integration/run-gates.test.ts` (a `.skip(` added to an existing test: G2 test-inventory new-skip-marker) and `test/unit/gates.test.ts`. The scenario-versus-code disagreement is one line in `docs/system/findings.md`, for the owner to decide which side moves.
