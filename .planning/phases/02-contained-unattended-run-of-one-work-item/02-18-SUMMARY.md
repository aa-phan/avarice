---
phase: 02-contained-unattended-run-of-one-work-item
plan: 18
subsystem: containment-docs
tags: [containment, spike, seatbelt, git, documentation, matrix-test]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "plans 02-08, 02-11, 02-13, 02-14 and 02-16 (run scope, read-before-edit and loop limits, supervisor gates, check validation and install, outcome routing) and their tests, which the matrix rows name"
provides:
  - "Spike S2-D: the measured minimal write set under a clone's .git for an in-sandbox git commit; host limitation 8 resolved, D-03 unchanged"
  - "docs/containment.md run-purpose matrix rows with tests, the D-11 supervisor-step exception, the ONB-10 detection limit, the in-repo Seatbelt executor in place of the sandbox-runtime proposal"
  - "test/unit/containment-matrix.test.ts: a parser and checker that keep the coverage matrix honest (CON-1)"
  - "docs/contracts-and-state.md: G4 per D-12, AUT-8 pre-existing flag, conventions schema 1, routine preset values"
  - "docs/extensions.md 2b applied GSD settings and the Phase 2 command and exit-code table; ADR-006 Phase 2 implementation note"
affects: [02-20, 02-22, final-documentation-pass]

actuals:
  tokens: 19500
  tasks: 2
  commits: 2
plan_head_before: 45fe81247f864ceae5af4f0f79d64a8893d7e97e
plan_head_after: 748d2ac244d1fcc71fce5f036379801d385d513d

tech-stack:
  added: []
  patterns:
    - "A documentation table checked by a test: parse the markdown, assert structure, and resolve named files against git ls-files by exact match"
    - "Measure a minimal permission set by dropping each entry in turn and asserting the operation fails"

key-files:
  created:
    - test/containment/sandbox-commit.test.ts
    - test/unit/containment-matrix.test.ts
    - spikes/phase-2-wave-0/S2-D-sandbox-commit.md
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-18-red-evidence-task1.json
  modified:
    - docs/containment.md
    - docs/contracts-and-state.md
    - docs/extensions.md
    - docs/decisions/ADR-006-unattended-delegation.md

key-decisions:
  - "Host limitation 8 is resolved by measurement, not by adopting in-sandbox commits: the supervisor commits (D-03) and no agent gets any of the eight .git entries"
  - "The matrix test requires five non-empty cells, P, D, R labels in that order and exact-match tracked test files, but does not require a test path in every row: older Phase 1 rows without a named file still pass and are listed below as drift"

patterns-established:
  - "Every run-purpose control gets a matrix row with its mechanism labelled P, D or R and the tracked tests that prove it; a control that is detect-only says so in its Strength line"

requirements-completed: [CON-1, CON-2, CON-5, CON-6, ONB-10]

duration: 27 min
completed: 2026-11-06
status: complete

coverage:
  - id: D1
    description: "S2-D records the minimal sandboxed-commit write set, shows that objects plus the run ref fail, and limitation 8 is marked resolved with the D-03 statement"
    requirement: "CON-6"
    verification:
      - kind: integration
        ref: "test/containment/sandbox-commit.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/containment.md carries ten run-purpose matrix rows (P, D and R labelled, covered paths, limitations, tracked tests), the D-11 exception and the ONB-10 detection limit"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/containment-matrix.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A unit test parses the matrix and fails on an empty cell, an untracked or prefix-only test path, a mechanism without ordered labels, with the adjacency, empty, encoding and ordering edges on synthetic tables"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/containment-matrix.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "contracts-and-state.md G4 row and AUT-8 note follow D-12, with the schema 1 conventions and routine preset values; extensions.md 2b and the command table; ADR-006 Phase 2 note"
    requirement: "CON-2"
    verification:
      - kind: other
        ref: "grep -c D-12 docs/contracts-and-state.md (2); grep -c registryHosts docs/contracts-and-state.md (1)"
        status: pass
    human_judgment: true
    rationale: "Whether the prose describes the code accurately is a reading judgment; the test checks only the containment matrix"
---

# Phase 2 Plan 18: Spike S2-D, run-purpose containment matrix and spec amendments Summary

**Spike S2-D measured that a sandboxed `git commit` needs eight writable entries under `.git` (limitation 8 resolved, supervisor commit unchanged), ten run-purpose rows with tracked tests joined the containment matrix, and a unit test now fails when a matrix row is incomplete or names an untracked test.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-11-06T07:48:00Z (approximate; not recorded at start)
- **Completed:** 2026-11-06T08:30:00Z
- **Tasks:** 2
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- S2-D, run with AVARICE's own `SandboxedExecutor` and no model (no spend; the ledger stays at 1.2155 of 25 USD): a commit with only `objects` and `refs/heads/avarice` writable fails on the index lock; the minimal set that passes is `objects`, `refs/heads/avarice`, `logs/HEAD`, `logs/refs/heads/avarice`, `index`, `index.lock`, `COMMIT_EDITMSG` and `HEAD.lock`. The test drops each entry in turn and the commit fails every time, and under the set `hooks/`, `config`, `info/exclude`, `refs/heads/main` and a new ref outside `avarice/` stay unwritable. `git add` needs only `objects`, `index` and `index.lock`. Record: `spikes/phase-2-wave-0/S2-D-sandbox-commit.md` (`Limitation 8: resolved`).
- `docs/containment.md`: limitation 8 marked resolved with the D-03 statement; ten new matrix rows (glob write set and protected paths, loop limits, command identity with contract commands, no human prompts, no background shell, no network for invocations, supervisor-step registry exception, ONB-10 validation, supervisor commit and hand-off), `read-before-edit` named in the existing stale-edit row, and test files named for the existing "tests not weakened" row; "Checks and probes run sandboxed" now describes the in-repo Seatbelt executor and the loopback-only egress proxy, states the D-11 exception and the ONB-10 detection limit.
- `test/unit/containment-matrix.test.ts`: 13 tests. The parser handles escaped pipes, the checker reports empty cells, wrong cell counts, mechanisms without a label or with labels out of P, D, R order, and named `test/...` files that are not an exact match in `git ls-files` (a `.test.tsx` for a `.test.ts` is missing). It also asserts the ten run-purpose rows exist and that limitation 8 is resolved with the spike link.
- `docs/contracts-and-state.md`: G4 row amended to the D-12 baseline rule with a dated note, the pre-existing flag recorded as a `failed` row with `environment.preExisting` (AUT-8), a "Repository conventions, schema 1" subsection (checks with env and writes, paths, testInventory, dependencies with registryHosts, agentCommands, reserved env keys and refused command words), and "The routine preset in Phase 2" with every value and derivation.
- `docs/extensions.md`: 2b lists the seven `RUN_GSD_SETTINGS` pairs exactly as in `src/app/run-gsd-config.ts`, with the two keys not applied; section 1 gains the `start`, `supervise`, `resume`, `inbox` and `install-host` table with exit codes. ADR-006 gains a dated Phase 2 implementation note.

## Task Commits

1. **Task 1: Tracer, S2-D spike, matrix rows and matrix test** - `7188cbf` (docs; tests, spike record, containment.md, RED evidence)
2. **Task 2: contracts-and-state, extensions, ADR-006** - `748d2ac` (docs)

**Plan metadata:** the commit of this SUMMARY with STATE.md and ROADMAP.md follows.

## Files Created/Modified

- `test/containment/sandbox-commit.test.ts` - S2-D measurement, 12 tests, skipped without `/usr/bin/sandbox-exec`
- `test/unit/containment-matrix.test.ts` - matrix parser and checker, synthetic and real-document tests
- `spikes/phase-2-wave-0/S2-D-sandbox-commit.md` - the record
- `docs/containment.md`, `docs/contracts-and-state.md`, `docs/extensions.md`, `docs/decisions/ADR-006-unattended-delegation.md` - amendments described above
- `.planning/phases/02-contained-unattended-run-of-one-work-item/02-18-red-evidence-task1.json` - RED run of the matrix test at the plan base (3 of 13 failing)

## Decisions Made

- The S2-D test measures with AVARICE's executor, not Claude Code's sandbox, and says so in the record: both use Seatbelt, but the host's protected-path handling of `.git` was not exercised because nothing depends on it.
- The matrix test requires a tracked test path only for what a row names, and asserts the presence of the ten run-purpose rows by pattern. Requiring a path in every row would fail six Phase 1 rows (listed under doc drift), which are outside this plan's amendments.
- The new matrix rows name `test/fault/run-killpoints.test.ts` and `test/fault/run-discard-retry.test.ts`. The plan said plan 02-20 adds the kill-point suite to the rows; plan 02-17 had already committed it, so it is named now (no conflict with 02-20, which may add the live-tier file).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing matrix row had no P, D or R label**
- **Found during:** Task 1 (RED run of the matrix test)
- **Issue:** the row "Tests and acceptance criteria not weakened" stated its mechanism as "D and P at the gate", which the new label rule rejects (and which listed D before P).
- **Fix:** rewrote the mechanism as `P: ...; D: ...` and named the tracked tests that prove it (`test/integration/run-gates.test.ts`, `test/unit/test-inventory.test.ts`).
- **Files modified:** docs/containment.md
- **Committed in:** 7188cbf

**2. [Rule 1 - Bug] Containment prose contradicted D-03 and the new row**
- **Found during:** Task 2
- **Issue:** the generated-settings paragraph still said unresolved item 8 decides whether commits work, and the example JSON still allowed `git add` and `git commit` and a git-directory `allowWrite`.
- **Fix:** the paragraph now says the supervisor commits, that eight entries would be needed (item 8) and that the example JSON predates the decision; the JSON itself is left as the labelled proposal.
- **Files modified:** docs/containment.md
- **Committed in:** 7188cbf, 748d2ac

**3. [Rule 3 - Blocking] Typecheck error in the new test**
- **Found during:** Task 1
- **Issue:** `NodeJS.ProcessEnv` is not assignable to the executor's `Record<string, string>` env.
- **Fix:** `gitEnv` returns `Record<string, string>`.
- **Committed in:** 7188cbf

---

**Total deviations:** 3 auto-fixed (2 bugs in docs, 1 blocking type error). **Impact:** none on scope; all in files the plan names.

## Issues Encountered

- The full suite (`npm test`) reported one failure, `test/mutation/fail-closed.test.ts` "does not cache a probe that timed out twice (WR-07)", the known load-sensitive flake from the executor brief. The file alone passes (35 of 35). No test was edited.
- The plan's expectation that the first attempt (objects and the run ref) would be near enough was wrong: the index lock, `COMMIT_EDITMSG`, the reflogs and `HEAD.lock` are all needed. This does not matter for the design.
- The plan asked that the `docs/extensions.md` section 1 output paragraph stop saying status, init and repo depart from the OPS-7 table; it already said they follow the table (updated by earlier plans), so only the command table was added.

## Known Stubs

None.

## Threat Flags

None. T-02-59 mitigated (matrix test requires tracked test files; detect-only stated where it applies: new unlisted clone entries, a question written as text, an ONB-10 network attempt a check hides). T-02-60: S2-D is documentation only and no runtime change was made; agents keep `.git` in `denyWrite`.

## Doc drift for the final documentation pass (not edited here)

- `docs/containment.md` line 3 still says "Status: proposal. Nothing described in this document is built yet".
- The matrix row "Pre-existing user changes survive" still describes a "dedicated worktree"; D-01 made it a local clone, and `status` of that claim is covered only by the new hand-off row. Six older rows name no `test/...` file at all (Only contract endpoints reachable, No privileged external effects, Run cannot change its policy, Budget limits, Retrieval scope and cost, Pre-existing user changes survive), so the matrix test passes them vacuously.
- `docs/containment.md` "Generated host settings" example JSON: git allow rules, the git-directory `allowWrite` entry and `<worktree>` placeholders predate D-01 and D-03 (a sentence after the JSON now says so; the JSON is unchanged).
- `docs/contracts-and-state.md` example contract: `execution.commands` lists `git add` and `git commit` (the compiler refuses commands starting with `git`), `workspace.worktree`, `delivery.pushBranch: true`, `budgets` and `retrieval` values differ from the routine preset; the preset table and persisted-entities sections were not re-read against the Phase 2 migrations.
- `docs/extensions.md` section 1 exit-code table lists 0, 1, 2, 64, 69, 70 and does not mention 3, which `onboard`, `resume`, `start`, `supervise` and `install-host` use (the new command table explains 3 for those commands only); section 2 "PreToolUse checks" ("deny `run_in_background` until the containment suite confirms") and section 3 (skill `avarice-run`) were not reread against what Phase 2 built.

## Next Phase Readiness

Plan 02-20 can add the live-tier test file to the matrix rows (the checker will reject a name that is not tracked). Plan 02-19 and later plans that add matrix rows must give every cell, label the mechanism P, D, R in order and name only tracked test files, or `test/unit/containment-matrix.test.ts` fails.

## Self-Check: PASSED

- Created files exist: `test/containment/sandbox-commit.test.ts`, `test/unit/containment-matrix.test.ts`, `spikes/phase-2-wave-0/S2-D-sandbox-commit.md`, `02-18-red-evidence-task1.json` (all FOUND).
- Commits are ancestors of HEAD: `7188cbf`, `748d2ac` (FOUND).
- `node --test "test/containment/sandbox-commit.test.ts" "test/unit/containment-matrix.test.ts"`: 25 pass, 0 fail. `npm run typecheck` clean. `test/unit/footprint.test.ts` and `test/unit/boundaries.test.ts`: 37 pass, 0 fail.
- Task 2 greps: `D-12` in contracts-and-state.md 2 matches, `registryHosts` 1 match.
- Full suite: one failure, `test/mutation/fail-closed.test.ts` WR-07 (known load flake); the file alone passes 35 of 35.
- Acceptance: S2-D file has `Limitation 8: resolved`; the G4 row cites D-12 and pre-existing failures; extensions 2b lists all seven `RUN_GSD_SETTINGS` pairs; "Checks and probes run sandboxed" names the egress proxy and no longer calls the sandbox runtime a proposal of this plan.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-06*
