---
phase: 01-contained-onboarding-of-one-repository
plan: 24
subsystem: sandbox-read-confinement
tags: [sandbox, denyRead, allowRead, work-root, hook-policy, containment, tdd]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: hook read allow-list with readRoots and deny-read before allow-list ordering (plan 01-23), computeInvocationScope, renderClaudeSettings, buildHookPolicy
provides:
  - "ScopeInput.workRoot: the profile work root appended last to denyRead, the invocation's own staging path appended last to allowRead"
  - "prepareInvocation passes workRoot from the profile, so every contained invocation is denied the other onboardings in the sandbox and in the hook"
  - "renderClaudeSettings leaves a root that equals or contains the staging out of the Read permission denies"
  - "Production-path test: real adapter and fake claude, generated host-settings.json and hook-policy.json, then the hook decision on the written policy for every VERIFICATION.md P-3 case"
  - "docs/containment.md: work root and allowRead in the settings example, CON-1 read-confinement row with enforcement points, tests and known bypasses"
affects: [phase 2 containment reuse, docs/containment.md, mapper and intel invocations]

plan_head_before: 889e6ef753dc9581f99203bd2b197d87a556c1a4
plan_head_after: 6c7b94aee6854202fb5e3a9db528fd1bf5c50d61

actuals:
  tokens: 7180
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Deny a region at the OS layer and re-allow one subtree with allowRead (spike S0-B case B4 pattern)"
    - "A permission deny has no re-allow, so a root containing the staging stays out of Read(...) denies; the Read tool is confined by allow rules"

key-files:
  created:
    - .planning/phases/01-contained-onboarding-of-one-repository/01-24-red-evidence-task1.json
  modified:
    - src/domain/invocation-scope.ts
    - src/app/invocation.ts
    - src/adapters/host-claude/settings.ts
    - test/integration/claude-host.test.ts
    - test/unit/invocation-scope.test.ts
    - test/unit/claude-settings.test.ts
    - docs/containment.md

key-decisions:
  - "workRoot is optional in ScopeInput; absent means denyRead and allowRead are exactly as before, and prepareInvocation always passes deps.profile.workRoot"
  - "denyRead keeps its order with the work root last; allowRead lists the strategy's re-allowed roots first and the staging path last"
  - "The staging-containing filter lives in the settings renderer, not in the scope, so the hook policy and the sandbox keep the full denyRead"
  - "docs/containment.md is raised to what the code now enforces and names every remaining bypass; nothing is claimed that the hook or sandbox does not enforce"

requirements-completed: [CON-1, ONB-3]

coverage:
  - id: D1
    description: "The sandbox filesystem.denyRead and the hook policy denyRead of every contained invocation include the work root; allowRead re-allows only the invocation's own staging"
    requirement: CON-1
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#denies the work root and re-allows only this staging, in the generated settings and hook policy, and the policy denies every reproduced read (CR-02, D-GAP-01)"
        status: pass
      - kind: unit
        ref: "test/unit/invocation-scope.test.ts#the work root (CR-02, D-GAP-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No generated Read(...) permission deny names a root that contains the staging; the Read allow rules for staging (map, intel) and the corpus (knowledge) are kept"
    requirement: CON-1
    verification:
      - kind: unit
        ref: "test/unit/claude-settings.test.ts#renderClaudeSettings with a work root (CR-02, D-GAP-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Through the production path every P-3 case is denied with its rule (sibling staging deny-read, ~/.netrc outside-read-set, grep -r token ~ outside-read-set, grep -r PASSWORD . shell-recursive-read, grep -f~/.ssh/id_rsa deny-read, cat ~/.ssh/id_rsa deny-read, cat .env deny-secret-read), and cat README.md, a gsd-core workflow file and git log --oneline -5 are allowed"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#denies the work root and re-allows only this staging, in the generated settings and hook policy, and the policy denies every reproduced read (CR-02, D-GAP-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/containment.md names the CON-1 read-confinement enforcement points, the tests that prove them and the known bypasses"
    requirement: CON-1
    verification:
      - kind: other
        ref: "grep -c shell-recursive-read docs/containment.md (1); grep -c test/unit/hook-decision.test.ts docs/containment.md (1); grep -c 'git show' docs/containment.md (1)"
        status: pass
    human_judgment: true
    rationale: "Whether the document is accurate and complete about the remaining bypasses is a reading judgment; the grep gates only show the named items are present"
  - id: D5
    description: "The sandbox honours allowRead of the own staging beneath the denied work root on the live Claude Code host (mapping reads still work)"
    verification: []
    human_judgment: true
    rationale: "Not re-run live in this round (spend), per the plan's flagged assumption; spike S0-B case B4 proved the pattern on 2.1.316, and a host that ignored the re-allow would fail closed. The next T3 live pass re-checks it"

duration: 15min
completed: 2026-11-04
status: complete
---

# Phase 1 Plan 24: Work-root deny and CON-1 read confinement Summary

**The profile work root (every onboarding's staging) is denied in the sandbox `denyRead` and the hook policy with only the invocation's own staging re-allowed, a staging-containing root is kept out of the `Read(...)` permission denies, a production-path test proves every VERIFICATION.md P-3 read is denied, and docs/containment.md records the CON-1 enforcement points, tests and remaining bypasses (gap P-3, CR-02, scope and sandbox half)**

## Performance

- **Duration:** 15 min
- **Started:** 2026-11-04T10:10:17Z
- **Completed:** 2026-11-04T10:25:01Z
- **Tasks:** 2 (a tracer, then an auto TDD task)
- **Files modified:** 7 source, test and doc files, 1 RED evidence record

## Accomplishments

- `computeInvocationScope` takes `workRoot` and appends it (trailing slashes trimmed, deduplicated) last to `denyRead`; `allowRead` becomes the strategy's re-allowed roots followed by the staging path. `prepareInvocation` passes `deps.profile.workRoot`. `buildHookPolicy` needed no change: it already canonicalizes and writes both lists.
- `renderClaudeSettings` filters any `denyRead` root that equals or contains the canonical staging out of the generic `Read(...)` permission denies. The sandbox `filesystem.denyRead` keeps the full list and `filesystem.allowRead` carries the staging, so the shell is confined at the OS layer, the Read tool by the allow rules, and both by the hook.
- The production-path test runs `avarice onboard` with the real ClaudeHostAdapter and the fake claude, reads the generated settings and policy, and runs `decideToolCall` with `canonicalAbsolute` on the policy file. It also covers adjacency (`{onb}1/staging` and `{onb}/x` both `deny-read`).
- Unit tests pin the scope (order, trimming, dedup, no work root, adjacency) and the renderer (sandbox lists, no work-root Read deny, allow rules per purpose, prefix-sibling root kept, no work root unchanged).
- docs/containment.md: `//<work root>` and `allowRead` in the settings example, one sentence on why no permission deny names a staging-containing root, and the CON-1 row rewritten with mechanisms, covered paths, named bypasses and tests.

## Task Commits

1. **Task 1: Tracer, work root denied and own staging re-allowed through the production path**
   - RED `56da8b2` (test) with `01-24-red-evidence-task1.json`
   - GREEN `630f7f8` (feat)
2. **Task 2: Unit coverage and the CON-1 row** - `6c7b94a` (test, with the docs change)

**Plan metadata:** the docs commit that adds this SUMMARY, STATE.md, ROADMAP.md and REQUIREMENTS.md.

## Files Created/Modified

- `src/domain/invocation-scope.ts` - `ScopeInput.workRoot`, work root in `denyRead`, staging in `allowRead`
- `src/app/invocation.ts` - passes `workRoot: deps.profile.workRoot`
- `src/adapters/host-claude/settings.ts` - `containsStaging` filter on the generic Read permission denies
- `test/integration/claude-host.test.ts` - production-path test "denies the work root and re-allows only this staging ..."
- `test/unit/invocation-scope.test.ts` - describe "the work root (CR-02, D-GAP-01)"
- `test/unit/claude-settings.test.ts` - describe "renderClaudeSettings with a work root (CR-02, D-GAP-01)"; `scope()` helper takes `workRoot`
- `docs/containment.md` - settings example, paragraph sentence, CON-1 row
- `.planning/phases/01-contained-onboarding-of-one-repository/01-24-red-evidence-task1.json` - classifier-validated RED record (`RED_EVIDENCE_OK`)

## TDD Gate Compliance

- **Task 1:** RED `test(01-24)` before GREEN `feat(01-24)`; no refactor commit.
  - RED evidence: `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (TAP, 35 tests, 1 failing). Target test failed on `the sandbox denies the work root` (work root absent from the generated `denyRead`). Semantic assessment: the target ran through the real adapter, onboarding reached `active`, the settings file was read, and the planned assertion failed; not a syntax, import or fixture fault. The later assertions (hook-policy `denyRead`, sibling case `deny-read` instead of `outside-read-set`) were not reached at RED, so they are not claimed as observed before the change.
- **Task 2:** the plan states these tests pin behaviour Task 1 already delivers and "confirm they pass against Task 1", so there is no RED commit for it; the mutation checks below show the tests discriminate.

## Mutation checks (restored from a saved copy each time; `git diff` empty after)

| Mutation | Result |
| --- | --- |
| Drop the `containsStaging` filter in `settings.ts` | `claude-settings.test.ts`: 1 failure (the work-root settings test) |
| Drop the staging path from `allowRead` in `invocation-scope.ts` | 4 failures across invocation-scope, claude-settings and claude-host tests |

## Decisions Made

- `workRoot` is optional so unit callers that model no profile see no change; the production caller always passes it and the production-path test pins that.
- The staging-containing filter is applied in the renderer only; the scope and the hook policy keep the full `denyRead`.
- The knowledge purpose also gets the staging in sandbox `allowRead` (the plan applies the work-root rule to every purpose); its Read allow rule stays the corpus and the hook's `readConfine` still confines its reads.

## Deviations from Plan

None - plan executed exactly as written.

One test-authoring correction, not a deviation: the first draft of the settings unit test asserted that no Read deny starts with the work root's path, which the secret-glob denies below the staging legitimately do; the assertion was changed to match the work-root rule whole (`Read(//{work root}/**)`).

**Total deviations:** 0
**Impact on plan:** None.

## Issues Encountered

None.

## Known Stubs

None.

## Residual risks (as planned, and named in docs/containment.md)

- Flagged assumption not re-run live: the sandbox of Claude Code 2.1.317 honours `filesystem.allowRead` of the own staging beneath the denied work root (spike S0-B case B4 proved the pattern on 2.1.316). A host that ignored the re-allow would fail closed (mapping reads denied), not open. The next T3 live pass re-checks it (coverage D5).
- Root comparisons on a non-ASCII work root rely on realpath on both the policy writer and the hook; Unicode normalization variants were not exercised (backstop truth).
- Known bypasses named in the CON-1 row: committed secret-glob files read through git objects, host Grep tool recursion inside staging relying on the host's secret-glob deny rules, the sandbox not applying secret globs to a command that evades the hook, and MCP servers with full access.

## Verification

- `node --test "test/integration/claude-host.test.ts" "test/unit/invocation-scope.test.ts" "test/unit/claude-settings.test.ts" "test/integration/hook.test.ts" "test/unit/hook-decision.test.ts" "test/containment/failclosed.test.ts" "test/mutation/scope-and-validation.test.ts"`: 229 tests, 229 pass, 0 fail
- `npx tsc -p .`: exit 0; `node scripts/check-boundaries.ts`: `check-boundaries: ok (53 file(s))`
- Full suite `node --test`: 1240 tests, 1218 pass, 0 fail, 22 skipped
- `grep -c "workRoot: deps.profile.workRoot" src/app/invocation.ts` = 1; `grep -c "workRoot" src/domain/invocation-scope.ts` = 5
- docs gates: `shell-recursive-read` 1, `test/unit/hook-decision.test.ts` 1, `other profile roots` 1, `git show` 1, `<work root>` 2

## Threat Flags

None. The change narrows an existing trust boundary (sandboxed shell to other onboardings, T-01-82) and adds no endpoint, auth path or schema.

## Next Phase Readiness

Together with plan 01-23, every gap P-3 `missing` item is covered. The contained invocation cannot read another onboarding through the hook or the sandbox and still reads its own staging; the CON-1 row is accurate about the bypasses that remain. A live T3 pass should re-check the `allowRead` re-allow on the installed host.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-04*

## Self-Check: PASSED
