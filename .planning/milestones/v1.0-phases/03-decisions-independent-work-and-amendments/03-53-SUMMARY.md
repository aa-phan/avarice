---
phase: 03-decisions-independent-work-and-amendments
plan: 53
subsystem: exit-tools-attempt-bookkeeping
tags: [exit, attempts, classification, epoch, stop-loss, d-26, d-27, d-29, d-33]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-52 fresh-approval authorization (order, briefs[].run, briefs[].expects), the gate inside authorize, flags().bools
provides:
  - "attemptFor: the role, attempt number and expectation of a start, read from the authorization by the brief digest"
  - "classify --propose / --confirm and withClassification: Claude's D-26 classification and the owner's D-27 ruling, each written into one entry"
  - "startRefusal and epochOf: the D-26 re-run rule, the D-33 order, the D-29 stop-loss (exit 75) and the already-passed refusal, called by authorize"
affects: [03-54, 03-55, 03-56, 03-57, 03-58, 03-59]

actuals:
  tokens: 36000
  tasks: 2
  commits: 4
plan_head_before: c701e201b0ea498e9756c0e253b474a1c823438e
plan_head_after: 1e7bd53bbf6f813ce2dc9cb4bee2e0e014055799

tech-stack:
  added: []
  patterns:
    - "An exit run is identified by its role and attempt number; the brief digest is a detail of one attempt"
    - "A product-defect confirmation starts an epoch; the order and the pass count are judged over entries started after it, the stop-loss over all of them"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-53-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-53-red-task2.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "Role is the identity: attemptFor counts the earlier entries of the role whatever their digest, so a redrafted brief continues the run's count and its stop-loss"
  - "A failed attempt is an entry that did not pass and carries a finish, a start-stage stop judged not planned (stopOk false) or a classification; an attempt still waiting for the owner's answer is neither passed nor failed and never counts toward D-29"
  - "A confirmed product defect on any entry sets the epoch to its confirmation time. An entry started before it (including the confirmed entry itself) satisfies neither the order nor the already-passed rule, so after a product defect all three runs pass again, run2 first. A product-defect confirmation therefore releases a re-run of its own run but does not release the run after it in the order"
  - "classify refuses a proposal or confirmation on an entry the owner already ruled on: the ruling stands"
  - "An entry that records no startedAt and no atPause time is treated as older than any epoch"

requirements-completed: [AUT-1, AUT-3, AUT-12]

duration: about 40min
completed: 2026-11-10
status: complete

coverage:
  - id: D1
    description: "The start stage records run, attempt and expects from the authorization by the brief digest; a brief the authorization does not name is refused with exit 2 and nothing is recorded"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: the identity of an attempt is its run and its number (plan 03-53)"
        status: pass
    human_judgment: false
  - id: D2
    description: "classify --propose records Claude's classification with class, file:line, stopping gate and docs/system conformance with a reference under docs/system/; classify --confirm --by owner records the owner's ruling and any override; every refusal leaves the file byte-identical"
    requirement: AUT-12
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: classify records Claude's proposal and the owner's ruling in one entry (plan 03-53; D-26, D-27)"
        status: pass
    human_judgment: false
  - id: D3
    description: "authorize refuses a re-run until the previous attempt is owner-confirmed and its live run is failed, cancelled or closed, refuses a run out of the order 2, 3, 1, refuses an already passed run, and exits 75 for a run with two failed attempts under any digests or classification"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: startRefusal admits one re-run of a stopped attempt, and only on the owner's ruling (plan 03-53; D-26, D-27, D-34)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: the order 2, 3, 1, the product-defect epoch, the two-failure stop-loss and the run-role invariant (plan 03-53; D-26, D-29, D-33)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#authorize applies startRefusal: the order, the previous attempt and the stop-loss (plan 03-53)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 53: Attempt bookkeeping, classification, the order, the epoch and the stop-loss Summary

**Each exit start is now recorded under its run role and attempt number, Claude's classification of a stop and the owner's ruling are written by `classify`, and `authorize` enforces the order 2, 3, 1, the owner-confirmed single re-run, the product-defect epoch and the two-failure stop-loss (exit 75) through `startRefusal`, counting by role and not by brief digest.**

## Performance

- **Duration:** about 40 min
- **Tasks:** 2 of 2 (Task 1 a tracer, Task 2 auto; both TDD)
- **Files:** 2 modified (`scripts/exit-run-phase3-tools.ts`, `test/unit/exit-evidence.test.ts`), 2 RED evidence records created
- **No file under `src/` changed; no brief changed; no live run, no spend; the owner's ledger was read only by tests through `readState` functions and by the CLI cases, which cannot read a profile**

## Accomplishments

- `attemptFor(auth, digest, runs, runId)`: role, attempt (1 plus the earlier entries of the role, whatever their digest; an entry the same run ID holds keeps its number on a re-judgement) and expects. The `evidence --stage start` writes them into the entry and refuses with exit 2, writing nothing, a brief whose digest the authorization does not name.
- `withClassification` (pure) and the `classify` subcommand (`--propose`, `--confirm`).
- `startRefusal(evidence, auth, role, readState)` and `epochOf(evidence)`; `authorize` calls `startRefusal` in place of the plan 03-29 "brief already recorded" and "run count" rules (neither text remains in the file) and maps code 75 to its existing `EXIT_CEILING` path, so the shell script prints `exit-run: stop and ask the owner (D-05)`.
- The tools' header comment describes roles, attempts, classification, epochs and the stop-loss, and no longer describes the removed rules.

## TDD Gate Compliance

Both tasks ran RED then GREEN; no REFACTOR commit.

- Task 1 RED `a96237d`, GREEN `253440a`. RED output (`node --test --test-reporter=tap test/unit/exit-evidence.test.ts`, kept in `03-53-red-task1.json`): 150 tests, 116 pass, 34 fail. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`), target "--propose writes classification.proposed into that entry only, with the evidence Claude gives, and every other byte of the file is as it was": expected exit 0, actual exit 2 with the tool's usage line because `classify` was not a subcommand. Semantic assessment: the target ran against a temporary evidence file and failed on the planned status assertion, not on setup or a crash. The pure-function cases failed with `exitTools.startRefusal is not a function`, `exitTools.attemptFor is not a function` (the planned missing exports), and the start-stage case got exit 1 (profile read) where it expects 2.
- Task 2 RED `2cfcc6d`, GREEN `1e7bd53`. RED output (`03-53-red-task2.json`): 167 tests, 154 pass, 13 fail. `RED_EVIDENCE_OK`, target "refuses with code 75 the third start of a run whose two attempts both failed and were confirmed as brief/harness defects": `startRefusal` returned `undefined` where the case expects `{ code: 75, text: 'stop-loss (D-29): ...' }`. Semantic assessment: the real function ran on a two-failure file and failed on the planned deep-equal assertion, so it is neither a missing export nor a fixture fault. The order, epoch, already-passed and invariant cases fail on their planned assertions; `epochOf` cases fail with `exitTools.epochOf is not a function`; the CLI stop-loss case got exit 2 from the Task 1 missing-confirmation rule where it expects 75.

## Refusal texts (the run plans quote these in their checkpoint branches)

`authorize` prints each after `exit-run: ` and exits with the code shown. `<run>` is the role (`run1`, `run2`, `run3`).

| Rule | Code | Text |
|---|---|---|
| Order (D-33), no attempt of the earlier run | 2 | `<run> starts only after <earlier>'s outcome is recorded (D-33): <earlier> has no attempt in this exit yet` |
| Order (D-33), latest attempt has no outcome | 2 | `<run> starts only after <earlier>'s outcome is recorded (D-33): its latest attempt <runId> has neither passed nor an owner-confirmed classification` |
| Missing confirmation (D-26, D-27) | 2 | `<run>'s previous attempt has no owner-confirmed classification (<runId>): Claude proposes it and the owner confirms it before any re-run spend (D-26, D-27)` |
| Open previous run (D-34), open | 2 | `<run>'s previous attempt <runId> is <state>; the owner cancels it first (D-34)` (for example `is blocked_on_decision; the owner cancels it first`) |
| Open previous run (D-34), unreadable | 2 | `<run>'s previous attempt <runId> cannot be read from the owner's ledger; the owner cancels it first (D-34)` |
| Stop-loss (D-29) | 75 | `stop-loss (D-29): <run> has failed twice; return to the owner before spending again` |
| Already passed (D-26, D-03) | 2 | `<run> already passed in this exit; a run is never repeated by hand (D-03)` |
| Role not in the authorization | 2 | `<run> is not a run of the authorization (order <order>) (D-28)` |
| Brief names no run | 2 | `the brief <path> (digest <digest>) names no run in the authorization: stop and report` |

The checks run in this order: stop-loss, already passed, the order, the missing confirmation, the live state of every earlier non-passed attempt. The success line is now `authorized: <brief> (...), host <version>, Phase 3 spend ... fits ... USD, <run> attempt <n>`.

`classify` refusals (exit 2, file byte-identical) name the cause, for example `exit-run: classify: --by must be claude: Claude proposes the classification (D-27)`, `... --by must be owner: only the owner confirms a classification (D-27)`, `... <runId> passed: a passed run has nothing to classify`, `... the evidence file holds no entry for <runId>`, `... <runId> has no proposal to confirm: Claude proposes first (D-27)`, `... --at "<x>" is not <path>:<line>`, `... --docs-ref "<x>" is not a document under docs/system/ (D-27)`, `... <runId> is already ruled on by the owner (<class>): the ruling stands, and a proposal|confirmation cannot replace it`.

## Interpretations the run plans should know

1. **A confirmed product defect on run N does not release run N+1 in the order.** The plan says run3 is admitted once run2's stop is "owner-confirmed (either class)" and also that an entry started before a product-defect confirmation never satisfies the order. These meet when run2 itself is the confirmed product defect: its entry started before its own confirmation, so it is outside the new epoch. I followed the epoch rule (T-03-135, and D-26's "re-run all three"): after a product defect, run2 must pass again before run3 or run1 starts. A brief/harness-defect confirmation does release the next run, as written. A case pins both.
2. **A product-defect confirmation releases a re-run of its own run** (its entry is before the epoch it starts), subject to the live-run check.
3. **Stop-loss versus classification:** two failed attempts stop the run with code 75 even when both are unconfirmed, and it is checked before the missing-confirmation rule, so the executor sees the stop-loss and not a request to classify.

## Verification

- `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 203 tests, 203 pass, 0 fail.
- `npm run typecheck` (`tsc -p .`): no output (clean). `node scripts/check-boundaries.ts`: `check-boundaries: ok (99 file(s))`.
- Regression sweep: `npm run test:unit` 2098 pass, 0 fail.
- Acceptance: `grep -n "export function startRefusal" scripts/exit-run-phase3-tools.ts` prints one line and `authorize` calls it; `grep -c "already records a run of" scripts/exit-run-phase3-tools.ts` prints 0; the classify refusals compare sha256 before and after in the cases. `git diff --name-only` over this plan's commits lists the two source files and the two RED records.

## Documentation surfaces for the documentation plan

`docs/system/` exists in this checkout; as in plans 03-51 and 03-52 this plan lists its surfaces instead of editing it mid-phase. For the phase's documentation plan: the `classify` subcommand (flags, the two modes, exit 0 and 2, the `classification.proposed` and `classification.confirmed` shapes); the evidence entry fields `run`, `attempt`, `expects`; the `authorize` rules of `startRefusal` (order 2, 3, 1; owner-confirmed re-run; live-run check read-only; product-defect epoch; stop-loss exit 75; already-passed) with the refusal texts above; the changed `authorized:` line.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing authorize gate case needed run-b's pass on record**
- **Found during:** Task 2 (RED)
- **Issue:** the plan 03-52 case "passes the gate for a fully classified brief and reaches the spend guard" starts run1, which is the second run in that fixture's order (`run-b`, `run-a`); under D-33 it is now refused on an empty evidence file.
- **Fix:** the case writes a passed `run-b` entry into its evidence file first and asserts the new `authorized: ... run-a attempt 1` line. The assertion that the gate passes is unchanged.
- **Files modified:** test/unit/exit-evidence.test.ts
- **Commit:** 2cfcc6d

Otherwise: plan executed as written. Notes, none a deviation: (1) new exports are read through casts in the tests so a missing export fails its own case; (2) `attemptFor` and `startRefusal` take `Pick<Authorization, ...>` so the full value `authorizationOf` returns is accepted; (3) the per-task commit steps ran as separate simple commands because the sandbox refuses compound commands that contain git.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-03-132 (spend drain by repeated attempts): the stop-loss counts by role across epochs, pinned by the invariant case and an authorize-level exit-75 case. T-03-133 (re-run on Claude's classification alone): `classify` refuses `--by` other than owner for a confirmation, and `startRefusal` accepts only `confirmed.by === 'owner'`; a proposal alone admits nothing (case). T-03-134 (re-run beside an open run): the live-state check refuses an open or unreadable previous run. T-03-135 (a pass from an earlier epoch): `epochOf` bounds the order and already-passed checks, pinned by cases.

## Self-Check: PASSED

- FOUND: scripts/exit-run-phase3-tools.ts, test/unit/exit-evidence.test.ts, 03-53-red-task1.json, 03-53-red-task2.json
- FOUND commits: a96237d, 253440a, 2cfcc6d, 1e7bd53
- STATE.md and ROADMAP.md untouched.
