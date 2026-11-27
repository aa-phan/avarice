---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 54
subsystem: documentation
tags: [docs-system, findings, coverage, prose-review, ac-8, adr-016]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: the documentation worklist of plan 04-53, the AC-8 decision of plan 04-50 and the post-merge regression fix (3dccf9d, a53637b, d01ff88, 96a0718)
provides:
  - findings.md, README.md and coverage.md at the final code commit (96a0718)
  - the regression-fix statements applied to five docs/system documents
  - fresh prose reviews of all sixteen changed documents in four groups, five rounds, with every document marked reviewed in coverage.md
  - 04-54-reviews/, the review index with each finding's disposition and the round reports stored verbatim
affects: [phase-4-verification, docs-system]

actuals:
  tokens: 175500
  tasks: 2
  commits: 29

tech-stack:
  added: []
  patterns:
    - "A document is marked reviewed only from a passing round file whose digest equals the file's current sha256; a report whose digest does not match is re-read, not trusted"
    - "A reviewer's scope is a git diff range, and the owner may add a scoped round when the budget is spent"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/README.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-1-A.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-5.md
  modified:
    - docs/system/findings.md
    - docs/system/README.md
    - docs/system/coverage.md
    - docs/system/profiles-and-credentials.md
    - docs/system/containment.md
    - docs/system/cli-reference.md
    - docs/system/indexes-and-context.md
    - docs/system/runs.md
    - docs/system/policy-and-approvals.md
    - docs/system/doctor.md
    - docs/system/processes.md
    - docs/system/config-reference.md
    - docs/system/data-model.md
    - docs/system/integrations.md
    - docs/system/onboarding.md
    - docs/system/unknowns.md

key-decisions:
  - "No document is marked reviewed by a round that failed, and a report whose digest differs from the file is not trusted: processes.md was marked only after round 5 read it with a command-copied digest (T-04-142)"
  - "Owner decision 1 (2026-11-23): one scoped round 4 beyond the three-round budget, scoped to the lines changed since the round-3 digests (diff base f19ae4e)"
  - "Owner decision 2 (2026-11-23): findings.md delivery history is exempt as the owner's working log; the exemption covers findings.md only"
  - "Owner decision 3 (2026-11-23): group C gets one scoped round 5 on the one-bullet fix of unknowns.md"

requirements-completed: [FR-3, FR-12, FR-13, FR-14, FR-15, FR-22, SEC-1, SEC-2, SEC-3, SEC-6, CON-4, CON-10, CON-11, ONB-6, ONB-11, OPS-1, OPS-5]

coverage:
  - id: D1
    description: "findings.md closes or refreshes the lines the gap plans changed, records the AC-8 bound and result of ADR-016, and gains the decided differences and the regression-fix lines; the file passed a fresh review in four rounds"
    requirement: "OPS-5"
    verification:
      - kind: other
        ref: "node --test test/unit/footprint.test.ts (32 pass); 04-54-reviews/round-4-A.md (PASS)"
        status: pass
    human_judgment: true
    rationale: "Whether each added line states the owner's question correctly is a judgment the fresh reviewer made and the owner can overrule"
  - id: D2
    description: "coverage.md denominators re-run at 96a0718 (40 hook rules, 47,873 source lines, 242 test files, other counts unchanged) and every changed document carries a review status that names its round files"
    verification:
      - kind: other
        ref: "the commands of the Denominators table, re-run at 96a0718; every sha256 compared with the digest the passing round read before marking"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fresh prose review of every changed document: all four groups passed (A, B and D in round 4, C in round 5, processes.md re-read in round 5)"
    verification:
      - kind: manual_procedural
        ref: "04-54-reviews/round-4-A.md, round-4-B.md, round-4-C.md, round-4-D.md, round-5.md"
        status: pass
    human_judgment: true
    rationale: "A prose review is a reader's judgment against the code; the owner decided the budget and the scope of rounds 4 and 5"

duration: 3 sessions over 2026-11-22 and 2026-11-23 (the first, Task 1, took 40 min; five fresh review rounds with fix passes followed)
completed: 2026-11-23
status: complete
plan_head_before: 96a07180841c5d2a589042f4d3ccb28d723746dc
plan_head_after: 21fbbf676b45abd273a58e88edaa19d2fb974abb
---

# Phase 4 Plan 54: Documentation ledgers and review passes Summary

**findings.md, both README tables and coverage.md describe the tree at the final code commit, and all sixteen changed `docs/system` documents were reviewed by fresh readers against the code over five rounds (the last two scoped by the owner) and are marked reviewed.**

## Performance

- **Duration:** three sessions on 2026-11-22 and 2026-11-23; Task 1 took about 40 min, the review rounds and fix passes the rest
- **Completed:** 2026-11-23 (round 5 closed at HEAD `c1279bb`; plan HEAD before the summary commit `21fbbf6`)
- **Tasks:** 2 of 2 complete
- **Files modified:** 36 (`git diff --shortstat 96a0718 HEAD`: 2,828 insertions, 367 deletions), of which 16 documents under `docs/system` and the rest review records

## Accomplishments

- Task 1: findings.md closes the intel-untrusted line (35) and the whole-file read line (283, with the unused `beginRead` kept as the residual), refreshes the anchors of lines 267, 269, 270 and 332, drops `privileged-approval` from the unproven enforcement rows, names the AC-8 constant and the re-judge pair on the harness line (278), and records the ADR-016 bound (95% of the baseline's tokens, inclusive) and the recorded result (arm B at 94.4%, arm C at 88.5%) on the AC-8 line (331). It adds the three code-versus-proposal lines and the here-document line from the worklist, plus four lines from the regression fix (planning skip reads `untrusted`, unreachable intel branches in spec derivation, an unreadable enterprise config still exits 70, a permission error on the profile directory or listing still exits 70).
- README.md: the counterparts table gains the ADR-016 row; the status wording matches coverage.md.
- coverage.md: denominators re-run at `96a0718` (hook rules 40, source lines 47,873 in 240 files, test files 242; the other counts held), and after the reviews every document of the four groups moved from `changed after review` to `reviewed`, each row naming its round files. The Outstanding list no longer carries the open review items or the T-04-102 condition.
- Regression-fix statements applied and checked against the code: a permission-refused other-profile config adds the profile's directory and the default roots of its name and the command goes on; other read failures still exit 70; `context --json` carries `codeNode`; spec derivation takes file and symbol from an untrusted code node and nothing from document, concept or intel entries.
- Task 2: four review groups (A policy, approvals, processes, doctor, profiles, findings; B cli-reference, config-reference, README; C containment, data-model, integrations, unknowns; D runs, onboarding, indexes-and-context) ran fresh reviewers in rounds 1 to 3 (all failed each time, every finding verified against the code and fixed, none rejected), round 4 (A, B, D pass; C one WARNING) and round 5 (C pass; `processes.md` digest-confirmed pass). The reports are stored verbatim in `04-54-reviews/` and `04-54-reviews/README.md` records each disposition and every digest.

## Task Commits

1. **Regression-fix statements (Rule 2)** - `54fc813` (docs)
2. **Task 1: findings, README tables, coverage counts** - `e6651c3` (docs)
3. **Task 2: review records and fixes** - `826ed28` (groups and digests), the round-1 to round-5 report and fix commits (`9b04b49`, `9f14584`, `adc1efb`, `bb80093`, `d8f108f`, `232ace4`, `6dd9cee`, `54150cb`, `899d6e5`, `d6f16f0`, `b41eb68`, `e40c5bf`, `707c964`, `bc49315`, `01e9aaf`, `18fc3fb`, `3b36b23`, `46da520`), and the index and coverage commits (`85eb6d7`, `f19ae4e`, `1987922`, `86e3258`, `c1279bb`, `4d47764`, `21fbbf6`)

`commits: 29` is measured from the ledger base `96a0718` to `21fbbf6`, before this summary's own commit. **Plan metadata:** the commit that adds this summary, and the state commit after it.

## Review status for the owner

| Group | Documents | Passed in |
|---|---|---|
| A | policy-and-approvals, processes (and its diagram `approve-privileged-action.puml`), doctor, profiles-and-credentials, findings | round 4 (`round-4-A.md`); `processes.md` re-read in round 5 (`round-5.md`) |
| B | cli-reference, config-reference, README | round 4 (`round-4-B.md`) |
| C | containment, data-model, integrations, unknowns | round 5 (`round-5.md`) for `unknowns.md`; no finding in round 4 for the other three (`round-4-C.md`) |
| D | runs, onboarding, indexes-and-context | round 4 (`round-4-D.md`) |

All sixteen documents are `reviewed` in `docs/system/coverage.md`. Before marking, each current sha256 was compared with the digest the passing review read: `unknowns.md` `6c521497...`, `processes.md` `d077412b...` (both from `round-5.md`), and `containment.md` `010447d3...`, `data-model.md` `f87e46b4...`, `integrations.md` `b915faaa...` (from `round-4-C.md`). All matched. T-04-102's open condition no longer holds: `containment.md`, `data-model.md` and `integrations.md` are `reviewed`.

Two honest limits. Round 4 and round 5 were scoped by the owner to the lines changed since the previous digests, so unchanged text outside those scopes was read in rounds 1 to 3 only. Rounds 4 and 5 are outside the plan's three-round budget (owner decisions 1 and 3), and a scoped pass does not re-prove the whole document.

## Owner decisions (2026-11-23)

Recorded by the owner, Aaron Phan, answering the checkpoints raised after rounds 3 and 4, and copied verbatim into `04-54-reviews/README.md`.

1. Review budget: "Fix + scoped round 4". All four groups failed round 3, so the 3-round budget was exhausted. The owner overrode the budget for one more round: fix every round-3 finding, then one fresh round-4 review per group, scoped to the lines changed since the round-3 digests (diff base `f19ae4e`). A group passes when round 4 records no BLOCKER and no WARNING within that scope.
2. `findings.md` delivery history (observation O1, raised in every round): "Exempt: it's a log". Commit hashes, plan and ruling references and the `.planning` path may stay as evidence there. The exemption covers `findings.md` only. One sentence saying so is in its header.
3. Group C after round 4: "Fix + one-bullet round 5". Group C failed round 4 on one WARNING (`round-4-C.md`, W1). It was fixed exactly as the reviewer specified, then one fresh reviewer checked only that diff.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Applied the regression-fix statements and added the AC-8 and gap-fix records**
- **Found during:** Task 1
- **Issue:** the post-merge fix (3dccf9d, a53637b, d01ff88, 96a0718) made the Moved-root denial, containment, cli-reference, indexes-and-context and runs statements stale, and its four findings lines were missing.
- **Fix:** each statement verified against the code at HEAD and updated; the four lines added to findings.md.
- **Files modified:** profiles-and-credentials.md, containment.md, cli-reference.md, indexes-and-context.md, runs.md, findings.md
- **Committed in:** `54fc813`, `e6651c3`

**2. [Rule 3 - Blocking] Footprint guard failure on a reserved profile name**
- **Found during:** Task 1 (running `node --test test/unit/footprint.test.ts` on the findings text)
- **Issue:** a findings line spelled an enterprise profile name pattern the guard bans in the tree.
- **Fix:** reworded; the guard passes (32 of 32).
- **Committed in:** `e6651c3`

**3. [Plan deviation] Review rounds beyond the plan's three-round budget**
- Rounds 4 and 5 ran by the owner's decisions 1 and 3. The plan assumed no owner override; it records that a group still failing after round 3 stays `changed after review`. The owner chose to continue with scoped rounds instead, and every group then passed.

**4. [Plan deviation] A fourth review group**
- Group D (runs, onboarding, indexes-and-context) is listed because the worklist assigns those documents to it; the plan's file list names three round files. The round files are `round-1-D.md` to `round-4-D.md`.

**5. [Verify note] Task 1's automated check fails on one earlier sentence**
- `git diff --quiet 792536d..HEAD -- <proposal documents>` exits 1 because plan 04-50 changed one sentence of `docs/operations-and-testing.md` under ADR-016 (a recorded design decision). This plan changed no document outside `docs/system/` (`git diff HEAD~3 -- docs ':!docs/system'` was empty at Task 1).

**Total deviations:** 2 auto-fixed (1 Rule 2, 1 Rule 3), 2 plan deviations (budget, group D), 1 verify note.
**Impact on plan:** the documentation tree is current and every document has a review status backed by a passing round file. No scope creep: no file under `src/`, `test/` or `scripts/` changed in this plan and no proposal document changed.

## Issues Encountered

- The worktree sandbox refused compound git commands; plain single commands were used, and `git rev-parse --show-toplevel` printed the pinned root.
- `round-4-A.md` recorded the `processes.md` digest with one wrong character. The file was not marked on that report; a fresh round-5 reviewer read it with a digest copied from the command and passed it.
- The plan-level check that no proposal document changed is a documentation check only; `npm test` was not run, as the tasks changed no code.

## Open items for the owner

None of these blocks the plan. Each is an observation or NIT outside the scope of a passing review and is not fixed.

- From round 4 (A): the onboarding wording at `docs/system/profiles-and-credentials.md:67`, and the transcript PEM body lines that remain at `docs/system/profiles-and-credentials.md:111`.
- From round 4 (C): the configuration homes are stated three times in `docs/system/containment.md` (lines 214, 479 and 574); the orphan-charge wording omits the assumption at `src/app/budget.ts:117-118`, that the cost budget is unchanged between grant and conversion.
- Round 5 NIT 1, `docs/system/unknowns.md:63`: "did not pass" reads as the `p4-restricted-onboarding` case's standing result, though a later record is a PASS. The reviewer's suggested wording: "failed in its first three recorded attempts (... :25-27) and has a later PASS record (:32)".
- Round 5 OBS 1, `docs/system/processes.md:174`: the approve-a-privileged-action drift anchor could add `src/domain/approval.ts` (holds `APPROVAL_TTL_MS`, which the diagram states three times) and `src/cli/identity.ts` (decides the refusal branch for a non-terminal, a run process tree and a wrong user).
- Round 5 OBS 3, `test/containment/LIVE-CASES.md:574`: the `p4-restricted-onboarding` row says "FAIL, FAIL" while `live-run-phase4.jsonl` has three FAIL records (lines 25 to 27). The document cites the jsonl accurately; the mismatch is in the test evidence, which this plan does not edit.
- Earlier NITs left as written: `cli-reference.md` long Exit lines (reference lists), bold-lead reference bullets and question headings that other documents link to (group D), the 140-word record-contents list in `onboarding.md` (now a bullet list), and group A N10 (bold-lead outcome items).
- `config-reference.md` still omits `XDG_CONFIG_HOME` and `GH_CONFIG_DIR` (listed in the Outstanding section of `coverage.md`).

## Known Stubs

None.

## Threat Flags

None. Only documents and review records changed. T-04-142 is mitigated: no document is marked reviewed by a failed round, and the one report with a mismatched digest was re-read before its document was marked.

## Next Phase Readiness

- This is the phase's last plan (depends on all others). Phase 4 verification can check SC6: docs/system current, README tables, coverage and findings current, each changed document freshly reviewed.
- If a document under `docs/system` is edited after this summary, its sha256 no longer matches the digest its passing round read and the review status in `coverage.md` should be set back to `changed after review`.

## Self-Check: PASSED

- Files exist: the 16 documents above, `04-54-reviews/README.md`, `round-1-A.md` to `round-4-D.md` and `round-5.md`, and this summary.
- Commits `54fc813`, `e6651c3`, `46da520`, `4d47764` and `21fbbf6` are ancestors of HEAD.
- Digest check before the coverage marks: five sha256 values compared and equal.
- `git rev-list --count 96a0718..HEAD` printed 29 before this summary's commit.
- `node --test test/unit/footprint.test.ts` (Task 1): 32 pass, 0 fail. `node scripts/check-boundaries.ts`: ok (132 files). Not re-run at close: no file under `src/`, `test/` or `scripts/` changed.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-23*
