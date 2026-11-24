---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 56
subsystem: approvals
tags: [approvals, hook, attended-mode, privileged-commands, gap-closure, G-04-1, GCR-01]

requires:
  - phase: 04
    provides: "plan 04-54 (attended approval binding), the approval domain, the attended and run hooks, authorizeAction"
provides:
  - "unshowableReason(params) in the approval domain, with MAX_VALUE_CHARS (80), MAX_SUMMARY_CHARS (400) and MAX_CWD_CHARS (512) exported"
  - "attended refusal of an unshowable privileged command as privileged:unapprovable before any request or consumption"
  - "run-mode refusal: privileged:<action> rule, one policy.denied, no approval.requested"
  - "approval gate refusal: privileged:unapprovable, no request; a matching contract authorization still allows"
affects: [04-57, 04-62, 04-63, 04-66, 04-67]

actuals:
  tokens: 13000
  tasks: 2
  commits: 3
plan_head_before: d532ac7b5af651f668f46da4ce3c557cfeab44ba
plan_head_after: f06df42dfbe0239855b5199f5b32343df0ccc55d

tech-stack:
  added: []
  patterns:
    - "shown whole or refused: a request is written only for parameters the owner can read whole; otherwise the command is refused with the one existing unapprovable rule"
    - "the attended cwd is shown whole under its own cap, outside the value and summary caps"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-56-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-56-red-task2.json
  modified:
    - src/domain/approval.ts
    - src/hook/pre-tool-use.ts
    - src/app/authorize.ts
    - test/unit/approval.test.ts
    - test/integration/hook-privileged.test.ts
    - test/integration/approvals.test.ts
    - docs/system/policy-and-approvals.md

key-decisions:
  - "GCR-01 is closed by refusing a command whose bound values cannot be shown whole as privileged:unapprovable, not by printing full values (no new rule ID, event type or output shape)"
  - "The attended cwd is shown whole under MAX_CWD_CHARS = 512 and counts against neither the 80-character value cap nor the 400-character summary cap, so ordinary approvals from long directories still work"
  - "In a run the rule name stays privileged:<action>; the reason says no approval was asked because a bound value cannot be shown whole"
  - "The gate (authorizeAction) refuses after the contract and consume attempts and before the pending-request lookup, so a contract or an existing approval still allows"

patterns-established:
  - "unshowableReason names a key and a length or a cause, never a value, and ends with the clause that the owner can run the command at their own terminal"

requirements-completed: [FR-12, FR-13, SEC-6]

coverage:
  - id: D1
    description: "An attended push whose bound value cannot be shown whole (the GCR-01 padded -c line) is denied as privileged:unapprovable before any approval is consumed; no approval.requested, one policy.denied with no command text"
    requirement: "FR-12"
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#refuses the line of GCR-01, whose padded -c value hides a redirecting option, as privileged:unapprovable before any request or approval"
        status: pass
    human_judgment: false
  - id: D2
    description: "An approvable command records a request whose paramsSummary holds every value whole (cwd included, no ellipsis), and avarice approve prints it unchanged; display edges 80/81, 400/401, 512/513, control characters, secrets and no-canonical-form values"
    requirement: "FR-12"
    verification:
      - kind: unit
        ref: "test/unit/approval.test.ts#unshowableReason: the parameters an owner cannot be shown whole are refused (G-04-1, GCR-01, FR-12)"
        status: pass
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#a -c option of exactly 80 characters is approvable, and `avarice approve` prints the whole option on its params line"
        status: pass
    human_judgment: false
  - id: D3
    description: "An ordinary approval is not refused: from a directory whose canonical path is past 80 characters a push is requested with the whole path, approved, then allowed once"
    requirement: "FR-13"
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#from a directory whose canonical path is past 80 characters a push is requested with the whole path, approved, and then allowed once"
        status: pass
    human_judgment: false
  - id: D4
    description: "In a run an unshowable privileged command is denied with privileged:<action>, one policy.denied and no approval.requested; authorizeAction returns privileged:unapprovable with no request, and still allows with a matching contract authorization"
    requirement: "SEC-6"
    verification:
      - kind: integration
        ref: "test/integration/hook-privileged.test.ts#in a run, a privileged command whose bound value cannot be shown whole is denied with no request (G-04-1, GCR-01)"
        status: pass
      - kind: integration
        ref: "test/integration/approvals.test.ts#parameters that cannot be shown whole get no approval request: deny with privileged:unapprovable, and a contract that authorizes them exactly still allows (G-04-1, GCR-01)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every unit test and every integration, fault and mutation test file that names approvals, privileged commands or the attended hook passes against this plan's code"
    requirement: "FR-12"
    verification:
      - kind: other
        ref: "npm run test:unit (3051 tests, 3051 pass, 0 fail, 0 cancelled) and node --test over the 17 grep-selected files (403 tests, 403 pass, 0 fail, 0 cancelled)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-11-24
status: complete
---

# Phase 04 Plan 56: Show every bound value whole or refuse the approval Summary

**`avarice approve` can no longer be shown less than the digest binds: an attended, run or gate approval request holds every bound key and value whole (the working directory under its own 512-character cap), and any command whose values cannot be shown whole is refused as `privileged:unapprovable` before a request exists.**

## Performance

- **Duration:** about 55 min
- **Started:** 2026-11-24T20:00:00Z (approximate)
- **Completed:** 2026-11-24T20:55:32Z
- **Tasks:** 2
- **Files modified:** 7 (plus 2 RED records)

## Accomplishments

- `unshowableReason(params)` returns the reason a parameter set cannot be shown whole, or `undefined`. Conditions: a key or non-cwd value over 80 characters; a cwd over 512; the non-cwd entries over 400 joined; a control character in a key or value (cwd included); a value with no canonical form; the secret patterns matching the joined entries (cwd included). The reason names the key and length or cause, never the value, and ends with "; the owner can run the command at their own terminal".
- `paramsSummary` clips the cwd at 512 and allows the whole summary the length of the cwd entry plus a space on top of 400, so for any parameters `unshowableReason` accepts, the summary is never cut (the longest is 400 + ' cwd=' + 512 = 917 characters, under the event store's 1,024 string limit). With no cwd key it clips exactly as before.
- The attended hook builds each command's bound parameters (cwd included) first, marks a command unapprovable when it already was or when `unshowableReason` returns a reason, and denies the line with `privileged:unapprovable` before the store is opened for consumption.
- In a run, an unshowable privileged command keeps the `privileged:<action>` rule, writes one `policy.denied` (rule, action, scope, run and invocation IDs, tool, digest, reason, source hook; no summary, target or request) and no `approval.requested`.
- `authorizeAction` denies with `privileged:unapprovable` and appends nothing when the parameters cannot be shown whole, after the contract and consume attempts, so a contract authorizing the exact parameters still allows.
- The hook test that encoded the ellipsis display was replaced by the refusal test and a whole-value request test, as G-04-1 requires.

## Task Commits

1. **Task 1: Tracer, attended refusal of an unshowable push** - `0c1dee0` (fix); RED record `04-56-red-task1.json` showed the padded push recorded as a `privileged:git.push` request
2. **Task 2: Display edges, run hook, approval gate** - `e113216` (fix); RED record `04-56-red-task2.json` showed the run-mode and gate cases failing
3. **Documentation of the changed behavior** - `f06df42` (docs), see Deviations

Tracer feedback gate: the tracer's verify (`node --test test/integration/hook-privileged.test.ts && npm run typecheck`) was re-run after the code was written and passed (70 tests, 0 fail; no TS errors): "Tracer verified end-to-end, expanding".

**Plan metadata:** recorded in the docs commit that follows this file.

## Verification (TAP summary lines)

| Run | tests | pass | fail | cancelled |
|-----|-------|------|------|-----------|
| `npm run test:unit` (Node 26.9.0) | 3051 | 3051 | 0 | 0 |
| `node --test` over the 17 files the grep selected under test/integration, test/fault and test/mutation | 403 | 403 | 0 | 0 |
| Task 2 first verify (approval unit, hook-privileged, approvals, privileged-no-replay, untrusted-authority) | 150 | 150 | 0 | 0 |

`npm run typecheck` clean; `npm run check:boundaries`: ok (132 files). `git diff --quiet ed9e123..HEAD -- src/cli/commands/approve.ts src/domain/privileged-commands.ts` exits 0.

## Decisions Made

See `key-decisions` above. All follow the plan's `flagged_assumptions`; no new decision was taken.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical / CLAUDE.md] Updated docs/system/policy-and-approvals.md in the same change**
- **Found during:** Task 2 (header comments and documentation surfaces)
- **Issue:** CLAUDE.md requires a behavior change to update the matching `docs/system/` document in the same change. `policy-and-approvals.md` stated that the summary cuts each value at 80 characters and the whole at 400 with an ellipsis, and that the request summary "may be shortened"; all three are now false. The plan lists no `docs/system/` file and leaves the write-up to plan 04-67.
- **Fix:** Rewrote the four stale passages (Parameters and digest, the attended refusal item, the run paragraph, the display sentence) to describe the unshowable conditions, the cwd limit, the attended, run and gate refusals. Prose follows the technical-writing rules (no file paths, function names or delivery history). The document is NOT marked reviewed in `coverage.md`; plan 04-67 still owns the fresh `prose-reviewer` pass and the other surfaces below.
- **Files modified:** docs/system/policy-and-approvals.md
- **Committed in:** f06df42

**2. [Plan arithmetic] A unit-test fixture was one character short**
- **Found during:** Task 2 RED run
- **Issue:** the 100-character cwd fixture was 99 characters (test bug, not code).
- **Fix:** corrected before the RED record was written; the record shows only the three genuine RED failures (gate, and two run-mode cases).

---

**Total deviations:** 1 auto-fixed (Rule 2 / CLAUDE.md), 1 test-fixture correction
**Impact on plan:** none on scope; the docs edit keeps `docs/system/` true to the code until 04-67 reviews it.

## Issues Encountered

None. The `sed -i` and heredoc forms were refused by the environment's worktree guard, so test and source edits used the Edit tool.

## Documentation surfaces (for plan 04-67)

- **Request summary is never cut.** A request shows every bound key and value whole; no ellipsis. `docs/system/policy-and-approvals.md` is updated (not yet reviewed).
- **Unshowable conditions and caps.** Key or non-cwd value over 80; non-cwd entries over 400 joined; cwd over 512 (shown whole under its own limit, outside the 80 and 400 caps; stored summary at most 917 characters); control character in a key or value; value with no canonical form; secret patterns matching the joined entries, cwd included.
- **Attended refusal.** `privileged:unapprovable`, before any approval is consumed or request written; one `policy.denied` per command with no command text; the reason names the key and length or cause and says the owner can run the command at their own terminal.
- **Run mode.** The rule stays `privileged:<action>`; one `policy.denied` (no `requestId`, no summary), no `approval.requested`; the denial says no approval was asked because a bound value cannot be shown whole.
- **The gate.** `authorizeAction` denies with `privileged:unapprovable` and writes no request; a contract authorization for exactly the parameters, or an approval already on record, still allows.
- **Other `docs/system/` passages that still describe `privileged:unapprovable` as only the `gh api` file-body case and need the new case added:** `containment.md` (rows at the privileged-commands table, the hook-rules paragraph and the events list), `data-model.md` (`policy.denied` row), `processes.md` (the attended flow step 3) and `diagrams/approve-privileged-action.puml`. The hook-rule count in `coverage.md` is unchanged (no new rule ID).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or storage surface; the change narrows what an approval request can carry.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-57 (classifier change) can proceed; it depends on this plan. The classifier plans that follow run the privileged-command tests in their own checks and plan 04-66 runs the whole suite.

## Self-Check: PASSED

- FOUND: src/domain/approval.ts, src/hook/pre-tool-use.ts, src/app/authorize.ts, test/unit/approval.test.ts, test/integration/hook-privileged.test.ts, test/integration/approvals.test.ts, docs/system/policy-and-approvals.md, both RED records
- FOUND commits: 0c1dee0, e113216, f06df42 (all on the branch, ahead of plan_head_before d532ac7)
- All acceptance criteria re-run and passing (greps for `unshowableReason`, `export function unshowableReason`, `MAX_CWD_CHARS`; 512/513 and 80/81, 400/401 cases; real-push parameter case; long-directory approve-then-allow case; approve.ts and privileged-commands.ts unchanged since ed9e123)

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-24*
