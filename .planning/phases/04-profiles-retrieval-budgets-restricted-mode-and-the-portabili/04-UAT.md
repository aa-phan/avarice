---
status: diagnosed
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
  root_cause: "paramsSummary passes every bound value through clip(value, MAX_VALUE_CHARS=80) and the whole summary through clip(..., 400); approve prints only paramsSummary, and the `line` parameter is shown as an opaque sha256, so values the digest binds (gitOptions, env, remote, refspec, endpoint) can be longer than what the owner sees"
  artifacts:
    - path: "src/domain/approval.ts"
      issue: "MAX_VALUE_CHARS = 80 clips each bound value in paramsSummary"
    - path: "src/cli/commands/approve.ts"
      issue: "prints request.paramsSummary only"
    - path: "src/hook/pre-tool-use.ts"
      issue: "builds the approval request shown to the owner"
    - path: "src/domain/privileged-commands.ts"
      issue: "classifyLine binds gitOptions/env verbatim with no length bound"
  missing:
    - "Either mark a command unapprovable when any bound value exceeds the display cap, or store and print every bound value in full"
    - "Integration test in test/integration/hook-privileged.test.ts: gitOptions longer than 80 chars is shown whole or refused"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GCR-01)"

- gap_id: G-04-4
  truth: "The test suite passes on Node 22.22.3, the minimum version package.json declares (engines >=22.22.3)"
  status: failed
  reason: "Run on Node v22.22.3: 207 failed, 45 cancelled of 5475; run-status.test.ts fails 15/27 on 22.22.3 and passes 27/27 on 26.9.0 (runs end blocked_on_decision instead of ready_for_review)"
  severity: blocker
  test: 4
  root_cause: "Test-fixture bug, not a product bug: the scratch repo every run/supervisor/fault test builds declares its required check as `node --test test/` (a directory argument). Node 26.9.0's test runner expands a directory to its default test pattern; Node 22.22.3 does not, globs `test/` to the directory itself, spawns it and fails with MODULE_NOT_FOUND, so required check `test` exits 1, gate G2 fails (target-not-passed), a repeated_failure decision opens and the run ends blocked_on_decision (exit 3). Changing the script to a glob makes 651/654 of the 48 affected files pass on 22.22.3"
  artifacts:
    - path: "test/helpers/run-fixtures.ts"
      issue: "line 30: RUN_REPO_FILES package.json test script `node --test test/`"
    - path: "test/integration/live-phase3-case-design.test.ts"
      issue: "line 368: spawns `--test ... test/` directly (2 failures)"
    - path: "test/helpers/live-phase3-fixtures.ts"
      issue: "lines 44 and 114: same directory form (live, skipped by default)"
    - path: "test/helpers/fake-run-host.ts"
      issue: "line 568: editPackageJson writes the same directory form"
    - path: "test/integration/run-independent-work.test.ts"
      issue: "line 312: separate event-count race (109 !== 108) under parallel load, not Node-22-specific"
  missing:
    - "Use a form both Node lines accept (e.g. `node --test test/**/*.test.ts`, an explicit file list, or bare `node --test`) in every fixture and direct spawn"
    - "Wait for banner/notification events to settle before snapshotting eventsBefore in run-independent-work.test.ts:312"
    - "Rerun the full suite on Node 22.22.3 and 26.9.0 and record both legs; do not raise engines (ADR-001 sets the 22.22.3 floor)"
  debug_session: ".planning/debug/node22-run-blocks-on-decision.md"

- gap_id: G-04-3
  truth: "An AC-8 success means the run delivered what its brief asked: a run that skips part of the brief (here the e2e coverage T01-B and T05-A were asked for) is not judged a full success, and the run instructions do not forbid work the brief requires"
  status: failed
  reason: "User reported: issue (T01-B and T05-A judged successful while delivering unit tests only where their briefs also asked for e2e coverage)"
  severity: major
  test: 3
  root_cause: "Two coupled causes. (1) Instruction conflict: briefFor appends a scope paragraph to every brief telling the run that any end-to-end or browser test named above is out of scope and must not be written; the host propagates it into every GSD gate prompt, so the verifier never flags the skipped bullet (added in 12b5d19 after diagnostic 2, recorded as a harness defect that does not change the verdict). (2) Judge blind spot: success = every required check passed AND held-out test passed (successRule, D-07); e2e specs are denied reads, not required checks and not the held-out test, the only AC is verified by the four checks, and rejudge reuses recorded booleans, so brief coverage never reaches the verdict. 5 of 10 recorded successes (T01-A, T01-B, T02-C, T05-A, T05-B) skipped an e2e bullet; without them successes are A 0, B 2, C 3 instead of 2, 4, 4"
  artifacts:
    - path: "scripts/eval-retrieval.ts"
      issue: "lines 549-554: briefFor scope paragraph forbids the e2e work the brief asks for"
    - path: "scripts/eval-retrieval.ts"
      issue: "line 564: single AC1 verified by the four checks only"
    - path: "scripts/eval-retrieval.ts"
      issue: "lines 586-611: judgeClone success = checks && held-out"
    - path: "scripts/eval-retrieval.ts"
      issue: "lines 390-411: rejudge reuses recorded success booleans"
    - path: "test/benchmark/phase4/eval-tasks.json"
      issue: "owner-approved, hash-pinned: successRule, deniedReads of e2e specs, T01/T02/T05 e2e bullets"
    - path: "docs/operations-and-testing.md"
      issue: "line 153 still says success matches the accepted change in reviewer judgment"
  missing:
    - "Owner decision (touches D-07 and the approved task file): make the brief the run sees equal the brief the judge uses (strip e2e bullets under re-approval, or let the run write the e2e spec and judge its presence)"
    - "Record per-run brief-bullet coverage in the results; count a run that skips a bullet as partial or exclude it from AC-8 success counts"
    - "Re-run rejudge and restate the ADR-015/ADR-016 numbers"
    - "Reconcile docs/operations-and-testing.md:153 with D-07 or log it in docs/system/findings.md"
  debug_session: ".planning/debug/ac8-success-ignores-brief.md"

- gap_id: G-04-2-GWR-01
  truth: "`gh pr -R x/y create`, `gh pr --repo=x/y merge 1` and `gh release -R x create v1` are classified as privileged and need an approval"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-01, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: "classifyGh takes the form from args[0] and args[1] exactly, so a persistent flag (-R/--repo, -H/--hostname) between the group and the subcommand hides `pr create`, `pr merge` and `release create` (same defect WR-03 fixed for npm)"
  artifacts:
    - path: "src/domain/privileged-commands.ts"
      issue: "lines 781-784: classifyGh key built from args[0] args[1]"
  missing:
    - "Skip the group's leading options (with values for -R/--repo/-H) before reading the subcommand"
    - "Add the three forms to the shell-oracle corpus in test/unit/privileged-commands.test.ts"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-01)"

- gap_id: G-04-2-GWR-02
  truth: "A brace expansion that forms a privileged command (`git pus{h,}`, `{git,push}`) is classified or refused as unparseable, and the residual list names any brace or glob form left unhandled"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-02, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: "The word reader does not perform brace expansion, so `git pus{h,}`, `{git,push}` and `g{i,}t push` read as non-privileged words; brace expansion is also missing from the documented residual list in ENFORCEMENT_MAP"
  artifacts:
    - path: "src/domain/privileged-commands.ts"
      issue: "lines 97, 182-285: word reading has no brace handling"
    - path: "src/domain/enforcement-map.ts"
      issue: "lines 94-98: residual list omits brace expansion and globbing"
  missing:
    - "Expand unquoted brace groups (capped, over-cap is unparseable) or treat a brace group with comma/.. in command-name or first-argument position as unparseable"
    - "Name any brace/glob form left unhandled in ENFORCEMENT_MAP and docs/system"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-02)"

- gap_id: G-04-2-GWR-03
  truth: "A git alias defined on the same line (`git -c alias.p=push p`, `--config-env=alias.*`, `GIT_CONFIG_KEY_n=alias.*`) is classified by its value or refused as unparseable"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-03, reproduced by the verifier)"
  severity: major
  test: 2
  root_cause: "classifyGit compares the word after the global options to `push` but never collects alias.<name> definitions from -c/--config-env or GIT_CONFIG_KEY_n/VALUE_n assignments on the same line, so a same-line alias pushes unclassified"
  artifacts:
    - path: "src/domain/privileged-commands.ts"
      issue: "lines 732-748: classifyGit ignores alias.* settings in its own prefix"
  missing:
    - "Classify a subcommand that names a same-line alias by the alias value, or return unparseable when any global option or assignment sets a key beginning alias."
    - "Corpus cases for -c, --config-env and GIT_CONFIG_* forms"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-03)"

- gap_id: G-04-2-GWR-04
  truth: "A restricted run's patch keeps its in-scope edits when an out-of-scope changed file has a space, `@`, `+`, non-ASCII letter, bracket or leading `-` in its name"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-04)"
  severity: major
  test: 2
  root_cause: "The WR-13 fix passes host out-of-scope paths as `exclude` to workspace.patch, whose validator accepts only /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/ (written for directories), so any out-of-scope file with a space, @, +, non-ASCII letter, bracket or leading - makes patch() return invalid and readOutputs drops the whole patch, in-scope edits included"
  artifacts:
    - path: "src/app/run-stages/restricted.ts"
      issue: "lines 224-225: passes outOfScope file paths as exclude"
    - path: "src/adapters/git/run-workspace.ts"
      issue: "lines 663-668: directory-only validator rejects ordinary file names"
  missing:
    - "Add a literal-pathspec exclusion for file paths (:(exclude,literal)<path>, relative, no .., no NUL) and keep the strict check for directories"
    - "Test in test/integration/restricted-mode.test.ts with out-of-scope `a b.txt` beside an in-scope edit"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-04)"

- gap_id: G-04-2-GWR-05
  truth: "A bindings lock left by a crashed writer is taken over even when its PID has been reused by another process"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-05)"
  severity: major
  test: 2
  root_cause: "inspectLock calls the lock stale only when process.kill(pid, 0) reports the holder gone; the stored startedAt is never compared with the live process's start time and there is no age bound, so after PID reuse a crashed writer's lock is held forever and every binding write returns unavailable"
  artifacts:
    - path: "src/adapters/fs/profile-bindings.ts"
      issue: "lines 164-175, 177-205: PID-only liveness check"
  missing:
    - "Treat the lock as stale when the live PID started after the lock's startedAt, or when the lock is older than a generous bound"
    - "Test that plants a lock naming a live PID with an earlier startedAt"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-05)"

- gap_id: G-04-2-GWR-06
  truth: "A profile whose config is present but corrupt still has its whole root denied to other profiles' sandboxed commands"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-06)"
  severity: major
  test: 2
  root_cause: "knownProfileRoots denies the whole root for an unreadable config (WR-17) but a present-and-corrupt config (invalid JSON, refused key, symlink, oversize) still hits `continue`, so that profile's data and work roots stay readable to other profiles' sandboxed commands"
  artifacts:
    - path: "src/adapters/fs/profile-registry.ts"
      issue: "lines 79-91: invalid read error skipped with continue"
    - path: "test/unit/profile-registry.test.ts"
      issue: "asserts the corrupt config is skipped"
  missing:
    - "Deny wholeRootOf(...) for an invalid read error too; keep the skip only for a directory that is not a profile"
    - "Update the unit test to assert the whole-root denial"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-06)"

- gap_id: G-04-2-GWR-07
  truth: "The bindings race test proves the two writers overlapped, retries until the race is exercised, and has a variant showing the unlocked path loses a binding"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GWR-07)"
  severity: major
  test: 2
  root_cause: "The bindings race test releases two children and checks 40 bindings survive, but neither child records call timings and the test never asserts an overlap, so sequential execution passes without exercising the race (the WR-42 defect, not applied to this test)"
  artifacts:
    - path: "test/fault/bindings-race.test.ts"
      issue: "lines 62-82: no overlap assertion or retry"
    - path: "test/helpers/bindings-race-child.ts"
      issue: "lines 19-30: no calledAt/returnedAt output"
  missing:
    - "Record calledAt/returnedAt per call, assert an A/B overlap, retry before failing 'the race was not exercised'"
    - "Discriminating variant calling the unlocked read-modify-write that loses a binding"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GWR-07)"

- gap_id: G-04-2-GIN-01
  truth: "A here-document with an unquoted delimiter is scanned once, so one `$(git push)` in it needs one approval"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-01)"
  severity: minor
  test: 2
  root_cause: "readBodies scans an unquoted-delimiter here-document body both as commands (scanCommands reaches $(...) inside words) and again with scanExpansions, so one $(git push) yields two git.push commands and two approvals"
  artifacts:
    - path: "src/domain/privileged-commands.ts"
      issue: "lines 325-343: double scan in readBodies"
  missing:
    - "Scan the body once (skip scanExpansions when scanCommands already ran) or de-duplicate commands from the same source span"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GIN-01)"

- gap_id: G-04-2-GIN-02
  truth: "Common wrappers and launchers (`doas`, `su -c`, `find -exec/-execdir`, `parallel`, `watch`, `taskset`, `arch`, `caffeinate`, `unbuffer`, `chronic`, `coproc`, `trap`, `<<<` into a shell) are classified, and what remains is named in the enforcement-map residuals"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-02)"
  severity: minor
  test: 2
  root_cause: "The wrapper and launcher list is a fixed allow-list missing doas, su -c, find -exec/-execdir, parallel, watch, taskset, arch, caffeinate, unbuffer, chronic, coproc, trap (string) and here-strings into a shell, and the residual text does not name them"
  artifacts:
    - path: "src/domain/privileged-commands.ts"
      issue: "lines 442-460, 861-867: wrapper list"
    - path: "src/domain/enforcement-map.ts"
      issue: "residual list"
  missing:
    - "Add the listed wrappers, treat <<< into a shell like a here-document"
    - "List what remains in the enforcement-map residuals"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GIN-02)"

- gap_id: G-04-2-GIN-03
  truth: "A Grep refused for a brace-group glob names the brace group as the cause, not a missing glob"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-03)"
  severity: minor
  test: 2
  root_cause: "Since WR-06 a brace-group glob counts as unfiltered, and at the clone root the refusal text says the search has no glob or type filter, which is untrue for `*.{ts,tsx}` and invites retries that can hit the consecutive-denials limit"
  artifacts:
    - path: "src/domain/hook-decision.ts"
      issue: "lines 155-156, 876: brace glob judged as match-all; refusal reason text"
  missing:
    - "When the call had a glob with a brace group, name that as the cause and suggest separate globs or a type filter"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GIN-03)"

- gap_id: G-04-2-GIN-04
  truth: "`stepSpendUsd` records the cap only for a step whose host started without finishing, and 0 with a note for a step that exited before any host start"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-04)"
  severity: minor
  test: 2
  root_cause: "stepSpendUsd sets floor = capUsd whenever costs.finished === 0, including a step that exited before any host started, so early failures consume the Phase 4 ceiling with spend that never happened"
  artifacts:
    - path: "scripts/eval-retrieval.ts"
      issue: "lines 863-867: floor applied when finished === 0 regardless of a host start"
  missing:
    - "Record the cap only when exit code is null or invocation.started was seen without finished; record 0 with a note otherwise"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GIN-04)"

- gap_id: G-04-2-GIN-05
  truth: "A reused pack item built by an older adapter format is treated as a miss and read again, so it carries current `untrusted` and `codeNode` flags"
  status: failed
  reason: "User reported: fix (04-REVIEW-GAPS.md GIN-05)"
  severity: minor
  test: 2
  root_cause: "request.reuse returns stored pack items without a read, and the reuse stamp (profile, accessScope) carries no adapter format version, so items built before WR-18/WR-19 keep missing untrusted/codeNode flags (intel printed unfenced, cited() drops graph code nodes)"
  artifacts:
    - path: "src/app/context.ts"
      issue: "lines 353-468: reuse without format check"
    - path: "src/app/derive-spec.ts"
      issue: "lines 39-48: cited() depends on codeNode"
  missing:
    - "Add a pack format version to the stamp and treat an older or absent format as a miss"
  debug_session: ".planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-REVIEW-GAPS.md (GIN-05)"
