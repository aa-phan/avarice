---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 30
subsystem: resource-bounds
tags: [ops-5, d-13, con-12, limits, context-pack, active-runs, check-queue, artifact-quota, event-bound, doctor, pack-reuse, typescript]
status: complete

requires:
  - phase: 04
    provides: "plan 04-28: reusablePack, mayReuse, the run-scoped queryContext and the retrieval caps"
  - phase: 04
    provides: "plan 04-20: task_refs and the access_revoked freshness value"
  - phase: 04
    provides: "plan 04-18: the redacting artifact store and its text kinds"
  - phase: 04
    provides: "plan 04-25: runDoctor and its sections"
  - phase: 04
    provides: "plan 04-27: the manual context excerpts that share a run's pack budget"
provides:
  - "src/domain/resource-bounds.ts: LIMIT_DEFAULTS, LIMIT_KEYS, MAX_CONCURRENT_CHECKS, parseLimitsSection (profile config `limits`), effectivePackBudget"
  - "src/app/resource-limits.ts: profileLimits (refusing) and limitsOrDefaults (never refusing) over deps.profile.config.sections.limits"
  - "run pack budget = min(limits.contextTokens, floor((32 KiB prompt - contract bytes - fence bytes) / 4)); the context:pack step records ceiling, effective, omitted and, on a retry, reuse"
  - "`avarice context` default budget = limits.contextTokens (24,000); --budget still overrides"
  - "start refusal `active-runs` (exit 3) at limits.maxActiveRuns non-terminal runs, naming the runs, `avarice cancel` and `avarice status`"
  - "runRequiredChecks: a bounded in-process queue (limits.maxConcurrentChecks, default 1, at most 2), checks started and recorded in declared order, per-stream capture cap = limits.checkOutputBytes"
  - "LocalArtifactStore quota (limits.artifactQuotaMiB): `unavailable` with 'artifact quota of N MiB reached for profile P'"
  - "SqliteLedger event bound (limits.maxEventRows): debug events refused and counted in meta events_dropped_debug; EventReceipt.dropped"
  - "doctor: `events` section {read, rows, bound, droppedDebug}; finding area `limits` (error) for a section that cannot be used; finding area `events` (warning) when debug events were dropped"
  - "queryContext request.reuse and report.reuse: the previous pack's items are reused through the CON-12 rule on a retry"
affects: [04-31, 04-38, 04-39]

actuals:
  tokens: 36000
  tasks: 3
  commits: 7
plan_head_before: ee65fdf34bc452c7de648abb0d1b21178a87976d
plan_head_after: 12714fea8b18b0dbeea3fe127d106782cfd38767
commits: 7

tech-stack:
  added: []
  patterns:
    - "A bound is read from the profile config with defaults; code that must refuse (start, context) reads it with profileLimits, code that enforces where a refusal would hide the real work (checks, ledger, artifact store, pack budget) reads it with a fallback to the defaults, and start and doctor are where a bad section is reported"
    - "A bounded queue that starts work in declared order and records results in declared order: start while fewer than the limit are running, record the head of the line when it has finished"
    - "A cache rule applied per item (mayReuse against the handle's own current revision), because the items of one pack come from sources at different revisions"

key-files:
  created:
    - src/domain/resource-bounds.ts
    - src/app/resource-limits.ts
    - test/unit/resource-bounds.test.ts
    - test/integration/resource-degradation.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-30-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-30-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-30-red-task3.json
  modified:
    - src/app/run-stages/item.ts
    - src/app/context.ts
    - src/app/run-start.ts
    - src/app/checks.ts
    - src/app/doctor.ts
    - src/app/run-gsd-config.ts
    - src/adapters/fs/artifact-store.ts
    - src/adapters/sqlite/ledger.ts
    - src/adapters/diagnostics/probes.ts
    - src/cli/composition.ts
    - src/cli/commands/context.ts
    - src/cli/doctor-deps.ts
    - src/domain/cache-scope.ts
    - src/ports/ledger.ts
    - src/ports/diagnostics.ts
    - test/integration/doctor.test.ts
    - test/fixtures/json-shapes/context-active.json
    - test/fixtures/json-shapes/doctor.json

key-decisions:
  - "limits.contextTokens is a ceiling; the run's pack budget is min(ceiling, floor((RUN_PROMPT_MAX_BYTES - contract bytes - fence bytes) / 4)), about 8,000 tokens at most, and the context:pack step records ceiling and effective (D-13 resolution, as the plan recorded it)"
  - "The profile config may set any limit to any positive whole number (maxConcurrentChecks 1 or 2); the plan's 'a contract may only lower them' has no code behind it because a run contract has no limits section"
  - "A limits section that cannot be read refuses `start` (usage, naming limits.<key>) and `context`, is an error finding of `doctor`, and leaves the documented defaults in force in the composition, the checks and the pack budget"
  - "Active runs are every run of the profile whose state is not failed, cancelled or closed (paused, blocked and ready_for_review runs count); the refusal names up to ten of them"
  - "Checks start in declared order while fewer than the limit are running, and a check's evidence is recorded only when every earlier check has been recorded; with the default of 1 this is the old run-record-run loop"
  - "The artifact quota counts the blob directory at the first put that needs it and then its own writes; a put that would take the total past the quota is refused before anything is written, a put of an existing digest is a no-op"
  - "A refused debug event is not an error for the caller: appendEvent returns ok with dropped true; the count is written in the same transaction"
  - "Pack reuse is per handle (mayReuse against the handle's own revision) and uses a pack kept in this process for the stage pass; nothing is stored in the ledger, so a restarted supervisor reads everything again"

patterns-established:
  - "Skeleton-first RED: the limits parser and the pack budget were skeletons that accept everything, so the first RED failed on assertions and not on imports"

requirements-completed: [OPS-5, FR-3, CON-12]

coverage:
  - id: D1
    description: "The profile config's limits section is parsed with defaults (contextTokens 24,000, maxConcurrentChecks 1 and at most 2, artifactQuotaMiB 2,048, maxActiveRuns 20, maxEventRows 500,000, checkOutputBytes 5 MiB); a missing section and {} give the defaults; an unknown key, a non-positive or non-integer value and maxConcurrentChecks 3 are refused naming limits.<key>"
    requirement: "OPS-5"
    verification:
      - kind: unit
        ref: "test/unit/resource-bounds.test.ts#gives the defaults for no section and for an empty one (the empty edge)"
        status: pass
      - kind: unit
        ref: "test/unit/resource-bounds.test.ts#refuses a negative value, zero, a fraction, a string and a non-finite number"
        status: pass
      - kind: unit
        ref: "test/unit/resource-bounds.test.ts#refuses maxConcurrentChecks 3 (at most 2) and accepts 1 and 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "A run's pack budget is the smaller of limits.contextTokens and the room the 32 KiB prompt leaves (floor, clamped at 0, in UTF-8 bytes); the context:pack step records both; a budget of 0 gives an empty pack with every handle listed omitted; `avarice context` defaults to limits.contextTokens and --budget overrides it"
    requirement: "FR-3"
    verification:
      - kind: unit
        ref: "test/unit/resource-bounds.test.ts#is min(ceiling, floor((promptMax - contractBytes - overhead) / 4)): 6192 for the documented case"
        status: pass
      - kind: unit
        ref: "test/unit/resource-bounds.test.ts#is larger for a title in another script than for an ASCII one of the same length"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#records the ceiling and the effective budget in the context:pack step"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#uses limits.contextTokens when the profile sets it, and --budget 500 wins over both"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#lists both handles as omitted and reads none of them"
        status: pass
    human_judgment: false
  - id: D3
    description: "start is refused (exit 3, kind refused) at limits.maxActiveRuns non-terminal runs, naming the runs, avarice cancel and avarice status, before anything is written; one run below the limit starts; an ended run no longer counts"
    requirement: "OPS-5"
    verification:
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#starts at limit minus one and is refused at the limit, naming both runs, `avarice cancel` and `avarice status`, and writes nothing"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#a run that ended no longer counts: after one is cancelled the next start goes through"
        status: pass
    human_judgment: false
  - id: D4
    description: "Checks start in declared order with at most maxConcurrentChecks at once and are recorded in declared order; check output past checkOutputBytes (counted in UTF-8 bytes) is truncated with the marker and the real exit status is kept"
    requirement: "OPS-5"
    verification:
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#with maxConcurrentChecks 2 two run at once, never three, starts stay in declared order and evidence is recorded in declared order though c2 ends before c1"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#limits.checkOutputBytes sets the cap, in bytes: 1000 bytes of é (two bytes each) keep 500 characters, not 1000"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#a check that prints 6 MiB with the default cap stores 5 MiB of it, then the truncation marker, and the exit status 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "A new artifact past limits.artifactQuotaMiB is refused with 'artifact quota of N MiB reached for profile P'; a check whose output cannot be stored stops the stage and leaves no evidence row without its output"
    requirement: "OPS-5"
    verification:
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#with a quota of 1 MiB and 900 KiB stored, a 200 KiB put is unavailable naming the quota and the profile, and a smaller one that fits is stored"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#stops with an unavailable error naming the 1 MiB quota; the check that could not be stored has no evidence, and no check evidence lacks its output"
        status: pass
    human_judgment: false
  - id: D6
    description: "Past limits.maxEventRows debug events are refused and counted in meta events_dropped_debug while info, warn and error events are always written and the hash chain holds; doctor reports rows, bound and dropped count and names an unusable limits section"
    requirement: "OPS-5"
    verification:
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#with 50 rows and a bound of 50 a debug event is refused and counted, an info event is still written, and the chain holds"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#shows the rows, the configured bound and the dropped count after debug events were refused"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#says the section was not read when there is no store, and names a limits section that cannot be used as an error with a fix"
        status: pass
    human_judgment: false
  - id: D7
    description: "A retried item reuses only the previous pack items the CON-12 rule allows (same profile, access scope and revision, never a revoked reference) and fetches the rest again; a run that crashes and is retried records the reuse in its second context:pack step"
    requirement: "CON-12"
    verification:
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#reuses both items of an unchanged pack without reading them again, and says so"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#fetches an item again when the source is at another revision, and an item whose scope or profile differs"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#never reuses an item whose reference the run recorded as access_revoked: it is not read and not in the pack, and the other is reused"
        status: pass
      - kind: integration
        ref: "test/integration/resource-degradation.test.ts#a run that crashes and is retried builds its second context:pack from the first pack: every item of the first is reused"
        status: pass
    human_judgment: false

duration: about 110min (start not recorded)
completed: 2026-11-17
---

# Phase 4 Plan 30: Resource bounds with defined degradation Summary

**The profile config's `limits` section now sets six bounds (pack tokens resolved against the 32 KiB prompt, active runs, concurrent checks in a declared-order queue, check output bytes, artifact quota, event rows), each degrading as documented, and a retried item reuses its previous pack only where the CON-12 cache rule allows.**

## Performance

- **Duration:** about 110 min (the start time was not recorded)
- **Completed:** 2026-11-17T13:30:00Z
- **Tasks:** 3 (one tracer, two auto, each RED then GREEN)
- **Files modified:** 25 (7 created, 18 modified, not counting this summary and the planning state)

## Accomplishments

- **Limits parsed with defaults.** `limits.contextTokens` 24,000, `maxConcurrentChecks` 1 (at most 2), `artifactQuotaMiB` 2,048, `maxActiveRuns` 20, `maxEventRows` 500,000, `checkOutputBytes` 5 MiB. A missing section and `{}` give the defaults; an unknown key, a non-positive or non-integer value and `maxConcurrentChecks` 3 are refused naming `limits.<key>`.
- **D-13 resolved against the prompt.** The run's pack budget replaces `PACK_BUDGET = 4000` with `min(ceiling, floor((32768 - contract bytes - fence bytes) / 4))`, about 8,000 tokens at most. The `context:pack` step records `ceiling`, `effective` and `omitted`. A budget of 0 gives an empty pack with every handle omitted. `avarice context` now defaults to `limits.contextTokens` (24,000).
- **Active runs.** `start` is refused at the limit (exit 3), before anything is written, naming up to ten runs and the two commands that close or list them; one run fewer starts; an ended run does not count.
- **Checks queue.** `runRequiredChecks` starts checks in declared order, at most `maxConcurrentChecks` running, and records each check's evidence only after every earlier check's. With the default of 1 the loop behaves as it did. The executor's per-stream capture cap is `limits.checkOutputBytes`, counted in UTF-8 bytes, with the marker and the real exit status.
- **Artifact quota.** `LocalArtifactStore` refuses a new blob past the quota with `artifact quota of N MiB reached for profile P` before anything is written. A check whose output cannot be stored stops the stage; no evidence row exists without its output.
- **Event bound.** `SqliteLedger.appendEvent` refuses `debug` events once the table holds `maxEventRows` rows and counts them in `meta.events_dropped_debug` in the same transaction. Info, warn and error events are always written. `doctor` shows `events {read, rows, bound, droppedDebug}`.
- **Pack reuse on retry (CON-12).** `queryContext` takes the previous pack's items (`reuse`) and does not read a picked handle again when `mayReuse` allows it; the retried item's `context:pack` step records `reuse {reused, refetch[{source, id, reason}]}`. A revoked reference is never reused and is left out with reason `access_revoked`.

## Task Commits

1. **Task 1 (tracer): the pack budget follows limits.contextTokens and the prompt room** - RED `c8f0ded` (test), GREEN `7026962` (feat)
2. **Task 2: active runs, concurrent checks and check output** - RED `69c06ab` (test), GREEN `8937cce` (feat)
3. **Task 3: artifact quota, event bound, doctor events section and pack reuse** - RED `f00465c` (test), GREEN `9bad2bf` (feat)
4. A budget-0 edge test, `12714fe` (test)

**Plan metadata:** the commit of this summary (docs: complete plan)

Each RED record validated `RED_EVIDENCE_OK` with `gsd-tools check tdd-red-evidence`: `04-30-red-task1.json`, `04-30-red-task2.json` and `04-30-red-task3.json` (the plan listed the first two; the third is recorded because Task 3 is also `tdd`).

Tracer gate: the Task 1 `<verify>` command (unit and integration files plus run-gsd-config) was re-run after the GREEN commit and passed; the tracer was verified end to end before Task 2 started.

## TDD Gate Compliance

All three tasks have a `test(04-30)` commit before their `feat(04-30)` commit. RED semantic assessments are in the records: task 1 failed on a missing `ceiling` in the step, the old 4,000 default and a skeleton that accepts every limit (15 of 21 failed); task 2 failed on the missing active-run refusal, checks that never overlap and a cap that ignored `checkOutputBytes` (6 of 15); task 3 failed on a store that ignored the quota, a ledger that wrote every debug event, a doctor with no events section and a query that ignored previous items (11 of 29). No refactor commit.

## Files Created/Modified

- `src/domain/resource-bounds.ts` - defaults, parser, `effectivePackBudget`
- `src/app/resource-limits.ts` - `profileLimits`, `limitsOrDefaults`
- `src/app/run-stages/item.ts` - pack budget from the limits, the step's new fields, the kept pack of a stage pass, reuse on a retry
- `src/app/context.ts` - `reuse` request and report, per-handle reuse in the read phase
- `src/app/run-start.ts` - the `active-runs` refusal and the limits usage error
- `src/app/checks.ts` - the bounded, ordered queue and the output cap
- `src/app/doctor.ts`, `src/adapters/diagnostics/probes.ts`, `src/ports/diagnostics.ts`, `src/cli/doctor-deps.ts` - the events section and the limits finding
- `src/adapters/fs/artifact-store.ts`, `src/adapters/sqlite/ledger.ts`, `src/ports/ledger.ts`, `src/cli/composition.ts` - the quota, the event bound and their wiring
- `src/app/run-gsd-config.ts` - `runPromptRoom` (contract bytes and fence bytes)
- `src/cli/commands/context.ts` - the default budget from the profile
- `src/domain/cache-scope.ts` - `cacheMiss` exported (the reason `mayReuse` answers false)

## Decisions Made

See `key-decisions`. The ones that set policy are repeated under "Decisions needing owner review".

## Decisions needing owner review

1. **A contract does not override a limit.** The plan's truth says "a contract may only lower them". A run contract has no limits section and the plan names no field, so nothing was added: the profile config sets each limit, may raise it above the default (except `maxConcurrentChecks`, at most 2) and the run's own budgets (`--budget`) are unchanged. If the owner wants per-run lowering of these six, it is a contract field and a start flag.
2. **A bad `limits` section.** `start` and `context` refuse it naming `limits.<key>`; `doctor` reports an error finding; the composition, the checks and the pack budget carry on with the documented defaults so a typo never removes a bound. The alternative, refusing every command at composition, would also block `doctor` and `status`.
3. **What counts as an active run.** Every run of the profile that is not failed, cancelled or closed, including paused, blocked-on-decision and ready-for-review runs. A run waiting for review therefore uses a slot until it is closed.
4. **The quota is approximate.** The store counts the blob directory when it first needs the total and then its own writes; another process's writes since are not seen until the next process. It stops runaway growth, it is not an exact byte ledger. The plan's constructor-time count was made lazy so read-only commands do not walk the store.
5. **Pack reuse lives in process memory.** The ledger keeps references and never excerpt text (S-41), so the pack a retry reuses is the one the same stage pass built. A retry after a supervisor restart reads everything again. Persisting packs as a redacted artifact kind would change what is stored and was not planned.
6. **Pack room excludes variable prompt parts.** The effective budget subtracts the contract text and the fence, not an owner answer, a repair reproducer or the pre-existing-check blocks, which are added later. `runUnitPrompt` still cuts the pack from its end to fit, as before, so a long answer can shorten the pack below the recorded `effective`.
7. **`avarice context` default is now 24,000** (was 4,000), a visible change to a frozen `--json` value (`budget`); the fixture was updated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wiring the plan's files could not reach without more files**
- **Found during:** Task 3
- **Issue:** the quota and the event bound need the profile's limits at composition; doctor needs the store's event count and the raw limits section; the pack reuse rule needs the reason `mayReuse` answers false.
- **Fix:** `src/cli/composition.ts`, `src/cli/doctor-deps.ts`, `src/adapters/diagnostics/probes.ts`, `src/ports/diagnostics.ts`, `src/ports/ledger.ts` (`EventReceipt.dropped`), `src/domain/cache-scope.ts` (`cacheMiss` exported), `src/app/resource-limits.ts` (new), `src/app/run-gsd-config.ts` (`runPromptRoom`), `src/cli/commands/context.ts`. None is in the plan's file list.
- **Committed in:** `7026962`, `9bad2bf`

**2. [Rule 1 - Bug] Frozen shapes and an assertion that pinned the old output**
- **Found during:** Tasks 1 and 3 (unit `json-shapes`, `doctor.test.ts`)
- **Issue:** `context-active.json` held `"budget": 4000` (the default is now 24,000) and the doctor report gained a key, so `doctor.json` and the key-list assertion of `doctor.test.ts` changed.
- **Fix:** the fixture value and the new `events` object were updated by hand (no snapshot regeneration). The context fixture was left red between `7026962` and `9bad2bf` (one unit test failed in that window) and fixed in the Task 3 commit.
- **Committed in:** `9bad2bf`

**3. [Rule 1 - Bug] The first concurrency test read the wrong pass**
- **Found during:** Task 2 GREEN
- **Issue:** the test compared the first `end` of c1 and c2 in the whole timeline, which sits in the validation pass where the checks run one at a time.
- **Fix:** it looks for a pass in which c2 started while c1 ran and ended before it.
- **Committed in:** `8937cce`

**4. [Rule 3 - Blocking] The quota total is counted lazily**
- **Found during:** Task 3
- **Issue:** the plan says the total is computed at construction. Every command composes a store, including read-only ones, and walking a store of up to 2 GiB for each is a cost nothing needs.
- **Fix:** counted at the first put of a new blob (decision 4 above).
- **Committed in:** `9bad2bf`

**5. [Rule 2 - Missing critical] Documentation under docs/system is deferred**
- **Issue:** the project instructions ask that a behavior change update `docs/system/` in the same change, and the phase ends with documentation plans.
- **Resolution:** as in plan 04-28, the surfaces are listed below for plans 04-38 and 04-39 (the plan's own output spec asks for the list) and `docs/system/` was not edited here.

---

**Total deviations:** 5 (2 blocking mechanics, 2 bugs in fixtures and tests, 1 documentation deferral). **Impact on plan:** none changes a plan truth; the extra files are wiring.

## Known Stubs

None. Open items from earlier plans:

- `reusablePack` (plan 04-28) still has no production caller. Reuse is judged per handle with `mayReuse` and `cacheMiss`, because the items of one pack come from sources at different revisions and `reusablePack` takes one revision. `reusablePack` stays a tested helper for a whole-pack split at one revision.
- `RetrievalGuard.beginRead` (plan 04-28) still has no production caller; AVARICE's own context assembly reads no whole files, and plan 04-29 counts the agent's own searches through the hook.
- The 04-26 open item (`readScope` and `worktreePath`): plan 04-28 filled both for a run's pack through `runId`, and this plan checked that every other `queryContext` caller is the attended command, which has no contract and uses the default scope. Nothing else needs them.

## Issues Encountered

None beyond the deviations. The full `npm test` was not run (about 18 minutes); the orchestrator runs it at the end of the wave. Run here: the unit suite (2,714 pass), `resource-degradation` (30 tests), the doctor, context, cache-scope, retrieval-caps, hook-retrieval, run-start, run-declared-checks, run-baseline-workflow, run-scheduler, check-validation, run-deps, redaction, `profile-isolation` and `redaction-suite` files, `test/fault/killpoints`, `budgets`, `run-budgets`, `retrieval-race` and `run-killpoints`; typecheck and `check:boundaries` are clean. The status bench was not run: no status or ledger read was touched (the new ledger code only counts rows on a debug append).

## Documentation surfaces (for plans 04-38 and 04-39)

- **config-reference:** profile config key `limits`, an object of limit names to positive whole numbers. `contextTokens` 24,000 (the pack ceiling and the default `avarice context` budget), `maxConcurrentChecks` 1 (1 or 2), `artifactQuotaMiB` 2,048, `maxActiveRuns` 20, `maxEventRows` 500,000, `checkOutputBytes` 5,242,880 (per stream). A missing section and `{}` are the defaults; an unknown key, a value that is not a positive whole number and `maxConcurrentChecks` above 2 are refused naming `limits.<key>`. The "Context pack in a run 4000 tokens" and "context query budget default 4000" rows change (`docs/system/config-reference.md` lines 217, 278, 365), as do `cli-reference.md` line 435, `indexes-and-context.md` line 219 and `runs.md` line 244.
- **degradations:** pack over its budget drops the lowest-ranked items and lists them omitted; `start` at the active-run bound exits 3 with rule `active-runs`; checks queue in process, start and record in declared order; check output past the cap is cut with `[avarice: output truncated]` and the exit status is kept; a new artifact past the quota is `unavailable` with `artifact quota of N MiB reached for profile P` and the check stage stops, no eviction until the retention classes of OPS-4 (Phase 5); debug events past the bound are refused and counted in `meta.events_dropped_debug`, never pruned.
- **D-13 resolution:** `contextTokens` is a ceiling; the effective pack budget is `min(ceiling, floor((32768 - contract bytes - fence bytes) / 4))`, at most 8,192 tokens, and the `context:pack` step records `ceiling`, `effective`, `omitted` and, on a retry, `reuse`. If plan 04-31's pilot shows truncation costs task success, moving the pack to a scratch file the unit reads is the remedy, decided then.
- **findings lines for the owner:** the spec's illustrative 2 concurrent checks is 1 by default because checks share one clone (`limits.maxConcurrentChecks` raises it to 2); `docs/operations-and-testing.md` "Event table ... Oldest debug events pruned first" is built as refusing new debug events, because the events table is insert-only with a hash chain (migration 0001 triggers); "Evict unreferenced blobs past retention" is not built (needs OPS-4 retention classes), the quota refuses new artifacts instead.
- **doctor:** report key `events` `{read, rows, bound, droppedDebug}` after `records`; findings area `limits` (error) and `events` (warning).
- **ports and rules:** `EventReceipt.dropped`; `ContextRequest.reuse` and `ContextReport.reuse`; `context:pack` step keys `ceiling`, `effective`, `omitted`, `reuse`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-31's pilot can read `ceiling`, `effective` and `omitted` from the `context:pack` step to judge whether the 32 KiB prompt costs task success.
- Plans 04-38 and 04-39 have the documentation surfaces above.

## Threat Flags

None. Every surface (limits parsing, the quota, the event bound, the output cap, the active-run refusal) is inside the plan's threat model (T-04-82, T-04-83, T-04-84).

## Self-Check: PASSED

All created files exist on disk, the commits `c8f0ded`, `7026962`, `69c06ab`, `8937cce`, `f00465c`, `9bad2bf` and `12714fe` are on the branch, `grep "const PACK_BUDGET = 4000" src/app/run-stages/item.ts` prints nothing, and the three RED records return `RED_EVIDENCE_OK`.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
