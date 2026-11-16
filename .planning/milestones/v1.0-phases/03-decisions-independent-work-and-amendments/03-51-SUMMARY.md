---
phase: 03-decisions-independent-work-and-amendments
plan: 51
subsystem: run-status-reporting
tags: [status, inbox, checks, d-35, frozen-shapes]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-49 scenario N (a declared not-required check skipped silently), the frozen-shapes rule (03-21)
provides:
  - "checksNotRun(contract) sharing one predicate with checksToRun"
  - "optional last key checksNotRun on a status run entry and on an inbox review entry"
  - "`<check> not run: not required` entries on the status evidence line and a `checks <runId>:` inbox line"
affects: [03-57, 03-58, 03-59, 03-31, 03-32, 03-33]

actuals:
  tokens: 14000
  tasks: 2
  commits: 4
plan_head_before: 9e5eb1ad85f1d8bcdec2c496118066688c524734
plan_head_after: 47ddfd2cc44e400c2a69f0edab357006060de298

tech-stack:
  added: []
  patterns: ["one module-private predicate backs both the run list and the not-run list, so they partition the declared checks"]

key-files:
  created:
    - test/unit/checks-not-run.test.ts
    - test/integration/run-checks-not-run.test.ts
  modified:
    - src/app/checks.ts
    - src/app/run-status.ts
    - src/cli/render/run-view.ts
    - test/unit/render.test.ts
    - test/unit/json-shapes.test.ts
    - test/integration/run-status.test.ts

key-decisions:
  - "D-35 is reporting only: no gate, run stage, evidence row or frozen snapshot changed"
  - "The reason is always `not required`; a required or target check that does not run for another reason is outside D-35"
  - "The list is read from the run's latest contract version, so an amendment that makes a check required removes it from the list"

requirements-completed: [AUT-16, AUT-12]

duration: 40min
completed: 2026-11-10
status: complete

coverage:
  - id: D1
    description: "status --json carries checksNotRun as the run entry's last key and the status evidence line names `<check> not run: not required`"
    requirement: AUT-16
    verification:
      - kind: integration
        ref: "test/integration/run-checks-not-run.test.ts#status --json gives the run entry `checksNotRun` as its last key"
        status: pass
      - kind: integration
        ref: "test/integration/run-checks-not-run.test.ts#status (text) names the check on the evidence line, after the measured entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "inbox --json carries checksNotRun as the last key of a review entry and the text inbox prints `checks <runId>: ...`"
    requirement: AUT-12
    verification:
      - kind: integration
        ref: "test/integration/run-checks-not-run.test.ts#inbox --json gives the review entry `checksNotRun` as its last key"
        status: pass
      - kind: unit
        ref: "test/unit/render.test.ts#prints a `checks <runId>:` line under the reviews table for a review that carries not-run checks, and none for one that does not (D-35)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The check is still never run and no gate or frozen JSON shape changed"
    requirement: AUT-16
    verification:
      - kind: integration
        ref: "test/integration/run-checks-not-run.test.ts#the ledger holds no evidence row named e2e, and G4 passed for the handed-off commit"
        status: pass
      - kind: other
        ref: "git diff --exit-code 4525c27 -- src/domain/gates.ts src/app/run-stages test/fixtures/json-shapes"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 51: Report declared not-required checks as not run (D-35) Summary

**A declared check that is neither required nor a target is now named `not run: not required` in `status --json`, the status evidence line and the inbox review summary, through one predicate shared with `checksToRun`, with no gate or frozen JSON shape changed.**

## Performance

- **Duration:** about 40 min
- **Tasks:** 2 of 2
- **Files:** 2 created, 6 modified (3 source, 5 test including the new ones)

## Accomplishments

- `src/app/checks.ts`: module-private `runsCheck` (required or target) backs both `checksToRun` and the new exported `checksNotRun`; the two lists partition the declared checks in declaration order.
- `src/app/run-status.ts`: `RunCheckNotRunView`, defensive `checksNotRunOf(body)`, and the optional `checksNotRun` key appended last to `RunStatus` and `InboxReview`, present only when non-empty.
- `src/cli/render/run-view.ts`: `evidence:` line = measured entries followed by `<name> not run: not required`; `evidence: none` only when both lists are empty; the inbox prints `checks <runId>: ...` under the reviews table. Every name and run ID passes `stripControl`.

## TDD Gate Compliance

Both tasks ran RED then GREEN.

- Task 1 RED `842bb09`, GREEN `e94a993`. RED output: the unit file failed to load (`SyntaxError: ... does not provide an export named 'checksNotRun'`, as the plan expects); the integration file ran 4 tests, 2 passed (run reached ready_for_review, no `e2e` evidence row) and 2 failed on the planned assertions (`status --json` run entry has no last key `checksNotRun`; the text evidence line is `evidence: test passed`). `gsd_run check tdd-red-evidence` on the integration TAP output returned `RED_EVIDENCE_OK` (`target_test_failed`, target "status --json gives the run entry `checksNotRun` as its last key"). Semantic assessment: the target executed a real run, and failed on the assertion about the missing key, not on setup.
- Task 2 RED `5d6ed3b`, GREEN `47ddfd2`. RED output: 4 failures of 122 tests, exactly the two inbox integration cases (`reviews[0]` keys end at `repository`; no `checks <runId>:` line) and the two inbox render cases. The frozen-shape guards (status-runs.json has no `checksNotRun`; the review key assertion now a prefix assertion) passed before and after, as they should.
- No REFACTOR commit.

## Examples from the integration test (a real run through `start --wait`)

`status --json`, run entry (last keys):

```json
"items": [...], "decisions": [], "notifications": {...},
"checksNotRun": [{ "name": "e2e", "reason": "not required" }]
```

`status` text: `  evidence: test passed, e2e not run: not required`

`inbox --json` review entry keys: `runId, title, branch, commit, repository, checksNotRun`.

`inbox` text, under the reviews table: `checks <runId>: e2e not run: not required`

## Verification

- `node --test test/unit/checks-not-run.test.ts test/integration/run-checks-not-run.test.ts test/unit/render.test.ts test/unit/json-shapes.test.ts test/integration/run-status.test.ts`: 128 tests, 128 pass, 0 fail.
- `npx tsc -p .`: no output (clean). `node scripts/check-boundaries.ts`: `check-boundaries: ok (99 file(s))`.
- `git diff --exit-code 4525c27 -- src/domain/gates.ts src/app/run-stages test/fixtures/json-shapes`: exit 0 (no gate, run stage or frozen snapshot changed).
- Regression sweep: `npm run test:unit` 2005 pass, 0 fail; integration files that touch status or inbox (`run-finish-in-place`, `run-independent-work`, `phase3-exit-offline`, `run-silence`, `run-notify`): 71 pass, 0 fail.
- Acceptance criteria: `grep -n "export function checksNotRun" src/app/checks.ts` prints line 104 and `checksToRun`/`checksNotRun` both call `runsCheck`; the fixture run's last key is `checksNotRun` with `[{"name":"e2e","reason":"not required"}]`; the inbox review keys are `runId,title,branch,commit,repository,checksNotRun`; test/fixtures/json-shapes is unchanged against 4525c27.

## Documentation surfaces for plans 03-31 to 03-33

`docs/system/` exists in this checkout, but the plan lists these surfaces for the phase's documentation plans instead of editing it mid-phase (candidates: `docs/system/cli-reference.md` and `docs/system/checks-and-evidence.md`). The documentation plans apply:

1. The `checksNotRun` key of `status --json` (a run entry's last key, optional, `[{ name, reason: "not required" }]`) and of `inbox --json` (a review entry's last key, optional, same shape). Absent when every declared check is required or a target.
2. The `<check> not run: not required` entries on the status `evidence:` line, after the measured entries; `evidence: none` only when there are neither.
3. The inbox `checks <runId>: <check> not run: not required[, ...]` line under the reviews table, one per review that carries the key.
4. The check is still never run: no evidence or gate row is written for it and G2 and G4 judge exactly what they judged before (D-35). The list is read from the run's latest contract, so a check an amendment makes required (`--check +name`) leaves it.

## Deviations from Plan

None - plan executed exactly as written.

Two implementation notes, neither a deviation: `checksNotRunOf` passes a name-only `execution.checks` to `checksNotRun` through a type assertion, because `checksNotRun`'s parameter is the `Pick<RunContract, 'execution' | 'verification'>` the plan names while a stored body is untyped; and the plan's cwd-safety wrapper refused compound shell commands, so commits were issued as separate simple commands.

## Known Stubs

None.

## Threat Flags

None. The mitigations of T-03-125 (stripControl on names and run IDs, pinned by two render cases with escape sequences), T-03-126 (entry says `not run: not required`, no evidence row, G4 unchanged, asserted) and T-03-127 (key optional, appended last, snapshots byte-identical) are in place.

## Self-Check: PASSED

- FOUND: src/app/checks.ts, src/app/run-status.ts, src/cli/render/run-view.ts, test/unit/checks-not-run.test.ts, test/integration/run-checks-not-run.test.ts
- FOUND commits: 842bb09, e94a993, 5d6ed3b, 47ddfd2
- STATE.md and ROADMAP.md untouched.
