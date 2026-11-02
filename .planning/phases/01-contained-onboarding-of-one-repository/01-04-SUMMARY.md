---
phase: 01-contained-onboarding-of-one-repository
plan: 04
subsystem: adapters
tags: [git, worktree, safe-git, staging, artifact-store, agent-host, fail-closed, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-01 Result/PortError, ULID ids, onboarding lifecycle; 01-03 conventions (ports under src/ports, Result everywhere, injected seams)"
provides:
  - "StagingWorkspace port and WorktreeStagingWorkspace: prepare/head/changes/describe/listTracked/read/ensureDir/inspectRepo"
  - "runGit(args, { cwd, timeoutMs }) and SAFE_GIT_ENV: argv-only git with hooksPath=/dev/null, fsmonitor=false, optional locks off, no prompt, on a minimal env"
  - "STAGING_STRATEGY = 'worktree' and createStagingWorkspace(strategy): the single switch point for 01-08"
  - "CapabilityDescriptor, AgentHost (InvocationRequest, InvocationOutcome), ArtifactStore ports"
  - "LocalArtifactStore(dataRoot, ops?): content-addressed, atomic, idempotent; UnavailableAgentHost: enforcement none, invoke is unsupported"
  - "Test helpers makeScratchRepo, git, writeExecutable, treeDigest, checkoutSnapshot"
affects: [01-05, 01-08, 01-10, 01-11, 01-14, 01-15]

actuals:
  tokens: 14000
  tasks: 2
  commits: 4
plan_head_before: ac8b58f3672931e50cdc29dff7815c7f5b1124c5
plan_head_after: 47946bb3543b4ec455f44005ee21087506dba196

tech-stack:
  added: []
  patterns:
    - "Adapters are synchronous and return Result (spawnSync with an argv array); refusals use denied (traversal, symlink escape) or invalid (bad input, size), absence is null or not_found, never a throw"
    - "Fault injection through a constructor seam (FsOps { fsyncSync, renameSync }) instead of test code in production paths"
    - "Hostile-repository tests carry a positive control: plain git is shown to run the hook and the fsmonitor command before the same repo is shown to be inert under runGit"
    - "Staging operations are idempotent and resumable: prepare finishes a half-built worktree (branch switch, lock) instead of failing"

key-files:
  created:
    - src/ports/staging-workspace.ts
    - src/ports/capability.ts
    - src/ports/agent-host.ts
    - src/ports/artifact-store.ts
    - src/adapters/git/safe-git.ts
    - src/adapters/git/staging-strategy.ts
    - src/adapters/git/staging-worktree.ts
    - src/adapters/fs/artifact-store.ts
    - src/adapters/host/unavailable-host.ts
    - test/helpers/scratch-repo.ts
    - test/integration/staging-adapters.test.ts
  modified: []

key-decisions:
  - "prepare reuses an existing staging directory when it is a worktree of the same repository (same common dir) whose HEAD contains the pin (pin is an ancestor of or equal to HEAD), so a resumed onboarding keeps the mapper's work; anything else is conflict. finish() then completes a missing branch switch or lock"
  - "Validation before any side effect: pin must be a full lowercase hex SHA (blocks option injection into git), onboardingId must match [A-Za-z0-9_]{1,64}, workRoot must be absolute; nothing is created under the work root on refusal"
  - "read and ensureDir refuse any `..` segment and absolute path lexically (denied), then check realpath of the parent and of the target against realpath(staging) and open with O_NOFOLLOW on the resolved path; a dangling symlink is denied, a missing file under a real parent is null"
  - "inspectRepo strips userinfo from the origin URL (https://user:token@host becomes https://host), reports the lowest root-commit SHA when there are several, and returns an empty branch for a detached HEAD"
  - "changes combines `git diff --name-status -z --no-renames --no-ext-diff {pin}` with untracked names from porcelain v2, so edits, staged adds and new files all count against the pin"
  - "ArtifactStore.get is verified: a blob whose bytes no longer hash to its digest is internal (corrupt), never returned; digests that are not `sha256:` plus 64 lowercase hex are invalid, which also blocks path traversal through the digest"
  - "UnavailableAgentHost.descriptor.capabilities['contained-invocation'] is false and attributes.enforcement is 'none'; the reducedMode text is the plan's"

patterns-established:
  - "Ports stay import-clean (only src/domain); node:fs and node:child_process live in adapters only"
  - "A StagingWorkspace path argument is the staging directory for describe/changes/read/ensureDir/head/listTracked, and the user's repository only for prepare and inspectRepo"

requirements-completed: [ONB-3, ONB-4, ONB-12]

coverage:
  - id: D1
    description: "prepare creates a detached worktree of a scratch repository at the pinned SHA under {workRoot}/{onb}/staging on branch avarice/onboard-{onb}, locked with reason avarice-onboarding, pins the SHA it is given rather than HEAD, reuses an existing staging at the pin, refuses one that does not contain the pin (conflict), and refuses an onboarding ID or pin that would escape the work root or reach git as an option"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#prepare"
        status: pass
    human_judgment: false
  - id: D2
    description: "The user's checkout HEAD, branch, `status --porcelain=v2 -z --untracked-files=all` and file digest are identical before and after prepare, describe and inspectRepo, with a dirty tracked file and an untracked .env present"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#inspectRepo and the user checkout"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every git call carries hooksPath /dev/null, fsmonitor false, optional locks off and no prompt, with argv arrays only; a post-checkout hook and a core.fsmonitor command that plain git runs (positive control) never run during prepare, inspectRepo, changes, describe, listTracked or head; removing the env makes the tests fail"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#safe git (ONB-4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "describe, listTracked, changes, read and ensureDir return staging facts; read refuses .., absolute paths and symlinks resolving outside staging, returns null for an absent file and refuses files above maxBytes; ensureDir does not create directories through a symlink"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#describe, listTracked and changes, #read and ensureDir confinement"
        status: pass
    human_judgment: false
  - id: D5
    description: "LocalArtifactStore.put is atomic (fsync before rename), idempotent (second put does not rewrite), leaves nothing under the digest path or as a temp file when it fails after the temp write, validates digests and detects a corrupt blob"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#LocalArtifactStore"
        status: pass
    human_judgment: false
  - id: D6
    description: "UnavailableAgentHost reports enforcement none and answers invoke with unsupported contained-invocation, so the production host fails closed until 01-15"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#UnavailableAgentHost (ONB-12 fail-closed default)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-11-02
---

# Phase 01 Plan 04: Staging Worktree, Artifact Store and Unavailable Host Summary

**A pinned, locked `git worktree` staging copy driven only through safe git (hooks and fsmonitor off, argv arrays, minimal env), confined reads, a content-addressed atomic artifact store, and a production host that reports enforcement `none` and refuses every invocation.**

## Performance

- **Duration:** about 15 min (start time was not recorded; estimated from commit timestamps 13:22 to 13:25 local plus reading and spec time)
- **Completed:** 2026-11-02T19:26Z
- **Tasks:** 2 of 2 (both TDD)
- **Files created:** 11

## Accomplishments

- `WorktreeStagingWorkspace.prepare` builds `{workRoot}/{onb}/staging` at the pin on `avarice/onboard-{onb}`, locked; the user's checkout (HEAD, branch, porcelain status including untracked files, file digest) is identical afterwards.
- `runGit` is the single git entry point. A hostile scratch repository (a `post-checkout` hook and a `core.fsmonitor` command) shows both run under plain git (positive control) and neither runs under staging; changing the env to `GIT_CONFIG_COUNT=0` fails two tests.
- `LocalArtifactStore` and `UnavailableAgentHost` give the onboarding tracer (01-05) every port it needs besides the ledger; the host fails closed.
- Repository state at the end: `npm test` 123 of 123, `npx tsc -p .` 0, `node scripts/check-boundaries.ts` ok (15 files).

## Task Commits

1. **Task 1: Staging worktree at the pin with safe git** (TDD)
   - RED `307ed4a` test(01-04): 15 tests, 1 pass (the strategy constant), 14 fail
   - GREEN `03c1953` feat(01-04): `runGit`, `WorktreeStagingWorkspace`; 15 of 15
   - REFACTOR: none needed
2. **Task 2: Capability, AgentHost and ArtifactStore ports; artifact store; unavailable host** (TDD)
   - RED `8da801a` test(01-04): 22 tests, 15 pass (Task 1), 7 fail
   - GREEN `47946bb` feat(01-04): `LocalArtifactStore`, `UnavailableAgentHost`; 22 of 22
   - REFACTOR: none needed

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED and GREEN present in order for both tasks (REFACTOR optional, not needed).

- **Task 1 RED:** `node --test --test-reporter=tap "test/integration/staging-adapters.test.ts"`, exit 1, 15 tests, 1 pass, 14 fail. Target test "creates the staging worktree at the pin on avarice/onboard-{onb}, locked, under the work root". `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`); record `01-04-red-evidence.json`. Semantic assessment: stub adapters export every imported name and return `internal "... is not implemented yet"`, so each failure is an assertion on `Result.ok` or on stub output; the hostile-repo test passes its plain-git positive control before it fails, proving the fixture works. One test passed vacuously against the stub (the argv test accepted any error), so it was tightened to require `git rev-parse exited 128` before the RED commit.
- **Task 2 RED:** same command, exit 1, 22 tests, 15 pass, 7 fail. Target "stores content-addressed blobs idempotently at {dataRoot}/artifacts/{sha[0:2]}/{sha} and reads them back"; `RED_EVIDENCE_OK`; record `01-04-red-evidence-task2.json`. Same assessment: failures are assertions on `Result.ok` and on the stub descriptor and error.
- **GREEN:** 22 of 22, then full suite 123 of 123. Mutation checks: `GIT_CONFIG_COUNT=0` fails the safe-git env test and the hostile-repo test; removing the temp-file cleanup in `put` fails the failed-put test.

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans are most likely to trip on:

- `describe`, `changes`, `read` and the other staging methods take the staging path; only `prepare` and `inspectRepo` take the user's repository. `repoReadAllow` is `[commonDir]`, the main repository's `.git` (the worktree's `.git` file points into it).
- `prepare` accepts an existing staging whose HEAD descends from the pin, so 01-05's resume keeps staging work; a staging at an unrelated commit is `conflict`.
- `LocalArtifactStore.put` does not record anything in the ledger; the caller adds `recordArtifact` (kind, retention, store).
- `InvocationOutcome.permissionDenials` is `{ tool, reason }[]`, matching the contracts doc; 01-15 adds `scope` and `extensions` to `InvocationRequest`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Input validation and resumability beyond the plan text**
- **Found during:** Task 1
- **Issue:** the plan names refusal of a target outside the work root only. `pin` flows into git argv and `onboardingId` into a path; a pin like `--detach` or an ID like `../x` would be option injection or an escape. A crash after `worktree add` (kill-point `after-checkpoint:configure-gsd`) would leave a worktree that a plain "exists, so reuse" or "exists, so fail" mishandles.
- **Fix:** validate pin (full lowercase hex SHA), onboarding ID and an absolute work root before any side effect; `prepare` verifies an existing staging is a worktree of the same repository containing the pin and finishes a missing branch switch or lock.
- **Files modified:** src/adapters/git/staging-worktree.ts, test/integration/staging-adapters.test.ts
- **Committed in:** 03c1953 (tests in 307ed4a)

**2. [Rule 2 - Missing critical] Credential stripping and digest validation**
- **Found during:** Tasks 1 and 2
- **Issue:** `RepoFacts.remote` would carry `https://user:token@host` verbatim into the ledger; `ArtifactStore.get/has` with a free-form digest would let `sha256:../..` build a path.
- **Fix:** userinfo is stripped from the remote; digests must be `sha256:` plus 64 lowercase hex; `get` also rejects a blob whose bytes no longer hash to its digest.
- **Committed in:** 03c1953, 47946bb

**3. [Rule 1 - Bug, mine] Reverted my own file with a path-limited `git checkout --`**
- **Found during:** Task 1 mutation check
- **Issue:** a failed `sed` was followed by `git checkout -- src/adapters/git/safe-git.ts`, which restored the RED stub over the uncommitted GREEN file.
- **Fix:** rewrote the file from the same content and re-ran the suite (15 of 15) before committing. No committed history was affected; later mutation checks used a saved copy instead.

### Design choices the plan left open

- Sync `Result` returns throughout (`spawnSync`), as the port signatures in SKELETON.md are not `Promise`; `AgentHost.invoke` is async as specified.
- `StagingStrategy` is the literal `'worktree'` for now; 01-08 widens it if it switches to the clone.
- `ArtifactStore` has no `delete` (the contracts doc lists it; the SKELETON and this plan do not).

---

**Total deviations:** 2 auto-fixed (both Rule 2), 1 self-inflicted slip recovered (Rule 1 note). **Impact on plan:** none on scope.

## Issues Encountered

- Start time was not captured at the beginning of execution; the duration above is an estimate.
- Git prints `warning: Empty last update token.` during the hostile-repo positive control: the fixture fsmonitor script outputs no token. Harmless; it appears only in the control step.
- `git worktree list --porcelain -z` is parsed after replacing newlines with NULs; if a future git changes the porcelain `locked` line format the lock check would re-run `worktree lock`, which then fails loudly rather than silently.

## Authentication Gates

None.

## Known Stubs

None. `UnavailableAgentHost` is a deliberate fail-closed adapter, not a stub; plan 01-15 supplies the contained host, and 01-05 tests use the fake host from `test/helpers/fake-agent-host.ts`.

## Threat Flags

None new. T-01-01 mitigated and tested (safe-git environment on every call, argv only, hostile-hook and fsmonitor test with positive control); the hostile-repo suite proper is 01-08. T-01-63 mitigated and tested (realpath containment, `..` and absolute refusal, size cap, no directory creation through a symlink). T-01-64 mitigated and tested (enforcement `none`, `unsupported` on invoke). T-01-SC: no installs.

Limits worth knowing for 01-08:

- The environment disables hooks and fsmonitor only. A repository `.gitattributes` plus `filter.<name>.clean` or `smudge` config, a `diff.external` driver or `core.sshCommand` is not neutralized (`changes` passes `--no-ext-diff`, but `status` may run a clean filter on a modified file). The hostile-repo test in 01-08 should probe these before the strategy decision is final.
- Spike S0-B (`spikes/slice-0-wave-0/README.md`) found that a linked worktree without `denyWrite` on the source `.git` lets a contained run move a source branch ref, and recommends the local clone. This plan implements the SKELETON default (worktree) behind `STAGING_STRATEGY`; the choice, and the `denyWrite` entries for `describe().gitPaths` if the worktree stays, are 01-08's and the owner's.

## User Setup Required

None.

## Next Phase Readiness

- 01-05 can wire `deps.staging = createStagingWorkspace(STAGING_STRATEGY)`, `deps.artifacts = new LocalArtifactStore(profile.dataRoot)` and `deps.host = new UnavailableAgentHost()` (with the fake host injected in tests); `describe().gitPaths` and `repoReadAllow` are ready for the settings generator (01-11).
- 01-08 owns the strategy decision, hostile-repo hardening, and widening `RepoFacts`.
- `npm test` (123), `npx tsc -p .` and `node scripts/check-boundaries.ts` are green.

## Self-Check: PASSED

- Created files present on disk: src/ports/{staging-workspace,capability,agent-host,artifact-store}.ts, src/adapters/git/{safe-git,staging-strategy,staging-worktree}.ts, src/adapters/fs/artifact-store.ts, src/adapters/host/unavailable-host.ts, test/helpers/scratch-repo.ts, test/integration/staging-adapters.test.ts.
- Commits 307ed4a, 03c1953, 8da801a, 47946bb are ancestors of HEAD; `git rev-list --count ac8b58f..HEAD` = 4.
- Acceptance criteria re-run: `node --test "test/integration/staging-adapters.test.ts"` 22 pass; `core.hooksPath` in safe-git.ts 1, `core.fsmonitor` 2; `STAGING_STRATEGY = 'worktree'` 1; `enforcement` in unavailable-host.ts 3; `rename` in artifact-store.ts 6; boundaries ok; tsc exit 0.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
