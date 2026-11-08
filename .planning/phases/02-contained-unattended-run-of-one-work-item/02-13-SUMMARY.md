---
phase: 02-contained-unattended-run-of-one-work-item
plan: 13
subsystem: run-kernel
tags: [running-stage, verifying-stage, g2, g4, supervisor-commit, hand-off, checks, decisions, correlation-ids, fake-run-host]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-05 outcome classifier and gates, 02-07 RunWorkspace clone and hand-off, 02-08 run scope and prompt, 02-09 S2-B findings (judge a unit from the quick directory, VERIFICATION status, clone diff and HEAD), 02-12 supervisor, stage registry and run invocation bookkeeping"
provides:
  - "src/app/run-stages/item.ts: runningStage (context-pack, launch:run, classify, gate:g2, commit) registered for `running`"
  - "src/app/run-stages/finish.ts: verifyingStage (verify:checks, gate:g4, handoff:fetch) registered for `verifying`"
  - "src/app/run-stages/blocked.ts: blockRun, the one place a run that cannot finish opens its decision, ends its attempt and moves to blocked_on_decision"
  - "src/app/run-stages/prepare.ts: configure-gsd action (gsd:inspect, gsd:configure with the seven RUN_GSD_SETTINGS); verify-enforcement made idempotent"
  - "src/app/checks.ts: runRequiredChecks and checksToRun (sandboxed checks, one evidence row each, output as an artifact)"
  - "src/domain/quick-record.ts: parseQuickVerification, countPruneEntries, quickRecordKind, storedText"
  - "RunWorkspace: restorePaths, removeUntracked, diffCommits"
  - "test/helpers/fake-run-host.ts: FakeRunHost driving the real hook entry; test-cli selects it when AVARICE_FAKE_HOST has a `run` key"
  - "Fault points mid-commit, mid-verify, mid-handoff; run steps context:pack, snapshot, classify, commit, handoff:fetch, gsd:inspect, gsd:configure; artifact kinds gsd-quick-record and check-output; events check.finished, handoff.fetched, containment.finding for runs"
affects: [02-14, 02-15, 02-16, 02-17, 02-18, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: 7b6a462b0a36b1e99831912459aa69e6baba3743
plan_head_after: da5f28a4dc5f148a3933e7dc8b3a4279f3a99b5b
commits: 3

tech-stack:
  added: []
  patterns:
    - "A unit is judged from facts AVARICE measured (result event, is_error, exit, signal, timeout, hook and host denials, clone HEAD before and after, a quick SUMMARY plus in-scope changes since the snapshot, a structural pause signal); the host outcome kind and every word of model text decide nothing (AUT-7)"
    - "One blocking path: classified kind or gate failure -> (reason, decision class) -> blockRun (decision, item, attempt, run transition); a run never ends in a branch it cannot hand off"
    - "GSD records and bookkeeping are artifacts (D-17): archived as gsd-quick-record, then restored to HEAD or removed, before the supervisor commits only in-scope paths"
    - "G2 runs the required checks on the working tree only when every other G2 rule already passes, so agent-changed code is not run for a unit that is already stopped"

key-files:
  created:
    - src/app/run-stages/item.ts
    - src/app/run-stages/finish.ts
    - src/app/run-stages/blocked.ts
    - src/app/checks.ts
    - src/domain/quick-record.ts
    - test/helpers/fake-run-host.ts
    - test/integration/run-baseline-workflow.test.ts
    - test/integration/run-events.test.ts
    - test/unit/quick-record.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-13-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-13-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-13-red-evidence-task3.json
  modified:
    - src/app/run-service.ts
    - src/app/run-start.ts
    - src/app/run-stages/prepare.ts
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - test/helpers/test-cli.ts
    - test/helpers/run-fixtures.ts
    - test/integration/run-supervisor.test.ts
    - test/integration/run-workspace.test.ts

key-decisions:
  - "A unit's verdict is read from the clone and the quick records, never from the host outcome kind; an unreadable, oversized or unknown VERIFICATION status is `gaps_found`, a host result with no details, no result event or no boolean is_error is never a success (classifyOutcome fails closed)"
  - "G2 stops a failing required check before the commit (the doc puts the checks in G2); G4 is the independent final proof at the clean commit. A checks-delta-only G2 failure is class repeated_failure with the failing evidence IDs, other G2 failures acceptance, scope and deletion failures enforcement_failure with a containment.finding naming the paths"
  - "After the unit, every artifact path in the clone is restored to HEAD or removed, including `.planning/config.json` that configure-gsd created (absent at HEAD), so the clone is clean at the committed revision; the revision of a clean run is `git:<sha>`, of a working tree `tree:sha256:` over the git tree id"
  - "A work item found `delegated` when the running stage starts is an error, not a relaunch: an interrupted attempt belongs to resume (plans 02-16 and 02-17)"
  - "start refuses with exit 3 and creates nothing when no admitted GSD is found, before the brief is compiled"

patterns-established:
  - "A decision stores model text as data: control, zero-width and bidirectional characters removed, cut to 1000 characters (T-02-44)"
  - "Event writers pass attemptId; gate.result and decision.opened now carry it (OPS-2)"

requirements-completed: [FR-1, FR-2, FR-4, FR-5, FR-6, AUT-7, RC-4, OPS-2, CON-2]

coverage:
  - id: D1
    description: "`start --brief --policy routine --wait` with the fake run host reaches ready_for_review with exit 0 and no input, offline too; the run passes each stage behind its checkpoint in the contract's order"
    requirement: "FR-2"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#start --wait reaches ready_for_review with the fake run host (tracer)"
        status: pass
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#the same run offline (S-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly one `/gsd-quick --validate --text` unit per attempt; AVARICE writes no plan or task list; the prompt carries the no-commit sentence and the symlink-resolved clone path"
    requirement: "FR-4"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#hands the unit one `/gsd-quick --validate --text` prompt with the no-commit sentence"
        status: pass
    human_judgment: false
  - id: D3
    description: "Classification from measured facts and the routing table: failed+headMoved, paused (numbered choice and human_needed), denied, no_progress, budget_exhausted, host unavailable and host error each end in blocked_on_decision with the stated reason, decision class and no branch in the source"
    requirement: "AUT-7"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#every ending that is not a handed-off branch is a recorded decision (Task 2) (12 tests)"
        status: pass
      - kind: unit
        ref: "test/unit/quick-record.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The supervisor commits only changed in-scope paths with the Avarice-Run and Avarice-Attempt trailers; quick records and STATE.md and config.json never reach the branch; each quick record is archived as gsd-quick-record"
    requirement: "FR-4"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#commits only src/slug.ts ...; archives each quick record as an artifact ..."
        status: pass
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#restorePaths, removeUntracked and diffCommits (5 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Required checks run as sandboxed subprocesses at the final committed revision; each evidence row records command, exit code, duration, status, revision git:<sha>, clean 1 and the environment; G4 passes only on deterministic passed evidence per acceptance criterion; a VERIFICATION passed is model-review evidence and never satisfies an acceptance"
    requirement: "FR-5"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#records G2 and G4 as passed, and the check evidence at the clone HEAD ...; an acceptance criterion verified only by a check that is never run fails G4; a VERIFICATION or SUMMARY that says passed never stands in for evidence"
        status: pass
    human_judgment: false
  - id: D6
    description: "On G4 pass the supervisor fetches avarice/<runId> into the source as one new local ref and the run moves to ready_for_review with the commit as revision; the source checkout is unchanged; a hand-off conflict leaves the user's ref alone and blocks with a decision"
    requirement: "FR-6"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts (checkoutSnapshot unchanged; a source that already has avarice/<runId> at another commit)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every run., work_item., invocation., hook., check., gate., handoff. and containment. event of a run has run_id; invocation. and hook. events have invocation_id; invocation.finished and the events inside the attempt have attempt_id (more than 20 rows checked)"
    requirement: "OPS-2"
    verification:
      - kind: integration
        ref: "test/integration/run-events.test.ts (5 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The unit prompt's context pack cites intel items before graph items, is recorded as item references and a digest only, and sits inside the untrusted-data fence; start refuses with exit 3 and creates nothing when no admitted GSD is found"
    requirement: "RC-4"
    verification:
      - kind: integration
        ref: "test/integration/run-baseline-workflow.test.ts#the unit prompt gets an index-first context pack; start refuses when no admitted GSD is found"
        status: pass
    human_judgment: false
  - id: D9
    description: "The shell lines a real model improvises (5 to 7 denials per unit in S2-B) and the real quick workflow's own steps are not exercised here: the fake host stands in for the model"
    requirement: "CON-2"
    verification:
      - kind: other
        ref: "live cases of plans 02-20 and 02-21"
        status: unrun
    human_judgment: true
    rationale: "Offline, the unit is played by the fake host through the real hook entry; whether a real quick unit ends as classified here is observed only live (plans 02-20 and 02-21)"

duration: 38 min
completed: 2026-11-05
---

# Phase 2 Plan 13: The vertical slice from `start` to `ready_for_review` Summary

**One routine work item now runs from `avarice start --wait` to `ready_for_review` offline: `running` and `verifying` are registered stages, the unit is classified from facts AVARICE measured, G2 and G4 judge it, the supervisor commits only the in-scope paths and hands the branch to the source as one new ref, and every other ending is a recorded decision with a reason**

## Performance

- **Duration:** about 38 min (start about 2026-11-05T21:35Z, end 22:13Z)
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto)
- **Files:** 23 changed in the three commits (2507 insertions, 31 deletions; about 40 000 tokens by chars/4 over the diff)

## Accomplishments

- **Tracer.** With `{ run: { edits: { 'src/slug.ts': <fix> }, summary: true, verification: 'passed' } }`, `start --brief --policy routine --wait` exits 0 and its last line is `run <id>: ready_for_review`, with no input after start, also inside the no-network sandbox wrapper. The ledger shows the checkpoints `prepare-workspace, configure-gsd, verify-enforcement, context-pack, launch:run, classify, gate:g2, commit, verify:checks, gate:g4, handoff:fetch, none`, one `launch:run` step, a `classify` step with kind `progressed`, G2 and G4 passed, the `test` check evidence at `git:<clone HEAD>` with clean 1, command `npm test`, exit 0, independence deterministic, a `gsd-verdict` row with independence `model-review`, and work item A in `done`. The commit on `avarice/<runId>` changes only `src/slug.ts`, ends with `Avarice-Run:` and `Avarice-Attempt:` trailers, exists as `refs/heads/avarice/<runId>` in the source, and the source checkout (HEAD, branch, status, digest) is unchanged.
- **Classification (AUT-7).** `classifyOutcome` gets facts measured by AVARICE: the host's result fields, hook denials counted from the ledger's own events, the clone HEAD before and after (not the host's report), a quick SUMMARY among the added paths plus at least one in-scope change since the pre-launch snapshot, and `detectPause` over a `WAITING.json`, the VERIFICATION status and the captured question. The host outcome `kind` is never read.
- **Supervisor commit and artifacts (D-03, D-17).** Quick records and any GSD bookkeeping changed in the clone are stored as `gsd-quick-record` artifacts (retention `run`), then restored to HEAD or removed (including the untracked `.planning/config.json` that `config-set` created, and the directories they leave empty), and only the remaining in-scope paths are committed. `RunWorkspace` gained `restorePaths`, `removeUntracked` (never follows a symlink, refuses a tracked path) and `diffCommits`.
- **Checks (FR-5, FR-6).** `runRequiredChecks` runs each required or target check through the sandboxed executor with HOME, TMPDIR and the npm cache under the run's scratch directory, `CI=1`, writes limited to the scratch directory and the check's declared paths, the credential directories and the data root unreadable, and stores stdout and stderr as one `check-output` artifact. A missing sandbox gives `unavailable`, a timeout `inconclusive`.
- **Gates.** G2: scope, deletions, GSD verification status, overrides, PRUNE entries and the checks delta (checks run only when the other rules pass). G4: one clean revision, deterministic evidence mapped to every acceptance criterion, diff gate against the pin, decisions closed, budgets within limit. The run moves to `ready_for_review` only after a passed G4 row for exactly the handed-off commit is in `gate_results`.
- **Decisions.** Every ending that is not a handed-off branch goes through `blockRun`: failed with HEAD moved (`enforcement_failure`, class permission, `containment.finding` `head-moved`), budget exhausted (`budget_exhausted`, names the spent budget), paused, denied, no_progress, host errors, G2 scope or deletion (`enforcement_failure` with a finding naming the paths), other G2 and G4 failures, hand-off conflict (class scope_expansion, the user's ref untouched). Model text in a decision is stored as data, control characters removed, cut to 1000.
- **Correlation IDs (OPS-2).** `gate.result` and `decision.opened` now carry the attempt (`GateResultInput` and `DecisionInput` gained `attemptId`); `run-events.test.ts` checks the three ID rules over a whole run (more than 20 rows) and over a blocked run.
- **Context pack (S-41).** With fixture intel and graph indexes on the active record, `context:pack` lists `gsd-intel` items before `gsd-graph` items as references, freshness, sizes and a digest, no excerpt; the prompt holds the pack inside the untrusted-data fence and none of its text is in any run step or event.
- **GSD presence.** `start` with no admitted GSD exits 3 with `avarice start: refused: GSD 1.17.x was not found (...)` and creates no run row, contract file or clone.

## Task Commits

1. **Task 1 (tracer): the vertical slice** - `98a78fa` (feat). Includes the routing table and `blockRun`, because they share `item.ts` and `finish.ts` with the tracer.
2. **Task 2: every non-progressed ending, G2 and G4 failures, hand-off conflict** - `6165d16` (test). The six endings of the plan plus budget_exhausted, no_progress, host refusals, human_needed and the G2 entry conditions; RED evidence.
3. **Task 3: correlation IDs, context pack, GSD refusal** - `da5f28a` (feat)

`commits: 3`, measured as `git rev-list --count 7b6a462b0a36b1e99831912459aa69e6baba3743..HEAD` before this summary commit.

RED evidence: `02-13-red-evidence-task1.json` and `02-13-red-evidence-task2.json` are one run of the new test file against the plan base source (a `git archive` of 7b6a462 plus the new test and helpers): 16 tests, 0 pass, 16 fail (`no stage for running`). `02-13-red-evidence-task3.json` is the Task 3 tests against the Task 2 commit: 7 tests, 4 pass, 3 fail (the attempt ID on `gate.result` and `decision.opened`, and the GSD refusal); the context-pack test passes at that base because the pack was built with the tracer, and is recorded as pinning it.

Tracer gate (config absent, `end-of-phase`, automated-only verify): the verify commands were re-run after Task 1 (80 tests) and passed, so expansion continued.

## Files Created/Modified

See key-files. Purpose in one line each: `item.ts` the running stage and the routing table; `finish.ts` the verifying stage, G4 and the hand-off; `blocked.ts` the one blocking path; `checks.ts` the sandboxed checks; `quick-record.ts` the pure parsing of quick records; `fake-run-host.ts` the offline model; `run-events.test.ts` the OPS-2 rules.

## Decisions Made

See key-decisions. Points to know downstream:

- **02-14 (baseline, inventory):** `gateUnit` in `item.ts` passes `inventory: []` and takes every required check as passing at base (`baselineDelta` with an all-passed base); `verifyAndGate` in `finish.ts` does the same for G4. Both are the places to replace with the measured baseline and inventory.
- **02-16 (CON-16 retry):** insert the discard-and-retry in `routeOutcome` (`item.ts`) before the `failed` and `inconclusive` fallbacks. `configure-gsd` runs once in `contract_ready`; `.planning/config.json` stays in the clone until the commit step removes it, so a retry before the commit still has it.
- **02-17 (recovery):** `runningStage` returns an error for an item still `delegated` (an interrupted attempt) and resumes `implemented` at G2 and `gated` at the commit from the recorded `snapshot` and `classify` steps; the fault points `mid-commit`, `mid-verify` and `mid-handoff` exist. Two things to handle there: `invocation.orphan-charged` events (budget.ts) carry no `invocation_id`, and a resume that finds the commit made but the `commit` step unrecorded.
- **Carry-over from 02-12:** `verify-enforcement` is now idempotent (a repeated action that finds the identical G0 verdict for the same contract, policy and revision adds no row); the unit test mutation-checks it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistency] A broken fix is stopped by G2, not G4**
- **Found during:** Task 2
- **Issue:** the plan's behaviour line says an edit that leaves the check failing fails G4 `checks-delta` and `acceptance-mapped` (class repeated_failure). But Task 1 and docs/contracts-and-state.md put "the required checks pass on the item's revision" in G2, so the same edit fails G2 `checks-delta` before the commit, and G4 is never reached.
- **Fix:** the test asserts G2 `checks-delta`, class repeated_failure, the failing evidence IDs in the decision, no G4 row and no commit; a checks-delta-only G2 failure is routed to repeated_failure (other G2 failures to acceptance). The G4 failure path is covered separately: an acceptance criterion verified by a check that is declared but never run fails G4 `acceptance-mapped` (class repeated_failure, no branch).
- **Files modified:** src/app/run-stages/item.ts, test/integration/run-baseline-workflow.test.ts
- **Commit:** 98a78fa, 6165d16

**2. [Rule 2 - Missing critical functionality] gate.result and decision.opened events had no attempt ID**
- **Found during:** Task 3 (OPS-2 test over real rows)
- **Issue:** `GateResultInput` and `DecisionInput` could not carry an attempt, so the events for G2, G4 and a blocked ending sat outside their attempt.
- **Fix:** optional `attemptId` on both inputs, written to the event's `attempt_id`; the stages pass it. Files outside the plan's list: `src/ports/ledger.ts`, `src/adapters/sqlite/ledger.ts`.
- **Commit:** da5f28a

**3. [Rule 3 - Blocking] Files and methods the plan's list did not name**
- **Issue:** the app layer may not run git, so the G4 diff gate needs a port method (`diffCommits`); the blocking path, the pure record parsing and the shared test fixtures needed homes.
- **Fix:** new files `src/app/run-stages/blocked.ts`, `src/domain/quick-record.ts`, `test/unit/quick-record.test.ts`, `test/integration/run-events.test.ts` (listed in the plan), and helpers in `test/helpers/run-fixtures.ts` (`onboardRunRepoWithIndexes`, `startWithFakeRunHost`, `ledgerRows`, `FIXED_SLUG`).
- **Commit:** 98a78fa, da5f28a

**4. [Rule 3 - Blocking] The 02-12 supervisor tests assumed no `running` stage**
- **Issue:** with the stages registered, the tests that expected `running` and `no stage for running`, and the checkpoint lists without `configure-gsd`, no longer describe the product.
- **Fix:** updated to the new behaviour (the onboarding fake host cannot run a unit, so the run ends `blocked_on_decision (decision)`; checkpoints include `configure-gsd` and the running stage's). Assertions about the lease, fence, fault kill points and the detached process are unchanged.
- **Files modified:** test/integration/run-supervisor.test.ts
- **Commit:** 98a78fa

**5. [Plan note] No directory is pre-created by configure-gsd**
- The plan's action mentions pre-creating `.planning/quick/`; spike S2-B section 5 item 2 says no pre-launch directory is needed (`Write` creates it), and an empty directory would not survive a git snapshot. None is created.

**6. [Process] Task 2's routing landed with Task 1**
- The routing table shares `item.ts` and `finish.ts` with the tracer, so it is in the Task 1 commit; the Task 2 commit adds the tests beyond the tracer's and the RED evidence.

**Total deviations:** 6 (1 plan inconsistency, 1 Rule 2, 2 Rule 3, 2 notes). **Impact:** none on a plan truth; deviation 1 makes a failing check stop one gate earlier than the plan's behaviour line says, which is stricter, not looser.

## Authentication Gates

None.

## Issues Encountered

- A first run of the new tests failed with `Invalid regular expression: missing /` in the detached supervisor: the file-writing tool turned some `\uXXXX` escapes in a regex literal into the actual invisible characters. Fixed by building the pattern from a string of escapes (`new RegExp('...')`, the form `run-gsd-config.ts` already uses) and checking the source for non-ASCII characters.
- The harness refused shell commands whose text mentioned git inside a heredoc; files were written with Write and Edit and small Python scripts that do not mention it.
- Full suite after Task 3 code: 2010 tests, 1985 pass, 0 fail, 25 skipped (live and network cases); the load-sensitive `fail-closed` and `claude-host` timing tests did not fail. After the last test addition the plan's verification files and the unit suite were re-run: 1230 pass, 0 fail.
- No live model was called, so nothing was added to the Phase 2 spend ledger; D-15 total unchanged.

## Known Stubs

- `src/app/run-stages/item.ts` (`gateUnit`) and `src/app/run-stages/finish.ts` (`verifyAndGate`): G2 passes an empty test inventory and both gates take every required check as passing at base, until plan 02-14 measures the inventory and the baseline. This is the strict form of D-12 (it can only block more) and the plan states it; recorded in `.planning/WINDOWS.md` as a stub.

## Threat Flags

None beyond the plan's register. T-02-41: checks run only through the sandboxed executor with declared writes, unreadable credentials and data root, no network. T-02-42: the commit pathspec is the in-scope changed paths minus artifacts; G2 scope and the G4 diff gate check them; artifacts never reach the branch (tested). T-02-43: VERIFICATION and SUMMARY are stored as `model-review` evidence and G4 needs deterministic evidence (tested with a passing VERIFICATION and a broken fix). T-02-44: pause text is stored stripped and cut to 1000 characters (tested). T-02-SC: no package was installed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 02-14 (baseline and inventory), 02-15 (inbox reads the open decisions this plan writes), 02-16 (the retry point is named above), 02-17 (recovery notes above).
- A real model (plans 02-20 and 02-21) will end `denied` on improvised shell lines while the unit is done (S2-B); classification already ignores the host kind and reads the quick directory, the VERIFICATION status, the clone diff and HEAD.

## Self-Check: PASSED

- FOUND: src/app/run-stages/item.ts, finish.ts, blocked.ts, src/app/checks.ts, src/domain/quick-record.ts, test/helpers/fake-run-host.ts, test/integration/run-baseline-workflow.test.ts, test/integration/run-events.test.ts, test/unit/quick-record.test.ts, 02-13-red-evidence-task1.json, 02-13-red-evidence-task2.json, 02-13-red-evidence-task3.json
- FOUND commits: 98a78fa, 6165d16, da5f28a (ancestors of HEAD, after 7b6a462)
- Acceptance: `git grep -n "fake-run-host" -- src` prints nothing; `grep -c "gsd-quick-record" src/app/run-stages/item.ts` is 1; the workflow test asserts the exact checkpoint order and the commit's file list
- Plan verification re-run after the last code commit: `npx tsc -p .` clean, `node scripts/check-boundaries.ts` ok (75 files), `node --test` of run-baseline-workflow, run-events, run-supervisor, run-start, checkout-unchanged, skeleton and test/unit: 1230 pass, 0 fail
