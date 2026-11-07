---
status: diagnosed
phase: 02-contained-unattended-run-of-one-work-item
source: [02-VERIFICATION.md]
started: 2026-11-07T00:00:00Z
updated: 2026-11-07T23:27:04.745Z
---

Owner decisions from the re-verification after gap closure 02-26 (CR-01). The earlier, completed UAT stays in 02-UAT.md.

## Current Test

[testing complete]

## Tests

### 1. Owner decision on the sandbox residual (accepted threat T-02-91)

expected: Owner accepts the residual (code a contract command runs can read a tracked secret in the clone; the run sandbox denies reads by root only, src/adapters/host-claude/settings.ts:125), or schedules a sandbox read deny of the clone's secret paths.
result: pass

### 2. Owner decision on the git-object symlink gap (findings.md, hook-decision.ts:510)

expected: Owner accepts or schedules a fix. The path part of a git object name is judged after resolving working-copy symlinks, so a working-copy symlink at a secret path whose target matches no secret glob lets `git show <old-rev>:<path>` print a real secret from history. The scoped review 02-26-REVIEW.md rates this a BLOCKER (traced, not reproduced) and suggests also matching the lexical, repository-relative path against the secret globs.
result: issue
reported: "fix it"
severity: major

### 3. Owner decision on G-02-9 (avarice-run skill in attended sessions)

expected: Owner accepts the recorded verdicts (status first FAIL 1/4, stop on a denial PASS 3/3 with the caveat that 2 of 3 never invoked the skill, routable question FAIL 0/3) as findings, or opens a skill-text revision plan.
result: pass

### 4. Triage the open items in 02-REVIEW-DISPOSITION.md

expected: Each of the 9 warnings and 9 info items is marked fixed, skipped or deferred, and CR-01 is marked fixed (closed by 02-26). WR-04 and WR-05 touch CON-13 and kill-survival; WR-02 and WR-03 touch CON-2/CON-5 and RC-5. The new 02-26-REVIEW.md findings (WR-01, WR-02, IN-01..IN-04) are triaged the same way.
result: issue
reported: "fix it"
severity: major

## Summary

total: 4
passed: 2
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-02-H2
  truth: "The path part of a git object name (`<rev>:<path>`, `:<path>`, `:N:<path>`) is denied when either its symlink-resolved path or its lexical, repository-relative path matches a secret glob, so a working-copy symlink cannot hide a secret path that git reads by name from history or the index"
  status: failed
  reason: "User reported: fix it"
  severity: major
  test: 2
  root_cause: "checkGitObjects (src/domain/hook-decision.ts:502-514) judges the object-name path only through the symlink-resolving canon, and readRule (:230-239) matches denyReadGlobs on the resolved path; git reads <rev>:<path>, :<path>, :N:<path> by literal name from the tree or index. Reproduced with real git: a symlink, a dangling symlink, or a symlinked parent directory at a secret-glob name makes the hook allow and git print the secret."
  artifacts:
    - path: "src/domain/hook-decision.ts"
      issue: "checkGitObjects has no lexical (non-resolving) glob match of the object-name path"
    - path: "test/unit/hook-decision.test.ts"
      issue: "object-name tests use a canon with no symlink at the name (around lines 1090-1128); adjacency test premise at ~1110 changes"
    - path: "test/integration/hook-git-secret-reads.test.ts"
      issue: "no real-git case with a symlink at a secret name"
    - path: "docs/system/containment.md"
      issue: "rule 12 and :219 state the symlink exception"
    - path: "docs/system/findings.md"
      issue: "lines 181-182 record the gap"
  missing:
    - "Lexical check in checkGitObjects: normalize base+path (bases: staging, canon(cwd)) without filesystem resolution, match the staging-relative remainder against denyReadGlobs, deny-secret-read on match; keep the canonical checkRead"
    - "Pure lexical normalizer in src/domain (no node:path: boundary lint)"
    - "Unit tests: symlink, dangling symlink, directory symlink, subdirectory cwd; integration test on a real repo with history .env and working-copy symlink, asserting git prints the sentinel"
    - "Remove the symlink exception from containment.md and findings.md"
  debug_session: .planning/debug/git-object-name-symlink-secret-bypass.md
- gap_id: G-02-H4
  truth: "Every open code-review finding of Phase 2 (02-REVIEW-DISPOSITION.md: 9 warnings, 9 info, CR-01; 02-26-REVIEW.md: WR-01, WR-02, IN-01..IN-04) is fixed, or explicitly skipped or deferred with a recorded reason, and the disposition files show the outcome of each"
  status: failed
  reason: "User reported: fix it"
  severity: major
  test: 4
  root_cause: "25 review findings triaged against HEAD 86e6c4d: R-CR-01 already fixed by 02-26; R-IN-02 not a defect; R-IN-07 valid but a documented design choice (defer); 22 still valid (several reproduced: proxy dials loopback/private hosts from conventions, check sandbox leaves .gnupg/.netrc/.npmrc/.docker/.kube/gcloud/Keychains readable, sha256 COMMIT_SHA mismatch, bidi/zero-width controls kept, Math.min spread RangeError). R-WR-05 is broader than reported: settleInvocation has the same non-atomic three-write shape. No disposition file exists for 02-26-REVIEW.md."
  artifacts:
    - path: "src/domain/hook-decision.ts"
      issue: "S-WR-01, S-WR-02, S-IN-02..04 (after G-02-H2)"
    - path: "src/app/budget.ts"
      issue: "R-WR-04 wasKilled ignores resultSeen; R-WR-05 orphan charge and settleInvocation are three separate ledger writes"
    - path: "src/app/checks.ts"
      issue: "R-WR-03 credential deny list (3 duplicate lists, also invocation-scope.ts:291,488)"
    - path: "src/domain/conventions.ts"
      issue: "R-WR-02 accepts loopback/private/metadata hosts; adapter allowlist-proxy.ts dials unvetted"
    - path: "src/cli/commands/onboard.ts"
      issue: "R-WR-01 skips stripControl (also resume.ts)"
    - path: "src/adapters/git/staging-base.ts"
      issue: "R-WR-06, R-WR-07 (and run-source.ts, run-workspace.ts)"
    - path: "src/app/run-stages/item.ts"
      issue: "R-IN-06, R-IN-08 (with run-resume.ts R-IN-05)"
    - path: "test/helpers/live-attended.ts"
      issue: "R-WR-08, R-WR-09, R-IN-01, R-IN-09 harness/evidence hygiene"
  missing:
    - "P1 hook git-read hardening: G-02-H2 first, then S-WR-01, S-WR-02, S-IN-01 (doc line), S-IN-02, S-IN-03 (comment), S-IN-04"
    - "P2 budget settlement: one transactional ledger method for orphan charge and settleInvocation (R-WR-05), wasKilled honours resultSeen (R-WR-04)"
    - "P3 sandbox and egress: shared credential-dir constant extended (R-WR-03); refuse loopback/private/link-local/metadata hosts in conventions plus resolve-and-vet in the proxy adapter with a test seam (R-WR-02); after P1 (containment.md overlap)"
    - "P4 terminal text and git adapters: R-WR-01, R-IN-03, R-WR-06 (COMMIT_SHA 40-hex), R-WR-07, R-IN-04"
    - "P5 resume, lease and gated commit: R-IN-05, R-IN-06, R-IN-08"
    - "P6 harness and evidence hygiene: R-WR-08, R-WR-09, R-IN-01 (named files + recorders), R-IN-09"
    - "Dispositions: R-CR-01 fixed now; R-IN-02 and S-IN-01 skipped with reason; R-IN-07 deferred plus a findings.md line; create 02-26-REVIEW-DISPOSITION.md; mark each finding fixed as its plan lands"
    - "Each plan updates its docs/system document; a Phase 2 documentation pass plan runs last (CLAUDE.md)"
  debug_session: .planning/debug/phase2-review-findings-triage.md
