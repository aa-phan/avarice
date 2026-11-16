---
phase: 03-decisions-independent-work-and-amendments
plan: 09
subsystem: run-workspace
tags: [git, park, unpark, run-clone, refs, symlink-safety, independent-work]
status: complete

requires:
  - phase: 02-run-engine
    provides: "RunWorkspace port, CloneRunWorkspace snapshot/changedSince/discard, safe runGit, no-follow file helpers"
provides:
  - "RunWorkspace.park(path, { base, runId, itemId }): the paused item's delta (every path changed since the base snapshot) kept as a commit object under refs/avarice/park/<runId>/<itemId>, then the tree put back to the base snapshot"
  - "RunWorkspace.unpark(path, record): the parked delta restored onto the current HEAD (content, file mode, deletions), or a conflict naming the paths and nothing changed"
  - "RunWorkspace.dropPark(path, ref): deletes the park ref and nothing else"
  - "ParkRecord { ref, commit, tree, baseHead, paths }"
affects: [03-10 and later run-stage plans that run independent items in one clone, 03-31 documentation plan]

actuals:
  tokens: 15000
  tasks: 2
  commits: 3

plan_head_before: db249e011c7d8ccc5db587c228127717fc99f920
plan_head_after: bfc470b5de551c1f0c700a6cf6c4a16b37d7ebd0

tech-stack:
  added: []
  patterns:
    - "A parked delta is a commit-tree commit (no index, no hook) held by a ref in a private namespace of the run clone; gc cannot collect it"
    - "A conflict check compares tree entries (mode and object id) of exactly the parked paths at the park tree, the base HEAD, the current HEAD and the working content, through ls-tree with literal pathspecs"
    - "Writes go through restore --source=<park tree> after a no-linked-parent check; deletions go through the same no-follow unlink discard uses"

key-files:
  created:
    - test/integration/run-park.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-09-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-09-red-evidence-task2.json
  modified:
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts

key-decisions:
  - "unpark keeps the park ref; the caller ends a park with dropPark once the item has resumed or been committed. Parking the same item again while its ref holds a different delta is a conflict, never an overwrite."
  - "Parking the same content again for the same item under the same base returns the same record (finishes an interrupted park), because the ref is created before the tree is put back."
  - "A path that already holds the parked content is skipped before any conflict check, so a repeated unpark, and an unpark after the item committed its own paths, is a no-op returning the same applied list."
  - "A nested repository (gitlink) in the delta is refused invalid; a parent directory that is a symlink is denied."

requirements-completed: [AUT-3]

duration: 41 min
completed: 2026-11-09
---

# Phase 3 Plan 09: Park and unpark of a paused item's delta Summary

Park and unpark in the git run workspace: a paused item's edits and quick records leave the clone as a ref-held commit object, the next item runs on the base tree, and the delta comes back on top of that item's commit, or is refused with the conflicting paths named.

## Accomplishments

- **Tracer (Task 1).** `park` snapshots nothing new itself: it takes the working-content tree, diffs it against `base.tree` for the delta paths, writes a commit with `commit-tree` (fixed identity, parent `base.head`, message `avarice park <runId> <itemId>`), creates the ref create-only (`update-ref` with the zero old value), then calls `discard(path, base)` and removes the directories the removed records leave empty. `unpark` restores the parked paths from the park tree. A round trip on real git (B edits, adds a quick PLAN and deletes a file; C commits; B comes back) leaves C's commit in place and `changedSince` lists exactly B's three paths. The source repository's refs, index and files are unchanged.
- **Refusals (Task 2).** `unpark` returns `conflict` naming the paths when a parked path differs between the base HEAD and the current HEAD, or is modified in the working tree now, and changes nothing (the test compares the working tree digest, status, HEAD and index bytes before and after). A parent directory that is a symlink is `denied` before any write. A parked symlink is restored as the link itself. The delta survives `git gc --prune=now`; after `dropPark` it is collectable. Item IDs and run IDs must be plain names; a tampered record (non-park ref, non-SHA ids, `..`, `.git`, absolute or non-normal paths, a commit or tree that is not the ref's) is `invalid` or `conflict`.
- 49 tests pass across `run-park.test.ts` and `run-workspace.test.ts`; `tsc -p .` and `check-boundaries` are clean. The park, unpark and dropPark methods and their helpers are asserted by test to name none of `reset`, `clean` or `checkout`.

## Task Commits

| Task | Commit | Type |
| ---- | ------ | ---- |
| 1 RED | 43ca459 | test(03-09): failing round-trip, mode and no-destructive-verb tests |
| 1 GREEN | 574a156 | feat(03-09): park, unpark, dropPark in port and adapter |
| 2 | bfc470b | test(03-09): conflict, gc, idempotence, hostile-input tests |

## Deviations from Plan

### Plan wording reconciled

**1. [Rule 1 - Spec inconsistency] unpark takes two arguments**
- **Found during:** Task 1
- **Issue:** The behavior block calls `unpark(clone, record, base)`; the action block and the port signature say `unpark(path, record)`.
- **Fix:** Two arguments. The record carries `baseHead`, which is all the conflict check needs.

**2. [Process] Task 2 RED evidence is from a guard-disabled copy of the adapter**
- **Found during:** Task 2
- **Issue:** The Task 1 implementation already contained the Task 2 guards (conflict checks, linked-parent check, plain-name validation, idempotence, existing-ref check), so the new tests passed on first run (49 pass, 0 fail). A RED recorded as exit 0 would not meet the acceptance criterion, and a faked failure would be dishonest.
- **Fix:** Ran the same command against a temporary copy of the adapter with those guards disabled (6 tests fail, exit 1) and recorded that output in `03-09-red-evidence-task2.json` with a `note` field saying so. The adapter was restored byte-for-byte (`git status` showed no diff) before the commit. The tests are shown to discriminate; they were not written before the code.

### Additions beyond the plan (Rule 2, correctness)

**3. [Rule 2] Re-park of the same content returns the same record; a different delta under the ref is a conflict.** The ref is created before the tree is put back, so an interruption between the two is recoverable. Test: "parks the same content again ... and refuses a different delta".

**4. [Rule 2] A nested repository in the delta is refused `invalid`.** Its gitlink entry would be restored as an empty directory, losing the content.

**5. [Rule 2] `dropPark` of an absent ref is success, and a non-park ref is `invalid`.** Keeps the call safe to repeat and unable to delete any other ref.

**6. [Refactor] `removeEmptyParents` extracted from `removeUntracked`** and reused by `park` to remove the directories a parked record leaves empty. Behavior of `removeUntracked` is unchanged (its tests pass).

**Total deviations:** 1 spec reconciliation, 1 process note, 4 additions. **Impact:** none on the plan's goal; the port gained no method beyond the three the plan names.

### Process note

The pre-commit assertion's worktree allow-list (`agent-*` branch names) was not applied: this plan ran as the sequential executor on the phase branch `worktree-phase-03`, which the orchestrator designated. The detached-HEAD and protected-branch checks pass.

## Known Stubs

None.

## Threat Flags

None. T-03-15 is mitigated as planned: conflict detection against base HEAD, current HEAD and the working content before any write; no-follow helpers and a linked-parent check; plain-name ref components; hostile fixtures in tests. T-03-SC: no package installs.

## Documentation surfaces (for plan 03-31)

- **Park ref namespace:** `refs/avarice/park/<runId>/<itemId>` inside the run clone only; never fetched into the source (`fetchIntoSource` fetches the run branch only). Plain names: letters, digits, underscore, hyphen, not starting with a hyphen, at most 64 characters.
- **Guarantees:** `park` records the delta against the base snapshot as a commit object (tree of the working content, parent the base HEAD), then restores the base snapshot through `discard`; HEAD must equal the base HEAD (`conflict` head-moved otherwise); an existing ref with a different delta is a `conflict`. `unpark` restores content, file mode and deletions onto the current HEAD, refuses with `conflict` naming the paths when a parked path changed between the base HEAD and HEAD or is modified now, `denied` for a symlinked parent, `not_found` when the ref is gone; a repeated unpark is a no-op with the same `applied`. `dropPark` deletes only the named park ref. None of the three touches the user's checkout, runs in the supervisor outside any sandboxed invocation, and none uses `reset`, `clean` or `checkout`.
- **Caller contract:** `unpark` keeps the ref. A stage calls `dropPark` once the item has resumed or been committed, before parking the same item again.
- **Counts for `coverage.md`:** `RunWorkspace` port gains 3 methods; a new integration test file `test/integration/run-park.test.ts` (15 tests).

## Self-Check: PASSED

- `src/ports/run-workspace.ts`, `src/adapters/git/run-workspace.ts`, `test/integration/run-park.test.ts`, both red-evidence files: present.
- Commits 43ca459, 574a156, bfc470b are ancestors of HEAD.
- `node --test run-park.test.ts run-workspace.test.ts`: 49 pass, 0 fail; `tsc -p .` and `scripts/check-boundaries.ts`: clean.
