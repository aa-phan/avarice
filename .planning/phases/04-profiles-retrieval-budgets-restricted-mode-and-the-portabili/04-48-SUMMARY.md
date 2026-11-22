---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 48
subsystem: security
tags: [attended-hook, approvals, savepoint, privileged-commands, cr-04, t-04-130]
requires:
  - phase: 04-40
    provides: classifyLine returning every privileged command of a line in scan order
provides:
  - "consumeLine: the attended hook takes one usable approval per privileged command of a line, all or none, under a SQLite savepoint"
  - "a request and a policy.denied event for each command left without an approval"
  - "privilegedLineReason: one denial naming every missing request in line order"
affects: [04-51, 04-53]
actuals:
  tokens: 5200
  tasks: 2
  commits: 3
plan_head_before: 64b8cb2601c6a373815906b1b95cd052c100f370
plan_head_after: fb44006802cfd674ef4bd1e312d9cf92a1c1925c
tech-stack:
  added: []
  patterns:
    - "an owner decision authorizes one action: consume per command inside a savepoint and roll the whole line back unless every command has an approval"
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-48-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-48-red-task2.json
  modified:
    - src/hook/pre-tool-use.ts
    - src/domain/privileged-commands.ts
    - test/integration/hook-privileged.test.ts
key-decisions:
  - "Consumption runs over every command of the line without stopping at the first miss, so the commands that lack an approval are exactly those whose consume returned null; no separate counting query is needed, and a repeated command counts twice because each consume takes the next oldest approval"
  - "A run is untouched: it never consumes an approval and its denial still names the first privileged command of the line"
requirements-completed: [FR-12, FR-13]
coverage:
  - id: D1
    description: "In an attended session `true; git push origin main && npm publish` is denied with one request for git.push and one for release.publish named in line order and one policy.denied each; one approval of the push does not let the line run and stays unconsumed"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#tracer: in an attended session every privileged command of a line needs its own approval (CR-04, FR-12, FR-13, T-04-130)"
        status: pass
    human_judgment: false
  - id: D2
    description: "After both requests are approved the line is allowed once: both approvals are consumed and two action.started events name them; a further submission is denied with fresh requests"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#after the owner approves both, the line is allowed once: both approvals are consumed and two action.started events name them"
        status: pass
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#a fourth submission is denied again with fresh requests"
        status: pass
    human_judgment: false
  - id: D3
    description: "A line naming one command twice needs two approvals (with one nothing is consumed), and with several usable approvals the oldest is consumed"
    requirement: FR-13
    verification:
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#a line that names one command twice needs two approvals, and the oldest approval is spent first (CR-04, FR-13)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The requests of a line are listed and recorded in the order its commands run, and a run still denies a compound line with the rule of its first privileged command"
    requirement: FR-12
    verification:
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#the requests of a line are listed in the order its commands run (CR-04, SEC-6)"
        status: pass
      - kind: test
        ref: "test/integration/hook-privileged.test.ts#in a run a compound line is denied with the rule of its first privileged command, unchanged (CR-04)"
        status: pass
    human_judgment: false
duration: not captured
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 48: One approval authorizes one privileged action on a shell line Summary

**The attended hook now needs, and spends, one usable approval for each privileged command of a shell line, all or none under a SQLite savepoint, and asks for every missing one in a single denial (CR-04, FR-12, FR-13).**

## Performance

- **Duration:** not captured (no start time was recorded for this run)
- **Completed:** 2026-11-22
- **Tasks:** 2 (one tracer, one auto), each with a failing test first
- **Files:** 5 changed in the task commits (2 source files, 1 test file, 2 red records)

## Accomplishments

- **Tracer, CR-04.** `attendedPreToolUse` hands `classified.commands` to a new `consumeLine`. Inside the hook's BEGIN IMMEDIATE transaction it opens the savepoint `consume_line` and calls `consumeApprovalRow` for every command in line order, each taking the oldest usable approval of its scope, action and parameter digest and appending its `action.started`. If every command found an approval the savepoint is released and the hook prints nothing. Otherwise the savepoint is rolled back (no approval spent, no `action.started` kept) and released, and `recordPrivilegedDenial` runs for each command that found none: it names the request already waiting for that action and digest or mints a new `apr_` request, and appends `policy.denied`. The deny rule is `privileged:<action of the first unapproved command>` and the reason is `privilegedLineReason` over the unapproved commands: one `privilegedReason` clause each, in line order, joined by `; `.
- **Edges, task 2.** A line naming one command twice needs two approvals; with one, the line is denied, the approval stays unconsumed and a second request is named. With two usable approvals granted at different times, a single command takes the earlier. `echo $(gh pr create --base main) && git push origin main` records and names `scm.pr.create` before `git.push`. In a run, `true; git push origin main && npm publish` is still denied as `privileged:git.push` with one request; `decideShell` and the run path were not changed.

## TDD record

| Task | RED commit | RED evidence (`RED_EVIDENCE_OK`) | GREEN commit |
|---|---|---|---|
| 1 | `ebb66f0` | `04-48-red-task1.json`: with only the git.push request approved, the hook printed nothing for `true; git push origin main && npm publish`, so the line ran on one approval (`'allow' !== 'deny'` in the target test; the first test also failed on its request count) | `9778271` |
| 2 | `fb44006` | `04-48-red-task2.json`: planted de-duplication of repeated commands in `consumeLine` (working tree only, reverted); the repeated-command test failed with the line allowed on one approval | none needed |

Task 2 has no GREEN commit: the Task 1 implementation already counts a repeated command twice, the oldest-first order and the request order, so the new tests passed on first run against it. To keep the RED valid (an unexpected green is not RED) the evidence was taken from a planted defect, the mutation the repeated-command test exists to catch, applied in the working tree and reverted with `git checkout -- src/hook/pre-tool-use.ts` before the commit; the evidence's `semanticAssessment` says so. No REFACTOR commits.

## Verification

- `node --test test/integration/hook-privileged.test.ts test/integration/hook.test.ts test/integration/untrusted-authority.test.ts test/fault/approval-consume.test.ts`: 118 of 118 pass. `test/integration/untrusted-authority.test.ts` is unchanged.
- `node --test test/unit/privileged-commands.test.ts test/unit/hook-decision.test.ts test/mutation/fail-closed.test.ts`: 254 of 254 pass.
- `npm run typecheck` clean; `npm run check:boundaries` ok (132 files). The full `npm test` suite was not run (over an hour here), as instructed.
- `grep -c SAVEPOINT src/hook/pre-tool-use.ts` prints 1; `grep -c "export function privilegedLineReason" src/domain/privileged-commands.ts` prints 1.

## Deviations from Plan

### Auto-fixed Issues

None of Rules 1 to 3. Two departures in method, neither changing scope:

**1. [Method] Which commands lack an approval is read from the consume results, not by counting usable approvals**
- **Found during:** Task 1
- **Issue:** the plan says to count, per action and digest, the usable approvals against the commands that need them. Consuming for every command (without stopping at the first miss) yields the same set, because each consume takes the next oldest usable approval, so a repeated command is counted twice by construction.
- **Fix:** `consumeLine` collects the commands whose consume returned null, then rolls back; no counting query exists.
- **Files modified:** `src/hook/pre-tool-use.ts`
- **Commit:** `9778271`

**2. [Method] Task 2 RED taken from a planted defect, and no GREEN commit**
- **Found during:** Task 2
- **Issue:** the behaviour already held, so the repeated-command test was an unexpected green.
- **Fix:** see the TDD record above.
- **Commit:** `fb44006`

**Total deviations:** 0 rule deviations, 2 method notes. **Impact:** none on the contract.

## Documentation surfaces (for plan 04-53)

- **Per-command approvals.** In an attended session every privileged command of a Bash line consumes one usable approval of scope `attended:<session>`, its action and its parameter digest, taken oldest first (`granted_at`, then rowid). The line runs only if every command has one; the approvals are consumed together in one transaction (a savepoint rolls back a partial consumption) and one `action.started` event per command names its approval. A command that appears twice on a line needs two approvals. A run never consumes an approval (unchanged).
- **Multi-request denial text.** `avarice: privileged:<action of the first unapproved command>: <clause>; <clause>...`, each clause `<action> needs an approval for these parameters; the owner approves it at a terminal with: avarice approve <requestId>`. Only commands without an approval are named; commands that already hold one are not, and an approval that was granted but not yet used is left unconsumed until every command of the line has one.
- **Request order and events.** Requests are made in the scan order of `classifyLine` (a substitution's commands before the command that holds it, otherwise left to right) and the denial lists them in that order. One `approval.requested` is minted for a command only when no request for its scope, action and digest is still waiting; one `policy.denied` is recorded per unapproved command, so a three-command line with two missing records two.
- **Run mode unchanged.** A run denies a compound line with the rule of its first privileged command and names one request.
- **Known limits.** A line that names the same command twice and has no approval for either names the one waiting request twice; the owner approves it once, the next denial names a new request for the second command. Approvals still do not bind the inputs that change a command's effect (plan 04-51).
- **Commits to cite (plan 04-52).** `9778271` (CR-04).

## Known Stubs

None.

## Threat Flags

None. T-04-130 is mitigated as planned; no new endpoint, auth path or schema.

## Issues Encountered

None. The pin script `root-pin.sh` could not run in the sandbox (compound command refused); the same check was done by hand with `git rev-parse --show-toplevel` before the first edit and each commit, and printed the pinned root every time.

## Self-Check: PASSED

- `src/hook/pre-tool-use.ts`, `src/domain/privileged-commands.ts`, `test/integration/hook-privileged.test.ts`, `04-48-red-task1.json` and `04-48-red-task2.json` exist.
- Commits `ebb66f0`, `9778271` and `fb44006` are ancestors of HEAD; the plan has 3 commits measured from the ledger.
