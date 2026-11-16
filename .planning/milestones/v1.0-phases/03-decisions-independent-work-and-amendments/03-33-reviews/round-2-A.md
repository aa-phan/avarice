# Round 2, group A: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the documents, the code and the house rules. It read the round 1 report only after completing its own review. Documents: docs/system/autonomy-and-decisions.md, docs/system/findings.md, docs/system/unknowns.md. Working tree at HEAD 3e5e7d6.

---

Verdict: NEEDS ANOTHER ROUND. findings.md has 4 citation WARNINGs (stale inline file:line numbers left behind when only the lead citation of a line was re-pointed). autonomy-and-decisions.md and unknowns.md have nothing above OBS. I edited nothing.

SHA-256 (HEAD 3e5e7d6):
- docs/system/autonomy-and-decisions.md: e10d9b78bc6d20a3c28616504c7f2ec6e477482ed58a42215a9bc75ad942e8f6 (126 lines)
- docs/system/findings.md: ac129c18a84dfbe698adef21be1b38b76f1ef85773d87a94176f6b6d5830b295 (303 lines)
- docs/system/unknowns.md: 3ad2eff848d40ea1741d405399096dfdaaa8362f7ad02d1c82ae23943e1f1e66 (133 lines)

Severity key: BLOCKER = cannot proceed; WARNING = fix, and a code-behaviour or citation WARNING forces another round; OBS = worth noting.

FINDINGS (most severe first)

W1. WARNING, findings.md line 121 (the `src/app/run-start.ts:175` line). Verdict: wrong.
- Quote: "`src/app/run-start.ts:175` (now at `src/app/run-start.ts:177`): `start` refuses with ten distinct codes ... `gsd-not-admitted` (175), `no-project` (187), `no-active-record` (192) and `conventions-invalid` (210, 231)".
- The lead was re-pointed but the inline numbers were not. At HEAD the refusals are at run-start.ts:177, :189, :194, :212 and :233.
- Fix: update the inline numbers, or drop them and keep one lead citation.

W2. WARNING, findings.md line 241 (the `item.ts:314` line, "now at item.ts:594"). Verdict: wrong.
- Quote: "reconciled to ready without reading the clone HEAD (`item.ts:321`), so the moved-HEAD breach check that follows (`item.ts:352`) is skipped".
- item.ts:321 is now `return !matchesAny(c.path, g.delete);`. item.ts:352 is a comment in an options argument.
- The snapshot-null branch is at item.ts:594, and the clone `workspace.head` read comes after it at about :609.
- Fix: re-point both. I did not locate the moved-HEAD breach check itself, so the author must find it.

W3. WARNING, findings.md line 242 (the `item.ts:611` line, "now at item.ts:1156"). Verdict: wrong.
- Quote: "only an unavailable or denied host error is reported as an enforcement failure (`item.ts:657`)".
- item.ts:657 is now a comment in the `!ran` retry branch. `hostRefused` is at :1156.
- Fix: re-point to the line that reports the enforcement failure. I did not locate it.

W4. WARNING, findings.md line 205 (the `ledger.ts:1106` line, "now at ledger.ts:1283"). Verdict: wrong.
- Quote: "the type 'harden' it accepts (line 1117) is written by nothing".
- ledger.ts:1117 is now a run_steps SELECT. The 'harden' check is at ledger.ts:1294.
- Fix: "line 1294".

OBS
- O1, findings.md, the `finish.ts:180` line (now at :182): "G4 revision is measured after (line 122)". finish.ts:122 is `if (!tree.ok) return tree;`. The measurement is at :121, :123 and :126 (`revisionOf`). Re-point to 126 or say "lines 121 to 126".
- O2, findings.md line 252 (the `ancestry.ts:56` line): :56 is the comment above `processAncestry`, and the function starts at :57. The claim itself is verified.
- O3, findings.md line 90 (`launch-preflight.ts`, "now at :140"): the claim is that an unadmitted version refuses the launch, but :140 is the `host-unavailable` probe failure. The not-admitted refusal is at :143. The old cite pointed at the same probe block, so this predates the round.
- O4, findings.md ancestry line: "No test shows that a run cannot produce such a process" is a negative claim I could not verify. It is phrased as a gap, so I accepted it.

BEHAVIOUR CLAIMS CHECKED

autonomy-and-decisions.md: all verified against src except the unverifiable items at the end of this section.
- Banner text: counts, run ID and next command only (`notify-policy.ts:210`). No caller passes `decisionIds` (`notify.ts:65`, `notify.ts:212`, `digest.ts:48`). The digest banner has no run ID. `avarice status` is used for a blocked run, `avarice inbox` otherwise.
- Amendment request: only `option-not-listed` triggers it, and only for a withdraw-only record that carries an amend command (`decide.ts:134-138`). `withdraw` passes the option check (`response-validation.ts`). The command prints the amend command and the way to withdraw, and exits 3. The prompt `amend` chain, including the "measured nothing to pre-fill" branch, matches `amendChain`.
- Permission authority: `amendCommandFor` returns null for permission (`decision-policy.ts:279`). `amend.ts:60` lists the resolvable classes. The table and the authority paragraph now agree.
- Numbered choices: at least two choice lines numbered from 1, after a question ending in "?". `(Recommended)` counts only on exactly one choice (`decision-policy.ts:110-134`).
- Response checks: order is identity, open, option, duplicate, state digest. Free text is 1 to 2000 characters with no control character other than tab and line feed. `withdraw` is exempt from the digest check. An empty digest never matches. A text option is never answered by its key.
- Identity: an unreadable process table counts as inside a run (`ancestry.ts`, `inRunProcessTree`). The owner check is in `cli/commands/decide.ts:197`.
- Recording: `decision.rejected` is recorded except at the identity stage. The read-once-more retry is in `applyOnce`.
- Pickup: `isBlockedRunContinuable` matches the continuable rule (reason `decision`, from `running` or `paused`).
- Digest: writes nothing when nothing waits, reuses one held row in quiet hours, marks covered rows delivered, returns `failed` on a failed destination (`digest.ts`).
- Round 1 items verified by round 1 and not re-read by me: retry delays, the 200-character body cap, LaunchAgent flags, stale re-open copy, withdraw ends run `failed`.
- Unverifiable (not run): whether launchd fires the agent and a banner shows on a real desktop; whether every admitted host honours `--resume`; the exact contents of the evidence-reference rows. The first two are recorded in unknowns.md.

findings.md citation sample: about 120 targets, covering every "now at" re-point added since fc15fea plus the new autonomy section. All are correct except W1 to W4 and O1 to O3. Examples verified:
- composition.ts:175 (the round 1 W4 re-point), :173, :30.
- launch-preflight.ts:113, :68, :237; claude-host.ts:244, :157, :387, :249, :260.
- ledger.ts:509, :531, :603, :743, :763, :1197, :1283, :1354.
- hook-decision.ts:249, :271, :278, :539, :668, :809, :839; invocation-scope.ts:461, :505; run-contract.ts:407, :669, :703, :747.
- The new autonomy section: schedule.ts:38 (run-stage), cli/commands/decide.ts:126, app/decide.ts:205, supervise.ts:66, notify.ts:47, run-gsd-config.ts:212, item.ts:172, :390, :1786, outcome.ts:116, contract.ts:174, launchd.ts:263, :267, schedule.ts:33, :59, cancel.ts:98, decide.ts:197, db.ts:112.
- contract.ts has no `ownsProfile` call, which matches the `contract amend` finding.
- decision-policy.ts:279 and notify-policy.ts:215 for the two new findings.
- The commits cited by "Resolved at" exist and match their topics: f1a4d8c, 9323ed3, 5878368, d16fad6.
- The LIVE-CASES.md re-points (:241, :334) land on lines recording the missing Glob and Grep tools.

unknowns.md: the round-2 diff is rewording only (semicolons split into sentences). The substantive claims were verified in round 1 and I spot-checked them again: decision states are written by answerDecision, reopenStaleDecision and withdrawDecision; failed and cancelled are entered (cancel.ts:41, blocked.ts:226); contract amend is built.

MECHANICAL SWEEP
- No em dash, en dash or ` -- ` in prose. The only ` -- ` hits are in code spans (findings.md lines 74 and 216, unknowns.md line 121).
- autonomy-and-decisions.md: no sentence over the 35-word cap; the longest is 34 words, at line 29. Round 1's six long sentences are split.
- Headings are sentence case. The blank line before `## The amendment request` is present.
- No phase, plan or threat IDs and no changelog field in the autonomy prose. Source paths appear only in the opening. Link targets exist.
- The "this change" wording in findings.md is replaced by commit IDs.

ROUND 1 WARNINGS
- W1 banner text: resolved (line 102 corrected; findings line 251 records the unused hook).
- W2 amendment request: resolved (line 81 says "any key other than `withdraw`"; decide.ts:134-138 verified).
- W3 permission authority: resolved (line 47 and the table agree; findings line 252 records it; decision-policy.ts:279 and amend.ts:60 verified).
- W4 composition.ts citation: resolved (now :175, correct). The same kind of defect remains in other lines (W1 to W4 above).
- W5 sentence cap: resolved (nothing above 34 words).
- W6 "this change": resolved (f1a4d8c and 9323ed3, both exist and match).
- Round 1 OBS O1 to O4 are fixed. O5 is fixed for the two lines it named.

LEFT ALONE
- Commit SHAs inside findings lines are claim evidence.
- The quirks list repeats findings in reader-warning form, which serves a different purpose and is not a one-fact-one-home breach.
- `*drafted, not yet reviewed*` is the status marker the coverage table uses.

READ-ONLY PROOF
`git status --short` shows `.planning/milestone.lock` (present at the start) and two untracked round-2-D.md and round-2-E.md files in the 03-33-reviews directory. Those two came from other reviewers; I did not create them. `git diff --stat` is empty. I wrote only /tmp/added.txt, outside the repository.

VERDICTS
- docs/system/autonomy-and-decisions.md: pass
- docs/system/findings.md: needs-changes (W1 to W4; O1 to O3 can ride along)
- docs/system/unknowns.md: pass

Relevant paths: /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/findings.md (lines 121, 205, 241, 242), /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/autonomy-and-decisions.md, /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/unknowns.md.
