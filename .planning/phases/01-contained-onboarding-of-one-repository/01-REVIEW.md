---
phase: 01-contained-onboarding-of-one-repository
reviewed: 2026-11-04T06:40:00Z
depth: standard
files_reviewed: 255
files_reviewed_list:
  - audit/mutation-test-scans.json
  - bin/avarice
  - bin/avarice.ts
  - package-lock.json
  - package.json
  - scripts/ac1-timing.sh
  - scripts/check-boundaries.ts
  - scripts/hook-bench.ts
  - scripts/make-fixture-db.ts
  - scripts/test-matrix.sh
  - src/adapters/context/freshness.ts
  - src/adapters/context/gsd-graph.ts
  - src/adapters/context/gsd-intel.ts
  - src/adapters/exec/sandboxed-executor.ts
  - src/adapters/exec/seatbelt-profile.ts
  - src/adapters/fs/artifact-store.ts
  - src/adapters/fs/canonical-path.ts
  - src/adapters/fs/local-mount.ts
  - src/adapters/fs/profile-paths.ts
  - src/adapters/git/repo-facts.ts
  - src/adapters/git/safe-git.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/git/staging-clone.ts
  - src/adapters/git/staging-strategy.ts
  - src/adapters/git/staging-worktree.ts
  - src/adapters/graph/graphify.ts
  - src/adapters/graph/knowledge-corpus.ts
  - src/adapters/gsd/agent-frontmatter.ts
  - src/adapters/gsd/agents-json.ts
  - src/adapters/gsd/gsd-onboarding.ts
  - src/adapters/gsd/gsd-tools.ts
  - src/adapters/gsd/locate.ts
  - src/adapters/gsd/plugin-dir.ts
  - src/adapters/gsd/preamble.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/env.ts
  - src/adapters/host-claude/hook-policy.ts
  - src/adapters/host-claude/invocation-files.ts
  - src/adapters/host-claude/launch-args.ts
  - src/adapters/host-claude/launch-preflight.ts
  - src/adapters/host-claude/settings.ts
  - src/adapters/host-claude/stream-json.ts
  - src/adapters/host/unavailable-host.ts
  - src/adapters/sqlite/db.ts
  - src/adapters/sqlite/events.ts
  - src/adapters/sqlite/ledger.ts
  - src/adapters/sqlite/migrate.ts
  - src/adapters/sqlite/migrations/0001-initial.ts
  - src/app/budget.ts
  - src/app/context.ts
  - src/app/deps.ts
  - src/app/invocation.ts
  - src/app/onboarding-service.ts
  - src/app/resume.ts
  - src/app/stages/activate.ts
  - src/app/stages/contract.ts
  - src/app/stages/index-code-graph.ts
  - src/app/stages/index-intel.ts
  - src/app/stages/index-knowledge.ts
  - src/app/stages/index-stage.ts
  - src/app/stages/index-steps.ts
  - src/app/stages/map.ts
  - src/app/stages/register.ts
  - src/app/stages/shared.ts
  - src/app/stages/stage.ts
  - src/app/stages/validate.ts
  - src/app/stages/workspace.ts
  - src/app/status.ts
  - src/cli/args.ts
  - src/cli/commands/context.ts
  - src/cli/commands/init.ts
  - src/cli/commands/onboard.ts
  - src/cli/commands/repo.ts
  - src/cli/commands/resume.ts
  - src/cli/commands/status.ts
  - src/cli/composition.ts
  - src/cli/main.ts
  - src/domain/digest.ts
  - src/domain/glob.ts
  - src/domain/graph-merge.ts
  - src/domain/graph-validation.ts
  - src/domain/hook-decision.ts
  - src/domain/ids.ts
  - src/domain/invocation-scope.ts
  - src/domain/knowledge-corpus.ts
  - src/domain/knowledge-validation.ts
  - src/domain/mapping.ts
  - src/domain/onboarding-contract.ts
  - src/domain/onboarding-lifecycle.ts
  - src/domain/outcome.ts
  - src/domain/path-references.ts
  - src/domain/policy-narrowing.ts
  - src/domain/preflight.ts
  - src/domain/project-record.ts
  - src/domain/result.ts
  - src/domain/root-rules.ts
  - src/domain/runtime-support.ts
  - src/domain/secret-patterns.ts
  - src/domain/validation.ts
  - src/hook/pre-tool-use.ts
  - src/ports/agent-host.ts
  - src/ports/artifact-store.ts
  - src/ports/capability.ts
  - src/ports/command-executor.ts
  - src/ports/context-source.ts
  - src/ports/graph-tool.ts
  - src/ports/gsd-onboarding.ts
  - src/ports/ledger.ts
  - src/ports/staging-workspace.ts
  - test/containment/executor.test.ts
  - test/containment/failclosed.test.ts
  - test/containment/LIVE-CASES.md
  - test/containment/live-onboarding.test.ts
  - test/containment/live-run-2026-11-02.jsonl
  - test/containment/live-spend-2026-11-02.jsonl
  - test/fault/budgets.test.ts
  - test/fault/killpoints.test.ts
  - test/fault/migrations.test.ts
  - test/fixtures/claude-fake/claude-replay.mjs
  - test/fixtures/db/schema-v1.sqlite
  - test/fixtures/index-fixtures.ts
  - test/fixtures/knowledge.ts
  - test/fixtures/stream-json.ts
  - test/helpers/fake-agent-host.ts
  - test/helpers/fake-claude.ts
  - test/helpers/fake-graphify.ts
  - test/helpers/fake-gsd-core.ts
  - test/helpers/fake-intel-host.ts
  - test/helpers/fake-knowledge-host.ts
  - test/helpers/fault-run.ts
  - test/helpers/hook-fixture.ts
  - test/helpers/hostile-repo.ts
  - test/helpers/inherited-sandbox-executor.ts
  - test/helpers/live-harness.ts
  - test/helpers/offline.ts
  - test/helpers/run-cli.ts
  - test/helpers/sandbox.ts
  - test/helpers/scratch-repo.ts
  - test/helpers/test-cli.ts
  - test/integration/checkout-unchanged.test.ts
  - test/integration/claude-host.test.ts
  - test/integration/completeness.test.ts
  - test/integration/context.test.ts
  - test/integration/graphify-tool.test.ts
  - test/integration/gsd-adapter.test.ts
  - test/integration/gsd-configure.test.ts
  - test/integration/hook.test.ts
  - test/integration/index-stage.test.ts
  - test/integration/init.test.ts
  - test/integration/intel-step.test.ts
  - test/integration/knowledge-pass.test.ts
  - test/integration/lease.test.ts
  - test/integration/ledger-status.test.ts
  - test/integration/no-competing-index.test.ts
  - test/integration/no-repo-exec.test.ts
  - test/integration/offline.test.ts
  - test/integration/preflight.test.ts
  - test/integration/skeleton.test.ts
  - test/integration/staging-adapters.test.ts
  - test/integration/validation-failures.test.ts
  - test/mutation/fail-closed.test.ts
  - test/mutation/ledger-and-record.test.ts
  - test/mutation/scope-and-validation.test.ts
  - test/unit/agent-frontmatter.test.ts
  - test/unit/boundaries.test.ts
  - test/unit/claude-settings.test.ts
  - test/unit/domain-contracts.test.ts
  - test/unit/footprint.test.ts
  - test/unit/graph-merge.test.ts
  - test/unit/graph-validation.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/invocation-env.test.ts
  - test/unit/invocation-scope.test.ts
  - test/unit/knowledge-corpus.test.ts
  - test/unit/launch-args.test.ts
  - test/unit/localfs.test.ts
  - test/unit/mapping.test.ts
  - test/unit/outcome.test.ts
  - test/unit/preflight.test.ts
  - test/unit/record.test.ts
  - test/unit/root-rules.test.ts
  - test/unit/runtime-support.test.ts
  - test/unit/sec5.test.ts
  - test/unit/stream-json.test.ts
  - test/unit/transitions.test.ts
  - test/unit/validation.test.ts
  - tsconfig.json
  - spikes/slice-0-wave-0/README.md
  - spikes/slice-0-wave-0/assemble-results.mjs
  - spikes/slice-0-wave-0/check-results.mjs
  - spikes/slice-0-wave-0/common.sh
  - spikes/slice-0-wave-0/gen-cases.mjs
  - spikes/slice-0-wave-0/gen-settings.mjs
  - spikes/slice-0-wave-0/harness.sh
  - spikes/slice-0-wave-0/hook-log.mjs
  - spikes/slice-0-wave-0/make-scratch.sh
  - spikes/slice-0-wave-0/results.json
  - spikes/slice-0-wave-0/run-all.sh
  - spikes/slice-0-wave-0/summarize.mjs
  - spikes/slice-0-wave-0/truth.mjs
  - spikes/slice-0-wave-0/cases/ (26 case JSON files, A1 to P0)
  - spikes/slice-0-wave-0/evidence/ (29 evidence files, A1 to G3 and ledger.jsonl)
findings:
  critical: 3
  warning: 8
  info: 5
  total: 16
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-04T06:40:00Z
**Depth:** standard
**Files Reviewed:** 255 (the list file; I also read `scripts/exit-run.sh` and a few `src/domain` files that are outside the list because they bear on the findings)
**Status:** issues_found

## Summary

The code is careful and `tsc` and `check-boundaries` are clean. Most of the fail-closed machinery (safe-git env, canonical path resolution, fenced transitions, launch-args refusal, hook self-test, content-addressed artifact store) holds up under reading. The defects are concentrated in three places:

1. The recovery path covers only the map invocation. A host started by the index stage (intel, knowledge) is never reaped on resume.
2. The hook's read confinement is a non-recursive deny list. I confirmed by running the real `decideToolCall` that `cat` of a sibling onboarding's staging tree, `grep -r` over an ancestor directory, `grep -r` over `.` (which reads secret-glob files) and `grep -f/abs/path` are all allowed.
3. The staging-diff gate that backs validation and the pre-activation scope check cannot see gitignored files. A hostile repository controls its own `.gitignore`.

The kill-point flake lead is addressed in WR-01 to WR-03. I could not reproduce it. No timestamp-like field escapes `normalizeRecord`. The record body does embed the outcome of several timeout-bounded external calls inside the nested `indexes.absent` array, and a transient failure there is frozen permanently. The test also has no guard that would make a degraded reference visible.

External reviewer evidence: none was provided.

## Critical Issues

### CR-01: A host started by the intel or knowledge index step is never reaped on resume, so a resume can relaunch beside a surviving host

**File:** `src/app/resume.ts:49-60,126-134`, `src/app/stages/index-intel.ts:62-69`, `src/app/stages/index-knowledge.ts:150-154`, `src/app/invocation.ts:60-125`
**Issue:** `prepareInvocation` records `launch:{purpose}` as `started` with the session ID "so a resume can find the process". Only `reconcileInvocation` consumes it, and it handles only `launch:map` (`const LAUNCH = 'launch:map'`) and only when the state is `mapping` or `paused`. `reapInterrupted` is the only caller of `host.reap` in `src/`. The intel and knowledge invocations run in state `planning_ready`, where `reconcileInvocation` returns at `if (row.state !== 'paused') return ok(undefined)`.

If the supervisor is SIGKILLed while `await deps.host.invoke(...)` is pending, the claude host (detached, own process group) keeps running until its wall clock. On resume nothing ends it, and `indexStage` runs the step again, which launches a second host. The first host can still write `.planning/intel/**` or `.avarice-knowledge/.extraction/**` while AVARICE runs `intel validate`, `intel snapshot` and `intel diff`. That defeats the `diff-changed` guarantee ("nothing changed between validation and snapshot") and the stated T-01-44 invariant "relaunching beside a survivor is not an option". The `launch:intel` and `launch:knowledge` rows also stay `started` forever.

The kill-point suite does not cover this. `KILL_POINTS` stops at `after-checkpoint:index:*` (before the step starts), and the fake host answers `unsupported` for intel and knowledge, so no intel or knowledge host ever runs under a kill.

**Fix:** Make the reconcile generic over `launch:*`.
```ts
// resume.ts: before running any stage, for every launch:* step still 'started'
for (const step of steps.value.filter((s) => s.step.startsWith('launch:') && s.status === 'started')) {
  const reaped = await reapInterrupted(ctx, step.result, contract.value.runId);
  if (!reaped.ok) return reaped;
  // mark it 'interrupted' (map keeps its reconcile-by-staging logic)
}
```
Also add a fake-host kill case for the intel step (`killAfter` inside the intel invocation) to the fault suite.

### CR-02: Shell read confinement is deny-list only and non-recursive, so secret globs, sibling staging trees and non-listed credential stores are readable

**File:** `src/domain/hook-decision.ts:195-233` (`readRule`, `checkSegment`), `src/domain/invocation-scope.ts:~225` (`denyRead`), `src/adapters/host-claude/settings.ts:79-96`
**Issue:** The Read tool is allow-listed by the generated settings, but Bash is `Bash` (blanket) and is gated only by the hook. The hook runs `checkRead` on each non-option word. `readRule` denies only a path that is under a `denyRead` root (user repo, data root, `~/.ssh`, `~/.aws`, `~/.config/gh`) or a secret glob below staging. The sandbox `denyRead` is the same short list. I ran the real `decideToolCall` with a policy built through `computeInvocationScope` and `buildHookPolicy`:

```
cat /tmp/rv/work/onb_Y/staging/secret.txt            allow   (another onboarding's staging, same work root)
cat /Users/aphan/.netrc                              allow   (any credential store not on the 3-item list)
grep -r token /Users/aphan                           allow   (ancestor of ~/.ssh; recursion reaches it)
grep -r PASSWORD .                                   allow   (recursion reads **/.env, **/*.pem in staging)
grep -f/Users/aphan/.ssh/id_rsa README.md            allow   (attached option value is never checked)
grep --file=/Users/aphan/.ssh/id_rsa README.md       allow
cat /Users/aphan/.ssh/id_rsa                         deny    deny-read
```
Only the last case, the one a test would think of, is denied. `docs/containment.md:78` lists "other profile roots" in the sandbox `denyRead`; the code does not add them. A prompt-injected mapper in a hostile repo can therefore read other repositories' staging trees, `~/.netrc`, `~/.npmrc`, `~/.kube`, `~/.docker`, and committed `.env` files via `grep -r .`. The content goes to the model and into the stored transcript, and potentially into the map documents. `findSecrets` only catches a few token shapes.

**Fix:** Confine shell reads by allow-list (staging, the policy's `readRoots`, the gsd-core directories) rather than by deny-list, and reject recursion that could escape the allowed set.
```ts
// readRule: for a shell segment, require canonical to be under stagingPath or an allowed read root,
// and under stagingPath also refuse any path that is an ancestor of a denyRead root.
// checkSegment: refuse attached option values for path-taking flags:
//   /^-[a-zA-Z]*f./, --file=, --exclude-from=, --include-from=, --pattern-file=
// grep/find/ls with -r/-R/no-args on a directory: deny, or run the same secret-glob filter on the walk.
```
Add `workRoot` (its sibling onboardings) to the sandbox and hook `denyRead` as the docs say, and add the cases above to `test/unit/hook-decision.test.ts`.

### CR-03: The staging diff gate cannot see gitignored files, so a hostile `.gitignore` blinds validation scope and the pre-activation scope check

**File:** `src/adapters/git/staging-base.ts:109-129` (`changes`), `src/adapters/git/repo-facts.ts:32-60` (`parseStatus`), consumers `src/app/stages/validate.ts`, `src/app/stages/activate.ts:70-103` (`scopeCheck`, T-01-67)
**Issue:** `changes()` combines `git diff --name-status pin` with `git status --porcelain=v2 --untracked-files=all`. `status` without `--ignored` never lists ignored files. I reproduced it: a repository whose committed `.gitignore` is `*` and a new file `evil.txt` in the working tree give an empty `git status --porcelain=v2 -z --untracked-files=all` and `! evil.txt` only with `--ignored`. The repository's own committed `.gitignore` is part of the staging checkout, and the repository is the hostile input. The `scope-of-writes` check, the `added` list used by `extraMapFiles`, and the activation check ("the whole diff against the pin must lie inside the write sets whoever wrote it") all miss any untracked ignored path. The sandbox deliberately leaves the staging root writable ("entries created later at unlisted locations are caught by the staging diff gate, not prevented"), so this gate is the control for that case.

**Fix:** Include ignored files in the added set.
```ts
const status = runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching'], { cwd: path, neutralizeFilters: true });
// parseStatus: handle records beginning with '!' like '?' (path = record.slice(2)), as untracked.
```
Then expect `.planning/**` AVARICE outputs to still pass through `AVARICE_WRITE_SET`. Add a hostile-repo test with `.gitignore: *` and an out-of-set write.

## Warnings

### WR-01: Kill-point flake lead: no volatile field enters the record body, but the nested `indexes.absent` array carries timeout-bounded outcomes (not reproduced)

**File:** `src/app/stages/activate.ts:200-232`, `src/domain/project-record.ts:287-324` (`foldIndexResults`), `test/helpers/fault-run.ts:117-122` (`normalizeRecord`), `test/fault/killpoints.test.ts:166`
**Issue:** What I checked and found.
- Reproduction attempt: 24 busy-loop `node` processes (load average 52 on 10 cores, far above the reported ~630% CPU) and the whole `test/fault/killpoints.test.ts`. All 20 tests passed in 118 s. I cannot confirm the failure.
- Volatile fields that can enter the stored body: `mapping.mappedAt` (`new Date(nowMs).toISOString()`), `contract.digest` (embeds `compiledAt`, run and onboarding IDs), `artifacts.snapshot` (manifest embeds the onboarding ID), the ULIDs and the temp path. `normalizeRecord` covers all of these (ISO regex, ULID regex, `TEMP_ROOT`, and the two digest overrides). I found no field that is time-dependent at the clock level and missed by normalization. The intel digest (which would include GSD's snapshot timestamp) is not reached in this test because the fake host answers `unsupported` for intel.
- What does enter the body and depends on timing is the outcome of calls with fixed timeouts: `graphify --version` 15 s (`VERSION_TIMEOUT_MS`), `gsd graphify snapshot` and `status` 15 s (`DEFAULT_GSD_TIMEOUT_MS`), the sandbox probe 5 s (`PROBE_TIMEOUT_MS`, WR-07), git 10 s. A failure becomes `{index:'graph', reason:'timeout'|'extract-failed'|'stale-after-install'}` in `indexes.absent` (a nested array), the `indexes.graph` object disappears, and `knowledge` changes from `invocation-failed` to `graph-absent`. I forced this with `AVARICE_GRAPHIFY_BIN=/nonexistent` and got exactly that shape in the stored record: `absent: [graph, intel, knowledge(graph-absent)]` instead of `[intel, knowledge]`. `validationFindings` (a rejected first attempt that a remap fixed) is the other array that would differ.
- Evidence from the pattern: the 12 failing cases are the first 12 entries of `KILL_POINTS`. Those are exactly the kill points where the `index:code-graph` step runs in the resumed process; the last three (`index:intel`, `index:knowledge`, `activate`) have the code-graph result already stored by the killed process. That fits a transient code-graph failure inside the resume process during a load window, and it is not proof (the original diff was truncated).

**Fix:** In `outcomeOf`, compare `JSON.stringify` of `record.indexes` and `record.findings` in a separate assertion first, so the failing array is named (see WR-03). Give the external-call timeouts headroom or make them overridable for tests (for example `AVARICE_GRAPHIFY_VERSION_TIMEOUT_MS`), and rerun the file under load to confirm.

### WR-02: A transient index failure is stored as a `completed` step and never retried, so the record permanently says "absent"

**File:** `src/app/stages/index-stage.ts:55-90`, `src/app/stages/index-steps.ts:50-61`
**Issue:** `indexStage` skips any step with `status === 'completed'`, and `runStep` stores an absent outcome (including `reason: 'timeout'` and `step-error`) as `completed`. A resume after a kill, or a re-run, never retries a step that failed only because the machine was slow. The activation record then states `absent (timeout)` for the whole life of that record version. The ledger cannot distinguish "built nothing because graphify is missing" from "built nothing because of one slow call".
**Fix:** Store transient reasons (`timeout`, `step-error`) with a non-completed status, or have the stage re-run steps whose stored result has `reason` in a retryable set; keep `graphify-missing`, `disabled`, and `budget_exhausted` terminal.

### WR-03: The kill-point test cannot tell a healthy reference from a degraded one and swallows a missing graph snapshot

**File:** `test/fault/killpoints.test.ts:60-71,79-91,166`
**Issue:** Four problems. (a) `snapshotWithoutTimestamp` has `catch { return null; }`; a missing `.last-build-snapshot.json` (graph absent) yields `null` on both sides and the assertion passes. (b) Nothing asserts that the reference record has `indexes.graph` present, `findings` empty and `absent` equal to exactly `[intel, knowledge]`. On a machine without graphify, or when the reference ran under load and degraded, the reference and every resumed run can be degraded in the same way, or all of them can differ from it, with an opaque `deepStrictEqual` diff that Node truncates. (c) `deepEqual` on the whole record hides which array differed. (d) The suite depends on real graphify and real GSD being installed and silently becomes weaker without them (other files use `skip`; this one does not).
**Fix:**
```ts
// in before(), after the reference run
assert.ok(reference.rawRecord.indexes.graph, 'reference has a code graph');
assert.deepEqual(reference.rawRecord.indexes.absent.map((a) => a.index), ['intel', 'knowledge']);
assert.deepEqual(reference.rawRecord.findings, []);
// in each case, before the whole-record compare
assert.deepEqual(JSON.stringify(outcome.rawRecord.indexes), JSON.stringify(reference.rawRecord.indexes), 'indexes');
```
and remove the blanket `catch` in `snapshotWithoutTimestamp` (assert the file exists).

### WR-04: Ledger writers other than transition, checkpoint, contract and activation carry no lease fence, so a fenced-out holder can still write

**File:** `src/ports/ledger.ts` (no `fence` on `recordStepResult`, `recordAttempt`, `appendEvent`, `reserveBudget`, `chargeBudget`, `recordArtifact`, `createBudgets`), `src/adapters/sqlite/ledger.ts:~290-330,520-560`, `src/app/onboarding-service.ts:182-198`
**Issue:** `transitionOnboarding`, `recordCheckpoint`, `storeContract` and `insertRecordAndActivate` check the fence. Everything else the stages write does not. `runOnboarding` checks `lease.lost` only at the top of its loop and `renewLease` only between stages, so a stage in progress (a map or intel host invocation lasting minutes) keeps writing step results, budget charges, artifacts and events after another process has taken the lease (the lease is not cancelled on loss). `recordStepResult` is an upsert keyed on `(onboarding, step, attempt)`, so the stale writer can overwrite the new holder's result for the same attempt, and a stale `reserveBudget`/`chargeBudget` pair corrupts the invocation accounting (`reserved` is later treated as orphaned and charged).
**Fix:** Add a `{ fence }` guard to these ledger calls (check it in the same `BEGIN IMMEDIATE` as the write) and abort the in-flight host invocation when `lease.lost` is set, for example by passing an `AbortSignal` that the renewal timer fires.

### WR-05: `parseArgs` crashes on flag names that collide with `Object.prototype`

**File:** `src/cli/args.ts:24-26,45-52`
**Issue:** `repeated` and `flags` are plain `{}`. `(repeated[name] ??= [])` does not assign when `name` is `__proto__`, `constructor`, `toString` and so on, because the existing value is not nullish, and then `.push` throws. Verified: `node bin/avarice.ts onboard --__proto__=x` ends with `TypeError: repeated[name].push is not a function` from `main()`, which calls `parseArgs` outside its `try`, so the CLI dies with a stack trace and exit 1 instead of a usage error (64).
**Fix:** `const repeated: Record<string, string[]> = Object.create(null)` and the same for `flags`, or use `Map`s.

### WR-06: The hook checks only the verb prefix of `gsd_run`, never its arguments

**File:** `src/domain/hook-decision.ts:215-219`
**Issue:** `gsd_run` words are admitted when `args` starts with an allowed verb (`intel snapshot`, `intel patch-meta`, `graphify query` ...). Everything after the verb is unchecked, so `gsd_run intel query ../../..`-style terms and any path or `--cwd`-style option GSD accepts are outside the read and write checks. The verbs are described as "read-only inside the sandbox", which relies on the sandbox alone for the intel verbs that write (`snapshot`, `patch-meta`).
**Fix:** Run the same read check over the remaining non-option words (as `checkSegment` does for the other commands) and refuse options not on a per-verb allow-list.

### WR-07: The sandbox probe is a 5 s `spawnSync`, cached forever per process; one slow probe makes the executor unavailable for the whole run

**File:** `src/adapters/exec/sandboxed-executor.ts:20,35-43`
**Issue:** `probe()` records `works = false` on a timeout (`ran.error !== undefined`) and never retries within the process. The probe also runs from `executor.descriptor` during composition and records `enforcement: none` in `adapter_configs`. On a loaded machine a cold `sandbox-exec` can exceed 5 s once, and then every `executor.run` returns `unavailable`, which the index steps convert to `absent (extract-failed)` and the GSD verbs surface as errors. It fails closed, but nondeterministically and with a misleading reason.
**Fix:** Do not cache a timeout as a negative; retry once with a longer timeout, and cache only a clean non-zero exit.

### WR-08: `exit-run.sh` spend guard fails open on a non-numeric value

**File:** `scripts/exit-run.sh:~96-101`
**Issue:** `spent + expected > Number(a.capUsd)` is false when either side is `NaN`. `Number(process.env.EXIT_RUN_EXPECTED_USD || 12)` is `NaN` for `EXIT_RUN_EXPECTED_USD=abc`, and `Number(a.spentUsdSoFar || 0)` is `NaN` for a string value. `capUsd` is validated; those two are not. The guard that is supposed to stop a live spend then approves it.
**Fix:** `if (!Number.isFinite(spent) || !Number.isFinite(expected) || spent < 0 || expected < 0) { ...exit 1 }` before the comparison.

## Info

### IN-01: `bin/avarice` and `bin/avarice.ts` are identical copies

**File:** `bin/avarice`, `bin/avarice.ts`
**Issue:** Two copies of the same entry; `package.json` points at the `.ts` one, the scripts use both. They can drift.
**Fix:** Keep one and make the other a symlink or delete it.

### IN-02: Test fault and lease overrides are honored by the production entry point

**File:** `src/app/onboarding-service.ts:28-45`
**Issue:** `AVARICE_FAULT` makes the production binary SIGKILL itself, and `AVARICE_LEASE_TTL_MS` lets the environment set the lease TTL to 1 ms. `bin/avarice.ts` does not guard either (unlike `AVARICE_FAKE_HOST`, which only the test entry reads). Low risk (the user's own environment) but it is test-only behavior in the shipped path.
**Fix:** Read both through an injected option set by the test entry, or require an explicit `AVARICE_TEST=1`.

### IN-03: Digests of text read through a UTF-8 decode are not digests of the file bytes

**File:** `src/app/stages/index-code-graph.ts:84`, `src/app/stages/index-intel.ts:140-143`, `src/app/stages/activate.ts:142`
**Issue:** `deps.staging.read` returns a decoded string; the graph and intel digests and the stored map-document artifacts are computed from `Buffer.from(text,'utf8')`. Invalid UTF-8 bytes become U+FFFD, so the recorded digest and the stored artifact differ from the on-disk file. Rare for graphify JSON, possible for model-written Markdown.
**Fix:** Add a bytes-returning read to `StagingWorkspace` for hashing and storing.

### IN-04: `reap` can throw on a failed `ps` spawn

**File:** `src/adapters/host-claude/claude-host.ts:371-372`
**Issue:** `group.stdout.trim()` throws a `TypeError` if `spawnSync` returns `stdout: null` (spawn failure), which escapes the `Result` contract and rejects `resumeOnboarding`.
**Fix:** `Number((group.stdout ?? '').trim()) === pid`, and treat a spawn error as "does not lead its group".

### IN-05: The profile `config.json` is written but never read

**File:** `src/adapters/fs/profile-paths.ts:~95-104`
**Issue:** `resolveProfile` writes `{ schema, profile, dataRoot, workRoot }` (0600) on first run and takes the roots from the environment only. A later run with different `AVARICE_*_ROOT` values leaves a stale file that looks authoritative.
**Fix:** Read it and warn or refuse on a mismatch, or stop writing it until something consumes it.

---

_Reviewed: 2026-11-04T06:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
