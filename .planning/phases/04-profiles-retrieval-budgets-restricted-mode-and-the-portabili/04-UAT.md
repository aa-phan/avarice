---
status: complete
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
source: [04-VERIFICATION.md]
started: 2026-11-23T00:00:00Z
updated: 2026-11-24T05:18:44.661Z
---

## Current Test

[testing complete]

## Tests

### 1. GCR-01 — approval prompt hides part of long bound values
expected: Owner decision: accept as a recorded residual, or convert to a gap and fix (refuse to bind a value longer than the 80-character display cap, or print full values). See 04-REVIEW-GAPS.md GCR-01 and 04-VERIFICATION.md.
result: issue
reported: "gap"
severity: blocker

### 2. Triage 04-REVIEW-GAPS.md
expected: Every finding of the incremental review of the gap changes (1 critical, 7 warnings, 5 info) has a recorded disposition (fixed, deferred with a target, or skipped with a reason). The verifier reproduced GWR-01 (`gh pr -R x/y create` not classified), GWR-02 (brace expansion `git pus{h,}`) and GWR-03 (same-line alias `git -c alias.p=push p`); GWR-04 to GWR-07 were not run.
result: issue
reported: "fix"
severity: major
disposition: owner ruled every finding fix (2026-11-23). GCR-01 is test 1's gap; GWR-01 to GWR-07 and GIN-01 to GIN-05 are gaps G-04-2-GWR-01 to G-04-2-GIN-05.

### 3. AC-8 spot-check of runs T01-B, T04-C and T05-A
expected: A person reads each run's diff and judges that it really solves its task (the judge's verdict is automated; the semantic correctness is not).
result: issue
reported: "issue"
severity: major
note: Diffs rebuilt from the run transcripts (eval clones deleted). T04-C matches its brief. T01-B and T05-A make a correct source change but deliver unit tests only where the brief also asked for e2e coverage (T01-B: "unit and e2e coverage for the reduced-then-off case"; T05-A: "e2e density cases at pixel ratio 1 and 3"); T01-B's run says its instructions excluded e2e. The automated verdict counted both as successes.

### 4. Node 22.22.3 test leg
expected: The test suite passes on Node 22.22.3 (only the Node 26 leg was recorded, in 04-34; Node 22 is not runnable in the execution environment).
result: issue
reported: "run the test suite for me" — run 2026-11-23 on Node v22.22.3 (official darwin-arm64 build, SHASUMS256 verified): `node --test` exit 1, 5475 tests, 5146 pass, 207 fail, 45 cancelled, 77 skipped. Failures cluster in ~45 run/supervisor integration and fault files. Isolated repro: test/integration/run-status.test.ts fails 15/27 on Node 22.22.3 and passes 27/27 on Node 26.9.0 in the same checkout; the run ends blocked_on_decision (exit 3) where ready_for_review (exit 0) is expected. Child processes use process.execPath, so the whole run was on Node 22.
severity: blocker

### 5. Committed 04-36-evidence/ before a public push
expected: The owner decides whether the committed `04-36-evidence/` (278 files, about 45 MB, with private source in transcripts) may go to the public origin with the phase PR, or must be removed or moved first.
result: pass
decision: "allowed to go to public origin" (owner, 2026-11-23)

## Summary

total: 5
passed: 1
issues: 4
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-04-1
  truth: "`avarice approve` shows the owner every value an approval binds, or the command is refused as unapprovable"
  status: failed
  reason: "User reported: gap (GCR-01: paramsSummary clips each bound value at 80 characters, so a padded gitOptions or env hides a redirecting option the digest binds)"
  severity: blocker
  test: 1
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-4
  truth: "The test suite passes on Node 22.22.3, the minimum version package.json declares (engines >=22.22.3)"
  status: failed
  reason: "Run on Node v22.22.3: 207 failed, 45 cancelled of 5475; run-status.test.ts fails 15/27 on 22.22.3 and passes 27/27 on 26.9.0 (runs end blocked_on_decision instead of ready_for_review)"
  severity: blocker
  test: 4
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-3
  truth: "An AC-8 success means the run delivered what its brief asked: a run that skips part of the brief (here the e2e coverage T01-B and T05-A were asked for) is not judged a full success, and the run instructions do not forbid work the brief requires"
  status: failed
  reason: "User reported: issue (T01-B and T05-A judged successful while delivering unit tests only where their briefs also asked for e2e coverage)"
  severity: major
  test: 3
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-01
  truth: "`gh pr -R x/y create`, `gh pr --repo=x/y merge 1` and `gh release -R x create v1` are classified as privileged and need an approval"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-01, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-02
  truth: "A brace expansion that forms a privileged command (`git pus{h,}`, `{git,push}`) is classified or refused as unparseable, and the residual list names any brace or glob form left unhandled"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-02, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-03
  truth: "A git alias defined on the same line (`git -c alias.p=push p`, `--config-env=alias.*`, `GIT_CONFIG_KEY_n=alias.*`) is classified by its value or refused as unparseable"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-03, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-04
  truth: "A restricted run's patch keeps its in-scope edits when an out-of-scope changed file has a space, `@`, `+`, non-ASCII letter, bracket or leading `-` in its name"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-04)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-05
  truth: "A bindings lock left by a crashed writer is taken over even when its PID has been reused by another process"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-05)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-06
  truth: "A profile whose config is present but corrupt still has its whole root denied to other profiles' sandboxed commands"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-06)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GWR-07
  truth: "The bindings race test proves the two writers overlapped, retries until the race is exercised, and has a variant showing the unlocked path loses a binding"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-07)"
  severity: major
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GIN-01
  truth: "A here-document with an unquoted delimiter is scanned once, so one `$(git push)` in it needs one approval"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-01)"
  severity: minor
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GIN-02
  truth: "Common wrappers and launchers (`doas`, `su -c`, `find -exec/-execdir`, `parallel`, `watch`, `taskset`, `arch`, `caffeinate`, `unbuffer`, `chronic`, `coproc`, `trap`, `<<<` into a shell) are classified, and what remains is named in the enforcement-map residuals"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-02)"
  severity: minor
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GIN-03
  truth: "A Grep refused for a brace-group glob names the brace group as the cause, not a missing glob"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-03)"
  severity: minor
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GIN-04
  truth: "`stepSpendUsd` records the cap only for a step whose host started without finishing, and 0 with a note for a step that exited before any host start"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-04)"
  severity: minor
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- gap_id: G-04-2-GIN-05
  truth: "A reused pack item built by an older adapter format is treated as a miss and read again, so it carries current `untrusted` and `codeNode` flags"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-05)"
  severity: minor
  test: 2
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
