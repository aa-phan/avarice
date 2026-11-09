---
phase: 03-decisions-independent-work-and-amendments
plan: 21
subsystem: status-and-inbox
status: complete
tags: [status, inbox, read-model, renderer, json-shapes, work-items, decisions, notifications]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the multi-item run with item-local blocks, decisions with options and successors, cancel requests and banner rows in the ledger (03-12 to 03-18), the S-17 fixture (03-18)"
provides:
  - "status shows, offline and from ledger rows only, each work item of a run (state, size, model, dependencies, attempts), each decision of the run (class, state, affected items, supersedes, successor), a pending cancel request and the delivery state of the run's notifications (AUT-12)"
  - "inbox lists every open decision with its items, options, the command that answers it and the state of its banner; a failed banner is printed next to the decision and never hides or closes it (AUT-4, SC2)"
  - "the frozen-prefix check: the four Phase 2 status snapshots are kept as a never-regenerated baseline and every current snapshot must carry them as the first keys of each object"
affects: [03-22, 03-31]

actuals:
  tokens: 12100
  tasks: 2
  commits: 4
plan_head_before: 7d330a7bda4f024f08dbb56fc4da000852fc3f44
plan_head_after: a0c697742c01de340f39786377a4bff577d3b038
commits: 4

tech-stack:
  added: []
  patterns:
    - "Appended optional keys: a read model gains keys only after the existing ones, and the renderer reads the new keys as optional so a view built by hand still renders"
    - "Frozen baseline: a copy of the previous phase's snapshot that is never regenerated, compared as a key-order-and-value prefix of the current one"
    - "One value, one line: every free-text value of an item, decision or option line goes through stripControl, is flattened to one line and cut to 40 characters; the issue and option labels keep the terminal-width cut"

key-files:
  created:
    - test/fixtures/json-shapes/phase2-baseline/status-runs.json
    - test/fixtures/json-shapes/phase2-baseline/status-active.json
    - test/fixtures/json-shapes/phase2-baseline/status-interrupted.json
    - test/fixtures/json-shapes/phase2-baseline/status-empty.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-21-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-21-red-evidence-task2.json
  modified:
    - src/app/run-status.ts
    - src/cli/render/run-view.ts
    - test/integration/run-status.test.ts
    - test/unit/render.test.ts
    - test/unit/json-shapes.test.ts
    - test/fixtures/json-shapes/status-runs.json

key-decisions:
  - "items, decisions and notifications are typed optional on RunStatus (the plan calls them optional keys) so a RunStatus built by hand, as test/unit/shell.test.ts does, still type-checks; the read model always fills all three, and cancelRequestedAt only when a request stands"
  - "A decision belongs to the item that is first among its affected items, so `item B ... decision <id>` is printed on B only and D, which the decision also holds up, shows no decision of its own"
  - "The command of an amend-only decision (every option is withdraw) is its stored amend command, falling back to `avarice decide <id> withdraw`; every other decision gets `avarice decide <id> <option-key>`"
  - "When one decision has several banner rows (several destinations) the inbox shows the worst: failed outranks held, pending and delivered, so one destination's success never covers another's failure"
  - "The run's `notifications.lastError` is the code of the latest row that is not delivered, so a banner that failed once and then arrived does not leave a stale error in the count"
  - "The frozen-prefix baseline is a new directory of copies (phase2-baseline/) rather than `git show HEAD:` in the test, so the check keeps working after this plan's own commits and survives a regeneration of the files above it"

patterns-established:
  - "Inbox decision detail lines: `items:`, one `option <key>: <label>` per option, `answer with: <command>`, then the banner line"

requirements-completed: []

coverage:
  - id: D1
    description: "S-17 blocked run: status --json ends each run entry with items (A done, B blocked_on_decision, C done, D ready, with size, model, dependsOn and attempts), decisions (the open acceptance decision with affected items B and D) and notifications (one delivered); the human status prints one line per item, one per decision and the notification counts"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#the S-17 blocked run in status and inbox: items, the decision with its options and command, the banner (tracer; AUT-12, AUT-4, SC2)"
        status: pass
      - kind: unit
        ref: "test/unit/render.test.ts#prints one line per item, with the decision an item waits on, and one per decision with its successor (AUT-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "inbox --json and the human inbox list each open decision with its items, options, answering command and banner state; a decision whose banner failed is still listed with `banner not delivered (osascript-failed); this list is the record`"
    requirement: "AUT-4"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#a decision whose banner failed is still listed, with the error code and the line that says the list is the record"
        status: pass
      - kind: unit
        ref: "test/unit/render.test.ts#prints the items, each option, the command and the state of the banner under the issue (AUT-4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A stale decision shows state stale and its successor, the successor shows what it replaces and is the only one in the inbox; a withdrawn decision shows state withdrawn and is not in the inbox; a cancel request shows cancelRequestedAt (last key) and `cancel requested`"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#a stale decision names its successor, a withdrawn one leaves the inbox, and a cancel request is shown (AUT-12)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every Phase 2 key of the four status snapshots keeps its name, order and value, and anything new comes after it; status-runs.json was regenerated and only appended keys"
    verification:
      - kind: unit
        ref: "test/unit/json-shapes.test.ts#the Phase 2 status snapshots are a frozen prefix of the current ones (plan 03-21)"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts#status --json with a run adds one `runs` key and nothing else (D-19, plan 02-15)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Escape sequences, line breaks and over-long values in an item ID, size, model, dependency, option key or label reach neither the terminal nor the line structure (T-03-41)"
    verification:
      - kind: unit
        ref: "test/unit/render.test.ts#strips escape sequences and line breaks from every value of an item or decision line (T-03-41)"
        status: pass
      - kind: unit
        ref: "test/unit/render.test.ts#strips control characters from an option label and cuts a long one to the width (T-03-41)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-09
---

# Phase 3 Plan 21: Items, decisions and banner state in status and inbox Summary

**`status` and `inbox` now show every Phase 3 state offline, read from ledger rows only: each item with its size, model, dependencies and attempts, each decision with its successor, a pending cancel request, the banner counts, and per open decision its options, the command that answers it and whether its banner arrived, all as keys appended after the Phase 2 ones.**

## Performance

- **Duration:** 40 min (most of it the full suite run)
- **Started:** 2026-11-09T08:57:00Z
- **Completed:** 2026-11-09T09:37:00Z
- **Tasks:** 2
- **Files modified:** 12 (6 created, 6 modified)

## Accomplishments

- `RunStatus` gains `items`, `decisions`, `notifications` and, only while a request stands, `cancelRequestedAt`, appended after every Phase 2 key (after `interrupted` when present). `InboxDecision` gains `items`, `options`, `command` and, when a banner row exists, `notification`. The module still calls read methods only: no lease, no write, no model.
- The human views print the new state: one `item` line and one `decision` line per entry, `cancel requested (...)`, `notifications: ...`; and under each inbox issue the `items`, one `option` line each, the `answer with` command and the banner line. A failed banner prints `banner not delivered (<code>); this list is the record` and the decision stays listed.
- The frozen-shapes rule is now a test: the four Phase 2 status snapshots are kept under `phase2-baseline/` and every current snapshot must carry them as a prefix (same names, order and values, arrays of the same length). `status-runs.json` was regenerated only after that check was written, and its diff only appends keys.

## Task Commits

1. **Task 1: Tracer - the S-17 blocked run in status and inbox** - `39be98f` (test, RED), `35f2a48` (feat)
2. **Task 2: Frozen JSON prefix, stale and withdrawn decisions, cancel request, and the Phase 2 snapshots** - `b89203c` (test, RED), `a0c6977` (feat, the regenerated snapshot)

**Plan metadata:** the docs commit that follows this file.

## Files Created/Modified

- `src/app/run-status.ts` - `RunItemView`, `RunDecisionView`, `RunNotificationView`, `InboxNotification`; the item, decision and notification read; the inbox options, answering command and banner state
- `src/cli/render/run-view.ts` - item, decision, cancel and notification lines in `renderRunDetails`; items, options, command and banner line in `renderInbox`
- `test/integration/run-status.test.ts` - the S-17 tracer (JSON and human, delivered and failed banner), the stale, withdrawn and cancel cases; the two Phase 2 key lists extended
- `test/unit/render.test.ts` - renderer cases for items, decisions, notifications, cancel, banner states and stripping
- `test/unit/json-shapes.test.ts` - `assertFrozenPrefix`, its own accept and refuse cases, and the four-snapshot prefix check
- `test/fixtures/json-shapes/status-runs.json` - regenerated, appended keys only
- `test/fixtures/json-shapes/phase2-baseline/*.json` - the four Phase 2 snapshots, never regenerated

## Decisions Made

See `key-decisions` above. The two that shape later plans: the new `RunStatus` keys are optional in the type, and the inbox shows the worst banner state when a decision has more than one banner row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The typecheck failed on a RunStatus built by hand**
- **Found during:** Task 1
- **Issue:** with `items`, `decisions` and `notifications` required, `test/unit/shell.test.ts` (not in the plan's file list) no longer type-checked.
- **Fix:** typed the three keys optional, as the plan's wording ("optional keys") allows, and made the renderer read them with a default. The read model still always fills them.
- **Files modified:** `src/app/run-status.ts`, `src/cli/render/run-view.ts`
- **Verification:** `npx tsc -p .` clean; shell, render and status tests green
- **Commit:** `35f2a48`

### Plan Interpretation Notes

- **The failing-banner case is set up through the ledger, not through a failing fake osascript.** A real delivery retries at 0, 10 and 60 seconds in the supervisor process, so a failing `osascript` end to end takes over a minute and the delay cannot be shortened from a test. The test opens a decision and records a failed delivery (`osascript-failed`) with the same ledger methods the notification service calls; the retry and failure path itself is covered by `test/integration/run-notify.test.ts`.
- **The Task 2 stale, withdrawn and cancel cases passed on first run.** Task 1's read model already covers them, so the RED evidence of Task 2 names the stale `status-runs` snapshot (and the new check that the snapshot carries the appended keys) as its failing target, not those cases.
- **A new directory `phase2-baseline/` holds the pre-change snapshots.** The plan allowed a constant in the test or a `git show`; copies on disk keep the check independent of git state.
- **Documentation surfaces are listed below for plan 03-31, as the plan asks.** `docs/system/` exists in this checkout; its `cli-reference.md` and `runs.md` still describe the Phase 2 output and are updated by the phase's documentation plan.

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** none on scope; the three keys are optional in the type only.

## Documentation surfaces (for plan 03-31)

JSON keys added (all appended after the existing keys of their object):

- `status --json`, each entry of `runs[]`: `items[]` (`itemId`, `state`, `size`, `model`, `dependsOn[]`, `attempts`), `decisions[]` (`decisionId`, `class`, `state`, `affectedItems[]`, `supersedes`, `successor`), `notifications` (`delivered`, `pending`, `held`, `failed`, `lastError`), and `cancelRequestedAt` only while a cancel request stands. They come after `interrupted` when that key is present.
- `inbox --json`, each entry of `decisions[]`: `items[]`, `options[]` (`key`, `label`, `kind`), `command`, and `notification` (`state`, `attempts`, and `lastError` only for a banner that is not delivered) only when a banner row names the decision.

Printed lines added:

- `status`, under each run, in this order: `cancel requested (<time>)` after the interrupted lines; `item <id>  <state>  [decision <id>  ]size <size>, model <model>, after <ids|none>, <n> attempt(s)`; `decision <id>  <class>  <state>  items <ids>  [replaced by <id>]  [replaces <id>]` after the `decisions: N open` line; `notifications: <n> delivered, <n> pending, <n> held, <n> failed (<code>)`.
- `inbox`, under each `issue <id>: ...` line: `  items: <ids>`, `  option <key>: <label>` per option, `  answer with: <command>`, and one banner line: `banner delivered`, `banner held for the next digest`, `banner pending`, or `banner not delivered (<code>); this list is the record`.
- `docs/system/cli-reference.md` lines 277 and 337 (the `status` detail lines and the `inbox` human output) and the `status`/`inbox` JSON key lists are the places that change; `docs/system/coverage.md` counts do not change in this plan.

## Issues Encountered

- The full suite (`node --test`, 3301 tests) ended with 3238 passing and 3 failing; none touches this plan. Two tests of `claude-host.test.ts` (the wall-clock kill and the retry) failed under the load of the full run and pass when that file is run alone; `run-start.test.ts` failed only in its `after` hook (`ENOTEMPTY` removing a temp directory a detached process still held) and its 26 tests pass when run alone.

## Known Stubs

None.

## Threat Flags

None. The only new printed text is ledger rows and model text, and every value passes `stripControl` (T-03-41); no new endpoint, write path or file access.

## Self-Check: PASSED

- Created and modified files exist (checked below).
- Commits `39be98f`, `35f2a48`, `b89203c`, `a0c6977` are ancestors of HEAD.
- `node --test "test/unit/json-shapes.test.ts" "test/unit/render.test.ts" "test/integration/run-status.test.ts"` green (111 tests), `npx tsc -p .` clean, `node scripts/check-boundaries.ts` ok, `grep -n "appendEvent\|transition\|answerDecision" src/app/run-status.ts` prints nothing.
