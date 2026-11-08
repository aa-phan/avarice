---
phase: 02-contained-unattended-run-of-one-work-item
plan: 04
subsystem: domain
tags: [run-contract, brief, conventions, routine-preset, g0, budgets, untrusted-input]

requires:
  - phase: 01-onboarding
    provides: digestOf and canonical JSON, the Result type, the glob matcher, the onboarding compiler's lower-only budget pattern
provides:
  - "parseBrief: Markdown brief (frontmatter plus five sections) to a validated Brief with a digest"
  - "parseConventions and checkSpecDigest: .avarice/config.json schema 1 to validated Conventions, with RESERVED_CHECK_ENV and REFUSED_AGENT_COMMAND_WORDS"
  - "ROUTINE_PRESET, ROUTINE_POLICY, compileRunContract, checkG0Static, BUDGET_OVERRIDE_NAMES: the version-1 routine run contract with every RC-1 field and its digest"
affects: [02-08, 02-09, 02-10, 02-13, 02-14, 02-21]

actuals:
  tokens: 27400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Untrusted input is parsed, never obeyed: unknown keys refused at every level, every refusal names its field (brief.*, conventions.*, budget.<name>, g0)"
    - "The compiler only narrows: brief globs must sit inside the conventions write set and off protected paths, budgets only go down"
    - "Recorded derivations and recorded adjustments: invocationsDerivation, subagentsDerivation, budgets.adjustments"

key-files:
  created:
    - src/domain/brief.ts
    - src/domain/conventions.ts
    - src/domain/run-contract.ts
    - test/unit/brief.test.ts
    - test/unit/conventions.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-04-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-04-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-04-red-evidence-task3.json
  modified:
    - test/unit/run-contract.test.ts

key-decisions:
  - "subagentsTotal 10 (planner 1 + plan-checker 2 + executor 1 + verifier 1 = 5 per unit, times 2 rounds), raised from RESEARCH A7's 8 so one CON-16 retry of a full quick unit fits; invocations 3 = unit + retry + interruption relaunch"
  - "repairAttemptsPerCheck 0 with a stated reason: no repair work items exist in this phase"
  - "A brief with no acceptance criteria parses (an inline brief may be Behavior only) and is refused at compile with field brief.acceptance"
  - "Containment of a brief glob in a conventions glob is equal strings, or an outer dir/** with an inner equal to dir or starting with dir/, or a concrete path the outer glob matches; anything else is treated as not contained"
  - "Protected globs are the preset list plus the repository's; nothing the repository says removes a preset entry"

patterns-established:
  - "Protected-path check runs before the containment check, so a refusal says why (protected) rather than only that the glob is outside the write set"
  - "Compile refusals are collected for G0: checkG0Static returns every { rule, detail } and the compiler reports them all in one g0 refusal"

requirements-completed: [RC-1, RC-2, RC-5, FR-1, AUT-7, NFR-3]

coverage:
  - id: D1
    description: "parseBrief reads the frontmatter and five sections as data and refuses oversized, malformed, unknown-key, bad-encoding and control-character input with the field named"
    requirement: FR-1
    verification:
      - kind: unit
        ref: "test/unit/brief.test.ts (23 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "parseConventions reads schema 1 with per-check env and writes, refuses unknown keys, reserved env names, unsafe globs and refused agent command words"
    requirement: RC-2
    verification:
      - kind: unit
        ref: "test/unit/conventions.test.ts (21 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "compileRunContract compiles the routine preset, conventions and brief into a version-1 contract with every RC-1 field, the D-13 limits, D-14 sizing and a stable digest"
    requirement: RC-1
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#compileRunContract: every RC-1 field exists on a compiled contract"
        status: pass
    human_judgment: false
  - id: D4
    description: "The compiler only narrows: write set containment, protected paths, lower-only budgets and refused agent commands are enforced at compile"
    requirement: RC-5
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#compileRunContract: write set, protected paths and artifacts (RC-5); budgets only go down (RC-5)"
        status: pass
    human_judgment: false
  - id: D5
    description: "checkG0Static judges the static G0 conditions and the compiler reports every failure at once under field g0"
    requirement: AUT-7
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#checkG0Static and the g0 refusal (AUT-7)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The three domain files import only relative domain modules and pass the boundary lint, and hold no URL, host name or absolute path literal"
    requirement: NFR-3
    verification:
      - kind: other
        ref: "node scripts/check-boundaries.ts; grep -cE 'https?://|registry\\.|/Users/|/opt/' on each file returns 0"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-05
status: complete
commits: 3
plan_head_before: e07dca01441ce10a7f2e6550b6f6319c2a76adca
plan_head_after: a754191446ac593ebadf6f96f33a396686de5160
---

# Phase 2 Plan 04: Run contract compiler Summary

**A pure compiler that turns a Markdown brief, the repository's `.avarice/config.json` and the `routine` preset into a version-1 run contract with a digest, refusing every attempt to widen the write set, touch a protected path, raise a budget or grant the agent git, avarice or network commands**

## Performance

- **Duration:** about 30 min (the start was not timestamped; measured from the first read to the last commit)
- **Completed:** 2026-11-05T11:18Z (last task commit)
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto, all with RED first)
- **Files modified:** 9 (2139 insertions), including the three RED evidence files

## Accomplishments

- `parseBrief` and `parseConventions` treat both inputs as untrusted data. Unknown keys are refused at every level, sizes and counts are limited, a BOM and CRLF normalize to the same result as LF, U+FFFD and control characters are refused, and every refusal names its field.
- `compileRunContract` returns `{ contract, digest }` carrying every RC-1 field. The preset holds the D-13 limits (60 min, 2.00 USD per invocation, 5.00 USD per run, 400 tool calls, 3 invocations) with recorded derivations, and D-14 sizing (size `medium`, `modelBySize` medium to sonnet, a brief `model` overrides and records `modelSource: 'brief'`).
- RC-5 is enforced at the one place every later stage trusts. A brief write glob must sit inside a conventions write glob (`src-evil/**` under `src/**` is refused), off every protected glob. Budget overrides only lower, with field `budget.<name>` on a value above the preset, an unknown name or a non-positive value. A per-invocation cost cap above a lowered per-run cap is clamped and recorded in `budgets.adjustments`.
- `checkG0Static` and the `g0` refusal list every static failure at once: a criterion with no `verifiedBy`, a `check:<name>` naming no declared check, an undeclared target check, no required check, and a `test:` reference with no declared test inventory.
- `policyRevision` is `digestOf(ROUTINE_PRESET)`, so it changes when any preset value changes; two conventions texts that differ only in JSON key order give the same contract digest.

## Task Commits

1. **Task 1: Tracer, a brief and conventions compile into a routine contract with a digest** - `aa42c78` (feat)
2. **Task 2: Brief and conventions parsing as untrusted input** - `56b5826` (feat)
3. **Task 3: Write-set narrowing, protected paths, lower-only budgets, agent commands, model override and G0 static** - `a754191` (feat)

**Plan metadata:** recorded in the docs commit that follows this file (summary, then state and roadmap).

RED evidence: `02-04-red-evidence-task1.json` (the three modules do not exist, the test file fails to load), `02-04-red-evidence-task2.json` (18 brief tests fail on the missing validation, the conventions test file fails to load on the missing exports), `02-04-red-evidence-task3.json` (the run-contract test file fails to load on the missing `BUDGET_OVERRIDE_NAMES` and `checkG0Static`).

Tracer gate: the tracer's verify (the run-contract tests, the boundary lint, `tsc`) was re-run end to end and passed before the expansion tasks started.

## Files Created/Modified

- `src/domain/brief.ts` - `parseBrief`, `Brief`, `BriefAcceptance`, `BriefSource`, `BRIEF_LIMITS`
- `src/domain/conventions.ts` - `parseConventions`, `checkSpecDigest`, `validateGlob`, `isRefusedAgentCommand`, `RESERVED_CHECK_ENV`, `REFUSED_AGENT_COMMAND_WORDS`, `CHECK_NAME_PATTERN`, types `Conventions`, `CheckSpec`, `TestInventorySpec`, `DependencySpec`
- `src/domain/run-contract.ts` - `ROUTINE_POLICY`, `ROUTINE_PRESET`, `BUDGET_OVERRIDE_NAMES`, `compileRunContract`, `checkG0Static`, `globWithin`, types `RunContract`, `RunBudgets`, `RunCompileInput`, `G0Failure`, `RunWorkItem`
- `test/unit/brief.test.ts` (23 tests), `test/unit/conventions.test.ts` (21), `test/unit/run-contract.test.ts` (40, with the shared fixtures the later run plans can copy)

## Decisions Made

- `subagentsTotal` 10 and `invocations` 3 with recorded derivations (see key-decisions). The S2-B spike in plan 02-09 records the observed subagent count, and a lower measured need lowers it there.
- A brief with no acceptance criteria parses and is refused at compile with `brief.acceptance`, because the plan's inline-brief edge accepts a Behavior-only brief at parse.
- `notify` is the object shape of `docs/contracts-and-state.md` (`{ reviewReady, blocking, digest }`), filled from the preset's `['local']`, rather than a flat list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Wider reserved environment set**
- **Found during:** Task 2
- **Issue:** The plan names PATH, HOME, TMPDIR, NODE_OPTIONS and the `DYLD_`, `LD_` and `npm_config_` prefixes. Other names also decide which code runs or where a check keeps state (T-02-11).
- **Fix:** `RESERVED_CHECK_ENV` also holds TMP, TEMP, NODE_PATH, NODE_EXTRA_CA_CERTS, BASH_ENV, ENV, SHELL and IFS; the prefixes live in `RESERVED_ENV_PREFIXES` and are compared without regard to case.
- **Files modified:** src/domain/conventions.ts
- **Verification:** conventions.test.ts reserved-key case (10 names)
- **Committed in:** 56b5826

**2. [Rule 2 - Missing critical] Command chaining and a check argv that grants a refused word**
- **Found during:** Task 2 and Task 3
- **Issue:** The plan refuses a refused first word in `agentCommands`. A command such as `npm test; curl x` or `npm test && git push` has an allowed first word, and a check whose argv starts with `git` would reach the agent through `execution.commands` (T-02-08).
- **Fix:** `agentCommands` entries refuse `; & | $`, a backtick and a backslash, and any `<` or `>` token other than one trailing `<paths>`. The compiler refuses any composed command (agent commands and check argv joined) whose first word is refused, with field `execution.commands`. The first word is compared by its last path segment without regard to case, so `/usr/bin/git` and `GIT` are refused.
- **Files modified:** src/domain/conventions.ts, src/domain/run-contract.ts
- **Verification:** conventions.test.ts allowed and refused command cases; run-contract.test.ts refused-words case for all nine words
- **Committed in:** 56b5826, a754191

**3. [Rule 2 - Missing critical] Protected-path check on the conventions' own write grants, and input validation**
- **Found during:** Task 3
- **Issue:** The plan checks the brief's write globs against protected paths. The conventions could still grant a protected path through `paths.write`, `paths.artifacts` or a check's `writes`, and the compiler took the run ID and revisions as given (AUT-9, RC-5).
- **Fix:** Those three conventions sources are refused when they reach a protected glob (fields `conventions.paths.write`, `conventions.paths.artifacts`, `conventions.checks[i].writes`). The compiler validates `runId`, `projectId`, `baseRevision` and `conventionsRevision`, refuses a `policy` other than `routine`, refuses a brief `baseRevision` that is not a prefix of (or prefixed by) the pin (D-04), and refuses an empty write set with `files.write`.
- **Files modified:** src/domain/run-contract.ts
- **Verification:** run-contract.test.ts conventions-protected and input-and-revisions cases
- **Committed in:** a754191

---

**Total deviations:** 3 auto-fixed (all Rule 2, security hardening named by the threat register)
**Impact on plan:** Each addition closes a path to the same threat the plan already mitigates (T-02-08, T-02-09, T-02-11). No scope creep; no plan truth was weakened.

### Contract fields added beyond the first-truth list

The contract also carries `intent.title`, `intent.expectedDecisions` (when the brief sets it), `execution.dependencies` (`{ install, lockfile }` or null, for the D-11 install step in plan 02-14), `verification.testInventory` (so `checkG0Static` needs only the contract), `budgets.repairAttemptsReason` and `budgets.adjustments`. They are additive; no listed RC-1 field was renamed.

## Issues Encountered

- The harness refused compound shell commands that mention git, and `root-pin.sh` is not executable, so the root-pin guard was run as the plain command `git rev-parse --show-toplevel` and compared with the pinned root; it printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before every write batch and commit.
- Task 3's first run had two failing tests, both test-fixture mistakes: the shared fixture brief has a Write section, so the "no Write section" and "empty write set" cases needed a brief without one. The compiler was unchanged.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. The plan adds no network endpoint, file access or schema; the three modules are pure.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-08 reuses `RESERVED_CHECK_ENV`, `REFUSED_AGENT_COMMAND_WORDS`, `isRefusedAgentCommand` and the `RunContract` `files` and `execution` fields. Plan 02-10 calls `parseBrief` and `compileRunContract` from `startRun` (the input takes the pin as `baseRevision` and the descendant commit as `conventionsRevision`, as D-16 needs). Plan 02-14 reads `checkSpecDigest`, `execution.checks`, `execution.dependencies` and `execution.supervisorEndpoints`.
- The `diff:` form of `verifiedBy` parses but G0 static does not judge it; its evaluation arrives with the verification plan that implements the diff gate.
- Open for the owner at the 02-10 start preflight, not here: Pitfall 6 assumes `.avarice/config.json` is read from a descendant commit of the pin whose diff touches only `.avarice/**`.

## Self-Check: PASSED

All created files exist on disk (the three domain files, the three test files, the three RED evidence files) and commits `aa42c78`, `56b5826` and `a754191` appear in the phase branch history. Plan verification: `node --test` on brief, conventions, run-contract, domain-contracts and boundaries tests (187 tests, 0 failures); the full unit suite (909 tests, 0 failures); `node scripts/check-boundaries.ts` ok; `npx tsc -p .` clean; `grep -cE "https?://|registry\.|/Users/|/opt/"` returns 0 on each new domain file; `grep -c "wallClockMinutes: 60"` and `grep -c "perRun: 5"` each return 1; `grep -c "export const RESERVED_CHECK_ENV"` returns 1.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-05*
