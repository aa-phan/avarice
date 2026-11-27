---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 06
subsystem: capabilities
tags: [capability, descriptors, enforcement-map, fr-16, fr-17, fr-18, sec-6, typescript]

requires:
  - phase: 01
    provides: "CapabilityDescriptor, the PortError `unsupported` variant, the gsd-intel and gsd-graph context adapters, the GSD onboarding adapter"
  - phase: 02
    provides: "Gate G0 at the run's verify-enforcement step"
provides:
  - "STEP_REQUIREMENTS: a table of what each run and onboarding step needs from adapter descriptors, with the reduced mode a refusal names (src/domain/capability-requirements.ts)"
  - "requireCapabilities(deps, step) and descriptorsOf(deps), called at the G0 entry before any unit and before mapping starts (src/app/capabilities.ts)"
  - "isNamespacedExtension and the extension rule in the capability port header"
  - "ENFORCEMENT_MAP: 18 controls, each with enforcer, AVARICE role, bypass limitation and a tracked proving test or an unverified reason (src/domain/enforcement-map.ts)"
affects: [04-32, 04-37, 04-38, 04-39]

actuals:
  tokens: 21000
  tasks: 3
  commits: 6
plan_head_before: 4b33ce8f216cbfdab697140847fd51841849e544
plan_head_after: 433ad4c4d22394fb4f002196f7f7120b28f78b2e
commits: 6

tech-stack:
  added: []
  patterns:
    - "The domain table reads a descriptor only as `{ port, capabilities }`, so it needs no import from ports; a requirement is met when a descriptor of its port declares the capability `true`, and `false` is absent"
    - "A refusal is `unsupported` with `capability` as `<port>.<capability>` and the step's `reducedMode`; the stage records it through its existing block path and starts nothing"
    - "A code table checked like docs/containment.md's matrix: a checker over synthetic tables first (duplicate id, empty cell, untracked test path), then the real table"

key-files:
  created:
    - src/domain/capability-requirements.ts
    - src/app/capabilities.ts
    - src/domain/enforcement-map.ts
    - test/unit/capability-requirements.test.ts
    - test/unit/extensions-namespace.test.ts
    - test/unit/enforcement-map.test.ts
    - test/integration/run-capability-gate.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-06-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-06-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-06-red-task3.json
  modified:
    - src/app/run-stages/prepare.ts
    - src/app/stages/workspace.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - src/ports/capability.ts
    - src/ports/gsd-onboarding.ts

key-decisions:
  - "run.unit requires `agent-host.contained-invocation`, not `resume`: that is the key every host publishes, and the production Claude host publishes `resume: false`, so requiring it would refuse every real run"
  - "A capability failure at G0 is a second recorded failure rule `capability` only when the host did not already fail enforcement; the block reason is `enforcement_failure` either way and the block data carries the capability and reduced mode"
  - "initPlanning and the onboarding.planning.init step share one reduced mode constant naming /gsd-new-project; the capability stays false"
  - "The enforcement map rows for controls built later in this phase are `unverified` with `proved by plan 04-NN`; the two host-limitation rows carry hostLimitation 3 or 4 and profileStrength not-claimed"

patterns-established:
  - "Step names are `onboarding.map.${MappingMode}`, so a new mapping mode cannot be added without a requirement row"
  - "Reduced-mode text lives next to the requirement it belongs to and nowhere else"

requirements-completed: [FR-16, FR-17, FR-18, SEC-6]

coverage:
  - id: D1
    description: "A step that requires a capability the adapters do not declare is refused unsupported, naming the capability and the reduced mode, before the step starts; false equals absent; an empty requirement list never refuses; the first missing capability in declared order is named"
    requirement: FR-16
    verification:
      - kind: unit
        ref: "test/unit/capability-requirements.test.ts#tracer: a run step requiring a capability the host lacks is refused unsupported with its reduced mode (FR-16)"
        status: pass
      - kind: unit
        ref: "test/unit/capability-requirements.test.ts#checkRequirements"
        status: pass
      - kind: unit
        ref: "test/unit/capability-requirements.test.ts#requireCapabilities against the composed dependencies"
        status: pass
    human_judgment: false
  - id: D2
    description: "The run's G0 entry asks for run.unit before any invocation and records a capability failure naming the capability and reduced mode; the onboarding workspace stage asks for the chosen mapping step before mapping"
    requirement: FR-16
    verification:
      - kind: integration
        ref: "test/integration/run-capability-gate.test.ts#an enforced host without contained-invocation blocks the run with a G0 capability failure, and nothing is invoked"
        status: pass
    human_judgment: false
  - id: D3
    description: "Extension names are <provider>.<feature> and never keys of a core capabilities map, across every descriptor the production adapters publish"
    requirement: FR-17
    verification:
      - kind: unit
        ref: "test/unit/extensions-namespace.test.ts#descriptors the production adapters publish (FR-17)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ExternalRef.id from gsd-intel and gsd-graph keeps the provider identifier byte for byte, including ':', '#', '/', spaces and non-ASCII"
    requirement: FR-18
    verification:
      - kind: unit
        ref: "test/unit/extensions-namespace.test.ts#ExternalRef.id is the provider identifier byte for byte (FR-18)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The SEC-6 enforcement map is a code table of 18 rows with unique ids, non-empty enforcer and bypass cells and tracked test paths; the host limitation 3 and 4 rows are unverified and not-claimed"
    requirement: SEC-6
    verification:
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts#ENFORCEMENT_MAP (SEC-6)"
        status: pass
      - kind: unit
        ref: "test/unit/enforcement-map.test.ts#the table checker (control cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The enforcement-map row order is the order the documentation renders"
    requirement: SEC-6
    verification: []
    human_judgment: true
    rationale: "Backstop truth in the plan: the order matches docs/enterprise-adaptation.md by construction and is not asserted by a test; plan 04-37 renders the table from this order"

duration: 21min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 06: Capability declarations and the SEC-6 enforcement map Summary

**A step that needs a capability no adapter declares is refused `unsupported` with its reduced mode before it starts (G0 for a run unit, the workspace stage for mapping), extensions stay `<provider>.<feature>` with provider IDs verbatim, planning initialization names `/gsd-new-project`, and the SEC-6 enforcement map is an 18-row tested code table**

## Performance

- **Duration:** 21 min
- **Started:** 2026-11-16T18:52:00Z
- **Completed:** 2026-11-16T19:13:00Z
- **Tasks:** 3
- **Files modified:** 15 (10 created, 5 modified)

## Accomplishments

- `src/domain/capability-requirements.ts` holds `STEP_REQUIREMENTS` for nine steps (`run.unit`, `run.check`, five `onboarding.map.<mode>` steps, `onboarding.index.graph`, `onboarding.planning.init`) and `checkRequirements`, which names the first unmet requirement in declared order as `<port>.<capability>` with the step's reduced mode. A capability set to `false`, an absent one and a missing descriptor are the same refusal; an empty requirement list never refuses.
- `src/app/capabilities.ts` collects the descriptors of `host`, `executor`, `graph`, `gsd`, both context sources and the notifier, and `requireCapabilities(deps, step)` is called at the G0 entry (`verify-enforcement`, before any unit) and in the workspace stage after the mapping mode is chosen (before staging is configured and any host starts). Both use the existing block paths; no new state.
- The extension rule (`isNamespacedExtension`, `^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9.]*$`) is written into the `CapabilityDescriptor` header, and a test holds every production descriptor to it and to "never a key of a capabilities map".
- gsd-intel (`<source>#<key>`) and gsd-graph (node id) are tested to keep provider identifiers byte for byte, with `:`, `#`, `/`, leading and trailing spaces and non-ASCII; a trim mutation of the graph adapter failed the test, and was reverted.
- `initPlanning` and the `onboarding.planning.init` step share `PLANNING_INIT_REDUCED_MODE` ("initialize planning attended with /gsd-new-project; AVARICE records the result"); no "Phase 4" text remains in the GSD adapter.
- `src/domain/enforcement-map.ts` holds 18 rows in the order of the written map (three external-platform rows, host permissions, sandbox confinement, tool-call decisions, budgets, privileged approval, approval single-use, profile isolation, redaction, prompt injection) followed by write scope, network scope, credential denial, rank-1 policy fail-closed, restricted mode and the host limitation 3 row. Nine rows point at a tracked test; the others are `unverified` with a reason (the platform owns it, or `proved by plan 04-NN`).

## Task Commits

1. **Task 1 (tracer): a run step requiring a capability the host lacks is refused `unsupported` with its reduced mode before any invocation** (RED 11 of 15 failing, `RED_EVIDENCE_OK`)
   - `3c7467e` test: failing unit cases, the G0 integration case, skeleton modules, `04-06-red-task1.json`
   - `2b96659` feat: requirement table, `requireCapabilities`, wiring in `prepare.ts` and `workspace.ts`
2. **Task 2: namespaced extensions, verbatim provider IDs, initPlanning reduced mode** (RED 1 of 8 failing, `RED_EVIDENCE_OK`)
   - `855c54a` test: extension, verbatim-ID and initPlanning cases, `04-06-red-task2.json`
   - `71c7ea5` feat: shared reduced-mode constant, adapter text, port header rule
3. **Task 3: the SEC-6 enforcement map** (RED 4 of 10 failing, `RED_EVIDENCE_OK`)
   - `ef298fc` test: checker controls, table cases, empty skeleton, `04-06-red-task3.json`
   - `433ad4c` feat: the 18-row table

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

All three TDD tasks have a `test(04-06)` commit before the `feat(04-06)` commit.

- Task 1 RED: target "run.unit on a host that does not declare contained-invocation names that capability and the documented reduced mode" failed on the planned assertion against a skeleton whose `checkRequirements` answered ok. Semantic assessment: the target ran and failed on the planned assertion; no import, syntax or fixture fault. The G0 integration case failed on `decision` against the planned `enforcement_failure` (the fake host then ran to its own end).
- Task 2 RED: only "returns unsupported and names /gsd-new-project, not a phase number" fails, on the old reduced-mode text. The seven passing cases guard behavior that already held: `isNamespacedExtension` was implemented with the step table in Task 1, and the context adapters already keep IDs verbatim. They are regression guards, not drivers; the trim mutation above shows the verbatim case can fail.
- Task 3 RED: the row-count target fails against an empty skeleton table; the six passing cases are the synthetic checker controls and the soundness case, which pass vacuously on an empty table.

Tracer gate: the tracer `<verify>` command passed on the proven slice (16 of 16 with the integration case) and the existing run supervisor, run start, preflight, staging and baseline suites stayed green (99 of 99) before expansion.

## Decisions needing owner review

The plan left these semantics open and I chose them; each is small to change.

1. **`run.unit` requires `contained-invocation`, not `invoke` and `resume`.** The plan text names "agent-host invoke, resume", but no host publishes `invoke`, and the production Claude host publishes `resume: false`; requiring `resume` would refuse every real run at G0. The key every host already publishes for "can run a contained invocation" is `contained-invocation`. A `run.resume` step is not added; the Claude host declares `resume: false` although the adapter accepts `resumeSessionId`, which looks like a descriptor that understates the adapter (not changed here).
2. **Block reason for a capability failure at G0 is `enforcement_failure`.** The agent host is the only descriptor `run.unit` reads, so the refusal is a containment failure of the host. If the owner wants a distinct reason it needs a new `RunBlockedReason`, which this plan did not add (no new state).
3. **Which capabilities the other steps require** (invented from the descriptors that exist): `run.check` needs executor `cancel` and `process-group-kill` (no code path calls `run.check` yet, so this only becomes live when a later plan does); `onboarding.index.graph` needs graph-tool `extract-code` and `cluster` (not called yet either); `onboarding.map.adopt` needs `gsd-onboarding.adopt-map`, a key no adapter declares, matching the existing refusal in the mapping-mode decision. `onboarding.map.fast` and `full` use `map-fast` and `map-full` with the reduced mode "none; onboarding stops until an admitted gsd-core offers the map workflow".
4. **Enforcer assignments in the enforcement map**: privileged-command approval and tool-call decisions are `host` (the host runs AVARICE's hook); write scope, network scope and credential denial are `os-sandbox` although the hook and AVARICE's configuration also take part; prompt-injection scanning, budgets, profile isolation, redaction, approval single-use, the rank-1 policy and restricted mode are `avarice`. The written table has one enforcer cell per row, so the choice of the main one is a judgment.
5. **Test attributions**: profile isolation is attributed to `test/integration/run-sandbox-other-profiles.test.ts` (it proves the sandbox denial of other profiles' roots, not the whole of SEC-1); plan 04-22 builds the exit suite and should replace it or add to it. Prompt-injection scanning is attributed to `test/integration/context.test.ts` (document text printed fenced as data).

## Files Created/Modified

- `src/domain/capability-requirements.ts` - `StepName`, `StepRequirement`, `DescriptorFacts`, `STEP_REQUIREMENTS`, `checkRequirements`, `isNamespacedExtension`, `PLANNING_INIT_REDUCED_MODE`
- `src/app/capabilities.ts` - `descriptorsOf`, `requireCapabilities`
- `src/domain/enforcement-map.ts` - `ENFORCERS`, `ControlProof`, `EnforcementRow`, `ENFORCEMENT_MAP`
- `src/app/run-stages/prepare.ts` - G0 asks for `run.unit`; a `capability` failure row, a note and block data naming the capability and reduced mode
- `src/app/stages/workspace.ts` - asks for `onboarding.map.<mode>` after the mode decision; blocks `scope_unavailable` with capability and reduced mode
- `src/adapters/gsd/gsd-onboarding.ts`, `src/ports/gsd-onboarding.ts`, `src/ports/capability.ts` - reduced-mode text, comments, the extension rule header
- `test/unit/capability-requirements.test.ts`, `test/unit/extensions-namespace.test.ts`, `test/unit/enforcement-map.test.ts`, `test/integration/run-capability-gate.test.ts` - 34 cases
- `04-06-red-task1.json`, `04-06-red-task2.json`, `04-06-red-task3.json` - RED evidence records

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's `run.unit` requirement keys do not exist**
- **Found during:** Task 1
- **Issue:** The plan names `invoke` and `resume` for the agent host and a test where `invoke: true` and no `resume` is refused. No host declares `invoke`; the production host declares `resume: false`, so the plan's requirement would block every real run. The plan itself says to read each adapter's actual keys first.
- **Fix:** `run.unit` requires `contained-invocation`; the refusal test uses a host with only `headless`, and a test checks every requirement against the keys the adapters publish.
- **Files modified:** src/domain/capability-requirements.ts, test/unit/capability-requirements.test.ts
- **Verification:** `node --test test/unit/capability-requirements.test.ts`; supervisor, start, preflight, staging and baseline integration suites green (99 of 99)
- **Committed in:** 3c7467e, 2b96659

**2. [Rule 2 - Missing critical] Wiring test and the G0 data for the block**
- **Found during:** Task 1
- **Issue:** The plan's acceptance for the call sites is a grep; nothing proved the stage actually refuses.
- **Fix:** `test/integration/run-capability-gate.test.ts` runs the supervisor in process with an enforced host that lacks `contained-invocation` and asserts the run blocks, no invocation started, and the G0 row names the capability and reduced mode.
- **Files modified:** test/integration/run-capability-gate.test.ts
- **Committed in:** 3c7467e

**3. [Rule 3 - Blocking] Domain cannot import ports; descriptors are read structurally**
- **Found during:** Task 1
- **Issue:** `check:boundaries` allows the domain no import of `CapabilityDescriptor`.
- **Fix:** `checkRequirements` takes `DescriptorFacts` (`port`, `capabilities`), which a `CapabilityDescriptor` satisfies.
- **Files modified:** src/domain/capability-requirements.ts
- **Committed in:** 2b96659

**4. [Rule 3 - Blocking] Extra RED records**
- **Found during:** Tasks 2 and 3
- **Issue:** The plan lists only `04-06-red-task1.json`; Tasks 2 and 3 are also TDD.
- **Fix:** Added `04-06-red-task2.json` and `04-06-red-task3.json`, both `RED_EVIDENCE_OK`.
- **Committed in:** 855c54a, ef298fc

**5. [Rule 3 - Blocking] The extension and ID tests use the port, not the fake GSD readers**
- **Found during:** Task 2
- **Issue:** The plan points at `test/helpers/fake-gsd-core.ts`, which fakes the gsd-tools binary; the adapters under test read through the `GsdOnboarding` port.
- **Fix:** The two context adapters are driven with a stub of `intelQuery` and `graphifyQuery` at the port, so the adapters' own mapping functions run on the fixture entries.
- **Files modified:** test/unit/extensions-namespace.test.ts
- **Committed in:** 855c54a

---

**Total deviations:** 5 auto-fixed (1 bug, 1 missing critical, 3 blocking). **Impact on plan:** No change of scope; the first deviation changes one requirement key from the plan's text to the key that exists.

## Issues Encountered

- `FR-17`, `FR-18` and `SEC-6` are declared by sibling plans of this phase (04-20, 04-27, 04-32), so `requirements.ready-ids` may mark none of them ready until the last declaring plan finishes.
- The Claude host adapter accepts `resumeSessionId` but publishes `resume: false`. Left as is; plan 04-32 (descriptors on every port) is the natural place to decide.

## Documentation surfaces (for plan 04-37)

- Step requirement table: nine steps, the port and capability each needs, the reduced mode each names (`none; no unit runs without a contained agent host`, `full map in staging`, `index recorded absent`, `initialize planning attended with /gsd-new-project; AVARICE records the result`)
- Refusal shape: `unsupported`, capability `<port>.<capability>`, `reducedMode`; false equals absent; a missing adapter is the same refusal; the step does not start and nothing is simulated
- Where it applies: G0 entry (a `capability` failure row, block reason `enforcement_failure`, block data `capability` and `reducedMode`) and the onboarding workspace stage (block reason `scope_unavailable`)
- Extension rule: `<provider>.<feature>`, never a key of a capabilities map; provider IDs verbatim in `ExternalRef.id` (gsd-intel `<source>#<key>`, gsd-graph node id)
- Planning initialization stays `unsupported`; reduced mode names `/gsd-new-project`
- Enforcement map rows: the 18 ids and their enforcer, role, bypass, and proof (nine tracked tests; `unverified` for the three external-platform rows, plans 04-07, 04-16, 04-19 and 04-23, and the host limitation 3 and 4 rows, which no profile claims as enforced)
- Findings for `docs/system/findings.md` (plan 04-39): `docs/enterprise-adaptation.md` lists `Enforcer` as host, os-sandbox, external-platform, avarice in the plan but the written table names SCM platform, CI system and identity provider (all `external-platform` here); the written table names "Agent host" for hook-evaluated controls; `src/domain/result.ts:7` `Enforcer` type has no `os-sandbox` member while the enforcement map does

## Known Stubs

None. The `unverified` rows are statements of what is not yet proved, not placeholders in behavior; each `proved by plan 04-NN` row is named for the plan that replaces it with a test path.

## Threat Flags

None beyond the plan's register. T-04-14 (a step running on an adapter that cannot do it) is mitigated by `requireCapabilities` at the two entry points, false equal to absent, tested. T-04-15 (a control documented without its bypass) is mitigated by the checker that fails any empty enforcer or bypass cell. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-32 (descriptors on every port) can add rows to `STEP_REQUIREMENTS` for the ports that have none today. Plans 04-07, 04-16, 04-19 and 04-23 replace their `unverified` rows with the path of the test they create. Plan 04-37 documents the surfaces above.

## Self-Check: PASSED

- Files present: all ten created files and the five modified files
- Commits present on this branch: 3c7467e, 2b96659, 855c54a, 71c7ea5, ef298fc, 433ad4c
- Acceptance: `grep -n "requireCapabilities"` prints a line in both stage files; `grep -n "Phase 4" src/adapters/gsd/gsd-onboarding.ts` prints nothing; the red-task JSON records classify `RED_EVIDENCE_OK`; `ENFORCEMENT_MAP` has 18 rows and the two host-limitation rows are unverified with `not-claimed`
- Plan verification: `node --test test/unit/capability-requirements.test.ts test/unit/extensions-namespace.test.ts test/unit/enforcement-map.test.ts` green, `npm run typecheck` clean, `npm run check:boundaries` ok (105 files); full unit suite 2477 of 2477 passing; run supervisor, run start, preflight, staging, baseline workflow, gsd adapter and context integration suites green

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
