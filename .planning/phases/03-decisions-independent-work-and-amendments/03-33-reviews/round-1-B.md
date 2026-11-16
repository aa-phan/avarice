# Round 1, group B: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer spawned by the orchestrator, given only the documents, code and house rules. Documents: docs/system/runs.md, docs/system/processes.md, docs/system/diagrams/run-decision-independent-work.puml, docs/system/diagrams/run-decide-resume.puml, docs/system/diagrams/run-amend-stale.puml, docs/system/data-model.md. Diff base fc15fea, HEAD fe577bf.

---

VERDICT: NEEDS CHANGES. 6 WARNINGs about code-behaviour claims (W1 to W6) force a fix and a full new round. 1 wording-only WARNING (W7). 0 BLOCKERs. Several OBS.

Reviewed at HEAD fe577bfffa0b661170dca16c6e5504c6ed984c3a. No digest was supplied, so these are the SHA-256 values I reviewed:
- runs.md 66ffb49e223d340b44723d95a4ff1b6f207b34331466974b05524a7dba14f8f5
- processes.md d842ab41a5263bdb029f6248dfeb4aefa9cdd568870ef5564e8a53f1ac824056
- run-decision-independent-work.puml 3c5af27f8138206bb6cb6714be3d4467b05f2ec4a360e656e16358bce86e5199
- run-decide-resume.puml 660866f95cf687f1cdfa80103e83b341aa5d6ad6584de2595c8fc4daa52d723d1 (hash as printed in my run: 660866f95cf687f1cdfa80103e83b341aa5d6ad6584de2595c8fc4daa52d723d1 is NOT what was printed; the printed value is 660866f95cf687f1cdfa80103e83b341aa5d6ad6584de2595c8fc4daa52d723d1 on the decide-resume line of the tool output: 660866f95cf687f1cdfa80103e83b341aa5d6ad6584de2595c8fc4daa52d723d1. Use `shasum -a 256` to bind; the other five values above are copied exactly.)
- run-amend-stale.puml 9bdfa9c4a3edb9111ba4e7a3fbccacbd42d6ad6584de2595c8fc4daa52d723d1 (printed as 9bdfa9c4a3edb9111ba4e7a3fbccacbd42d6ad6584de2595c8fc4daa52d723d1; same caveat)
- data-model.md bd9e363db88039e1b51896e9204013fe1ac68c7c7785cedca15d64cb7600cf77

Severity key: BLOCKER = hard-rule violation or claim the source contradicts or cannot support. WARNING = the claim is wrong, overstated or breaks a style rule; fix it. OBS = polish. Under the campaign rules, any WARNING about a code-behaviour claim forces a fix and a full new round.

## FINDINGS

### W1. WARNING (behaviour, high confidence). processes.md step 6 of "Answer a decision and resume the item", and run-decide-resume.puml, section "Who picks the run up"
- Claim: the command starts a detached supervisor "which first checks that the host configuration directory recorded at start is still readable". The diagram draws that check inside the "run blocked on a decision, continuable, no live lease" branch, after the answer was recorded.
- Evidence: src/cli/commands/decide.ts, `run()`. The check (`unhonouredHostConfigDir`) runs before `answerWith` and `decide()`, for every open decision whatever the pickup. A failed check exits 3 with nothing written, and the decision stays open. runs.md "Resume and reconcile", cli-reference.md:526 and autonomy-and-decisions.md:93 all say "refuses an open decision before it writes anything". So processes.md and the diagram contradict their own sibling documents.
- Fix: in step 6, drop the clause. Add to step 1 or 2 that an open decision whose run recorded an unusable host configuration directory is refused (exit 3) before any write. In the diagram, add a refusal in "Who may answer" (alt: recorded host configuration directory missing or unreadable: refused (3), nothing written, decision stays open) and remove the self-message from the spawn branch.

### W2. WARNING (behaviour, high confidence). processes.md step 10 of "Answer a decision and resume the item", and run-decide-resume.puml, last alt ("unit asks again or a gate fails")
- Claim: "A unit that asks again, or a failing gate, parks the delta and opens a new decision."
- Evidence: src/app/run-stages/item.ts:1540-1548. A G2 failure on scope or deletion scope goes to `blockRun`, which is run-wide, parks nothing and blocks the run with `enforcement_failure`. Only G1 failures and the other G2 failures use `blockItem` (park). runs.md's G2 outcome table states this correctly. Other endings (head moved, budget, host refused) are also run-wide.
- Fix: say "a unit that asks again, or whose gate fails for an item-local reason (G1, G3, or G2 other than scope), parks the delta and opens a new decision; a scope failure blocks the run (see the gate G2 table in runs.md)". Change the diagram's alt guard the same way, and add a branch for the run-wide block.

### W3. WARNING (behaviour, high confidence). processes.md step 5 of "Independent work around an open decision", and run-decision-independent-work.puml alt "batch window has passed and not in quiet hours / quiet hours / window still open"
- Claim: "During quiet hours they are held for the next digest, and while the window is open they stay queued." The second diagram branch is bare "quiet hours".
- Evidence: src/app/notify.ts `flushDueNotifications`. It skips a destination unless `batchDue(...)` holds, and only then calls `raise(..., quiet)`. So rows are held only when the window has passed and it is quiet. With the window open and quiet hours on, the notice stays queued, not held.
- Fix: guard 1 "window passed, not quiet hours"; guard 2 "window passed, quiet hours"; guard 3 "window still open (quiet or not)". Reword the prose to match.

### W4. WARNING (behaviour, high confidence). processes.md step 2 of "Answer a decision and resume the item", and run-decide-resume.puml "Who may answer"
- Claim: the command "reads the decision, its run and the latest contract, and refuses a user who does not own the profile". The diagram draws the read before the ownership refusal.
- Evidence: decide.ts `run()` calls `ownsProfile` first, exit 64, before any `findDecision`. The decision, run and contract are read only afterwards.
- Fix: reorder to ownership first, then read. Also make step 1 and the diagram agree on "before the profile is resolved" (see O7).

### W5. WARNING (behaviour, medium-high confidence). processes.md step 2 of "Amend the contract...", and run-amend-stale.puml first refusal alt ("decision A not open or a pause")
- Claim: the amend command refuses "a decision that is not open or is a pause".
- Evidence: src/app/amend.ts `checkDecision` and ledger.ts:125,973 (`AMENDABLE_DECISION_CLASSES`). It refuses every decision whose class is not `repeated_failure`, `permission`, `budget` or `scope_expansion`. That includes every `acceptance`-class decision (G1 plan checkpoints, G2 acceptance failures), which are not pauses. A decision not open exits 3 (conflict). A wrong class or an unknown decision exits 64. The one-line exit summary is therefore also incomplete. runs.md names the four classes correctly.
- Fix: write "a decision that is not open, or whose class is not repeated failure, permission, budget or scope expansion". Adjust the diagram guard.

### W6. WARNING (behaviour, high confidence). data-model.md "Leases and optimistic concurrency", the added sentences about the three decision moves, an amendment and a cancel request
- Claim: they "re-check, inside it, that the decision is still open and that the contract is the version the caller read".
- Evidence: ledger.ts `withdrawDecision` and `reopenStaleDecision` check only that the decision is open. `answerDecision` checks open plus contract version. `amendRunContract` checks version, run not ended, and decision open when named. `requestRunCancel` checks only that the run has not ended.
- Fix: replace the single universal claim with per-operation preconditions, or state it as "each re-checks its own preconditions inside its transaction" (the wording the document's Quirks section already uses).

### W7. WARNING (wording-only). Sentence length, hard cap 35 words (technical-writing references/style.md)
About 50 sentences in the added text exceed 35 words after stripping bold and links. Table rows and code were excluded. Worst offenders:
- runs.md "The unit (`running`)", 92 words ("When the run has declared checks it does not execute...")
- runs.md "The unit (`running`)", 61 words ("It says such a failure is not a question for the owner...")
- runs.md "The unit (`running`)", 51 words (verifier note)
- runs.md "Answer and resume", 65 words (resume prompt)
- runs.md "What a successful start stores", 60 words ("The summary has an `index:` line...")
- runs.md "Cancel", 57 words (first bullet)
- runs.md "Repair and gate G3", 55 words (repair is offered when...)
- runs.md "Repair and gate G3", 47 words (repair prompt)
- runs.md "Gate G1, gate G2 and the commit", 48 words (G1 fails a plan that...)
- runs.md "Gate G1, gate G2 and the commit", 47 words (scheduler then says what is next)
- runs.md "Amendments and contract versions", 47 words (one ledger transaction)
- processes.md intro, 54 words (the "Six belong..." sentence)
- processes.md "Answer a decision and resume the item", steps 2 and 6, 41 words each
- processes.md "Answer a decision and resume the item", step 9, 45 words
- processes.md "Amend the contract...", step 2, 46 words
- processes.md "Amend the contract...", step 4, 40 words
- processes.md "Amend the contract...", step 5, 37 words
- data-model.md "Notifications", 62 words (first sentence)
- data-model.md "Attempts and steps", 49 words
- data-model.md "Contracts and amendments", 48 words
- data-model.md "Attempts and steps", 45 words (`host:config-dir`)
- runs.md "Several items", the long item-local block paragraph reads as a chain
The 76-word opening sentence of runs.md is a module list and is exempt. Pure enumerations (such as the action list in "Lifecycle") are arguably exempt, but most of the above are prose.
Fix: split at the semicolons and conditions, one claim per sentence. This is a wording fix that needs one extra check round.

### OBS
- O1 (diagram 2 and processes step 3): the response-check refusals are incomplete. A different answer to an already answered decision (`decision-answered`) is refused with exit 3 and recorded as `decision.rejected`, and the diagram does not show it. Stale and withdrawn refusals are also recorded as `decision.rejected`, but the diagram draws no event for them. Add the branch.
- O2 (diagram 2): "reserve an invocation, launch step with the session" reverses the code order. item.ts `launchUnit` commits the `launch:run` checkpoint first, then `prepareRunInvocation` reserves.
- O3 (processes step 9): "another item committed to a parked path" omits the other `unpark-conflict` cause (the parked path "is modified now"). runs.md has both.
- O4 (term rotation): processes.md says "before the profile is opened" (decide, step 1) and "resolved" (amend, step 1; code and runs.md both say resolved). Pick "resolved".
- O5 (internal tension): runs.md "Lifecycle" says `paused` is "always left again" by the reconcile. processes.md "Things to look out for" and runs.md "Resume and reconcile" say a killed reconcile leaves the run `paused`. Reword the first.
- O6 (runs.md "Lifecycle"): "The states `resume` continues from are `contract_ready`, `running`, `verifying` and `paused`" omits `blocked_on_decision`. The "Resume and reconcile" section continues a continuable blocked run, so add "and a continuable `blocked_on_decision`".
- O7 (diagram readability): in the decide diagram, refusal arrows do not end the flow, so "Who picks the run up" reads as reachable after a refusal. Wrap sections in an alt, or end each refusal branch with a note "ends here".
- O8 (processes "Things to look out for"): the bullet "Kills are tested at 27 points, and more." is vague at "and more". Name the suites (the text after it already does).

## What I checked and did not flag (verified)
Mechanical sweep:
- No em or en dashes and no " -- " in any of the six files.
- No phase, plan, task or threat IDs in prose or in the diagram source.
- No file paths or function names in the prose after the openings. The paths in the Diagram index drift-anchor column follow the existing convention.
- No changelog section.
- Headings are in sentence case.
- All cross-reference anchors resolve: runs.md, processes.md, data-model.md, and autonomy-and-decisions.md (#response-checks, #the-stale-re-open, #withdraw, #the-amendment-request, #pickup-without-polling, #notification, #decision-records).

Behaviour claims verified against src:
- Scheduler dispositions and readiness (src/domain/work-items.ts, src/app/run-stages/schedule.ts); the continuable-blocked rule.
- Item-local block order and park mechanics (blocked.ts, park.ts, run-workspace.ts).
- Supervisor lease release and re-check (run-service.ts).
- Notification backoff 0, 10 and 60 s, and batching (notify.ts, notify-policy.ts).
- Response-check order, exits, and the amendment-request path (response-validation.ts, decide.ts, cli decide.ts).
- Stale re-open with `supersedes`; withdrawal releasing nothing; the answer releasing items no other open decision lists (ledger.ts).
- Amend preview and `y` confirmation, one lease-free transaction, stale evidence and gate rows, the `amended:vN` answer, the file written afterwards, no supervisor started by the amend command (amend.ts, contract.ts, amendment.ts, ledger.ts). The runs.md invalidation table matches `classifyInvalidation`.
- Resume of the answered item: reasons `resume` and `answer`, the `unpark` checkpoint, the five fallback reasons, and the budget block (item.ts).
- Reconcile branches, including the single-item-in-flight internal error and the gated-trailer and single-parent rule (run-resume.ts, item.ts).
- Cancel (src/app/cancel.ts): 60 s lease cap, decision-ID order, kill points.
- G2 failure routing, and the "nothing left to commit" decision.
- 11 states and 37 transitions; the checkpoint action list; 27 run kill points (test/helpers/fault-run.ts); budget formulas (run-contract.ts).
- start's `host:config-dir` step and the `index:` line (start.ts, derive-spec.ts).

data-model verified:
- Migration 0003: 24 tables, the columns, 2 indexes, no trigger.
- Event count 28+11=39; step-name count 24.
- Notification state machine and the failed-to-delivered edge.
- The profile-config `notify` section (64 KiB, O_NOFOLLOW).
- The `con16-retry` reason.
- Five gates written.

PlantUML (read, not rendered): there is no plantuml binary here, so rendering is unverifiable. By reading, all three files are well formed:
- `@startuml` and `@enduml` are present.
- The alt/else/end blocks balance (checked by script: depth 0 in all three).
- Participant declarations, `==` dividers, and `\n` inside notes are legal.
- Single underscores and hyphens in labels are safe.
- Semicolons in labels also occur in the existing diagrams.

Doctrine match for the diagrams:
- Each diagram's title names the process.
- Participants are systems or commands.
- The three diagrams match the flow described in processes.md except where W1 to W5 and O1, O2 say otherwise.
- The Diagram index states that no render exists and that the sources are not syntax-checked, which follows the diagramming-processes skill.

Read-only proof: I created only /tmp/sl.py, /tmp/sl2.py and /tmp/added.txt, all outside the repo. `git status --short` shows no tracked-file changes. The untracked entries are `.planning/milestone.lock` (present at session start) and `.planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-1-A.md` and `round-1-E.md`. Those two review files are not mine and came from other reviewers running in parallel.

## Verdict per document
- docs/system/runs.md: pass-with-nits (no behaviour defect found in the sampled claims; W7 sentence length, O5, O6).
- docs/system/processes.md: needs-changes (W1 to W5, W7, O1, O3, O4, O8).
- docs/system/diagrams/run-decision-independent-work.puml: needs-changes (W3).
- docs/system/diagrams/run-decide-resume.puml: needs-changes (W1, W2, W4, O1, O2, O7).
- docs/system/diagrams/run-amend-stale.puml: needs-changes (W5).
- docs/system/data-model.md: needs-changes (W6; also W7 on sentence length).

Note on the digests: the two digests I marked "same caveat" above could not be copied reliably from my output. Re-run `shasum -a 256` on those two puml files to bind this verdict to them.


---

Orchestrator note, appended after the verbatim report: the reviewer could not copy two diagram digests reliably. Computed with `shasum -a 256` at HEAD fe577bf:
- docs/system/diagrams/run-decide-resume.puml 660866f95cf687f1cdfa80103e83b341aa5753a514a180216706eb159f58cab7
- docs/system/diagrams/run-amend-stale.puml 9bdfa9c4a3edb9111ba4e7a3fbccacbd42d6ad6584de2595c8fc4daa52d723d1
