---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 20
subsystem: retrieval
tags: [task-refs, freshness, resume, context-source, brief, ref_changed, ref_deleted, access_revoked, fr-8, fr-3, fr-18, typescript]
status: complete

requires:
  - phase: 04-09
    provides: "handle-first queryContext whose pack items carry the provider's ExternalRef"
  - phase: 04-16
    provides: "the resume hook that blocks a run before any reconcile step, and the withdraw-only decision pattern"
provides:
  - "Ledger recordTaskRefs, listTaskRefs, updateTaskRefFreshness: the first writer of task_refs (src/ports/ledger.ts, src/adapters/sqlite/ledger.ts)"
  - "ContextSource.refresh(ref, query), implemented by gsd-graph and gsd-intel from the index revision, the active record and the repository HEAD"
  - "refreshRunRefs and blockedReasonFor (src/app/resume-refs.ts): refresh every recorded reference in primary-key order, fixed block precedence"
  - "Resume blocks a run on a changed, deleted or revoked reference: ref_changed, ref_deleted, access_revoked (src/app/run-resume.ts)"
  - "start records the brief file as manual-brief / brief-file; the item stage records every pack item's reference"
  - "status shows references last refreshed to anything but fresh (staleReferences)"
affects: [04-28, 04-37, 04-38]

actuals:
  tokens: 18500
  tasks: 3
  commits: 5
plan_head_before: 5f2239f45a08bf41f631020e5a2e9ffcc9d4cbc8
plan_head_after: 9747d0ef211e14a5a9103fa3ccb9b77c49226ce1
commits: 5

tech-stack:
  added: []
  patterns:
    - "A reference keeps the revision the run was built from: a refresh updates freshness and retrieval time only, so a changed reference is found changed again on every later resume"
    - "Resume order: reap, charge orphans, no-replay of privileged actions, then references, then reconcile; a reference block ends the reconcile before any unit is launched"
    - "A run-wide block that must not disturb its items (an interrupted action, a changed reference) opens a withdraw-only decision with no affected item and transitions the run itself, instead of blockRun, which would move an in-flight item"

key-files:
  created:
    - src/app/resume-refs.ts
    - test/integration/run-resume-refs.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-20-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-20-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-20-red-task3.json
  modified:
    - src/ports/context-source.ts
    - src/ports/ledger.ts
    - src/adapters/context/gsd-graph.ts
    - src/adapters/context/gsd-intel.ts
    - src/adapters/sqlite/ledger.ts
    - src/app/context.ts
    - src/app/run-resume.ts
    - src/app/run-start.ts
    - src/app/run-stages/item.ts
    - src/app/run-status.ts
    - src/cli/render/run-view.ts
    - test/integration/context-handle-first.test.ts
    - test/integration/status-queries.test.ts

key-decisions:
  - "The blocked reason follows the precedence access_revoked, ref_deleted, ref_changed whatever order the references refreshed in; the decision lists every changed, deleted or revoked reference (at most 20, then a count)"
  - "The brief reference is the file's real path as the provider ID and `sha256:` plus the SHA-256 of its bytes as the revision (the bytes read for the parse, so a byte order mark counts); a brief that grew past 64 KiB or stopped being UTF-8 reads as changed, a directory or missing file as deleted, EACCES or EPERM as access_revoked, any other open error as unavailable"
  - "refresh takes the project's index query as a second argument (ContextRefreshQuery): a reference alone names no repository, staging copy or current index revision"
  - "A refresh never overwrites the recorded revision of any reference; the source's current revision is returned in the result and ignored by the ledger write"
  - "A reference block opens one withdraw-only decision (class acceptance, or permission for access_revoked) with no affected item and leaves every work item and attempt as it was"

patterns-established:
  - "Skeleton-first RED for a new port method: the method exists on the adapters and returns an internal error, so the cases fail on their assertions"

requirements-completed: [FR-8, FR-3, FR-18]

coverage:
  - id: D1
    description: "S-5: a run started from a brief file, whose file is edited before `avarice resume`, moves to blocked_on_decision with reason ref_changed, opens one decision naming the brief, launches no unit and starts no attempt; the reference is `changed` and keeps its original digest. A deleted brief gives ref_deleted."
    requirement: FR-8
    verification:
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#S-5 tracer: an edited brief file blocks the resumed run with ref_changed before any unit is launched (FR-8, FR-18, T-04-54)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#a deleted brief file blocks the resumed run with ref_deleted (FR-8)"
        status: pass
    human_judgment: false
  - id: D2
    description: "start records the brief file as a task_ref (manual-brief, brief-file, real path, sha256 of its bytes, fresh); an unchanged brief resumes to ready_for_review with the reference fresh"
    requirement: FR-18
    verification:
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#start records the brief file as a task reference: provider manual-brief, kind brief-file, the real path, the digest of its bytes, fresh"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#an unchanged brief file does not stop the resume (FR-8)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ContextSource.refresh: gsd-graph and gsd-intel return fresh, stale, changed or deleted from the index revision, the active record and the repository HEAD"
    requirement: FR-8
    verification:
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#gsd-graph refresh judges a node by the index revision and the repository HEAD (FR-8)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#gsd-intel refresh mirrors it from the commit the intel was refreshed at (FR-8)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every pack item is a task_refs row with the provider's ID unchanged (an ID with `#` and `:`); after a new commit the resume leaves the index references stale, the run continues to ready_for_review and status lists them"
    requirement: FR-3
    verification:
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#a run records one task reference per context pack item, with the provider ID unchanged (FR-3, FR-18)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Block precedence for all four severities; two references with the same ID from different providers are two rows refreshed once each in primary-key order; unavailable and stale never block (unavailable warns); a run with no references makes no refresh call"
    requirement: FR-8
    verification:
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#blockedReasonFor: the fixed precedence access_revoked, ref_deleted, ref_changed (ordering edge, FR-8)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume-refs.test.ts#refreshRunRefs: every reference is its own row, refreshed once, in primary-key order, with a fixed block reason (FR-8)"
        status: pass
    human_judgment: false

duration: 35 min
completed: 2026-11-17
---

# Phase 4 Plan 20: Reference freshness on resume Summary

**A run now records the brief file and every context pack item in task_refs and, on `avarice resume`, refreshes each in primary-key order before anything continues: a changed brief stops the run `blocked_on_decision` with `ref_changed` (S-5), a deleted one `ref_deleted`, a revoked one `access_revoked`, and stale or unavailable references let it go on.**

## Performance

- **Duration:** about 35 min
- **Started:** 2026-11-17T06:19Z
- **Completed:** 2026-11-17T06:55Z
- **Tasks:** 3 (a tracer and two auto tasks, all TDD)
- **Files:** 5 created, 13 modified

## Accomplishments

- Ledger: `recordTaskRefs` (INSERT OR REPLACE by primary key), `listTaskRefs` (provider, kind, ID order), `updateTaskRefFreshness`. `loadRunStatusInputs` reads the references in the same batch, so status still prepares a fixed number of statements.
- `start` records the brief file: provider `manual-brief`, kind `brief-file`, the real path as ID, `sha256:` of the bytes read as revision.
- `refreshRunRefs` re-reads the brief, routes `gsd-intel` and `gsd-graph` to their source, maps a source's `not_found` to deleted and `denied` or `unauthenticated` to access_revoked, writes each new freshness, and returns the block (most severe reason, every offending reference) and the warnings for the unavailable ones. `blockedReasonFor` is the pure precedence.
- Resume: after the reap, the orphan charge and the no-replay check, and before any reconcile, a block opens one withdraw-only decision (found again by its evidence references if a resume was killed after opening it) and moves the run to `blocked_on_decision`. No unit is launched and no attempt is started.
- `ContextSource.refresh` on both adapters: deleted when the cited path is gone at HEAD, changed when the index revision differs from the project record's, else the build commit against HEAD gives fresh or stale (intel also asks GSD's diff while the commits agree).
- The item stage records one task_ref per pack item. `status` lists references last refreshed to anything but fresh (`staleReferences`, and a `stale references:` line).

## Task Commits

1. **Task 1: tracer, an edited brief blocks the resumed run** - RED `0b65473` (5 of 5 failing, `RED_EVIDENCE_OK`), GREEN `f3cc244`
2. **Task 2: context source refresh, pack references per item** - RED `9b3a0e9` (12 of 17 failing, `RED_EVIDENCE_OK`), GREEN `af21f89`
3. **Task 3: precedence, adjacency, ordering, empty case** - `9747d0e` (tests; RED by mutation, see deviation 3)

Plan metadata (this summary, STATE, ROADMAP, REQUIREMENTS) is committed separately.

## TDD

- **Task 1 RED:** a real SIGKILL of the supervisor at `after-checkpoint:context-pack#2`, then a resume. The cases failed on `assert.equal(refs.length, 1)` (actual 0) and on `assert.notEqual(resumed.code, 0)`; no import or fixture fault.
- **Task 2 RED:** skeleton-first. `refresh` existed on both adapters and returned an internal error, so the adapter cases failed on `assert.ok(refreshed.ok)` and the run cases on `0 !== 4` pack rows.
- **Task 3 RED:** by mutation (deviation 3). Four mutations of the committed `resume-refs.ts` (precedence reversed, reverse iteration, an ID already seen skipped, unavailable treated as a block) made 10 of 16 cases fail on their assertions; the file was restored with `git checkout` before the commit.
- No REFACTOR commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `refresh` takes the project's index query as a second argument**
- **Found during:** Task 2
- **Issue:** the plan's `refresh(ref)` gives an adapter no repository path, staging copy or current index revision, which the freshness helpers and the "index revision equals the active record" rule need.
- **Fix:** `refresh(ref, query: ContextRefreshQuery)`, the `find` query without its term, built by `refreshQueryFor` in `src/app/context.ts` from the project's active record. A missing index revision makes the reference `unavailable`.
- **Commit:** `af21f89`

**2. [Interpretation] The block does not go through `blockRun`**
- **Found during:** Task 1
- **Issue:** the plan says to block through the existing path (`blockRun`), which moves the in-flight work item to `blocked_on_decision` and ends its attempt. A run killed mid-item that is later let go on would then find its item neither reconcilable nor parked.
- **Fix:** followed plan 04-16's resume block instead: one decision (`withdraw` only, no affected item), the run transitioned with the reason, items and attempts untouched. A resume that is itself killed after opening the decision finds it by its evidence references (`ref:<provider>:<kind>:<ID>`) and opens none twice. A run that was blocked on an answered item decision goes `blocked_on_decision -> paused -> blocked_on_decision` to change its reason (the lifecycle has no self edge); that path is implemented, not tested.
- **Commit:** `f3cc244`

**3. [Rule 3 - Blocking] Task 3 tests could not be red against Tasks 1 and 2's GREEN**
- **Found during:** Task 3
- **Issue:** the precedence, adjacency, ordering and empty cases were all delivered by the earlier tasks, so the new cases passed on first run.
- **Fix:** showed the tests discriminate by mutating the committed source four ways; 10 of 16 failed on their assertions; recorded in `04-20-red-task3.json`, classified `RED_EVIDENCE_OK`. Source restored before the commit. Task 3 has one `test(04-20)` commit and no `feat` commit.
- **Commit:** `9747d0e`

**4. [Rule 2 - Missing critical] Status lists the stale references**
- **Found during:** Task 2
- **Issue:** the behavior "status lists them as stale" named no file. `RunStatusInputs` gained `taskRefs` (read in the existing batch), `RunStatus` an optional `staleReferences` (present only when there is one, as the frozen-shapes rule requires), and `status` prints a `stale references:` line. `status-queries.test.ts` builds the oracle inputs, so its `perRunInputs` gained `taskRefs`.
- **Commit:** `af21f89`

**5. [Rule 3 - Blocking] A third RED record, and one plan behavior not applicable**
- Task 3 is `tdd="true"` too, so `04-20-red-task3.json` exists beside the two the plan lists. The plan's "a run started with an inline brief has no task_ref" has no counterpart: `avarice start` takes `--brief <file>` only (`startRun` needs `briefPath`). The nearest case, a run with no recorded reference, is the empty-edge test.
- **Commit:** `0b65473`, `9747d0e`

**Total deviations:** 5 (3 Rule 3, 1 Rule 2, 1 interpretation). **Impact:** none on scope; every behavior in the plan is delivered and tested except the two noted.

## Decisions needing owner review

The plan left these open and I chose a policy.

1. **The owner has no way out of a reference block except `avarice cancel`.** The decision offers `withdraw` only and the block reasons `ref_changed`, `ref_deleted` and `access_revoked` are not continued by the supervisor (only reason `decision` is), exactly as for 04-16's `enforcement_failure`. The contract says the owner may "accept the change or rebuild the pack"; neither exists yet. If the owner wants one, it needs a command that re-records the changed references (accept) or rebuilds the pack, and a rule for what happens to the in-flight item.
2. **A changed reference keeps its original revision.** A second resume finds it changed again instead of accepting it; this is what makes "never continue on text that changed" hold, and it means acceptance must be an explicit act.
3. **Reason precedence is access_revoked, ref_deleted, ref_changed** (a flagged assumption of the plan, implemented as written). All offending references are listed in the one decision, at most 20 shown.
4. **A graph reference whose cited path is gone is `deleted` before the index revision is compared**, so a node of a rebuilt graph whose file was removed reads deleted, not changed. Intel only knows a path for `file-roles.json` entries (the part of the ID after `#`); an entry of another intel index cites none, so it is never `deleted`.
5. **`intel` freshness `changed` (GSD's diff says an intel file moved since its snapshot) blocks a resumed run**, because the plan maps changed to ref_changed. A repository whose intel index is edited after a pack was built will therefore block runs that used it. If that is too strict, the adapter should report such a drift as `stale`.
6. **`unavailable`** (no source composed, no index revision in the record, a brief file that cannot be opened for another reason) continues with a warning and writes `unavailable` to the row.

## Documentation surfaces (for plan 04-38)

`docs/system/` was not edited here; the phase documentation plan owns it.

- **Table writer:** `task_refs` has a writer. Columns as migration 0001, primary key (run, provider, kind, ext_id); `recordTaskRefs` replaces a row by key, so a rebuilt pack overwrites an earlier reference to the same item with the newer revision. Two providers with one ID are two rows. Reads in primary-key order; the batch read for `status` is in the same order.
- **Providers and kinds:** `manual-brief` / `brief-file` (ID = real path of the brief, revision = `sha256:<hex of the bytes>`, scope = the same path); `gsd-intel` / `intel-entry` (ID `<index file>#<key>`, scope `.planning/intel/<index file>`); `gsd-graph` / `graph-node` (ID = node ID verbatim, scope = the node's source file or `.planning/graphs/graph.json`).
- **Blocked reasons now set:** `ref_changed`, `ref_deleted`, `access_revoked`, in that increasing order of precedence, by resume. The decision: class `acceptance` (`permission` for access_revoked), option `withdraw` only, no affected item, evidence references `ref:<provider>:<kind>:<ID>`, stateDigest as every decision. Transition data: `references`, `decisionId`, `class`.
- **Resume step:** between the no-replay check and the reconcile, refresh every reference in primary-key order. `fresh` and `stale` continue (stale is shown by `status`); `unavailable` continues with a note; the reasons above stop the run before any launch. The event `task_refs.refreshed` (data `runId`, `count`, `freshness` counts, level warn when anything is not fresh) is written once per resume that had references.
- **Refresh rules by source:** brief: gone or not a file is deleted, unreadable (EACCES, EPERM) access_revoked, bytes differing or too large or not UTF-8 changed. Graph: cited path gone at HEAD deleted; recorded revision not the project record's graph revision changed; else build commit against HEAD fresh or stale. Intel: file-roles key gone at HEAD deleted; recorded revision not the record's intel revision changed; else the commit against HEAD, and GSD's file diff while they agree. A source error `not_found` is deleted, `denied` and `unauthenticated` access_revoked, any other unavailable.
- **status:** optional `staleReferences` (provider, kind, id, freshness) on each run, present only when a reference's last freshness is not `fresh`; the text view prints `stale references: ...`.
- **Contract text:** docs/contracts-and-state.md "Reference freshness" describes `stale` as "not refreshed within the profile's freshness window (default 24 hours)"; the code calls a reference stale when HEAD moved past the index build, with no window. Add one line to `docs/system/findings.md`. The "accepts the change or rebuilds the pack" way out and the purge of cached excerpts for an access_revoked reference (plan 04-28) are not built here.
- **Port:** `ContextSource.refresh(ref, query)`; descriptors of both adapters now say `refresh: true`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-54 (a brief edited while a run waits, then executed silently): the brief is recorded by digest, the resume refreshes it and blocks with `ref_changed` before any delegation; the S-5 test asserts no launch step and no attempt is added. T-04-55 (a revoked source still feeding packs): access_revoked blocks the run; the purge of cached excerpts is plan 04-28's. No package was installed (T-04-SC).

## Verification

- `node --test test/integration/run-resume-refs.test.ts test/integration/context.test.ts`: 45 tests, 0 failures (17 in the new file at Task 2, 33 after Task 3, plus the context suite).
- `npm run typecheck`: clean. `npm run check:boundaries`: ok (117 files).
- `node --test "test/unit/**/*.test.ts"` with `status-queries`, `run-status`, `context-handle-first`, `context`, `ledger-status`, `run-start`, `run-baseline-workflow` and `skeleton`: 2855 of 2855.
- Related resume, ledger and fault suites (`run-resume`, `resume-reap`, `run-decision-resume`, `decision-ledger`, `exit-parity`, `cli-terminal-text`, `run-park`, `run-supervisor`, `run-ledger`, `decide-race`, `run-reconcile`, `privileged-no-replay`, `run-resume-session`, `run-discard-retry`, `migrations`): 224 of 224. The full `npm test` is the orchestrator's.
- Acceptance: `04-20-red-task1.json`, `-task2.json` and `-task3.json` exist with exit code 1 and `RED_EVIDENCE_OK`; `grep -n "refreshRunRefs" src/app/run-resume.ts` prints the import and the call; `grep -n "refresh(" src/ports/context-source.ts` prints the port method; the precedence table is asserted for all four severities.

## Next Phase Readiness

Ready for 04-21. Plan 04-28 (purge cached excerpts of an access_revoked reference) reads `task_refs` rows whose freshness is `access_revoked`.

## Self-Check: PASSED

- Files: `src/app/resume-refs.ts`, `test/integration/run-resume-refs.test.ts` and the three `04-20-red-task*.json` records exist on disk.
- Commits: `0b65473`, `f3cc244`, `9b3a0e9`, `af21f89`, `9747d0e` are ancestors of HEAD.
