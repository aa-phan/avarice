---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 28
subsystem: retrieval
tags: [retrieval-caps, budget-rows, broad-discovery, abort-signal, cache-scope, access-revoked, atomic-spend, con-10, con-11, con-12, typescript]
status: complete

requires:
  - phase: 04
    provides: "plan 04-09: handle-first queryContext (find, rank, pick, read)"
  - phase: 04
    provides: "plan 04-26: the git-files adapter, ContextQuery.readScope and workspace.worktreePath"
  - phase: 04
    provides: "plan 04-20: task_refs and the access_revoked freshness value"
provides:
  - "src/domain/retrieval-rules.ts: RETRIEVAL_CAPS (2,000 entries, 64 KiB, 200 hits, 10 s, 40-line snippets, 30 snippets, 20 files, 256 KiB, 5 pages), parseRetrievalSection (profile config `retrieval`, lower-only), effectiveCaps, RETRIEVAL_ROWS"
  - "run contract budgets.retrieval { searches, fullReads, fullReadBytes, broadDiscovery } and the budget rows retrieval.searches, retrieval.fullReads, retrieval.fullReadBytes, retrieval.broadDiscovery; start overrides retrieval.searches, retrieval.fullReads, retrieval.fullReadBytes (lower-only); brief frontmatter broadDiscovery"
  - "Ledger.spendBudgets: all-or-nothing spend under one BEGIN IMMEDIATE, so shared counters are exact across processes"
  - "src/app/retrieval-guard.ts: RetrievalGuard (beginSearch, beginRead, beginSnippets), rules retrieval:broad-discovery-not-authorized, retrieval:broad-discovery-spent, retrieval:<counter>-spent"
  - "queryContext: runId and broad request fields, per-source search counting, findWithin (timeout and AbortSignal), page cap, entry cap, snippet cap, returned-byte cap, revoked-ref purge, item stamps"
  - "git-files: hit cap with a truncated flag, unscoped refusal (retrieval:unscoped-query), cancellation, caps from the query"
  - "src/domain/cache-scope.ts: mayReuse, reusablePack, isRevoked; pack items carry profile and accessScope; omitted items carry reason access_revoked"
affects: [04-29, 04-30, 04-31, 04-38]

actuals:
  tokens: 27800
  tasks: 3
  commits: 6
plan_head_before: e563e6064145c22eb9dd9e754245b2e1d9f248fd
plan_head_after: ec6da4e87e4c0eb2c1e807e50eb0be511e7cbc2f
commits: 6

tech-stack:
  added: []
  patterns:
    - "A shared counter is a budget row spent through one all-or-nothing ledger call, never a read-then-write"
    - "A source is asked inside a timer that settles the answer before it signals the AbortSignal, so a source answering cancelled cannot replace the timeout"
    - "A cap the assembler enforces is also given to the adapter, which enforces it again where it can see more than the assembler"

key-files:
  created:
    - src/app/retrieval-guard.ts
    - src/domain/cache-scope.ts
    - test/unit/retrieval-rules.test.ts
    - test/integration/retrieval-caps.test.ts
    - test/integration/cache-scope.test.ts
    - test/fault/retrieval-race.test.ts
    - test/helpers/retrieval-fixtures.ts
    - test/helpers/retrieval-race-child.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-28-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-28-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-28-red-task3.json
  modified:
    - src/domain/retrieval-rules.ts
    - src/domain/run-contract.ts
    - src/domain/brief.ts
    - src/app/context.ts
    - src/app/budget.ts
    - src/app/run-start.ts
    - src/app/run-status.ts
    - src/app/run-stages/item.ts
    - src/adapters/context/git-files.ts
    - src/adapters/sqlite/ledger.ts
    - src/ports/ledger.ts
    - src/ports/context-source.ts
    - src/cli/args.ts
    - test/integration/run-start.test.ts
    - test/fixtures/json-shapes/context-active.json

key-decisions:
  - "A run's retrieval counters are budget rows spent with the new all-or-nothing Ledger.spendBudgets, not reserveBudget then chargeBudget: a kill between the two would leave a reservation that nothing converts, and two rows (a broad discovery and its search) could not be spent together"
  - "retrieval.searches defaults to the preset's scaled toolCalls (items x 400), as the plan says; a start override can lower it and nothing raises it"
  - "retrieval.broadDiscovery is a row with limit 1 when the contract authorizes it and 0 when not; the contract's flag, not the row, decides not-authorized versus spent"
  - "Every source find is one search, every extra page of a paged source is one search, and a broad query is one extra search besides its broadDiscovery spend; a search that was started counts whatever the source answered (nothing refunds)"
  - "A query is broad when the request says so or its term is empty; the attended `avarice context` has no contract and so never authorizes one"
  - "The 64 KiB returned-byte cap applies to the total excerpt text of one source's answer; an excerpt that does not fit is cut at the byte limit (never inside a character) and ends with a marker, and later excerpts keep only the marker"
  - "The 2,000-entry cap applies to every source's find, the 200-hit cap to git-files, and the 30-snippet cap to one pack across sources; handles past a cap are listed as omitted"
  - "A source that answers unauthenticated or denied to a read has its picked handles left out of the pack with reason access_revoked; this is not written to task_refs, so it never blocks a resume"
  - "queryContext with a runId fills the read scope from the run's contract and the worktree from the run's clone, and item.ts now passes the runId: this closes the 04-26 open item for the context pack"
  - "A retrieval section of the profile config that cannot be parsed refuses the start (usage, naming retrieval.<key>) and fails a context query as invalid; it does not fall back to the defaults"

patterns-established:
  - "Skeleton-first RED: findWithin and the cache rule were skeletons, so the new tests failed on assertions and not on imports"

requirements-completed: [CON-10, CON-11, CON-12]

coverage:
  - id: D1
    description: "Context retrieval caps are one table of defaults (2,000 entries and 64 KiB, 200 hits and 10 s, 40-line snippets and 30 of them, 20 files and 256 KiB, 5 pages); the profile config's retrieval section may lower any and refuses a higher value naming the key; the effective caps are the smaller of the profile's and the contract's"
    requirement: "CON-10"
    verification:
      - kind: unit
        ref: "test/unit/retrieval-rules.test.ts#holds the documented values: 2,000 entries and 64 KiB, 200 hits and 10 s, 40-line snippets and 30 of them, 20 files and 256 KiB, 5 pages"
        status: pass
      - kind: unit
        ref: "test/unit/retrieval-rules.test.ts#refuses a value above the default, naming the key"
        status: pass
      - kind: unit
        ref: "test/unit/retrieval-rules.test.ts#takes the minimum of each counted cap and passes the rest through"
        status: pass
    human_judgment: false
  - id: D2
    description: "A run contract carries budgets.retrieval and the four retrieval budget rows; a start override can lower the three counted caps and refuses a higher value; a contract compiled before them reads back with five rows and still accepts an amendment"
    requirement: "CON-10"
    verification:
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#a compiled run contract carries budgets.retrieval and the four retrieval budget rows"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#a start override can lower retrieval.searches and cannot raise anything"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#budgetRowsOfRun gives the five original rows for a contract with no retrieval block, and amend still accepts an amendment on it"
        status: pass
    human_judgment: false
  - id: D3
    description: "A whole-repository or unscoped query is refused retrieval:broad-discovery-not-authorized unless the contract authorizes it, then allowed once and refused retrieval:broad-discovery-spent; a refusal leaves every counter as it was"
    requirement: "CON-10"
    verification:
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#a broad query without the flag is refused retrieval:broad-discovery-not-authorized and no counter moves"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#with broadDiscovery true in the contract the first broad query runs and the second is refused retrieval:broad-discovery-spent"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#an empty term is a whole-repository query: it counts as broad"
        status: pass
    human_judgment: false
  - id: D4
    description: "Adapters and the assembler stop at their caps: git-files returns at most 200 hits and records truncation, refuses an unscoped query, stops on an aborted signal; a slow find is aborted at the query timeout and answers timeout with no side effect; snippets stop at 30, a 10 MiB excerpt is cut at 64 KiB with a marker, a paged source stops at 5 pages, a source's entries stop at 2,000"
    requirement: "CON-11"
    verification:
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#returns at most 200 hits and records truncated: true when more exist"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#refuses an unscoped query, one whose read scope names no path, as denied retrieval:unscoped-query"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#findWithin aborts the signal the source was given and returns timeout"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#reads at most 30 snippets and lists the others as omitted with a note"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#cuts a 10 MiB excerpt at the returned-byte cap with a marker"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#stops a paged source at 5 pages when asked for 50, with a note"
        status: pass
    human_judgment: false
  - id: D5
    description: "The retrieval counters are exact under a race: six processes issuing five searches each against a run whose retrieval.searches limit is 10 are granted exactly 10 in total and the row ends at used 10, reserved 0; a refused read or search spends nothing"
    requirement: "CON-11"
    verification:
      - kind: integration
        ref: "test/fault/retrieval-race.test.ts#grants exactly 10 of 30 searches, refuses the rest as retrieval:searches-spent, and the row ends at used 10"
        status: pass
      - kind: integration
        ref: "test/integration/retrieval-caps.test.ts#beginSearch spends one search each and refuses retrieval:searches-spent at the limit; beginRead refuses a read past its files or bytes"
        status: pass
    human_judgment: false
  - id: D6
    description: "A cached item is not reused across profiles, access scopes or revisions, or after its source answered denied or unauthenticated or its ref is access_revoked; pack items carry profile and accessScope after every other key; a pack built after a source answered unauthenticated holds no excerpt of the ref and lists it omitted with reason access_revoked; a ref the run recorded as access_revoked is purged before it is read"
    requirement: "CON-12"
    verification:
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#is false when the profiles differ"
        status: pass
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#splits a previous pack, keeping the order of each side and naming the reason of each refetch"
        status: pass
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#unauthenticated on read: the ref is omitted with reason access_revoked and its text is not in the pack"
        status: pass
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#a ref the run recorded as access_revoked is purged from a new pack before it is read"
        status: pass
      - kind: integration
        ref: "test/integration/cache-scope.test.ts#stamps each item with the profile and the digest of the read scope it was built under, and the scope changes with the contract read list"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-17
---

# Phase 4 Plan 28: Retrieval caps, shared counters and cache scope Summary

**Per-step retrieval caps that a profile or contract may only lower, a broad-discovery rule (refused unless the contract authorizes it, then once), search and read counters as budget rows spent atomically (six processes, exactly 10 of 30), adapter and assembler enforcement of hit, snippet, byte, entry, page and time caps, and a cache rule that never reuses an item across a revocation, a scope change or a profile.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-11-17T11:31:00Z (approximate; not recorded at start)
- **Completed:** 2026-11-17T12:12:00Z
- **Tasks:** 3 (one tracer, two auto, each RED then GREEN)
- **Files modified:** 26 (11 created, 15 modified, not counting this summary and the planning state)

## Accomplishments

- **Cap table and contract keys.** `RETRIEVAL_CAPS` holds the docs values plus a 5-page cap and a 10 s query timeout. The profile config's `retrieval` section lowers any of them (a higher value, an unknown key and a non-integer are refused naming `retrieval.<key>`). A compiled contract carries `budgets.retrieval { searches, fullReads, fullReadBytes, broadDiscovery }`; `--budget retrieval.searches=n` (and `.fullReads`, `.fullReadBytes`) lowers, nothing raises. `searches` defaults to the preset's scaled `toolCalls` (400 for one item).
- **Broad discovery.** A query with `broad: true` or an empty term is refused `retrieval:broad-discovery-not-authorized` unless the brief says `broadDiscovery: true`; then the first is allowed and the second refused `retrieval:broad-discovery-spent`. A refusal changes no row.
- **Atomic counters.** `Ledger.spendBudgets` checks and spends several rows in one transaction or none. `RetrievalGuard` uses it for `retrieval.searches`, `retrieval.fullReads`, `retrieval.fullReadBytes` and `retrieval.broadDiscovery`. The six-process race grants exactly the limit.
- **Enforcement where the data is.** `git-files` stops at the hit cap and sets a truncation flag, refuses a query with no read path (`retrieval:unscoped-query`), and stops on an aborted signal. The assembler runs every `find` under a timer that aborts the signal and answers `timeout` with no side effect, pages a `paged` source to 5 pages, caps entries (2,000), snippets (30 per pack) and returned bytes (64 KiB per source answer, with a marker).
- **Cache scope.** `mayReuse` and `reusablePack` (pure) refuse a different profile, access scope or revision and a revoked, denied or unauthenticated ref, and name the reason. `queryContext` stamps items with `profile` and `accessScope` (digest of the read scope), leaves out a ref a source refused or the run recorded as `access_revoked`, and lists it omitted with `reason: access_revoked`.
- **04-26 open item closed for the context pack.** `queryContext` given a `runId` fills `readScope` from the run's contract and `worktreePath` from the run's clone; `run-stages/item.ts` now passes `runId`, so the pack of a run is searched in its clone inside its contract's read lists. Plan 04-30 inherits this and need not fill them.

## Task Commits

1. **Task 1 (tracer): broad search refused without the flag, allowed once with it** - RED `93446f9` (test), GREEN `2bb01fd` (feat)
2. **Task 2: adapter enforcement and exact counters under a race** - RED `3f6d430` (test), GREEN `1a36e1a` (feat)
3. **Task 3: cache scope** - RED `1688fdf` (test), GREEN `ec6da4e` (feat)

**Plan metadata:** the commit of this summary (docs: complete plan)

Each RED record validated `RED_EVIDENCE_OK` with `gsd-tools check tdd-red-evidence`; the records are `04-28-red-task1.json`, `04-28-red-task2.json` and `04-28-red-task3.json` (the plan listed the first two; the third is recorded too because Task 3 is also `tdd`).

## TDD Gate Compliance

All three tasks have a `test(04-28)` commit before their `feat(04-28)` commit. RED semantic assessments are in the records: task 1 failed on the missing `budgets.retrieval`, the missing broad refusal and the unknown brief key and budget name; task 2 failed on the missing truncation flag, unscoped refusal, cancellation, timeout abort and the snippet, byte, page and entry caps (10 of 30 tests); task 3 failed on a rule that reused everything and a pack with no profile, scope or revoked-ref purge (9 of 11). No refactor commit.

## Files Created/Modified

- `src/domain/retrieval-rules.ts` - cap table, profile section parser, effective caps, row names
- `src/domain/run-contract.ts` - preset retrieval block, `budgets.retrieval`, lower-only retrieval overrides, profile caps as ceilings
- `src/domain/brief.ts` - frontmatter key `broadDiscovery`
- `src/app/retrieval-guard.ts` - the guard (run rows or in-memory), `profileRetrievalCaps`
- `src/app/context.ts` - runId and broad, counting, `findWithin`, caps, purge, stamps
- `src/app/budget.ts`, `src/app/run-start.ts`, `src/app/run-status.ts`, `src/app/run-stages/item.ts` - rows, profile caps into the compiler, status keeps its five budgets, the run's id into the pack
- `src/adapters/context/git-files.ts` - query caps, truncation, unscoped refusal, cancellation
- `src/adapters/sqlite/ledger.ts`, `src/ports/ledger.ts` - `spendBudgets`
- `src/ports/context-source.ts` - `limits`, `signal`, `stats`, `page` on a query
- `src/domain/cache-scope.ts` - the cache rule
- `src/cli/args.ts` - a `--budget` name may hold dots

## Decisions Made

See `key-decisions`. The ones that set policy are repeated under "Decisions needing owner review".

## Decisions needing owner review

1. **The brief authorizes broad discovery.** The plan said "owner amendment or brief field" and fixed neither. I added brief frontmatter `broadDiscovery: true` (a brief is the owner's own text), and `--budget` cannot raise it. An amendment (`avarice contract amend`) cannot set it: the amendable budgets are a closed list and I did not widen it. If the owner wants amendment to authorize it, that is a small follow-up in `src/domain/amendment.ts`.
2. **What counts as a search and as broad.** Every source `find` is one search, every further page is one, and a broad query is one search on top of its `broadDiscovery` spend. A query with an empty term is broad even if the caller did not say so. The attended `avarice context` has no contract, so it can never run a broad query. A search that was started counts even when the source fails (no refunds).
3. **Returned-byte cap.** The docs name "64 KiB" only for index and metadata. I applied one 64 KiB cap to the total excerpt text of each source's answer, and the 2,000-entry cap to every source's `find`, not only the index ones.
4. **Revocation is not recorded.** A source that answers `unauthenticated` or `denied` to a read has its handles left out of that pack, but nothing is written to `task_refs`, so a later resume is not blocked by it (plan 04-20 blocks a resume only on refs already recorded `access_revoked`). If the owner wants a refused read to stop the run, that is a decision for plan 04-20's rules.
5. **A bad `retrieval` section refuses at use, not at composition.** `start` refuses (usage, naming `retrieval.<key>`) and `context` fails invalid; every other command still starts. `adapters.context` (plan 04-26) refuses at composition.
6. **`status` does not show the retrieval counters.** The frozen `status --json` shape lists five budgets, so the four `retrieval.*` rows are filtered out of `status`. They are readable from the ledger only. A later plan can append a key to status if the owner wants them shown.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A new ledger method for an all-or-nothing spend**
- **Found during:** Task 1 design
- **Issue:** The plan names `reserveBudget` and `chargeBudget`. Reserving and then charging are two transactions: a kill between them leaves a `reserved` amount nothing converts (only `invocations` reservations are converted), and a broad discovery plus its search, or a read's files plus its bytes, could be half spent.
- **Fix:** `Ledger.spendBudgets(runId, spends)`: one `BEGIN IMMEDIATE`, every row checked, then written, or nothing and the first row that had no room is named. The port and the SQLite ledger gained it; the race test exercises it from six processes.
- **Files modified:** src/ports/ledger.ts, src/adapters/sqlite/ledger.ts
- **Committed in:** 2bb01fd

**2. [Rule 3 - Blocking] `--budget` names with a dot**
- **Found during:** Task 1
- **Issue:** `parseBudgetFlags` accepted only letters and digits, so `retrieval.searches=10` was a usage error before the compiler saw it.
- **Fix:** the name pattern allows dots; the compilers still own the closed list of names.
- **Files modified:** src/cli/args.ts
- **Committed in:** 2bb01fd

**3. [Rule 1 - Bug] The four retrieval rows broke the frozen status shape**
- **Found during:** Task 1 (unit suite: `status --json after start --wait reached ready_for_review`)
- **Issue:** `status` lists every budget row, so the new rows changed the frozen `status-runs.json` array.
- **Fix:** the run status view keeps its five budgets and skips rows named `retrieval.*`.
- **Files modified:** src/app/run-status.ts
- **Committed in:** 2bb01fd

**4. [Rule 3 - Blocking] Tests that pinned the old shapes**
- `test/integration/run-start.test.ts` counted five budget rows; a run now stores nine. Updated.
- `test/fixtures/json-shapes/context-active.json` was regenerated with `AVARICE_SNAPSHOT_WRITE=1` for the one test. The diff is only the two appended optional keys on each item (`"profile": "personal-local"`, `"accessScope": "sha256:<sha256>"`), the planned change of Task 3, so the acceptance check `git diff --quiet -- test/fixtures/json-shapes` does not exit 0 by design.
- **Committed in:** 2bb01fd, ec6da4e

**5. [Rule 2 - Missing critical] The run's pack now passes the run's id**
- **Found during:** Task 1 (the 04-26 open item)
- **Issue:** Without `runId` the pack of a run was searched in the repository, outside the contract's read lists, and was not counted.
- **Fix:** one argument in `src/app/run-stages/item.ts` (not in the plan's file list); `queryContext` does the rest.
- **Committed in:** 2bb01fd

**Total deviations:** 5 auto-fixed (2 blocking fixes of mechanics, 1 bug, 1 test updates, 1 missing critical wiring). **Impact on plan:** none changes a plan truth; `spendBudgets` and the status filter are mechanics the plan did not foresee.

## Known Stubs

None. Two pieces have no production caller yet and are exercised by tests only: `RetrievalGuard.beginRead` (nothing in AVARICE's context assembly reads whole files; the counters and rows exist for the hook in plan 04-29 or a later reader) and `reusablePack` / `mayReuse` (plan 04-30 wires reuse of a stored pack on retry; `queryContext` uses `isRevoked` of the same module).

## Issues Encountered

None beyond the deviations. The full `npm test` was not run (about 18 minutes); the orchestrator runs it at the end of the wave. Run here: the unit suite (2,698 pass), `test/integration/run-*.test.ts` (570 pass), and the plan's own files with `context`, `json-shapes`, the kill-point suites, `contract-amend` and `amend-ledger` (275 pass), the plan 04-22 suites `profile-isolation` and `redaction-suite`, `test/fault/budgets.test.ts`, `test/fault/run-budgets.test.ts`, `test/unit/killpoint-coverage.test.ts`; typecheck and `check:boundaries` are clean.

## Documentation surfaces (for plan 04-38)

- **config-reference:** profile config key `retrieval`: an object of cap names to whole numbers, each at most its default; unknown names and higher values refused naming `retrieval.<key>`. Caps and defaults: `indexEntries` 2000, `returnedBytes` 65536, `searchHits` 200, `queryTimeoutMs` 10000, `snippetLines` 40, `snippets` 30, `fullReads` 20, `fullReadBytes` 262144, `maxPages` 5. Brief frontmatter key `broadDiscovery` (`true` or `false`). `start --budget retrieval.searches=n`, `retrieval.fullReads=n`, `retrieval.fullReadBytes=n` (lower-only; the ceiling of `searches` is the run's tool-call limit).
- **contract keys:** `budgets.retrieval` `{ searches, fullReads, fullReadBytes, broadDiscovery }`, absent on contracts compiled before this plan (read back unchanged, counted in memory against the profile caps).
- **budget rows:** `retrieval.searches`, `retrieval.fullReads`, `retrieval.fullReadBytes`, `retrieval.broadDiscovery` (limit 1 when authorized, 0 when not); not shown by `status`.
- **rules:** `retrieval:broad-discovery-not-authorized`, `retrieval:broad-discovery-spent`, `retrieval:searches-spent`, `retrieval:fullReads-spent`, `retrieval:fullReadBytes-spent`, `retrieval:unscoped-query`; `queryContext` answers `denied` (enforcer avarice) for a refused broad query and notes a skipped source for a spent counter.
- **context output:** pack items gain `profile` and `accessScope` (after the existing keys); `omitted` items gain `reason: "access_revoked"`; new notes for each cap (entry cut, hit cut, snippet cut, byte cut, page cap, revoked handles, timeout).
- **ports:** `ContextQuery` gains `limits`, `signal`, `stats`, `page`; a source whose descriptor declares capability `paged` is asked page by page; `Ledger.spendBudgets`.
- **coverage.md / findings:** `docs/containment.md:173-187` is now built; the matrix row "Retrieval scope and cost" (`docs/containment.md:114`) can name `test/integration/retrieval-caps.test.ts` and `test/fault/retrieval-race.test.ts`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04-29 (hook counts of the agent's own search tools) can spend `retrieval.searches` through `Ledger.spendBudgets`; plan 04-30 can wire `reusablePack` into the item stage's retry. The `readScope` and `worktreePath` open item of plan 04-26 is filled for the context pack by this plan.
- The 04-22 suites that touch the context pack and profile roots (`profile-isolation`, `redaction-suite`) were re-run and pass.

## Threat Flags

None. Every new surface (retrieval caps, a ledger method, query fields) is inside the plan's threat model (T-04-77, T-04-78, T-04-79).

## Self-Check: PASSED

All created files exist on disk, all six task commits (`93446f9`, `2bb01fd`, `3f6d430`, `1a36e1a`, `1688fdf`, `ec6da4e`) and the summary commit `592e719` are on the branch, and the three RED records return `RED_EVIDENCE_OK`.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
