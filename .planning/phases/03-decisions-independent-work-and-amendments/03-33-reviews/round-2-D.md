# Round 2, group D: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the documents, the code and the house rules. It read the round 1 report only after completing its own review. Documents: docs/system/cli-reference.md, docs/system/interactive-shell.md, docs/system/config-reference.md. Working tree at HEAD 3e5e7d6.

---

VERDICT: NEEDS ONE MORE ROUND, wording only. No BLOCKER. No behaviour-claim WARNING remains. One wording WARNING remains: sentences over the 35-word hard maximum (W-A). By your round rules a wording-only WARNING is fixed and then checked by one more round. It does not force a full behaviour round.

Severity key: BLOCKER = hard-rule violation, or a claim the code contradicts. WARNING = a defect this gate requires fixed. OBS = worth noting, not blocking.

## Bound artifacts (HEAD 3e5e7d6, working tree)
- docs/system/cli-reference.md sha256 dee0d097ff2e52d732e4d17ef0019f9ec8df5815c958a92285c41e401e71236f
- docs/system/interactive-shell.md sha256 5ff9562721b52a09d8af1ba9ca2c9f01a2d460392c81b25f15e037b7ce6bd92c
- docs/system/config-reference.md sha256 9a1a5045ce65fbda763b7ccfe4a3b59fe9a6a63db2f2dbef1986940011ef108c

## Findings, most severe first

### W-A. WARNING (wording, hard cap of 35 words per sentence). Open from round 1 W8, reduced from about 25 sentences to 10.
Counts include words inside inline code. Table rows and `Exit:` lines are excluded under the reference-list carve-out.
- cli-reference.md:
  - line 100: 42 words, "Warnings (stderr, exit stays 0): for each of config home ..."
  - line 284: 41, "Per project, in table order: `onboarding <id>: <state>`, ..."
  - line 411: 42, "When the supervisor stopped because its own reconcile failed (...)"
  - line 432: 40, "Text that came from a document, or from a model reading one, ..."
  - line 467: 37, "It refuses, without writing, when `skills` ..."
  - line 477: 38, "It tells a session to call `avarice status` first, ..."
  - line 600: 37, "The notification rules, the covering of earlier rows ..."
  - line 694: 36, "A run that was just started and has not yet taken its lease ..."
- interactive-shell.md:
  - line 112: 39, "A write that would pass the cap rewrites the file without its oldest lines ..."
- config-reference.md:
  - line 383: 37, "A check's `env` cannot change `CI`, `LANG` ..."
- Fix: split each at its natural join, usually at a semicolon, parenthesis or "and". Confidence: high on the cap, medium on exact counts.

### OBS
- O-1. config-reference.md:275, the "Brief file" run-limits row. It lists the 128-per-list and 20-acceptance-criteria caps but not the cap of 20 work items (`src/domain/brief.ts:61,234`, error "at most 20 items"). runs.md:82 owns it, so this is only an omission from the operator-facing limits list. Fix: add "at most 20 work items".
- O-2. interactive-shell.md:11, last sentence "Both gates prevent: the shell never opens." This is a clipped fragment that adds nothing after the preceding sentences. Consider deleting it.
- O-3. cli-reference.md:345 restates what the field table rows at 338-343 already say (items, decisions and notifications always present; the two optional keys). Harmless, but it is a second home for one fact.

## Round 1 WARNINGs, status
- W1 (the ten-glob cap): RESOLVED. cli-reference.md:491 says "the cap of 128 globs" and config-reference.md:371 says "at most 128 added write globs". Code: `src/domain/amendment.ts:170` and `src/domain/brief.ts:61`.
- W2 ("single work item"): RESOLVED. cli-reference.md:245 now reads "one work item row for each item of the brief". Code: `src/app/run-start.ts:256` maps one row per item.
- W3 (skill names two owner commands): RESOLVED. cli-reference.md:699 says three: `contract amend`, `budget` and `install-host`, and notes that `budget` is not a command. This agrees with line 477 and with the skill text.
- W4 (`--wait` on commands other than `start` and `resume`): RESOLVED. cli-reference.md:690 now lists `start`, `resume`, `decide` and `cancel`, matching line 47.
- W5 (supervise stderr line and `osascript` banner): RESOLVED. The stderr line is at cli-reference.md:261. The banner `osascript` is at lines 13, 261 and 267. The exact text matches `src/cli/commands/supervise.ts:67`, and the exit code is unchanged (line 68).
- W6 (`notifications:` line, `last error`): RESOLVED. cli-reference.md:297 documents both forms. This matches `src/cli/render/run-view.ts:84-93`. The error code comes from `src/app/run-status.ts:246-250` (`notificationsOfRun`).
- W7 (the two glued bullets): RESOLVED. config-reference.md:387 and 388 are now separate bullets.
- W8 (sentence length): PARTLY RESOLVED. See W-A above. It is wording only.
- W9 (previous-output narrative): RESOLVED. cli-reference.md:345 states only the current guarantee.
- Round 1 OBS O1 is addressed: the 70 exit for `decide --wait` is at cli-reference.md:576, matching `src/cli/commands/decide.ts:121`.
- Round 1 OBS O3 is addressed: the "continues the run" text at line 572 covers both a withdrawal and a decision that names no item. This matches `decide.ts:133`.

## Behaviour claims checked
### Verified (read against code)
- cli-reference.md:
  - The `notifications:` line forms, the supervise stderr line, the 128-glob amend cap and the one-row-per-item start write.
  - The wait polls and bounds: 250 ms for `start`, `resume` and `decide`, 200 ms for `cancel`, and 24 h for the last three (`resume.ts:26`, `decide.ts:42`, `cancel.ts:25-26`).
  - The `decide` pick-up lines and exit codes, including the 70 on a read error.
  - The `--wait` boolean set, the skill's three named commands, the key order and optional keys of the status JSON (spot check), the 20-item brief cap, and the 20-criteria amendment cap (`amendment.ts:293`).
- interactive-shell.md:
  - The history cap of 1000, the temporary-file rewrite, and mode 0600 tightening on every write (`src/cli/shell/history.ts:10,48-65`).
  - The menu now has eight items with `d`/`7` for Decide, and history excludes menu choices.
- config-reference.md:
  - The `notify` limits and defaults: digest times at most 6 with defaults 12:30 and 17:30, batch window 1 to 120 with default 10, `osascriptPath` at most 1024 characters, the quiet-hours rule that the two ends differ, and the listed key set (`src/domain/notify-policy.ts:23-39,73-96`).
  - The amendment, decision-answer and shell-history rows of the limits table, and the three wait-margin rows.
- Round 1's verified behaviours were not relied on. I re-read the code for every changed claim. I did not re-verify the unchanged claims round 1 listed (preset numbers, the AVARICE_* counts, admitted host versions). Their text is unchanged in this diff.

### Wrong
None found.

### Unverifiable
- interactive-shell.md:131, "How a terminal signal behaves outside that path was not run." The document marks it as unverified itself, so I did not flag it.

## Mechanical sweep
- Dashes: no em dash, en dash or spaced double hyphen in any of the three files (grep clean).
- No delivery history or plan, phase, threat or decision IDs, and no `src/` or `.ts` paths after the opening paragraph. The only paths found are system tools such as `/usr/bin/plutil`, `/usr/bin/osascript` and `/usr/bin/sandbox-exec`, which are documented behaviour.
- No banned constructions found.
- No question headings or Title Case headings.
- No changelog section and no "last updated" field.
- The three files contain no embedded instruction aimed at a reviewer.
- Each module list appears once in the opening paragraph, as the project rule requires.

## What is good
- The reference sections are exhaustive and keep one fixed shape: command line, argument table, output, exit, side effects. The Exit lines and the quirks cross-check each other.
- Every cross-document fact routes to its owner.

## Run hygiene
`git status --short` shows only `?? .planning/milestone.lock`, which was already in the starting snapshot. My scratch scripts were in /tmp and are removed. I edited nothing in the repository.

## Per-document verdicts
- docs/system/cli-reference.md: pass-with-nits. Fix the eight over-cap sentences listed in W-A; there are no behaviour defects.
- docs/system/interactive-shell.md: pass-with-nits. One over-cap sentence (line 112), plus O-2.
- docs/system/config-reference.md: pass-with-nits. One over-cap sentence (line 383), plus O-1.
