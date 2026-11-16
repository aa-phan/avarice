---
phase: 03-decisions-independent-work-and-amendments
plan: 33
subsystem: documentation
tags: [docs-system, review, coverage, findings, autonomy-and-decisions, citations]
requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: the built decision subsystem, notification adapters, amendments and independent work of plans 03-01 to 03-74, and the drafts and worklist of plans 03-31 and 03-32
provides:
  - the comparison of the phase's diff with docs/system, with the gaps fixed
  - fourteen docs/system documents (the new autonomy-and-decisions.md and thirteen changed ones) reviewed fresh and marked reviewed in coverage.md
  - three new run diagrams read in review (no coverage rows)
  - coverage.md denominators recounted at 187409e
  - seventeen review reports stored verbatim, with the round dispositions
affects: [phase 3 verification]
tech-stack:
  added: []
  patterns: [fresh review per group under a round budget, reports stored verbatim, a citation extractor whose limits are stated]
key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/README.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-1-dispositions.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-2-dispositions.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-dispositions.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-4-dispositions.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-5-dispositions.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.py
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.md
    - .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-sentence-check.py
  modified:
    - docs/system/README.md
    - docs/system/autonomy-and-decisions.md
    - docs/system/checks-and-evidence.md
    - docs/system/cli-reference.md
    - docs/system/config-reference.md
    - docs/system/containment.md
    - docs/system/coverage.md
    - docs/system/data-model.md
    - docs/system/diagrams/run-amend-stale.puml
    - docs/system/diagrams/run-decide-resume.puml
    - docs/system/diagrams/run-decision-independent-work.puml
    - docs/system/findings.md
    - docs/system/integrations.md
    - docs/system/interactive-shell.md
    - docs/system/overview.md
    - docs/system/processes.md
    - docs/system/runs.md
    - docs/system/unknowns.md
key-decisions:
  - "A document that passed with only wording nits is not edited again to apply optional nits; the OBS items of round 5 are left by choice."
  - "A behaviour edit to a document after its pass (runs.md, the G2 repair-unit row) puts that document back into review; it was marked reviewed only after a fresh round read the edit."
  - "A claim about a code path is cited at the line that does the thing, not at the declaration; the citation extractor cannot judge this, so review by hand carries it."
status: complete
duration: about 8 hours over two sessions (2026-11-14 16:56 to 2026-11-15 00:51 for the commits, plus the round 5 close-out)
completed: 2026-11-15
actuals:
  tokens: 210000
  tasks: 3
  commits: 29
plan_head_before: 187409e
plan_head_after: afa6c28
---

# Phase 3 Plan 33: Documentation pass 3 of 3, comparison and fresh reviews Summary

The phase's documentation is compared with its code diff, repaired, and reviewed by fresh `technical-writer:prose-reviewer` runs in five groups over five rounds: every changed `docs/system` document, the new autonomy-and-decisions.md and the three new run diagrams passed with no BLOCKER and no WARNING, and `coverage.md` records the counts recounted at `187409e`. No code changed in this plan.

## Commits since the plan base 187409e

`commits: 29` is `git rev-list --count 187409e..HEAD` taken before this SUMMARY's own commit. No per-plan ledger file exists for 03-33 (the first session did not write one), so the base is the commit the orchestrator and `03-33-reviews/README.md` name as the plan base; it is the HEAD of plan 03-32.

| Hash | Subject |
|---|---|
| 87738ec | place the phase's findings, close the lines the code made false and re-point moved citations |
| 21bd82b | list the decision document in both README tables, recount the denominators and mark the changed documents drafted |
| fe577bf | record the comparison of the phase's diff with docs/system and the review groups |
| 96e0681 | apply round 1 findings of group A to the decision document, findings and unknowns |
| 16efe25 | apply round 1 findings of group B to runs, processes, data model and the three flows |
| 3b44a3b | apply round 1 findings of group C to checks-and-evidence and containment |
| a490bbb | apply round 1 findings of group D to the CLI reference, the shell and the configuration reference |
| a67ad31 | apply round 1 findings of group E to the integrations, overview and README |
| 785107e | mark where the answer flow ends for every refused branch |
| 661cf34 | say that only some preparation failures carry reason decision |
| 4f214e4 | store the five round 1 fresh review reports verbatim |
| 3e5e7d6 | record the round 1 dispositions and the round 1 rows of the review table |
| bee05de | store the five round 2 fresh review reports verbatim |
| b1f3493 | re-point the inline line numbers that round 2 found stale in findings |
| 6042f14 | apply round 2 findings of group B to processes, the two diagrams, runs and data-model |
| 2819cab | name the decision class a failed repair unit opens |
| ca79f98 | split the sentences over the cap and list the work item cap in group D |
| b657196 | correct the head message read and split the overview opening sentence |
| 38d89eb | mark the five documents that passed round 2 as reviewed |
| 13a7267 | record the round 2 dispositions and the round 2 rows of the review table |
| 06c0288 | store the five round 3 review reports verbatim |
| 43d6ab8 | re-point every stale citation of findings.md and split the long sentences |
| 8ff2b56 | apply the round 3 wording nits to the documents that passed |
| 6b82bb6 | record the round 3 dispositions and mark eight documents reviewed |
| fca03cb | store the round 4 review report verbatim |
| 84bd6de | apply the round 4 findings to findings.md and correct the citation check claim |
| 8e2edc6 | record the round 4 dispositions and the round 4 row of the review table |
| fab4854 | store the round 5 review report verbatim |
| afa6c28 | record the round 5 dispositions and mark findings.md reviewed |

All carry the prefix `docs(03-33):`. The diff of `docs/system` against the base is 18 files, 452 insertions and 374 deletions; `git diff --stat 187409e -- src bin` is empty.

## The review campaign

Five groups, each reviewed by a fresh reviewer that did not write the drafts. Reports are stored verbatim as `03-33-reviews/round-<n>-<group>.md` (17 reports: five in each of rounds 1 and 2, five in round 3, one each in rounds 4 and 5), with sha256 digests of the reviewed documents in the README table and the decisions in `round-<n>-dispositions.md`.

| Group | Documents |
|---|---|
| A | autonomy-and-decisions.md (new), findings.md, unknowns.md |
| B | runs.md, processes.md, data-model.md, three new diagrams |
| C | checks-and-evidence.md, containment.md |
| D | cli-reference.md, interactive-shell.md, config-reference.md |
| E | integrations.md, overview.md, README.md |

| Round | Verdicts |
|---|---|
| 1 | A: autonomy-and-decisions.md and findings.md needs-changes, unknowns.md pass. B: runs.md pass-with-nits, the rest needs-changes. C: needs-changes for both. D: cli-reference.md and config-reference.md needs-changes, interactive-shell.md pass-with-nits. E: integrations.md and overview.md needs-changes, README.md pass-with-nits. In all, 39 WARNINGs (28 about code behaviour or citations) and 27 OBS; 66 fixed, 0 rejected |
| 2 | A: autonomy-and-decisions.md and unknowns.md pass, findings.md needs-changes (4 citation WARNINGs). B: runs.md and data-model.md pass-with-nits, run-amend-stale.puml pass, processes.md and two diagrams needs-changes (2 code-behaviour WARNINGs). C: checks-and-evidence.md needs-changes (1 code-behaviour WARNING), containment.md pass-with-nits. D: pass-with-nits for all three (one wording WARNING, fixed). E: integrations.md needs-changes (one code-behaviour WARNING), overview.md pass-with-nits, README.md pass |
| 3 | A: findings.md needs-changes (12 citation WARNINGs). B: processes.md and run-decide-resume.puml pass-with-nits, run-decision-independent-work.puml pass, runs.md pass. C: checks-and-evidence.md pass-with-nits. D: cli-reference.md pass-with-nits, interactive-shell.md pass, config-reference.md pass. E: integrations.md pass-with-nits, overview.md pass |
| 4 | A: findings.md needs-changes (5 WARNINGs, four about code behaviour). The reviewer also showed that the author's citation script cannot detect a wrong citation |
| 5 | A: findings.md pass-with-nits, 0 BLOCKER, 0 WARNING, 3 OBS left by choice. Every round 4 item resolved; about 95 further claims and citations sampled, all held |

Groups B to E ended in rounds 2 and 3; only group A (findings.md, with its 549 citations) needed rounds 4 and 5 and finished inside the five-round limit, so no document is marked `reviewed with open items`.

## coverage.md

Denominators recounted at `187409e` (code unchanged since): 15 CLI commands; 24 SQLite tables (22 with a writer); 39 event kinds; 3 schema migrations; 12 ports plus one shared descriptor; 17 external system rows; 173 test files; 35,093 source lines; boundary lint 99 files; 17 `AVARICE_*` names; 9 profile config keys; 8 diagram sources; 6 work item states and 11 edges; 5 decision classes; gate rules G1 6, G2 8, G3 3, G4 7; 35 hook rules; 11 run states and 37 transitions; 14 onboarding states and 29 transitions. Per-document status: the new autonomy-and-decisions.md and every changed document are `reviewed` with a note citing `03-33-reviews`; coverage.md itself is the ledger. Fourteen markdown documents of `docs/system` are in the diff against `main` besides coverage.md (13 changed, 1 new), and the three diagrams.

## Findings and owner items routed to findings.md

- Worklist findings: 15 lines under "From autonomy-and-decisions" (worklist entries 9 to 18 and 22 to 26), one line for the declared non-required check, three under "From config-reference (run slice)", ten under "Proposal drift" (notify home, amendment by reply, the budget comment, three `human` class lists, S-50 timing, quiet hours, `cancel` missing from the proposal's table, the G1 advisory, the `decision:` form, withdraw ending the run `failed`).
- Round 1 owner items (routed, intent unknown):
  - `src/domain/notify-policy.ts:215`: the banner lists decision IDs but no caller passes any.
  - `src/domain/decision-policy.ts:279`: a `permission` decision has no amend command while `contract amend` accepts it.
  - `src/adapters/proc/ancestry.ts:56`: a descendant reparented to process 1 has no supervisor on its chain, and no test shows a run cannot produce one.
- Two entries the plan expected to be resolved still hold and stay open: the move from `contract_ready` to `blocked_on_decision` at `src/app/run-stages/prepare.ts:407` opens no decision record, and every failed G4 opens a `repeated_failure` decision at `src/app/run-stages/finish.ts:246`.
- Nine lines that no longer held were annotated with the commit; over 100 citations were re-pointed and 13 read by hand. The final file is 303 lines.
- Round 4 and 5 fixes of the findings file: the onboarding `paused` path, the admitted host versions, the seatbelt network rule, the decision class name `architecture`, the config file creation line, and the `70` exit constant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's check] Checks against `main`.**
- **Found during:** Task 3 (first session) and the close-out.
- **Issue:** The plan's early check compared the proposals and the ledgers (README.md, coverage.md, findings.md) with `main`. Those three differ from `main` because plans 03-69 and 03-71 and this plan edited them, so a check of them against `main` cannot pass.
- **Fix:** Run against the plan base `187409e`, as plan 03-32 did. At the close-out, the Task 3 commands as written in the plan (the proposals check over eight files under `docs/`, and the changed-document loop over `git diff --name-only main -- docs/system`) were also run against `main` itself and passed, because they cover the proposals only and the loop reads the status of each changed document, not its text; no `git diff main` check of README.md, coverage.md or findings.md remains in the final Task 3 verify.
- **Files modified:** none.

**2. [Rule 1 - Limits of the author-built citation checker]**
- **Found during:** Round 3, corrected after round 4.
- **Issue:** `round-3-citation-check.py` extracts every `file:line` citation of findings.md and tests that the file exists, the line is in range, the line is not blank and shares a word with the claim. It cannot judge whether a line supports its claim. After round 3 the README and dispositions said all 410 current citations "land" and "support" their claims; round 4 found five that did not support them, and showed the script could not have detected it.
- **Fix:** `round-3-citation-check.md` now carries a section "What the check does not prove" and no longer claims support. The five wrong citations were fixed by hand from the code. The script stays as a tool for finding stale lines, not as evidence of correctness; the fresh reviews carry the claim of correctness.
- **Files modified:** `03-33-reviews/round-3-citation-check.md`, `docs/system/coverage.md`.

**3. [Rule 1 - Behaviour edit after a pass] runs.md.**
- **Found during:** Round 2.
- **Issue:** Fixing the group C finding on the repair-unit route showed that the G2 table of runs.md carried the same defect: the row "Anything else" gave `acceptance` for a repair unit too. This is a behaviour edit to runs.md after its round 1 pass.
- **Fix:** The row is split into a unit that is not a repair (`acceptance`) and a repair unit (`repeated_failure`), from `src/app/run-stages/item.ts:1551`. runs.md was not marked reviewed after that edit; round 3 read it and passed it (including the new row), with no edit after.
- **Files modified:** `docs/system/runs.md`. **Commit:** 2819cab.

**4. [Rule 3 - Unavailable ledger] No `gsd-plan-head-before-03-33` file.**
- **Found during:** SUMMARY.
- **Issue:** The first session recorded the base in the review README, not in the git-directory ledger.
- **Fix:** `plan_head_before` is `187409e`; the count was measured against it.

**5. [Rule 3 - Branch namespace] The branch is not in the per-agent namespace.**
- The worktree branch is `worktree-phase-03`, which the orchestrator named and which is not protected; commits went to it as plan 03-32 recorded.

**6. [Rule 3 - Skipped step] Requirements not marked complete.**
- The plan lists requirement IDs, which belong to the code plans that built them, and the orchestrator's instruction leaves REQUIREMENTS.md unchanged. `requirements.mark-complete` was not run.

## Verification

Task 3 verify commands, with real output:

- Test file count: `coverage-test-count-ok` (recorded 173, `git ls-files test` ending `.test.ts` 173).
- `coverage-counts-ok` (`| CLI commands | 15 ` and `| Schema migrations | 3 `).
- `proposals-untouched` against `main` (and `git diff --stat 187409e` over the same eight files is empty).
- Changed-document loop over `git diff --name-only main -- docs/system`: no `NOT MARKED` line (18 paths: 14 markdown documents besides coverage.md, coverage.md, and 3 diagrams, so coverage.md is excluded from the loop and the diagrams are not `.md`). The same loop against `187409e`: no `NOT MARKED` line.
- Phase-wide gate: `npm run typecheck` clean; `node scripts/check-boundaries.ts` prints `check-boundaries: ok (99 file(s))`; `npm run test:unit` 2295 tests in 380 suites, 2295 pass, 0 fail, 0 cancelled, 0 skipped.
- `git diff --stat 187409e -- src bin` is empty: no code changed in plans 03-31 to 03-33.

## Known Stubs

None. This plan changed only documents and review records.

## Threat Flags

None. No code and no trust boundary changed. Threat T-03-63 (documentation that asserts behaviour the code lacks) is mitigated as the plan says: every document was reviewed fresh against the code before `coverage.md` marked it, and the review that found the citation script insufficient led to its limits being stated.

## Authentication gates

None.

## Self-Check: PASSED

- Created review records exist: `03-33-reviews/README.md`, `round-1-dispositions.md` to `round-5-dispositions.md`, `round-5-A.md` and the earlier reports.
- Commits 87738ec through afa6c28 are on the branch (`git log 187409e..HEAD`: 29).
- The coverage.md row of every changed document begins `| <name> | reviewed |` and cites `03-33-reviews`.
