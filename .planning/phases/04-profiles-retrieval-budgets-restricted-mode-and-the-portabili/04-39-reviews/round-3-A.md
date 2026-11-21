# Fresh-eyes review, round 3 (final), group A

Reviewed hashes (sha256, read at HEAD c8d6f22):
- docs/system/profiles-and-credentials.md 94fa616024f57ca64f2f00118870f0013568918a2b36b3a49743215b9c6d49df
- docs/system/policy-and-approvals.md 47dec0faabfc9431fa49faa0cd9d6e6dc4a7409dbdd49d210c0234bc9ca8ad63
- docs/system/findings.md 584b244058ccc362ef8e7806be2871cb8de8c6531b18b8e95969da52704d7f96

Severity: BLOCKER (hard-rule violation or a claim the code contradicts), WARNING (structural defect or loosely supported claim), NIT (polish). BLOCKER and WARNING block a PASS.

## Earlier items

- Round 1 BLOCKERs and WARNINGs: resolved (round 2 confirmed; none has regressed).
- Round 2 W1 (Quirks restate the body): resolved. Both Quirks sections now hold only facts with no home in the body. One side effect is NIT 1 below.
- Round 2 N1 (id and action start with a letter or a number): resolved; policy.ts NAME is /^[a-z0-9][a-z0-9._-]{0,63}$/.
- Round 2 N2 (proofless rows): resolved; enforcement-map.ts gives the three platform rows PLATFORM_OWNS and the two host rows "not yet resolved by a containment test".
- Round 2 N3 (module-list openings): deferred by the author, not a defect.
- No src/ change since round 2 (the diff from 5a3f648 to HEAD touches docs only), so round 2's code verification still holds; I re-verified the items below independently.

## Findings

Findings at BLOCKER or WARNING: none.

### NIT 1. profiles-and-credentials.md, Credentials (the keychain paragraph): a fact lost in the Quirks cleanup
- Claim removed: "a keychain value loses one trailing newline, so a secret whose own edges are whitespace changes". The disposition says the keychain trimming line was "restated by the body", but the body states only the helper's trimming ("Its output is trimmed on both sides").
- Evidence: src/adapters/credential/keychain.ts, the close handler after line 89 ("`security -w` ends the value with one newline" and strips it); cmd.ts:78 trims both sides.
- Fix: add one sentence to the keychain paragraph: "The keychain value loses the one trailing newline `security` adds." Confidence: medium (the omission is certain; whether the reader needs it is a call).

### NIT 2. findings.md: several "now at" and newer cites do not land at HEAD
- Cites that name no subject at HEAD: src/app/run-stages/item.ts:608 and :634 (a budget-limit line and a closing brace; the reconcile of a delegated item with no snapshot step is at :628 to :637 and the moved-HEAD check at :668), :594 (a "now at" that lands inside the reconcile function, about 30 lines off), :1156 and :1191 (comments about the loop limit and resume); src/cli/commands/start.ts:132 and :136 (the index read is at about :148); src/domain/run-contract.ts:108 (the human list is at :115); src/adapters/sqlite/ledger.ts:951 (amendRunContract is at :1145); src/ports/ledger.ts:705 (the budget comment is at :802); src/cli/main.ts:71 (the AVARICE_RUN read is at :76).
- Evidence: the cited lines read at HEAD. The opening of the file says a cite is where the line was logged and HEAD is the authority, so this is within the file's own contract; the same state existed at round 2 and was not raised. Of 31 sampled "now at" targets and 46 cites from the newest section, most land on the subject or within 10 lines; the rest are listed above. All 561 distinct cites resolve to an existing file and a line inside it.
- Fix (optional): refresh the listed cites, or extend the opening to say a "now at" cite is only as current as the last check. Confidence: high on the drift, low on severity (a ledger by design).

### NIT 3. findings.md: very long entries
- Lines 326 to 347 carry 36 to 63 word sentences. findings.md is a reference ledger and the length carve-out for reference lists applies; noted so the owner can split the longest (326, 329, 330, 341) when the entries are triaged.

## Checked and deliberately not flagged

Mechanical: no em dash, en dash or " -- " in any of the three files; no sentence over 35 words in the two documents (code fences, table rows and bold markers excluded); headings in sentence case; no phase, plan, task or threat IDs and no function names in the prose of the two documents; modules named once in each opening; the links in each document resolve (diagram, autonomy-and-decisions, containment, config-reference, cli-reference, data-model, the onboarding Refresh heading, ADR-015).

profiles-and-credentials.md against code: profile grammar (profile.ts ORG_PATTERN, 1 to 31); binding registry (64 KiB, 1,000, mode 0600, schema); profile config 64 KiB limit; the keychain provider (5 s, 16 KiB, exit 44, argv without shell, PATH and HOME only, timeout kind); helper provider (trim, network denied, 5 s, stderr unread); provider classes (credential-ref.ts: delegated only for personal-extended); seeding minimum 8; audit outcome mapping, 160 cap and info/warn level; seven redaction kinds (six patterns plus gsd-scan); hook read-record 16-character hash suffix; AVARICE_DEBUG_TRANSCRIPTS; store-profile mismatch closed before migration with exit 70; binding backfill on the first non-read-only command; supervisor and LaunchAgent environment (spawn-supervisor.ts, launchd.ts ENV_NAMES include the profile variable).

policy-and-approvals.md against code: 22 actions in three classes; evaluatePolicy order (transport rules fixed, broken rank 1, org rule, personal user replacement, stricter-only ranks 3 and 4); authorizeAction order (deny, allow with start for privileged, contract source, consumption, request and denial text); approve.ts (y or yes, exits 0, 3, 64, 70, grant by owner:, 30 minutes); hook forms, 65,536 characters, nesting 8, wrappers; attended entry matcher Bash, timeout, block on failure; enforcement map 18 controls, three host-limitation rows with two not-claimed, proofs; manual routes (16,000 bytes, 200 characters, 2 MiB, kinds ci, review, manual, inconclusive, PR URL path); interrupted-start decision with reason enforcement_failure (run-resume.ts).

Not verified: the findings.md cites outside the samples above; the sandbox deny-list detail in "Moved-root denial" was read for consistency, not traced to the sandbox module.

Read-only proof: the status shows only the two untracked .planning files that existed before the run, plus this report.

Verdict: PASS
