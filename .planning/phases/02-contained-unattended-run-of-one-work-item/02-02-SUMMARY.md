---
phase: 02-contained-unattended-run-of-one-work-item
plan: 02
subsystem: cli
tags: [ops-7, render, json-snapshots, status, terminal-safety]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: the status read model, the `--json` shapes of status and context, the CLI dispatcher and the fault-injection helpers
provides:
  - Committed normalized snapshots of every Phase 1 `--json` output (status empty, active and interrupted; context active) and a test that compares against them (D-19, SC 7)
  - src/cli/render/ with the OPS-7 functions resultLine, stateWord, errorLine, usd, duration, localTime, colourEnabled, stripControl, renderTable, terminalWidth and renderStatus
  - init, repo, status and the dispatcher's errors printed in the OPS-7 style
affects: [02-10, 02-12, 02-15, 02-19, every plan that prints human text]

actuals:
  tokens: 16500
  tasks: 2
  commits: 4
plan_head_before: a4c970eb897836bed38d1442a12f5acb5222e46a
plan_head_after: 4ec1b5c3625013d15bdbb966eeaa40b01647af77
commits: 4

tech-stack:
  added: []
  patterns:
    - "Render functions are pure and return text without a trailing newline (tables end with one); callers pass width, time and environment in"
    - "Every recorded or repository-derived string passes through stripControl before it is printed (T-02-03)"
    - "A frozen-output snapshot is committed before the renderer change, normalized for volatile values only, regenerated with AVARICE_SNAPSHOT_WRITE=1"

key-files:
  created:
    - src/cli/render/style.ts
    - src/cli/render/table.ts
    - src/cli/render/status-view.ts
    - test/unit/json-shapes.test.ts
    - test/unit/render.test.ts
    - test/fixtures/json-shapes/status-empty.json
    - test/fixtures/json-shapes/status-active.json
    - test/fixtures/json-shapes/status-interrupted.json
    - test/fixtures/json-shapes/context-active.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-02-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-02-red-evidence-task2.json
  modified:
    - src/app/status.ts
    - src/cli/commands/status.ts
    - src/cli/commands/init.ts
    - src/cli/commands/repo.ts
    - src/cli/main.ts
    - src/cli/composition.ts
    - test/integration/init.test.ts
    - test/integration/preflight.test.ts
    - test/integration/ledger-status.test.ts
    - test/integration/lease.test.ts
    - test/fault/killpoints.test.ts
    - docs/extensions.md

key-decisions:
  - "The status table is PROJECT, REPOSITORY, ACTIVITY, STATE, NEXT; the onboarding ID, the resume line and the record line sit below the table in project order, so the table stays within a 100 column terminal"
  - "An interrupted onboarding shows ACTIVITY `interrupted`, STATE its plain ledger word and NEXT the checkpoint's next action; the line below the table reads `onboarding <id>: <state> (interrupted)`"
  - "renderTable cuts the widest cuttable column first; a column marked `keep` (NEXT) is cut only after the others are at their minimum, and a `subject` column is never cut and may overflow the width"
  - "init prints `initialized` when the store's latest migration was applied after this process started, otherwise `already initialized`"
  - "Composition failures no longer carry a hand-built `avarice: ` prefix; the dispatcher prefixes them with the command"

requirements-completed: [OPS-7, FR-11]

coverage:
  - id: D1
    description: "Phase 1 status --json (empty, active, interrupted) and context --json are frozen as normalized snapshots committed before any renderer change"
    requirement: "FR-11"
    verification:
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Shared OPS-7 render functions: result line, states, errors, numbers, colour gate, control-character stripping, aligned tables cut to the width"
    requirement: "OPS-7"
    verification:
      - kind: unit
        ref: "test/unit/render.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "status, init, repo and the dispatcher's errors print in the OPS-7 style with exit codes and JSON paths unchanged"
    requirement: "OPS-7"
    verification:
      - kind: integration
        ref: "test/integration/init.test.ts, test/integration/preflight.test.ts, test/integration/ledger-status.test.ts, test/integration/lease.test.ts, test/fault/killpoints.test.ts"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-11-05
status: complete
---

# Phase 2 Plan 02: OPS-7 render functions and frozen JSON shapes Summary

**Phase 1 `--json` output is frozen as normalized snapshots taken before the change, and `status`, `init`, `repo` and the dispatcher's errors now print through one shared OPS-7 module (result line, aligned width-cut tables, ledger-word states, `avarice <command>: ` errors, control characters stripped).**

## Performance

- **Duration:** about 18 min (start time was not recorded; counted from the previous plan's last STATE write at 10:26:49Z)
- **Completed:** 2026-11-05T10:45Z
- **Tasks:** 2 (Task 1 a tracer, Task 2 auto)
- **Files modified:** 21 in src, test and docs (939 insertions, 68 deletions), plus the two RED evidence files

## Accomplishments

- The snapshot came first. `test/unit/json-shapes.test.ts` and four fixtures were generated from the unchanged code at `a4c970e` with `AVARICE_SNAPSHOT_WRITE=1 node --test test/unit/json-shapes.test.ts` and committed in `8d1b28f`, which is older than every commit that touches `src/cli/render/` (`22f1402`). The test normalizes IDs, temp paths, ISO timestamps, SHA-1 and SHA-256 hex only, and also asserts that the normalized text has the same keys, key order, array lengths and value types as the raw output. It passed unchanged after both tasks.
- `src/cli/render/style.ts`, `table.ts` and `status-view.ts` implement the OPS-7 table of `docs/extensions.md`. `renderStatus` moved out of `src/app/status.ts` (the app layer keeps `getStatus` and imports nothing from the CLI).
- `init` prints `profile personal-local: initialized` or `already initialized` first. `repo add` prints `project <id>: registered` first, prefixes errors with `avarice repo add: `, and names one resolving line after them: `run: git -C <path> rev-parse --show-toplevel` for a path that is not a repository, `run: avarice status` for an existing-state refusal. The dispatcher builds every error line with `errorLine`.
- Every recorded string a renderer prints goes through `stripControl` (OSC, DCS, CSI in 7-bit and 8-bit forms, other ESC sequences, C0, DEL, C1 and bidirectional overrides; newline and tab kept). `repo add` also flattens newlines inside file names so a name cannot forge an output line.

## Task Commits

1. **Snapshot of the Phase 1 JSON (before Task 1's code)** - `8d1b28f` (test)
2. **Task 1: tracer, render functions and status through them** - `22f1402` (feat)
3. **Task 2: init, repo and dispatcher errors** - `2f27647` (feat)
4. **Docs: OPS-7 status sentence in docs/extensions.md** - `4ec1b5c` (docs)

**Plan metadata:** the SUMMARY commit that follows this file (docs: complete plan).

RED evidence: `02-02-red-evidence-task1.json` (28 of 31 render tests failing against stubs that export every name) and `02-02-red-evidence-task2.json` (4 init, repo and refusal tests failing on the old text; the dispatcher wording tests already passed because that wording is unchanged by design).

Tracer gate: the Task 1 verify (json-shapes, render, boundaries, tsc) re-ran green, so the plan logged "Tracer verified end-to-end - expanding" and went on to Task 2.

## Files Created/Modified

- `src/cli/render/style.ts` - pure text functions: `resultLine`, `stateWord`, `errorLine`, `usd`, `duration`, `localTime`, `colourEnabled`, `stripControl`
- `src/cli/render/table.ts` - `renderTable` (header row, alignment, widest-first cut with `…`, `subject`, `keep` and `cut: 'start'` options) and `terminalWidth`
- `src/cli/render/status-view.ts` - `renderStatus(entries, { width })`
- `src/app/status.ts` - `renderStatus` and `describeIndexes` removed; `getStatus` and its types unchanged
- `src/cli/commands/status.ts`, `init.ts`, `repo.ts`, `src/cli/main.ts` - print through the render functions; exit codes unchanged
- `src/cli/composition.ts` - the composition failure message no longer starts with `avarice: `
- `test/unit/json-shapes.test.ts`, four fixtures - the frozen shapes
- `test/unit/render.test.ts` - 33 tests, one group per OPS-7 row plus status

## Decisions Made

- **Status layout.** The plan fixes the columns and the first line. At 100 columns the onboarding ID did not fit beside the 31-character project ID, so the ID, the `continue with:` line and the record line moved below the table, per project. The kill-point and lease suites showed NEXT being cut to `compile-contr…` in the first draft; NEXT is now cut last, and an interrupted onboarding shows `interrupted` in ACTIVITY so STATE stays a plain ledger word.
- **`init` first-run detection.** After composition the store cannot tell whether this run created it, so `init` compares the latest `schema_migrations.applied_at` with the process start time. Exact for the CLI (one process per command); an in-process caller that migrated earlier in the same process also reads `initialized`.
- **`status: <n> project(s)`** is the literal wording the plan flagged, kept for the shell (02-19).
- **Colour.** `colourEnabled` exists and is tested; nothing paints yet, so no escape is ever printed by these renderers. A later plan that adds colour must use it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Status text assertions had to change in Task 1, not Task 2**
- **Found during:** Task 1 (status text changed there, so existing tests failed at the Task 1 commit)
- **Issue:** `test/integration/lease.test.ts` and `test/fault/killpoints.test.ts` assert on the old `interrupted in <state> (next: ...)` text. They are in Task 2's file list but broke as soon as `status` moved.
- **Fix:** updated both in the Task 1 commit (`22f1402`); the JSON assertions and exit-code assertions in them are untouched.
- **Files modified:** test/integration/lease.test.ts, test/fault/killpoints.test.ts
- **Commit:** `22f1402`, refined in `2f27647`

**2. [Rule 3 - Blocking] src/cli/composition.ts changed (not in the plan's file list)**
- **Found during:** Task 2
- **Issue:** the composition failure message carried its own `avarice: ` prefix, so routing it through `errorLine(name, ...)` would have printed `avarice status: avarice: cannot open ...`, and leaving it would have kept a hand-built prefix after a command was chosen, which OPS-7 forbids.
- **Fix:** `failure()` returns the message without the prefix and the dispatcher adds `avarice <command>: `. The only reader, `test/helpers/live-harness.ts`, wraps it in its own text.
- **Files modified:** src/cli/composition.ts
- **Commit:** `2f27647`

**3. [Rule 2 - Missing critical] Terminal-safety on repo add output**
- **Found during:** Task 2 (threat T-02-03)
- **Issue:** `repo add` printed repository-derived names (git root, pin, branch, file lists) verbatim; a file name can hold an escape sequence or a newline.
- **Fix:** `oneLine()` strips control characters and flattens newlines and tabs for each such value.
- **Files modified:** src/cli/commands/repo.ts
- **Commit:** `2f27647`

**4. [Rule 1 - Bug, found by my own tests] First status layout cut the next action**
- **Found during:** Task 2 verification (`test/fault/killpoints.test.ts`, 10 of 22 failing)
- **Issue:** at the default 100 columns the widest-first cut shortened NEXT to `compile-contr…` and REPOSITORY to a few characters.
- **Fix:** added `keep` to the table columns (cut last), moved `interrupted` into ACTIVITY, and covered both in `render.test.ts`.
- **Commit:** `2f27647`

Also: `docs/extensions.md` said `init`, `repo`, `status` and the dispatcher "do not yet meet OPS-7"; the sentence now states what is true (`4ec1b5c`).

**Total deviations:** 4 auto-fixed (2 blocking, 1 missing critical, 1 bug). **Impact:** none on scope; every change serves OPS-7 or SC 7.

### Test diff review (acceptance criterion)

`git diff a4c970e..HEAD -- test/`: new files are `json-shapes.test.ts`, `render.test.ts` and the four fixtures. Changed existing assertions, all about human text:

- `test/fault/killpoints.test.ts`: `/interrupted in /` became includes of `<state> (interrupted)` and of the expected next action.
- `test/integration/lease.test.ts`: `interrupted in mapping (next: launch:map)` became `/\binterrupted\s+mapping\s+launch:map\b/` plus a `continue with: avarice resume <id>` line match.
- Added, not changed: first-line assertions in `init.test.ts` (initialized, then already initialized) and `preflight.test.ts` (`project <id>: registered`, `avarice repo add: ` prefix, the `run: git -C ...` line, the `run: avarice status` line, `avarice repo: ` usage prefix) and two dispatcher tests plus a tightened unknown-command regex in `ledger-status.test.ts`.

No JSON assertion and no exit-code assertion was edited. `test/integration/offline.test.ts`, `skeleton.test.ts`, `checkout-unchanged.test.ts`, `budgets.test.ts` and `full-map-resume-stamp.test.ts` needed no change.

## Issues Encountered

- Width is counted in code points, which is exact for the text AVARICE prints and approximate for wide East Asian characters in a repository path.
- At exactly 100 columns with a long repository path, the REPOSITORY column shrinks to about 15 characters (tail kept, `…` first); IDs and states are never cut, so a terminal narrower than about 85 columns overflows instead of hiding an ID.
- `context` text and the `onboard` and `resume` text were left as the plan says; their `--json` shapes are frozen by the snapshots.

## Verification

- `node --test "test/unit/json-shapes.test.ts" "test/unit/render.test.ts"`: pass (also run again after Task 2)
- Task 2 verify group (render, json-shapes, cli-args, init, offline, lease, skeleton, preflight, checkout-unchanged, budgets, full-map-resume-stamp): 166 of 166 pass
- `node --test test/fault/killpoints.test.ts`: 22 of 22 pass (it failed 10 of 22 once, before the NEXT-column fix, see deviation 4)
- Whole suite `node --test`: 1402 tests, 1380 pass, 0 fail, 22 skipped (the live cases that need `AVARICE_LIVE=1`)
- `node scripts/check-boundaries.ts` and `npx tsc -p .`: clean
- Acceptance: fixtures' first commit precedes the first `src/cli/render/` commit; `grep -c "export function renderStatus"` is 0 in `src/app/status.ts` and 1 in `src/cli/render/status-view.ts`; no hand-built `io.err(\`avarice` line remains in main.ts, init.ts or repo.ts; render.test.ts has 33 tests.

## Threat Flags

None. The two planned mitigations are in place: T-02-03 (`stripControl` on every non-constant string, unit-tested) and T-02-04 (snapshot committed before the change, JSON branch untouched). No package was installed (T-02-SC). No live model call was made and no live spend was recorded.

## Next Phase Readiness

Ready for 02-03. Plans 02-10, 02-12, 02-15 and 02-19 can import `resultLine`, `stateWord`, `usd`, `duration`, `localTime`, `renderTable`, `terminalWidth` and `stripControl` from `src/cli/render/`. The Phase 2 `runs` key (D-19) may be added to `status --json`; the snapshot fixtures then need regenerating only if a run exists in the scenario they build; every Phase 1 key must stay byte-identical.

## Self-Check: PASSED

All created files exist on disk and commits `8d1b28f`, `22f1402`, `2f27647` and `4ec1b5c` are in the log of the phase branch.
