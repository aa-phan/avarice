---
phase: 02-contained-unattended-run-of-one-work-item
plan: 22
subsystem: exit-run
tags: [exit, portfolio, live-run, unattended, ready_for_review, d-08, d-15, s-20, s-12]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-21 the owner-approved briefs, conventions (committed 9f63d91) and spend plan; 02-20 the default-parents sandbox and live run purpose; 02-07 checkout digest with the run-ref exclusion; 02-15 run status"
provides:
  - "scripts/exit-run-phase2.sh --run BRIEF... --authorization-file F: the live exit (authorize, snapshot, avarice start --wait in the owner's profile, snapshot, evidence), stopping at the first run that is not a clean ready_for_review"
  - "scripts/exit-run-phase2-tools.ts authorize (owner approval by parseBrief digest, preflight, no repeated run, fitsPhase2Ceiling with exit 75), snapshot (checkout digest excluding refs/heads/avarice/run_*, index digest, refs) and evidence (run record, spend line, diagnosis)"
  - "02-22-evidence-exit.json: three run records and the verdict `exit: 3/3 ready_for_review`"
  - "Three branches in ~/aa-phan-portfolio-v2 (refs/heads/avarice/run_*), each at the commit its run handed off"
  - "LIVE-CASES.md Exit (plan 02-22) section and spend row; three spend lines in live-spend-phase2.jsonl"
affects: [02-23]

actuals:
  tokens: 14000
  tasks: 2
  commits: 3
plan_head_before: 52ecb5cb806a79de83984b08ec834d1fed89320f
plan_head_after: 00852d0fe63ee62654846072a76376e1643a1ce8
commits: 3

tech-stack:
  added: []
  patterns:
    - "The live exit is a shell loop over briefs; each iteration is authorize, snapshot, start, snapshot, evidence, and any non-clean run stops the loop for diagnosis (D-08)"
    - "The checkout comparison is a composite of the checkout digest parts, the index digest and the symbolic HEAD, recomputed from the snapshot parts; the run-ref count is judged separately as newRefs"
    - "Spend is recorded once per run ID from the run's costUsd budget, also for a run that fails"

key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-22-evidence-exit.json
  modified:
    - scripts/exit-run-phase2.sh
    - scripts/exit-run-phase2-tools.ts
    - test/containment/LIVE-CASES.md
    - test/containment/live-spend-phase2.jsonl

key-decisions:
  - "The three approved briefs were each started exactly once; the first ran alone (tracer), the other two in one script invocation after the tracer's evidence verified end to end"
  - "Judged each run from the ledger and transcripts (state, final evidence rows with commit and clean flag, required checks, acceptance mapping, AskUserQuestion count), never from the host outcome kind"

metrics:
  duration: "about 50 minutes including three live runs of about 4.5 to 5 minutes each"
  completed: 2026-11-06

requirements-completed: [FR-1, FR-4, FR-5, FR-6, AUT-7, AUT-8, RC-2, RC-3, RC-4, CON-9]

coverage:
  - id: D1
    description: "Each of the three approved R1 briefs, started once with `avarice start --brief <file> --policy routine --wait` on ~/aa-phan-portfolio-v2 in the owner's profile, reached ready_for_review with no input after start (one attempt each, no retry)"
    requirement: FR-1
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase2.sh --run ... (runs run_01M6SE68ZTSJPBARR0DVKDKAMR, run_01M6SEKC0QAEW1HQHBANRCJPE7, run_01M6SEY4D8H2AWJX3PTTVZE1HR; evidence verdict exit: 3/3 ready_for_review)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each run's evidence names the verified revision (git:<commit>, clean true), lists all 12 required checks (11 passed, format:check failed and reported pre-existing per D-12) and maps every acceptance criterion to passed deterministic evidence; status shows the same offline"
    requirement: AUT-7
    verification:
      - kind: other
        ref: "02-22-evidence-exit.json runs[].requiredChecks, runs[].acceptance; avarice status (run_01M6SE68ZTSJPBARR0DVKDKAMR shows the checks, the branch and clean)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The portfolio's checked-out branch, HEAD, index, working tree including the untracked .env, other refs and worktrees are identical before the first and after the third run; three new refs/heads/avarice/run_* branches exist, each equal to its run's handed-off commit"
    requirement: CON-9
    verification:
      - kind: other
        ref: "02-22-evidence-exit.json runs[].digestBefore == digestAfter, runs[].checkout.newRefs, crossRun.equal; branchRefCommit == commit in all three"
        status: pass
    human_judgment: false
  - id: D4
    description: "No run transcript has an AskUserQuestion call (S-12); AskUserQuestion is denied by the host settings and the hook"
    requirement: RC-4
    verification:
      - kind: other
        ref: "02-22-evidence-exit.json runs[].askUserQuestion == 0, runs[].toolCounts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Before each start the script refuses when the recorded Phase 2 spend plus the run's 5.00 USD cap would pass the authorized ceiling (exit 75, stop and ask the owner); a run already recorded or a brief the owner did not approve is refused"
    requirement: RC-2
    verification:
      - kind: other
        ref: "authorize exercised on each start (spend 5.7565, 7.1030, 8.2856 plus 5.00 against 25 USD); the exit-75 branch itself was not triggered live"
        status: pass
    human_judgment: false

duration: "about 50 minutes"
completed: 2026-11-06
---

# Phase 2 Plan 22: The Phase 2 exit on the real portfolio Summary

**All three owner-approved R1 tasks (bug fix, small refactor, docs plus code) reached `ready_for_review` unattended on ~/aa-phan-portfolio-v2, one `avarice start` each with zero retries, for 3.5286 USD in total, leaving the owner's checkout byte-identical except for three new `avarice/run_*` branches.**

## Performance

- **Duration:** about 50 minutes; the runs took 4 min 31 s, 4 min 38 s and 4 min 30 s of wall clock
- **Tasks:** 2 of 2 (a tracer and an auto task)
- **Commits:** 3 task commits, measured from plan_head_before 52ecb5c
- **Live spend in this plan:** 3.5286 USD; Phase 2 total 9.2851 USD of the 25 USD D-15 ceiling

## Accomplishments

- Built the `--run` mode: `authorize` (approval by parseBrief digest, preflight, no repeated run, ceiling guard with exit 75), `snapshot` (checkout digest, index digest, refs) and `evidence` (reads the run from the owner's profile, appends the spend line once per run, records checks, acceptance mapping, transcript tool counts and the diagnosis for a run that did not reach review).
- Preflight before spending: `staleness: ok`, `conventions: ok` (9f63d91, checks digest 43b374ff...), repeated inside `authorize` before every start.
- Run results (the table is also in LIVE-CASES.md "Exit (plan 02-22)"):

| Brief | Run ID | State | Commit | Cost (USD) | Attempts | Tool calls |
|---|---|---|---|---|---|---|
| bug fix `r1-bug-swipe-nonfinite.md` | run_01M6SE68ZTSJPBARR0DVKDKAMR | ready_for_review | 0c4b58d | 1.3465 | 1 | 43 |
| refactor `r1-refactor-copy-textarea.md` | run_01M6SEKC0QAEW1HQHBANRCJPE7 | ready_for_review | c093ca0 | 1.1826 | 1 | 50 |
| docs plus code `r1-docs-dates-predicate.md` | run_01M6SEY4D8H2AWJX3PTTVZE1HR | ready_for_review | 54b2500 | 0.9995 | 1 | 47 |

- In each run: gates G0, G2 and G4 passed; 12 required checks at the handed-off revision on a clean tree, with `format:check` failed and flagged pre-existing (D-12) and the other 11 passed; AC1 to AC3 each mapped to passed deterministic check evidence; the model used Bash, Read, Edit, Write and the Agent tool (4 to 6 subagents) and never AskUserQuestion; the transcripts name no human prompt.
- The residual risk carried from 02-21 did not materialise: Claude's host sandbox ran on default-profile clones under the denied `~/.local/share/avarice-work` parent in all three runs, with no EPERM or lstat stop.
- Owner's checkout: branch `gsd/phase-02-deployed-themed-skeleton` at 9f63d91, index, working tree (the untracked `.env` included), `main`, `origin/main` and worktrees are identical in the snapshots taken before run 1 and after run 3; the refs list gained exactly the three run branches, each at the commit its run handed off. Nothing was written to, committed in, checked out, reset or stashed in the portfolio by this plan; the three branches are the supervisors' hand-off (D-02). The owner may delete them after review.

## Task Commits

1. **Task 1 (tracer), script and tools:** `eb5521a` (the `--run` mode)
2. **Task 1, run 1 and its evidence:** `746aaa5` (the bug-fix run, the digest-comparison fix, evidence, spend line)
3. **Task 2:** `00852d0` (the two remaining runs, verdict 3/3, LIVE-CASES.md section and spend row)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The checkout comparison counted the run refs**
- **Found during:** Task 1 (the first run's evidence step)
- **Issue:** the checkout digest's `counts.refsAllowed` (how many `avarice/run_*` refs exist) changed from 0 to 1 by design, so my composite comparison reported a difference although every digest part (HEAD, branch, status, file bytes, refs outside the run refs, worktrees, index) was equal. The script stopped, correctly, and printed the problem.
- **Fix:** the composite leaves `counts.refsAllowed` out and recomputes from the snapshot parts; the new run ref is judged separately as `newRefs`. Then the `evidence` step was re-run from the saved before and after snapshots. The run itself was not repeated and no second spend line was written (the spend line is keyed by run ID). Not a run failure under D-08: the run ended `ready_for_review` with clean evidence.
- **Files modified:** scripts/exit-run-phase2-tools.ts
- **Commit:** 746aaa5

**2. [Rule 1 - Bug] Evidence `endedAt` and spend-line field**
- **Found during:** Task 1
- **Issue:** the first version stamped the end time with the time the record was written, and a re-run of `evidence` overwrote the record's spend line with a note.
- **Fix:** `endedAt` is the run's own last update from the ledger; a repeated `evidence` call shows the existing spend line.
- **Commit:** 746aaa5

### Authentication gates

None.

## Issues Encountered

- A background command with a long wait exceeded the harness's 10-minute foreground limit, so each live script ran in the background and was followed by polling the process; no run was affected.
- `test/benchmark/portfolio/avarice-config.json`'s `test:e2e` stays optional and is never run by a real run, as 02-21 noted.

## Known Stubs

None.

## Threat Flags

None. The register held: T-02-71 (digests equal, only three new run refs), T-02-72 (the guard ran before every start; each run cost at most 27 percent of its cap and the Phase 2 total is 9.29 of 25 USD), T-02-73 (the `.env` file is in the file digest and unchanged; the clones never contained it), T-02-SC (dependencies installed from the portfolio lockfile through the registry-only proxy by AVARICE; this plan installed nothing).

## Self-Check: PASSED

- Files exist: 02-22-evidence-exit.json, scripts/exit-run-phase2.sh, scripts/exit-run-phase2-tools.ts, test/containment/LIVE-CASES.md, test/containment/live-spend-phase2.jsonl.
- Commits exist: eb5521a, 746aaa5, 00852d0 (ancestors of HEAD).
- Task 2's automated verify (`node -e` over the evidence file): passes; verdict `exit: 3/3 ready_for_review`; the ledger sums to 9.2851 USD over 73 lines. `npx tsc -p .` clean; `node --test test/unit/exit-drafts.test.ts` 20 pass.
