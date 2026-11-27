---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 16
subsystem: security
tags: [approvals, authorization, privileged-actions, no-replay, fr-12, fr-13, fr-15, adr-005, typescript]
status: complete

requires:
  - phase: 04-05
    provides: "classifyAction and evaluatePolicy (the gate asks them; it carries no rules of its own)"
  - phase: 04-08
    provides: "deps.policy(repo?) and the 0004 approvals guards (no DELETE; consumed_at and revoked_at change once from NULL)"
  - phase: 04-13
    provides: "the composed AppDeps and profile ownership the command checks"
provides:
  - "paramsDigest, approvalKey, isUsable, APPROVAL_TTL_MS, paramsSummary, scopeRunId: the pure approval rules (src/domain/approval.ts)"
  - "Ledger grantApproval, revokeApproval, consumeApprovalAndStart, listApprovals, findApprovalRequest, findPendingApprovalRequest, listActionEvents (src/ports/ledger.ts, src/adapters/sqlite/ledger.ts)"
  - "authorizeAction, finishPrivilegedAction, reconcilePrivilegedSteps: the one gate a privileged action passes (src/app/authorize.ts)"
  - "avarice approve <apr id> and avarice approve --revoke <approval id> (src/cli/commands/approve.ts)"
  - "Resume never replays a privileged action: it opens a permission decision and blocks the run (src/app/run-resume.ts)"
affects: [04-19, 04-21, 04-37, 04-38]

actuals:
  tokens: 39000
  tasks: 3
  commits: 5
plan_head_before: 1d06e9b5f5941ad794d93556ead024c1fb895810
plan_head_after: 1053fcc55aa03f05dd143fd9afe30e2f5c21ad6f
commits: 5

tech-stack:
  added: []
  patterns:
    - "An approval is consumed in the BEGIN IMMEDIATE transaction that appends the action.started event, so a started action has spent exactly one approval and a spent approval has a start"
    - "A request is an event (approval.requested), never a row: the approvals table holds only granted approvals, which its NOT NULL granted_by column requires"
    - "The approval row's idempotency key counts earlier approvals of the same scope, action and digest inside the granting transaction, so a fresh approval after expiry inserts"
    - "An interrupted start is marked by an action.interrupted event written after its decision is opened; a repeated resume finds the decision by its evidence reference and repeats nothing"

key-files:
  created:
    - src/domain/approval.ts
    - src/app/authorize.ts
    - src/cli/commands/approve.ts
    - test/unit/approval.test.ts
    - test/integration/approvals.test.ts
    - test/fault/approval-consume.test.ts
    - test/fault/privileged-no-replay.test.ts
    - test/helpers/approval-consume-child.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-16-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-16-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-16-red-task3.json
  modified:
    - src/domain/ids.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/app/run-resume.ts
    - src/cli/main.ts

key-decisions:
  - "authorizeAction orders its sources: a policy deny ends it (a contract never overrides a deny); an allow lets a read or local-write action through with no record and a privileged one through with action.started recorded (source policy); require-approval accepts a contract that names the same action and the same canonical parameter digest (source contract), else consumes an approval (source approval), else denies with approval-required:<apr id>"
  - "A denied retry of the same scope, action and digest names the request that is still waiting instead of recording a new one, and a request is granted once: a second `avarice approve` of it exits 3"
  - "A privileged action whose start has no end is found by FIFO pairing per action name; resume opens one withdraw-only permission decision per such start, in start order, and blocks the run with the enforcement_failure reason before any other reconcile step"
  - "The approval idempotency ordinal is computed inside the granting transaction in the ledger, not in authorize.ts from listApprovals, so two grants cannot read the same count"

patterns-established:
  - "Scope is the approvals.run_id value: a run ID, an onboarding ID or attended:<session id>; events of an attended scope carry no run ID"
  - "Skeleton-first RED: the planned exports exist with no behavior, so the tracer test fails on its assertion and not on a missing import"

requirements-completed: [FR-12, FR-13, FR-15]

coverage:
  - id: D1
    description: "A privileged action without an approval is denied with approval-required:<apr id>, the message names `avarice approve <apr id>`, and an approval.requested event records the scope, action and parameter digest"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/approvals.test.ts#tracer: a privileged action is denied with an approve hint, the owner approves it, and the retry consumes the approval in its start transaction (FR-12, S-7)"
        status: pass
    human_judgment: false
  - id: D2
    description: "`avarice approve <apr id>` runs only at a terminal outside a run, shows the action and a redacted parameter summary, and on yes inserts one approval expiring 30 minutes later; --revoke sets revoked_at; without a terminal it exits 64 and writes nothing"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/approvals.test.ts#tracer; #an approval is bound to its scope, action, parameters and window (T-04-41, FR-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An approval is bound to scope, action and canonical parameter digest, expires exactly at its expiry instant, is single use, and one approval is consumed by exactly one of two racing processes (25 rounds)"
    requirement: FR-12
    verification:
      - kind: unit
        ref: "test/unit/approval.test.ts#isUsable: the expiry boundary (FR-12)"
        status: pass
      - kind: integration
        ref: "test/integration/approvals.test.ts#single use (FR-15 adjacency edge)"
        status: pass
      - kind: fault
        ref: "test/fault/approval-consume.test.ts#two processes consume one approval: exactly one gets it (T-04-42)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A contract authorizes exactly the action and parameters it names and writes no approvals row; a policy deny is never overridden by a contract"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/approvals.test.ts#a contract is a source of its own, for exactly the parameters it names (FR-12, D-15)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A privileged action with a recorded start and no end is never replayed by resume: one permission decision names it, several open in start order, the run is blocked_on_decision, and a run with none resumes as before"
    requirement: FR-15
    verification:
      - kind: fault
        ref: "test/fault/privileged-no-replay.test.ts#an interrupted privileged action is never replayed: resume opens a permission decision that names it (FR-15, T-04-44)"
        status: pass
      - kind: fault
        ref: "test/fault/privileged-no-replay.test.ts#a run with no interrupted privileged action resumes exactly as before (FR-15 empty edge)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No decide answer, contract amendment, resume or plan approval writes an approvals row"
    requirement: FR-13
    verification:
      - kind: fault
        ref: "test/fault/privileged-no-replay.test.ts#no decision answer, contract amendment or plan approval writes an approvals row (FR-13)"
        status: pass
    human_judgment: false

duration: 85 min
completed: 2026-11-17
---

# Phase 4 Plan 16: Parameter-bound approvals and no replay Summary

**Privileged actions pass one gate, `authorizeAction`: a policy deny ends it, otherwise a contract naming the exact parameters or one single-use 30-minute approval (consumed in the transaction that records the action's start) lets it start, and `avarice approve` is the only writer of an approval.**

## Accomplishments

- Pure approval rules: the canonical parameter digest (key order irrelevant, any changed value changes it), the idempotency key with its ordinal, the expiry boundary (expired at the instant, valid one millisecond before) and a bounded one-line parameter summary.
- Ledger methods that grant, revoke and consume approvals, each in one BEGIN IMMEDIATE transaction; a consume writes `consumed_at` and the `action.started` event together. Two real processes raced for 25 approvals: one winner every round, one start event per approval.
- `authorizeAction` with the contract source and the policy evaluator; a denied action records one `approval.requested` event and names `avarice approve <apr id>`. A retry names the same pending request.
- `avarice approve <apr id>` (terminal only, outside a run, owner's profile only) and `--revoke <approval id>`.
- `reconcilePrivilegedSteps` and the resume hook: a start with no end opens a withdraw-only permission decision and blocks the run before anything else is reconciled.

## Task Commits

1. **Task 1: tracer, deny, approve, consume in the start transaction** — RED `95dbcdb` (4 of 4 failing, `RED_EVIDENCE_OK`), GREEN `29618f7`
2. **Task 2: binding rules, expiry boundary, revoke, contract source, consume race** — `aaab8f1` (tests; see deviation 1)
3. **Task 3: no replay after an interruption, no approval from a decision or a plan** — RED `2ac1953` (4 of 8 failing, `RED_EVIDENCE_OK`), GREEN `1053fcc`

Plan metadata (this summary, STATE, ROADMAP, REQUIREMENTS) is committed separately.

## TDD

- **Task 1 RED:** skeleton-first. The four tracer cases failed on `assert.ok(result.ok)` and on exit 70 where 0 or 64 was planned; typecheck clean, so no import or fixture fault.
- **Task 2 RED:** by mutation (deviation 1). Six deliberate mutations of the committed rules made 10 of 47 tests fail on their assertions; the sources were restored with `git checkout` of the three files and the 47 pass.
- **Task 3 RED:** a really killed run (`mid-verify` SIGKILL) with an unfinished `x.synthetic` start resumed to `ready_for_review` (exit 0) where the planned assertion is that the run waits; 4 of 8 failed. The empty-edge case and the decision-answer case pass in RED by design.
- No REFACTOR commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 2 tests could not be red against Task 1's GREEN**
- **Found during:** Task 2
- **Issue:** Task 1's action already required `isUsable`, the canonical digest, the consume match, `--revoke` and the contract comparison, so every Task 2 case passed on its first run (unexpected green). Task 2 has no implementation left to commit.
- **Fix:** Showed the tests discriminate by breaking six rules in the committed source (isUsable `>=`, a key-order-sensitive digest, a contract matched on the action alone, a consume that ignores scope and revocation, a consume outside a transaction, an UPDATE without the `consumed_at IS NULL` re-check). 10 of 47 failed on their assertions; recorded in `04-16-red-task2.json` and classified `RED_EVIDENCE_OK`. Sources restored before the commit. Task 2 therefore has one `test(04-16)` commit and no `feat` commit.
- **Files modified:** `.planning/phases/.../04-16-red-task2.json`, the three test files
- **Commit:** `aaab8f1`

**2. [Rule 3 - Blocking] A child-process helper for the race test**
- **Found during:** Task 2
- **Issue:** The race needs two real processes against one store; no existing helper did it.
- **Fix:** Added `test/helpers/approval-consume-child.ts` (outside the plan's file list). Both children wait for a shared start time per round.
- **Commit:** `aaab8f1`

**3. [Rule 2 - Missing critical] Ledger methods and an event the plan's list lacks**
- **Found during:** Tasks 1 and 3
- **Issue:** Reusing a request on a denied retry (so a retry loop does not flood the log) needs `findPendingApprovalRequest`; the no-replay rule needs `listActionEvents` and a marker for an interrupted start so a repeated resume opens nothing twice.
- **Fix:** Added `findPendingApprovalRequest`, `listActionEvents`, the `action.interrupted` event, `paramsSummary` and `scopeRunId`. The ordinal of the idempotency key is computed inside the granting transaction (ledger), not in `authorize.ts`, so two grants cannot read the same count.
- **Commit:** `29618f7`, `1053fcc`

**4. [Rule 2 - Missing critical] A request is granted once**
- **Found during:** Task 1
- **Issue:** Running `avarice approve <apr id>` twice would have inserted two approvals for one request, so one owner action could pay for two privileged actions.
- **Fix:** `grantApproval` refuses a request that already has an `approval.granted` event (conflict, exit 3).
- **Commit:** `29618f7`

**5. [Rule 3 - Blocking] A third RED record**
- **Found during:** Task 3
- **Issue:** The plan lists red records for Tasks 1 and 2; Task 3 is `tdd="true"` too.
- **Fix:** Recorded `04-16-red-task3.json`.
- **Commit:** `2ac1953`

**Total deviations:** 5 (3 Rule 3, 2 Rule 2). **Impact:** none on scope; the plan's behaviors are all delivered and tested.

## Decisions needing owner review

The plan left these open and I chose a policy; each is one line to change.

1. **Block reason after an interrupted privileged action.** The run stops `blocked_on_decision` with reason `enforcement_failure`, not `decision`. With `decision`, the supervisor treats a run with any ready item as continuable, so an item could run beside an open permission decision. The cost: the decision offers only `withdraw` (permission class), and a withdrawn decision does not release a run blocked for `enforcement_failure`, so the owner's way out is `avarice cancel`. If the owner wants a different exit (fail the run, or re-open after review), that is a new block reason and a change to the closed set in the run lifecycle and `docs/contracts-and-state.md`.
2. **A policy `approvalSource` other than `local-user` is not honored.** A `require-approval` rule that names another source is satisfied by the owner's `avarice approve` all the same; `evaluatePolicy` returns only the rule ID, so the gate cannot read it. Fail-closed handling needs the evaluator to return the rule's source.
3. **A policy allow of a privileged action records `action.started`** (source `policy`) so it falls under the no-replay rule; a read or local-write action that policy allows records nothing.
4. **Policy `when` matching stringifies numbers and booleans** (`5` matches a rule value `"5"`); other value types are not matched.
5. **Declining at the prompt exits 0** (`not approved`, nothing written), as `decide` does for an empty answer.
6. **Non-run scopes.** `reconcilePrivilegedSteps(deps, scope)` for an onboarding or attended scope marks interrupted starts (`action.interrupted`) and returns them but opens no decision, because the decisions table is keyed by run. Plan 04-21 must decide what an onboarding owner is asked.

## Documentation surfaces (for plans 04-37 and 04-38)

`docs/system/` was not edited here; the phase documentation plans own it.

- **Commands:** `avarice approve <apr id>` grants one approval; `avarice approve --revoke <approval id>` revokes. Exit codes: 0 granted, declined or revoked; 3 request already approved, or approval already revoked or consumed; 64 usage error, unknown request or approval, refused outside a terminal, inside a run (AVARICE_RUN), from a run's process tree, or for a profile the user does not own; 70 internal failure. The refusals happen before the profile resolves and create nothing.
- **ID prefixes:** `apr_` (an approval request, in the `approval.requested` event), `apv_` (an approval row). ULID after the prefix.
- **Events:** `approval.requested` (data `requestId`, `scope`, `action`, `paramsDigest`, `paramsSummary`, `ruleId`), `approval.granted` (`approvalId`, `requestId`, `scope`, `action`, `paramsDigest`, `grantedBy`, `expiresAt`), `approval.revoked` (`approvalId`, `scope`, `action`, `paramsDigest`), `action.started` (`scope`, `action`, `paramsDigest`, `paramsSummary`, `source` of `approval`, `policy` or `contract`, `approvalId` when approved, `itemId` when given), `action.finished` (`scope`, `action`, `status`), `action.interrupted` (`scope`, `action`, `startSeq`, `decisionId` for a run). Events of an attended scope carry no run ID; every other scope is in `run_id`.
- **Tables:** `approvals` now has a writer and readers. Columns as migration 0001; `run_id` holds the scope; `source` is `local-user`; `granted_by` is `owner:<os user>`; `expires_at` is `granted_at` plus 30 minutes. The 0004 guards apply (no DELETE; `consumed_at` and `revoked_at` change once).
- **Key derivation:** `idempotency_key` = SHA-256 hex of the canonical JSON of `[scope, action, paramsDigest, ordinal]`; the ordinal counts earlier approvals of the same scope, action and digest. `paramsDigest` = `sha256:` + SHA-256 hex of the canonical JSON of the parameters (sorted keys, no whitespace, undefined properties omitted).
- **Gate behavior:** order is policy deny, then (for an allow) the class rule, then for require-approval a contract authorization naming the same action and digest, then an approval consumed in the start transaction, then a denial with rule `approval-required:<apr id>` and the message `... avarice approve <apr id>`. A policy deny rule ID is returned as the rule. An approval is matched on scope, action and digest, oldest granted first, and is usable while not revoked, not consumed and expiring strictly after now.
- **Resume:** a privileged start without an end (FIFO pairing per action name) opens one permission decision per start in start order (issue names the action and its parameter summary; evidence reference `event:<seq>`; options `withdraw` only) and blocks the run `blocked_on_decision` with reason `enforcement_failure`; see decision 1.
- **Limits to record:** an approval is not tied to a user session, only to a scope and parameters; a request is granted once; `listActionEvents` and the request lookups read the event log by JSON field, so they scan the events of one scope only for run scopes.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-41 (reuse for other parameters or another run): matched on scope, action and digest; three tests. T-04-42 (consumed twice under a race): one BEGIN IMMEDIATE transaction, the `consumed_at IS NULL` re-check and the 0004 guard; 25-round two-process test. T-04-43 (approval from inside a run or a script): `refuseOutsideTerminal` before the profile resolves, plus the profile ownership check. T-04-44 (replay after a crash): `reconcilePrivilegedSteps` and the resume hook; kill test. No package was installed (T-04-SC).

## Verification

- `node --test test/unit/approval.test.ts test/integration/approvals.test.ts test/fault/approval-consume.test.ts test/fault/privileged-no-replay.test.ts`: 55 tests, 0 failures (the four approval files plus related resume and race suites: 147 of 147 across the nine files run after the last commit).
- `npm run typecheck`: clean. `npm run check:boundaries`: ok (115 files). `npm run test:unit`: 2667 of 2667.
- Related suites run: `run-resume`, `resume-reap`, `run-decision-resume`, `run-reconcile`, `decide-race`, `exit-parity`, `cli-terminal-text`, `skeleton`, `decision-ledger`, `ledger-status`: all pass. The full `npm test` is the orchestrator's.
- Acceptance: `04-16-red-task1.json`, `-task2.json` and `-task3.json` exist with exit code 1 and `RED_EVIDENCE_OK`; `grep -n "'approve'" src/cli/main.ts` prints the COMMANDS line; the race test runs 25 rounds and asserts exactly one consumer each; the FR-13 case asserts `SELECT COUNT(*) FROM approvals` is 0.

## Next Phase Readiness

Ready for 04-17. Plans 04-19 (the hook, scope `attended:<session id>`) and 04-21 (promotion with the onboarding contract as source, `reconcilePrivilegedSteps(deps, onboardingId)`) call the interfaces above.

## Self-Check: PASSED

- Files: all created files above exist on disk.
- Commits: `95dbcdb`, `29618f7`, `aaab8f1`, `2ac1953`, `1053fcc` are ancestors of HEAD.
