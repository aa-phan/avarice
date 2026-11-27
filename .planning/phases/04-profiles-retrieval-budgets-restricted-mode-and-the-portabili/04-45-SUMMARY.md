---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 45
subsystem: host-claude attended hook install, doctor, approvals
tags: [install-host, attended-hook, doctor, approve, process-tree-refusal, gap-closure]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: install-host and the attended hook entry (04-19), refuseInsideRun and the identity context (04-27), doctor --extensions (04-25)
provides:
  - install-host refuses a run's process tree, not only AVARICE_RUN (WR-24)
  - install-host and installAttendedHook refuse a hook entry that is not a readable regular file, before anything is written (WR-25)
  - doctor --extensions reports an attended entry whose hook script or node executable is gone, as an error finding (WR-25)
  - approve names a missing request "no such approval request" (WR-27)
affects: [04-53 documentation plan, docs/system install-host, doctor and approve documents]

plan_head_before: 83b551facb6c53bb22383d6a404cbdc8ae6c3898
plan_head_after: b97c0e4f44efdae8d90fe182bc83e012445d0c2b

actuals:
  tokens: 8500
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "A reader exported beside its writer (attendedEntryPaths next to attendedHookEntry), so doctor reads back exactly the form install-host wrote"
    - "A refusal that leaves nothing half-installed: the hook entry is resolved and checked before the skill is written"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-45-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-45-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-45-red-task3.json
  modified:
    - src/cli/commands/install-host.ts
    - src/adapters/host-claude/attended-hook-install.ts
    - src/cli/commands/approve.ts
    - src/app/doctor.ts
    - src/cli/doctor-deps.ts
    - src/ports/diagnostics.ts
    - src/adapters/diagnostics/probes.ts
    - test/integration/install-host.test.ts
    - test/integration/approvals.test.ts
    - test/integration/doctor.test.ts

key-decisions:
  - "A refusal of a run's process tree in install-host is a usage-time refusal (exit 64, like the AVARICE_RUN refusal and the sibling evidence/context/pr commands), not exit 3"
  - "The attended entry's command form is parsed by attendedEntryPaths in the adapter module that writes it; any other command (hand-written, other form) yields null and no finding"
  - "doctor reads the attended commands through the existing config-directory facts and checks the files through a doctor-deps function, keeping the app layer free of adapter imports"

requirements-completed: [FR-12, OPS-1]

coverage:
  - id: D1
    description: "install-host refuses from a run's process tree with AVARICE_RUN unset, writing no skill, no settings.json and no store (WR-24)"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/install-host.test.ts#install-host refuses from a run process tree with AVARICE_RUN unset (WR-24, T-04-122)"
        status: pass
    human_judgment: false
  - id: D2
    description: "install-host and installAttendedHook refuse, with exit 3 and nothing written, a hook entry that is absent, a directory or unreadable (WR-25)"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/install-host.test.ts#install-host refuses a hook entry that is not a readable regular file (WR-25, T-04-123)"
        status: pass
    human_judgment: false
  - id: D3
    description: "doctor --extensions lists an error finding, with a fix naming install-host, for an attended entry whose script or node executable no longer exists; the JSON keys are unchanged (WR-25)"
    requirement: OPS-1
    verification:
      - kind: integration
        ref: "test/integration/doctor.test.ts#--extensions reports an attended entry whose hook script or node executable is gone (WR-25, OPS-1)"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "approve says 'no such approval request' for an unknown request ID and 'no such approval' for an unknown approval ID (WR-27)"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/integration/approvals.test.ts#answers n or nothing without writing an approval, and an unknown request with exit 64"
        status: pass
      - kind: integration
        ref: "test/integration/approvals.test.ts#is denied after `approve --revoke`; a second revoke exits 3 and an unknown approval exits 64"
        status: pass
    human_judgment: false

duration: 33min
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 45: Attended hook install and approval naming gap closure Summary

**install-host refuses a run's process tree and any hook entry that is not a readable file before writing anything, doctor --extensions reports an attended entry whose script or node is gone, and approve names a missing request correctly (WR-24, WR-25, WR-27).**

## Performance

- **Duration:** 33 min
- **Completed:** 2026-11-22T21:50Z
- **Tasks:** 3 (6 commits: 3 RED, 3 GREEN)
- **Files modified:** 13 (10 source and test files, 3 RED evidence records)

## Accomplishments

- WR-24: `install-host`'s `usage()` takes the identity context and calls `refuseInsideRun(env, context)`, so a process whose ancestry holds a run supervisor is refused with `AVARICE_RUN` unset, before the profile is resolved; the skill, `settings.json` and the store are never created. An unreadable process table refuses too (fail closed).
- WR-25 install side: `hookEntryProblem(path)` (new export of `attended-hook-install.ts`) classifies a path as missing, not a regular file or unreadable. `install-host` resolves the entry first and exits 3 naming the path and "nothing was written" before `installSkill`; `installAttendedHook` refuses the same case after its absolute-path check.
- WR-25 doctor side: `attendedEntryPaths(command)` returns the node and script paths of a command `attendedHookEntry` wrote, and null for any other. The config-directory facts now carry the attended commands; `doctor-deps` checks both paths with `attendedEntryPaths`; `extensionsSection` raises one error finding per missing path (area `extensions`, fix names `avarice install-host`). The `--json` keys are unchanged, and doctor exits 3 on the new finding.
- WR-27: `approve` picks the noun by testing `approval request ` first, then `approval `. Both messages are now asserted.

## RED / GREEN evidence

| Task | RED commit | RED target (semantic assessment) | GREEN commit |
| ---- | ---------- | -------------------------------- | ------------ |
| 1 | `1034920` | "exits 64 naming the process tree..." failed on `0 !== 64`: install-host installed the skill and hook from a scripted run ancestry; fixture valid. `RED_EVIDENCE_OK` | `1e9a340` |
| 2 | `fc131f0` | "exits 3 naming the path... (case 0)" failed on `0 !== 3` (entry written for a missing script); "answers n or nothing..." failed on the message assertion (prefix check). `RED_EVIDENCE_OK` | `f8bb303` |
| 3 | `4c4ea2c` | "lists an error naming the deleted hook script..." failed on `0 !== 1` findings; node-path and round-trip cases failed on their planned assertions. `RED_EVIDENCE_OK` | `b97c0e4` |

Records: `04-45-red-task1.json`, `04-45-red-task2.json`, `04-45-red-task3.json` (each non-zero `exitCode`, validated with `gsd-tools check tdd-red-evidence`). No REFACTOR commit was needed.

The tracer (Task 1) was re-verified end to end before expansion: `node --test test/integration/install-host.test.ts` (19 pass) and `npm run typecheck` clean.

## Task Commits

1. **Task 1: Tracer, install-host refuses from a run's process tree (WR-24)** - `1034920` (test), `1e9a340` (feat)
2. **Task 2: hook entry file check at install, approve noun (WR-25 install side, WR-27)** - `fc131f0` (test), `f8bb303` (fix)
3. **Task 3: doctor reports an attended entry whose script or node is gone (WR-25 doctor side)** - `4c4ea2c` (test), `b97c0e4` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `src/cli/commands/install-host.ts` - process-tree refusal in `usage()`; hook entry checked first in `run()`
- `src/adapters/host-claude/attended-hook-install.ts` - `hookEntryProblem`, `attendedEntryPaths`, the non-file refusal in `installAttendedHook`
- `src/cli/commands/approve.ts` - noun picked by the longer prefix first
- `src/app/doctor.ts` - `attendedEntryFiles` dependency and the error finding in `extensionsSection`
- `src/cli/doctor-deps.ts` - implements `attendedEntryFiles` with `attendedEntryPaths` and a regular-file check
- `src/ports/diagnostics.ts`, `src/adapters/diagnostics/probes.ts` - `attendedCommands` in the settings and config-directory facts
- `test/integration/install-host.test.ts`, `approvals.test.ts`, `doctor.test.ts` - the failing-first tests

## Decisions Made

- The process-tree refusal is a usage-time refusal and exits 64, matching the existing `AVARICE_RUN` refusal of this command (an existing test pins 64) and the sibling `evidence add`, `context add` and `pr record` refusals. The plan text said exit 3; see Deviations.
- `doctor` finds the attended commands through the existing config-directory facts (the diagnostics port) and checks files through a `doctor-deps` function. This keeps `src/app` free of adapter imports (`npm run check:boundaries` clean) while `doctor-deps` still uses `attendedEntryPaths`.
- A symbolic link to a regular file counts as a regular file for the hook entry, because the host starts the script through the link.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistency] Exit code of the process-tree refusal is 64, not 3**
- **Found during:** Task 1
- **Issue:** The plan's truth and behavior text say exit 3, but its action and key link put the check in `usage()` through `refuseInsideRun`, and `main()` turns every `usage()` refusal into exit 64. The existing test for `AVARICE_RUN` pins 64, and the review fix (04-REVIEW.md WR-24) is the `usage()` form.
- **Fix:** followed the mechanism (`usage()`, exit 64) so that both run refusals of this command exit alike; the test asserts 64, the refusal text and the absence of the skills directory, `settings.json` and the store.
- **Files modified:** `src/cli/commands/install-host.ts`, `test/integration/install-host.test.ts`
- **Committed in:** `1e9a340`

**2. [Rule 1 - Plan inconsistency] `approve` of an unknown request already exited 64, kept**
- **Found during:** Task 2
- **Issue:** the plan says an unknown request exits 3; the code and the existing tests exit 64 (`EXIT_USAGE`) for `not_found`, and exit 3 is for `conflict`. WR-27 is a message defect only.
- **Fix:** changed the message only; the tests assert the message and keep exit 64.
- **Files modified:** `src/cli/commands/approve.ts`, `test/integration/approvals.test.ts`
- **Committed in:** `f8bb303`

**3. [Rule 3 - Blocking] The attended facts are read in the diagnostics adapter, not in `doctor-deps`**
- **Found during:** Task 3
- **Issue:** the plan names `doctor-deps` as the reader of each attended entry, but the settings are parsed by `ProcessDiagnostics` (`probes.ts`) behind the `Diagnostics` port, and `src/app/doctor.ts` may not import adapters.
- **Fix:** added `attendedCommands` to the port's settings and config-directory facts and filled it in `probes.ts`; `doctor-deps` supplies `attendedEntryFiles`, which calls `attendedEntryPaths` (the acceptance grep on `doctor-deps.ts` is satisfied).
- **Files modified:** `src/ports/diagnostics.ts`, `src/adapters/diagnostics/probes.ts`, `src/app/doctor.ts`, `src/cli/doctor-deps.ts`
- **Committed in:** `b97c0e4`

**4. [Rule 3 - Blocking] A null-returning skeleton of `attendedEntryPaths` is in the Task 3 RED commit**
- **Found during:** Task 3
- **Issue:** the test file imports `attendedEntryPaths`; without an export the file fails to load, which is `INVALID_RED` (load failure), not a failing assertion.
- **Fix:** the RED commit carries a skeleton that returns null; the GREEN commit implements it.
- **Committed in:** `4c4ea2c` (skeleton), `b97c0e4` (implementation)

---

**Total deviations:** 4 (2 plan inconsistencies on exit codes, 2 blocking structure fixes)
**Impact on plan:** none on the closed findings; every truth holds with the corrected exit codes.

## Issues Encountered

None. The full `npm test` suite was not run (over an hour); the plan's verification files, `test/integration/hook-privileged.test.ts` and `test/unit/shell.test.ts` (183 tests) pass, with `npm run typecheck` and `npm run check:boundaries` clean.

## Documentation surfaces

For plan 04-53, the `docs/system/` documents to update:

- **install-host:** exit 64 now also covers a run's process tree (ancestor run supervisor, fail closed when the process table cannot be read), not only `AVARICE_RUN`; exit 3 now also covers a hook entry script (`AVARICE_HOOK_ENTRY` or this checkout's) that is absent, a directory or unreadable, with the message "the hook entry <path> <does not exist | is not a regular file | is not readable>; nothing was written", and no skill or `settings.json` is created on that refusal. `installAttendedHook` refuses the same case as a denied error.
- **doctor `--extensions`:** a new error finding in area `extensions` for each attended entry whose node executable or hook script is not a regular file, with the fix "run avarice install-host"; doctor exits 3 on it. Only a command in the form `install-host` writes is checked. The `--json` keys are unchanged.
- **approve:** an unknown request ID prints `no such approval request (...)` and an unknown approval ID with `--revoke` prints `no such approval (...)`; both exit 64.
- **Coverage ledger:** `coverage.md` counts that record doctor findings or install-host refusals may need an update.

## Known Stubs

None.

## Threat Flags

None. The plan's threats T-04-122, T-04-123 and T-04-124 are mitigated and tested; no new network, auth or file surface was added beyond the checks.

## Next Phase Readiness

Plan 04-53 (documentation) can take the surfaces above. No blockers.

## Self-Check: PASSED

- Created and modified files exist (three RED records and the ten source and test files).
- All six commits (`1034920`, `1e9a340`, `fc131f0`, `f8bb303`, `4c4ea2c`, `b97c0e4`) are ancestors of HEAD; `git rev-list --count` from the recorded base prints 6.
- Acceptance greps: `refuseInsideRun` in `install-host.ts` (2), `attendedEntryPaths` in `doctor-deps.ts` (2).
- `node --test` on install-host, approvals, doctor, json-shapes, hook-privileged and shell tests: 183 pass, 0 fail; typecheck and boundaries clean.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
