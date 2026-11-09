---
phase: 03-decisions-independent-work-and-amendments
plan: 12
subsystem: database
status: complete
tags: [sqlite, ledger, amendment, notifications, cancel, append-only]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: migration 0003 (notifications table, runs.cancel_requested_*), answerDecision, applyItemTransition (plan 03-02)
provides:
  - amendRunContract, one lease-free transaction that writes contract version n+1, raises budget limits, appends stale evidence and gate rows and resolves a non-pause decision
  - createNotification, recordNotificationAttempt, setNotificationState and listNotifications over the notifications table, with notify.delivered and notify.failed events
  - requestRunCancel and RunRow.cancelRequestedAt, the cancel request the supervisor reads
  - the ntf_ ID prefix and isRunTerminal in the run lifecycle
affects: [03-14, 03-15, 03-16, 03-21, 03-23, 03-24, the documentation plan 03-31]

actuals:
  tokens: 16000
  tasks: 3
  commits: 6
plan_head_before: 42f847b670c476446f4733b721d6f5d7fbcc7dfc
plan_head_after: 5bebaca5bbc5a834ea5253f439823bbae9a4c3bc
commits: 6

tech-stack:
  added: []
  patterns:
    - "An amendment is one tx(): lockRun, version and terminal-state checks, then contract, budget UPDATEs, stale rows, event, decision resolution; any refusal rolls all of it back"
    - "Invalidation only appends: a stale evidence copy or gate row under the new contract version; the insert-only triggers are untouched"
    - "releaseItems is the single place that releases a decision's items; answerDecision and amendRunContract both call it"
    - "insertContractRow writes the contract row alone; insertContract adds budgets and contract.stored, amendRunContract adds the diff and contract.amended"

key-files:
  created:
    - test/integration/amend-ledger.test.ts
    - test/integration/notification-ledger.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-12-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-12-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-12-red-evidence-task3.json
  modified:
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/domain/ids.ts
    - src/domain/run-lifecycle.ts

key-decisions:
  - "amendRunContract takes no lease fence: it checks expectVersion against the run's latest contract version inside the transaction and refuses a run in failed, cancelled or closed, so it works beside a supervisor running another item"
  - "The one statement that changes budgets.limit_value is in amendRunContract; used and reserved are never written by an amendment and nothing is refunded (D-19, RC-5)"
  - "A stale gate row copies the work item and revision of the gate's latest row; a gate that never ran, an evidence ID that is not an evidence row of the run, and a repeated ID or gate are refused as invalid"
  - "resolvesDecisionId accepts repeated_failure, permission, budget and scope_expansion only; the decision is answered amended:v<n+1> by the authorizer on channel terminal, with the same decision.answered event and item release as answerDecision"
  - "Notification moves: pending to held, delivered or failed; held to delivered or failed; delivered and failed are final. A failed attempt with a next time keeps the row's state"
  - "requestRunCancel returns { requestedAt, requestedBy, repeated } and writes run.cancel_requested { runId, requestedBy } once; version, state and lease are not touched"

requirements-completed: [RC-6, AUT-6, AUT-12]

coverage:
  - id: D1
    description: "amendRunContract writes contract version n+1 with its diff and reason, raises the named budget limits and their contract_version while used and reserved carry over, appends one contract.amended event, and needs no lease"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/amend-ledger.test.ts#amendRunContract (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Stale evidence copies and stale-after-amendment gate rows are appended under the new version, originals and insert-only triggers unchanged; a non-pause decision is answered amended:v<n+1> with its items released; pause-class, answered, unknown decisions, a cancelled run and a moved version refuse the whole amendment"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/amend-ledger.test.ts#amendRunContract: stale evidence and gate rows, #the decision it resolves, #the run states"
        status: pass
    human_judgment: false
  - id: D3
    description: "Notification rows follow the delivery state machine with attempts counted and events carrying IDs, the attempt and a short code only"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/notification-ledger.test.ts#createNotification and listNotifications, #recordNotificationAttempt, #setNotificationState"
        status: pass
    human_judgment: false
  - id: D4
    description: "requestRunCancel records the first request once on the run row, appends run.cancel_requested, returns the first request for a repeat, and refuses a terminal run"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/notification-ledger.test.ts#requestRunCancel"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 12: Amendments, notification delivery state and cancel request in the ledger Summary

**`amendRunContract` writes a whole amendment (contract version n+1, raised limits, stale evidence and gate rows, a resolved decision) in one lease-free, version-checked transaction, and the ledger gains notification delivery state and a once-only run cancel request.**

## Performance

- **Duration:** about 70 min (finished 2026-11-09T03:37Z; the start time was not captured, so this comes from the plan-head ledger file's mtime), including one 9-minute full suite run
- **Tasks:** 3 of 3
- **Commits:** 6 task commits (3 RED, 3 GREEN), plus the metadata commit
- **Files:** 5 created (2 test files, 3 RED records), 4 modified

## Accomplishments

- `amendRunContract` runs under the run lock with no lease fence. It refuses a moved `expectVersion` and a run in failed, cancelled or closed with `conflict`, writes contract version n+1 with `diff_json`, reason, authorizer and policy revision, and updates each named budget row's `limit_value` and `contract_version` (each UPDATE must change one row, else `invalid`). `used` and `reserved` are never written.
- Stale evidence: each named evidence row of the run gets an appended copy (same attempt, item, kind, name, revision, clean and tree digest; status `stale`, the new contract version and policy revision, environment `{ invalidatedBy: 'amendment', supersedes: <id> }`). Stale gates: each named gate gets a failed `stale-after-amendment` row with the work item and revision of its latest row. Nothing is updated; the insert-only triggers still fire (tested).
- `resolvesDecisionId`: an open `repeated_failure`, `permission`, `budget` or `scope_expansion` decision is answered `amended:v<n+1>` (answerer the authorizer, channel `terminal`) and its items released through the new shared `releaseItems`, which `answerDecision` now also calls. Any other class, an answered decision (`conflict`) or an unknown one (`not_found`) refuses the whole amendment; a test checks no version 2, stale row, limit change or event remains.
- `contract.amended` event data: `{ runId, version, budgets, staleEvidence, staleGates, resolvedDecisionId? }`.
- The budget comment on the `Ledger` port now states D-19: only `amendRunContract` changes a limit, it is called only by the amend command from a terminal outside the run, so the run cannot raise its own limits (RC-5).
- Notifications: `createNotification` (state `pending` or `held`, `runId` null for a digest, `ntf_` ID), `recordNotificationAttempt` (attempts + 1; delivered sets `delivered_at`; failed with a next time keeps the state, without one makes it `failed`; error codes are `[a-z0-9-]{1,64}`), `setNotificationState` (all named rows move along allowed edges or none), `listNotifications` (oldest first, filter by states and run).
- `requestRunCancel` records `cancel_requested_at` and `_by` once and appends `run.cancel_requested`; a repeat returns the first request with `repeated: true` and no event; a terminal run is `conflict`. `RunRow.cancelRequestedAt` is read by `toRun`.

## TDD gate

RED task 1: 5 tests in `test/integration/amend-ledger.test.ts` against a `not implemented` stub; 4 failed on assertions (the fifth, an unknown budget row, passes on the stub only because it also returns `invalid`). `RED_EVIDENCE_OK` for `03-12-red-evidence-task1.json`. GREEN `d16fad6`; the tracer gate (task 1 verify re-run) passed before task 2 started. RED task 2: 16 tests, 8 failed (task 1 implementation ignored stale rows and decision resolution), 8 passed; `RED_EVIDENCE_OK`. GREEN `fea10af`. RED task 3: 19 tests, 18 failed against five stubs (the ID prefix test passed because `ntf_` came with the types); `RED_EVIDENCE_OK`. GREEN `5bebaca`.

## Task Commits

1. **Task 1: tracer, amendRunContract without a lease** - `189ca07` (test, RED), `d16fad6` (feat, GREEN)
2. **Task 2: stale rows, decision resolution, guards** - `ed1c861` (test, RED), `fea10af` (feat, GREEN)
3. **Task 3: notification state and cancel request** - `d25038d` (test, RED), `5bebaca` (feat, GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `isRunTerminal` added to `src/domain/run-lifecycle.ts`**
- **Found during:** Task 1
- **Issue:** the amend and cancel guards need "failed, cancelled or closed", and `TERMINAL` is private to the lifecycle file, which is not in the plan's file list.
- **Fix:** exported a four-line `isRunTerminal(state)` beside the constant rather than copying the list into the adapter.
- **Files modified:** src/domain/run-lifecycle.ts
- **Commit:** d16fad6

### Plan wording and judgment calls

**2. `releaseItems(runId, decision, channel, nowMs)`** takes the channel as well as the decision (the plan wrote `(runId, decision, nowMs)`), because it also appends `decision.answered`, whose data names the channel.

**3. Task 3 scaffolding in the RED commit.** The port types, the `ntf_` prefix, `toRun` reading `cancel_requested_at` and the not-implemented stubs are in `d25038d` so the test file compiles; the behavior arrives in `5bebaca`. The same was done for the `amendRunContract` signature in `189ca07`.

**4. `setNotificationState` allowed moves.** The plan's truth statement allows `pending -> delivered | failed | held` and `held -> delivered | failed`; its task 3 behavior line lists only `pending -> held` and `held -> delivered or failed`. The implementation follows the truth statement (the wider set), and a test covers pending to delivered and failed directly. No move out of `delivered` or `failed` is allowed.

**5. `requestRunCancel` return type** is `CancelRequest { requestedAt, requestedBy, repeated }` (the plan did not fix it); the event is `run.cancel_requested { runId, requestedBy }`.

**6. `setNotificationState` appends no event.** The plan names `notify.delivered` and `notify.failed` only for attempts; a state set (a hold, or a digest marking rows delivered) is visible in `notifications.state` and `updated_at` only.

**Total deviations:** 1 Rule 3, 5 plan-wording or judgment calls. **Impact:** none on scope.

## Issues Encountered

- Full `npm test` (3035 tests): 2979 pass, 55 skipped, 1 failed: `test/integration/run-supervisor.test.ts` "SIGKILL to `start --wait` leaves the supervisor alive and the run still reaches its stop state". It is a process-timing test under a loaded full run; it passes alone (15 of 15). It does not touch the files this plan changed.
- **For plan 03-23:** its digest step moves "pending, held and failed" rows to delivered with `setNotificationState`. A `failed` row cannot move to `delivered` (the state machine ends at `failed`), so that call returns `invalid`. 03-23 either leaves `failed` rows out of the move or the machine needs a `failed -> delivered` edge, which is an owner decision.

## Documentation surfaces (for plan 03-31)

`docs/system/` was not edited in this plan; the documentation plan writes these from the code:

- **Port methods:** `amendRunContract` (input: `expectVersion`, `next { body, digest, policyRevision, diff, reason, authorizedBy }`, `budgetChanges`, `staleEvidenceIds`, `staleGates`, `resolvesDecisionId`; result: contract, staleEvidence, staleGates, resolved), `createNotification`, `recordNotificationAttempt`, `setNotificationState`, `listNotifications`, `requestRunCancel`; types `NotificationRow`, `NotificationState`, `NewNotification`, `NotificationAttemptInput`, `CancelRequest`, `AmendRunContractInput`, `AmendRunContractResult`; `RunRow.cancelRequestedAt`.
- **Events:** `contract.amended { runId, version, budgets, staleEvidence, staleGates, resolvedDecisionId? }`, `notify.delivered { notificationId, runId, attempt }`, `notify.failed { notificationId, runId, attempt, code }`, `run.cancel_requested { runId, requestedBy }`; an amendment that resolves a decision also appends `decision.answered` and the `work_item.transition` events of the items it releases.
- **States:** notification `pending`, `held`, `delivered`, `failed` and the allowed moves above; retry keeps the state while `next_attempt_at` is set.
- **The changed invariant:** budget limits no longer "never rise": only `amendRunContract` changes `limit_value` (D-19), called only by the amend command outside the run. Contract versions, evidence rows and gate rows are append-only; an amendment invalidates by inserting rows with status `stale` (evidence, environment names the amendment and the row superseded) or a failed `stale-after-amendment` gate row.
- **IDs:** the `ntf_` prefix. **Stored columns:** `contracts.diff_json` is now written (by amendments), `contracts.reason` holds the amendment reason.
- **Findings to revisit:** any `docs/system/` line saying a budget limit can never be raised, or that `storeRunContract` is the only contract writer, needs the amendment path. `storeRunContract` still has no production caller.

## Known Stubs

None. The RED stubs (`not implemented`) were replaced before each GREEN commit.

## Threat Flags

None. No new network endpoint, auth path or file access. T-03-19 (a limit raised by anything but an amendment): the only `UPDATE budgets SET limit_value` is in `amendRunContract`; the amend command's refusal inside the run is plan 03-15. T-03-20 (rewritten evidence, gate rows or contract versions): only inserts; the contracts primary key `(run_id, version)` and the insert-only triggers are tested. T-03-21 (racing amendments): `expectVersion` is checked inside the transaction under the run lock (tested: a second amendment of the same version is `conflict`). T-03-SC: no package installs.

## Next Phase Readiness

Plan 03-15 (the amend command) can call `amendRunContract` with the diff it computed; 03-16 and 03-23 can deliver through `recordNotificationAttempt` and read `listNotifications` (see the `failed -> delivered` note); 03-21 can read `RunRow.cancelRequestedAt` and `listNotifications`; 03-24 can call `requestRunCancel` and read the request from the run row.

## Self-Check: PASSED

Created files exist (both test files, three RED records, this summary); commits 189ca07, d16fad6, ed1c861, fea10af, d25038d, 5bebaca are on the branch; `tsc -p .` and `check-boundaries` clean; the four plan verify files pass 101 of 101; `grep "raises a limit (RC-5)" src/ports/ledger.ts` prints nothing; `grep "'ntf_'" src/domain/ids.ts` prints one line; the full suite has one load-sensitive failure that passes alone.
