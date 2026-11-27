---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 07
subsystem: security
tags: [redaction, secrets, events, shell-history, sec-3, d-14, typescript]

requires:
  - phase: 01
    provides: "secret-patterns (findSecrets, redactSecrets), the events hash chain (appendEventRow)"
  - phase: 02
    provides: "the PreToolUse hook entry that appends events through appendEventRow, the interactive shell history"
provides:
  - "Redactor, redactLeaves and MIN_SEEDED_SECRET_LENGTH: the secret patterns plus run-time seeded literals (src/domain/redactor.ts)"
  - "processRedactor and seedProcessRedactor: the one Redactor of the process (src/adapters/redaction/process-redactor.ts)"
  - "appendEventRow redacts every string leaf of event data before bounding and hashing, for the ledger and the hook"
  - "appendHistory writes each shell history entry redacted"
affects: [04-15, 04-18, 04-22, 04-37]

actuals:
  tokens: 5600
  tasks: 2
  commits: 4
plan_head_before: eff2899f669d0006c0823f9e149d06de3922733b
plan_head_after: a2d9f121f9900ecc84a1e4e85d057fa6ed493292
commits: 4

tech-stack:
  added: []
  patterns:
    - "Redact before hashing: the one append path computes row_hash over the redacted data_json, so the chain verifies over exactly what is stored"
    - "A domain Redactor with a module-level instance in an adapter directory, so the lean hook entry loads it through events.ts without any CLI or app import"
    - "Seeded literals are matched as intervals and overlapping matches merge into one marker, so two overlapping credentials leave no fragment of either"

key-files:
  created:
    - src/domain/redactor.ts
    - src/adapters/redaction/process-redactor.ts
    - test/unit/redactor.test.ts
    - test/integration/event-redaction.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-07-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-07-red-task2.json
  modified:
    - src/adapters/sqlite/events.ts
    - src/cli/shell/history.ts

key-decisions:
  - "Redaction runs inside appendEventRow, the one function both event writers call, so the hook and the ledger cannot diverge"
  - "A seeded literal shorter than 8 characters is refused with an `invalid` PortError naming MIN_SEEDED_SECRET_LENGTH (RESEARCH A3)"
  - "Overlapping seeded literals merge into one [REDACTED:seeded] marker instead of replacing longest first, which would leave a fragment of the shorter literal"
  - "redactLeaves returns a non-plain object unchanged, so canonicalJson refuses it exactly as before the redactor existed"
  - "Shell history redacts after control characters are stripped, so an escape sequence inside a token cannot hide it from the patterns"

patterns-established:
  - "Event data keys are not redacted; only string leaves are"

requirements-completed: [SEC-3]

coverage:
  - id: D1
    description: "An event carrying a GitHub token, a private key block or a seeded literal is stored as [REDACTED:<kind>] and the hash chain recomputes over the stored text"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/event-redaction.test.ts#tracer: an event carrying a secret is stored redacted with a valid hash chain (SEC-3)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Events written by the PreToolUse hook entry (a deny with a token in the tool name, a completed write whose target holds an AWS key ID) are stored redacted on the same chain"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/event-redaction.test.ts#stores an event written by the PreToolUse hook entry redacted, on the same chain"
        status: pass
      - kind: integration
        ref: "test/integration/hook.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Redactor refuses a seeded literal under 8 characters, merges overlapping literals, and leaves digests, run IDs and paths unchanged"
    requirement: SEC-3
    verification:
      - kind: unit
        ref: "test/unit/redactor.test.ts#Redactor.seed"
        status: pass
      - kind: unit
        ref: "test/unit/redactor.test.ts#Redactor.redact"
        status: pass
      - kind: unit
        ref: "test/unit/redactor.test.ts#redactLeaves"
        status: pass
    human_judgment: false
  - id: D4
    description: "A shell history line with a Bearer token or a seeded value is written redacted"
    requirement: SEC-3
    verification:
      - kind: unit
        ref: "test/unit/redactor.test.ts#the interactive shell history (SEC-3)"
        status: pass
      - kind: unit
        ref: "test/unit/shell.test.ts"
        status: pass
    human_judgment: false

duration: 60min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 07: Event and History Redaction Summary

**One process Redactor (secret patterns plus run-time seeded literals) now redacts every string leaf of event data before it is bounded and hashed, for both event writers, and redacts each shell history line before it is written.**

## Performance

- **Duration:** about 60 min (most of it waiting on the 22-minute full suite on a loaded machine)
- **Tasks:** 2
- **Files modified:** 8 (6 source and test files, 2 RED evidence records)

## Accomplishments

- `appendEventRow` redacts before `boundedEventJson`, so `data_json` holds `[REDACTED:<kind>]` and `row_hash` covers exactly what is stored. The hook calls the same function, so its rows are redacted and still continue the chain.
- `Redactor` applies `redactSecrets` and then each seeded literal as `[REDACTED:seeded]`. A literal under 8 characters is refused. Digests, run IDs and repository paths pass through unchanged.
- `appendHistory` passes each cleaned entry through `processRedactor`, so a pasted Bearer token or seeded credential never reaches the history file.
- The boundary lint accepted `src/adapters/redaction` as an adapter directory with no change to `scripts/check-boundaries.ts`.

## TDD record

- **Task 1 RED:** `test/integration/event-redaction.test.ts` against skeleton `Redactor` and `processRedactor` modules (planned names, identity behavior). All five tests failed on the planned assertion that the stored `data_json` holds `[REDACTED:<kind>]`. `RED_EVIDENCE_OK` (`04-07-red-task1.json`). Semantic assessment: the target ran and failed on the redaction assertion; no import, syntax or fixture fault. Commit `125c95c`.
- **Task 1 GREEN:** `816f548`.
- **Task 2 RED:** `test/unit/redactor.test.ts`. The Redactor unit cases passed at once because Task 1's GREEN implemented the Redactor; the two history tests failed on the planned assertion (the Bearer token and the seeded value were written as typed). `RED_EVIDENCE_OK` (`04-07-red-task2.json`). Commit `65fe562`.
- **Task 2 GREEN:** `a2d9f12`.
- No REFACTOR commit.

## Task Commits

1. **Task 1: tracer** - `125c95c` (test), `816f548` (feat)
2. **Task 2: Redactor unit cases and shell history** - `65fe562` (test), `a2d9f12` (feat)

## Files Created/Modified

- `src/domain/redactor.ts` - `Redactor`, `redactLeaves`, `MIN_SEEDED_SECRET_LENGTH`, `SEEDED_MARKER`
- `src/adapters/redaction/process-redactor.ts` - `processRedactor`, `seedProcessRedactor`
- `src/adapters/sqlite/events.ts` - `redactLeaves(ev.data, processRedactor)` before `boundedEventJson`
- `src/cli/shell/history.ts` - `processRedactor.redact` before the file write
- `test/integration/event-redaction.test.ts`, `test/unit/redactor.test.ts` - the tests

## Decisions Made

See `key-decisions`. No policy was invented beyond the plan. The choices that go slightly past it are mechanics: overlapping seeded literals merge into one marker, and `redactLeaves` leaves a non-plain object alone.

## Deviations from Plan

**1. [Plan wording] The hook test uses the events the hook can write, not a Read deny with a target**
- **Found during:** Task 1
- **Issue:** The behavior line names "a hook deny for a Read whose target path contains an AWS key ID". The PreToolUse `hook.decision` event carries the tool name, rule and IDs but no target; the only hook event with a path is the PostToolUse `tool.completed` for a write, which records the staging-relative target.
- **Fix:** Two hook tests cover the same boundary: a PreToolUse deny whose tool name carries a GitHub token (`rule: unknown-tool`), and a PostToolUse write whose file name holds an AWS key ID (`[REDACTED:aws-key]` in `target`).
- **Files modified:** test/integration/event-redaction.test.ts

**2. [Plan wording] `grep -n "redactLeaves" src/adapters/sqlite/events.ts` prints two lines, not one**
- The import and the single call site both name it. There is one call.

**3. [Rule 3 - process] RED commit includes skeleton modules**
- The seeded-literal test imports `seedProcessRedactor`, so the two new modules exist in the RED commit as skeletons with identity behavior, to keep the RED a failed assertion rather than a failed import.

**4. [Process] The plan commit ledger file was not written**
- The sandbox refused a write to the shared git directory, so `plan_head_before` was recorded from `git rev-parse HEAD` taken before the first commit. `commits: 4` is `git rev-list --count` over that base.

**Total deviations:** 4, none changing behavior or scope.

## Issues Encountered

None. The full suite (`npm test`) ran 4257 tests: 4186 pass, 0 fail, 71 skipped (skips are pre-existing). Typecheck and `check:boundaries` are clean.

## Known Stubs

None.

## Decisions needing owner review

None.

## Documentation surfaces (for plan 04-37)

`docs/system/` was not edited here; the phase documentation plan (04-37) owns it. The surfaces this plan changes:

- **Event redaction boundary:** every `events` row's `data_json` is redacted before it is bounded and hashed, by the ledger and by the PreToolUse hook; `row_hash` covers the stored text. Candidate home: `data-model.md` (events and the hash chain) and `containment.md` "Secret redaction", which today describes only transcripts and check output.
- **Shell history redaction:** `shell-history` entries are redacted after control characters are stripped. Candidates: `config-reference.md` (the shell history row) and the shell document.
- **Redaction kinds:** the existing kinds (`private-key`, `github-token`, `jwt`, `aws-key`, `authorization`, `url-userinfo`, `gsd-scan`) plus the new `seeded`.
- **Limits to record:** object keys are not redacted; a seeded literal under 8 characters is refused; the seed list is per process, so the hook child process (which starts empty) applies the patterns only, and plan 04-15 seeds the supervisor's redactor; the in-memory line editor history of a live shell still holds the typed text until the shell exits.

## Threat Flags

None. The new module adds no network, auth or file surface.

## Next Phase Readiness

- Plan 04-15 can call `seedProcessRedactor` when it resolves a credential, and plan 04-22's redaction suite can assert 0 secret patterns in events.
- Plan 04-18 owns the host transcript boundary.

## Self-Check: PASSED

- Files exist: `src/domain/redactor.ts`, `src/adapters/redaction/process-redactor.ts`, `test/unit/redactor.test.ts`, `test/integration/event-redaction.test.ts`, both RED records.
- Commits exist: `125c95c`, `816f548`, `65fe562`, `a2d9f12`.
- Acceptance: both RED records non-zero exit and `RED_EVIDENCE_OK`; no cli or app import in `process-redactor.ts` or `events.ts`; `processRedactor` appears in `history.ts`; typecheck and boundaries clean; four target test files green.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
