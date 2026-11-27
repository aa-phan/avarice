---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 70
subsystem: documentation
status: complete
tags: [docs-system, coverage-ledger, prose-review, round-4, gap-closure, sc6, adr-017]

requires:
  - phase: 04
    provides: "plan 04-69: the ten changed docs/system documents, three failed review rounds per group, and the four open round-3 WARNINGs"
provides:
  - "the four round-3 WARNINGs (A-W1, A-W2, B-W1, B-W2) fixed against the code in policy-and-approvals.md and indexes-and-context.md"
  - "round-4 reports for both review groups, each PASS, stored verbatim"
  - "coverage.md statuses: all ten group documents reviewed, each naming its four round files"
  - "the Phase 4 benchmark README naming the ADR-017 verdict and the 95% inclusive AC-8 bound (code-review finding WR-01)"
affects: []

actuals:
  tokens: 14000
  tasks: 3
  commits: 5
plan_head_before: 23dbff64bd8415a11cda88cf26ccf83e6cad19ab
plan_head_after: 721170570a352df0c7c159bf479504dd02cefe25

tech-stack:
  added: []
  patterns:
    - "An owner-scoped round 4 reads only the lines changed since the round-3 digests; a group passes on its report's first line plus a digest match, checked by script"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-69-reviews/round-4-A.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-69-reviews/round-4-B.md
  modified:
    - docs/system/policy-and-approvals.md
    - docs/system/indexes-and-context.md
    - docs/system/coverage.md
    - test/benchmark/phase4/README.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-69-reviews/README.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS2-DISPOSITION.md

key-decisions:
  - "Owner decision 2026-11-25: fix the four round-3 WARNINGs with the reviewers' wording checked against the code, run one scoped round 4 per group, leave the round-3 NITs and WR-02 open"
  - "A group passes only when its report's first line is the PASS form with 0 BLOCKER and 0 WARNING, every document digest at HEAD appears in the report, and no group document changed after dispatch"

requirements-completed: [FR-3, FR-12, FR-22, SEC-6, CON-12]

duration: continuation after the Task 2 checkpoint
completed: 2026-11-25
---

# Phase 4 Plan 70: Round-4 documentation review and SC6 closure Summary

Both owner-scoped round-4 reviews passed, so all ten changed `docs/system/` documents are now marked `reviewed` in `coverage.md`, each naming its four round files; this closes the SC6 gap of the re-verification.

## Tasks and commits

| Task | Name | Commit |
|---|---|---|
| 1 | Fix A-W1, A-W2, B-W1, B-W2 and WR-01; record owner decisions, dispositions, round-4 scope and digests | `fdde37f` (fix commit), `df3611a` (WR-01 commit), `e5b33ba` (record commit, where round 4 was dispatched) |
| 2 | Round 4 (checkpoint:human-action, served by the orchestrator) | no commit; the two reports were saved untracked |
| 3 | Round-4 verdicts recorded, review statuses set, ledger brought current | `8064176` (both reports committed unchanged), `7211705` (coverage.md and the review index) |

`commits: 5` is measured with `git rev-list --count 23dbff6..HEAD` before the commit that adds this summary.

## Round-4 verdicts

- Group A, `round-4-A.md`: `VERDICT (round 4, group A): PASS. 0 BLOCKER, 0 WARNING, 0 NIT within scope.`
- Group B, `round-4-B.md`: `VERDICT (round 4, group B): PASS. 0 BLOCKER, 0 WARNING, 0 NIT within scope.`

Mechanical checks, run before `coverage.md` was edited: the first line of each report has the PASS form; every one of the eleven current sha256 digests (six group A files including the diagram, five group B files) appears in its group's report; `git diff --quiet e5b33ba` over the eleven documents exits 0, so none changed after dispatch. The two reports were committed once, unchanged, in `8064176`.

## Review status of each document

| Document | Group | Status in coverage.md | Round files |
|---|---|---|---|
| `policy-and-approvals.md` | A | reviewed | `04-69-reviews/round-1-A.md` to `round-4-A.md` |
| `containment.md` | A | reviewed | same |
| `cli-reference.md` | A | reviewed | same |
| `data-model.md` | A | reviewed | same |
| `processes.md` and `diagrams/approve-privileged-action.puml` | A | reviewed (the diagram takes the status of `processes.md`) | same |
| `profiles-and-credentials.md` | B | reviewed | `04-69-reviews/round-1-B.md` to `round-4-B.md` |
| `runs.md` | B | reviewed | same |
| `integrations.md` | B | reviewed | same |
| `indexes-and-context.md` | B | reviewed | same |
| `README.md` | B | reviewed | same |
| `findings.md` | log | exempt from prose review (owner's decision of 2026-11-23); unchanged | not applicable |

Only `policy-and-approvals.md` and `indexes-and-context.md` changed since round 3; the other nine were found unchanged by digest.

## WR-01 fixed, WR-02 open

WR-01 (the benchmark README named the ADR-017 verdict as "not yet present" and the old 50% AC-8 bound) is fixed in `df3611a`: the README names `eval-verdict-adr017.json` and states the bound as 95% of arm A's total tokens, inclusive (ADR-016), matching `scripts/eval-retrieval.ts:278` and `:292`. `04-REVIEW-GAPS2-DISPOSITION.md` records WR-01 as fixed. WR-02 stays open by the owner's decision of 2026-11-25, because it changes `src` and would need both full-suite Node legs rerun.

## NITs left open

By the owner's decision, not fixed:

- Round 3, group A: A-N1 to A-N6 (on `policy-and-approvals.md`: N1, N2, N5, N6; `containment.md`: N3, N4; `cli-reference.md`: N3, N4, N6; the definition owned by `profiles-and-credentials.md`: N3, N4).
- Round 3, group B: B-N3 (`indexes-and-context.md`), B-N4 and B-N5 (`integrations.md`).
- Round 4: no NIT was recorded.

`coverage.md` Outstanding lists them in one bullet and keeps the 04-54 open-observations bullet separate.

Observations outside the scope of round 4 (not counted, no document changed):

- Group A: the full attended-session hook message wraps the alias and brace reasons with advice to split the command, which fits neither cause. The document says only "the reason", which is accurate.
- Group B: when a source refuses a read as denied or unauthenticated, the handles are omitted with `access_revoked` (`src/app/context.ts:482-485`) but are not added to `refetch`. The new sentence on revoked items holds for revoked references; the edge is narrow and the claim is not misleading. This is a candidate for the owner or a later documentation pass.

## coverage.md ledger

- Denominators: the first sentences now say the count is at `3a6c10c`, "apart from a later edit to the benchmark notes in `test/benchmark/phase4/README.md`". The Test files command, `git ls-files test | grep -c '\.test\.ts$'`, still prints 243. No other count changed.
- Outstanding: the "Ten documents are marked `changed after review`" bullet is replaced by the NIT bullet and the 04-54 observations bullet.
- No new `docs/system` document, no new row in either table of `docs/system/README.md`, and no new `findings.md` line was needed: `git diff --quiet 3a6c10c HEAD -- src scripts bin` exits 0 and the only non-planning changes since are the documentation fixes of this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Over-length sentence swept in by editing the Denominators line**
- **Found during:** Task 3, sweep over `coverage.md`
- **Issue:** The Denominators paragraph is one line, so editing its first sentences put its whole line into the diff. A pre-existing 59-word sentence ("Since the previous count ... the ports") then tripped the 35-word cap of the plan's sweep. My own Outstanding bullet also had a 41-word sentence.
- **Fix:** Split the pre-existing sentence into four sentences with the same facts, and split the new NIT bullet into four sentences. Both are in `coverage.md`, a ledger outside the review groups.
- **Files modified:** `docs/system/coverage.md`
- **Commit:** `7211705`

Otherwise the plan executed as written. No file under `src`, `scripts` or `bin`, and no test file other than `test/benchmark/phase4/README.md`, changed since `08db6a5` (`git diff --quiet` over the plan's pathspec exits 0).

## Authentication gates

None. Task 2 was a human-action checkpoint, served by the orchestrator, which dispatched the two fresh reviewers and saved their reports verbatim.

## Known Stubs

None.

## Threat Flags

None. The plan changes documentation and review records only.

## Self-Check: PASSED

- FOUND: `round-4-A.md` and `round-4-B.md` under `04-69-reviews/`, one commit each (`8064176`).
- FOUND: commits `fdde37f`, `df3611a`, `e5b33ba`, `8064176`, `7211705` are ancestors of HEAD.
- Task 3 consistency check exits 0: group pass is true for A and B, no row inconsistent with a verdict; ten group rows name their round-4 file; sweep reports 0 violations; test-file count is 243.
