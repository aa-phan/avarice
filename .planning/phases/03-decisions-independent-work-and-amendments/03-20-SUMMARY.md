---
phase: 03-decisions-independent-work-and-amendments
plan: 20
subsystem: cli
status: complete
tags: [decide, decisions, response-validation, stale, supervisor-pickup, identity, d-15, aut-4, aut-5]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the ledger answer, stale re-open and withdraw (03-02), validateResponse, optionsOf, the shared state digest (03-05), the responder identity helpers and the `ancestry` seam (03-15), isBlockedRunContinuable and the supervisor pickup of a blocked run (03-18)"
provides:
  - "`avarice decide <decision-id> [<option-key> | --text \"...\"] [--wait]`: answers, withdraws, ignores a repeat, re-opens a stale answer, refuses and records, or records an amendment request"
  - "decide() and findDecision() in src/app/decide.ts with DecideOutcome (kind, pickup spawn | live-supervisor | none)"
  - "renderDecision(row, width) in src/cli/render/decision-view.ts"
  - "amendCommandOf and isAmendOnly in src/domain/decision-policy.ts"
  - "events decision.rejected, decision.duplicate and amendment.requested; run step supervisor:decide"
  - "the spawn-supervisor allow-list is decide.ts, resume.ts and start.ts; a pin that only decide.ts calls the three ledger calls that move a decision"
affects: [03-22, 03-25, 03-31]

actuals:
  tokens: 15500
  tasks: 3
  commits: 7
plan_head_before: f800e8bdfa1079d1c4993829421a2b6753440e88
plan_head_after: d7ce176414a8c16dd1cd4aba513ce0b4dc7dd471
commits: 7

tech-stack:
  added: []
  patterns:
    - "A command that answers for the owner refuses in usage() (AVARICE_RUN, no terminal, the run's process tree) before the profile resolves, then checks ownsProfile in run() before any write"
    - "The pure D-15 rule decides; the service only maps its verdict to one ledger call and one recorded event, and a conflict re-reads once and decides again"
    - "The pickup after a write is read from the ledger: spawn when the blocked run is continuable and its lease is free, live-supervisor when a lease is held"

key-files:
  created:
    - src/app/decide.ts
    - src/cli/commands/decide.ts
    - src/cli/render/decision-view.ts
    - test/integration/decide.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-20-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-20-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-20-red-evidence-task3.json
  modified:
    - src/cli/main.ts
    - src/domain/decision-policy.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "A refusal after the store opens is recorded as decision.rejected with the run, the decision and the check name only; a refusal on identity is not recorded (it says nothing about the decision, and the run's own attempt is on record by the hook's deny event)"
  - "A withdraw-only record that is answered by an option key is an amendment request only when it lists options and every one is withdraw and carries an amend command; a Phase 2 record (options `[]`) answered by a key is an unlisted option, exit 64"
  - "A stale answer re-opens the decision (exit 3) with the answer kept as context and prints the successor's ID and `contract v<opened> -> v<latest>`; it never applies"
  - "Exit 3 for a refusal about the state of the decision (answered differently, withdrawn, stale, not open) or an amendment request; exit 64 for what was typed or who typed it"
  - "`decide <id>` with no answer prints the record on standard output and the `give an option key or --text` line on standard error, exit 64, no ledger row changed"
  - "--wait follows only a supervisor decide started: the run is already in a stop state when it starts, so the wait first lets the supervisor take the run up, then follows it to where it stops"
  - "A withdrawal is withdrawDecision (state withdrawn, items keep their state), never answerDecision with the text withdraw, so the supervisor's undeliverable end names the withdrawn decision"

patterns-established:
  - "The amend command of a record is read from the stored consequences with the placeholder replaced by the decision's own ID, in one function shared by the service and the view"

requirements-completed: []

coverage:
  - id: D1
    description: "On the S-17 blocked run, `decide <dec> 1 --wait` on a terminal answers the decision as owner:<os user> through the terminal channel, prints `decision <dec> answered (1)` and `run <runId>: supervisor started`, starts one detached supervisor through the single spawn path (step supervisor:decide with its pid), and the run ends ready_for_review with A to D done"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide: a valid answer on the S-17 blocked run answers, starts the supervisor and the run reaches ready_for_review (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "With a live lease held by another holder, decide answers, prints that the running supervisor takes item B next, records no supervisor step and leaves the lease and the release of B to the scheduler"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide: a live supervisor holds the lease, so the answer starts nothing and the scheduler takes the item next (D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AVARICE_RUN, a non-terminal stdin or stdout, an ancestor carrying the supervisor signature and an unreadable process table each exit 64 with the reason, create no data root on a profile that never existed, and leave a real store byte for byte unchanged with no event appended"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide: refused inside a run, off a terminal and from a run process tree (identity, D-14)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The option, duplicate, open and state-digest checks of D-15 end to end: an unlisted key and free text where not allowed or over 2000 characters exit 64 and are recorded; a repeat is ignored and recorded; a different answer to an answered decision, any answer to a withdrawn or stale one exits 3 and is recorded; a Phase 2 decision with no options is answered by withdraw only; every decision.rejected carries runId, decisionId and check only"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide: the checks of D-15 in their order, end to end"
        status: pass
    human_judgment: false
  - id: D5
    description: "After `contract amend` writes version 2, an answer to a decision opened on version 1 is not applied: the decision is stale with the answer kept, a successor on version 2 supersedes it with the same question and options, the output names it and `contract v1 -> v2`, the old ID then refuses naming the successor, and the successor can be answered (SC3 stale path)"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#state-digest: after an amendment, the answer to the old decision re-opens it with the answer kept as context and applies nothing (SC3 stale path)"
        status: pass
    human_judgment: false
  - id: D6
    description: "An option key on a scope-expansion record whose only option is withdraw records amendment.requested, prints the record's amend command with its own decision ID, applies nothing and writes no contract version; withdraw closes it. A withdrawal that leaves nothing to deliver starts the supervisor, which moves the run running -> failed naming B and D and the withdrawn decisions"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#a decision that is answered by an amendment (inside the D-15 suite) and #decide: a withdrawal that makes the blocked run continuable starts the supervisor, which ends the run failed"
        status: pass
    human_judgment: false
  - id: D7
    description: "`decide <dec>` with no answer prints the record (run, item and the items behind it, class, the issue under `question from the unit (data):`, each option as `key: label`, the recommendation, the consequences, the amend command) with control characters and escapes stripped, lines cut to the width (80 when unknown) and the issue to 1000 characters, exits 64 and changes no ledger row; an unknown decision exits 64 naming its ID"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide <id> without an answer prints the record and writes nothing, #renderDecision: a pure view of one decision row"
        status: pass
    human_judgment: false
  - id: D8
    description: "Only the decide service calls answerDecision, reopenStaleDecision and withdrawDecision outside the ledger: no supervisor stage, timer or retry can answer a decision because time passed"
    requirement: "AUT-4"
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts#only the decide service answers a decision (AUT-4)"
        status: pass
    human_judgment: false
  - id: D9
    description: "AUT-5 stays `unclassified` in the coverage report: the response validation suite above is its explicit criterion and holds offline; whether the identity rule holds against a real contained model trying to run the command is the live containment case, not run in this plan"
    requirement: "AUT-5"
    verification: []
    human_judgment: true
    rationale: "The offline suite proves the refusals with a scripted process chain, a real ps walk of the test process and the hook's deny rule is a separate layer; a live contained session attempting `avarice decide` is a later live case"

duration: about 30 min (approximate; the start time was not recorded)
completed: 2026-11-09
---

# Phase 3 Plan 20: `avarice decide`, the response validation and the supervisor pickup Summary

**`avarice decide` lets the owner answer or withdraw a decision from a terminal outside the run, checks every answer in the D-15 order (identity, open, listed option or allowed text, duplicate, state digest), re-opens an answer that arrives on a moved contract instead of applying it, and starts the detached supervisor through the one spawn path only when nobody holds the lease.**

## Performance

- **Duration:** about 30 min (approximate; the start time was not captured)
- **Completed:** 2026-11-09
- **Tasks:** 3 (a tracer and two auto tasks), each with a RED commit and a GREEN commit, plus one pin test
- **Files modified:** 10 (7 created including three RED records, 3 modified)
- **Commits:** 7 (the plan metadata commit follows)

## Accomplishments

- **The command.** `decide <dec> <key>`, `decide <dec> --text "..."` and `decide <dec> withdraw`, with `--wait`. `usage()` refuses AVARICE_RUN, a non-terminal and a run's process tree before the profile resolves; `run()` refuses a profile the user does not own before any write. The answer is recorded as `owner:<os user>`, channel `terminal`.
- **The D-15 order, end to end.** The service reads the decision, its run and the latest contract, computes the digest with `stateDigestOf` (the function that stamped the decision), and maps the verdict of `validateResponse` to one ledger call: `answerDecision` (with the latest contract version as `expectContractVersion`), `withdrawDecision`, `reopenStaleDecision`, or an event. A ledger conflict re-reads once and the rule decides again.
- **Stale is re-opened, never applied (SC3).** After `contract amend` wrote version 2, the answer to a version 1 decision leaves the old row `stale` with the answer kept, opens a successor on the new digest and contract version with the same question, options and affected items plus a `contract:v2` reference, and prints the successor and `contract v1 -> v2`.
- **Refusals are recorded with the check name.** `decision.rejected` carries the run, the decision and the check name only; a repeat of the same answer is `decision.duplicate`; a different answer to an answered decision, and any answer to a withdrawn or stale one, exit 3.
- **Non-pause decisions.** A record that lists only withdraw and carries an amend command is answered by an amendment (D-17): an option key records `amendment.requested`, prints the command with the decision's own ID and applies nothing. A Phase 2 record (no options) refuses a key as an unlisted option and is withdrawn with `withdraw`.
- **The pickup (D-16).** After an answer or a withdrawal `decide` reads the run: blocked, continuable by the shared rule and the lease free or expired means `spawn` (the command calls `spawnSupervisor`, records `supervisor:decide` with the pid, and prints `run <id>: supervisor started`); a live lease means `live-supervisor` and the line `run <id>: a running supervisor takes item B next`. A withdrawal that leaves nothing to deliver starts the supervisor that ends the run `failed` naming B, D and the withdrawn decisions.
- **The record view.** `decide <dec>` alone prints the record through `renderDecision` and exits 64 with the ledger unchanged. The issue sits under `question from the unit (data):`.

## Task Commits

1. **Task 1: tracer, `decide <id> 1` on the S-17 blocked run** - `5f6c98b` (test, RED), `78d5728` (feat, GREEN)
2. **Task 2: the response validation suite end to end** - `ac0c833` (test, RED), `4b64072` (feat, GREEN)
3. **Task 3: the decision record view and `decide <id>` without an answer** - `c92cb40` (test, RED), `bb09fe1` (feat, GREEN)
4. **AUT-4 pin** - `d7ce176` (test): only the decide service calls the three ledger calls that move a decision

**Plan metadata:** the docs commit that carries this file, STATE.md and ROADMAP.md.

## TDD gate

- RED task 1 (`5f6c98b`): both decide tests failed on the exit code (`unknown command 'decide'`) and the footprint allow-list test failed; GREEN `78d5728`, which passed the tracer gate before Task 2 began.
- RED task 2 (`ac0c833`): 8 of the 8 response-suite tests failed on assertions (no event recorded, duplicate and stale `not supported yet`, an amendment request read as an unlisted option); the identity refusals and the withdrawal that ends a run already held from Task 1. GREEN `4b64072`: 49 of 49.
- RED task 3 (`c92cb40`): 6 tests failed against a typed stub of `renderDecision`; GREEN `bb09fe1`: 88 of 88 in the two files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `--wait` returned at once**
- **Found during:** Task 1
- **Issue:** `waitForRun` returns when the run is in a stop state, and `blocked_on_decision` is one, so `decide --wait` reported `blocked_on_decision` (exit 3) before the supervisor it started had taken the run.
- **Fix:** the command first waits until the run leaves `blocked_on_decision` or the supervisor process is gone, then follows it with `waitForRun`.
- **Files modified:** src/cli/commands/decide.ts
- **Commit:** 78d5728

**2. [Rule 2 - Missing critical] A withdrawal must not go through the answer call**
- **Found during:** Task 1 design
- **Issue:** answering `withdraw` through `answerDecision` would store the text `withdraw` as an answer and release the decision's items to `ready`, so the run would run an item the owner withdrew.
- **Fix:** a withdraw verdict calls `withdrawDecision` (state `withdrawn`, items keep their state), which is what the supervisor's undeliverable end reads.
- **Files modified:** src/app/decide.ts
- **Commit:** 78d5728

### Plan readings and judgment calls

**3. Test seam for the spawn.** The plan names no way to give a test the supervisor entry. The tests set `process.argv[1]`, `process.execArgv` and `AVARICE_FAKE_HOST` for the duration of the call, the same way `test/integration/shell-supervisor.test.ts` does, so no production seam was added.

**4. Two helpers in `src/domain/decision-policy.ts`.** `amendCommandOf` and `isAmendOnly` are not in the plan's file list. Both the service and the view need the stored shape of the amend command, so it is one function next to `optionsOf`.

**5. The no-answer test compares ledger rows, not file bytes.** A command that opens the store read-write records its adapter descriptors, so the bytes of `state.db` move when it is merely opened. The identity-refusal tests, which never open the store, compare bytes; the view test compares every row of every table but the adapter descriptors and the event count.

**6. The head of the record is two lines.** `decision <id> (open)` and `run <id>` are separate lines: with the real 30-character IDs the one-line form is 84 characters, over the 80-column default. The amend command is printed whole, not cut, because a cut command is a different command.

**7. A refusal on identity is not recorded.** The plan's flagged assumption says rejections after the store opens are recorded; an identity refusal inside the service (a profile that is not the user's own is refused in `run()` before the service) returns the rejection without an event, since it says nothing about the decision.

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical), 5 plan readings. **Impact:** none on the plan's truths.

## Issues Encountered

- The first compound shell command that was to record the plan's base HEAD was refused by the session's command checks, so the commit ledger file `gsd-plan-head-before-03-20` was written later with the HEAD the plan started from (`f800e8b`).
- Commit trailers follow the orchestrator prompt (Claude Opus 5.5); the harness attribution named another model.

## Documentation surfaces (for plan 03-31)

`docs/system/` exists in this checkout but was not edited: the plan defers it to the phase's documentation plan, as plans 03-02 to 03-19 did. What it must cover:

- **Command:** `avarice decide <decisionId> [<option-key> | --text "..."] [--wait]`. The decision ID is `dec_` and 4 to 64 letters or digits. One option key (1 to 200 characters) or `--text` (not both). `withdraw` is an option key. With neither, the command prints the record and exits 64.
- **Identity rule:** refused, in this order, with AVARICE_RUN set, without a terminal on standard input and output, and from a process whose ancestors include a command line containing ` supervise run_<id>` or when the process table cannot be read; all exit 64 before the profile is resolved and create nothing. Then, once the profile is open: `only the user who owns the profile answers a decision` (exit 64, nothing written).
- **Output lines:** `decision <id> answered (<key>|text)`; `decision <id> withdrawn`; `decision <id> already answered; ignored`; `run <runId>: supervisor started`; `run <runId>: a running supervisor takes item <item> next` (a withdrawal says `a running supervisor continues the run`); for a stale answer `the run changed since decision <id> was asked (contract v<n> -> v<m>); your answer was not applied`, `decision <new> asks the same question on the new state, with your answer kept as context`, `answer it with: avarice decide <new> <option-key>`; for an amendment request `decision <id> is answered by an amendment, not by an option; nothing was applied`, `amend with: <command>`, `or take it back: avarice decide <id> withdraw`; refusals on standard error as `avarice decide: <detail>`.
- **The record view:** `decision <id> (<state>)`, `run <runId>`, `item: <first affected> (also affects <rest>)`, `class: <class>`, `re-opens: <id>` for a successor, `question from the unit (data):` and the issue indented two spaces (cut to 1000 characters, blank lines dropped), `options:` with `<key>: <label>` and `(answer with --text "...")` for a text option, `recommendation: <text>`, `consequences:`, `answered: <answer> (<who>)`, `amend: <command>`. Every line but the amend command is cut to the width (80 when the terminal does not say).
- **Exit codes:** 0 answered, withdrawn or a repeat ignored; 3 an answer not applied for the state (answered differently, withdrawn, stale, not open), a stale re-open, an amendment request, or `--wait` ending in any state but `ready_for_review`; 64 usage, unknown decision, unlisted option, free text not allowed or invalid, a refusal; 70 internal, including a supervisor that could not be started.
- **Events:** `decision.rejected` `{runId, decisionId, check}` with checks `option-not-listed`, `free-text-not-allowed`, `text-invalid`, `answer-ambiguous`, `answer-missing`, `decision-answered`, `decision-withdrawn`, `decision-stale`, `decision-not-open`; `decision.duplicate` `{runId, decisionId}`; `amendment.requested` `{runId, decisionId}`; the ledger's `decision.answered`, `decision.stale` and `decision.withdrawn` as before. Run step `supervisor:decide` `{pid}` (attempt counts up).
- **Stored on a stale answer:** the old row `state=stale`, `answer`, `answered_by` `owner:<os user>`, `answer_channel` `terminal`; the successor `state=open`, `supersedes` the old ID, the new `state_digest` and `contract_version`, `evidence_refs` plus `contract:v<n>`.
- **Pickup rule:** blocked, `isBlockedRunContinuable`, lease free or expired: spawn. A live lease on a blocked or running run: nothing starts. A withdrawal uses the same rule; `--wait` follows only a supervisor decide started.
- **Findings to record:** `--wait` with a live supervisor does not wait (no pid to follow); a decision of a run in a stop state other than blocked (failed, cancelled) is still answerable and starts nothing; the digest covers the contract version, base revision, policy revision and ticket revisions only, so an amendment that leaves them unchanged would not stale a decision.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The surface (a command that writes decision rows from a terminal, one detached process through the existing spawn path) is inside the plan's trust boundaries and T-03-38 to T-03-40.

## Threat mitigations

- **T-03-38:** AVARICE_RUN, a non-terminal and the run's process tree are refused in `usage()` before the profile resolves (store bytes unchanged in the test), `ownsProfile` is checked in `run()`, and the hook's deny of the avarice prefix is the layer before both.
- **T-03-39:** the D-15 order is one pure function; `answerDecision` re-checks the open state and the contract version in its transaction; a conflict re-reads once; a stale answer re-opens and applies nothing; every check has an end-to-end test.
- **T-03-40:** `renderDecision` strips control characters and escapes, cuts every line to the width and the issue to 1000 characters; tested with an OSC string, an SGR, a bell and a clear-screen in the issue and a label.
- **T-03-SC:** no package installs.

## Next Phase Readiness

Ready for 03-22 (the resumed session in front of the fresh unit: the answer is on the decision row and `decide` leaves the park step and ref alone) and 03-25 (the terminal prompt after the record view and the chain into `contract amend`: `amendCommandOf`, `isAmendOnly` and `renderDecision` are the pieces it uses). Requirements AUT-4 and AUT-5 are declared by other incomplete plans, so `requirements.ready-ids` reports none ready and none is marked complete here.

## Self-Check: PASSED

Created files exist (src/app/decide.ts, src/cli/commands/decide.ts, src/cli/render/decision-view.ts, test/integration/decide.test.ts, three RED records); commits `5f6c98b`, `78d5728`, `ac0c833`, `4b64072`, `c92cb40`, `bb09fe1` and `d7ce176` are ancestors of HEAD; `npx tsc -p .` and `node scripts/check-boundaries.ts` (94 files) are clean; the plan's verification set (decide, response-validation, footprint, render, plus contract-amend, identity and decision-policy as regressions: 226 tests) passes; the full suite passes (3278 tests, 3218 pass, 0 fail, 60 skipped); `grep -c "spawn(" src/cli/commands/decide.ts` is 0.
