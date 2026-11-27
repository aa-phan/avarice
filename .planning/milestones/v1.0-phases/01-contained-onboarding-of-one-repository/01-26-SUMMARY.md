---
phase: 01-contained-onboarding-of-one-repository
plan: 26
subsystem: onboarding-exit-gate
tags: [assert-exit, live-gate, hook-policy, production-path, docs-contract, tdd, gap-closure]
gap_ids: [G-01-154]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: per-document knowledge coverage, record fields knowledge.documentsExpected and knowledge.dropped.unread, and verbatim readPath/writePath in .chunks.json (plan 01-25)
provides:
  - "assert-exit facts documentsExpected and unreadDocuments, and two problems: a knowledge section without per-document accounting, and unread corpus documents"
  - "Production-path proof (real ClaudeHostAdapter, fake claude, generated knowledge hook policy) that every readPath and writePath is allowed and every staging original is denied outside-read-set"
  - "docs/repository-onboarding.md states the new knowledge-pass contract and names what plans 01-18 and 01-19 specified before"
affects: [next scripts/exit-run.sh --rehearsal, phase 01 verification]

plan_head_before: 5a160798cd1bd607819cf605141ebbb500ec9ae4
plan_head_after: 957f0717a675ffb962503588658aff06aaec69fb

actuals:
  tokens: 4643
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A fact that can be absent stays null in the exit facts, so a record without accounting cannot pass as zero"
    - "Prove a path contract on the production path by running the real decision function over the policy file the real adapter wrote, and show the proof discriminates with a mutation made from a copy outside the repository"

key-files:
  created:
    - .planning/phases/01-contained-onboarding-of-one-repository/01-26-red-evidence-task1.json
  modified:
    - scripts/assert-exit.ts
    - test/unit/checkout-digest.test.ts
    - test/integration/claude-host.test.ts
    - docs/repository-onboarding.md

key-decisions:
  - "The live gate checks zero unread documents, stricter than the stage's at-least-half admission share, because it checks that every corpus document became a document node (UAT 154), not admission"
  - "readExitFacts keeps an absent documentsExpected or dropped.unread null (no count()), and judgeExit reports missing accounting only when a knowledge section exists, so a pre-01-25 record fails the gate and a record with no knowledge section reports only the no-document-nodes problem"
  - "exit-run-tools.ts is unchanged: the rehearsal already turns each assert-exit problem into an `assert-exit:` evidence problem"

requirements-completed: [ONB-14]

coverage:
  - id: D1
    description: "A record that leaves corpus documents unread, or whose knowledge section has no per-document accounting, makes assert-exit exit 1 with the count in the message; a fully accounted record with none unread passes and the JSON reports documentsExpected and unreadDocuments; a record with no knowledge section reports only the no-document-nodes problem"
    requirement: ONB-14
    verification:
      - kind: unit
        ref: "test/unit/checkout-digest.test.ts#fails a run that left corpus documents unread (UAT 154, plan 01-26)"
        status: pass
      - kind: unit
        ref: "test/unit/checkout-digest.test.ts#fails a knowledge section without per-document accounting when documentsExpected is absent (plan 01-26)"
        status: pass
      - kind: unit
        ref: "test/unit/checkout-digest.test.ts#reports only the no-document-nodes problem for a record with no knowledge section (plan 01-26)"
        status: pass
      - kind: unit
        ref: "test/unit/checkout-digest.test.ts#prints a JSON summary and exits 0 for an active record with code and document nodes at the onboarded revision"
        status: pass
    human_judgment: false
  - id: D2
    description: "On the production path every readPath and writePath handed to the knowledge agent is allowed by the generated hook policy (read-set, write-set), the staging original of each document is denied outside-read-set, and the launch prompt names neither the working directory nor the staging path; the test fails when readPath loses the corpus root's last segment"
    requirement: ONB-14
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#hands the model verbatim read and write paths that the generated hook policy admits, while the staging original of each document is denied (G-01-154, plan 01-25)"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/repository-onboarding.md states the knowledge-pass contract the code enforces (readPath, writePath, one-retry rule, per-document coverage with the at-least-half rule, documentsExpected, dropped.unread, corpus from covered documents) and the change from plans 01-18 and 01-19"
    requirement: ONB-14
    verification:
      - kind: other
        ref: "grep -c dropped.unread, readPath, documentsExpected, 01-25 on docs/repository-onboarding.md"
        status: pass
    human_judgment: true
    rationale: "Prose accuracy against the code is judged by a reader; the contract statements map to the plan 01-25 tests and this plan's production-path test, but no test reads the document text"
  - id: D4
    description: "The next live rehearsal confirms G-01-154: assert-exit reports no unread document and the injection-fence check finds ADR-999 inside the fence"
    requirement: ONB-14
    verification: []
    human_judgment: true
    rationale: "Needs a live (paid) run of scripts/exit-run.sh --rehearsal; no live run was started in this plan"

duration: 10min
completed: 2026-11-05
status: complete
---

# Phase 1 Plan 26: Live gate on unread documents, production-path proof, docs contract Summary

**assert-exit now fails any live record whose knowledge section leaves corpus documents unread or lacks per-document accounting, the generated knowledge hook policy is proven to admit every verbatim readPath and writePath while denying the staging originals, and docs/repository-onboarding.md states the new knowledge-pass contract.**

## Performance

- **Duration:** about 10 min
- **Started:** 2026-11-05T01:40:01Z
- **Completed:** 2026-11-05T01:49:36Z (code and docs; the SUMMARY commit follows)
- **Tasks:** 2 (a tracer and an auto task)
- **Files modified:** 4 source, test and docs files, plus 1 RED evidence file

## Accomplishments

- `scripts/assert-exit.ts` reads `knowledge.documentsExpected` and `knowledge.dropped.unread` as nullable facts (`documentsExpected`, `unreadDocuments`). `judgeExit` fails with `16 of 25 corpus documents have no document node (knowledge.dropped.unread)` when any are unread, and with `the knowledge section has no per-document accounting (documentsExpected, dropped.unread)` when either value is missing from a present knowledge section. The rehearsal picks both up through its existing `assert-exit:` problems.
- `test/integration/claude-host.test.ts` runs the production path (real ClaudeHostAdapter, fake claude, the generated knowledge `hook-policy.json`) and checks, for every file and chunk of `.avarice-knowledge/.chunks.json`, that `decideToolCall` allows Read of `readPath` (`read-set`), denies Read of the staging original (`outside-read-set`), and allows Write of `writePath` (`write-set`); and that the prompt in the launch argv contains neither the launch cwd nor the staging path.
- `docs/repository-onboarding.md` states the contract and attributes the change.

## Task Commits

1. **Task 1 (tracer): assert-exit live gate** - RED `2517625` (test), GREEN `d4a88b6` (fix)
2. **Task 2: production-path proof and docs contract** - test `5a91203`, docs `957f071`

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

- **Task 1 RED:** target test "fails a run that left corpus documents unread (UAT 154, plan 01-26)" in `test/unit/checkout-digest.test.ts`. `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`01-26-red-evidence-task1.json`, 31 tests, 25 pass, 6 fail). Semantic assessment: the target ran assert-exit against a migrated ledger fixture and failed on its first planned assertion (exit 1 expected, got 0 with `ok: true`), not on a syntax, import or fixture fault. Five siblings failed for the same missing behavior: the success case lacking the two new facts, the three per-document accounting cases, and the no-knowledge-section case lacking null facts.
- **Task 1 GREEN:** `d4a88b6`; the test file passes 31 of 31.
- **Task 2:** a test-after task by plan design (`type="auto"`, no `tdd`): the test passes on arrival because plan 01-25 already built the paths, and the mutation check below shows it discriminates.

## Task 2 mutation check

`src/domain/knowledge-extraction.ts` belongs to plan 01-25, so the copy was taken to a fresh `mktemp -d` outside the repository before mutating.

- **Mutation:** `readPath` built from `root.slice(0, root.lastIndexOf('/'))` (the corpus root without its last segment, `.avarice-knowledge`).
- **Under the mutation:** `claude-host.test.ts` exit code **1**, 35 of 36 pass; the one failure is the new test, "hands the model verbatim read and write paths ..." (message: `readPath of .planning/codebase/ARCHITECTURE.md is the corpus copy`).
- **After restore from the copy:** `git diff --exit-code src/domain/knowledge-extraction.ts` exit code **0**; `claude-host.test.ts` exit code **0**, 36 of 36 pass.
- **Result:** test failed under the mutation, passed after restore. The scratch directory was removed.

## Docs contract change

All changes are in `docs/repository-onboarding.md`; each old wording is quoted.

| Place | Old wording | New wording |
|---|---|---|
| Line 111, chunk plan | `.chunks.json` (paths and node-id stems, no text) | holds each document's repository path, node-id stem and absolute read path (`readPath`), each chunk's absolute output path (`writePath`), and no text |
| Line 111, after "the file list lives in the plan file" | (nothing) | the model passes each `readPath` and `writePath` to Read and Write exactly as given and builds no path; a denied or failed read is retried once, then left out and counted unread; plan 01-25 made the change because, in 2 of 4 live runs of the earlier prompt, the model dropped the `.avarice-knowledge/` segment and read the staging originals denied as `outside-read-set` |
| Line 111, outcomes | `No chunk file at all is no-output; fewer usable chunks than half the plan, or none usable, is validation-failed; with at least half the usable chunks go on, and the record's knowledge.corpus names only the documents those chunks cover.` | the per-document rule: coverage counted per manifest entry on the merged graph, fewer than half covered is `validation-failed`, otherwise the record states `knowledge.documentsExpected`, `knowledge.dropped.unread` and a `knowledge.corpus` from covered documents only; names plans 01-18 and 01-19 (every document of a shape-valid chunk counted covered, one document node enough, `dropped` as `{dangling, astDocument}` only) as the contract replaced (UAT gap G-01-154, plan 01-25) |
| Line 111, closing clause | `chunks written before the clock ends are used when at least half exist` | documents with a document node when the clock ends are used when at least half the manifest is covered, and the rest are counted in `knowledge.dropped.unread` |
| Line 135, Document nodes validation | (ended after the `.planning/phases/` clause) | appended: at least half the manifest's documents have a document node of the pass, each one without a node is counted in `knowledge.dropped.unread`, and a covered document is one a document node cites (the count shows what the graph holds, not which files the model opened) |
| Line 212, record example | `"documentNodes": 412 }` | adds `"documentsExpected": 412` and `"dropped": { "dangling": 0, "astDocument": 0, "unread": 0 }` |

## G-01-154 status

G-01-154 is closed offline by plans 01-25 and 01-26 together: 01-25 changed the knowledge pass (per-document coverage, verbatim paths, the unread counter in the record) and 01-26 added the live gate, the production-path proof against the generated hook policy, and the contract text. The next `scripts/exit-run.sh --rehearsal` confirms it live: assert-exit must report no unread document and the injection-fence check must find ADR-999 inside the fence. No live (paid) run was started here.

## Files Created/Modified

- `scripts/assert-exit.ts` - facts `documentsExpected` and `unreadDocuments`, two new problems, header comment on the zero-unread gate
- `test/unit/checkout-digest.test.ts` - Fixture fields `documentsExpected` and `unread`, success-summary assertions, unread, missing-accounting and no-knowledge-section cases
- `test/integration/claude-host.test.ts` - production-path policy test for verbatim read and write paths
- `docs/repository-onboarding.md` - rows 111 and 135 and the record example
- `.planning/phases/01-contained-onboarding-of-one-repository/01-26-red-evidence-task1.json` - Task 1 RED run

## Decisions Made

See `key-decisions` above. The gate is zero-unread while the stage admits at half; the owner can tune the stage constant (`KNOWLEDGE_LIMITS.documentShare`) without loosening the live gate.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. One verification command (the mutation-restore test run) outlived the tool's foreground timeout and finished in the background with exit 0; the restore had already been confirmed by `git diff --exit-code` (exit 0) before the rerun.

## Verification Results

- `env -u AVARICE_LIVE npm test` (full offline suite): 1293 tests, 1271 pass, 0 fail, 0 cancelled, 22 skipped (the skips predate this plan; they are the live and graphify-less suites), exit 0
- `env -u AVARICE_LIVE node --test --test-reporter=tap test/unit/checkout-digest.test.ts test/integration/claude-host.test.ts test/integration/knowledge-pass.test.ts`: 91 of 91 pass, with "ok" lines naming "unread" and "verbatim read and write paths"
- `npx tsc -p . && node scripts/check-boundaries.ts`: exit 0, `check-boundaries: ok (53 file(s))`
- Acceptance greps: `unreadDocuments` 6, `documentsExpected` 7 in assert-exit.ts; `dropped.unread` 2, `01-25` 1, `readPath` 1, `documentsExpected` 2 in the docs (counted by line; the Knowledge pass row is one line)
- `git diff --exit-code src/domain/knowledge-extraction.ts`: exit 0 (file unchanged by this plan)
- No live (paid) run was started; every suite ran with `AVARICE_LIVE` unset.

## Known Stubs

None.

## Threat Flags

None. T-01-90 (gate passing a run with unread documents) is mitigated by Task 1, T-01-91 (mutation left in place) by the copy outside the repository and the `git diff --exit-code` gate, and T-01-92 (docs stating an unenforced rule) by the mapping of each new docs statement to a test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 26 plans of phase 01 have a summary. Phase 01 is ready for verification; G-01-154 awaits the next live rehearsal for its live confirmation.

## Self-Check: PASSED

- Created and modified files exist on disk (checked with `[ -f ]`).
- Commits `2517625`, `d4a88b6`, `5a91203` and `957f071` are ancestors of HEAD; `git rev-list --count` from the ledger base gives 4.
- The RED evidence record returned `RED_EVIDENCE_OK`.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-05*
