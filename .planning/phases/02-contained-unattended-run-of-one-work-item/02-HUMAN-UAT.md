---
status: testing
phase: 02-contained-unattended-run-of-one-work-item
source: [02-VERIFICATION.md]
started: 2026-11-07T00:00:00Z
updated: 2026-11-07T00:00:00Z
---

Owner decisions from the re-verification after gap closure 02-26 (CR-01). The earlier, completed UAT stays in 02-UAT.md.

## Current Test

number: 1
name: Owner decision on the sandbox residual (accepted threat T-02-91)
expected: |
  Owner either accepts that code a contract command runs (a test the run wrote, run by npm test) can read a tracked secret file in the clone, because the run sandbox denies reads by root only (src/adapters/host-claude/settings.ts:125), or schedules a sandbox read deny of the clone's secret paths (which can break checks that load such files). Until accepted, the CR-01 truth holds for the model's own tools and admitted shell commands only.
awaiting: user response

## Tests

### 1. Owner decision on the sandbox residual (accepted threat T-02-91)
expected: Owner accepts the residual (code a contract command runs can read a tracked secret in the clone; the run sandbox denies reads by root only, src/adapters/host-claude/settings.ts:125), or schedules a sandbox read deny of the clone's secret paths.
result: [pending]

### 2. Owner decision on the git-object symlink gap (findings.md, hook-decision.ts:510)
expected: Owner accepts or schedules a fix. The path part of a git object name is judged after resolving working-copy symlinks, so a working-copy symlink at a secret path whose target matches no secret glob lets `git show <old-rev>:<path>` print a real secret from history. The scoped review 02-26-REVIEW.md rates this a BLOCKER (traced, not reproduced) and suggests also matching the lexical, repository-relative path against the secret globs.
result: [pending]

### 3. Owner decision on G-02-9 (avarice-run skill in attended sessions)
expected: Owner accepts the recorded verdicts (status first FAIL 1/4, stop on a denial PASS 3/3 with the caveat that 2 of 3 never invoked the skill, routable question FAIL 0/3) as findings, or opens a skill-text revision plan.
result: [pending]

### 4. Triage the open items in 02-REVIEW-DISPOSITION.md
expected: Each of the 9 warnings and 9 info items is marked fixed, skipped or deferred, and CR-01 is marked fixed (closed by 02-26). WR-04 and WR-05 touch CON-13 and kill-survival; WR-02 and WR-03 touch CON-2/CON-5 and RC-5. The new 02-26-REVIEW.md findings (WR-01, WR-02, IN-01..IN-04) are triaged the same way.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
