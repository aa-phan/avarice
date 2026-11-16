# Round 3, group D: fresh prose review, wording confirmation (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It read the round 2 report only after its own review. Documents: cli-reference.md, interactive-shell.md, config-reference.md. Working tree at HEAD 13a7267.

---

Verdict: PASS for all three documents, with no findings above OBS. Round 2 W-A and its OBS items O-1 and O-2 are resolved. O-3 was not edited and still stands as a harmless nit (item 3 below). HEAD is 13a7267.

SHA-256 of each document:
- docs/system/cli-reference.md: a538dbe8883709b0ba370308e699cd1dcd84754b606846cacfff436e09a99107
- docs/system/interactive-shell.md: cb96b4ae6991df3c3ec26f9e7f13c611bb1a1b4fb36f3e8db1ec023e696b127d
- docs/system/config-reference.md: 91bceef03269137bed93b9dca42a45405c62ebec2205b265d69513f72747ee4a

FINDINGS: none above OBS.

**1. Edited passages.** I read `git diff 3e5e7d6` for all three files. Every edit keeps its meaning, and the claims I could check against `src/` hold.
- config-reference.md, "Brief file" row: "at most 20 work items" is correct. `src/domain/brief.ts` sets `BRIEF_LIMITS.items = 20` and refuses a longer array with "at most 20 items".
- cli-reference.md, init warning (line 100): the split sentence matches `src/cli/commands/init.ts:55`. The text is identical and the trigger is `mode & 0o077`, which means group or other bits set.
- cli-reference.md, other edits: the resume `--wait` reconcile-failure sentence, the `context` fence sentence, the install-host refusal list, the skill-text split, the digest launchd sentence, the status per-project bullet and the just-started-run bullet are pure splits or rewordings. No fact was added or lost, and the install-host refusal and skill-text claims are unchanged from round 2.
- interactive-shell.md: the clipped sentence "Both gates prevent: the shell never opens." is removed. The remaining text still says the shell has a second gate and that a run gets the usage text. The history-cap sentence is split with the same meaning.
- config-reference.md: the check `env` bullet was rewritten ("so the sandbox names are accepted there and the sandbox value silently wins"). It says the same as before and drops the contradictory "although ... not" construction.

**2. Whole-file sweeps.**
- Sentence length: I counted words inside inline code too, and excluded table rows, code fences, headings and `Exit:` lines. No prose sentence is over 35 words. The longest are at 35 (cli-reference lines 164, 393 and 462, and config-reference line 242), which is at the cap and not over it.
- Dashes: no em dash, no en dash and no ` -- ` in any of the three files.
- Paths and delivery history: the `src/...` paths and function-style names appear only in each file's opening paragraph (line 3 of each), which the CLAUDE.md rules allow. I found no phase numbers, plan IDs or threat IDs in the prose after the opening.

**3. OBS (not blocking, unchanged since round 2).**
- OBS, cli-reference.md:345 (round 2's O-3). It restates the field table rows at lines 338-343, so one fact has two homes. This was not edited, and I did not reopen it. Fix, if wanted: delete the restatement.

**4. Round 2 report, `.planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-2-D.md`.** I read it only after my own review.
- W-A is resolved. All 10 listed sentences are now under the cap, as shown by the sweep above: cli-reference lines 100, 284, 411, 432, 467, 477, 600 and 694, interactive-shell line 112, and config-reference line 383.
- O-1 is resolved: "at most 20 work items" is in the row, and the code confirms it.
- O-2 is resolved: the clipped sentence is deleted.
- O-3 is the nit above.

**Verdict per document:**
- cli-reference.md: pass-with-nits (O-3 only).
- interactive-shell.md: pass.
- config-reference.md: pass.

**Read-only proof.** `git status --short` shows only `?? .planning/milestone.lock`, which was already there before my run. I wrote one scratch script outside the repository at `/tmp/sl.py`.
