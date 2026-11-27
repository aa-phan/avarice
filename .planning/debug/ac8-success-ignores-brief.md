---
status: diagnosed
trigger: "UAT gap G-04-3: AC-8 success ignores the brief (T01-B and T05-A judged successful while delivering unit tests only where their briefs also asked for e2e coverage; T01-B run says 'No E2E or browser test was written, as instructed')"
created: 2026-11-23T00:00:00Z
updated: 2026-11-23T00:00:00Z
goal: find_root_cause_only
symptoms_prefilled: true
---

## Current Focus

hypothesis: CONFIRMED. Two coupled causes (AND-gate: yes). (1) briefFor() appends a scope paragraph that forbids the e2e work the brief's own bullet asks for and tells the run not to stop; the host propagates it into its planner, plan-checker, executor and verifier prompts, so every GSD gate waves the gap through. (2) judgeClone() defines success as required checks pass AND the held-out unit test passes; nothing compares delivery with the brief, and the e2e spec is a denied read, no required check and not the held-out test.
test: done (code read, git history, 04-36 SUMMARY, run transcripts of T01-B, T05-A, run summaries of T01-A, T02-C, T05-B, T04-C)
expecting: n/a
next_action: return ROOT CAUSE FOUND to the caller (goal find_root_cause_only; no fix applied)
candidate_causes:
  - "code: eval-retrieval.ts:553 scope paragraph contradicts the brief bullet and tells the run to skip it"
  - "code: eval-retrieval.ts:610 success = checks && held-out; no brief-coverage input"
  - "config/data: eval-tasks.json successRule (D-07), deniedReads holds the e2e specs, single AC1 verifiedBy checks only, task set includes T01/T02/T05 whose briefs name e2e"
  - "environment: harness cannot run or judge e2e (no required check, command allowlist is the four npm run commands, spec denied)"
and_gate: "yes. A false success needs BOTH the instruction to skip (else the GSD verifier writes human_needed, the pre-12b5d19 behavior seen in diagnostic 2, and the run blocks) AND a judge that does not look at coverage (else the skipped bullet would be a partial). Each alone does not produce the symptom."
bug_class: Bohrbug (deterministic; same text in all 18 runs)

## Symptoms

expected: An AC-8 success means the run delivered what its brief asked; a run that skips part of the brief is not judged a full success, and the run instructions do not forbid work the brief requires.
actual: T01-B and T05-A judged successful while delivering unit tests only where their briefs also asked for e2e coverage. T01-B's own run summary says "No E2E or browser test was written, as instructed." T04-C matched its brief fully.
errors: none (silent over-count of success)
reproduction: Read evidence dirs .planning/phases/04-.../04-36-evidence/{T01-B,T04-C,T05-A}/ and rebuilt diffs at /Users/aphan/.claude-edu/jobs/5be29488/tmp/{T01-B,T04-C,T05-A}.diff against test/benchmark/phase4/eval-tasks.json briefs.
started: discovered during UAT 2026-11-23 (phase 4 eval plan 04-36)

## Eliminated

## Evidence

- timestamp: 2026-11-23 (investigation start)
  checked: grep "e2e|as instructed|browser" in scripts/eval-retrieval.ts, exit-run-phase4.sh, exit-run-phase4-tools.ts
  found: ONE hit, scripts/eval-retrieval.ts:553 inside briefFor(): `const scope = "Only the required checks can run in this environment: ${commands}. Any end-to-end or browser test named above is out of scope: do not write it, do not ask whether to cover it and do not stop for it. Make the change and its unit tests, run the required checks, and finish the rest of the change without waiting for an answer."` appended (line 554) to the commit message inside the "## Behavior" section, same for every task and arm.
  implication: the "as instructed" text is the harness's own brief scope paragraph; it is appended directly under the brief bullet that asks for e2e coverage, so the brief given to the run contradicts itself (bullet says add e2e, scope paragraph says do not write it).

- timestamp: 2026-11-23
  checked: git show 12b5d19 (2026-11-19) and 04-36-SUMMARY.md lines 112-113, 172
  found: scope paragraph was added deliberately in fix 12b5d19 "tell every unit which checks can run and that end-to-end work is out of scope" after diagnostic 2 (T01 arm B): unit finished source+unit test, GSD quick verifier could not verify the e2e bullet (spec is a denied read; `npm run test:e2e` is no required check) -> wrote status human_needed -> run opened an acceptance decision. Classified "the brief (harness)". Summary notes "T02 and T05 briefs ask for e2e work too."
  implication: the instruction conflict is a known, intentional trade made to stop human_needed stops; it was never reconciled with the success rule (see next entry), and the 04-36 SUMMARY records the owner spot-check as the human backstop.

- timestamp: 2026-11-23
  checked: test/benchmark/phase4/eval-tasks.json header (successRule) and tasks T01, T02, T05
  found: successRule = "A task succeeds when every required check passes at the end of the run and the held-out test, copied from the target commit after the agent finishes, passes. Reviewer judgment is a sampled owner spot-check, not a gate." T01 heldOut = tests/unit/motion-features.test.tsx; its e2e spec tests/e2e/motion.spec.ts is in deniedReads, not a check, not held-out. T05 heldOut = tests/unit/sections.test.tsx; e2e tests/e2e/content.spec.ts denied. Checks are typecheck/lint/format:check/test for every portfolio task. Briefs for T01, T02, T05 each carry an e2e bullet.
  implication: by task-set design (approved by owner 2026-11-16, D-07) brief coverage is outside the success definition; the e2e bullet cannot be reached by any check or held-out test.

- timestamp: 2026-11-23
  checked: scripts/eval-retrieval.ts judgeClone (586-611)
  found: success = checks.every(passed) && held.status === 'passed' (line 610). No input from the brief, the diff, a coverage comparison, or a model judge.
  implication: judge blind spot confirmed in code: a run that deletes/skips any brief part still passes if checks + held-out unit test pass.

- timestamp: 2026-11-23
  checked: T01-B run transcript (04-36-evidence/T01-B/transcripts/run-transcript-7b2eccc80069116c.txt), lines 28, 180, 190, 252, 317, 329 (1-based)
  found: the host's first move is to rewrite the brief for its planner (line 28): "- Add unit test coverage for the reduced-then-off case. (E2E/browser coverage is OUT OF SCOPE: do not plan, write, or ask about any end-to-end or browser test.)" (brief bullet was "Add unit and e2e coverage"). Plan-checker output (line 180): "E2E/browser: Not required. The plan explicitly excludes tests/e2e and Playwright." Executor action text (line 148/149): "Do not touch tests/e2e or any Playwright file, and add no browser or end-to-end test." Verifier prompt (line 252): "E2E and browser tests are OUT OF SCOPE: do not require them, and do not mark the task gaps_found or human_needed for their absence." Verifier result (line 317): "Per the instructions, E2E and browser coverage is out of scope and was not required." Final text (line 329): "No E2E or browser test was written, as instructed."
  implication: the "as instructed" chain is eval-retrieval.ts:553 -> contract intent.behavior -> unit prompt `Behavior:` (src/app/run-gsd-config.ts:138) -> host rewrite -> planner, checker, executor, verifier. Every GSD gate that could have flagged the missing e2e was told not to.

- timestamp: 2026-11-23
  checked: T05-A transcript (b3dfb11383b639b0) lines 35, 144, 196, 297 (1-based); run summaries of T01-A, T02-C, T05-B, T04-C
  found: T05-A planner prompt carries the original bullet "e2e density cases at pixel ratio 1 and 3" (line 35); plan-checker prompt says "e2e density cases are OUT OF SCOPE (must not be written, must not be asked about)" (line 144); executor "E2E / Playwright density tests are OUT OF SCOPE: do not write them, do not ask about them, do not stop for them" (line 196); verifier "E2E/Playwright density tests are OUT OF SCOPE and must not be required" (line 297). Run summaries: T01-A "No e2e or browser test was written, as you specified."; T02-C "The end-to-end cases are not written, as you asked."; T05-B "the device-pixel-ratio e2e cases ... are out of scope, as you specified." T04-C: no e2e in brief; diff has dates.ts, Education.tsx, tests/unit/dates.test.ts, tests/unit/education.test.tsx (matches the three brief bullets).
  implication: same chain in every run. Only T01, T02, T05 of the 20 tasks name e2e in the brief; 5 of the 10 recorded successes (T01-A, T01-B, T02-C, T05-A, T05-B) are runs of those tasks and all 5 omitted the e2e part. Not just the 2 spot-checked runs.

- timestamp: 2026-11-23
  checked: rebuilt diffs /Users/aphan/.claude-edu/jobs/5be29488/tmp/{T01-B,T04-C,T05-A}.diff (file lists)
  found: T01-B touches src/anim/MotionFeatures.tsx and tests/unit/motion-features.test.tsx; T05-A touches Experience.tsx, images.ts, tests/unit/experience-logo-sizes.test.tsx; neither touches tests/e2e/**.
  implication: symptom reproduced from the diffs.

- timestamp: 2026-11-23
  checked: eval-results.json runs; scripts/eval-retrieval.ts rejudge (378-411); ADR-015:54; STATE.md:432,514; 04-36-SUMMARY.md:113,172; 04-CONTEXT.md D-07; docs/operations-and-testing.md:153; 04-36-PLAN.md:25,144
  found: results store `success` as a boolean from judgeClone; rejudge() (04-50) re-reads those booleans (line 408-409), so the ADR-016 verdict inherits the blind spot. D-07 deliberately replaced "reviewer judgment" with checks + held-out test and made the owner spot-check "not a gate"; the proposal text (operations-and-testing.md:153) still says "matches the accepted change in reviewer judgment". The scope paragraph was classified "the brief (harness)" in 04-36-SUMMARY.md:113 and ADR-015:54 ("the brief asked for end-to-end work the harness cannot run") and "do not change the verdict"; no record says that runs of T01/T02/T05 now skip a brief bullet by instruction. Before 12b5d19, diagnostic 2 showed the GSD verifier did flag the missing e2e (human_needed -> blocked_on_decision). Related Phase 3 finding (STATE.md:432): a declared non-required check such as test:e2e is never run by the supervisor.
  implication: both halves are consistent with the owner-approved design (D-07, tasks file sha256 3de7b108... never edited), but the design never reconciled "success = what the brief asked" with a harness that cannot run e2e; the scope paragraph hid the conflict instead of surfacing it. If the five e2e-bearing successes were not counted, arm successes would be A 0, B 2, C 3 of 6 (recorded: 2, 4, 4); the token side of the ADR-016 verdict (B 94.4 percent of A) is unchanged.

## Resolution

root_cause: Two coupled causes. (1) Instruction conflict: scripts/eval-retrieval.ts:549-554 (briefFor, added in 12b5d19 after 04-36 diagnostic 2) appends to the brief's Behavior a paragraph saying any end-to-end or browser test "named above is out of scope: do not write it, do not ask whether to cover it and do not stop for it", directly under the brief bullet that asks for it. The host copies that exclusion into its planner, plan-checker, executor and verifier prompts and tells the verifier not to mark gaps_found or human_needed for its absence, so the run's own gates pass the gap ("as instructed"). (2) Judge blind spot: scripts/eval-retrieval.ts:610 sets success = every required check passed AND the held-out test passed (task-set successRule, D-07). The e2e specs are in deniedReads and are neither a required check nor the held-out test, the contract's only acceptance criterion (AC1, eval-retrieval.ts:564) is verifiedBy the four checks, and no step compares the diff or the run's summary with the brief's bullets. The rejudge for ADR-016 re-reads the recorded booleans. Both are needed for a false success (AND-gate), and both come from one design gap: tasks whose briefs name e2e work the harness cannot run or judge were kept in the set, and the harness resolved that by trimming the instruction, not the brief or the success definition.
fix: (not applied; find_root_cause_only)
verification: (not applicable)
files_changed: []
