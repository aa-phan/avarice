Reviewed: docs/system/processes.md sha256 6ecdfdca2ad59d430dc9b9d878362bbc80b811663d2fd41ba531b056773059d8 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 3 WARNING findings remain (two over-long sentences, one citation that does not support its claim, one host-refusal claim wider than the code). No BLOCKER.

BLOCKED: 3 WARNING findings remain (two over-long sentences, one citation that does not support its claim, one host-refusal claim wider than the code). No BLOCKER.

Reviewed: docs/system/processes.md, SHA-256 6ecdfdca2ad59d430dc9b9d878362bbc80b811663d2fd41ba531b056773059d8 (matches the dispatch digest). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce. Also read: diagrams/run-to-ready.puml, run-resume-after-kill.puml, run-discard-retry.puml and the Diagram index rows.
Severity: BLOCKER (cannot proceed), WARNING (fix; blocks this gate), OBS (worth noting).

## Findings

1. WARNING, confidence high. Sentence cap exceeded (hard maximum 35, style.md line 7), two sentences.
   - processes.md:23 (onboard step 7) "Map stage: unless the mode is skip, the invocation budget is reserved (one invocation unit, ... and the remaining cost), and the launch is recorded as started with a fresh session ID." is 46 words.
   - processes.md:24 (onboard step 8) "Launch assembly generates five inputs in a private directory, proves the launch checks, judges the launch line, and starts the host detached ... enforced by AVARICE." is 38 words and chains four actions.
   - Fix: split each at the comma chain (reservation sentence, then launch-record sentence; assembly sentence, then spawn sentence). Both are in the older onboard flow; the three run flows are within the cap.

2. WARNING, confidence high. Citation does not support the claim. processes.md:104 "Kills are tested at 24 points. A fault suite with a fake host kills the run supervisor at 24 named points ... ([coverage.md](coverage.md))". coverage.md has no fault suite, kill-point count or 24 (only the processes.md row at coverage.md:74 mentions the diagrams); runs.md:301 only names the mid-hand-off point.
   - Evidence: RUN_KILL_POINTS has exactly 24 entries (test/helpers/fault-run.ts:200-230: 9 + 7 + 8); the suite and "compare with an uninterrupted run" are test/fault/run-killpoints.test.ts:1-8.
   - Fix: drop the coverage.md link, or add the fault-suite row to coverage.md first and keep the link. Do not put the test path in prose.

3. WARNING, confidence medium. "Host refused to launch" is wider than the code. processes.md:84 "A host that refused to launch is never retried; it blocks with enforcement failure", and run-discard-retry.puml:20-21 (`else the host refused to launch` -> enforcement failure).
   - Evidence: any host error other than a timeout stops the retry (src/app/run-stages/item.ts:611, hostRefused = kind !== 'timeout'), but only `unavailable` or `denied` gives enforcement_failure (item.ts:639); any other host error blocks as a decision of class repeated_failure (item.ts:644-645).
   - Fix: "a host error other than a timeout is never retried; an unavailable or denying host blocks with enforcement failure, any other host error blocks with a decision", and change the diagram branch to match. Also the diagram puts this branch second; the code tests it after the loop-limit, budget, pause, denial and no-progress kinds (item.ts:584-610 before 611-617). Same effect in practice, but the doc's "fixed order" (line 83) and the drawing differ.

4. OBS, confidence medium. run-to-ready.puml:61-64 shows `reserve an invocation, launch step started (session ID)` before `alt a budget is spent ... host never called`. With a spent budget neither is written: the reservation is refused and returns before the launch step is recorded (src/app/invocation.ts:396-398 return, step recorded at 424-427). Doc line 54 is right. Fix: put the alt before the reserve-and-record message.

5. OBS, confidence medium. processes.md:72 and run-resume-after-kill.puml:57 say the attempt "is recorded as inconclusive". The reconcile records inconclusive only when no classify step exists; a unit already classified before the kill keeps its recorded kind (src/app/run-stages/item.ts:334-349), for example a crash whose supervisor died inside the discard. Fix: "recorded as inconclusive unless it was already classified".

6. OBS, confidence medium. processes.md:69 "names the interrupted attempt and step when an attempt was open". The step is printed whenever one is known, the attempt only when one is open (src/cli/commands/resume.ts:94). Fix: "names the interrupted step, and the attempt when one was open". runs.md:290 carries the same wording, so change both or neither.

7. OBS, confidence medium. Omissions that do not contradict the code. (a) run-to-ready.puml:51-52 shows only the host-enforcement branch at the enforcement check; the same action also blocks with reason decision and no decision record when the static G0 re-check fails (src/app/run-stages/prepare.ts:373-391). Doc line 53 is correct. (b) processes.md:86 (discard step 5) is the only run-flow step without a closing cross-link; add [runs.md](runs.md#discard-and-the-one-retry).

## Checked, not flagged
- Banned dashes (em, en, ` -- `) in the doc and the three .puml files: none. Headings sentence case. No phase, plan, ticket or threat IDs, no paths or function names in prose (the opening module list and the diagram index table carry the only paths, both exempt), no absolute home paths, secrets or transcript text, no changelog or last-updated field. The status banner matches the other drafted documents.
- All links and anchors in processes.md resolve (script-checked against heading slugs); the five .puml files exist; README rows 28 and 46 present. Drift anchors in the index exist.
- Start flow against src/app/run-start.ts, src/cli/commands/start.ts, src/cli/spawn-supervisor.ts, src/app/run-service.ts, prepare.ts, finish.ts: check order, exits 0/3/64/70, one transaction, temp file and rename, start:preflight and supervisor:spawn steps, detached supervisor, 250 ms poll, lease then contract rewrite then prelude then stage loop, six preparation actions with checkpoints and skip, baseline opens the first attempt, enforcement check blocks without a decision record, unit stage order, G2 order and commit with trailers, G4, create-only fetch, hand-off step and event, passed-G4 guard, lease release.
- Resume flow against src/app/run-resume.ts, src/cli/commands/resume.ts, supervise.ts, src/app/run-status.ts: stop-state report (exit 0 only at ready_for_review), live-lease refusal exit 3, fence, reap before mark or read, failed reap leaves rows started and records a failed resume:reconcile step with --wait exit 70, a host without reap still marks rows interrupted, orphan charged at once (cost allowed, no wall clock, no refund), pause only for a delegated item, moved-HEAD block, retry-already-used block, budget block, no-launch case leaves the retry unused, gated commit recognised by trailers, verifying path, mid-hand-off repeat, 180 s lease, status strings.
- Discard flow against item.ts, discard.ts, src/domain/outcome.ts, src/app/budget.ts:208: classification, moved HEAD first, killed unit charged at least the cost cap, budget check counting the killed charge, checkpoint with fence before restore, ignored paths untouched, only files or links removed (src/adapters/git/run-workspace.ts:113), moved-HEAD refusal, discard step with side effect none, retry without a second context-pack checkpoint, second failure names both attempts.
- Inbox claim (line 100): getInbox lists open decisions and ready-for-review runs only (run-status.ts:250-273), so an enforcement-check block shows nothing.
- Kill points: 24, mid-hand-off between fetch and record (fault-run.ts:200-230).
- Diagram index: five rows, one per source; "none committed" is true (diagrams/ holds only .puml). PlantUML read by eye (alt/else/end nesting, ->x, notes over two participants); not rendered or tool-checked, as the document says.
- Not re-verified in depth: the two older onboarding flows beyond the shared-module spots above (lease TTL, reap, orphan charge, hook charging); numbers they carry from config were not re-read. Not flagged: the "Things to look out for" bullets that cite leaf documents for onboarding-only facts.

## Instruction embedded in the document
None found.

## Version-control status after the run (porcelain)
?? .planning/config.json
?? .planning/milestone.lock
(both untracked and present before the run; nothing of mine; this report lives outside the repository)

## Answers

Applied: findings 1 to 3 and OBS 4 to 6 (the diagrams were edited to match: the host-error branch, the spent-budget branch before the reservation, and the already-classified attempt). OBS 7a (the diagram shows only the host branch at the enforcement check): left as is. The text at the enforcement step of the start flow carries both reasons, and the diagram is a summary. OBS 7b applied (a closing cross-link).
