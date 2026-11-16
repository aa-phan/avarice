# Round 3, group B: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It read the round 2 report only after its own review. Documents: processes.md, run-decide-resume.puml, run-decision-independent-work.puml, runs.md (G2 table). Working tree at HEAD 13a7267.

---

VERDICT: PASS. There is no BLOCKER and no WARNING. One OBS remains. Reviewed at HEAD 13a7267. Round 2 F1 and F2 are resolved, and every WARNING and OBS in round-2-B.md is resolved.

SHA-256 reviewed:
- docs/system/processes.md 7f9308cf90cab7411e2b872ef4d5a44ec31994278b51e329c06ca64815b50935
- docs/system/diagrams/run-decide-resume.puml cb44ff511f9d527c979b5af13d088eb08ebefae7156b9f4c6db31a0441b6d78e
- docs/system/diagrams/run-decision-independent-work.puml cdc59b07c85897ddeeafad776e29a5bc02908907e788e76dcccda86791281e46
- docs/system/runs.md a37d3f4230f4ed831f29d2e7233e2cf2498c878f7bb34a4cec1ba67e7408f39b

FINDINGS (most severe first)

1. OBS (confidence medium). Document: processes.md. Location: "Answer a decision and resume the item" opening, "The command exits 0 for an answer, a withdrawal or a repeat", and the diagram's closing line "exit 0 (answered or withdrawn)".
   - Claim: the exit is always 0 for an answer or a withdrawal.
   - Evidence: when pickup is `spawn`, src/cli/commands/decide.ts:startSupervisor (about lines 95-117) returns 70 on a refused spawn or an unrecorded step.
   - With `--wait` it returns 0 only when the run reaches `ready_for_review`, otherwise 3.
   - Fix: add "(with `--wait`, the exit follows the run)", or point to cli-reference.md.
   - Does not block.

CHECKED AND NOT FLAGGED

Decide flow, against src/cli/commands/decide.ts, src/app/decide.ts and src/domain/response-validation.ts:
- Refusals before the profile is resolved (AVARICE_RUN, no terminal on both streams, run process tree) exit 64 (src/cli/identity.ts:24-28).
- The ownership refusal exits 64 and comes first (decide.ts:197-200 in the CLI).
- findDecision runs next, then the host-directory refusal for an open decision with exit 3 (CLI :201-208). Nothing is written. The latest contract is read afterwards (src/app/decide.ts:109). Step 2 and the diagram's nested alt match this order.
- Response-check order is open (stale, withdrawn, not open), then option or text, then duplicate or different answer, then withdraw, then digest, then apply (response-validation.ts:95-116).
  - In the diagram, the amend-only branch sits before "option not listed". It is recorded as `amendment.requested` with exit 3 (src/app/decide.ts:135-139).
  - The withdraw branch now sits above "state moved", which matches response-validation.ts:111-115. This resolves F1.
  - The stale re-open is `reopenStaleDecision`, with exit 3 and the successor named (src/app/decide.ts:157-181). Rejections record the check name only.
- Pickup follows src/app/decide.ts:73-85.
  - A blocked run that is continuable and has a live lease gives live-supervisor. Without a live lease it gives spawn. Blocked and not continuable gives none.
  - A non-stopped run with a live lease gives live-supervisor. Otherwise none.
  - The new alt guard "not blocked or is continuable" is correct.
  - The `supervisor:decide` step is recorded as the diagram says.
- Judging branches (src/app/run-stages/item.ts:1090-1200 and 1500-1560):
  - G1, G3, a repeated ask and G2 other than scope park the item.
  - G2 scope or deletion scope, a moved HEAD, a spent budget and a host refusal block the run.

Independent work:
- Park order, decision for the item and its dependents, attempt ended blocked, notice queued, item blocked, then moveOn (src/app/run-stages/blocked.ts:266-330).
- The batch flush runs at the item boundary before moveOn (src/app/run-stages/item.ts:1928-1933).
- flushDueNotifications (src/app/notify.ts:194-218) gives these cases:
  - window passed and not quiet: one banner;
  - window passed and quiet: held;
  - window open: stays queued.
- Backoff is 0, 10 and 60 seconds, and a delivery failure never changes the run.
- The stop banner comes from notifyRunStop (src/app/notify.ts:104-136, called at src/cli/commands/supervise.ts:66) with raise(..., quiet) holding the rows in quiet hours. The new quiet/not-quiet alt and the step 6 wording are correct. This resolves F2.
- Release lease, re-read, and continue in the same process when an answer made an item ready (src/app/run-service.ts:87-115).
- The `undeliverable` ending moves the run to `failed` with undelivered items and withdrawn decisions named (blocked.ts:226-234).

runs.md G2 table (lines 304-312), against item.ts:1500-1560 and src/domain/decision-policy.ts:
- Scope or deletion scope is run-wide: enforcement_failure, class permission, finding capped at ten paths (blocked.ts MAX_FINDING_PATHS = 10).
- A checks-only failure where every blocking check regressed is offered a repair first.
- Checks-only otherwise gives an item-local repeated_failure decision.
- Anything else in a non-repair unit is a pause signal, which classifies as acceptance (humanDecision).
- Anything else in a repair unit is a repeated-failure signal, so repeated_failure.
- The new repair-unit row is correct and the table is complete.

Mechanical sweep:
- No em dash, en dash or ` -- ` in processes.md or the two .puml files.
- No prose sentence over 35 words in processes.md, by script. Table rows and code are excluded.
- Headings are sentence case.
- Paths appear only in the opening and in the Diagram index drift anchors. No function names, phase numbers, plan IDs or threat IDs appear in prose or in diagram source.
- The runs.md edit removed "in practice".

PlantUML, read and not rendered:
- Both files have @startuml and @enduml.
- Every alt/else/end balances, including the nested alts, by reading and by counting.
- Participants are declared, and the `==` dividers and `note over A, B` forms are legal.
- Edges use step and event names. Titles name the process.
- Branch order expresses the code's precedence.
- Each diagram matches its section of processes.md.

Round-2-B disposition, each item verified against the current text:
- F1 (withdraw drawn as stale): RESOLVED. The withdraw branch is above the stale branch, and step 4 states the exception.
- F2 (stop banner always sent): RESOLVED. The diagram and step 6 split by quiet hours.
- O1 (data-model sentences over 35 words): RESOLVED. The three sentences are split and a script finds no sentence over 35 words. data-model.md is outside group B.
- O2 ("in practice" in runs.md): RESOLVED.
- O3 (host-directory refusal placed before reading the decision): RESOLVED. Step 2 and the diagram read the decision first.
- O4 (first-alt refusals not visibly ending): RESOLVED. The note says "every refusal above, in both sections".
- O5 (pickup alt): RESOLVED.
  - The branch guards are exact.
  - The duplicate "exit 0, nothing started" is gone.
  - The closing line reads "exit 0 (answered or withdrawn)".
  - The third branch lists a blocked run with decisions still open. A blocked run that is not continuable for another reason is not named there, but this is cosmetic.

Per document:
- docs/system/processes.md: pass-with-nits (the one OBS).
- docs/system/diagrams/run-decide-resume.puml: pass-with-nits (the exit-0 line in the OBS).
- docs/system/diagrams/run-decision-independent-work.puml: pass.
- docs/system/runs.md (G2 table only): pass.

Read-only proof: I created no files and edited nothing. `git status --short` at the end shows only `.planning/milestone.lock` and the untracked review files `round-3-C.md` and `round-3-D.md`, which I did not create. Two of my Bash calls (an awk balance check and a git-status chain) were refused by the sandbox before running. I re-ran the balance check and `git status` as plain commands.
