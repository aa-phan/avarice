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
  - 04-54-reviews/README.md, the review groups with the sha256 of each version to review
affects: [phase-4-verification, docs-system]

actuals:
  tokens: 15000
  tasks: 1
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A document that changed after its review stays changed after review until a fresh reviewer passes its group"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/README.md
  modified:
    - docs/system/findings.md
    - docs/system/README.md
    - docs/system/coverage.md
    - docs/system/profiles-and-credentials.md
    - docs/system/containment.md
    - docs/system/cli-reference.md
    - docs/system/indexes-and-context.md
    - docs/system/runs.md

key-decisions:
  - "No document is marked reviewed: the executor could not dispatch a fresh prose-reviewer and the plan forbids a self-review (T-04-142)"
  - "Status halted: Task 2 (fresh reviews and review statuses) is not done and needs a caller that can spawn subagents"

requirements-completed: []

coverage:
  - id: D1
    description: "findings.md closes or refreshes the lines the gap plans changed, records the AC-8 bound and result of ADR-016, and gains the decided differences and the regression-fix lines"
    verification:
      - kind: other
        ref: "node --test test/unit/footprint.test.ts (32 pass); git diff HEAD~3 -- docs/system/findings.md read against the code"
        status: pass
    human_judgment: true
    rationale: "Whether each added line states the owner's question correctly is a judgment a fresh reviewer or the owner makes"
  - id: D2
    description: "coverage.md denominators re-run at 96a0718 (40 hook rules, 47,873 source lines, 242 test files, other counts unchanged) and every changed document set to changed after review"
    verification:
      - kind: other
        ref: "the commands of the Denominators table, re-run at 96a0718"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fresh prose review of every changed document"
    verification: []
    human_judgment: true
    rationale: "Not done: no agent-dispatch tool was available to the executor"

duration: 40min
completed: 2026-11-22
status: halted
plan_head_before: 96a07180841c5d2a589042f4d3ccb28d723746dc
---

# Phase 4 Plan 54: Documentation ledgers and review preparation Summary

**findings.md, both README tables and coverage.md now describe the tree at the final code commit, the owner's "deny, don't refuse" and code-node statements are in five documents, and the fresh reviews are prepared but not run, so no document is marked reviewed.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-11-22
- **Tasks:** 1 of 2 complete (Task 1 done; Task 2 halted)
- **Files modified:** 9 (1 created)

## Accomplishments

- Task 1: findings.md closes the intel-untrusted line (35) and the whole-file read line (283, with the unused `beginRead` kept as the residual), refreshes the anchors of lines 267, 269, 270 and 332, drops `privileged-approval` from the unproven enforcement rows, names the AC-8 constant and the re-judge pair on the harness line (278), and records the ADR-016 bound (95% of the baseline's tokens, inclusive) and the recorded result (arm B at 94.4%, arm C at 88.5%) on the AC-8 line (331). It adds the three code-versus-proposal lines and the here-document line from the worklist, plus four lines from the regression fix (planning skip reads `untrusted`, unreachable intel branches in spec derivation, an unreadable enterprise config still exits 70, a permission error on the profile directory or listing still exits 70).
- README.md: the counterparts table gains the ADR-016 row; the status wording matches coverage.md. Both tables already listed every document of the worklist.
- coverage.md: denominators re-run at `96a0718`: hook rules 40 (6 allow, 35 deny, one on both), source lines 47,873 in 240 files, test files 242 (92 unit, 116 integration, 18 fault, 11 containment, 3 mutation, 2 contract); the other counts held (20 commands, 19 `AVARICE_*` names, 22 actions, 18 enforcement controls, 50 event kinds, 4 migrations, 9 diagrams, 11 doctor areas, 24 tables, 132 boundary files, 32 footprint tests). Fourteen documents moved to `changed after review` with what changed.
- Regression-fix statements applied and checked against the code: a permission-refused other-profile config adds the profile's directory and the default data and work roots of its name and the command goes on; other read failures still exit 70; a refused config cannot name moved roots; `context --json` carries `codeNode`; spec derivation takes file and symbol from an untrusted code node and nothing from document, concept or intel entries.
- Task 2: `04-54-reviews/README.md` lists the four review groups (A to D) with the sha256 of each version to review. No round ran.

## Task Commits

1. **Regression-fix statements (Rule 2)** - `54fc813` (docs)
2. **Task 1: findings, README tables, coverage counts** - `e6651c3` (docs)
3. **Task 2 preparation: review groups and digests** - recorded in the commit that adds this summary

## Review status for the owner

| Group | Documents | Status |
|---|---|---|
| A | policy-and-approvals, approve-privileged-action.puml, processes (approve flow), doctor, profiles-and-credentials, findings | FAIL in rounds 1 and 2, round 3 pending |
| B | cli-reference, config-reference, README | FAIL in rounds 1 and 2, round 3 pending |
| C | containment, data-model, integrations, unknowns | FAIL in rounds 1 and 2, round 3 pending |
| D | runs, onboarding, indexes-and-context | FAIL in rounds 1 and 2, round 3 pending |

Open findings: the round-2 findings are fixed (see "Round 2 fixes"); round 3 has not run. T-04-102's open condition still holds: containment.md, data-model.md and integrations.md are `changed after review`, and so is every other document in the groups. Round 3 is the last round the plan allows: one fresh `technical-writer:prose-reviewer` per group, each report stored as `04-54-reviews/round-3-<group>.md`; only a group whose round 3 records no BLOCKER and no WARNING may have its coverage.md rows changed to `reviewed`.

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

**3. [Plan deviation] Task 2 not done**
- Issue: the executor had no agent-dispatch tool, so no fresh reviewer could run, and the plan and the instructions forbid a self-review. The status is `halted`.
- A fourth review group (D) is listed because the worklist assigns runs, onboarding and indexes to it; the plan's file list names three round files.

**4. [Verify note] Task 1's automated check fails on one earlier sentence**
- `git diff --quiet 792536d..HEAD -- <proposal documents>` exits 1 because plan 04-50 changed one sentence of `docs/operations-and-testing.md` under ADR-016 (a recorded design decision). This plan changed no document outside `docs/system/` (`git diff HEAD~3 -- docs ':!docs/system'` is empty).

**Total deviations:** 2 auto-fixed (1 Rule 2, 1 Rule 3), 1 halted task, 1 verify note.

## Issues Encountered

- The worktree sandbox refused compound git commands; the pin guard script ran, and `git rev-parse --show-toplevel` printed the pinned root.
- `STATE.md` and `ROADMAP.md` were not advanced: the plan is halted, and `state.advance-plan` was not run.

## Known Stubs

None.

## Threat Flags

None. Only documents and review records changed.

## Next Phase Readiness

- Re-run Task 2 from a caller that can dispatch subagents; then re-summarize this plan as `complete`, advance the plan counter and mark FR-3, FR-12, FR-13, FR-14, FR-15, FR-22, SEC-1, SEC-2, SEC-3, SEC-6, CON-4, CON-10, CON-11, ONB-6, ONB-11, OPS-1 and OPS-5 per the plan.
- If a document is edited after this summary, its sha256 in `04-54-reviews/README.md` no longer matches and must be recomputed before review.

## Round 1 fixes

Four fresh reviewers read the documents in round 1 and all four groups failed (A: 1 BLOCKER, 7 WARNING; B: 3 WARNING; C: 8 BLOCKER, 8 WARNING; D: 1 BLOCKER, 9 WARNING). The reports are stored verbatim as `04-54-reviews/round-1-A.md` to `round-1-D.md`. Every BLOCKER and WARNING was checked against the code at HEAD and fixed; none was rejected. The fixes are the commits "fix round-1 review findings, group A" to "group D". `04-54-reviews/README.md` records each finding's disposition and the new sha256 of every document for round 2. No group has passed, so `coverage.md` is unchanged and every document stays `changed after review`.

- Group A `findings.md` cites: the listed cites and about 70 further drifted ones are re-anchored with "(now at ...)", and eight duplicated observations now have one home. A scripted check compared each cite with the vocabulary of its line and the remaining flagged cites were read by hand, but the check cannot prove a cite right, so a round-2 reviewer may still find some that drifted.
- One `findings.md` line was added: the `profile-isolation` row of the enforcement map (`src/domain/enforcement-map.ts:113`) still says a moved profile is not covered, while the registry now denies it.
- Open for the owner (not changed): group A observation O1, delivery history in `findings.md` (owner rulings 2 and 4 of plan 04-35 at the two ruling lines, commit hashes under "edited on this branch", and quoted strings with "Phase 1", "(D-11)" and "Phase 2"). The reviewer could not tell whether `findings.md` is exempt as owner working material.
- NITs left: B-4 (long Exit lines in `cli-reference.md`, reference lists); D-N5 (bold-lead reference bullets) and D-N6 (question headings that other documents link to); the module-listing openings and the 138-word record-contents list in `onboarding.md` (reference lists). Stale entry found while re-anchoring: the `findings.md` line on a silent reap skip now says it no longer holds.
- No file under `src/`, `test/` or `scripts/` was edited and `npm test` was not run by this fix pass.

## Round 2 fixes

Four fresh reviewers read the round-1 versions again and all four groups failed (A: 1 BLOCKER, 3 WARNING, 4 NIT; B: 4 WARNING, 2 NIT; C: 1 BLOCKER, 6 WARNING, 3 NIT; D: 1 BLOCKER, 6 WARNING, 5 NIT). The reports are stored verbatim as `04-54-reviews/round-2-A.md` to `round-2-D.md`. Every finding was checked against the code at HEAD first and none was rejected. The fixes are the commits "fix round-2 review findings, group A" to "group D" and the two follow-up commits on `cli-reference.md` and the records. `04-54-reviews/README.md` records each disposition and the sha256 of all 16 documents for round 3. No group has passed, so `coverage.md` is unchanged and every document stays `changed after review`.

- Group A `findings.md`, full cite pass. A script extracted every `file:line` cite (685 in code spans, 30 outside them). The 522 in code spans and the 30 outside them that claim a current location were each opened at HEAD and read: the cited line has to be inside the construct the entry names. About 15 cites on lines that a vocabulary check could not match were read by hand with their context. 90 cites changed: 86 in code spans and 4 outside them (the other 163 in code spans are "as logged" cites that a "(now at ...)" already replaces; their targets are among the cites checked). Every changed cite was re-pointed to the line that holds the observation, or gained a "(now at ...)" where it was a bare wrong cite. None is marked "moved; not re-located", because each was found. Wrong "(now at ...)" targets from round 1 are corrected: the reviewer listed 19 lines, and this pass found the others.
- Four `findings.md` entries needed more than a re-anchor, because the claim itself had moved: `approvals` and `task_refs` now say "No longer holds" with writer and reader cites; the `onboard` boolean-flag entry now says `restricted` is declared (`onboard.ts:15`); the admitted-GSD-version regex entry now says it lives in `src/domain/gsd-version.ts` and `gsd-onboarding.ts`, not in `locate.ts`.
- Sentence length: 34 sentences over 35 words in `findings.md` are split, with every `file:line` kept. A final scan of all 16 documents, outside fences, tables and reference lists, finds none over 35 words in running prose. What is left is the command list at `cli-reference.md:7` and the Exit lines of the command reference, which are code-to-meaning lists, and the module lists that group D turned into bullets.
- Links and anchors: 652 relative links across `docs/system/*.md` resolve, checked by script after the five heading renames of group D and the one inbound link that followed.
- Open for the owner (not changed): group A observation O1, delivery history in `findings.md` (owner question; round-2 reviewer repeated it as an observation). Round 3 is the last round: a group that still fails there stays `changed after review` and needs an owner decision on how to go on.
- No file under `src/`, `test/` or `scripts/` was edited and `npm test` was not run by this fix pass.

## Owner decisions (2026-11-23)

Recorded by the owner, Aaron Phan, answering the checkpoint raised after round 3, and copied verbatim into `04-54-reviews/README.md`.

1. Review budget: "Fix + scoped round 4". All four groups failed round 3, so the 3-round budget is exhausted. The owner overrides the budget for one more round: fix every round-3 finding, then one fresh round-4 review per group, scoped to the lines changed since the round-3 digests (diff base `f19ae4e`, the HEAD the round-3 reviewers read). A group passes when round 4 records no BLOCKER and no WARNING within that scope.
2. `findings.md` delivery history (observation O1, raised in every round): "Exempt: it's a log". `findings.md` is the owner's working log of code-versus-proposal drift. Commit hashes, plan and ruling references and the `.planning` path may stay as evidence. Reviewers record it as exempt, not a finding. One sentence saying so is added to the header of `findings.md`.
3. Group C after round 4 (2026-11-23): "Fix + one-bullet round 5". Group C failed round 4 on one WARNING (`round-4-C.md`, W1). Fix it exactly as the reviewer specified, then one fresh reviewer checks only that diff.

## Round 3 fixes

Four fresh reviewers read the round-2 versions and all four groups failed (A: 1 BLOCKER, 6 WARNING, 3 NIT; B: 1 BLOCKER, 1 WARNING, 2 NIT; C: 0 BLOCKER, 3 WARNING, 7 NIT; D: 1 BLOCKER, 5 WARNING, 3 NIT). The reports are stored verbatim as `04-54-reviews/round-3-A.md` to `round-3-D.md` (commit `b41eb68`). Every finding was checked against the code at HEAD first and none was rejected. The fixes are the commits "fix round-3 review findings, group A" to "group D". `04-54-reviews/README.md` records each disposition and the sha256 of all 16 documents for round 4. No group has passed, so `coverage.md` is unchanged and every document stays `changed after review`.

- Group A: the count of commands that refuse inside a run is three, not four; a policy file in the wrong slot is refused by the sources builder, not treated as broken or absent; an end with no open start is refused; doctor's write statement names the profile directories; the multi-line secret limit is scoped to the transcript boundary; the approve-diagram anchors are corrected; the `findings.md` header carries the owner's exemption sentence. Left: N10 (bold-lead outcome items), which the reviewer calls optional.
- Group B: the install-host exit-70 message carries `internal error:`; the README sentence about proposals with no counterpart no longer contradicts the last table row; `approve` joins the exit-64 row; the retrieval override names are stated as integers with their ceilings.
- Group C: the context-source sentence, the cost-reservation wording, the `action.started` data, the command-identity order, the stray Read-budget sentence, the `scm.api.write` condition and two cites are corrected. `unknowns.md` lost its delivery-history wording: the five "(run slice)" sections are merged into their subsystem sections, "Campaign-wide" is "All documents", and the recorded live result of `p4-restricted-run` (a PASS, with `p4-restricted-onboarding` not passing) is now named in the open entry.
- Group D: the order of checks in `runs.md` puts preflight before the profile limits and places the conventions read inside it; the deletion rule is G2's; the brief reference is a second write; the `gsd-planning` row and the scoped-map refusal are corrected; four repeated Quirks lines are deleted; the derivation paragraph and the 1,000-word Launch paragraph are split by topic.
- Mechanical checks over the lines changed since `f19ae4e`: no sentence over 35 words in running prose, no banned dash, and all 652 relative links and anchors across `docs/system/*.md` resolve (checked by script).
- Documents changed since `f19ae4e` (the round-4 scope): fifteen of the sixteen. Only `diagrams/approve-privileged-action.puml` is unchanged.
- No file under `src/`, `test/` or `scripts/` was edited and `npm test` was not run by this fix pass. STATE.md and ROADMAP.md are unchanged.

## Round 4

Four fresh reviewers read the round-3 fixes, scoped to `git diff f19ae4e 1987922`. The reports are stored verbatim as `04-54-reviews/round-4-A.md` to `round-4-D.md` (commit `18fc3fb`).

- Group A: PASS (0 BLOCKER, 0 WARNING, 0 NIT). Group B: PASS (0, 0, 0). Group D: PASS (0, 0, 0).
- Group C: FAIL (0 BLOCKER, 1 WARNING, 0 NIT). W1: two bullets of "From containment" in `unknowns.md` contradicted each other about which evidence under `test/containment` was read, and the onboarding sentence left out the later PASS record. Verified at `live-run-phase4.jsonl:24` (PASS), `:25-27` (FAIL) and `:32` (PASS), and `LIVE-CASES.md:573-574`. Fixed in commit `3b36b23` (parent `86e3258`): the bullets are merged, they name what was read, and the onboarding sentence gives both outcomes. New `unknowns.md` sha256: `6c5214972cc51a5fa7aff71b8a603f7e49d2bb49e689d13623e7df8b8be8e3c5`.
- Owner decision (2026-11-23, Aaron Phan, answering the checkpoint about group C): "Fix + one-bullet round 5". Group C failed round 4 on one WARNING. Fix it exactly as the reviewer specified, then one fresh reviewer checks only that diff. Recorded verbatim in `04-54-reviews/README.md`.
- Coverage marks (commit `86e3258`): `policy-and-approvals.md`, `doctor.md`, `profiles-and-credentials.md` and `findings.md` (round files `round-1-A.md` to `round-4-A.md`); `cli-reference.md`, `config-reference.md` and `README.md` (`round-1-B.md` to `round-4-B.md`); `runs.md`, `onboarding.md` and `indexes-and-context.md` (`round-1-D.md` to `round-4-D.md`). Each digest in the round-4 reports was compared with the file first.
- `processes.md` is NOT marked. `round-4-A.md` records its digest as `d077412b...9c0deeb...` and the file is `d077412b...9e0deeb...`, a one-character difference that looks like a transcription slip. The report cannot settle it. Open for the owner: accept the pass, or have a fresh reviewer read it. The `.puml` has no row of its own in `coverage.md`.
- Group C's four documents (`containment.md`, `data-model.md`, `integrations.md`, `unknowns.md`) stay `changed after review`. The round-5 scope is the diff of commit `3b36b23` against `86e3258` for `unknowns.md`.
- Open items for the owner, observations outside the scope of round 4 that are not fixed:
  - From round-4-A: the onboarding wording at `profiles-and-credentials.md:67`, and the transcript PEM body lines that remain at `profiles-and-credentials.md:111`.
  - From round-4-C: the configuration homes are stated three times in `containment.md` (lines 214, 479 and 574); the orphan-charge wording omits the assumption at `src/app/budget.ts:117-118`, that the cost budget is unchanged between grant and conversion.
- No file under `src/`, `test/` or `scripts/` was edited and `npm test` was not run. STATE.md and ROADMAP.md are unchanged.

## Self-Check: PASSED

- Files exist: the nine files above and this summary.
- Commits `54fc813` and `e6651c3` are ancestors of HEAD.
- `node --test test/unit/footprint.test.ts`: 32 pass, 0 fail. `node scripts/check-boundaries.ts`: ok (132 files).
- The Self-Check covers Task 1 only; Task 2 is incomplete by design and is not claimed.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22 (Task 2 halted)*
