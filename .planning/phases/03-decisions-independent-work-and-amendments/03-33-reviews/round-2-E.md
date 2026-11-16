# Round 2, group E: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It was given only the documents, the code and the house rules, and read the round 1 report only after its own review. Documents: docs/system/integrations.md, docs/system/overview.md, docs/system/README.md. Working tree at HEAD 3e5e7d6.

---

VERDICT: NOT PASS. One behaviour WARNING (a wrong git argv in integrations.md) forces another round. One wording WARNING (a sentence over the cap in overview.md) will need a fix and a check. There are no BLOCKERs, and every round 1 WARNING is resolved.

Digests (sha256 of the working tree at HEAD 3e5e7d6, none supplied):
- docs/system/integrations.md fedb4fe2d0b9f9ec2b5135c1fbe2a107bace7f10a32b3023d97d2a90483711fe
- docs/system/overview.md 65904a725e4bc1a08d0004b982dd07990a947f612e1acc5d28f533333f16f95b
- docs/system/README.md e22590c58d7bfb649656656c97b3a3c3148896475d13221da8a3391a0567fda6

Severity key: BLOCKER = cannot proceed. WARNING = rework needed; a behaviour WARNING forces a round. OBS = worth noting.

## Findings, most severe first

**W-A. WARNING (behaviour, wrong).** integrations.md, "git" group table, "Run workspace" row.
- Claim: the row lists `log -1 --format=%B` for the HEAD message read.
- Evidence: src/adapters/git/run-workspace.ts:232 runs `['log','-1','--format=%P%n%B']`. That is parents then body, not the bare body. No other `%B` call exists in the file. The `%T %P` call at lines 477 and 516 is correct.
- Fix: write `log -1 --format=%P%n%B` and say it reads the parents together with the message.
- Confidence: high.

**W-B. WARNING (wording only, hard sentence cap).** overview.md, opening paragraph of the section before "System boundary" (line 5).
- Quote: "Everything a contained model does happens inside a clone, under a generated permission set, an OS sandbox and a fail-closed hook: a staging clone for onboarding, a run clone for a run."
- That is 41 words after stripping links. The sentence was already in fc15fea, so round 1 did not flag it, but the cap applies to the whole file.
- Fix: end the sentence after "fail-closed hook" and start a second one, "The clone is a staging clone for onboarding and a run clone for a run."
- Confidence: high.

**OBS-1.** integrations.md "macOS sandbox", rule 7, "Give back the metadata (not the contents, not a listing) of each directory above a re-allowed path that lies inside a denied one, so ...". It is a 36-word list item. The campaign did not touch it, and reference lists are exempt, so this is optional.

**OBS-2.** Vendor behaviour that cannot be checked offline: integrations.md line 84, "As observed on 2.1.316 to 2.1.319, the admitted host removes its Glob and Grep tools ...". It is now labelled "as observed", and the launch line is verified (src/adapters/host-claude/launch-args.ts). The vendor behaviour is unverifiable here.

## Round 1 WARNINGs, one by one

- **W1 (overview "79 files"): resolved.** The number is gone. Line 26 now says "[coverage.md] records how many files it covers". coverage.md:33 records 99.
- **W2 (supervisor spawners and environment): resolved.** integrations.md now names `start`, `decide` and `resume`. src/cli/commands/start.ts:163, resume.ts:106 and decide.ts:96 all call spawnSupervisor. The text states the `CLAUDE_CONFIG_DIR` override and links runs.md#the-detached-supervisor. src/cli/spawn-supervisor.ts:52-62 matches, and the Quirks line (line 426) is corrected too.
- **W3 (one sentence on the executor): resolved.** The text now gives the shell-rules note for all four agents, the executor note and the verifier note. src/adapters/gsd/agents-json.ts:53-56 matches.
- **W4 ("pause blocks the run"): resolved.** The text now reads "A pause routes the item to a decision, and the run continues with the items the decision does not touch". It matches round 1's evidence in src/app/run-stages/item.ts. The runs.md#several-items link resolves.
- **W5 (park, unpark and drop-park missing): resolved.** The bullets and the table row now cover park, unpark and drop-park (run-workspace.ts:446-594). I checked each of these against the code:
  - the ref namespace `refs/avarice/park/<run>/<item>`;
  - create-only with ZERO_OID (line 487);
  - `update-ref -d` (line 594);
  - `restore --source=<park tree>` in batches (line 575);
  - conflict naming the paths;
  - the symlink-parent refusal (line 195);
  - the 120 s tree timeout and the 200-path batches.
  The one defect left in that row is W-A.
- **W6 (ledger list): resolved.** The list now includes amendments, notifications and the cancel request. src/ports/ledger.ts:764, 807, 811, 815 and 819 match.
- **W7 (sentence length): resolved apart from W-B.**
  - A mechanical scan finds no sentence over 35 words in integrations.md or README.md apart from OBS-1.
  - The overview.md:40 pair, the integrations.md:90, 342 and 358 items and the README opening are all fixed.
- **W8 (retry schedule duplicated): resolved.** The osascript section now links autonomy-and-decisions.md#notification for the retry schedule and for the `failed` state. The anchor exists at line 96.
- **O1, O3 and O4: addressed.**
  - The "push adapter" sentence is gone.
  - The path fallback is now stated (src/cli/composition.ts:290).
  - README.md:9 now says a drafted document is listed as such in coverage.md, with no title mark required.

## Behaviour claims checked

Verified:
- **Spawn sites.** Spawners are start, decide and resume; the environment is `process.env` plus the three roots, the recorded `CLAUDE_CONFIG_DIR`, and `NODE_TEST_CONTEXT` removed.
- **Ports.** There are 12 ports plus the capability descriptor, 13 files in all.
- **Overview structure.**
  - The fifteen commands match COMMANDS in main.ts.
  - The four owner commands (contract, decide, cancel, schedule) are exactly the files that call refuseOutsideTerminal.
  - The shell opens only when both streams are terminals and `AVARICE_RUN` is unset, else exit 64 (main.ts:71).
  - The LaunchAgent writer is imported only from src/cli (args.ts, commands/schedule.ts, main.ts).
- **Notifier.** The 10 s timeout and SIGKILL, the three codes, and the composition fallback to the default path are all as described.
- **launchd.** `plutil -lint` (launchd.ts:257), bootout exit codes 3 and 113 (line 80), the 160-character error cut (line 189), and bootstrap/bootout on `gui/<uid>` are as described.
- **Git argv.** The run-source command list matches run-source.ts. The run-workspace list matches run-workspace.ts, except W-A.
- **Link anchors.** Every `file.md#anchor` link in integrations.md and overview.md resolves.
- **Round 1 verifications.** I did not recheck every item round 1 verified (admitted versions, launch refusal rules, reap pattern, stream-json tail, spawn-site sweep, GSD, proxy, sandbox and SQLite claims). The campaign did not touch them, and a spot check of the git, supervisor and agent definitions matched.

Wrong: W-A only.

Unverifiable: the vendor's Glob/Grep removal (OBS-2), and macOS launchctl/plutil behaviour beyond the adapter's exit-code handling.

## README.md structure

- **Documents table.** Every docs/system/*.md except README.md and coverage.md has a row: autonomy-and-decisions, checks-and-evidence, cli-reference, config-reference, containment, data-model, findings, history, indexes-and-context, integrations, interactive-shell, onboarding, overview, processes, runs and unknowns. coverage.md also has a row.
- **Counterpart table.** All 14 top-level proposal files in docs/ appear in the counterpart table. The autonomy-and-decisions, extensions, ADR-006 and ADR-013 rows are accurate against the documents they name.
- **Links.** All links resolve.

## Mechanical sweep

- No em dash, en dash or ` -- ` outside inline code (the only hits are the `--` inside a pgrep pattern and a git argument).
- No delivery history, plan IDs or threat IDs in the prose of any of the three files.
- Paths and module names appear only in the openings.
- Headings are in sentence case.
- No changelog or "last updated" text.

## Read-only proof

`git status --short` shows only `?? .planning/milestone.lock`, which was there at the start. I wrote only /tmp/sl.py, a helper script outside the repository.

## Per document

- docs/system/integrations.md: **needs-changes** (W-A, one behaviour WARNING; OBS-1 and OBS-2 are optional).
- docs/system/overview.md: **pass-with-nits** (W-B, wording only).
- docs/system/README.md: **pass**.
