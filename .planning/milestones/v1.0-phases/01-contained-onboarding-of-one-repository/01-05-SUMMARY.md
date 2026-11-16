---
phase: 01-contained-onboarding-of-one-repository
plan: 05
subsystem: application
tags: [onboarding, stages, lease, kill-points, fake-host, fail-closed, tracer, cli]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-01 domain (lifecycle, contract compiler, validation, project record); 01-03 SqliteLedger, status, composition root; 01-04 StagingWorkspace, LocalArtifactStore, UnavailableAgentHost"
provides:
  - "avarice onboard --policy onboarding [--promote none] <repo>: register, contract, staging, host invocation, validation, activation; exit 0 active, 3 otherwise"
  - "startOnboarding, runOnboarding (lease-holding stage loop) and faultPoint (generic SIGKILL kill points via AVARICE_FAULT)"
  - "Stage modules register/contract/workspace/map/validate/index-stage/activate behind a StageContext whose commit helpers fire the kill points"
  - "AppDeps.host, .staging, .artifacts; DepsOverrides.host (only test entries pass it); production composition always builds UnavailableAgentHost"
  - "FakeAgentHost (test/helpers) and test/helpers/test-cli.ts (AVARICE_FAKE_HOST options JSON)"
  - "test/integration/skeleton.test.ts: the walking-skeleton test later plans re-run (12 tests)"
affects: [01-06, 01-08, 01-09, 01-10, 01-11, 01-12, 01-14, 01-15, 01-16, 01-19]

actuals:
  tokens: 16700
  tasks: 2
  commits: 2
plan_head_before: c8f6a021da2a26b63f65b480e0300ae6e19c1cf5
plan_head_after: 1ff1c306f85ea751d6d0e42fe52a933ab1854d5a

tech-stack:
  added: []
  patterns:
    - "Stages receive a StageContext and never import the service; ctx.checkpoint/transition/activate commit through the Ledger and then fire faultPoint('after-checkpoint:<action>') and faultPoint('after-transition:<state>'), so no stage file carries fault code"
    - "A checkpoint's next_action names the action about to run; it is committed before that action's side effect (prepare-workspace before the worktree add, launch:map before invoke, activate before the artifact puts)"
    - "The stage loop re-reads the row after each stage and returns an internal error if state and version did not move, so a stage that forgets to transition cannot spin"
    - "Overrides are the only way to swap the host: createDeps(env, { host }) from a test entry; bin/avarice.ts passes nothing"
    - "Tests that observe ordering decorate the ports (host, staging, artifact store) and read the ledger's latest checkpoint at the moment of each call"

key-files:
  created:
    - src/app/onboarding-service.ts
    - src/app/stages/stage.ts
    - src/app/stages/shared.ts
    - src/app/stages/register.ts
    - src/app/stages/contract.ts
    - src/app/stages/workspace.ts
    - src/app/stages/map.ts
    - src/app/stages/validate.ts
    - src/app/stages/index-stage.ts
    - src/app/stages/activate.ts
    - src/cli/commands/onboard.ts
    - test/helpers/fake-agent-host.ts
    - test/helpers/test-cli.ts
    - test/integration/skeleton.test.ts
  modified:
    - src/app/deps.ts
    - src/cli/composition.ts

key-decisions:
  - "A request the contract compiler refuses (promote other than none, budget above the preset, unknown mode) blocks the onboarding with reason decision at the discovered stage, with the compiler message in the event and on stdout, before a contract or a worktree exists; exit 3"
  - "Validation retry: validation_failed records one attempt row per rejection (keyed by the row version so a re-run does not double count) and re-enters mapping while attempts <= contract budgets.retry (1), then blocks with decision; a missing map file therefore gives validation_failed twice and two attempts"
  - "The transition into planning_ready writes next action activate (not index:code-graph), because no index step exists yet; index-stage.ts commits a second activate checkpoint, which is where after-checkpoint:activate fires; 01-14 widens this"
  - "Host outcome mapping in the map stage: progressed -> validating, budget_exhausted -> blocked(budget_exhausted), paused -> paused, denied/failed/no_progress/inconclusive -> blocked(decision); a host error result leaves the onboarding in mapping and fails the run (resumable)"
  - "The record's onboardedAt (and so project_records.onboarded_revision) is git: plus the pin recorded at registration; mapping.scope is ['.']; notMapped holds the dirty and untracked path names from preflight; artifacts are recorded with retention evidence in store local"
  - "activate stores the seven map documents and a canonical-JSON snapshot manifest in the artifact store and writes only digests, paths and stamps to the ledger (the prohibition is tested by scanning every non-artifact file in the data root for a document marker, with a positive control)"
  - "registerAndPreflight turns an inspectRepo internal or not_found error into an invalid repoPath error (exit 64) so a non-repository is a usage error, not an internal one"

patterns-established:
  - "Adding a stage: export a Stage from src/app/stages/, register it for its state in STAGES in onboarding-service.ts; commit through ctx so kill points exist for free"
  - "Test CLI helpers that call main() at import time must guard on NODE_TEST_CONTEXT, because a bare `node --test` loads every file under test/"

requirements-completed: [ONB-1, ONB-2, ONB-9, ONB-12, NFR-2]

coverage:
  - id: D1
    description: "node test/helpers/test-cli.ts onboard --policy onboarding {scratchRepo} with the fake host ends active with one project_records row at version 1 whose onboarded_revision is git: plus the scratch HEAD recorded at registration, mapping full and completeness complete, lease released"
    requirement: ONB-1
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#takes a scratch repository to an active project record version 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "bin/avarice status --json (production entry, no fake host, network denied under sandbox-exec) lists the project as active, record v1, completeness complete, mapping mode full"
    requirement: NFR-2
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#is read back by `bin/avarice status --json` with no host and no network"
        status: pass
    human_judgment: false
  - id: D3
    description: "State sequence discovered, contract_proposed, mapping, validating, planning_ready, active; every checkpoint row has a matching event; each stage commits its checkpoint before the side effect it names (worktree add, ensureDir, invoke, first artifact put observed against the ledger's latest checkpoint)"
    requirement: ONB-1
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#walks discovered ... active with one event per checkpoint; #has the matching checkpoint in the ledger when the worktree, the invocation and the artifact store are touched"
        status: pass
    human_judgment: false
  - id: D4
    description: "The scratch checkout (HEAD, branch, porcelain status including untracked files, file bytes) is identical before and after onboarding, in the active, blocked, retry-exhausted and promotion-refused cases; generated files exist only in the staging worktree"
    requirement: ONB-9
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#leaves the user checkout byte-identical and writes every generated file into staging (and the checkoutSnapshot assertions in the Task 2 describes)"
        status: pass
    human_judgment: false
  - id: D5
    description: "bin/avarice onboard --policy onboarding {scratchRepo} with the production host ends blocked (enforcement_failure), exit 3, no onboarding_steps rows (no invoke), an empty or absent staging .planning/codebase, no project record; the host is recorded as unavailable with enforcement none"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#the production path fails closed"
        status: pass
    human_judgment: false
  - id: D6
    description: "A fake host that omits TESTING.md (or stamps the wrong commit) gets validation_failed, one retry, then blocked (decision) with two attempt rows and two launch:map steps; --promote copy blocks (decision), exit 3, with the compiler message, before a contract or any staging exists"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#a malformed map is retried once, then blocks with a decision; #promotion other than none is refused"
        status: pass
    human_judgment: false
  - id: D7
    description: "The fake host is referenced from nothing under src/ or bin/, and the ledger holds no map document text (documents found only under {dataRoot}/artifacts)"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#the fake host cannot reach production; #the ledger holds no map document text"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-02
---

# Phase 01 Plan 05: Onboarding Skeleton Summary

**`avarice onboard` now takes a scratch repository from unregistered to an immutable active project record through the real ledger, staging worktree and artifact store with a fake AgentHost, `status` reads it back offline, and the production host path blocks with `enforcement_failure` without ever invoking anything.**

## Performance

- **Duration:** about 12 min (start time was not captured at execution start; estimated from the previous plan's last commit at 13:26 local and this plan's last commit at 13:37)
- **Completed:** 2026-11-02T19:37Z
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 TDD-marked)
- **Files created:** 14, modified: 2

## Accomplishments

- Tracer proven end to end: `startOnboarding` (preflight through the StagingWorkspace port, registration, `discovered`) then `runOnboarding` (lease, contract, worktree at the pin, enforcement check, map invocation, validation, index checkpoint, record build and `insertRecordAndActivate`) reaches `active` with project record version 1; `bin/avarice status --json` shows it with the network denied.
- Fail closed from day one: production composition only builds `UnavailableAgentHost`, the workspace stage blocks with `enforcement_failure` before the map directory or any invocation file exists, and a test asserts no `onboarding_steps` row, no map file and no record.
- Generic kill points: `faultPoint` plus commit helpers in the stage context, so `AVARICE_FAULT=after-transition:<state>` or `after-checkpoint:<action>` SIGKILLs at every committed boundary without touching a stage file (01-06 builds the resume suite on this).
- Bounded validation retry: a map missing a file or stamped with the wrong commit gets one remap, then `blocked (decision)`, with two attempt rows.
- Skeleton test: 12 tests, including the checkout byte-identity comparison in every outcome, ordering of checkpoints against side effects through decorated ports, and a scan proving map document text is only in the artifact store.

## Task Commits

1. **Task 1: Tracer** - `d5c4b1f` feat(01-05). Tracer feedback gate: auto mode off, `HUMAN_VERIFY_MODE` default (`end-of-phase`), `<verify>` automated-only, so it was re-run end to end (7 of 7, full suite 132 of 132 after one fix, below) and passed before the expansion task.
2. **Task 2: Fail-closed production path and validation retry path** (TDD) - `1ff1c30` test(01-05). No production change was needed (see TDD Gate Compliance).

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

Task 2 is `tdd="true"`. Its RED could not be produced honestly: the fail-closed enforcement check, the retry-then-block rule and the compiler refusal are all named in Task 1's action text and were built there, so the five new tests were green on arrival (`node --test --test-reporter=tap`, exit 0, 12 tests, 12 pass, 0 fail). Per the fail-fast rule for an unexpected GREEN I investigated instead of continuing: the behaviours exist because the tracer needed them to reach `blocked`, and the tests are not vacuous. Mutation checks, each restored from a copy afterwards:

- workspace stage `enforcement !== 'enforced'` replaced by `false`: the production fail-closed test fails (11 pass, 1 fail).
- retry rule `count <= retry` replaced by `false`: the "validation_failed twice" test fails (11 pass, 1 fail). Replaced by `true` it never terminates (the loop retries forever), which the 120 s tool timeout cut off; no test asserted that mutant away.
- compiler refusal bypassed (`promote` forced to `none`): the `--promote copy` test fails (11 pass, 1 fail).

There is therefore a `test(01-05)` commit (`1ff1c30`) and a `feat(01-05)` commit (`d5c4b1f`), but in the reverse order from RED, GREEN. No RED evidence record exists for Task 2 and `gsd_run check tdd-red-evidence` was not run (there was no failing target test to classify). Flag for the end-of-phase TDD review.

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans are most likely to trip on:

- Stages take a `StageContext`; use `ctx.checkpoint`, `ctx.transition` and `ctx.activate`, never the ledger directly for state changes, or the kill points are skipped.
- A checkpoint names the action that is about to run. After `contract_proposed` the log is `prepare-workspace` (transition), `prepare-workspace` (stage), `configure-gsd`, `verify-enforcement`, then the `mapping` transition writes `launch:map`.
- `runOnboarding` stops on any state with no stage (`paused`, `validation_failed` is handled, `stale`, `planning`), returning the state; the command exits 3 for anything but `active`.
- `startOnboarding` fires `after-transition:discovered` and `after-checkpoint:compile-contract` itself, because `createOnboarding` is where that checkpoint is written; a kill there leaves a `discovered` onboarding with no lease for `resume`.
- The map stage writes the step `launch:map` (attempt n) as `started` before `host.invoke` and `completed` or `failed` after; 01-06's reconcile logic can use a `started` row with no `completed` as the "invocation may be in flight" signal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `test/helpers/test-cli.ts` failed under a bare `node --test`**
- **Found during:** Task 1 (full-suite run)
- **Issue:** `npm test` is `node --test`, which also loads every file under `test/`. `test-cli.ts` ran `main()` with no arguments at import, exited 64 and made the runner report a failed test (131 of 132).
- **Fix:** the helper runs `main()` only when `NODE_TEST_CONTEXT` is unset (the runner sets it; `runCli` deletes it for real invocations).
- **Files modified:** test/helpers/test-cli.ts
- **Verification:** `npm test` 132 of 132, and the CLI-driven tests still run the helper as a child process.
- **Committed in:** d5c4b1f

### Design choices the plan left open

- Two files not in the plan's list: `src/app/stages/stage.ts` (the `Stage`/`StageContext` types, so stages never import the service and the kill points stay generic) and `src/app/stages/shared.ts` (contract loading and map-document reading shared by map, validate and activate). Neither is edited by a later plan's own stage file.
- Retention class for stored artifacts is `evidence` and the store name is `local`; the plan did not fix the vocabulary.
- `--mode` is not exposed on the command (the plan lists only `--promote`); `startOnboarding` accepts it and defaults to `full` for 01-09.

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact on plan:** none on scope; the Task 2 TDD ordering note above is a gate finding, not a code deviation.

## Issues Encountered

- The plan start time was not captured at execution start; duration is an estimate.
- An always-retry mutant of the retry rule loops forever and had to be killed; the lease TTL (180 s) does not stop it because the loop renews each pass. Not a production risk (the budget is a constant 1) but worth knowing for 01-06's lease tests.

## Authentication Gates

None.

## Known Stubs

None that block the plan goal. Two intentional seams, each owned by a later plan:

- `workspace.ts`: `configure-gsd` is a checkpoint only (GSD `config-set` arrives in 01-09).
- `index-stage.ts`: commits the `activate` checkpoint only; the index steps arrive in 01-14. `status` therefore reports `indexes: none`, which is true.

`buildProjectRecord` still writes `gsd.version: 'unknown'` (01-09 reads the version).

## Threat Flags

None new. T-01-02 (host elevation) mitigated and tested: only `UnavailableAgentHost` is built unless `main()` is given `overrides.host`, and a test scans `src/` and `bin/` for any reference to the fake host or its env var. T-01-65 (stage ordering) mitigated and tested against the ledger at the moment of each side effect; the SIGKILL suite is 01-06. T-01-66 mitigated: `notMapped` holds names only, asserted for a modified file, an untracked file and an untracked `.env`. T-01-SC: no installs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-06 can drive `AVARICE_FAULT` against any `after-transition:<state>` / `after-checkpoint:<action>` point and re-run through `runOnboarding` (it only needs `acquireLease` takeover on expiry and a `resume` command); `getOnboarding`, `latestCheckpoint` and the `launch:map` step give the recovery inputs.
- 01-08 replaces the body of `registerAndPreflight` only; 01-09 fills `configure-gsd` in `workspace.ts`; 01-10 replaces the validation and record-builder calls in `validate.ts`/`activate.ts`; 01-14 extends `index-stage.ts`; 01-15 swaps the host in `composition.ts`.
- `npm test` (137), `npx tsc -p .` and `node scripts/check-boundaries.ts` (25 files) are green.
- Documented local full-stack run: `bin/avarice onboard --policy onboarding <repo> && bin/avarice status` ends `blocked (enforcement_failure)` until 01-15 admits a real host; `node test/helpers/test-cli.ts onboard ...` (with the profile root variables set) shows the active path.

## Self-Check: PASSED

- Created files present on disk: src/app/onboarding-service.ts, src/app/stages/{stage,shared,register,contract,workspace,map,validate,index-stage,activate}.ts, src/cli/commands/onboard.ts, test/helpers/{fake-agent-host,test-cli}.ts, test/integration/skeleton.test.ts; modified src/app/deps.ts and src/cli/composition.ts.
- Commits d5c4b1f and 1ff1c30 are ancestors of HEAD; `git rev-list --count c8f6a02..HEAD` = 2.
- Acceptance criteria re-run: `node --test "test/integration/skeleton.test.ts"` 12 pass (needs at least 7); `grep -rn "fake-agent-host" src bin | wc -l` = 0; `grep -c "AVARICE_FAULT" src/app/onboarding-service.ts` = 2; `grep -c "registerAndPreflight" src/app/stages/register.ts` = 2; `grep -c "enforcement_failure" src/app/stages/workspace.ts` = 2.
- Plan verification re-run: skeleton, ledger-status and staging-adapters tests 70 of 70; boundaries ok; `tsc -p .` exit 0; `npm test` 137 of 137.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
