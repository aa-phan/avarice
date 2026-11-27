---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 26
subsystem: retrieval
tags: [context-source, git-files, gsd-planning, git-grep, snippets, document-fallback, freshness, adapters-context, fr-3, fr-22, fr-18, typescript]
status: complete

requires:
  - phase: 04
    provides: "plan 04-09: handle-first queryContext (find, rank, pick, read) and the PackItem source union"
  - phase: 04
    provides: "plan 04-20: ContextSource.refresh, task_refs and the resume refresh of every recorded reference"
  - phase: 04
    provides: "plan 04-24: the restricted label on the context project line"
provides:
  - "GitFilesContext (src/adapters/context/git-files.ts): git grep of the term as a fixed string at the revision inside the read scope, handles without text, snippets of at most 40 lines and 1500 characters, refresh and pathExists"
  - "GsdPlanningContext (src/adapters/context/gsd-planning.ts): heading-delimited sections of PROJECT.md, REQUIREMENTS.md and the in-progress phase's CONTEXT, PLAN and LEARNINGS files from the staging copy, untrusted, freshness from the state.json digest"
  - "AppDeps.context.planning and .gitFiles; ContextQuery.readScope and workspace.worktreePath; ContextHandle/ContextItem.citedPath; GitFilesSource port"
  - "profile config adapters.context (closed list: gsd-intel, gsd-graph, gsd-planning, git-files; default all four), parsed by src/domain/context-adapters.ts, refused at composition naming adapters.context, each composed source recorded in adapter_configs as context-<adapter>"
  - "queryContext: planning sections skipped when the graph returned a document node; confirmCitedPaths asks git-files about each stale item's cited path and withholds the content of one gone at HEAD, listing it in the notes"
  - "resume refreshes git-files and gsd-planning references (they were refreshed as unavailable before)"
affects: [04-28, 04-30, 04-31, 04-38]

actuals:
  tokens: 16900
  tasks: 3
  commits: 6
plan_head_before: 1fadba5bfe9c563c0537cf68dac3cdc4ca52e3db
plan_head_after: 70e651b0f3053bb99ca89eafa0db38e486c57b19
commits: 6

tech-stack:
  added: []
  patterns:
    - "A source with no index in the project record is asked after the indexes and given the record's onboarded revision, which it ignores"
    - "A snippet or section is marked untrusted at the source, so every consumer prints it fenced"
    - "The cited path of an index item travels with the item (citedPath) so the assembler, not each adapter, confirms it with git-files"

key-files:
  created:
    - src/adapters/context/git-files.ts
    - src/adapters/context/gsd-planning.ts
    - src/domain/context-adapters.ts
    - test/integration/context-adapters.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-26-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-26-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-26-red-task3.json
  modified:
    - src/ports/context-source.ts
    - src/app/context.ts
    - src/app/deps.ts
    - src/app/resume-refs.ts
    - src/app/capabilities.ts
    - src/cli/composition.ts
    - src/adapters/context/gsd-graph.ts
    - src/adapters/context/gsd-intel.ts
    - test/integration/run-resume-refs.test.ts
    - test/fixtures/json-shapes/context-active.json

key-decisions:
  - "git-files searches committed objects at HEAD of the run clone (worktreePath) or else the repository, so uncommitted edits and untracked files never answer; the hit is returned only when the read scope allows its path"
  - "With no contract the read scope is the routine preset's: every path, minus .git and the six secret globs; a contract's read, readExclude and secretGlobs replace it"
  - "A snippet is the hit line, 20 lines before it and 19 after (40 lines), narrowed from its far side until it fits 1500 characters, so the hit line is never the part that is cut; a handle's estimate is the largest a snippet can cost (375 tokens)"
  - "A term that is empty, over 200 characters or holds a control character finds nothing instead of being cut or reinterpreted"
  - "gsd-planning marks every section untrusted and its freshness is the sha256 of state.json: fresh while it is as recorded, stale once it changed, deleted when the section or file is gone, unavailable when state.json is absent"
  - "The planning sections are asked after the graph and skipped, with a note, when the graph returned any untrusted (non-code) node for the term"
  - "A stale item whose cited path is gone at HEAD stays in the pack with confirmed false, its excerpt replaced by a one-line marker, and a note naming the item and the path"
  - "adapters.context absent means all four sources; an empty list, a repeated name and an unknown name are refused"

patterns-established:
  - "Skeleton-first RED: the new source is composed as a skeleton that answers an internal error, so the tracer tests fail on their assertions"

requirements-completed: [FR-3, FR-22, FR-18]

coverage:
  - id: D1
    description: "A pack for a term built with git-files cites a scoped search hit as { provider git-files, kind snippet, id path:line, revision git:<head>, scope path } with an excerpt of at most 40 lines; handles carry an estimate and no text"
    requirement: "FR-22"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#cites src/pay/checkout.ts:12 with provider, kind, verbatim ID, revision and scope, and an excerpt of at most 40 lines"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#find returns handles with an estimate and no excerpt text"
        status: pass
    human_judgment: false
  - id: D2
    description: "A hit outside the read scope is never returned (secret globs by default, a contract's read list when given); the term is data, never an option, a pathspec or a pattern; only committed objects answer"
    requirement: "FR-3"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#never returns a hit outside the read scope: not a secret path by default, not a path outside a contract read list"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#treats a term that looks like an option, a pathspec or a regular expression as a literal string"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#searches the committed revision only: an uncommitted edit and an untracked file do not answer"
        status: pass
    human_judgment: false
  - id: D3
    description: "gsd-planning returns handles for whole planning sections (REQUIREMENTS.md#workflow) with an estimate and no content, reads them untrusted from the staging copy without following links, and reports freshness from state.json"
    requirement: "FR-3"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#returns a handle for the section under \"## Workflow\" with an estimate and no content, and reads it fenced as untrusted"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#never follows a symbolic link: a planning file that is a link to another file answers nothing"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#refresh: fresh while state.json is as it was, stale when it changed, deleted when the section is gone"
        status: pass
    human_judgment: false
  - id: D4
    description: "Documents reach packs through the graph's document node or, when it returns none, through the planning sections; both branches asserted"
    requirement: "FR-3"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#puts the planning section in the pack, fenced, when the graph returns no document node for the term"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#leaves the planning section out as a duplicate source when the graph returns a document node"
        status: pass
    human_judgment: false
  - id: D5
    description: "A stale index item citing a path deleted at HEAD is confirmed false with git-files, its content withheld and a note listing it; a path still at HEAD is confirmed true"
    requirement: "FR-18"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#keeps the item of a path that is still at HEAD, and withholds the content of one deleted at HEAD, listing it in the notes"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#asks git-files about each stale item that cites a path and about no other item"
        status: pass
    human_judgment: false
  - id: D6
    description: "adapters.context selects the composed sources from a closed list, an unknown, repeated or empty list fails composition naming adapters.context, and each composed source's descriptor is a context-<adapter> row of adapter_configs"
    requirement: "FR-3"
    verification:
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#composes only the sources adapters.context lists, and records only those"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#composes the four local adapters by default and records each descriptor in adapter_configs"
        status: pass
      - kind: integration
        ref: "test/integration/context-adapters.test.ts#fails composition naming adapters.context for an unknown name, a repeated name, an empty list and a value that is not a list"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-17
---

# Phase 4 Plan 26: Context adapters git-files and gsd-planning Summary

**The two missing local context adapters: git-files answers a scoped `git grep` with handles and 40-line snippets at one revision, gsd-planning returns untrusted heading-delimited planning sections as the document fallback, the profile's `adapters.context` selects the sources, and stale index citations are confirmed against HEAD before their content is used.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-11-17
- **Tasks:** 3 (one tracer, two auto), each as a RED commit and a GREEN commit
- **Files:** 17 changed, 1191 insertions, 31 deletions (measured over the six commits)

## Accomplishments

- **git-files (tracer).** `find` runs `git grep -n -z --fixed-strings -I --max-count 5 -e <term> <head> -- <read specs>` through safe git, keeps at most 200 hits in scope and returns one handle per hit (`path:line`, 375-token upper-bound estimate, no text). `read` returns the 40-line window around each picked hit, each line prefixed with its number, narrowed around the hit to 1500 characters. `refresh` is `deleted` when the path is gone at HEAD, `fresh` at the same revision, `stale` otherwise. `pathExists` is the confirmation the assembler uses.
- **gsd-planning.** Reads `.planning/PROJECT.md`, `REQUIREMENTS.md` and the CONTEXT, PLAN and LEARNINGS files of the phase `state.json` marks `in_progress`, from the staging copy only, with `O_NOFOLLOW`, regular files, a 256 KiB cap and real directories only. Sections are heading-to-heading (fences respected), IDs are `<file under .planning>#<slug>`, matches need every word of the term, heading matches rank first, at most 50 handles.
- **Assembler.** Source order is intel, graph, planning, git-files. Sources with no index in the record take the record's onboarded revision. Planning is skipped (with a note) when the graph returned a document node. `confirmCitedPaths` runs on every source's read result.
- **Selection and recording.** `adapters.context` is parsed in `src/domain/context-adapters.ts`; composition builds only the listed sources and (outside read-only commands) upserts one `context-<adapter>` row per source with its descriptor.
- **Resume.** `git-files` and `gsd-planning` references recorded by a run's item stage are now refreshed by their own source on `avarice resume`; before this plan they would have come back `unavailable`.

## Task Commits

1. **Task 1 (tracer) RED:** `1ac6a26` test(04-26): a pack built with git-files finds a term and reads a bounded snippet
2. **Task 1 GREEN:** `15a4c4a` feat(04-26): git-files answers a scoped search and reads bounded snippets
3. **Task 2 RED:** `54d07a7` test(04-26): gsd-planning sections and the document fallback are not built yet
4. **Task 2 GREEN:** `4134c95` feat(04-26): gsd-planning returns planning sections and backs the document fallback
5. **Task 3 RED:** `3dcfe30` test(04-26): stale citations, adapter selection and recorded descriptors are not built yet
6. **Task 3 GREEN:** `70e651b` feat(04-26): stale citations are confirmed and the profile selects the context sources

## Tracer gate

`⚡ Tracer verified end-to-end — expanding`: `node --test test/integration/context-adapters.test.ts test/integration/context-handle-first.test.ts` passed (12 tests) before Task 2 started.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A resume would have refreshed the new references as `unavailable`**
- **Found during:** Task 1 (test/integration/run-resume-refs.test.ts failed once the default composition added git-files items to run packs)
- **Issue:** `sourceOf` in the resume refresh knew only gsd-intel and gsd-graph, and `refreshQueryFor` only their indexes.
- **Fix:** both know the planning and git-files sources; `refreshQueryFor` gives them the record's onboarded revision. The existing test's kind mapping now covers `snippet` and `section`.
- **Files modified:** src/app/resume-refs.ts, src/app/context.ts, test/integration/run-resume-refs.test.ts
- **Commit:** 15a4c4a

**2. [Rule 3 - Blocking] Descriptor list for the capability check**
- **Found during:** Task 1
- **Issue:** `descriptorsOf` listed only the intel and graph context sources, so the new sources' descriptors would have been invisible to the FR-16 check.
- **Fix:** the two new sources are listed.
- **Files modified:** src/app/capabilities.ts
- **Commit:** 15a4c4a

**3. [Rule 1 - Bug] Frozen `context --json` fixture**
- **Found during:** Task 3 (unit suite, test/unit/json-shapes.test.ts)
- **Issue:** the default composition now adds a git-files item to the pack for the fixture's term, so the frozen output gained one item (key set and order unchanged; only the `source` union widened).
- **Fix:** regenerated test/fixtures/json-shapes/context-active.json only (`AVARICE_SNAPSHOT_WRITE=1`); the diff is that one added item and `usedTokens`.
- **Commit:** 70e651b

**4. [Plan wording] "records each descriptor" and the plan's `confirmCitedPaths(items, gitFiles)` signature**
- `confirmCitedPaths` also takes the workspace (git-files needs the tree to ask about), and reads the path from a new `citedPath` field both index adapters now set, since the item's `scope` is not the cited path for intel entries.

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 3) plus one signature note. **Impact:** none on scope.

### Documentation not updated here

The plan says this SUMMARY lists the documentation surfaces for plan 04-38, and plan 04-38 is the phase's documentation plan, so no `docs/system/` file was edited in this plan. CLAUDE.md asks for `docs/system/` to change in the same change as a behavior change; the owner may want that applied earlier than 04-38 (see the list below).

## Decisions needing owner review

These were not specified by the plan and are policy or security semantics, not mechanics:

1. **Default read scope with no contract.** `avarice context` (no run, no contract) lets git-files return a hit from any committed path except `.git` and the six secret globs (`**/*.key`, `**/*.pem`, `**/.env`, `**/.env.*`, `**/id_ed25519*`, `**/id_rsa*`). A run's contract read lists replace it, but nothing passes a contract's lists to `queryContext` yet (the `readScope` and `worktreePath` request fields exist for plans 04-28 and 04-30 to fill).
2. **Withheld content for a gone path.** A stale item whose path is deleted at HEAD stays in the pack (existing tests assert `confirmed: false` items remain) but its excerpt becomes `[content withheld: <path> is not at the current revision]`. Before this plan the excerpt was printed with a warning label.
3. **Which phase counts as current.** The first `in_progress` phase in `state.json`; with none, or no `state.json`, only PROJECT.md and REQUIREMENTS.md are read, and an absent `state.json` makes every planning section `unavailable` (warned, never blocking).
4. **Planning freshness is coarse.** Any change to `state.json` (not to the section's own text) makes a recorded planning reference `stale`; only a vanished section or file is `deleted`. Neither blocks a resume.
5. **Default composition changes every default pack.** All four sources are on by default, so packs for `avarice context` and every run's item stage can now carry git-files snippets and planning sections. The term is the brief title or the user's words searched as one case-sensitive fixed string, so long natural-language titles rarely hit.
6. **git-files also finds text in tracked `.planning/` files**, so a term in a committed planning file can appear both as a planning section and as a snippet (the planning section is skipped only when the graph holds a document node).
7. **adapters.context refusals.** An empty list is refused (leave the key out for all four); other keys of the `adapters` section are ignored, not refused.

## Documentation surfaces (for plan 04-38)

- `docs/system/indexes-and-context.md`: the context application module now has four sources in the order intel, graph, planning, git-files; the pack item `source` values `gsd-planning` and `git-files` (line 237 still says two); the planning-skipped-on-document-node rule; `confirmCitedPaths` (stale item, path gone at HEAD: confirmed false, content withheld, note); the git-files and gsd-planning adapters (query, read scope, snippet bound, handle estimate, freshness, untrusted marking); resume now refreshes both.
- `docs/system/config-reference.md`: the profile config key `adapters.context` (closed list, default all four, refusals, one `context-<adapter>` row per source in `adapter_configs`).
- `docs/system/data-model.md`: new `adapter_configs` names (`context-gsd-intel`, `context-gsd-graph`, `context-gsd-planning`, `context-git-files`; port `context-source`); new `task_refs` provider/kind pairs `git-files`/`snippet` and `gsd-planning`/`section`; the ID forms `path:line` and `<file under .planning>#<slug>`; the planning revision form `gsd-state:sha256:<hex>`.
- `docs/system/cli-reference.md`: `avarice context` output can show the two new sources; the profile now decides which.
- `docs/system/coverage.md` and the `docs/system/README.md` tables: no new document; update any count of adapters or context sources it records.
- `docs/system/findings.md` candidates: `docs/contracts-and-state.md:348` says git-files reads "via `Workspace.search`"; the built adapter runs `git grep` through safe git (there is no `Workspace.search`). The same table says gsd-planning reads "the current phase" without naming how; the build uses the first `in_progress` phase of `state.json`.

## Issues Encountered

None open. The worktree's `git` was only usable one command at a time, so test fixtures and scripts were written with the file tools.

## Threat Flags

None beyond the plan's register: T-04-71 (term after `-e`, `--fixed-strings`, no global option; asserted with `--exec-path=/tmp`, `:(top)a.txt`, `--help`), T-04-72 (scope filter plus pathspec narrowing; asserted for secret paths and a contract read list), T-04-73 (sections untrusted, rendered fenced, injected line asserted inside the fence).

## Known Stubs

None.

## Verification

- `node --test test/integration/context-adapters.test.ts test/integration/context.test.ts test/integration/context-handle-first.test.ts`: 42 pass, 0 fail
- `npm run typecheck`: clean; `npm run check:boundaries`: ok (125 files)
- `npm run test:unit`: 2688 pass, 0 fail
- Related integration: run-resume-refs, run-spec-derivation, graphify-tool, gsd-adapter, doctor, doctor-versions, status-queries, profile-isolation, profile-selection, profile-propagation, redaction-suite, run-sandbox-other-profiles, restricted-mode, restricted-onboarding, run-start, knowledge-pass, run-source, offline, staging-adapters, run-prompt-policy, run-outcomes, run-resume, run-events, untrusted-authority: all pass (the AC-5 and AC-6 suites among them). The full `npm test` was not run (orchestrator owns it).

## Self-Check: PASSED

- src/adapters/context/git-files.ts, src/adapters/context/gsd-planning.ts, src/domain/context-adapters.ts, test/integration/context-adapters.test.ts and the three 04-26-red-task*.json files exist.
- Commits 1ac6a26, 15a4c4a, 54d07a7, 4134c95, 3dcfe30 and 70e651b are in HEAD's history.
