---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 03
subsystem: testing
tags: [benchmark, ac-14, ac-8, evaluation-tasks, owner-approval, shape-test]

requires:
  - phase: 03
    provides: "exit-drafts shape-test discipline (test/unit/exit-drafts.test.ts)"
provides:
  - "Five owner-approved AC-14 brownfield repositories with full 40-hex pins (test/benchmark/phase4/ac14-repositories.json)"
  - "Twenty owner-approved AC-8 evaluation tasks T01-T20, arms A/B/C and the AC-8 and D-08 pass rules (test/benchmark/phase4/eval-tasks.json)"
  - "A shape test that stops a later edit from dropping a repository, a pin or a held-out test (test/unit/phase4-exit-inputs.test.ts)"
affects: [04-31, 04-35, 04-36, 04-39]

actuals:
  tokens: 60000
  tasks: 3
  commits: 3
plan_head_before: bf0220cd200b5e95b86de30d977e34588495a076
plan_head_after: 81321c1ac444110dd9c4097d73b7242de6bd391d

tech-stack:
  added: []
  patterns:
    - "Exit inputs are data files with approvedBy and approvedAt, validated by a unit test; live spend reads only approved files"

key-files:
  created:
    - test/benchmark/phase4/ac14-repositories.json
    - test/benchmark/phase4/eval-tasks.json
    - test/benchmark/phase4/README.md
    - test/unit/phase4-exit-inputs.test.ts
  modified: []

key-decisions:
  - "GroceriesGPT replaces rekordbox-mcp as the fifth AC-14 repository (owner approved)"
  - "Arms: A = GSD map plus agent-found files (D-06 baseline), B = pack with code-only graph, C = pack with knowledge graph"
  - "Task briefs are the commit message subject plus body, not the subject alone"

requirements-completed: [ONB-6, FR-3, FR-22]

duration: n/a (spans an owner checkpoint)
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 03: Phase 4 Exit Inputs Summary

**Five pinned AC-14 repositories and twenty pinned AC-8 evaluation tasks with arms and pass rules, owner-approved and recorded in the files, guarded by a 17-assertion shape test.**

## Accomplishments

- Tracer (0f69f0b): one repository entry and one task under the shape test, proving the format before the full drafts.
- Full drafts (ff510ac): five repositories (three stacks or more, one with tracked `.planning/`, `~/aa-phan-portfolio-v2` included), twenty tasks mined from the owner's repositories, each with repository, commit, parent, brief, required checks and a held-out test path, plus a README.
- Owner approval (81321c1): the owner approved both lists exactly as drafted. `approvedBy` is "Aaron Phan" and `approvedAt` is 2026-11-16T18:47:56Z in both files. No entry changed between the draft and the approval.
- Shape test: `node --test --test-reporter=tap test/unit/phase4-exit-inputs.test.ts` reports 17 pass, 0 fail. `npm run typecheck` is clean.

## Approved digests

Plans 04-31, 04-35 and 04-36 must read exactly these files. The sha256 of each file at the approval commit 81321c1:

| File | sha256 |
| --- | --- |
| test/benchmark/phase4/ac14-repositories.json | 34afa9855fddbee4aa715be1afa44e4815e005e08a3c07bf7ca05e3124d8b0ef |
| test/benchmark/phase4/eval-tasks.json | 3de7b1080203809485fbf4f7b968e9e29703490494a019b0750e2f1050f15d92 |

## Deviations from Plan

### Reported at the checkpoint and approved by the owner

**1. [Owner decision] GroceriesGPT replaces rekordbox-mcp**
- The plan named rekordbox-mcp among the candidate owner repositories. The approved list uses GroceriesGPT as the fifth repository. The owner approved the swap.

**2. [Threat T-04-05] Briefs carry subject plus body**
- The plan says a brief is taken from the commit message. The drafts use the full message (subject and body), so a brief can carry implementation detail the commit body describes. The held-out test and the target commit stay out of every arm's reach, which is the FR-3 prohibition; the body text is the open exposure. The owner approved the full-message briefs. Plan 04-31 should check in the pilot whether any brief leaks the answer.

**3. Arm A cost depends on a map at the parent (for plan 04-31)**
- Arm A reads a GSD codebase map generated at the task parent when the repository carries none there. That is one map generation per distinct parent, which adds cost to arm A that 04-31 must count or report separately.

### Known limits

- The held-out test paths come from the target commits. They were not executed against the parents, so it is unverified that each held-out test fails at the parent and passes at the target. Plan 04-31 verifies this in the pilot.
- The shape test is run with `--test-reporter=tap`. The default spec reporter in this environment does not print the per-test result lines the plan's verify step greps for.
- `commits: 3` counts this plan's own commits (0f69f0b, ff510ac, 81321c1). A raw `git rev-list --count` from `plan_head_before` to HEAD would also count plan 04-04's commits, which landed in the same branch between the draft and the approval.

## Auth gates

None. The owner approval checkpoint was the plan's designed gate (`autonomous: false`), not a deviation.

## Known Stubs

None. `approvedBy` and `approvedAt` were null in the drafts and are now set in both files.

## Threat Flags

None.

## Self-Check: PASSED

- test/benchmark/phase4/ac14-repositories.json, eval-tasks.json, README.md and test/unit/phase4-exit-inputs.test.ts exist.
- Commits 0f69f0b, ff510ac and 81321c1 are ancestors of HEAD.
