---
phase: 01-contained-onboarding-of-one-repository
plan: 08
subsystem: staging-and-preflight
tags: [git, clone-staging, safe-git, preflight, repo-facts, onboarding, existing-state, hostile-repo, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-02 spike S0-B evidence; 01-04 StagingWorkspace port, WorktreeStagingWorkspace, runGit; 01-05 registerAndPreflight seam, stage loop, fake host, skeleton test"
provides:
  - "STAGING_STRATEGY = 'clone' (owner-selected in Task 1): CloneStagingWorkspace builds {workRoot}/{onb}/staging with git clone --local --no-hardlinks --no-checkout, detaches at the pin and switches to avarice/onboard-{onb}; nothing is written under the user's .git"
  - "describe() for the clone: gitPaths [{staging}/.git], repoReadAllow [] (the contained run needs no read access to the user checkout); the worktree adapter stays behind the same port and passes the same contract tests"
  - "runGit hardening: GIT_CONFIG_NOSYSTEM and GIT_ATTR_NOSYSTEM; first argv must be the subcommand; --config-env refused; clone options allowlisted; neutralizeFilters blanks filter.<name>.clean/smudge/process for one call"
  - "collectRepoFacts (committed content only, no checkout file opened) and the widened RepoFacts (domain type, re-exported by the port)"
  - "classifyExistingMap, classifyPreflight (existing_state_conflict, promotion refusal, continue-a-discovered-onboarding) and EXISTING_MAP_OUTCOME"
  - "registerAndPreflight shared by onboard and `avarice repo add <path>` (registers and records preflight, no staging workspace)"
  - "preflight_json keys: notMapped, instructionFiles, existingState {planningExists, codebaseMap, adoptionDeferred, outcome}, untracked, submodules, nestedRepos, workspaceManifests, adrDirs (+ adrDirectories for the contract compiler), runtimes, trackedFiles, trackedBytes, defaultBranch, truncated (only when a list was cut)"
  - "test/helpers/hostile-repo.ts makeHostileRepo (post-checkout and post-commit hooks, core.fsmonitor, clean/smudge filter, each writing a marker outside the repo)"
affects: [01-09, 01-10, 01-11, 01-12, 01-14, 01-15, 01-19]

actuals:
  tokens: 26800
  tasks: 3
  commits: 4
plan_head_before: 52ffebf6ca5a4a987a5c77b203d85594ba9ac02b
plan_head_after: a949e2c0b9159d5ad210046b25b59da24fe868f8

tech-stack:
  added: []
  patterns:
    - "Staging adapters share GitStagingWorkspace (staging-base.ts); a subclass supplies prepare and gitAccess only"
    - "Clone staging is atomic: built at staging.partial, renamed to staging after the branch switch, so `staging` is complete or absent; a leftover is removed only when it is demonstrably this adapter's own clone of this repository"
    - "Facts about a repository come from git objects at the pin (cat-file blob, ls-tree, log), never from files of the checkout; uncommitted and untracked files are known by name"
    - "Every git call that compares or writes working-tree files passes neutralizeFilters"
    - "Hostile-repository tests carry a positive control (plain git fires every trap) and a mutation check (removing a guard fails a named test)"

key-files:
  created:
    - src/adapters/git/staging-base.ts
    - src/adapters/git/staging-clone.ts
    - src/adapters/git/repo-facts.ts
    - src/domain/preflight.ts
    - src/cli/commands/repo.ts
    - test/helpers/hostile-repo.ts
    - test/unit/preflight.test.ts
    - test/integration/no-repo-exec.test.ts
    - test/integration/preflight.test.ts
    - test/integration/checkout-unchanged.test.ts
  modified:
    - src/adapters/git/safe-git.ts
    - src/adapters/git/staging-strategy.ts
    - src/adapters/git/staging-worktree.ts
    - src/ports/staging-workspace.ts
    - src/app/stages/register.ts
    - src/cli/commands/onboard.ts
    - test/integration/staging-adapters.test.ts
    - test/integration/skeleton.test.ts

key-decisions:
  - "Staging strategy is clone (owner decision, Task 1), on the S0-B evidence: a plain linked worktree let a contained mapper move the source branch ref; denyWrite worktree and a local clone both left the source byte-identical. The clone removes the shared .git entirely and lets the sandbox deny the user checkout in full"
  - "git status runs a repository's clean filter when a modified file has the same size as its index entry, so inspecting a hostile repository ran code even with hooks and fsmonitor off; runGit now blanks every filter driver for the call (neutralizeFilters), which also covers the smudge filter in `worktree add`"
  - "Existing-map classification precedence: none, unknown-format, user-edited, unstamped, stamped-complete, stamped-partial; user-edited means a commit touching a map file after the commit that wrote its stamp (git log -S), or any uncommitted change under .planning/; every class regenerates in isolation, adoption is deferred (Phase 4)"
  - "Promotion other than none is refused in preflight (exit 64, nothing created), superseding 01-05's block at the contract stage; the contract compiler still refuses it"
  - "A new onboarding is refused with existing_state_conflict (exit 3) for an active record or another onboarding in a non-stop state other than discovered; an onboarding still in discovered is continued, which is how `onboard` follows `repo add`"
  - "Committed content is read with git cat-file blob, not git show: show applies textconv drivers"

patterns-established:
  - "Adding a staging strategy: subclass GitStagingWorkspace, implement prepare and gitAccess, add it to createStagingWorkspace, and add it to the STRATEGIES table in no-repo-exec.test.ts"
  - "A preflight fact is added in three places: the RepoFacts type (domain/preflight.ts), collectRepoFacts, and the findings in classifyPreflight"

requirements-completed: [ONB-3, ONB-4, ONB-5, ONB-6]

coverage:
  - id: D1
    description: "Task 1 resolved by the owner: clone. STAGING_STRATEGY = 'clone' and createStagingWorkspace builds CloneStagingWorkspace; the worktree adapter remains and passes the same staging contract (prepare at the pin on avarice/onboard-{onb}, head, changes after a staged edit, describe, listTracked)"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/no-repo-exec.test.ts#staging strategy decision; #staging contract: clone; #staging contract: worktree"
        status: pass
    human_judgment: false
  - id: D2
    description: "A repository with post-checkout and post-commit hooks, a core.fsmonitor command and a clean/smudge filter never has any of them run by onboard, status, inspectRepo, prepare, head, changes, describe, listTracked or read; plain git fires every trap (positive control); removing hooksPath or filter neutralization fails a named test"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/no-repo-exec.test.ts#positive control; #never runs a hook, an fsmonitor command or a repository filter; #reaches active, runs no repository code"
        status: pass
    human_judgment: false
  - id: D3
    description: "With the clone strategy and promotion none, the staging branch tip equals the pin, no commit exists that onboarding created, and the user's refs digest, HEAD, branch, worktree list, porcelain status, working-tree bytes and every byte under .git are identical before and after"
    requirement: ONB-5
    verification:
      - kind: integration
        ref: "test/integration/no-repo-exec.test.ts#the clone strategy and the user repository; #onboard a hostile repository with the fake host"
        status: pass
    human_judgment: false
  - id: D4
    description: "safe git: NOSYSTEM env, caller-supplied -c, --config-env and non-allowlisted clone options refused before git runs"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/no-repo-exec.test.ts#safe git (T-01-14)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Clone prepare refuses a target outside the work root, reuses its own staging only when it is a clone of this repository on the staging branch at the pin, reports conflict and leaves anything else untouched, and finishes after a crash during the clone"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/no-repo-exec.test.ts#the clone strategy and the user repository (prepare refusals, reuse, ownership, crash leftovers)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Preflight records existing .planning/ state, map classification, instruction files, nested repositories, submodules, workspace manifests, ADR directories, runtimes and tracked counts from committed content; no untracked file is opened (an unreadable .env is listed by name) and the fixture secret is in neither the ledger nor the data root (planted-copy positive control)"
    requirement: ONB-3
    verification:
      - kind: unit
        ref: "test/unit/preflight.test.ts#classifyExistingMap; #classifyPreflight findings"
        status: pass
      - kind: integration
        ref: "test/integration/preflight.test.ts#collectRepoFacts through the staging port; #avarice repo add"
        status: pass
    human_judgment: false
  - id: D7
    description: "ONB-6 detection and refusal: existing_state_conflict (exit 3) for an active record or an onboarding that is mid-flight (named in the message); promotion other than none refused (exit 64) before any project, onboarding, contract or staging exists; blocked, incompatible and deactivated onboardings do not block a new one"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/preflight.test.ts#classifyPreflight refusals (ONB-6)"
        status: pass
      - kind: integration
        ref: "test/integration/preflight.test.ts#ONB-6 refusals through the CLI; test/integration/skeleton.test.ts#promotion other than none is refused"
        status: pass
    human_judgment: false
  - id: D8
    description: "avarice repo add <path> creates a project row and an onboarding at discovered with preflight recorded and no staging workspace; it is idempotent; a later `avarice onboard <path>` continues that onboarding"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/preflight.test.ts#registers the repository and records preflight without creating a staging workspace; #is idempotent, and a later onboard continues that onboarding"
        status: pass
    human_judgment: false
  - id: D9
    description: "S-29: uncommitted edits and untracked files (including .env) are byte-identical (digest, porcelain status, HEAD, branch) after onboarding killed at mid-invocation and resumed; the record and preflight list them under notMapped by name; none exist in staging; the secret is in no ledger or data-root file"
    requirement: ONB-5
    verification:
      - kind: integration
        ref: "test/integration/checkout-unchanged.test.ts#leaves edits and untracked files alone, lists them as notMapped by name, and never stores their content"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-11-02
---

# Phase 01 Plan 08: Staging Strategy, Safe Git and Full Preflight Summary

**Onboarding stages in a local clone the owner chose (zero bytes written under the user's `.git`), every git call blanks hooks, fsmonitor, system config and filter drivers, and preflight reads existing state from committed content only, refusing active or in-flight projects with `existing_state_conflict` and any promotion other than `none`; `avarice repo add` registers without staging.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-11-02T20:14:30Z
- **Completed:** 2026-11-02T20:31Z (code); summary and state follow
- **Tasks:** 3 of 3 (Task 1 checkpoint resolved by the owner before dispatch; Tasks 2 and 3 TDD)
- **Files:** 10 created, 8 modified (18 changed in src and test)

## Accomplishments

- **Task 1 (checkpoint:decision, blocking-human), resolved before this run:** the owner selected `clone` after being shown the S0-B evidence and the option pros and cons. Recorded in `STAGING_STRATEGY`, in the Task 2 commit message `c2f8bca`, and in the RED commit `d4280a9`.
- **Clone staging:** `CloneStagingWorkspace` clones locally without hardlinks or checkout, detaches at the pin, switches to `avarice/onboard-{onb}`, and renames the finished clone into place. Verified: the user's repository is identical down to every byte of `.git` (a full `.git` digest is compared), no `avarice/` ref or worktree entry appears there, the staging branch tip equals the pin, and `rev-list pin..HEAD` is 0.
- **Safe git beyond hooks and fsmonitor:** `GIT_CONFIG_NOSYSTEM`, `GIT_ATTR_NOSYSTEM`, argv refusal of `-c`, `--config-env` and non-allowlisted `clone` options, and `neutralizeFilters`. The last one closes a hole the 01-04 summary flagged: with hooks and fsmonitor off, plain `git status` on a hostile repository still ran its `filter.*.clean` command whenever a modified file kept its size (confirmed with a fixture and a positive control).
- **Full preflight:** `collectRepoFacts` reports everything the spec lists from git objects at the pin; the commit that wrote each map stamp is found with `git log -S`, so "a commit touching the file after its stamp commit" is decided from history rather than from the file.
- **ONB-6:** `classifyPreflight` refuses an active record or an in-flight onboarding (naming the one to resume), ignores onboardings that stopped as blocked, incompatible or deactivated, and continues one still in `discovered`.
- **`avarice repo add <path>`:** prints project ID, onboarding ID, pin and findings; creates no staging workspace; idempotent; `onboard` afterwards continues the same onboarding.
- **S-29:** edits and untracked files, including a `.env` holding a secret, survive onboard, a SIGKILL mid-invocation and resume byte-for-byte, appear as `notMapped` by name, and the secret appears nowhere AVARICE wrote.

## Task Commits

1. **Task 1: Staging strategy decision** - resolved by the owner (clone); no commit of its own, recorded in the Task 2 commits.
2. **Task 2: Clone staging and hardened safe git** (TDD)
   - RED `d4280a9` test(01-08): 19 tests, 5 pass, 14 fail
   - GREEN `c2f8bca` feat(01-08): 19 of 19; full suite 300 of 301 then 301 of 301 after the 01-04 strategy assertion was updated
3. **Task 3: Preflight, ONB-6, repo add, checkout-unchanged** (TDD)
   - RED `aedc60a` test(01-08): 50 tests, 9 pass, 41 fail
   - GREEN `a949e2c` feat(01-08): 50 of 50; full suite 351 of 351

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN, in order, for both TDD tasks (no REFACTOR commit needed).

- **Task 2 RED:** `node --test --test-reporter=tap "test/integration/no-repo-exec.test.ts"`, exit 1, 19 tests, 5 pass (the positive control among them), 14 fail. Target test "carries GIT_CONFIG_NOSYSTEM and GIT_ATTR_NOSYSTEM next to the hooksPath and fsmonitor overrides". `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`); record `01-08-red-evidence-task2.json`. Semantic assessment: `CloneStagingWorkspace` was a stub returning `internal`, `STAGING_STRATEGY` was still `worktree`, and `runGit` did not yet refuse `-c` or neutralize filters, so every failure is an assertion on a planned behaviour; the fixture is proven live by the passing positive control. A first draft of the positive control failed because the fixture's modified file differed in size (git never ran the filter); fixing the fixture (same-length edit) is what made the filter trap real, before the RED commit.
- **Task 3 RED:** same form over the three Task 3 files, exit 1, 50 tests, 9 pass, 41 fail. Target "refuses with existing_state_conflict when an active record exists for the project"; `RED_EVIDENCE_OK`; record `01-08-red-evidence-task3.json`. One test passed vacuously at RED (the repo usage error test, because the command did not exist, so exit 64 came for free); it was tightened to assert the usage text and the "as a git repository" message before the RED commit. `checkout-unchanged.test.ts` was green on arrival: S-29 byte-identity and notMapped-by-name were built in 01-05 and hardened by Task 2. Per the fail-fast rule I investigated rather than continuing: the behaviours exist, the test is not vacuous, and a mutant that drops untracked names from `notMapped` fails it (below).
- **Mutation checks, each restored from a saved copy (no path-limited checkout on uncommitted work):** `neutralizeFilters` ignored in `runGit` -> 4 failures (clone and worktree contract, user-repository, onboard); `core.hooksPath` value changed -> the worktree hostile test fails (the clone has no source hooks by construction); untracked names dropped from `notMapped` -> 3 failures including `checkout-unchanged`; active-record refusal disabled -> 2 failures; map stamp commit computed without `-S` -> 1 failure.

## Decisions Made

See `key-decisions` in the frontmatter. For later plans:

- **01-11 (settings):** use `describe().gitPaths` for denyWrite and an empty `repoReadAllow`; the contained run needs no read access to the user checkout.
- **01-10 (record):** `notMapped` is already copied by the 01-01 builder; copy `instructionFiles` and `existingState` (which now also carries `outcome`).
- **01-14:** `adrDirectories` in `preflight_json` already feeds `knowledge.documents` through the contract compiler.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Repository filter drivers ran code during preflight**
- **Found during:** Task 2 (hostile-repo fixture; flagged as a limit in the 01-04 summary)
- **Issue:** hooksPath and fsmonitor overrides do not stop git from running `filter.<name>.clean` when it compares a same-size modified file, so `inspectRepo` (and `worktree add` under the worktree strategy) executed repository-defined commands.
- **Fix:** `runGit` option `neutralizeFilters` queries the repository's filter drivers with a config read (which runs nothing) and blanks clean, smudge and process and sets required false through `GIT_CONFIG_*` for that call; applied to status, diff, checkout and worktree add. The hostile fixture gained the filter trap.
- **Files modified:** src/adapters/git/safe-git.ts, staging-base.ts, staging-worktree.ts, staging-clone.ts, repo-facts.ts
- **Verification:** `no-repo-exec.test.ts` (positive control, both strategies, onboard); mutant above.
- **Committed in:** c2f8bca, a949e2c

**2. [Rule 3 - Blocking] A shared base for the two staging adapters**
- **Found during:** Task 2
- **Issue:** the plan keeps both adapters compiling and passing one contract; the clone needs every non-`prepare` method the worktree adapter had.
- **Fix:** `src/adapters/git/staging-base.ts` (not in the plan's file list) holds the shared half; behaviour of the worktree adapter is unchanged apart from neutralized filters.
- **Committed in:** c2f8bca

**3. [Rule 1 - Superseded behaviour] Promotion other than none now fails in preflight**
- **Found during:** Task 3 (the plan makes preflight refuse promotion; 01-05 had the contract stage block it)
- **Issue:** both cannot hold: with the preflight refusal no onboarding exists to block.
- **Fix:** refusal is `invalid request.promote` (exit 64) before any project, onboarding, contract or staging; `skeleton.test.ts` "promotion other than none is refused" now asserts exit 64, no rows, an empty work root and an unchanged checkout. The contract compiler's own refusal remains, covered by the 01-01 unit tests. 01-05's decision "blocks with reason decision, exit 3" is superseded.
- **Files modified:** test/integration/skeleton.test.ts, src/domain/preflight.ts
- **Committed in:** a949e2c

**4. [Rule 3 - Blocking] `onboard` mapped a conflict to an internal error**
- **Found during:** Task 3
- **Issue:** `src/cli/commands/onboard.ts` (not in the plan's list) turned every non-usage error from registration into exit 70; an ONB-6 refusal is not an internal failure.
- **Fix:** `conflict` prints `refused: ...` and exits 3; `repo add` does the same.
- **Committed in:** a949e2c

**5. [Rule 2 - Security] `git cat-file blob`, not `git show`, for committed content**
- **Issue:** the plan names `git show {pin}:{path}`; `show` applies `diff.<driver>.textconv` to blobs, which is repository-defined code. `cat-file blob` does not.
- **Committed in:** a949e2c

**6. Smaller departures, all within the plan's intent**
- `runGit` refuses a first argument that starts with `-` (no global options at all) and any `--config-env`, and allowlists `clone` options, instead of scanning for a literal `-c` (`switch -c` is legitimate).
- Gitlinks come from `git ls-tree -r -l` (committed state at the pin) instead of `git ls-files -s`, the same mode 160000 test.
- `existingState` carries `outcome: 'isolated-regeneration'` as well as the three planned keys, and `preflight_json` carries `adrDirectories` next to `adrDirs` because the 01-01 contract compiler reads that name.
- "uncommitted changes under `.planning/`" is read literally (any path under it), so a GSD repository with a map and a dirty `STATE.md` classifies `user-edited`; harmless today because every class has the same outcome.
- Clone `prepare` reuses an existing staging only when HEAD equals the pin and it is on the staging branch (stricter than the worktree adapter's descendant rule), matching the plan's behaviour text.
- `test/integration/staging-adapters.test.ts` asserted `STAGING_STRATEGY === 'worktree'` (01-04); it now asserts `clone` and still builds the worktree adapter on request.

---

**Total deviations:** 5 auto-fixed (2 Rule 2, 2 Rule 3, 1 Rule 1 supersession) plus the smaller departures above. **Impact on plan:** the filter finding is the substantive one: it widens T-01-14 beyond the two named traps. No scope creep.

## Issues Encountered

- A throwaway `cd /tmp/probe && rm -rf *` in an early probe was blocked by the safety check (the `cd` could have failed); I did not retry it. The probe directories (`/tmp/avprobe.*`, `/tmp/avacc.*`) were later removed by literal path, and later probes used `mktemp -d`.
- Git on this machine is 2.39.5, so `GIT_ATTR_SOURCE` (2.40) was not an option for neutralizing attributes; blanking the filter drivers works on 2.39.
- A fixture detail worth remembering: git compares a modified file by size first, so a filter or fsmonitor trap only fires when the edit keeps the file's length (and with fsmonitor answering, git trusts it and compares nothing).

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None new. T-01-14 is mitigated more widely than the register states (filters, textconv). T-01-15: the clone strategy removes the shared `.git`; the full-`.git` digest test and the ref assertions prove it. T-01-16: `repo-facts.ts` contains no file read call, an unreadable `.env` is listed by name, and the secret is absent from the ledger and data root with a positive control. T-01-17: refusals tested through the CLI. T-01-SC: no installs.

Limits worth knowing:

- The check for an existing project and the creation of its onboarding are two ledger calls, not one transaction; two simultaneous `avarice onboard` runs of one repository could both create an onboarding. The window is small and the lease still serializes stage execution per onboarding; closing it needs a ledger method.
- Continuing a `discovered` onboarding keeps its recorded request and pin; the pin is not refreshed if the repository moved on after `repo add`.
- The real Claude Code host and a real GSD mapper have not run on a clone yet (01-15 and 01-19); the clone is exercised with the fake host only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `npm test` (351), `npx tsc -p .` and `node scripts/check-boundaries.ts` (29 files) are green.
- 01-09 fills `configure-gsd` in `workspace.ts`; 01-10 replaces the validation and record-builder calls and copies `instructionFiles` and `existingState` into the record; 01-11 builds the sandbox settings from `describe()`; 01-14 extends `index-stage.ts`; 01-15 swaps the host in `composition.ts`.
- The documented local checks ran only against temp roots and scratch repositories; the user's profile and `~/aa-phan-portfolio-v2` were not touched. The first real contact with the target repository is 01-19.

## Self-Check: PASSED

- Created files present on disk: src/adapters/git/{staging-base,staging-clone,repo-facts}.ts, src/domain/preflight.ts, src/cli/commands/repo.ts, test/helpers/hostile-repo.ts, test/unit/preflight.test.ts, test/integration/{no-repo-exec,preflight,checkout-unchanged}.test.ts; modified files present.
- Commits d4280a9, c2f8bca, aedc60a, a949e2c are ancestors of HEAD; `git rev-list --count 52ffebf..HEAD` = 4.
- Acceptance criteria re-run: `no-repo-exec.test.ts` 19 pass; `grep -c "STAGING_STRATEGY = '"` = 1 and the value is `clone`; `grep -c GIT_CONFIG_NOSYSTEM safe-git.ts` = 1; `skeleton.test.ts` 12 pass; the three Task 3 files 50 pass; `grep -c existing_state_conflict src/domain/preflight.ts` = 2; `grep -cE "readFileSync|readFile\(" repo-facts.ts` = 0; `node test/helpers/test-cli.ts repo add <scratch>` (temp roots) printed a project ID and an onboarding ID, and a second `repo add` after `onboard` was refused with exit 3.
- Plan verification re-run: the five named test files 81 of 81; `node scripts/check-boundaries.ts` ok; `npx tsc -p .` exit 0; `npm test` 351 of 351.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
