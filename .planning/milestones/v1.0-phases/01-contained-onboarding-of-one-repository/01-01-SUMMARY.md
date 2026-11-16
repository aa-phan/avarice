---
phase: 01-contained-onboarding-of-one-repository
plan: 01
subsystem: infra
tags: [typescript, node-type-stripping, node-test, domain-contracts, import-boundary-lint, ulid, canonical-json]

requires: []
provides:
  - "package.json (type: module, engines node >=22.22.3, bin.avarice, no dependencies) and tsconfig.json (erasableSyntaxOnly, nodenext, noEmit)"
  - "Pure domain contracts: Result/PortError, ULID ids, canonical-JSON digests, onboarding lifecycle, onboarding contract compiler, map file sets and validation, project record builder"
  - "scripts/check-boundaries.ts: zero-dependency import-boundary lint (NFR-3) with --root-as"
  - "Pinned dev toolchain: typescript 7.0.2, @types/node 22.20.5 (exact, --ignore-scripts, integrity verified)"
affects: [01-03, 01-04, 01-05, 01-06, 01-08, 01-09, 01-10, 01-11, phase-02, phase-03]

actuals:
  tokens: 20000
  tasks: 3
  commits: 3
plan_head_before: 669c46c79d8a0aa16e6901bcc58a344d856f5522
plan_head_after: b7dd72be2caed27e8c4365d4141f2e1a7b9c9b94

tech-stack:
  added: ["typescript@7.0.2 (dev, native tsc)", "@types/node@22.20.5 (dev)"]
  patterns:
    - "Domain functions are pure: time, randomness and preflight facts are arguments; only node:crypto is imported"
    - "Untrusted request/preflight input typed Readonly<Record<string, unknown>> and validated at runtime inside the compiler"
    - "Erasable TypeScript only; relative imports use .ts specifiers; type-only imports use `import type`"
    - "Boundary lint tested with violation files generated into a temp directory at test time (no committed fixtures)"

key-files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.json
    - scripts/check-boundaries.ts
    - src/domain/result.ts
    - src/domain/ids.ts
    - src/domain/digest.ts
    - src/domain/onboarding-lifecycle.ts
    - src/domain/onboarding-contract.ts
    - src/domain/mapping.ts
    - src/domain/validation.ts
    - src/domain/project-record.ts
    - test/unit/domain-contracts.test.ts
    - test/unit/boundaries.test.ts
  modified: []

key-decisions:
  - "newId takes the prefix including its underscore ('onb_'), typed IdPrefix = 'proj_'|'onb_'|'run_'|'inv_'|'att_'|'ckp_'; ulid and newId take time and 10 random bytes as arguments"
  - "TRANSITIONS is a readonly array of [from, to] edges (deduplicated): 22 diagram edges, 8 pre-activation states to blocked (5 new beyond the diagram), and discovered/contract_proposed to incompatible"
  - "The onboarding contract body is returned by compileOnboardingContract and hashed by contractDigest(body) = digestOf(body); policyRevision = digestOf(ONBOARDING_PRESET); compiledAt carries nowIso"
  - "files.read stays ['**']; excluded directories live in files.readExclude and secret globs in files.secretGlobs; files.write and files.create are per-purpose maps {map, intel, knowledge}"
  - "Budget overrides use flat keys (wallClockMinutes, invocations, toolCalls, subagentsConcurrent, subagentsTotal, costUsdPerInvocation, costUsdPerRun, retry); lowering wallClockMinutes scales the per-purpose shares down with floor"
  - "Vendor tool names (Read, Bash, Agent) are kept out of the domain contract; execution.toolClasses = read, edit, shell-sandboxed (SKELETON vendor-code placement)"
  - "completenessFor(mode, filesPresent?) never claims 'complete' without evidence: only full is complete; adopt is complete only when all seven files are listed present"
  - "requiredFilesFor: skip needs nothing, fast and adopt need the four fast files, full and paths need the seven; 01-10 adds the remaining validation rules"
  - "buildProjectRecord defaults grant nothing: paths.write [], execution.endpoints [], credentials []; recordDigest accepts unknown"

patterns-established:
  - "RED stubs export every name the test imports so failures are assertion failures, not load failures"
  - "Boundary lint scans comments, strings, template literals and regex bodies out before keyword search, so text in strings is not code"

requirements-completed: [ONB-1, ONB-9, NFR-3]

coverage:
  - id: D1
    description: "assertTransition accepts exactly the lifecycle edges (diagram + pre-activation to blocked + incompatible edges) over all 14x14 pairs and rejects every other pair with kind invalid; isStopState and NEXT_ACTIONS match SKELETON.md"
    requirement: ONB-1
    verification:
      - kind: unit
        ref: "test/unit/domain-contracts.test.ts#onboarding lifecycle"
        status: pass
    human_judgment: false
  - id: D2
    description: "compileOnboardingContract produces the onboarding-preset body, refuses promotion other than none and any budget override above the preset (RC-5)"
    requirement: ONB-9
    verification:
      - kind: unit
        ref: "test/unit/domain-contracts.test.ts#compileOnboardingContract"
        status: pass
    human_judgment: false
  - id: D3
    description: "ULID ids, canonical-JSON digests and project record builder; digest is stable under key reordering and changes with content"
    requirement: ONB-1
    verification:
      - kind: unit
        ref: "test/unit/domain-contracts.test.ts#ids, #digest, #project record"
        status: pass
    human_judgment: false
  - id: D4
    description: "validateMapArtifacts presence and stamp checks for seven-file and four-file maps"
    requirement: ONB-1
    verification:
      - kind: unit
        ref: "test/unit/domain-contracts.test.ts#validateMapArtifacts"
        status: pass
    human_judgment: false
  - id: D5
    description: "check-boundaries exits 1 for each planted violation (node:fs, bare fs, adapter, bare package, non-literal import(), require('node:child_process'), createRequire, process) and 0 for node:crypto and for the repository"
    requirement: NFR-3
    verification:
      - kind: unit
        ref: "test/unit/boundaries.test.ts"
        status: pass
      - kind: other
        ref: "node scripts/check-boundaries.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "tsc -p . exits 0 with erasableSyntaxOnly; dev dependencies pinned exactly and installed with --ignore-scripts behind the legitimacy checkpoint, lockfile integrity equal to the approved values"
    requirement: NFR-3
    verification:
      - kind: other
        ref: "npx tsc -p ."
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-02
status: complete
---

# Phase 01 Plan 01: Toolchain Gates and Pure Domain Contracts Summary

**Eight pure TypeScript domain modules (lifecycle transition table, RC-5-enforcing onboarding contract compiler, ULID/canonical-digest primitives, map validation, project record) behind a zero-dependency import-boundary lint and an erasable-syntax `tsc` gate, with typescript 7.0.2 and @types/node 22.20.5 pinned and integrity-verified.**

## Performance

- **Duration:** about 25 min (start time was not recorded; first commit 11:33, last 11:38 local on 2026-11-02, after reading the plan and specs)
- **Completed:** 2026-11-02T17:38Z
- **Tasks:** 3 of 3 (Task 2 was a checkpoint resolved by the orchestrator before dispatch)
- **Files created:** 14 (plus package-lock.json)

## Accomplishments

- Lifecycle: `assertTransition` accepts exactly 29 edges and rejects the other 167 of the 196 state pairs with `invalid`; checked against an oracle written in the test from the spec diagram.
- Contract compiler: onboarding preset body, per-purpose agent write sets, promotion `none`, default budgets (45 min, 4 invocations, 600 tool calls, 4 concurrent / 7 total subagents, $3 / $12 estimated); refuses `copy`/`commit` and any budget above the preset with "budgets can only be lowered".
- Determinism primitives: ULID with known vectors, canonical JSON with `sha256:` digests that ignore key order and refuse values with no canonical form.
- Quality gates: `scripts/check-boundaries.ts` (domain, ports, app rules; comment/string/regex-aware) proven by 22 generated-violation tests; `npx tsc -p .` exits 0 under `erasableSyntaxOnly` (verified that it rejects an `enum`).

## Task Commits

1. **Task 1: Package scaffold and pure domain contracts** (TDD)
   - RED `48286b4` test(01-01): 41 tests, stub modules
   - GREEN `eeb74bf` feat(01-01): implementation
   - REFACTOR: none needed
2. **Task 2: Package legitimacy gate** (checkpoint:human-verify, blocking-human): resolved by the human through the orchestrator before dispatch ("approved"); no commit.
3. **Task 3: Toolchain gates** - `b7dd72b` chore(01-01)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED, GREEN present in order (REFACTOR optional, not needed).

- **RED:** `node --test --test-reporter=tap "test/unit/domain-contracts.test.ts"`, exit 1, 41 tests, 1 pass, 40 fail. Target test "assertTransition accepts every edge in TRANSITIONS"; `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`, format tap). Semantic assessment: stub modules export every imported name, so every failure is an assertion or a stub `not implemented` throw, never a load, syntax or fixture fault. The one passing test (`ok`/`err`) exercises the real `result.ts`. Before the RED commit I strengthened four tests that passed vacuously against the stubs (throws expectations now require `TypeError`; error-path tests require `kind: 'invalid'` and a named failing check).
- **GREEN:** same command, 41 of 41 pass.

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans are most likely to trip on: ID prefixes carry the underscore; `files.write`/`files.create` are per-purpose maps rather than arrays; `files.readExclude` and `files.secretGlobs` are separate from `files.read`; `request` and `preflight` are untrusted `Record<string, unknown>` inputs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RED stubs for every domain module**
- **Found during:** Task 1
- **Issue:** a test importing missing modules fails at load time, which `tdd.md` classifies as INVALID_RED and does not authorize GREEN.
- **Fix:** RED commit includes stub modules exporting every name the tests import.
- **Files modified:** src/domain/*.ts (replaced in GREEN)
- **Committed in:** 48286b4

**2. [Rule 1 - Bug] Test type errors surfaced by `tsc -p .`**
- **Found during:** Task 3 (tsc only exists after the install)
- **Issue:** `domain-contracts.test.ts` passed `string` where `OnboardingState` / `MappingMode` literal types were required (5 distinct errors).
- **Fix:** typed `ALL_STATES`, cast the unknown-state probe, `as const` on the record input mode. No behaviour change (the plan allows fixing Task 1 type errors).
- **Files modified:** test/unit/domain-contracts.test.ts
- **Verification:** `npx tsc -p .` exit 0; 41 of 41 still pass
- **Committed in:** b7dd72b

**3. [Rule 2 - Missing critical] Additional validation in the contract compiler**
- **Found during:** Task 1
- **Issue:** preflight-supplied directory lists flow into `files.readExclude` and knowledge globs; an unsafe entry (absolute, `..`, glob characters) would widen or corrupt scope.
- **Fix:** unsafe directories are refused with `invalid`; unknown, negative, non-integer or non-finite budget overrides and unknown mapping modes are refused.
- **Committed in:** eeb74bf

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical). **Impact on plan:** none on scope; stubs were required by the TDD rule and the other two are small hardening.

## Issues Encountered

- **Transitive packages beyond the two approved names.** `typescript@7.0.2` has 20 optional native-binary dependencies, `@typescript/typescript-<os>-<cpu>@7.0.2` (aix, darwin, freebsd, linux, netbsd, openbsd, sunos, win32), and `@types/node@22.20.5` pulls `undici-types@6.21.0`. All come from registry.npmjs.org, have no install scripts (`--ignore-scripts` regardless), and carry integrity hashes in `package-lock.json`; only `@typescript/typescript-darwin-arm64` is installed on this machine. The two approved integrity values matched exactly. The approval named only the two top-level packages, so these are reported for the record, not blocked.
- Plan acceptance text in Task 1 (`node --test ... exits 0 with at least 12 tests`) is satisfied by 41; Task 3 (`at least 8 passing`) by 22.

## Authentication Gates

None.

## Known Stubs

None. No placeholder text, TODO or FIXME in `src/`, `scripts/` or `test/`. `gsd.version: 'unknown'` in the project record is intentional and specified by the plan (filled by 01-09).

## Threat Flags

None. T-01-04 (boundary lint bypass) mitigated and tested; T-01-60 (promotion/budget raise) mitigated in the compiler and tested; T-01-SC (npm supply chain) mitigated by the blocking-human checkpoint, exact versions, `--ignore-scripts` and the integrity comparison. Lint limits worth knowing: it reads text, not an AST, so it does not catch `eval`, `new Function`, `Reflect`-based loading or `import.meta.resolve`; 01-20 (adversarial testing) is the place to probe those.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 01-03 (status tracer) and 01-04/01-05: lifecycle, ids, digests, contract, record and validation contracts are importable; `npm run typecheck`, `npm run check:boundaries` and `npm test` (63 tests) are green.
- 01-10 extends `validateMapArtifacts` (scope of writes, path references, secrets, size, coverage claims) and `buildProjectRecord` (gsd version, indexes); 01-11 should treat `ONBOARDING_PRESET.commands` as provisional until spike S0-A fixes the exact read-only command set.
- Open item: `files.delete` is `[]` as the plan states, while the spec allows `.planning/codebase/**` deletion when the existing-map decision is Refresh; revisit when 01-09/01-10 handle an existing map.

## Self-Check: PASSED

- Created files present: package.json, package-lock.json, tsconfig.json, scripts/check-boundaries.ts, src/domain/{result,ids,digest,onboarding-lifecycle,onboarding-contract,mapping,validation,project-record}.ts, test/unit/{domain-contracts,boundaries}.test.ts (checked on disk).
- Commits 48286b4, eeb74bf, b7dd72b are ancestors of HEAD on `gsd/phase-01-contained-onboarding-of-one-repository`; `git rev-list --count 669c46c..HEAD` = 3.
- Plan verification: `node scripts/check-boundaries.ts` ok; `npx tsc -p .` exit 0; boundaries (22) + domain-contracts (41) tests pass.
- Acceptance criteria re-run: Task 1 (41 tests; `"dependencies"` count 0; engines `>=22.22.3`; "budgets can only be lowered" count 1; erasableSyntaxOnly count 1); Task 3 (typescript `7.0.2`; @types/node `22.20.5`; tsc 0; 22 boundary tests; createRequire count 3).

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
