---
phase: 02-contained-unattended-run-of-one-work-item
plan: 35
subsystem: documentation
tags: [docs-system, coverage, findings, fresh-review, review-disposition, gap-closure, G-02-H2, G-02-H4]
requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: plans 02-27 to 02-34 and their per-plan docs/system edits
provides:
  - a worklist mapping 28 changed surfaces of the round to the docs/system section that states each
  - docs/system current for the round, with six gaps filled and a formatting defect fixed
  - findings.md with six new lines, two stale lines removed and 42 new `(now at)` annotations
  - coverage.md recounted at 40adc1f and every changed document marked reviewed with what was checked
  - 02-35-reviews/ with ten verbatim fresh-review reports and a README of rounds, digests and what was done
  - both review disposition files with open 0
affects: [verify-work 2, phase 2 close, owner decisions listed under Items for the owner]
gap_closure: true
gap_ids: [G-02-H2, G-02-H4]
actuals:
  tokens: 24000
  tasks: 3
  commits: 3
plan_head_before: 40adc1f
plan_head_after: 2682eef9421230231ade8b5c90f0d0ef2c78d108
tech-stack:
  added: []
  patterns:
    - "citations moved by a round are found by mapping each cited line through the diff hunks, then checked against the cited text"
    - "fresh reviewers run as separate read-only claude -p processes, one per document group, under a round cap"
key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-35-doc-worklist.md
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-REVIEW-DISPOSITION.md
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-35-reviews/README.md
  modified:
    - docs/system/containment.md
    - docs/system/findings.md
    - docs/system/coverage.md
    - docs/system/integrations.md
    - docs/system/config-reference.md
    - docs/system/runs.md
    - docs/system/processes.md
    - docs/system/checks-and-evidence.md
    - docs/system/cli-reference.md
    - docs/system/interactive-shell.md
    - docs/system/diagrams/run-resume-after-kill.puml
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-REVIEW-DISPOSITION.md
key-decisions:
  - "No document was added or renamed, so the two README tables are unchanged"
  - "The reviewers' wording and one-fact-one-home findings were fixed by pointing to the owning document (containment.md owns the egress proxy rules and the private-network limit; config-reference.md owns the host name rules)"
requirements-completed: [CON-1, RC-5, CON-2, CON-5, CON-13, CON-14, CON-16, FR-7, OPS-7, RC-2]
coverage:
  - id: D1
    description: "Every behavior plans 02-27 to 02-34 changed is described in docs/system against the code at the plan base, traced in the worklist"
    requirement: "CON-1"
    verification:
      - kind: command
        ref: "test -f 02-35-doc-worklist.md and grep -c docs/system/ prints 2"
        status: pass
    human_judgment: false
  - id: D2
    description: "coverage.md denominators equal their commands at 40adc1f: 120 test files, 35 hook rules; findings.md has the three required lines"
    requirement: "RC-5"
    verification:
      - kind: command
        ref: "test-file count and hook-rule count commands of Task 1 print equal values; grep for finish.ts, stages/map.ts and supervise.ts in findings.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each changed document was reviewed fresh by a reviewer that did not write it, under the round cap, and ends on a round with no BLOCKER or WARNING"
    requirement: "CON-14"
    verification:
      - kind: command
        ref: "02-35-reviews/README.md holds 5 PASS rows; 10 verbatim reports; the coverage.md marker loop prints no NOT MARKED line"
        status: pass
    human_judgment: true
    rationale: "Whether the reviews were thorough is the owner's judgment; the records are in 02-35-reviews"
  - id: D4
    description: "Every finding of 02-REVIEW.md (19) and 02-26-REVIEW.md (7) ends fixed, skipped or deferred with a reason; none is open"
    requirement: "CON-13"
    verification:
      - kind: command
        ref: "open: 0 in both files; row counts 19 and 7; no '| open |' row"
        status: pass
    human_judgment: false
duration: about 2h10m wall clock, including a pause for a usage limit
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 35: Documentation pass and review dispositions for plans 02-27 to 02-34 Summary

**docs/system now describes what the gap-closure round built, every changed document passed a fresh review within three rounds (cap five), and all 26 findings of the two code reviews have a recorded outcome with open 0.**

## Accomplishments

- **Task 1 (tracer).** The worklist (28 surfaces) maps each behavior of 02-27 to 02-34 to its docs/system section. Gaps filled: the containment.md host-paragraph sentence on the lease signal that plan 02-30 deferred here; the check Output bullet of containment.md, which had been joined to the Reads bullet; the reap statements in integrations.md and processes.md that still said a run's resume skips an unreapable launch; the slash-only path split and the parents read back with the trailers (integrations.md); the two places in checks-and-evidence.md that said check output is stored unfiltered. findings.md: six new lines (substring `test:` acceptance, the onboarding map's timeout-only signal with the intel and knowledge call sites, SIGTERM and the supervisor, the Read deny rule that does not match file-shaped credentials, private-network registries, truncation before redaction of check output), two load-sensitive test lines, two stale lines removed (the proxy address check and unredacted check output), one reworded, and 42 new `(now at file:line)` annotations. coverage.md recounted at 40adc1f.
- **Task 2.** 02-REVIEW-DISPOSITION.md: 17 fixed, 1 skipped (IN-02), 1 deferred (IN-07), open 0, total 19. New 02-26-REVIEW-DISPOSITION.md: 6 fixed, 1 skipped (IN-01), open 0, total 7. Partial outcomes are named in the reasons: IN-06 (no SIGTERM abort), IN-09 (no `refsAllowed` assertion), WR-03 (no allow-list inversion), IN-01 (narrow fix, wider residue to the owner).
- **Task 3.** Ten fresh reports. Group A (containment.md, findings.md): 3 rounds (BOUNCE, BOUNCE, PASS). Group B (integrations.md, config-reference.md): 3 rounds (BOUNCE with one BLOCKER, BOUNCE, PASS). Group C (runs.md, processes.md, data-model.md, checks-and-evidence.md, the resume diagram): 2 rounds (BOUNCE, PASS). Group D (cli-reference.md, interactive-shell.md): 2 rounds (PASS, PASS). No group reached the cap, so nothing is left open at the cap.

## Recounts (coverage.md, at 40adc1f, 2026-11-08)

| Surface | Before | After |
|---|---|---|
| Test files | 117 | 120 (cli-terminal-text, run-lease-loss, live-harness-hygiene) |
| Source lines | 26,261 | 26,576 |
| Hook rules | 35 | 35 |
| Ports | 11 plus the descriptor | 11 plus the descriptor |
| Proxy responses (integrations.md table rows) | 5 | 6 |

Event kinds (28), tables (23), migrations (2), `AVARICE_*` names (15), CLI commands (10) and the boundary lint (79 files) are unchanged.

## Task commits

1. Task 1: `282e0cb` (worklist, gap fills, findings, coverage recount)
2. Task 2: `0d01ec8` (both disposition files)
3. Task 3: `2682eef` (review fixes, review records, coverage statuses)

## Review findings that mattered

The reviews found no code bug; every WARNING was a prose claim the code contradicted or overstated. The BLOCKER of group B round 1 was a claim that a SHA-256 repository is refused at the first read for onboarding as well (onboarding registers first and refuses at the staging clone). Others: the proxy refuses fewer ranges than "reserved" suggested; a run passes only the lease signal to the host; a spawn failure is not charged a reservation; the test-only resolver lets the proxy dial a loopback registry; the run-resume diagram still showed an unreapable launch as marked interrupted; seven findings annotations carried over from before the round pointed at the wrong code. Each was corrected from the reviewer's code evidence and re-reviewed fresh.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale statements in docs/system that no round plan touched**
- **Found during:** Task 1 (grep of docs/system for the round's changed behaviors)
- **Issue:** integrations.md, processes.md and checks-and-evidence.md still described behavior the round changed (reap skipped for a run, check output unfiltered); the Output bullet in containment.md had been merged into the previous bullet; the resume diagram showed the old branch (found by a reviewer).
- **Fix:** corrected from the code; listed in the worklist.
- **Files modified:** docs/system/integrations.md, processes.md, checks-and-evidence.md, containment.md, diagrams/run-resume-after-kill.puml
- **Commits:** 282e0cb, 2682eef

**2. [Rule 1 - Bug] Moved citations that were already stale before the round**
- **Found during:** Task 3, round 1 of group A
- **Issue:** the diff-hunk mapping moved some citations by one line although they had pointed at the wrong code since an earlier state.
- **Fix:** seven annotations and one bare citation re-pointed at the code the line names.
- **Files modified:** docs/system/findings.md
- **Commit:** 2682eef

**3. [Wording] interactive-shell.md edited**
- A reviewer found the shell document listed fewer stripped characters than cli-reference.md; its one sentence now points at the output-style paragraph, and the file was reviewed in group D.

**Total deviations:** 2 auto-fixed (both documentation), 1 wording. **Impact on plan:** none on scope; interactive-shell.md and checks-and-evidence.md were reviewed although the plan's groups did not list them.

## Items for the owner

- Round cap: none reached; no document is marked `reviewed with open items`.
- IN-01 wider home-path residue (28 spike evidence files, 1 spike script, 1 proposal document, 115 planning files): deferred to the public-release decision. No docs/system change was needed for 02-31 (confirmed).
- Open question from 02-31: whether the host's permission engine admits a redirect through a prefix rule such as `ls:*` (needs a live session; recorded in LIVE-CASES.md).
- Private-network registries are now unsupported (flagged assumption of 02-34), recorded in findings.md.
- findings.md lines for the owner: substring `test:` acceptance (IN-07), the onboarding map, intel and knowledge invocations' timeout-only signal, SIGTERM and the supervisor (IN-06 part), the Read deny rule for file-shaped credentials, truncation before redaction of check output (unverified).
- Known load-sensitive test failures seen during the round, now in findings.md: the `after` cleanup of run-start.test.ts (ENOTEMPTY) and shell-supervisor.test.ts:111, besides the three already listed.
- Review text left as it came: interactive-shell.md lines 87 and 102 and data-model.md's history sentence say less than the full stripped set (not wrong).

## Issues Encountered

- The plan's pin script uses `git -C`, which the session's command filter refuses; the equivalent check (`git rev-parse --show-toplevel` equals the pinned root) was run before each commit and matched.
- The three review groups that run longer than three minutes were moved to the background by the harness; each finished and no `claude -p` process was left running (checked).
- The work was interrupted by a usage limit after round 3 had been started; it was resumed from the files on disk, and the round-3 reports were complete.
- No code changed and no test suite was run: the plan's full-suite check applies only after a code fix a review forces, and none was needed.

## Known Stubs

None.

## Threat Flags

None. T-02-120 (docs claiming a control broader or narrower than built) is mitigated by the worklist, the three fresh review groups and the fixes above; T-02-121 (a finding without an outcome) by the two disposition files with open 0.

## Self-Check: PASSED

Created files exist (worklist, 02-26 disposition file, 10 round reports and the README, this SUMMARY); commits 282e0cb, 0d01ec8 and 2682eef are ancestors of HEAD; the test-file and hook-rule counts equal their commands; no proposal document outside docs/system changed; both disposition files have open 0.
