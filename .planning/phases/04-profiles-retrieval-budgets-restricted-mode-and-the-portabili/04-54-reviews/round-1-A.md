VERDICT: FAIL (1 BLOCKER, 7 WARNING, 6 NIT)

# Review round 1, group A

- Group: A (policy and approvals, approve flow, doctor, profiles, findings)
- Round: 1
- Reviewer: fresh
- Date: 2026-11-22
- Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04
- Doctrine applied: technical-writing, reviewing-technical-prose (style.md, truth.md), and the CLAUDE.md "Documentation" section.

## Digests as read

Every digest matched the one in the dispatch.

| Document | sha256 |
|---|---|
| docs/system/policy-and-approvals.md | 4613ac8b66aca649ac95179b1b79ab72f455fc40bc97fd47d92ffbfb5f9a9f9d |
| docs/system/diagrams/approve-privileged-action.puml | f18ec888c1e2cd1db95a3dd960c4df5e1ae5cd49fee0951fe48252ab31e9d25d |
| docs/system/processes.md | 6600cb9ca1fd1ba76a775f021a0af2743ba03aa0fb0da03aeafc72b2c8f412fd |
| docs/system/doctor.md | 215bba2b3345e44eff89e61c0b9a9d470c2b53c8e01839f6efd69ba456f9f1e9 |
| docs/system/profiles-and-credentials.md | 7aab552cf430b8a96e285323f3af0f2bd7e4880b1e84c70fdf8f9c9b05be7b4c |
| docs/system/findings.md | 8aeb50be9c39704d131e2d288aed191fa3a29aedc815614187624e979da0595c |

Severity as used here: BLOCKER is a factual error against the code. WARNING is a misleading or unsupported claim, or a doctrine violation. NIT is polish.

## Findings, most severe first

### BLOCKER

**B1. doctor.md:88. The `host-version-unknown` distinction is false.**
- Problem: the text says "`host-version-unknown` cannot appear in doctor's report ... The launch preflight does report it." Both paths apply the same rule, so both can report either label.
- Evidence:
  - Doctor reads the version with `/^\s*(\d+\.\d+\.\d+)\b/` (src/app/doctor.ts:233, 358-363) and passes it to `admitHostVersion`.
  - The launch preflight uses the same regex, then the same function (src/adapters/host-claude/launch-preflight.ts:162-166).
  - `admitHostVersion` returns `host-version-unknown` when `parse` fails (src/domain/host-admission.ts:49-72).
  - `parse` fails when a component is not a safe integer, for example `99999999999999999999.0.0`. That version passes the regex and is refused as `host-version-unknown` in doctor's `refusal` field.
  - A four-part answer such as `2.1.318.4` is read as `2.1.318` in both, because of the `\b`.
- Confidence: high that the two paths are identical, medium that the overflow case matters in practice. The sentence is still false as written.
- Fix: replace the last two sentences with one that is true for both. Example: "An answer that does not start with three numbers is `host-version-unreadable`; a first component too large to compare is `host-version-unknown`. The launch preflight applies the same two rules."

### WARNING

**W1. profiles-and-credentials.md:11. Repository policy is listed as a class difference.**
- Problem: "The class changes four things ... An enterprise profile's own policy and a repository's policy can only tighten." The repository half is not class-dependent, and it contradicts policy-and-approvals.md:42 ("The repository policy only tightens under every profile").
- Evidence: src/domain/policy.ts:205-221. The loop applies repository rules as stricter-only for every profile class.
- Fix: write "An enterprise profile's own policy can only tighten." Leave the repository rule to policy-and-approvals.md (one fact, one home).

**W2. doctor.md:32. "The `--json` keys do not change."**
- Problem: the sentence implies a previous state, which the house rule bars ("describe current behavior, never the previous"). It also asserts nothing checkable. A reader cannot tell which keys.
- Evidence: the extensions section holds `activeConfigDir` and `configDirs` (src/app/doctor.ts:158-160, 671-673). The entry check adds findings only.
- Fix: delete the sentence, or replace it with "The check adds findings only; the `extensions` keys are `activeConfigDir` and `configDirs`."

**W3. policy-and-approvals.md:98 and :120 vs the run path. 65,536 characters is not the limit a run applies.**
- Problem: the doc gives 65,536 characters as the point past which a line "cannot be checked". The attended hook uses that limit (src/domain/privileged-commands.ts:68, 419).
- Evidence: in a run, src/domain/hook-decision.ts:139 sets `MAX_COMMAND_CHARS = 16_384`. Line 810 refuses any line over it as `shell-syntax` before `classifyLine` runs (814).
- Effect: a reader of line 120 would expect a 20,000-character line in a run to be classified. It is refused outright.
- Fix: add one sentence to the "In a run" paragraph, for example: "A run refuses any line longer than 16,384 characters as `shell-syntax` before the classifier reads it."
- All the other limits I checked in this document match the constants (see "Limits verified" below).

**W4. profile-isolation row of the enforcement map disagrees with the code row, and no findings line records it.**
- Locations: policy-and-approvals.md:163 against src/domain/enforcement-map.ts:73-79.
- Problem: the code row's limit says a profile moved by an environment variable "is not covered by the sandbox denial". The doc says it "is covered only when its configuration is found".
  - The doc matches the current registry (src/adapters/fs/profile-registry.ts, and the "No longer holds" note at findings.md:101).
  - The code table text is stale.
  - CLAUDE.md requires one `file:line` line in findings.md when code and docs disagree. None exists. Lines 270 and 271 cover other rows of the same table.
- Fix: add a findings line citing src/domain/enforcement-map.ts:79 against profile-registry.ts. Alternatively, the doc could say it mirrors the table, but the doc should state behavior and the disagreement should be logged.
- Confidence: medium.

**W5. Hard sentence cap (35 words) exceeded in running prose.**

| Location | Words |
|---|---|
| policy-and-approvals.md:94 ("It is read the same way when its delimiter is quoted, so ...") | 37 |
| policy-and-approvals.md:96 ("Before the program the classifier skips assignments ...") | 41 |
| policy-and-approvals.md:98 ("A line cannot be checked when it is longer than ...") | 56 |
| policy-and-approvals.md:103 (bullet) | 37 |
| policy-and-approvals.md:127 ("The denial names a request for each command ...") | 38 |
| policy-and-approvals.md:142 ("The gate enforces this at the start: ...") | 41 |
| doctor.md:32 ("Each attended entry is also read back: ...") | 39 |
| profiles-and-credentials.md:26 ("The new registry is written to a temporary file ...") | 37 |
| profiles-and-credentials.md:67 ("When the system refused the read ...") | 46 |
| profiles-and-credentials.md:67 ("A profiles directory that cannot be listed ...") | 40 |
| processes.md:134 ("For a privileged form in a run, the hook writes ...") | 37 |

- Method: I stripped bold markers and excluded fences, headings and table rows. The sentence at policy-and-approvals.md:98 is a list of five conditions and splits naturally into two or three sentences.
- Fix: split each at its colon or comma-joined clause.
- findings.md also has about 23 long sentences. All are single-line log entries; see O1 below.

**W6. findings.md: cited `file:line` values that do not say what the line claims.** The file's own header says a line that moved carries "(now at ...)". These do not:
- Line 267: `src/app/authorize.ts:95` is `} catch {`. The `evaluatePolicy` call is at :100.
- Line 268: `src/app/authorize.ts:134` is `const contract = input.contractAuthorization;`. The `approvalSource` gap is where the gate uses only `decision.ruleId` and `decision.effect` (:100-105, :164).
- Line 277: `src/domain/hook-decision.ts:516` is the tail of a comment, and `:648` is `shortAttached: 'u',`. The `shell-not-allowed` refusal is at :530. The consecutive-denials note is at :662.
- Line 262: `src/cli/composition.ts:290` is `transcripts: inputs.transcripts,`. `osascriptPath` is read at :570.
- Line 260: `src/adapters/schedule/launchd.ts:263` is `} finally {`. `bootout` and `bootstrap` are at :272 and :275.
- Lines 131, 143, 255, 258: "now at `src/app/run-stages/item.ts:388`/`:390`" land on `sharedChoiceOptions` and `ownerChoiceItems`. `detectPause` and the `question` read are at :424.
- Lines 91 and 189: "now at `src/domain/hook-decision.ts:839`" is a closing `}`.
- Check run: every cited path exists and every line number is within the file (scripted over all lines of findings.md). Group A content lines 267-292 and 357 were checked against the code. Of these, only lines 267, 268 and 277 have wrong cites; the others hold.
- Fix: re-anchor these cites to HEAD and mark moved ones "(now at ...)". Line 267 would read `authorize.ts:100`.
- Confidence: high for the cites listed. The rest of the file was spot-checked (about 28 cites), with roughly a third drifted.

**W7. findings.md: one fact written twice.** The same observation appears in two sections:
- 69 and 214: `findGraphifyBinary`.
- 72 and 215: graphify version.
- 73 and 216: fixed PATH.
- 74 and 217: reaping `pgrep`.
- 75 and 218: transcript redaction.
- 76 and 219: cached descriptor.
- 77 and 220: `gh pr create` proposal.
- 60 and 198: carrier `runs` row.
- Line 74 even says "repeated under From integrations (run slice)".
- Fix: keep one home per observation. Where the later wording is newer, move it into the earlier line and delete the copy.

### NIT

**N1. processes.md:131.** The covered commands are "a push, a pull request create, merge or edit, a release, and a write through the platform API". A package publish is missing. The diagram (puml:14) and policy-and-approvals.md:83-92 include it. Fix: add "a package publish".

**N2. processes.md:136 and approve-privileged-action.puml:52.** The text puts "one use, 30 minutes" in quotes as if it were printed. src/cli/commands/approve.ts:80 prints `grants:  one use of <action> with exactly these parameters, for 30 minutes`. Fix: drop the quotes or quote the real line.

**N3. approve-privileged-action.puml:78-80.** The last branch lumps "a changed line or another directory" under "a new request, since the earlier one was answered". A changed line or directory is a different digest, so it gets its own request (or names a waiting one). Only expiry, revocation and use fit "answered". Fix: split the branch, or reword the Ledger label to "a request for these parameters".

**N4. profiles-and-credentials.md:63.** "under a `.claude` directory of the home" is narrower than the rule. src/domain/root-rules.ts:36-40 refuses any first segment under home that starts with `.claude`, such as `.claude-edu`. Fix: "under a `.claude*` directory".

**N5. policy-and-approvals.md:205-206 repeat lines 94 and 127.** The Quirks bullets restate body text (one fact, one home). Fix: keep the quirks as pointers, or delete the duplicates.

**N6. policy-and-approvals.md:32-34 omits two rule constraints.** `when` parameter names must be a letter followed by up to 31 letters or digits (policy.ts:66, `PARAM_KEY`). `approvalSource` must be 1 to 32 lower-case letters, digits or hyphens (:67). Everything the doc does state matches. This is an omission only.

### Observation

**O1. findings.md delivery history.** CLAUDE.md keeps phase numbers, plan IDs and finding or threat IDs out of docs/system prose.
- Lines 337 and 338 carry "owner ruling 2 of plan 04-35" and "owner ruling 4 of plan 04-35".
- Lines 296-300 list commit hashes under "edited on this branch".
- Lines 11, 139 and 142 quote strings with "Phase 1", "(D-11)" and "Phase 2".
- Many "No longer holds at <sha>" entries are retained as history. SHAs as claim evidence are allowed, but the resolved entries describe previous behavior.
- I did not raise this above OBS, because findings.md describes itself as owner working material and may be exempt. Please confirm the intent. If it is not exempt, lines 296-300, 337 and 338 are the clear violations.

## Limits verified against the code

Each of these matches.
- **Policy and approvals:**
  - 65,536 characters (privileged-commands.ts:68).
  - 8 nesting levels (:69, :336).
  - 16 prefix words (:461, :515, :566). "More than 16" is correct, since the 17th word refuses.
  - 5-second timeout (attended-hook-install.ts:41).
  - Session ID 1-100 characters of `[A-Za-z0-9_.-]` (pre-tool-use.ts:604).
  - 30 minutes (approval.ts:9), 80/400 summary caps (:15-16), and 26-character IDs (ids.ts).
  - 256 rules, 64 KiB, `when` 1-8 entries, 128-character values, name 1-64 (policy.ts:61-66).
  - 40-hex pin (policy-sources.ts:15).
  - 22 action names (15 privileged, 3 read, 4 local-write), and the 18-row enforcement map.
  - 16,000-byte excerpt, 200-character source, 2 MiB evidence (manual-inputs.ts:37-40).
- **Doctor:**
  - 1-second probe timeout and 8-second online timeout (probes.ts:19, 21).
  - One-hour repair age (doctor.ts:190), under 2 seconds (test/integration/doctor.test.ts:111-119).
  - 7 launch flags and 6 restricted flags (host-admission.ts:15-35).
  - 11 finding areas.
- **Profiles:**
  - Org name 1-31 characters (profile.ts:17).
  - Registry cap 1,000, 64 KiB, mode 0600 (profile-bindings.ts).
  - Lock wait 2 s (:147).
  - 64 patterns of 256 characters (:21-22).
  - `limits` has 6 keys, `retrieval` has 9, with a concurrent-check cap of 2.
  - `organizationFile` max 1,024 (composition.ts:157).
  - Root strings max 4,096 (profile.ts:125).
  - Credential names 1-128 characters (credential-ref.ts:19).
  - keychain and cmd 5-second timeouts and 16 KiB caps (keychain.ts:17-19, cmd.ts:20-24).
  - 8-character seed minimum (handle.ts).
  - Audit field cut at 160 characters (credentials.ts:34).
- **Policy order and moved-root denial:**
  - The moved-root denial order matches: permission refusal denies the whole profile root, any other read failure stops with exit 70, and a corrupt config is skipped (profile-registry.ts:88-96, composition.ts:313).
  - The exit-70 message matches (composition.ts:313).
  - The permission-refused case matches (profile-config.ts:32-35).
  - The approve command's exit codes and its before-profile refusals match.

## Checked and deliberately not flagged

- **Dashes:** no em dash, en dash or ` -- ` appears in prose in any of the six files. The ` -- ` in findings.md lines 74 and 217 sits inside a code span (`pgrep -f -- ...`), which is exempt.
- **Delivery history in the four prose documents:** none (no phase, plan or threat IDs).
- **Headings:** all in sentence case. No question headings. Each opening names modules once, as CLAUDE.md allows.
- **Links:** every relative link and anchor in the four documents resolves (scripted). The puml `alt` and `end` blocks balance.
- **Enforcement-map table:** the doc's rows are condensed paraphrases of the code rows. They carry no false claim except the W4 limit, and the closing paragraph (policy:173) holds.
- **Privileged-command rows:**
  - The seven-forms count holds (the `gh release create` and `npm publish` row is one table row).
  - The wrapper list, shell list and npm abbreviation behavior match.
  - The `gh api` body-from-file rule matches (`name=@file`).
  - The attended four-outcome order matches the code.
  - Duplicate-command handling matches the code (the one waiting request is named twice).
  - The gate order and the `approvalSource` limitation match.
- **Doctor:** the extensions probe and the attended-entry finding match the code (regular-file check follows links, `install-host` command form only, error level, exit 3, fix text). Only the sentence at :32 about JSON keys is flagged (W2).
- **Not content-checked:** the rest of processes.md (the other eight flows, outside this group's brief), and the semantics of the findings.md lines outside the group-A section. I checked those for path and line-range existence only.

## Sweep after the run

- My run wrote only helper scripts under /tmp (`chk-cites.py`, `show.py`, `sent.py`, `anch.py`) and modified no repository file.
- `git status --short` shows only untracked files:
  - `.planning/config.json` and `.planning/milestone.lock`, both listed in the initial gitStatus.
  - `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-1-B.md` and `round-1-D.md`. These are reports from concurrent reviewers, not mine. They appeared during my run.
- No tracked file is modified.

VERDICT: FAIL. 1 BLOCKER (B1), 7 WARNING (W1-W7), 6 NIT (N1-N6), 1 observation (O1).
