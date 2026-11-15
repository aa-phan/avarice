# Round 3, group E: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It read the round 2 report only after its own review. Documents: integrations.md, overview.md. Working tree at HEAD 13a7267.

---

VERDICT: PASS-WITH-NITS for both documents. I found no BLOCKER and no WARNING. Three OBS remain, so no further round is forced.

HEAD 13a7267. sha256 of the working-tree files:
- docs/system/integrations.md 2bb8bc2b6d3dac9d713a34427884d1485445d1740447a94f94ee462e0c8dc922
- docs/system/overview.md fd6b77d23bddf0023366b7ca2f51a57acdb16e3614fd94d9f8a32d70161054fe

Severity key: BLOCKER = cannot proceed. WARNING = rework needed; one about a code-behaviour claim forces a round. OBS = worth noting, not blocking.

## Findings

**OBS-1, integrations.md, "macOS sandbox", rule 7 (line 342).**
- Claim: "Give back the metadata (not the contents, not a listing) of each directory above a re-allowed path ... so a program can resolve the real path of a file below it." It is 36 words, one over the hard cap of 35 (references/style.md:7).
- Evidence: this is the only prose sentence over 35 words in either file. Four others in integrations.md sit exactly at 35 (lines 93, 145, 389, 393). The code matches the claim (src/adapters/exec/seatbelt-profile.ts:11-12).
- Fix: cut "(not the contents, not a listing)" to a trailing clause, or split at "so".
- Confidence: high. Round 2 raised the same OBS as optional and it is unchanged. The line is a numbered rule list, which the reference-list length carve-out may cover.

**OBS-2, integrations.md, "Claude Code" section (line 84).**
- Claim: "As observed on 2.1.316 to 2.1.319, the admitted host removes its Glob and Grep tools from a session that has a shell ..." is vendor behaviour that cannot be checked from this repository.
- Evidence: only the launch line is verifiable. It is `--allowedTools Glob,Grep` in src/adapters/host-claude/launch-args.ts:36-60, and the refusal rule is at launch-args.ts:97-114. The doc labels the vendor part "as observed", so it is sourced loosely but honestly.
- Fix: none required.
- Confidence: medium.

**OBS-3, integrations.md, "git" opening paragraph (line 252).**
- Claim: the environment "holds the caller's `PATH`, `HOME` and `LANG`", and filters are blanked for "clean, smudge and process command".
- Evidence: src/adapters/git/safe-git.ts:84-89 substitutes a default `PATH` when the caller's is empty and `LANG=C` when it is empty. safe-git.ts:157-158 also sets `filter.<name>.required=false`.
- Fix: optional. Add "(with defaults when empty)" and name `required`.
- Confidence: high that the detail is missing. It does not change any behaviour a reader acts on.

## Behaviour checks (integrations.md)

Everything below was checked against src/ and found correct.

- **Git tables.**
  - All 7 group rows plus the staging-identity row match the adapters, each argv checked line by line. The adapters are src/adapters/git/repo-facts.ts, run-source.ts, run-workspace.ts, staging-clone.ts, staging-base.ts, staging-worktree.ts and context/freshness.ts.
  - The Run workspace row now reads `log -1 --format=%P%n%B` (run-workspace.ts:232). Round 2 W-A is fixed.
  - The `%T %P` call is at run-workspace.ts:477 and 516.
  - Also correct: `fetch --no-tags --no-write-fetch-head -- <clone> ref:ref` (line 660) and `commit-tree` / `update-ref` with the zero oid (lines 483, 487).
  - `symbolic-ref --short` and `remote get-url origin` exist (repo-facts.ts:223, 196-ish, defaultBranchOf).
  - `config --file <partial>/.git/config --get` is at staging-clone.ts:115.
- **Wrapper rules and timeouts.**
  - Subcommand first and `--config-env` refused anywhere (safe-git.ts:96-103).
  - The clone, fetch and commit option allowlists match the doc table exactly.
  - Timeouts: 10 s default, 60 s run-source listings (run-source.ts:18), 120 s clone, checkout, tree operations and fetch.
  - gc.auto=0 and maintenance.auto=false on fetch (safe-git.ts:~187).
- **Spawn sites.** The spawn grep over src/ finds only the listed ones: sandbox-exec, git, claude (launch and `--version`), node (gsd identity, hook self-test, supervisor), pgrep, ps (reap and ancestry), mount, osascript, launchctl and plutil. There is no `gh` spawn; the `gh` mentions are at conventions.ts:65, invocation-scope.ts:153 and 391.
- **Claude host.**
  - The launch argv and the refusal list match launch-args.ts exactly. The resume swap is correct.
  - The environment matches env.ts, and `extraPath` has no caller in src/.
  - The five admitted versions and the `--version` regex are at launch-preflight.ts:24, 141. The 10 s timeout and the reason names also match.
  - The pgrep pattern and 10 s timeout, the ps group check and the 5 s survivor wait are at claude-host.ts:387-420.
  - The kill grace (10 s), the pipe wait (2 s), the 20 MiB transcript cap, the 16 MiB line cap and the 2000-character tail all match.
  - Outcome ranks 1-8 match domain/outcome.ts:63-72. No caller passes `stateNeedsHuman`, so the doc's three pause signals are right.
- **Supervisor.** spawn-supervisor.ts matches the doc: detached, stdio ignored, cwd the data root, unref, the whole environment plus the three roots, the recorded `CLAUDE_CONFIG_DIR`, and `NODE_TEST_CONTEXT` removed.
- **Composition.**
  - 12 port files plus capability.ts.
  - Only the executor, graph tool, GSD adapter (when found) and host descriptors are recorded, and only when not read-only.
  - The notifier is built only when not read-only.
  - The refusing-host conditions, the `AVARICE_CLAUDE_BIN` and PATH rule, and the `AVARICE_HOOK_ENTRY` rule all match (composition.ts:126-160).
  - The staging strategy is the constant `clone`.
- **Notifier and schedule.**
  - Three `-e` lines, the args after `--`, a 10 s timeout with SIGKILL, and the codes `osascript-missing`, `osascript-timeout` and `osascript-failed`.
  - launchd.ts: paths `/usr/bin/plutil` and `/bin/launchctl`, 10 s per tool, 160-character cut, bootout exits 3 and 113, the rollback on first install, the replaced-but-unloaded case, no RunAtLoad or KeepAlive, and `logs/digest.log` in the data root.
- **Others.**
  - Sandbox probe 5 s then 15 s, with caching only on a clean exit. The 65 and 71 codes, the 5 MiB output limit and the 5 s kill grace match.
  - Proxy status and verdict table, including 502 recorded as allowed, matches allowlist-proxy.ts:153-207.
  - graphify flags and timeouts (300 s, 120 s, 15 s, 64 MiB) match, and the gsd 15 s / 16 MiB / exit 69 claims match.
  - SQLite gate lines 44.6, 50.7, 51.3 and any later line match domain/runtime-support.ts, and `node >=22.22.3` is in package.json.
  - mount command candidates and the 5 s timeout match.
  - `install-host` exits 3/64/70 and the 256 KiB marker rule match, as does the skill text naming `avarice budget` (src/adapters/host-claude/avarice-run-skill.ts:37).
  - Run-workspace constants match: run ID `[A-Za-z0-9_]{1,64}`, identity `AVARICE <avarice@localhost.invalid>`, batches of 200, 10,000 ignored entries and the park ref namespace.
  - The 500-commit conventions walk matches run-source.ts:16.
- **Not independently re-verified.** I read but did not trace to code: the generated-settings key list (line 145), the agent-frontmatter reader details, and the macOS vendor behaviour of launchctl, plutil and Seatbelt beyond the adapter's exit-code handling.

## Doctrine and CLAUDE.md sweep

- No em dash, en dash or ` -- ` outside inline code, in either file.
- Prose sentences over 35 words: only OBS-1.
- No delivery history in the prose of either file. The only hits are legitimate uses: the word "plan" in "plan file name" and "plan checker".
- `src/`-style module paths appear only in the openings. After the opening, only runtime locations remain, for example `skills/avarice-run/SKILL.md`, `logs/digest.log`, `.avarice/config.json`, the LaunchAgents plist path and `/usr/bin/...` tool paths. They describe behaviour, not source modules, so I did not flag them. There are no function names.
- Headings are in sentence case.
- No changelog or "last updated" text.
- `git status --short` shows only `?? .planning/milestone.lock` and three untracked `round-3-B/C/D.md` files. I did not create those; they are other reviewers' output. I edited nothing and wrote only /tmp/sl.py, outside the repository.

## overview.md wording confirmation

- **The edited sentence.** It is now "Everything a contained model does happens inside a clone, under a generated permission set, an OS sandbox and a fail-closed hook. The clone is a staging clone for onboarding and a run clone for a run."
  - Meaning is preserved: the colon list became a second sentence with the same two clone kinds, and no fact was added or lost.
  - The first sentence is 22 words and the second is 16.
- **Longest sentence.** Overview line 5, "When a run cannot finish an item inside its contract it asks the owner instead of guessing, ... local banner.", is 35 words, at the cap. Line 3 is 33. Nothing in the file is over 35.
- **Dashes and history.** No dashes and no delivery history. Paths and module names appear only in the opening (line 3). The remaining backticked items are commands, flags, or the branch name `avarice/<runId>`.

## Round 2 group E items

- **W-A (git argv `log -1 --format=%B`): resolved.** The row now reads `log -1 --format=%P%n%B` with "(the parents, then the message)", matching run-workspace.ts:232.
- **W-B (overview sentence over the cap): resolved.** It is split as round 2 proposed, and the meaning is kept (see above).
- **OBS-1 (36-word sandbox rule 7): not resolved.** It is unchanged and still 36 words; it is repeated above as OBS-1 and is optional.
- **OBS-2 (unverifiable vendor Glob/Grep behaviour): unchanged, still unverifiable.** The "as observed" label was already there; it is repeated above as OBS-2.
- **Round 1 WARNINGs W1-W8:** the round 2 resolutions still hold in the current text. The overview number is absent, the supervisor spawners and environment are right, the agent notes are right, the pause wording is right, the park bullets are right, the ledger list is right, and the notification retry text links out instead of repeating.

## Verdict per document

- docs/system/integrations.md: **pass-with-nits** (OBS-1, OBS-2 and OBS-3).
- docs/system/overview.md: **pass**. The edited sentence is correct and at most 35 words, and I found no nits. It is "pass" rather than "pass-with-nits" because it has no findings of its own.
