# Round 2, group B: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the documents, the code and the house rules. It read the round 1 report only after its own review. Documents: runs.md, processes.md, the three diagrams, data-model.md. Working tree at HEAD 3e5e7d6.

---

VERDICT: NEEDS CHANGES. Two WARNINGs about code-behaviour claims (F1, F2) force another round. There are no BLOCKERs. I reviewed the working tree at HEAD 3e5e7d6.

Severity key: BLOCKER = hard-rule violation, or a claim the code contradicts. WARNING = a claim that is wrong or overstated. OBS = polish. Under the round rules, any behaviour WARNING forces another round.

## SHA-256 of what I reviewed
- docs/system/runs.md b5d11f89ef970c517349db333f7186bbc280290b2a6582d91bb9af271bb4bd0f
- docs/system/processes.md 742b6719ee75c6f9de5046721434843b9b291394acaffdd252ff328b7a66b90b
- docs/system/diagrams/run-decision-independent-work.puml 13cce6fc174a4646c0609fffeb75a6099de2cac9788af37d5cb3196a18fb2bd9
- docs/system/diagrams/run-decide-resume.puml 7a93e7a0ad7ae6fff406179a3672044bc3462f234e8f75d162ff23871e8c8fed
- docs/system/diagrams/run-amend-stale.puml 3a8880980584289a48d005f80479c80214f450b2cd4c3a1cbd64b6b822de3543
- docs/system/data-model.md 9be9d8b39a62adadf7fa84559c885bc4e94ec67ef55bc7374ef98c7a83ef88b8

## FINDINGS, most severe first

### F1. WARNING (behaviour, high confidence). A withdraw on a moved state is drawn as stale
- Locations: docs/system/diagrams/run-decide-resume.puml lines 42-48, and docs/system/processes.md "Answer a decision and resume the item" step 4.
- Claim in the diagram: the `alt` tests `else state moved since the question` before `else withdraw`.
  - An `alt` reads top to bottom, so a withdraw on a moved state falls into the "old decision stale, answer not applied (3)" branch.
- Claim in step 4: "When the state moved since the question was asked, the answer is not applied." It carries no withdraw exception.
- Evidence: src/domain/response-validation.ts:111 returns `apply` for `kind === 'withdraw'` before the digest comparison at :113-115. The file header (:9-10) says a withdraw "is applied whatever the digest says".
  - src/app/decide.ts:183-189 withdraws without re-opening.
  - The amend diagram's last note (run-amend-stale.puml:52) and processes.md amend step 7 state the exception correctly. The decide flow contradicts them.
- Fix:
  - In the diagram, move the `withdraw` branch above `state moved since the question`, or guard the stale branch with "not a withdraw".
  - In step 4, add "A withdrawal is applied whatever the digest says."

### F2. WARNING (behaviour, medium-high confidence). The stop banner is drawn as always delivered
- Locations: docs/system/diagrams/run-decision-independent-work.puml lines 53-55 (`else none` branch: `Supervisor -> Banner : one banner covering every queued notice`), and docs/system/processes.md "Independent work around an open decision" step 6 ("Otherwise one banner covers every queued notice and the supervisor exits").
- Claim: on a blocked stop, one banner goes out for every queued notice.
- Evidence:
  - src/app/notify.ts:102-129 (`notifyRunStop`, called from src/cli/commands/supervise.ts:66) computes `quiet`.
  - It calls `raise(..., quiet)`, and src/app/notify.ts:150-160 holds the rows instead of delivering when `quiet` is true.
  - So in quiet hours the stop sends no banner and the rows are held for the digest.
  - Step 5 of the same section and the diagram's item-boundary branch already draw this quiet-hours split. The stop is drawn without it.
- Fix:
  - In the diagram, split the branch: "not quiet hours: one banner covering every queued notice"; "quiet hours: queued notices held for the next digest".
  - In step 6, add "(held for the next digest in quiet hours)".

### OBS (do not block; one is wording, the rest polish)
- O1. data-model.md lines 152, 229 and 305 hold sentences of 36, 36 and 44 words, over the 35-word cap. These lines are not in the diff; they were already there. Split them when next touched.
- O2. runs.md:460 (an added line) says "is final in practice". "In practice" is filler per style.md. Write "A run blocked for any reason but `decision` is final."
- O3. Order of reads in `decide`. src/cli/commands/decide.ts:197-208 checks the profile owner, then calls `findDecision`, then checks the host configuration directory.
  - processes.md step 2 and the diagram place the host-directory refusal before "reads the decision".
  - Nothing is written either way, so behaviour is unaffected. For exactness, say "reads the decision to find its run, then refuses...".
- O4. In run-decide-resume.puml, the first `alt` ("Who may answer") refusals do not visibly end the flow.
  - The note at line 50 says "every other branch above ends with its message", which covers the second `alt`.
  - Add one sentence to the note that the refusals in the first section also end there, or wrap the later sections in the `else not refused` branch.
- O5. Pickup `alt` in run-decide-resume.puml.
  - A blocked run that is not continuable but holds a live lease gets pickup `none` (src/app/decide.ts:77-81). The first branch ("a supervisor holds a live lease") draws "takes the answered item next".
  - After "nothing continuable" the diagram draws both "exit 0, nothing started" and "answered (0)", and a withdraw prints "withdrawn". Both are cosmetic.

## Behaviour claims checked (verified unless marked)
- decide command and application (src/cli/commands/decide.ts, src/app/decide.ts, src/domain/response-validation.ts):
  - Refusal before the profile is resolved (run, terminal, run tree): verified, exit 64.
  - Profile ownership: verified, exit 64, checked before any read of the decision.
  - Recorded host configuration directory missing or unreadable on an open decision: verified, exit 3, nothing written.
  - Order of the response checks (open, option, duplicate, digest): verified.
  - Stale, withdrawn and different-answer refusals: verified, exit 3 (`rejectedExit`) and recorded as `decision.rejected` with the check name only.
  - Unlisted option or text: verified, exit 64.
  - Amend-only record answered with a key: verified. It records `amendment.requested` only, prints the amend command, exit 3.
  - Same answer to an answered decision: verified, ignored, exit 0, `decision.duplicate`.
  - Stale re-open with `supersedes`: verified (`reopenStaleDecision`).
  - Answer transaction: verified. The answer and the release of items that no other open decision lists happen in one transaction.
  - Withdrawal releases nothing: verified.
  - Pickup rules: verified. `spawn` needs a continuable blocked run with no live lease, and records the `supervisor:decide` step. Otherwise a live lease gives `live-supervisor`, else none.
- Continuable rule (src/app/run-stages/schedule.ts, src/domain/work-items.ts, src/app/run-service.ts):
  - Needs reason `decision`, a block from `running` or `paused`, and an item ready or no open decision.
  - The supervisor releases the lease and re-reads; the pickup moves `blocked_on_decision` to `running`. All verified.
- Answered item (src/app/run-stages/item.ts):
  - `resume` versus `answer` attempt reason and the `firstUse`/`fellBack` gating: verified.
  - Order: snapshot, `unpark` checkpoint, unpark, then `launch:run` checkpoint, then the invocation reservation, then the park-ref drop, then the host. Verified.
  - The four fallback causes (`unpark-conflict` with both causes, `park-missing`, `session-gone`, `crashed`): verified.
  - Budget check applies only to the `session-gone` and `crashed` fallbacks: verified.
  - Resume prompt does not repeat the question: verified (src/app/run-gsd-config.ts:212-225).
- Judging (item.ts 1110-1197, 1540-1560, 1563-1580):
  - G2 scope or deletion scope is run-wide (`blockRun`, `enforcement_failure`); other G2 failures, G1, G3 and a repeated ask park the item.
  - Moved HEAD, spent budget and host refusal are run-wide. All verified.
- Independent work (src/app/run-stages/blocked.ts, item.ts):
  - Order of the item-local block: park step, decision for the item and dependents, attempt ends blocked, notice queued, item blocked, then `moveOn`. Verified.
  - `running` to `running` for the next item, and the blocked, `undeliverable` and all-done endings: verified.
  - Item-boundary flush: the window has passed and not quiet gives one banner. The window has passed and quiet holds. The window open stays queued. Backoff is 0, 10 and 60 s. All verified (`flushDueNotifications`, `deliverWithBackoff`).
- Amend (src/app/amend.ts, src/cli/commands/contract.ts, ledger `amendRunContract`):
  - Refusals: run failed, cancelled or closed (conflict, exit 3); decision unknown or of a wrong class (invalid, exit 64); decision not open (conflict, exit 3). Verified.
  - Allowed classes `repeated_failure`, `permission`, `budget`, `scope_expansion`: verified.
  - Preview, then `y` or `yes`; otherwise "not amended", exit 0: verified.
  - One lease-free transaction: version, diff, limits, stale rows, decision answered as `amended:vN`, items released. It checks version, run not ended, decision still open. Verified.
  - Contract file written afterwards: verified.
  - The amend command starts no supervisor; the `decide` amend chain checks the pickup (decide.ts:169): verified.
  - Budgets "above zero, no upper bound" (src/domain/amendment.ts:131-142); `--check +name` adds the command (:232-243): verified.
- runs.md "Resume and reconcile", `start` and `supervise` host-directory claims:
  - `start` records `host:config-dir` before spawning and exits 70 on failure.
  - `resume` refuses with exit 3 before spawning.
  - `supervise` run by hand under a different directory exits 70.
  - All verified.
- data-model.md:
  - The ledger claim in the section "Leases and optimistic concurrency" now states per-operation preconditions, and each is verified against `withdrawDecision`, `reopenStaleDecision`, `answerDecision`, `amendRunContract` and `requestRunCancel`.
  - Migration 0003: one table plus three columns, `item_id`, `supersedes`, `cancel_requested_at/by`, with two indexes: verified. The total of 24 tables is verified (20+3+1).
  - Event table has 39 rows: verified by count.
- 27 run kill points: verified (test/helpers/fault-run.ts `RUN_KILL_POINTS`). The park, resume-session and cancel suites exist in test/fault.

## Mechanical sweep
- No em dash, en dash or ` -- ` in any of the six files.
- No phase, plan, task or threat IDs in prose or in diagram source.
- File paths appear only in the openings of runs.md and data-model.md, and in the opening and Diagram index of processes.md. The camelCase tokens in runs.md and data-model.md are contract and budget field names, not function names.
- Headings are in sentence case. All cross-reference anchors resolve, including the seven autonomy-and-decisions.md anchors.
- Sentence length: with bold, links and table rows stripped, no prose sentence in runs.md or processes.md exceeds 35 words, except the exempt 76-word module list in the runs.md opening. In data-model.md three sentences are over the cap, and all three are pre-existing (O1). The splitter is a heuristic, so this is a sweep, not a proof.
- Banned vocabulary scan: only O2 found.
- PlantUML (read, not rendered; there is no render step): all three files have `@startuml` and `@enduml`, and their `alt`/`else`/`end` blocks balance at depth 0 by script. Participants are declared, and `==` dividers and `\n` in notes are legal.
  - The titles name the process, and the participants are systems and commands.
  - Edges use step names and event names (ledger data), not function names.
  - The Diagram index says the sources are neither rendered nor syntax-checked.

## Round 1 WARNINGs
- W1 (host configuration directory check misplaced): RESOLVED. The diagram now shows it as a refusal in "Who may answer" (exit 3, nothing written, decision stays open). Step 6 no longer mentions it, and step 2 states the refusal. The wording matches src/cli/commands/decide.ts:197-208.
- W2 (a failing gate always parks): RESOLVED. The prose and the diagram name the item-local gate failures and the run-wide scope, HEAD, budget and host cases, matching item.ts:1540-1556.
- W3 (quiet hours versus the open window): RESOLVED. The three guards and the prose now match `flushDueNotifications`. F2 is a separate omission at the stop banner.
- W4 (ownership check placed after the read): RESOLVED. The ownership refusal now comes first. O3 remains as a small ordering nit.
- W5 (amend refuses "not open or a pause"): RESOLVED. The text now says "not open or whose class is not repeated failure, permission, budget or scope expansion", in both the prose and the diagram guard.
- W6 (universal re-check claim in data-model.md): RESOLVED. The per-operation preconditions are stated and verified.
- W7 (sentence length, wording only): RESOLVED for the changed text. Only the pre-existing O1 sentences remain.
- Round 1 OBS O1 to O8 are also fixed, apart from the residue noted in O3 and O4 above.

## Read-only proof
I changed no file. The only files I created are /tmp/slen.py and /tmp/slen.py.bak, outside the repo. `git status --short` shows only `.planning/milestone.lock` and the untracked review files `round-2-A.md`, `round-2-D.md` and `round-2-E.md`. I did not create those review files; they come from other reviewers.

## Verdict per document
- docs/system/runs.md: pass-with-nits (O2).
- docs/system/processes.md: needs-changes (F1 step 4, F2 step 6; O3).
- docs/system/diagrams/run-decision-independent-work.puml: needs-changes (F2).
- docs/system/diagrams/run-decide-resume.puml: needs-changes (F1; O4, O5).
- docs/system/diagrams/run-amend-stale.puml: pass.
- docs/system/data-model.md: pass-with-nits (O1, on pre-existing lines).
