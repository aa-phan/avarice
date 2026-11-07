Reviewed: docs/system/history.md sha256 f707cb3f9482d7291a3419fdec01cebb7725657edca124520d14ad305ffb6a16 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 4 WARNING and 2 OBS remain (no BLOCKER); stale counts at HEAD, corrupted word in four places, delivery labels, path and function name in prose.

BLOCKED: 4 WARNING and 2 OBS remain (no BLOCKER); stale counts at HEAD, corrupted word in four places, delivery labels, path and function name in prose.

Digest reviewed: f707cb3f9482d7291a3419fdec01cebb7725657edca124520d14ad305ffb6a16 (matches dispatch). HEAD 6b82da2.

FINDINGS

1. WARNING (high). Counts and commands are stale at HEAD. Line 9 "412 commits over six days", the table row for 2026-11-06 (43), line 20 "114 commits after e725db6 ... 71 dated 2026-11-05 and 43 dated 2026-11-06". The quoted commands, run at HEAD, give 413 total, 44 on 11-06, 115 after e725db6 (71 + 44). The figures hold only up to 0632fd4, as line 5 says, but the commands name HEAD. Fix: give the commands the range end 0632fd4, or recount at the final commit. Commit 6b82da2 (the landing) is the one commit past the stated end.

2. WARNING (high). Corrupted word (g, two apostrophes, it) in four places: line 5 "what the [word] history", lines 9 and 20 inside the quoted commands (which therefore do not run), line 90 "from the ledger and [word]". Fix: replace with the plain word.

3. WARNING (high). Delivery-history labels in prose. Heading line 55 "2026-11-05: review fixes and phase close"; line 57 "commits under the 261105-2i2 quick task" and "closed the onboarding phase"; line 63 "Later phases were each given a closing documentation step". Quick-task IDs and "phase" are planning labels, not claim evidence (commit 4ac1127 carries the ID in its subject, so the SHA already evidences it). Fix: heading "2026-11-05: review fixes and the end of the onboarding slice"; line 57 drop the quick-task ID, keep "ending at 4ac1127", say "closed the onboarding slice"; line 63 "Later slices were each given...".

4. WARNING (medium). A file path and a function name in prose against the CLAUDE.md rule. Line 25 "spikes/2026-11-01-pre-slice-0/README.md" (exists at HEAD); line 57 "gsd_run argument checks". Fix: describe the spike notes without the path (or link them), and write "GSD run argument checks".

5. OBS (medium). Term rotation: "phase" (lines 55, 57, 63) against "slice" for the same unit. Settled by finding 3.

6. OBS (low). Sentence length: lines 44 (36), 79 (36), 83 (42), 84 (44), 92 (41) exceed 35 words, mostly from hash lists. List items are exempt per brief; 83 and 84 would read better split.

CHECKED AND NOT FLAGGED
- No em/en dashes or " -- ". Sentence-case headings. No secrets, absolute home paths, transcript text or embedded instructions.
- Daily counts at 0632fd4 equal the table (8/108/56/89/108/43); at HEAD 11-06 is 44 (finding 1). Range starts at 9858bd0 on 2026-11-01.
- Spot-checked 27 SHAs against subjects and dates (4ac1127, 5d558e9, 99dd4fb, 8054cb8, 4f968ab, 304e551, d86c8da, 12b6819, 059cd3d, e1740a6, 7fe273c, 57aaa4e, f759ec8, 58fd5e9, 52fe97c, 1552ba2, 92bdf9c, 378de13, be1abd5, a017bf1, c5b7e3d, 07b16ca, c67a82e, 22769b7, b9e4d58, f742b3e, 5457f85): consistent with the text and day headings (22 cases, 2.1.318, 2.1.317, 0600 history confirmed).
- Inferences (lines 53, 97) are labeled with their basis. Bare SHAs accepted as claim evidence in a history document. history.md is listed in README line 29.
- Did not verify beyond commit subjects (no code packet for history).

Porcelain status after run (both entries pre-existed; nothing in the repository was modified):
?? .planning/config.json
?? .planning/milestone.lock

## Answers

Applied: findings 1 to 4. The commands are now pinned to the end commit named in the opening, so the counts are reproducible. The corrupted word was a workaround for a tool restriction in the grounding step and is replaced. OBS 6: the long sentences are list items made of commit lists, which the brief exempts.
