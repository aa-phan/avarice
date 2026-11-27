---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 32
subsystem: ports
tags: [capability-descriptors, adapter-configs, artifact-store, composition, portability, fr-16, nfr-4]

requires:
  - phase: 04-06
    provides: "CapabilityDescriptor, STEP_REQUIREMENTS and requireCapabilities"
  - phase: 04-18
    provides: "RedactingArtifactStore and REDACTED_TEXT_KINDS"
  - phase: 04-26
    provides: "the descriptor-recording pattern for context sources"
  - phase: 04-30
    provides: "the artifact quota LocalArtifactStore carries"
provides:
  - "readonly descriptor on ArtifactStore, StagingWorkspace, RunWorkspace, RunSource and EgressProxy, implemented by every production adapter"
  - "adapter_configs rows for artifacts, staging, run-source, run-workspace and egress on every non-read-only composition"
  - "DepsOverrides.artifacts: the configuration seam for a different artifact store, always behind the RedactingArtifactStore"
  - "STEP_REQUIREMENTS rows run.handoff, run.install and onboarding.stage; descriptorsOf lists the five new descriptors"
affects: [04-33, 04-37]

actuals:
  tokens: 20000
  tasks: 3
  commits: 4
plan_head_before: f6ec876aae03481c6ab95d1533ce1e67f3582abe
plan_head_after: 98dd541b9116fc157eae8010ae43f110ffa14261

tech-stack:
  added: []
  patterns:
    - "A capability table typed Record<Exclude<keyof Port, 'descriptor'>, true>, so a method added to a port cannot go undeclared by its adapter"
    - "A structural test reads src/ports and src/adapters, so a new port or adapter class that skips the descriptor fails a test"

key-files:
  created:
    - test/unit/port-descriptors.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-32-red-task1.json
  modified:
    - src/ports/artifact-store.ts
    - src/ports/staging-workspace.ts
    - src/ports/run-workspace.ts
    - src/ports/run-source.ts
    - src/ports/egress-proxy.ts
    - src/adapters/fs/artifact-store.ts
    - src/adapters/fs/redacting-artifact-store.ts
    - src/adapters/git/staging-base.ts
    - src/adapters/git/staging-clone.ts
    - src/adapters/git/staging-worktree.ts
    - src/adapters/git/run-workspace.ts
    - src/adapters/git/run-source.ts
    - src/adapters/exec/allowlist-proxy.ts
    - src/domain/capability-requirements.ts
    - src/app/capabilities.ts
    - src/cli/composition.ts
    - test/unit/capability-requirements.test.ts
    - test/integration/skeleton.test.ts
    - test/integration/run-deps.test.ts

key-decisions:
  - "Capability keys are the port's own method names (plus the named rules contentAddressed, handoff and allowlist), not the plan's prose list prepare, remove, status, diff"
  - "The staging adapter name in the descriptor is its strategy (clone, worktree); one descriptor getter lives in GitStagingWorkspace and each subclass names its strategy"
  - "An overriding artifact store replaces the local store wholesale, including the profile's artifact quota, and is still wrapped in the RedactingArtifactStore"
  - "descriptorsOf skips an adapter that carries no descriptor, so a hand-built test AppDeps cast from a partial adapter publishes none instead of throwing"

requirements-completed: [FR-16, NFR-4]

coverage:
  - id: D1
    description: "ArtifactStore, StagingWorkspace, RunWorkspace, RunSource and EgressProxy declare readonly descriptor and every production adapter implements it"
    requirement: FR-16
    verification:
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#every adapter port declares a capability descriptor (FR-16)"
        status: pass
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#the staging and run workspace descriptors (FR-16)"
        status: pass
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#the run source and egress descriptors (FR-16)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Composition records artifacts, staging, run-source, run-workspace and egress descriptors in adapter_configs on a non-read-only command and nothing on a read-only one"
    requirement: FR-16
    verification:
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#composition records every composed adapter of these ports (FR-16)"
        status: pass
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#composition records the artifact store (FR-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "STEP_REQUIREMENTS names run.handoff, run.install and onboarding.stage, and an adapter lacking the capability returns unsupported with its reduced mode"
    requirement: FR-16
    verification:
      - kind: unit
        ref: "test/unit/capability-requirements.test.ts#run.handoff, run.install and onboarding.stage pass on the production adapters and are refused unsupported, with the reduced mode, when the adapter lacks the capability (FR-16)"
        status: pass
    human_judgment: false
  - id: D4
    description: "DepsOverrides.artifacts selects another artifact store by configuration, wrapped in the RedactingArtifactStore so it never sees a secret in a redacted kind"
    requirement: NFR-4
    verification:
      - kind: unit
        ref: "test/unit/port-descriptors.test.ts#the artifacts override (NFR-4, T-04-88)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The new reducedMode wording of run.handoff and onboarding.stage, and leaving the three new steps unwired at their call sites, are policy choices the plan did not specify"
    verification: []
    human_judgment: true
    rationale: "Refusal wording and the decision to defer call-site enforcement are the owner's to accept; no test asserts them beyond non-empty text"

duration: 9min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 32: Capability descriptors on every port Summary

**Every adapter port now declares a CapabilityDescriptor (typed over the port's methods), composition records all five newly described adapters in adapter_configs, and `DepsOverrides.artifacts` selects another artifact store while keeping it behind redaction.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-11-17T14:16:12Z
- **Completed:** 2026-11-17T14:25:00Z
- **Tasks:** 3
- **Files modified:** 21 (including the new test and the RED evidence)

## Accomplishments

- ArtifactStore, StagingWorkspace, RunWorkspace, RunSource and EgressProxy gain `readonly descriptor: CapabilityDescriptor`, implemented by LocalArtifactStore (`local-fs`), RedactingArtifactStore (forwards the inner descriptor with attribute `redacted: 'true'`), the clone and worktree staging adapters, CloneRunWorkspace (`clone`, with `handoff`), GitRunSource (`git-objects`) and AllowlistEgressProxy (`allowlist`, `loopbackOnly`, not offline).
- Composition records `artifacts`, `staging`, `run-source`, `run-workspace` and `egress` rows in adapter_configs (a read-only command records nothing), beside the executor, graph, gsd, host, context-source and credential rows that were already recorded.
- `DepsOverrides.artifacts` (test entries only) replaces the local store; the replacement is wrapped in the RedactingArtifactStore (T-04-88), proved by a memory store that never receives a secret of the `knowledge-manifest` kind.
- STEP_REQUIREMENTS gains `run.handoff` (run-workspace `handoff`), `run.install` (egress-proxy `allowlist`, reduced mode "run without the install step: declare no install check") and `onboarding.stage` (staging-workspace `prepare`); `descriptorsOf` lists the five new descriptors so `requireCapabilities` can check them.
- test/unit/port-descriptors.test.ts: every adapter port file declares the descriptor (no todo), the production classes implementing the five ports are an exact known set (a new adapter fails the test until covered), each adapter's capability keys name real methods, and a real `repo add` records the five rows.

## Task Commits

1. **Task 1 (tracer, TDD): artifact store descriptor, recording, artifacts override** - RED `0f1f85f` (test), GREEN `57f1cae` (feat)
2. **Task 2: staging and run workspace descriptors** - `aec43c6` (feat)
3. **Task 3: run source and egress descriptors, recording, step requirements** - `98dd541` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY (docs: complete plan).

## RED evidence (Task 1)

- Command: `node --test --test-reporter=tap test/unit/port-descriptors.test.ts`, exit 1; `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`), record at `04-32-red-task1.json`.
- Target: "LocalArtifactStore declares the local-fs adapter with put, get, has and contentAddressed, usable offline", failing on its own assertion that the store declares a descriptor.
- Semantic assessment: the target ran and failed on the planned missing behavior; the redacting-store, composition-row, override and artifact-store.ts structural cases failed for the same cause, the four later-port structural cases were todo, and the read-only case passed. No load, syntax or fixture fault.
- Tracer gate: the `<verify>` was re-run after GREEN and passed (`port-descriptors` 14 pass, 4 todo as planned) before expansion.

## Files Created/Modified

- `src/ports/*.ts` (five) - `readonly descriptor: CapabilityDescriptor`
- `src/adapters/fs/artifact-store.ts`, `redacting-artifact-store.ts` - local-fs descriptor; forwarded descriptor marked redacted
- `src/adapters/git/staging-base.ts`, `staging-clone.ts`, `staging-worktree.ts` - one descriptor getter, each subclass names its strategy
- `src/adapters/git/run-workspace.ts`, `run-source.ts`, `src/adapters/exec/allowlist-proxy.ts` - descriptors typed over the port methods
- `src/domain/capability-requirements.ts` - three new steps, three new reduced-mode texts
- `src/app/capabilities.ts` - descriptorsOf covers the five new descriptors and skips an adapter with none
- `src/cli/composition.ts` - `artifacts` override, recording loop
- `test/unit/port-descriptors.test.ts` - new; `test/unit/capability-requirements.test.ts` - published-key map and the new steps
- `test/integration/skeleton.test.ts`, `test/integration/run-deps.test.ts` - spies and fakes that implement the ports forward a descriptor

## Decisions Made

- Capability keys are each port's method names, plus the named rules `contentAddressed` (artifact store), `handoff` (run workspace, the D-02 name for `fetchIntoSource`) and `allowlist` (egress proxy). The plan's prose "prepare, remove, status, diff" names methods the staging port does not have, so the table follows the port and is type-checked against it.
- An overriding artifact store replaces the local store wholesale: the profile's artifact quota belongs to LocalArtifactStore and is not applied to a replacement.
- `GitStagingWorkspace` owns the staging descriptor; the egress descriptor is a module constant because `test/unit/footprint.test.ts` forbids a spread inside the proxy class body.

## Decisions needing owner review

1. **Reduced-mode wording.** The plan fixed only the `run.install` text. I wrote `run.handoff`: "none; without a hand-off the run leaves no review branch in the source" and `onboarding.stage`: "none; onboarding stops until a staging workspace can prepare a copy". Both say the step has no degraded form; change them if a degraded form exists.
2. **No call-site enforcement for the new steps.** The plan adds the rows and descriptors so a lacking adapter "returns unsupported"; `requireCapabilities(deps, 'run.handoff' | 'run.install' | 'onboarding.stage')` does, and a test proves it, but I did not add calls in the run supervisor or the onboarding stage. Hand-built test AppDeps carry fakes without descriptors, and a new refusal path would change exit paths and kill-point coverage. Plan 04-33 or a follow-up can wire them.
3. **Exemptions in the structural test.** `capability.ts`, `ledger.ts` (named by the plan) and `diagnostics.ts` (a read-only machine-facts probe with one implementation, not selected by configuration) are not held to the descriptor rule.
4. **Quota under an override.** A replacement artifact store is not subject to `limits.artifactQuotaMiB`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test fakes implementing the changed ports**
- **Found during:** Tasks 1 to 3 (type check)
- **Issue:** the spying ArtifactStore and StagingWorkspace objects in `test/integration/skeleton.test.ts`, and the two EgressProxy objects in `test/integration/run-deps.test.ts`, lacked the new descriptor (the plan's flagged assumption)
- **Fix:** each forwards the real adapter's descriptor
- **Files modified:** test/integration/skeleton.test.ts, test/integration/run-deps.test.ts
- **Verification:** `npm run typecheck` clean; both suites pass
- **Committed in:** 57f1cae, aec43c6, 98dd541

**2. [Rule 1 - Bug] Footprint guard tripped by a spread in the egress class**
- **Found during:** Task 3 (unit tier)
- **Issue:** `test/unit/footprint.test.ts` requires the AllowlistEgressProxy class body to hold no `...`; the descriptor literal spread the capability table
- **Fix:** the descriptor is a module-level constant the class property references
- **Files modified:** src/adapters/exec/allowlist-proxy.ts
- **Verification:** footprint and port-descriptors tests pass
- **Committed in:** 98dd541

**3. [Rule 3 - Blocking] descriptorsOf and the published-keys test**
- **Found during:** Task 3
- **Issue:** `descriptorsOf` would throw on a hand-built AppDeps whose partial adapter has no descriptor once the five new ports are listed; `test/unit/capability-requirements.test.ts` kept a closed map of published ports
- **Fix:** descriptorsOf skips an adapter with no descriptor; the map gains the three new ports, read from the adapters themselves
- **Files modified:** src/app/capabilities.ts, test/unit/capability-requirements.test.ts
- **Committed in:** 98dd541

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were needed to keep existing tests and guards valid; no scope creep.

## Issues Encountered

None beyond the deviations above. Test helpers that implement these ports: only the spies in `skeleton.test.ts` and `run-deps.test.ts` needed a descriptor; the casts in `extra-map-files.test.ts`, `run-discard-*` and `live-harness.ts` take the real adapters or a partial object and needed no change.

## Verification

- `node --test test/unit/port-descriptors.test.ts test/unit/capability-requirements.test.ts` 40 pass, 0 fail, 0 todo; `npm run typecheck` and `npm run check:boundaries` clean.
- Unit tier (`test/unit/**/*.test.ts`): 2765 tests, 0 fail after the footprint fix (one failure, fixed in 98dd541, was the only one).
- Integration files related to composition, redaction, profiles and the run ports, including the plan 04-22 exit gates (`profile-isolation`, `redaction-suite`): 236 pass, 0 fail. No frozen json-shapes fixture changed and no CLI message or exit path changed. The full suite is left to the orchestrator.

## Documentation surfaces

For plan 04-37 (docs/system), grounded in the code:

- **Descriptors:** the five new port descriptors (artifact-store `local-fs` with `redacted` when wrapped; staging-workspace `clone` / `worktree` with attribute `strategy`; run-workspace `clone` with `handoff`; run-source `git-objects`; egress-proxy `allowlist`, `loopbackOnly: true`, `offline: false`), their capability keys, and the rule that a capability table is typed over the port's methods.
- **Recorded adapters:** the `adapter_configs` names now written by a non-read-only composition: `artifacts`, `staging`, `run-source`, `run-workspace`, `egress` (new) beside `executor`, `graph`, `gsd`, the host row, `context-<adapter>` and the credential rows.
- **Port count:** 15 files under `src/ports`; 12 are adapter ports that declare a descriptor (agent-host, artifact-store, command-executor, context-source, credential-provider, egress-proxy, graph-tool, gsd-onboarding, notifier, run-source, run-workspace, staging-workspace); the other three (capability, ledger, diagnostics) are exempt. The structural test in `test/unit/port-descriptors.test.ts` is the authority for the count.
- **Configuration seam:** `DepsOverrides.artifacts` (test entries only, wrapped in redaction, quota not applied); step requirements `run.handoff`, `run.install`, `onboarding.stage`, defined but not yet enforced at a call site.
- **Findings line for `findings.md`:** `src/app/capabilities.ts` lists the new descriptors but no stage calls `requireCapabilities` for `run.handoff`, `run.install` or `onboarding.stage` (decision 2 above).

## Next Phase Readiness

Plan 04-33 can swap the executor and the artifact store by `DepsOverrides` alone and exercise the descriptor claims (T-04-89) with contract tests. No blockers.

## Known Stubs

None.

## Threat Flags

None. The plan's T-04-88 (a swapped store bypassing redaction) is mitigated and tested; T-04-89 is accepted as planned.

## Self-Check: PASSED

Created files exist (`test/unit/port-descriptors.test.ts`, `04-32-red-task1.json`); commits `0f1f85f`, `57f1cae`, `aec43c6` and `98dd541` are on the branch; `commits: 4` is measured from the ledger base `f6ec876`.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
