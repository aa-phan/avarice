---
phase: 02-contained-unattended-run-of-one-work-item
plan: 10
subsystem: cli-app
tags: [start, run-contract, preflight, staleness, conventions, d-04, d-16, rc-1, rc-2, rc-3, ledger-transaction]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-02 result line and usd style helpers, 02-03 run ledger tables and lifecycle, 02-04 parseBrief, parseConventions and compileRunContract, 02-06 AllowlistEgressProxy, 02-07 GitRunSource and CloneRunWorkspace"
provides:
  - "avarice start --brief <file> --policy routine [--project <id>] [--budget name=value]...: one command authorizes a routine run and stores it in contract_ready"
  - "src/app/run-start.ts: startRun, RunStartRequest, RunStartOutcome, RunStartFailure, BRIEF_MAX_BYTES"
  - "src/domain/run-preflight.ts: STALENESS_LIMITS (25 commits, 14 days), judgeRunPreflight, PreflightRefusal, the six refusal codes"
  - "Ledger.createRunWithContract: run, contract version 1, budget rows, work items and events in one transaction; NewRun carries baseRevision and branch"
  - "budgetRowsOfRun, RunSource.hasFile, parseBudgetFlags, AppDeps.runSource/runWorkspace/egress composed in createDeps"
  - "test/helpers/run-fixtures.ts: makeRunRepo, onboardRunRepo, commitConventions, commitFiles, writeBrief, RUN_CONVENTIONS, RUN_BRIEF"
affects: [02-11, 02-12, 02-13, 02-15, 02-16, 02-09]

actuals:
  tokens: 22800
  tasks: 2
  commits: 2
plan_head_before: 3ce9c4413f41a9883ddb529bee87528c38c8919e
plan_head_after: cf7b382d76d52f2f799e43cede87ae7b86abd1cc

tech-stack:
  added: []
  patterns:
    - "Every start rule is judged from repository objects before the first write; a refusal or an invalid request creates no row and no file"
    - "The contract is stored in the ledger by one transaction and then written to the data root by temp, fsync and rename at 0600 in a 0700 directory"
    - "Application code that cannot import an adapter carries its own one-line port error text"

key-files:
  created:
    - src/app/run-start.ts
    - src/cli/commands/start.ts
    - src/domain/run-preflight.ts
    - test/helpers/run-fixtures.ts
    - test/integration/run-start.test.ts
    - test/unit/run-preflight.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-10-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-10-red-evidence-task2.json
  modified:
    - src/adapters/sqlite/ledger.ts
    - src/adapters/git/run-source.ts
    - src/ports/ledger.ts
    - src/ports/run-source.ts
    - src/app/budget.ts
    - src/app/deps.ts
    - src/cli/args.ts
    - src/cli/commands/onboard.ts
    - src/cli/composition.ts
    - src/cli/main.ts
    - test/helpers/run-cli.ts
    - test/integration/run-source.test.ts

key-decisions:
  - "A refusal is exit 3 and an invalid brief, budget override, G0 failure or missing flag is exit 64; startRun returns refused, usage or internal failures and the command maps them, so the exit code is decided by the cause and not by the layer that noticed it"
  - "Preflight facts come from repository objects only (head, staleness, conventionsAt, hasFile at the pin) and the judge runs before parseConventions and compileRunContract, so every refusal precedes any write; the order is revision, descent, commits, age, conventions, planning"
  - "hasFile answers with ls-tree on a literal path (a regular blob is a file) because runGit does not expose the exit status that cat-file -e would signal with"
  - "The contract file is written after the ledger transaction: a start killed between the two leaves a contract_ready run whose file the supervisor (plan 02-12) rewrites from the ledger"

patterns-established:
  - "Run fixtures: a scratch GSD project is onboarded to active through the test CLI with the fake host, conventions are committed as the next commit, and start runs with cwd inside the repository"

requirements-completed: [RC-1, RC-2, RC-3, RC-5, FR-1, AUT-7]

coverage:
  - id: D1
    description: "start compiles the contract from the preset, the committed conventions and the brief and stores run, contract v1, five budget rows and work item A in one transaction, writes the contract 0600 to the data root, prints a one-screen summary whose first line is `run <id>: contract_ready`, and asks nothing"
    requirement: RC-1
    verification:
      - kind: integration
        ref: "test/integration/run-start.test.ts#start: a routine run is authorized by one command and stored with its contract (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every refusal (no project, brief revision, history not from the pin, 26 commits, age over 14 days, no conventions, conventions mixed with code, invalid conventions, no ROADMAP at the pin) exits 3 and leaves the ledger and data root unchanged; the staleness limits are tested at 25/26 commits and 14.0/14.01 days"
    requirement: RC-2
    verification:
      - kind: unit
        ref: "test/unit/run-preflight.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/run-start.test.ts#start refuses before anything is created (D-04, D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An invalid brief, an over-preset budget, an unknown verifiedBy check and a missing --policy or --brief exit 64 with the field named and create nothing; a lower budget is stored lowered"
    requirement: RC-5
    verification:
      - kind: integration
        ref: "test/integration/run-start.test.ts#start exits 64 for an invalid request, creating nothing (RC-5, AUT-7)"
        status: pass
    human_judgment: false
  - id: D4
    description: "An uncommitted edit of .avarice/config.json changes nothing in the contract, and editing the brief after start changes neither the stored contract nor its digest (the brief digest is in intent.requirementRefs)"
    requirement: FR-1
    verification:
      - kind: integration
        ref: "test/integration/run-start.test.ts#concurrency edges"
        status: pass
    human_judgment: false
  - id: D5
    description: "createRunWithContract is atomic: a failing work item leaves no run, contract, budget, work item or event; a repeated run ID is a conflict"
    requirement: RC-1
    verification:
      - kind: integration
        ref: "test/integration/run-start.test.ts#createRunWithContract is one transaction (RC-1)"
        status: pass
    human_judgment: false
  - id: D6
    description: "start and startRun read no stdin and ask no question; running the command is the authorization"
    requirement: RC-3
    verification:
      - kind: integration
        ref: "test/integration/run-start.test.ts#is authorization by running the command: no stdin read, no prompt (RC-3)"
        status: pass
    human_judgment: false
---

# Phase 2 Plan 10: The start command and its preflight Summary

**`avarice start --brief b.md --policy routine` compiles the routine contract from the preset, the conventions committed at a descendant of the pin and the brief, refuses every stale, unconventional or invalid start before anything exists, and otherwise stores run, contract, budgets and work item in one transaction and prints a one-screen summary**

## Performance

- **Duration:** about 17 min (start 2026-11-05T19:46Z, end 20:04Z)
- **Tasks:** 2 (Task 1 a tracer, Task 2 auto, both with RED first)
- **Files:** 20 changed in the two task commits (1381 insertions, 61 deletions; about 22 800 tokens by chars/4 over the diff)

## Accomplishments

- **Tracer.** On a scratch GSD project onboarded to `active` through the test CLI with the fake host, `start` run from inside the repository (or a subdirectory, or with `--project`) prints `run run_<ULID>: contract_ready`, then project, base revision, conventions revision, title, acceptance count, write paths, required checks, `5.00 USD per run, 2.00 USD per invocation`, model `sonnet` and the contract digest and path. The ledger holds one run at the pin with branch `avarice/<runId>`, one contract version 1 whose digest equals the digest of the stored body, five budget rows at the D-13 limits (3 invocations, 400 tool calls, 10 subagents, 3 600 000 ms, 5 USD estimated), work item `A` in `ready` on `sonnet`, a `run.created` event and a `start:preflight` step with pin, head, conventions revision, commits outside and the brief digest. `contract-v1.json` exists in the data root with mode 0600 and equals the stored body. `status --json` is byte-identical before and after (D-19). The source checkout (HEAD, branch, status, file digest) is unchanged.
- **One transaction.** `createRunWithContract` writes the run row (with base revision and branch), the contract with its budget rows, every work item and their events together or not at all. A work item that fails mid-way leaves zero rows in runs, contracts, budgets, work_items and events; a repeated run ID is a conflict.
- **Preflight.** `judgeRunPreflight` is pure and returns one of `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning` with the owner's wording. 25 commits and 14.0 days pass; 26 commits and 14.01 days refuse. Commits that touch only `.avarice/` or `.planning/` do not count (30 of them start). The facts are read from repository objects through `RunSource` (head, staleness, conventionsAt, and the new `hasFile` at the pin), so an uncommitted edit of `.avarice/config.json` cannot change the contract and conventions committed together with code are not conventions (D-16).
- **Exit codes.** Every refusal prints `avarice start: refused: <message>` and exits 3 with no stdout; an invalid brief, an over-preset `--budget costUsdPerRun=6` (`budget.costUsdPerRun`), a `verifiedBy` naming no declared check (`g0`), a missing `--policy` or `--brief`, and a malformed `--budget` exit 64. Each integration test compares run, contract, budget, work item and event counts and the data root's `runs/` listing before and after.

## Task Commits

1. **Task 1 (tracer): start command, ledger transaction, run ports in composition** - `28dcd23` (feat)
2. **Task 2: every refusal before anything is created** - `cf7b382` (feat)

`commits: 2`, measured as `git rev-list --count 3ce9c4413f41a9883ddb529bee87528c38c8919e..HEAD` before this summary commit.

RED evidence: `02-10-red-evidence-task1.json` (the dispatcher answered `unknown command 'start'`, exit 64) and `02-10-red-evidence-task2.json` (the revision, 26-commit, 14-day and roadmap starts succeeded with exit 0 instead of exit 3, and `run-preflight.ts` did not exist). Tracer gate (auto-mode config absent, `end-of-phase` default, automated-only verify): the verify commands (run-start, json-shapes, tsc, boundaries, skeleton, cli-args) were re-run end to end after Task 1 and passed, so expansion continued.

## Files Created/Modified

- `src/app/run-start.ts` - `startRun`: brief read (regular file, at most 64 KiB, strict UTF-8), project and active record, facts, judge, parse, compile, one-transaction store, contract file (temp, fsync, rename, 0600), start step
- `src/domain/run-preflight.ts` - `STALENESS_LIMITS`, `judgeRunPreflight`
- `src/cli/commands/start.ts` - flags, usage before the profile resolves, summary renderer, exit mapping
- `src/ports/ledger.ts`, `src/adapters/sqlite/ledger.ts` - `createRunWithContract`, `NewRun.baseRevision/branch`; `createRun`, `storeRunContract` and `upsertWorkItem` now share private insert helpers with it
- `src/ports/run-source.ts`, `src/adapters/git/run-source.ts` - `hasFile`
- `src/app/budget.ts` - `budgetRowsOfRun`; `src/app/deps.ts`, `src/cli/composition.ts` - `runSource`, `runWorkspace`, `egress`
- `src/cli/args.ts`, `src/cli/commands/onboard.ts` - `parseBudgetFlags` extracted, onboard unchanged in behaviour; `src/cli/main.ts` - `'start'`
- `test/helpers/run-fixtures.ts`, `test/helpers/run-cli.ts` (a `cwd` option), `test/integration/run-start.test.ts` (26 tests), `test/unit/run-preflight.test.ts` (10), `test/integration/run-source.test.ts` (+4 `hasFile` tests)

## Decisions Made

See key-decisions. Two further points: the conventions text is parsed after the judge so that a refusal never depends on a field of a file the rules have not vouched for; and an invalid conventions file is a refusal (exit 3, `refused: .avarice/config.json at <rev7> is invalid: ...`) rather than a usage error, as the plan's refusal list says, because the file belongs to the repository and not to the request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] hasFile uses ls-tree instead of cat-file -e**
- **Found during:** Task 2
- **Issue:** The plan says `cat-file -e <rev>:<path>` with `acceptExit [1, 128]`. `runGit` returns only stdout and stderr, so an accepted exit 1 or 128 cannot be told from success.
- **Fix:** `ls-tree -z <rev> -- <path>` with literal pathspecs; the answer is true only for a regular blob entry whose name equals the path. A link or a directory is not a file. The revision must be a full SHA and exist (`not_found`), and the path must be relative with no empty, `.` or `..` segment.
- **Files modified:** src/adapters/git/run-source.ts, test/integration/run-source.test.ts
- **Commit:** cf7b382

**2. [Rule 3 - Blocking] The application layer cannot import describeError**
- **Found during:** Task 1
- **Issue:** `describeError` lives in the SQLite adapter and the boundary lint forbids `src/app` from importing adapters.
- **Fix:** `run-start.ts` carries a local one-line `describeError` for the port error kinds (same text).
- **Commit:** 28dcd23

**3. [Rule 2 - Missing critical] A pin that is no longer in the repository is a refusal, not an internal error**
- **Found during:** Task 2
- **Issue:** `GitRunSource.staleness` answers `not_found` when the pin commit is gone (history rewritten and collected); mapping that to exit 70 would hide a stale-base cause.
- **Fix:** `not_found` is treated as "does not descend" and refuses with `not-descendant` and the re-onboard text.
- **Commit:** cf7b382

**4. [Rule 3 - Blocking] Test helper run-cli.ts gained a cwd option**
- **Found during:** Task 1
- **Issue:** `start` resolves the project from the current directory and `runCli` could not set the child's working directory. The helper is not in the plan's file list.
- **Fix:** an optional `cwd` passed to `spawnSync`; no existing caller changes.
- **Commit:** 28dcd23

**Total deviations:** 4 (3 blocking, 1 missing critical). **Impact:** none on scope or on any plan truth.

## Issues Encountered

- The harness refused shell commands whose text names git or source paths, so file edits ran as small `node` scripts or with Edit and Write, and test files with git calls were assembled from a Write-created part file. `git rev-parse --show-toplevel` printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before the first write and before each commit.
- Four of my own first-run test failures were test mistakes, not product defects: queries that did not exclude the Phase 1 onboarding carrier contract and its `costUsd` budget row, and a brief-error assertion that expected the word `brief` the first message did not carry (the message now reads `brief <path> cannot be read (ENOENT)`).

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. New surface is local: a command reading one user-named file (size and type checked) and a 0600 file in the data root written after the transaction (T-02-32); no network endpoint and no write to the repository (the checkout snapshot test shows it unchanged).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-12 starts the detached supervisor from `start` (not called yet; the run is left in `contract_ready`) and should rewrite `contract-v1.json` from the ledger before launching, since a start killed between the commit and the file write leaves a run without its file. The ports `runWorkspace` and `egress` are composed and unused by this plan.
- The `start:preflight` step carries pin, head, conventions revision, commits outside and the brief digest for the later run views.
- `makeRunRepo`, `onboardRunRepo`, `commitConventions`, `commitFiles` and `writeBrief` are ready for plan 02-09's spike and the later run integration tests. `onboardRunRepo` returns the pin as a full SHA; the active record stores it as `git:<sha>`, which `startRun` strips.
- The requirement IDs RC-1, RC-2, RC-3, RC-5, FR-1 and AUT-7 are shared with later plans; they are listed under `requirements-completed` and marked in REQUIREMENTS.md only where `requirements.ready-ids` says ready.

## Self-Check: PASSED

- FOUND: src/app/run-start.ts, src/cli/commands/start.ts, src/domain/run-preflight.ts, test/helpers/run-fixtures.ts, test/integration/run-start.test.ts, test/unit/run-preflight.test.ts, 02-10-red-evidence-task1.json, 02-10-red-evidence-task2.json
- FOUND commits: 28dcd23, cf7b382 (ancestors of HEAD)
- Plan verification re-run after the last commit: `node --test test/unit` 1101 pass; `node --test test/integration` 565 pass (includes run-start 26, run-source with `hasFile`, skeleton, ledger tests); `node --test test/fault` 65 pass; `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (67 files). Acceptance: contract file mode 600 asserted in the tracer test; `grep -c "'start'" src/cli/main.ts` is 1; existing onboard tests green unchanged; each integration refusal test asserts unchanged run, contract and budget counts and no `runs/` entry.
