---
phase: 02-contained-unattended-run-of-one-work-item
plan: 07
subsystem: git-adapters
tags: [git, run-workspace, run-source, discard, fetch, fsck, safe-git, d-01, d-02, d-03, d-04, d-16, con-16]
status: complete

requires:
  - phase: 01-onboarding
    provides: runGit and safe-git, CloneStagingWorkspace (clone at the pin, partial-then-rename), the checkout digest script, scratch-repo test helpers
provides:
  - "src/ports/run-workspace.ts: RunWorkspace, RunWorkspaceInfo, RunWorkspaceDescription, WorkspaceSnapshot, PathChange, CommitInput, FetchIntoSourceInput, HandoffResult, DiscardResult, PrepareRunInput"
  - "src/adapters/git/run-workspace.ts: CloneRunWorkspace (prepare, head, describe, status, snapshot, changedSince, discard, commit, fetchIntoSource, readText, ensureDir) and AVARICE_COMMIT_IDENTITY"
  - "src/ports/run-source.ts and src/adapters/git/run-source.ts: RunSource, ConventionsAt, Staleness, GitRunSource (head, conventionsAt, staleness)"
  - "runGit options identity, fsck, indexFile and literalPathspecs; option allowlists for fetch and commit (no forced refspec)"
  - "scripts/checkout-digest.ts: --allow-run-refs and RUN_REF_GLOB"
  - "staging-clone.ts prepareClone and staging-base.ts readConfinedFile, ensureConfinedDir, checkRelative as shared module-level helpers"
affects: [02-08, 02-09, 02-10, 02-11, 02-12, 02-13, 02-15, 02-16]

actuals:
  tokens: 28600
  tasks: 3
  commits: 3
plan_head_before: db0aebe897f07bb43152128859a25aed76f77809
plan_head_after: 98c48627304791610dc7e99b264028bb2c77598d

tech-stack:
  added: []
  patterns:
    - "Every git call that can touch working-tree content carries neutralizeFilters, including write-tree on a temporary index"
    - "A tree of the clone's working content is computed through a temporary GIT_INDEX_FILE under {workRoot}/{runId}/tmp, so the clone's own index is never written"
    - "Paths that come from data go to git with literalPathspecs; paths that name the discard set come only from a tree difference"

key-files:
  created:
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts
    - src/ports/run-source.ts
    - src/adapters/git/run-source.ts
    - test/integration/run-workspace.test.ts
    - test/integration/run-source.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-07-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-07-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-07-red-evidence-task3.json
  modified:
    - src/adapters/git/safe-git.ts
    - src/adapters/git/staging-clone.ts
    - src/adapters/git/staging-base.ts
    - scripts/checkout-digest.ts
    - test/unit/checkout-digest.test.ts

key-decisions:
  - "fetchIntoSource also turns gc.auto and maintenance.auto off for the fetch (done inside runGit for the fetch subcommand), so handing a run branch to the source cannot start a repack or prune of the user's repository"
  - "commit adds then commits with literal pathspecs: git add -- paths, a check that the staged diff of those paths is non-empty (else conflict), then commit -- paths, which commits exactly those paths and leaves anything else staged out"
  - "descent from the pin is decided by merge-base (the merge base equals the pin), because runGit does not expose the exit status that merge-base --is-ancestor answers with"
  - "A symlink the run planted is removed as a link and never followed; a parent that resolves outside the clone is refused (denied); a directory is never removed by discard"

patterns-established:
  - "discard order: additions are unlinked first, an empty directory standing where a snapshot file belongs is removed with rmdir, then changed paths are restored in chunks from the snapshot tree"

requirements-completed: [CON-9, CON-16, FR-6, RC-2, CON-8]

coverage:
  - id: D1
    description: "A run clone is built at {workRoot}/{runId}/clone at the pin on avarice/<runId> by the staging-clone rules; the source is not written by preparation"
    requirement: CON-9
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#CloneRunWorkspace.prepare (D-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The supervisor commits exactly the given clone-relative paths under the fixed AVARICE identity, unsigned, with hooks and filters off; empty, absolute, .., .git and leading-dash paths are refused before any git runs"
    requirement: FR-6
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#CloneRunWorkspace.commit (D-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "fetchIntoSource creates one create-only ref in the source with fsck on; HEAD, index, tree including ignored files, config and every other ref are byte-identical; an equal ref is created false, a different ref is a conflict with nothing fetched; a hostile object is rejected"
    requirement: CON-9
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#CloneRunWorkspace.fetchIntoSource (D-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "discard restores exactly the paths the run changed to the snapshot content (a user's pre-run edit is kept), deletes only what the snapshot lacks, leaves ignored paths and out-of-clone symlink targets alone, refuses when HEAD moved, and is a no-op when repeated"
    requirement: CON-16
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#snapshot, changedSince and discard (CON-16, CON-9)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The source reader takes conventions only from git objects (a descendant of the pin whose diff is only under .avarice/), reports not_found, conflict and invalid as specified, and counts staleness outside .avarice/ and .planning/; an uncommitted edit changes nothing"
    requirement: RC-2
    verification:
      - kind: integration
        ref: "test/integration/run-source.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "runGit refuses a forced refspec and any fetch or commit option outside the allowlists, and accepts identity, fsck, indexFile and literalPathspecs only as fixed options"
    requirement: CON-8
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#runGit option allowlists and fixed options (plan 02-07)"
        status: pass
    human_judgment: false
---

# Phase 2 Plan 07: Run workspace and run source git adapters Summary

**The supervisor can clone a run at the pin, commit exactly the run's paths as AVARICE, hand the run branch to the source as one create-only fsck-checked ref with the user's checkout byte-identical, undo a crashed attempt back to a snapshot that keeps the user's own edits, and read repository conventions and drift from git objects alone.**

## Performance

- **Duration:** about 45 min (the start time was not recorded at the beginning of the run; this is an estimate from the work done, end 19:15 UTC, 2026-11-05)
- **Tasks:** 3 (one tracer, two auto)
- **Files:** 14 changed (1694 insertions, 161 deletions; about 28 600 tokens by chars/4 over the diff) plus this summary

## Accomplishments

- Task 1 (tracer): `RunWorkspace` port and `CloneRunWorkspace`. `prepare` reuses the staging-clone rules through a new module-level `prepareClone` (CloneStagingWorkspace behaviour unchanged; the Phase 1 staging-adapters and checkout-unchanged suites pass unchanged). `commit` runs add, a non-empty-diff check and `commit -- paths` through `runGit` with `identity`, `neutralizeFilters`, `literalPathspecs`, `--no-verify`, `--no-gpg-sign`; a global `commit.gpgsign=true` in a temp HOME changes nothing and hooks and a clean filter planted in the clone do not run. `fetchIntoSource` is create-only with fsck on. The fetch test compares the digest script, a tree digest that includes ignored and untracked files, the index and config bytes, HEAD and every non-run ref before and after, on a source that has a staged edit, an unstaged edit, an untracked `.env` and an ignored file: all equal; the only new `for-each-ref` line is the run branch; no FETCH_HEAD. A tree with a `.git` entry is rejected by fsck (`hasDotgit`) and no ref is created.
- Task 2: `snapshot`, `changedSince` and `discard`. Snapshot is `read-tree HEAD`, `add -A`, `write-tree` on a temporary index in `{workRoot}/{runId}/tmp` (0700), removed afterwards; it also records the ignored entries (capped at 10 000). Discard restores from the snapshot tree one chunk at a time and unlinks only paths the snapshot lacks, then recomputes the tree and requires it to equal the snapshot tree. Tests assert bytes for user-dirty (README keeps the user's edit, not HEAD's), run-new, run-modified, run-deleted, ignored (new and pre-existing, left as the run made them, `ignoredLeft: ['.cache/']`), head-moved (conflict `head-moved`, nothing changed), empty and repeated discard, a directory replaced by a file and the reverse, and a symlink planted over `src/` that points outside the clone (the link is removed, the outside directory is untouched). `grep -cE "'(reset|clean)'"` on the adapter returns 0.
- Task 3: `RunSource` port and `GitRunSource`. Conventions: newest first-parent commit whose `diff-tree` against the pin is only under `.avarice/` and whose tree holds a regular-file `.avarice/config.json`, the pin last; a blob over 256 KiB is `invalid` before it is read (exactly 256 KiB is read); a symlink is not a config file; a HEAD that does not descend from the pin is `conflict`. Staleness counts commits outside `.avarice/` and `.planning/` and returns the oldest committer time in ms. 14 tests; an uncommitted, staged or deleted working-tree copy of the config changes nothing; `grep -c readFileSync` returns 0.

## Task Commits

1. Task 1 (tracer): `a632734` feat(02-07): run workspace clone, supervisor commit and fetch of the run branch into the source
2. Task 2: `cbaa877` feat(02-07): snapshot-bound discard that restores only what the run changed
3. Task 3: `98c4862` feat(02-07): run source reader for conventions at a descendant of the pin and staleness

Commits measured as `git rev-list --count db0aebe..98c4862` = 3 (before this summary commit).

## Verification

- Plan verification: `node --test` on run-workspace, run-source, checkout-digest, staging-adapters and checkout-unchanged: 112 pass, 0 fail.
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (64 files).
- Wider regression: `test/unit` plus `test/integration` 1542 pass, 0 fail; `test/fault` 65 pass, 0 fail. The containment suites were not run (this plan changes no containment path and calls no live `claude`).
- Acceptance criteria: fetch test asserts equal digests and a one-line `for-each-ref` difference (pass); `grep -c "'-c'"` on run-workspace.ts 0; Phase 1 staging-adapters and checkout-unchanged pass unchanged; `grep -cE "'(reset|clean)'"` 0; run-source.test.ts 14 tests (at least 8); `grep -c readFileSync` run-source.ts 0.
- Tracer gate (auto-mode, `<verify>` re-run end to end after Task 1): passed, expansion continued.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] literalPathspecs option so a path from data cannot be a glob or pathspec magic**
- **Found during:** Task 1 (design of `commit`)
- **Issue:** the plan allowlists the commit pathspec but a clone-relative path such as `pages/[id].tsx` would be read by git as a glob, committing a different set than the one given (CON-16, "exactly the given paths").
- **Fix:** `RunGitOptions.literalPathspecs` sets `GIT_LITERAL_PATHSPECS=1`; commit, the staged-diff check and the discard restore use it. The test commits `pages/[id].tsx` without sweeping in `pages/x.tsx`.
- **Files modified:** src/adapters/git/safe-git.ts, src/adapters/git/run-workspace.ts
- **Commit:** a632734

**2. [Rule 2 - Missing critical] A fetch into the source turns auto gc and maintenance off**
- **Found during:** Task 1 (T-02-18, "the only write to the source is the one fetched ref")
- **Issue:** `git fetch` can run `maintenance run --auto`, which may repack or prune the user's repository, a write the plan does not allow.
- **Fix:** inside `runGit`, the `fetch` subcommand adds `gc.auto=0` and `maintenance.auto=false` as fixed config entries (not caller-controlled).
- **Commit:** a632734

**3. [Rule 1 - Bug] write-tree ran a repository clean filter**
- **Found during:** Task 2 (the "filter and hooks do not run" test failed with a marker from the clean filter)
- **Issue:** the temporary-index tree computation neutralized filters on `add -A` only; `write-tree` re-hashes a racily clean entry and ran the clean filter. This was already present in the Task 1 code (status, snapshot).
- **Fix:** every call in the tree computation carries `neutralizeFilters` now; the test stays in as the guard. Stable over repeated runs.
- **Files modified:** src/adapters/git/run-workspace.ts
- **Commit:** cbaa877

**4. [Rule 3 - Blocking] merge-base instead of merge-base --is-ancestor**
- **Found during:** Task 3
- **Issue:** `runGit` returns no exit status, so `--is-ancestor` with `acceptExit [1]` cannot tell yes from no.
- **Fix:** `merge-base pin head` (exit 1 accepted for unrelated histories); HEAD descends from the pin exactly when the merge base is the pin. Staleness uses one `log --format=%ct` with the exclude pathspecs (count and minimum time together) instead of `rev-list --reverse` plus `log -1`; same result, one call.
- **Commit:** 98c4862

**5. [Rule 2 - Interpretation of the plan] discard and symlinks**
- The plan says discard refuses "a symlink that points outside the clone". Implemented as: a symlink the run added is unlinked as a link and never followed (leaving it would leave an out-of-clone path inside the next attempt's clone), and a parent component that resolves outside the clone is refused with `denied`. If the owner reads the sentence as "refuse the whole discard when such a link exists", that is a one-line change in `removeAddedPath`.

**Total deviations:** 5 (3 missing critical or interpretation, 1 bug, 1 blocking). **Impact:** none on scope; all five tighten the plan's own mitigations (T-02-18, T-02-19, T-02-20).

## Issues Encountered

- The harness refused heredocs, compound commands and sed or python that mention git in a plain command; files were written with Write and Edit and one-off edit scripts were run as `node` files from the worktree root. `git rev-parse --show-toplevel` printed `/Users/aphan/avarice/.claude/worktrees/phase-02-discuss` before the first write and before every commit.
- RED evidence for tasks 1 and 3 is a missing-module failure (the adapter file did not exist); task 2's RED is six assertion failures. The `--allow-run-refs` option was written in the same step as its unit test, so that one test has no separate RED (stated in the task 1 evidence file).
- No live model run and no live-spend entry: this plan never calls `claude`. No git command in the code or the tests touches the owner's portfolio checkout or this worktree's refs; every repository is a scratch repository under `os.tmpdir()`.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. The only new write to a source repository is the create-only `refs/heads/avarice/<runId>` fetch (T-02-18), which nothing calls yet.

## Next Phase Readiness

Later plans (start, the run loop, recovery) can call `RunWorkspace` and `RunSource` as ports.

- `prepare` reuses an existing clone only while its HEAD is still the pin (the staging-clone rule, as the plan says). After a supervisor commit the HEAD has moved, so a resume must read `head()` and reconcile rather than call `prepare` again; that is for the run-resume plan.
- `discard` needs the snapshot the caller kept. `WorkspaceSnapshot` is plain data (head, tree, ignored) and can be stored in a checkpoint event; the tree object lives in the clone's object store.
- `Staleness` carries a timestamp; the caller (start, D-04) computes the age in days against its own clock and chooses the threshold and the refusal wording.
- `describe(path, relPaths)` lists entry names per requested directory at HEAD; an absent directory maps to `[]`.
- The requirement IDs CON-9, CON-16, FR-6, RC-2 and CON-8 are shared with later plans, so `requirements.ready-ids` reports 0 of 5 ready; they are listed under `requirements-completed` and not marked in REQUIREMENTS.md.

## Self-Check: PASSED

- FOUND: src/ports/run-workspace.ts, src/adapters/git/run-workspace.ts, src/ports/run-source.ts, src/adapters/git/run-source.ts, test/integration/run-workspace.test.ts, test/integration/run-source.test.ts, 02-07-red-evidence-task1.json, 02-07-red-evidence-task2.json, 02-07-red-evidence-task3.json
- FOUND commits: a632734, cbaa877, 98c4862 (ancestors of HEAD)
- Plan verification and acceptance criteria re-run after the last commit: all pass (see Verification).
