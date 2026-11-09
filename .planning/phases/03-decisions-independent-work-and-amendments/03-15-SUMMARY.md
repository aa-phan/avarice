---
phase: 03-decisions-independent-work-and-amendments
plan: 15
subsystem: cli
status: complete
tags: [amendment, contract, identity, process-ancestry, shell, cs-11]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-10 (applyAmendment, staleTargets, budgetRowChanges), plan 03-12 (amendRunContract, one lease-free transaction)
provides:
  - "`avarice contract amend <run> --reason <text>` with --budget, --add-write, --acceptance-file [--item], --check, --decision: prints the field diff and the invalidation, confirms on the terminal, records contract version n+1 owned by `owner:<os user>`"
  - "planAmendment and commitAmendment in src/app/amend.ts: read-only plan, then one ledger transaction and the contract file"
  - "the responder identity helper (refuseOutsideTerminal, responderName, ownsProfile) that decide, cancel and schedule reuse"
  - "the process-ancestry adapter (processAncestry, inRunProcessTree, cutCommand) and the `ancestry` test seam of main()"
  - "CommandModule.usage(args, env, context) and Io.ask / MainOverrides.ask: a command's question goes to whoever supplied the io (the shell's prompt, a test, or standard input)"
affects: [03-16, 03-24, 03-31, the documentation plan]

requirements-completed: []

actuals:
  tokens: 23000
  tasks: 3
  commits: 6
plan_head_before: 17cd219058931d56574db32d8d2d17f3632a8e27
plan_head_after: 3d5bb441a6d2caa5aef4cf4cdc3ddebd68c80694
commits: 6

tech-stack:
  added: []
  patterns:
    - "A command that must not run inside a run checks AVARICE_RUN, the terminal and the process ancestry in usage(), before the profile is resolved, so a refusal creates no data root, no store and no row"
    - "A test-only seam is named only in main.ts and defaults to the real reader; a footprint pin scans src/ and bin/ for any other mention (the `ancestry` override, as the proxy resolver is pinned)"
    - "Plan, then ask, then commit: planAmendment changes nothing, the command shows it and asks, commitAmendment writes it with expectVersion so a racing amendment is a conflict"

key-files:
  created:
    - src/adapters/proc/ancestry.ts
    - src/cli/identity.ts
    - src/app/amend.ts
    - src/cli/commands/contract.ts
    - test/unit/identity.test.ts
    - test/integration/contract-amend.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-15-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-15-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-15-red-evidence-task3.json
  modified:
    - src/cli/main.ts
    - src/cli/args.ts
    - src/cli/shell/shell.ts
    - src/app/run-start.ts
    - test/unit/footprint.test.ts
    - test/unit/shell.test.ts
    - test/integration/shell-tty.test.ts

key-decisions:
  - "The refusals for AVARICE_RUN, a non-terminal and the run's process tree return exit 64 from usage(), the same exit as a bad flag, so the profile is never resolved and nothing is written (CS-11, the install-host pattern)"
  - "inRunProcessTree reads every entry of the chain including the amend process itself; the supervisor signature is ` supervise run_<id>` (a space before supervise), and a chain that cannot be read counts as inside the tree"
  - "cutCommand keeps the first 150 and the last 245 characters of a command line over 400 characters, joined by ` ... `, so the supervisor signature at the end of a long line survives the cut (the plan said only `cut to 400 characters`)"
  - "Declining prints `not amended` and exits 0; a terminal run, a moved contract version and a decision that is no longer open exit 3; an unknown run, an unknown decision, a decision of another run or of a class an amendment cannot answer exit 64"
  - "The conventions write set for --add-write is read from git objects at contract.workspace.conventionsRevision through RunSource.conventionsAt(repo, baseRevision, conventionsRevision); a budget, check or acceptance amendment does not read the repository"
  - "The shell passes its own prompt as the command's ask, shows what the command printed so far above the question, and in line mode prints that text once before the question"
  - "ownsProfile is exported and unit-tested but amend does not call it: the plan lists it for decide, cancel and schedule"

patterns-established:
  - "Command usage() takes (args, env, context) with TerminalFacts and a lazy ancestry reader; a command that needs no refusal ignores the third argument"

coverage:
  - id: D1
    description: "A budget raise on a blocked_on_decision run, confirmed with y at a terminal, prints `budgets.costUsd.perRun: 10 -> 12`, `invalidates: nothing` and `contract v2 recorded`, stores version 2 with authorized_by `owner:<os user>`, the reason and the diff, raises the costUsd limit to 12 with used and reserved unchanged, and writes contract-v2.json 0600 with the canonical body; n or no answer prints `not amended` and writes nothing"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/contract-amend.test.ts#contract amend: a budget raise confirmed at a terminal becomes contract version 2 (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Under AVARICE_RUN, without a terminal on stdin or stdout, from an ancestor carrying `supervise run_<id>` and when the process table cannot be read, the command exits 64 naming the reason and leaves no data root, no store file and no row, and asks nothing"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/contract-amend.test.ts#contract amend: refused inside a run, off a terminal and from a run process tree (CS-11)"
        status: pass
      - kind: unit
        ref: "test/unit/identity.test.ts#refuseOutsideTerminal (CS-11, D-18), #inRunProcessTree (CS-11), #cutCommand, #processAncestry (CS-11)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only main.ts names the `ancestry` override of MainOverrides and it defaults to the real process walk, so no production path can supply a chain"
    requirement: "RC-6"
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts#the ancestry seam stays out of production"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each D-20 class is asserted end to end on the ledger: --add-write stales G2 and G4 (and status shows the latest G4 as not passed), --check stales every check evidence row, an acceptance change stales every passed gate and the evidence mapped to a criterion, a budget change invalidates nothing; a new criterion on a three-item run needs --item"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/contract-amend.test.ts#contract amend --add-write, #contract amend --check, #contract amend --acceptance-file"
        status: pass
    human_judgment: false
  - id: D5
    description: "--decision answers an open scope_expansion decision `amended:v2` by `owner:<user>` on channel terminal and releases its item; an acceptance-class decision, an unknown one and one of another run exit 64 and write nothing; an answered one exits 3"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/contract-amend.test.ts#contract amend --decision: one amendment answers the decision it resolves (D-17)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Spend carries over a raise; a second amendment committed between the first's plan and its confirmation makes the first exit 3 with nothing written; a cancelled run exits 3 without asking; invalid budgets, flags, a missing reason and a no-op exit 64 naming the field"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/contract-amend.test.ts#contract amend: budgets carry spend over, conflicts and ended runs exit 3, invalid input exits 64 (D-19, T-03-28)"
        status: pass
    human_judgment: false
  - id: D7
    description: "In the interactive shell, `contract amend ...` typed at the command line shows the diff and asks the confirmation through the shell's own prompt (full screen, line mode, on a driven pseudo-terminal); y records version 2, n records nothing; the menu has no amend action"
    requirement: "RC-6"
    verification:
      - kind: integration
        ref: "test/integration/shell-tty.test.ts#contract amend from the command line of the shell on a driven terminal"
        status: pass
      - kind: unit
        ref: "test/unit/shell.test.ts#a command that asks a question uses the shell prompt"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 15: `avarice contract amend` and the responder identity rule Summary

**`avarice contract amend` lets a person at a terminal outside the run raise a budget, widen the write set, change required checks or acceptance criteria and answer the decision that asked for it, as recorded contract version n+1 with the owner, the reason and the diff; the run itself is refused three ways before the profile is resolved.**

## Performance

- **Tasks:** 3 (a tracer, the identity rule and ancestry adapter, then every flag and the shell path), each RED then GREEN
- **Files:** 16 changed (4 source files created, 4 source files modified, 3 test files created or extended in 4 places, 3 RED records)
- **Duration:** about 32 minutes (the start time was not captured at the start; estimated from the previous plan's last commit at 05:01Z and this summary at 05:34Z), plus one 7-minute full suite
- **Completed:** 2026-11-09

## Accomplishments

- **Command.** `contract amend <runId> --reason <text>` with repeatable `--budget name=value`, `--add-write glob`, `--check +name|-name`, one `--acceptance-file file` with optional `--item id`, and `--decision dec_...`. It prints the run line, one line per field (`path: from -> to`, or `path: +added -removed` for lists), `invalidates: <classes>|nothing`, `stale gates:` and `stale evidence:` when there are any, and `answers decision ...` when one is named; then asks `apply contract v<n+1>? [y/N] `. On yes it prints `contract v<n+1> recorded`, how many stale rows were appended and the decision answered.
- **One transaction, then the file.** `commitAmendment` calls `amendRunContract` with `expectVersion` the plan's base version (contract, raised limits, stale evidence and gate rows, decision), then writes `runs/<runId>/contract-v<n+1>.json` (0600, temp file and rename, canonical body). A budget raise leaves `used` and `reserved` alone (D-19).
- **Refusal before the profile.** `usage(args, env, context)` runs `refuseOutsideTerminal`: AVARICE_RUN set, then stdin or stdout not a terminal, then an ancestor command line containing ` supervise run_<id>` or a process table that cannot be read. Each exits 64 and creates no data root, config home, store, row or file (tested on never-created roots).
- **Process ancestry.** `processAncestry(pid)` walks `/bin/ps -ww -o ppid=,command= -p <pid>` with `execFileSync` argv, a 5 second limit and no detached child, up to 64 hops to pid 1; `cutCommand` keeps the start and the end of a long command line so the supervisor signature survives.
- **Shell.** The shell runs the command in its own process and now passes `ask`, built on its prompt. The diff stays on screen above the question; in line mode it is printed once before it.
- **Identity helper.** `responderName()` (OS user, control characters stripped, `unknown` when absent) and `ownsProfile(dataRoot)` for decide, cancel and schedule.

## TDD gate

- RED task 1 (`10734d3`): 2 tests, both failed on the exit code (`unknown command 'contract'`, 64 !== 0); `RED_EVIDENCE_OK`. GREEN `9574e9c`; the tracer gate (task 1 verify) passed before task 2 began.
- RED task 2 (`996c4d2`): 45 tests across three files, 18 failed on assertions against typed stubs, 27 passed; `RED_EVIDENCE_OK`. GREEN `5088f50`.
- RED task 3 (`5cb0e4e`): 80 tests across three files, 10 failed (the add-write, check, acceptance, decision, shell unit and pty tests), 70 passed; `RED_EVIDENCE_OK`. The passing tests exercise behavior the tracer already had (exit 3 and 64 paths, budget carry-over); semantic assessment is in each record. GREEN `3d5bb44`: 80 of 80.
- Task 1's command refused the flags of task 3 as `--<flag> is not supported yet`, so the task 3 tests failed for a real reason; task 3 removed that.

## Task Commits

1. **Task 1: tracer, a budget raise confirmed at a terminal** - `10734d3` (test, RED), `9574e9c` (feat, GREEN)
2. **Task 2: identity rule and process-ancestry adapter** - `996c4d2` (test, RED), `5088f50` (feat, GREEN)
3. **Task 3: every flag, decision resolution, conflicts, shell prompt** - `5cb0e4e` (test, RED), `3d5bb44` (feat, GREEN)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `describeError` exported from `src/app/run-start.ts`**
- **Found during:** Task 3
- **Issue:** `planAmendment` (app layer) needs the one-line text of a port error for the conventions read, and the adapters' `describeError` is out of reach of `src/app` (check-boundaries).
- **Fix:** exported the existing private copy in run-start.ts; the command uses it too.
- **Files modified:** src/app/run-start.ts
- **Commit:** 3d5bb44

### Judgment calls inside the plan's room

**2. `cutCommand` keeps head and tail.** The plan said command lines are cut to 400 characters; a plain prefix could drop the supervisor signature, which is at the end of the line, and a wrapper shell's command line can run past 400 characters. The cut keeps the first 150 and last 245 characters.

**3. Task 1 stages the flags.** The tracer command accepts `--budget` and `--reason` and refuses the other flags as not supported yet, so the later tests fail honestly; task 3 completes the grammar.

**4. `Io.ask` and the default.** The plan said `MainOverrides.ask` is passed to the command as `Io.ask`; the default (no `ask`) reads one line from `process.stdin` inside the command. The shell also puts `ask` into the overrides it hands the dispatcher, because main() reads it from there.

**5. The tests' conventions.** The integration file commits conventions with two required checks (`test`, `lint`) and a wider write set (`tests/**`, `docs/**`), so `--check -test` and `--add-write tests/unit/extra.test.ts` have something to act on, as the plan's behaviors need.

**6. Own command line.** The ancestry walk starts at the amend process itself, so a `--reason` that contains ` supervise run_` is refused as inside a run's tree. This fails closed and is recorded here rather than special-cased.

**Total deviations:** 1 Rule 3, 5 judgment calls. **Impact:** none on scope.

## Issues Encountered

- Full `npm test`: 3180 tests, 3120 pass, 0 fail, 60 skipped (the earlier plan's load-sensitive supervisor test passed this time). `npx tsc -p .` and `node scripts/check-boundaries.ts` (89 files) are clean.
- `RC-6` is left unmarked in REQUIREMENTS.md: `requirements.ready-ids` reports 0 of 1 ready, because other plans declare it. The coverage report still lists RC-6 as `unclassified`, as the plan's flagged assumption says; the owner reviews the flag grammar.
- Not exercised here: a live contained `claude` session running the command (the hook's deny of the avarice prefix is the first layer in the threat register and is not part of this plan); the three refusal layers are tested with a scripted chain and a real `ps` walk of the test process, and the supervisor signature against a real supervisor process is not exercised.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The command spawns `/bin/ps` (argv, no shell, 5 second limit), which T-03-26 names as the process-tree layer. T-03-26: the three layers are tested (AVARICE_RUN, no terminal, supervisor ancestor, unreadable table fails closed). T-03-27: the footprint pin passes. T-03-28: a racing amendment and a cancelled run exit 3 with nothing written (tested). T-03-SC: no package installs.

## Documentation surfaces (for plan 03-31)

Written into `docs/system/` by the documentation plan, from the code:

- **Command:** `avarice contract amend <runId> --reason <text>` (reason required, at most 500 characters after trimming). Flags: `--budget name=value` (repeatable; the seven budget names; up or down, finite above 0, whole numbers for counts), `--add-write glob` (repeatable; inside the conventions write set at the contract's conventions revision and off protected globs; added to `files.write` and `files.create`), `--check +name` / `--check -name` (repeatable; declared checks only; at least one required check stays), `--acceptance-file file` (UTF-8, at most 64 KiB, the brief's `- AC<n>: text | verifiedBy: refs` lines; an existing ID changes text or references, a new ID joins `--item`, required when the run has more than one item), `--decision dec_...` (an open repeated_failure, permission, budget or scope_expansion decision of the same run).
- **Output lines:** `run <id>: amending contract v<n> to v<n+1>`; per field `path: from -> to` or `path: +added -removed`; `invalidates: <classes, comma separated>|nothing`; `stale gates: ...`; `stale evidence: ...`; `answers decision <id> as amended:v<n+1>`; the question `apply contract v<n+1>? [y/N] ` (y or yes, any case, applies); `not amended`; `contract v<n+1> recorded`; `appended N stale evidence row(s) and M stale gate row(s)`; `decision <id> answered amended:v<n+1>`.
- **Exit codes:** 0 amended or declined; 3 the run has ended, the contract version moved, or the decision is no longer open (nothing written); 64 a refusal, a usage error, an invalid flag, an unknown run or decision; 70 an internal failure (including a contract file that could not be written after the amendment was recorded; the supervisor rewrites it).
- **Identity rule:** refused, in this order, with AVARICE_RUN set (`refused inside a run (AVARICE_RUN is set)`), without a terminal on both standard input and output (`needs an interactive terminal`), from a process whose ancestors include a command line containing ` supervise run_<id>` or when the process table cannot be read (`refused from inside a run's process tree`); all before the profile is resolved. `authorized_by` is `owner:<os user>`. The shell runs the command in its own process; there is no menu action.
- **Stored:** contract version n+1 with `diff_json`, `reason`, `authorized_by`; budget limits and their contract version; appended stale evidence rows (status `stale`) and failed `stale-after-amendment` gate rows; `contract-v<n+1>.json` in `runs/<runId>/` (0600); the `decision.answered` record `amended:v<n+1>`.
- **Findings to revisit:** any `docs/system/` line saying only `storeRunContract` writes contracts, or that a limit never rises, needs the amendment path (also noted by plan 03-12).

## Next Phase Readiness

`decide`, `cancel` and `schedule` can call `refuseOutsideTerminal` from their `usage()`, `responderName()` for the recorded responder and `ownsProfile()` for the profile check, and ask through `Io.ask`. The shell now relays a command's question to its own prompt for any command.

## Self-Check: PASSED

- Created files exist: src/adapters/proc/ancestry.ts, src/cli/identity.ts, src/app/amend.ts, src/cli/commands/contract.ts, test/unit/identity.test.ts, test/integration/contract-amend.test.ts, the three RED records
- Commits 10734d3, 9574e9c, 996c4d2, 5088f50, 5cb0e4e, 3d5bb44 are on the branch
- `grep -n "'contract'" src/cli/main.ts` prints the COMMANDS line
- The plan's verify commands pass: contract-amend, shell-tty and shell tests (80 of 80), `npx tsc -p .` and `check-boundaries` clean; full suite 3120 pass, 0 fail
