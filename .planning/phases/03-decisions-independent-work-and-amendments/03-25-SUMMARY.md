---
phase: 03-decisions-independent-work-and-amendments
plan: 25
subsystem: cli
status: complete
tags: [decide, prompt, amend-chain, shell, pty, d-13, d-17, adr-013, aut-5]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "decide(), findDecision() and renderDecision (03-20); planAmendment, commitAmendment and the Io.ask seam of the shell (03-15); the amend command and request stored on a decision record (03-05); the shell menu and getInbox (earlier phases)"
provides:
  - "`avarice decide <id>` on a terminal prints the record and asks `answer (<keys>[, withdraw][, text][, amend]; empty leaves it open): `; a key, withdraw or free text goes through the same engine as the one-line form; an empty line or end of input exits 0 with `left open`"
  - "the amend chain: `amend` on a record that carries an amend command records amendment.requested, plans `contract amend` pre-filled from the record's measured request with the decision set, shows the diff and asks once; `y` records contract version n+1 and answers the decision `amended:v<n+1>` in one transaction, then the D-16 pickup runs"
  - "renderAmendmentPreview, confirmAndCommit and askStdin exported from src/cli/commands/contract.ts, shared by `contract amend` and the chain"
  - "requestAmendment and pickupOf exported from src/app/decide.ts; amendRequestOf in src/domain/decision-policy.ts"
  - "the shell's Decide action (keys 7 and d): lists the open decisions and runs `decide <id>` in the shell's process with the shell's prompt"
affects: [03-31]

actuals:
  tokens: 12400
  tasks: 2
  commits: 5
plan_head_before: f7f1ee7d6741b6e2ecfbc91877855f1e912c5a64
plan_head_after: 8099fa33e124464b23d0b53ed95f428186053a18
commits: 5

tech-stack:
  added: []
  patterns:
    - "A command's question goes to io.ask when its supplier gave one (the shell's prompt, a test) and to standard input only when both standard streams are terminals; with neither it prints what it has and exits 64"
    - "One function writes an amendment for both entry points: the command and the chain show renderAmendmentPreview, then confirmAndCommit asks and commits"
    - "Stored decision text is data twice over: amendRequestOf keeps only paths and positive finite budget values with safe names, and the shell list shows the issue's first line through the table's control-character stripping"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-25-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-25-red-evidence-task2.json
  modified:
    - src/cli/commands/decide.ts
    - src/cli/commands/contract.ts
    - src/cli/shell/actions.ts
    - src/app/decide.ts
    - src/domain/decision-policy.ts
    - test/integration/decide.test.ts
    - test/integration/shell-tty.test.ts
    - test/unit/shell.test.ts
    - test/unit/decision-policy.test.ts

key-decisions:
  - "The prompt lists only what the record accepts: its choice keys, `withdraw` when it lists a withdraw option, `text` when it takes free text, and `amend` when it carries an amend command; a typed line that matches a listed key is that key, `amend` on an amendable record is the chain, any other line is free text where the record allows it and otherwise an option key that the engine refuses as not listed"
  - "Declining the amendment prints `not amended` and `left open` and exits 0; an amend record with no measured request (a budget decision whose value was not measured) records the request, prints the command and exits 3 like the one-line form, because there is nothing to confirm"
  - "The chain's reason is `answer to <decisionId>`; the confirmation is the one `contract amend` asks, so the owner sees the whole diff and the identity rules of both commands apply (T-03-49)"
  - "A decision that is not open prints the record and the usage line with exit 64, as before, instead of asking a question the engine would refuse"
  - "No answer plus a real terminal reads standard input; the check is process.stdin and process.stdout isTTY inside run(), so a test that supplies neither an ask nor a terminal still gets the old record-and-exit-64 behaviour"

patterns-established:
  - "Shell action over a list: read through ctx.read, show a table, prompt for a number or ID, pick from the list only, run the command module through ctx.command"

requirements-completed: []

coverage:
  - id: D1
    description: "On a terminal, `decide <dec>` with no answer prints the record and asks; an option key, free text where the record allows it and an empty line (`left open`, exit 0, no ledger row changed) behave as the one-line form does, a key the record does not list exits 64 and is recorded as decision.rejected, and an answer to the S-17 blocked run's decision with a live lease holder prints that the running supervisor takes item B next"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide <id> on a terminal shows the record and prompts for the answer (D-13)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tracer: on a scope_expansion decision, `amend` then `y` records amendment.requested, shows the diff naming files.write and src/extra.ts, writes contract version 2 and answers the decision amended:v2 in the one contract.amended event, releases B and D and starts the supervisor, which ends the run ready_for_review; `n` records the request, writes no version and leaves the decision open; a pause record offers no amend and refuses it; a record with no measured request prints its command and writes nothing"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/decide.test.ts#decide <id> on a non-pause decision: amend chains into the contract amend confirmation (D-17)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The amend request is read defensively from the stored record: paths and positive finite budget values with safe names only, null when the record has no amend request, an empty request when it measured nothing"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#amendRequestOf (the request an amend chain pre-fills)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The shell menu lists `7  Decide`; the action says `no open decisions` when none, otherwise lists decision ID, run, class and the first line of the issue, takes a number or an ID from the list, refuses any other and runs nothing for an empty entry, and runs `decide <id>` through ctx.command"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/shell.test.ts#the action menu (ADR-013 decision 2) and #the Decide action (key 7 or d)"
        status: pass
    human_judgment: false
  - id: D5
    description: "On real pseudo-terminals: pressing 7 in the shell, choosing the decision and typing 1 at the shell's prompt records the decision answered by owner:<os user> on channel terminal; the one-shot `decide <id>` reads its answer from standard input and records `answered (2)`, and an empty line leaves it open"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/shell-tty.test.ts#the Decide action of the shell on a driven terminal"
        status: pass
    human_judgment: false
  - id: D6
    description: "AUT-5 stays `unclassified` in the coverage report: the prompt and the shell action are the same engine as the command and are covered offline; whether the identity rule holds against a real contained model trying to run them is the live containment case"
    requirement: "AUT-5"
    verification: []
    human_judgment: true
    rationale: "The identity refusals are the ones of plan 03-20 and are unchanged here; a live contained session attempting `avarice decide` or reaching the shell is a later live case"

duration: about 25 min (approximate; the start time was not recorded, estimated from the previous plan's last commit at 06:56 and this plan's last commit at 07:2x)
completed: 2026-11-09
---

# Phase 3 Plan 25: the decide prompt, the chain into amend and the shell's Decide action Summary

**`avarice decide <id>` now asks after printing the record, so the owner answers where they already are: a key, withdraw or text through the one engine, or `amend`, which chains into the `contract amend` diff and one confirmation that records contract version n+1 and answers the decision together; the shell's key 7 lists the open decisions and runs the same command.**

## Performance

- **Duration:** about 25 min (approximate; the start time was not captured)
- **Completed:** 2026-11-09
- **Tasks:** 2 (a tracer and an auto task), each RED then GREEN, plus one test commit for the one-shot pty case
- **Files modified:** 11 (9 changed, 2 RED records created)
- **Commits:** 5 task commits (the plan metadata commit follows)

## Accomplishments

- **The prompt (D-13).** After the record, `decide <id>` asks `answer (1, 2; empty leaves it open): ` (the keys come from the record: choice keys, `withdraw` and `text` when listed, `amend` when the record carries an amend command). What is typed goes through `decide()` unchanged, so the checks, the events (`decision.rejected`, `decision.duplicate`), the owner and channel on the row, and the D-16 pickup are those of `decide <id> <answer>`. An empty line or end of input prints `left open` and exits 0 with every ledger row as it was.
- **The chain (D-17).** `amend` calls `requestAmendment` (records `amendment.requested`, returns the record's command and measured request), plans the amendment with `planAmendment` using `reason: "answer to <dec>"` and the decision set, prints `renderAmendmentPreview`, and `confirmAndCommit` asks `apply contract v2? [y/N] `. `y` writes the version, the limits, the stale rows and the decision answer `amended:v2` in the ledger's one transaction (the single `contract.amended` event names `resolvedDecisionId`), then the supervisor pickup runs: on the S-17 blocked run B and D are released, the supervisor starts and the run ends `ready_for_review`. `n` leaves everything but the request event unwritten.
- **One amendment writer.** `contract amend` and the chain share `renderAmendmentPreview` and `confirmAndCommit`; `askStdin` is exported so the chain asks the same way outside the shell.
- **The shell action.** Key 7 (or d) reads `getInbox` through `ctx.read`, lists decision ID, run, class and the first line of the issue, takes a number or a listed ID, and runs `['decide', id]` through `ctx.command`, so the command's prompt is the shell's prompt. With nothing open it says `no open decisions`.
- **Real terminals.** Two pty cases: the shell (7, choose, type 1: answered by `owner:<os user>`, channel `terminal`) and the one-shot command reading standard input (`answered (2)`; an empty line leaves it open).

## Task Commits

1. **Task 1: tracer, the prompt and the chain into amend** - `0a249c6` (test, RED), `b371fed` (feat, GREEN)
2. **Task 2: the shell's Decide action** - `3f614f1` (test, RED), `6bf50fb` (feat, GREEN)
3. **One-shot pty case and shared fixture** - `8099fa3` (test)

**Plan metadata:** the docs commit that carries this file, STATE.md and ROADMAP.md.

## TDD gate

- RED task 1 (`0a249c6`): 9 of the 10 new tests failed on exit codes (64 where 0 or 3 was expected) and on the absent question; the one-line-form test already held. GREEN `b371fed`: decide plus contract-amend 54 of 54, including the tracer.
- RED task 2 (`3f614f1`): 5 failures (the menu line, the empty list, the list, the ID pick and the pty case); GREEN `6bf50fb`: shell, shell-tty and decide 96 of 96.
- Both RED records (`03-25-red-evidence-task1.json`, `task2.json`) hold the TAP output and a non-zero exitCode.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two exports in `src/app/decide.ts` and one helper in `src/domain/decision-policy.ts`**
- **Found during:** Task 1
- **Issue:** the plan lists only contract.ts and decide.ts (CLI) as source files, but the chain needs the pickup rule that decide uses (`pickupOf`, private to the service) and a way to record `amendment.requested` (`recordEvent`, private) and to read the stored request defensively.
- **Fix:** `pickupOf` is exported, `requestAmendment` is added to the service next to it, and `amendRequestOf` joins `amendCommandOf` in the domain policy (with its own unit tests).
- **Files modified:** src/app/decide.ts, src/domain/decision-policy.ts, test/unit/decision-policy.test.ts
- **Commit:** b371fed

**2. [Rule 1 - Bug, in the test fixture] The pty case seeded a decision with a placeholder digest**
- **Found during:** Task 2 GREEN
- **Issue:** the decision was opened with `stateDigest: 'sha256:test'`, so the answer was correctly treated as stale and re-opened instead of applied.
- **Fix:** the fixture opens the decision on `stateDigestOf(version, contract)`, as the supervisor does.
- **Files modified:** test/integration/shell-tty.test.ts
- **Commit:** 6bf50fb

### Plan readings and judgment calls

**3. The prompt's reach.** The plan says the prompt appears "when io.ask exists", while truth 1 says it appears on a terminal. `run()` uses `io.ask`, and when there is none it uses standard input if both standard streams are terminals (usage() already requires that outside tests). A test or caller with neither keeps the old record and exit 64.

**4. `left open` on a declined amendment.** The plan names `left open` for the empty answer. The same line follows `not amended` when the owner declines the chain, exit 0.

**5. A record with an empty request.** A budget decision whose value the run did not measure has `request: {}`. The chain records `amendment.requested`, prints the record's command (with `<value>` left for the owner) and exits 3, since there is nothing measured to pre-fill. This is the one-line form's amendment-request outcome.

**6. A decision that is not open** prints the record and exits 64 as in plan 03-20 and asks nothing.

**7. Extra test.** A one-shot pty case and `amendRequestOf` unit tests were added beyond the plan's list; the one-shot case is what shows truth 1 on a real terminal, since the integration tests supply `ask`.

**Total deviations:** 1 Rule 3, 1 Rule 1 (fixture), 5 plan readings. **Impact:** none on the plan's truths.

## Issues Encountered

- The chain's `--wait`: the decide command's `--wait` flag is honoured after the chain's pickup (the tracer uses it); without it the supervisor starts and the command returns.
- Commit trailers follow the orchestrator prompt (Claude Opus 5.5); the harness attribution named another model.

## Documentation surfaces (for plan 03-31)

`docs/system/` exists in this checkout and was not edited: the phase's documentation plan carries it, as plans 03-02 to 03-24 did. What it must cover:

- **Prompt:** with no answer, `avarice decide <decisionId>` prints the record (as plan 03-20) and, for an open decision on a terminal, asks `answer (<choice keys>[, withdraw][, text][, amend]; empty leaves it open): `. The question goes to the shell's prompt in the shell, to standard input otherwise; with no way to ask, or for a decision that is not open, the old behaviour holds (record, `give an option key or --text`, exit 64). The typed line is: empty or end of input -> `left open`, exit 0, nothing written; a listed key or `withdraw` -> the one-line answer; `amend` (only on a record with an amend command, and only when no option has that key) -> the chain; otherwise free text where the record has a text option, else an unlisted key (exit 64, recorded as `decision.rejected`).
- **Chain:** `amend` -> event `amendment.requested {runId, decisionId}` -> the `contract amend` diff lines (`run <id>: amending contract v<n> to v<n+1>`, one line per field, `invalidates: ...`, `answers decision <id> as amended:v<n+1>`) -> `apply contract v<n+1>? [y/N] ` -> on y: `contract v<n+1> recorded`, `decision <id> answered amended:v<n+1>`, then the D-16 pickup lines (`run <id>: supervisor started`, or `a running supervisor takes item <item> next`); on n or no answer: `not amended`, `left open`, exit 0. Reason recorded on the contract: `answer to <decisionId>`. The request pre-filled comes from the record's `consequences.amend.request` (`addWrite` paths, `budgets` values); with neither, `decision <id> is answered by an amendment, and the record has no measured request to pre-fill`, `amend with: <command>`, exit 3.
- **Exit codes:** unchanged from plan 03-20 (0, 3, 64, 70); a declined chain and an empty answer are 0.
- **Shell:** menu item `7  Decide` (keys 7 and d); `no open decisions`; the list columns `#`, `DECISION`, `RUN`, `CLASS`, `ISSUE (the unit's words, as data)`; prompt `decision to answer (number or ID): `; an ID not on the list prints `no decision matches "<entry>"`; the chosen decision runs as `decide <id>` in the shell's process.
- **Findings to record:** `decide <id>` with no answer is exit 64 only without a way to ask; the chain's amend of a decision whose record measured nothing cannot be confirmed here and falls back to the printed command; a shell list keeps decision and run IDs whole and cuts the issue first on a narrow terminal.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The chain writes through the existing amendment transaction and the existing decide engine; it adds no process, port or file.

## Threat mitigations

- **T-03-49:** the chain shows the full diff and needs `y` (tested: `n` writes no version); the request is the record's measured suggestion only, read defensively by `amendRequestOf` (paths and positive finite budget values, safe names); `usage()` refuses AVARICE_RUN, a non-terminal and a run's process tree before the profile resolves, and `ownsProfile` is checked before any write, for the chain as for the one-line form.
- **T-03-SC:** no package installs.

## Next Phase Readiness

Ready for 03-31 (the documentation plan) and for the other plans that reuse the shell's list-and-run pattern. Requirement AUT-5 is declared by other incomplete plans, so `requirements.ready-ids` reports it not ready and it is not marked complete here.

## Self-Check: PASSED

Created and modified files exist (the nine source and test files and the two RED records); commits `0a249c6`, `b371fed`, `3f614f1`, `6bf50fb` and `8099fa3` are on the branch; `npx tsc -p .` and `node scripts/check-boundaries.ts` (97 files) are clean; `grep -n "id: 'decide'" src/cli/shell/actions.ts` prints one line (272); the plan's verification set passes (decide, contract-amend, shell, shell-tty); the full suite passes (3419 tests, 3359 pass, 0 fail, 60 skipped; the one-shot pty case of the last commit was added after that run started and was run on its own: it passes).
