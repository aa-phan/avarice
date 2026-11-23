ROUND 5 (SCOPED) REVIEW

Header
- Round: 5, scoped to two diffs.
- Scope 1 range: 86e32584b268af9a1e9235888385a37418a830a3..3b36b23bd1288c25053a6af1b292c77c34bb8cef, docs/system/unknowns.md
- Scope 2 range: f19ae4e..1987922, docs/system/processes.md
- Reviewer: fresh. I did not open 04-54-reviews/.
- Date: 2026-11-23
- HEAD at review: c1279bbc2a824d9beb8295c0dfdc3155ac7f73df
- sha256 as read, from `shasum -a 256` output:
  - 6c5214972cc51a5fa7aff71b8a603f7e49d2bb49e689d13623e7df8b8be8e3c5  docs/system/unknowns.md (matches the expected digest)
  - d077412b7e07c90ab09e0deeb2970b909fb4885eec0f74b1c22fde6b0b758ede  docs/system/processes.md (matches the expected digest)
- Severity scale: BLOCKER is a factual error against code or evidence. WARNING is a misleading or unsupported claim, a contradiction, or a doctrine violation. NIT is polish. OBS is an observation outside scope.

SCOPE 1 (group C, unknowns.md, "From containment", lines 59 and 63)

Findings: none at BLOCKER or WARNING. One NIT.

Evidence checked against the repo:
- live-run-phase4.jsonl has 32 lines.
  - Line 24 is case `p4-restricted-run`, verdict PASS, claudeVersion "2.1.326 (Claude Code)", state `blocked_on_decision`, `writesOutsideClone: []`, artifacts `["restricted-plan","restricted-patch","restricted-decisions"]`. This supports "PASS on host 2.1.326", "ended blocked on a decision", "three restricted artifacts stored" and "nothing written outside the clone".
  - Lines 25, 26 and 27 are `p4-restricted-onboarding`, verdict FAIL.
  - Line 32 is `p4-restricted-onboarding`, verdict PASS, and it comes after the FAILs.
  - These are the only `p4-restricted*` records in the file, so "records at 25-27 and :32" is complete.
- LIVE-CASES.md:573 is the `p4-restricted-run` row (PASS, blocked_on_decision, three artifacts stored, checkout unchanged). LIVE-CASES.md:574 is the `p4-restricted-onboarding` row ("FAIL, FAIL (stopped, D-04)"). Both line numbers are correct. The test file `test/containment/live-run-phase4.test.ts` contains a `live p4-restricted-run` test at line 107.
- Internal consistency:
  - Line 59 says only the `p4-restricted-run` record and the `p4-restricted-onboarding` row and records were read, and it cites 24, 573, 574, 25-27 and 32.
  - Line 63 cites the same set and nothing more.
  - The old contradicting bullet ("evidence files ... were not read, apart from ...") is gone.
  - No bullet says less was read than another cites.
  - Line 63 does not overstate the reading. It cites record 32 only as "a later record ... is a PASS" and does not describe it further.
  - The other `containment` mentions in unknowns.md (line 45) are about the `containment.finding` check, not test records.
  - No other docs/system file besides findings.md cites the jsonl or LIVE-CASES. findings.md was not in scope and I did not check it.
- Doctrine on the changed lines: no em dash, en dash or " -- " (grep found none). The longest changed sentence has about 29 words, under the 35 cap. Links and paths resolve, and file paths are allowed in unknowns.md.

NIT 1 (confidence medium)
- unknowns.md:63: "The neighboring `p4-restricted-onboarding` case did not pass (...), and a later record at `:32` is a PASS."
- Problem: "did not pass" reads as the case's standing result. The later PASS shows that is not so. The row at LIVE-CASES.md:574 is the first-epoch table, and the case's final recorded state is PASS. I saw that at LIVE-CASES.md:652 and 654, which are outside the cited lines. The sentence is accurate but could mislead a skimmer.
- Fix: "failed in its first three recorded attempts (... :25-27) and has a later PASS record (:32)".
- Not blocking.

SCOPE 2 (group A, processes.md:174, approve-a-privileged-action drift anchor)

Findings: none at BLOCKER or WARNING.

Evidence:
- Existence: `src/hook/pre-tool-use.ts`, `src/domain/privileged-commands.ts`, `src/cli/commands/approve.ts`, `src/adapters/sqlite/approval-rows.ts` and `src/adapters/sqlite/ledger.ts` all exist. `diagrams/approve-privileged-action.puml` exists, so the link resolves.
- The new list covers the modules the diagram describes:
  - pre-tool-use.ts imports `classifyLine`, `privilegedReason`, `consumeApprovalRow` and `pendingRequestId`. It holds the take-all-or-none logic.
  - privileged-commands.ts holds the classification, the unparseable and unapprovable rules, and the denial text.
  - approve.ts holds the 64, 3 and 0 exits, the revoke path, and calls to `ledger.findApprovalRequest`, `grantApproval` and `revokeApproval`.
  - approval-rows.ts holds `consumeApprovalRow` and `pendingRequestId` ("the waiting one again, else a new one").
  - ledger.ts holds the approval operations.
- The removal of `src/app/authorize.ts` is correct:
  - Neither the hook nor approve.ts imports it.
  - Its only callers are src/app/stages/promote.ts, run-resume.ts and resume.ts, which cover onboarding promotion and resume reconciliation, not the flow in the diagram.
  - processes.md does not mention it.
- Doctrine: no banned dashes on line 174 (the changed line). The line is a table row, exempt from the sentence cap.

OBS (outside the diff's strict question, no action required)
- OBS 1 (confidence medium), processes.md:174: the anchor omits two modules that own diagram facts. `src/domain/approval.ts` holds `APPROVAL_TTL_MS` (30 minutes), which the diagram states three times. `src/cli/identity.ts` holds `refuseOutsideTerminal` and `ownsProfile`, which decide the "refused (64)" branch for non-terminal, run process tree and wrong user. A change to either would make the diagram stale without prompting a check. Other anchor cells are of similar granularity, so this is optional. Adding both would make the list complete.
- OBS 2, processes.md:176: "The drift anchor names the source whose change should prompt a check of the diagram against the code." is unchanged and fine.
- OBS 3, LIVE-CASES.md:574 versus the jsonl: the row says "FAIL, FAIL", while the jsonl has three FAIL records (25-27). The unknowns.md text cites the jsonl range accurately, so the doc is correct. The mismatch lies in the test evidence, not the document.

COUNTS
- Scope 1: BLOCKER 0, WARNING 0, NIT 1, OBS 1 (OBS 3 above).
- Scope 2: BLOCKER 0, WARNING 0, NIT 0, OBS 1 (OBS 1; OBS 2 is a no-action note).

Scope 1 (group C, unknowns.md): PASS
Scope 2 (group A, processes.md): PASS

Read-only proof: `git status --short` at the end shows only the two untracked files that existed at the start (.planning/config.json, .planning/milestone.lock). My run changed no tracked file.
