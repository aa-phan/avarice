---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 60
subsystem: retrieval
tags: [broad-discovery, brace-glob, pack-reuse, cache-scope, pack-item-format, gap-closure, G-04-2-GIN-03, G-04-2-GIN-05, CON-10, CON-12]

requires:
  - phase: 04
    provides: "the broad-discovery rule (04-29), the cache rule and pack reuse (04-28, 04-30), WR-06 brace-glob handling"
provides:
  - "A Grep or Glob refused as broad discovery because of a brace group is told so: the reason names the brace group and suggests a glob per extension, a type filter or a directory (GIN-03)"
  - "PACK_ITEM_FORMAT = 1 stamps every pack item; cacheMiss returns `format` for an item with an absent or different format, so an item built by an older adapter is read again with the current untrusted and codeNode flags (GIN-05)"
affects: [04-67, 04-68]

actuals:
  tokens: 6500
  tasks: 2
  commits: 2
plan_head_before: 7544a4c3d1ede3bc5e1c89faefcca0c6a5959867
plan_head_after: 59e06cd

tech-stack:
  added: []
  patterns:
    - "A rule that judges by the widest reading (a brace group counts as unfiltered) keeps the cause on the normalized call, so the refusal can state it without changing the rule"
    - "A stored item carries a format number next to its profile and access scope; the cache rule treats an absent or different format as a miss, judged before the revision"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-60-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-60-red-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/domain/cache-scope.ts
    - src/app/context.ts
    - test/unit/hook-decision.test.ts
    - test/integration/hook-retrieval.test.ts
    - test/integration/cache-scope.test.ts
    - test/fixtures/json-shapes/context-active.json

key-decisions:
  - "A brace-group glob still counts as unfiltered (the safe direction, WR-06); only the refusal reason changes, and the rule ID retrieval:broad-discovery-not-authorized is unchanged"
  - "braceGlob is set only on an unfiltered call, so a Grep with a type filter and a brace glob stays filtered and charges retrieval.searches only"
  - "Pack items are stamped format 1, the first stamped format; an item with an absent or different format is a cache miss with reason `format`. The constant is raised whenever an adapter changes which flags an item carries"
  - "Miss order is revocation, profile, access scope, format, revision: an item of an older build is wrong whatever revision it was read at"

patterns-established:
  - "Raise PACK_ITEM_FORMAT when an adapter changes which flags (untrusted, codeNode, confidence) an item carries"

requirements-completed: [CON-10, CON-12]

coverage:
  - id: D1
    description: "A run's Grep at the clone root with glob `*.{ts,tsx}` and no broad-discovery authorization is denied with retrieval:broad-discovery-not-authorized and a reason naming the brace group and a type filter; a Glob `**/*.{ts,tsx}` gets the same reason; a Grep with no glob keeps the no-filter reason"
    requirement: CON-10
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#tracer: a brace-group refusal says the brace group is the cause (GIN-03, CON-10, T-04-158)"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#the broad-discovery refusal reason names a brace group when one is the cause (GIN-03, CON-10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "normalizeToolCall marks an unfiltered search whose Grep glob or Glob pattern holds a brace group with braceGlob, and leaves a typed Grep and every non-brace unfiltered call unmarked"
    requirement: CON-10
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#maps Claude tool names to normalized calls and resolves relative paths against cwd"
        status: pass
    human_judgment: false
  - id: D3
    description: "A previous pack item with no format passed as reuse is refetched with reason `format`, and the item read again carries format 1 and the codeNode and untrusted flags the current adapter sets"
    requirement: CON-12
    verification:
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#refetches an item with no format, with reason `format`, and the item read again carries format 1, codeNode and untrusted"
        status: pass
    human_judgment: false
  - id: D4
    description: "An item with format 1 and the same profile, access scope and revision is still reused without a read; cacheMiss returns `format` after the profile and access scope and before the revision, and revocation still comes first"
    requirement: CON-12
    verification:
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#still reuses an item with format 1 and the same profile, access scope and revision, without a read"
        status: pass
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#cacheMiss names the format when an entry was built by another adapter format (GIN-05, CON-12, T-04-159)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The context-active json shape gains `format` appended after `accessScope` on each item"
    requirement: CON-12
    verification:
      - kind: unit
        ref: "test/unit/json-shapes.test.ts#Phase 1 --json shapes are frozen (D-19, success criterion 7)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-24
status: complete
---

# Phase 4 Plan 60: Brace-glob refusal reason and pack item format stamp Summary

**A brace-group glob refusal now names the brace group and the alternatives (GIN-03), and pack items carry a format stamp so a reused item built by an older adapter is read again with the current trust flags (GIN-05).**

## Performance

- **Duration:** 25 min
- **Started:** 2026-11-24T21:12:00Z (approximate; the start was not captured before the first command)
- **Completed:** 2026-11-24T21:38:00Z
- **Tasks:** 2
- **Files modified:** 7 (plus 2 RED evidence files)

## Accomplishments

- GIN-03: `NormalizedToolCall`'s search member gains an optional `braceGlob`, set on an unfiltered call whose Grep glob or Glob pattern (below its pattern root) holds `{`. The broad-discovery refusal for such a call says the glob "is treated as matching every file" and suggests a separate glob for each extension, a type filter, or a directory. The rule ID, the no-filter reason, and the classification of brace globs as unfiltered are unchanged.
- GIN-05: `PACK_ITEM_FORMAT = 1` in `cache-scope.ts`; `CacheEntry.format` (optional), `CacheNow.format` (required) and a `format` member of `CacheMiss`; `cacheMiss` judges it after the access scope and before the revision. `PackItem.format` is appended last, stamped by `packItem` from the stamp, and the reuse check passes the old item's format and the current one. `derive-spec.ts` is unchanged.
- Both fixes were driven by tests that failed first (RED evidence in `04-60-red-task1.json` and `04-60-red-task2.json`, both exit code 1).

## Task Commits

1. **Task 1: Tracer - a brace-glob Grep is refused with a reason that names the brace group (GIN-03)** - `f3ee009` (fix)
2. **Task 2: A reused pack item of an older format is read again (GIN-05)** - `59e06cd` (fix)

**Plan metadata:** recorded in the docs commit that follows this summary.

## Files Created/Modified

- `src/domain/hook-decision.ts` - `braceGlob` on the search call, set during normalization; brace-specific refusal reason in the `search` case of `decideToolCall`
- `src/domain/cache-scope.ts` - `PACK_ITEM_FORMAT`, `format` on `CacheEntry`/`CacheNow`, the `format` miss
- `src/app/context.ts` - `PackItem.format`, the stamp, and the reuse comparison
- `test/unit/hook-decision.test.ts` - normalization of brace globs (split from the every-file globs) and the reason difference
- `test/integration/hook-retrieval.test.ts` - the refusal reason through the real hook entry
- `test/integration/cache-scope.test.ts` - `format` in the entry and now helpers, the miss order, the stripped item refetched, a format 1 item reused, the key order of a stamped item
- `test/fixtures/json-shapes/context-active.json` - `format: 1` after `accessScope` on each item

## Decisions Made

See `key-decisions`. Two points beyond the plan text: `braceGlob` is only set when the call is already unfiltered (a typed Grep with a brace glob is a filtered search and is not marked), and the stripped-item integration test uses a fake `git-files` source whose read returns `untrusted` and `codeNode` items, because `packItem` is source-agnostic and an onboarded scratch repository has no graph index recorded for a fake graph source to answer through.

## Deviations from Plan

None - plan executed exactly as written.

The unit tests that asserted `{*,.*}`, `src/{a,b}` and a Glob `{*,.*}` normalize to exactly `unfiltered: true` were updated to expect `braceGlob: true` as well; that is the planned behavior change, not a deviation.

**Total deviations:** 0
**Impact on plan:** None.

## Issues Encountered

None. Verification run: the plan's two task commands (`node --test` over the listed files, `npm run typecheck`, `npm run check:boundaries`) all pass. A wider set of context, retrieval, hook and resource tests (361 tests) also passes. The full `npm test` was not run.

## Known Stubs

None.

## Threat Flags

None. No new endpoints, auth paths or file access; the two mitigations (T-04-158, T-04-159) are implemented and tested.

## Documentation surfaces

For plans 04-67 and 04-68, the `docs/system/` documents to update (nothing under `docs/system/` was edited here, per the plan):

1. **The brace-glob refusal reason:** a Grep whose glob holds a brace group, or a Glob whose pattern (below its root) does, is still treated as unfiltered and refused as `retrieval:broad-discovery-not-authorized` when it searches the whole repository without authorization. The reason now says the glob is treated as matching every file because of the brace group, and suggests a separate glob for each extension, a type filter or a directory. A Grep with no glob and no type keeps the earlier reason. The rule ID and the allow-once budget are unchanged.
2. **The pack item `format` field:** each pack item carries `format`, a number, appended after `accessScope` (the first stamped format is 1). It appears in the `context --json` item shape and in the pack stored for a run step, so a reader of the stored pack sees it.
3. **The `format` cache miss:** an item from a previous pack with an absent or different `format` is not reused; it is read again and the report's `reuse.refetch` lists it with reason `format`. The order of reasons is revocation, profile, access scope, format, revision. The format number is raised whenever an adapter changes which flags (for example `untrusted`, `codeNode`) an item carries, so an item built by an older adapter is never reused with stale trust marks.

## Next Phase Readiness

GIN-03 and GIN-05 are closed with tests that failed before the fix. Plans 04-67 and 04-68 (the documentation plans) carry the surfaces listed above.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-24*

## Self-Check: PASSED

Created files and commits verified: `04-60-red-task1.json`, `04-60-red-task2.json`, `f3ee009`, `59e06cd` all present in this branch.
