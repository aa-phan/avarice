# Round 2, group C: containment.md, data-model.md, integrations.md

Reviewed digests (sha256):
- docs/system/containment.md 9688bc8432ad75213f9a298fc0ef35a97c6ddbf94de906c51456b51e289af414
- docs/system/data-model.md abbd06a06e8f6911d7e5a498f3d2dcc52a88d4b846b10d051bc86176470c1742
- docs/system/integrations.md f7f9a9ba08f99005c558c6441fd4e43bcf5a79b5df21d155e04914386a2b1d5d

Severity: BLOCKER (hard-rule violation or a claim the code contradicts), WARNING (claim only loosely supported, contradiction, structural defect), NIT (polish).

## Round-1 WARNINGs

- C-W1 (retrieval counts): resolved. containment.md "Retrieval budgets" now says two of the nine are counted and the contract adds two (src/domain/run-contract.ts:111, :349).
- C-W2 (capability list): resolved. integrations.md states the list once (map-paths and adopt-map true, ingest-docs false) and it matches src/adapters/gsd/gsd-onboarding.ts.
- C-W3 (live-run observations): partly resolved. The dated live-run sentence is gone from containment.md and sits in unknowns.md. A residual flat claim remains (F1 below).
- C-W4 (seven files, 56 KB): resolved. containment.md "What a restricted run and onboarding do" gives three seeds and the 32-file or 512 KiB refusal (src/domain/restricted-specs.ts:14, :17-18).
- C-W5 (migration labels): resolved. data-model.md "Migrations and schema version" has counts only; they match the migrations (v1 20 tables and 4 triggers; v2 3 tables, 2 indexes, 4 triggers; v3 1 table, 2 indexes; v4 5 indexes, 2 triggers).
- C-W6 (sentence length): resolved. A scan (code spans collapsed, tables and fences excluded) finds no sentence over 35 words in the three documents.
- C-W7 (one fact, one home): resolved in substance. integrations.md now links to containment.md for refusals, environment, outcome rules, kill sequence, versions, git safety, hand-off and Seatbelt order. Two small residues are in N3.

## Findings

### F1 (WARNING, medium confidence) containment.md, "How a launch is assembled", launch-line list item

- Claim: "the allowed tools Glob and Grep, which the host would otherwise remove from a session that has a shell and from the agents it starts".
- Evidence: the only source is the code comment above SEARCH_TOOLS_ALLOWED (src/adapters/host-claude/launch-args.ts:30-33); no test checks it. The same document says host behavior is not asserted ("Results of live runs against real host versions are runtime evidence and are not asserted here", "Limits of containment") and integrations.md hedges the same fact ("recorded as ... No test checks this"). The two documents state one fact at two confidence levels.
- Fix: hedge to match integrations.md ("which the host is recorded as removing ...; no test checks this"), or state only the checkable part: the line names Glob and Grep as allowed tools, and launch judgment refuses any other value.

### N1 (NIT) integrations.md, "Direction and invocation", line 88

- The paragraph opens with a malformed code span (two opening backticks, one closing), so it renders wrongly. Related: "is recorded as removing" names no recorder.
- Fix: open with a single backtick, and say a code comment records it.

### N2 (NIT) data-model.md, "Adapter descriptors", line 148

- A line beginning with a space ("The restricted host is built beside the host ...") follows the bullet list and renders as a lazy continuation of the last bullet (the install-host pair). Fix: remove the leading space and add a blank line before it.

### N3 (NIT) integrations.md residual duplication

- Line 238 restates the safe-git environment variables that containment.md "git safety" owns; lines 94 and 135 restate resume and reap rules that containment.md owns. They agree with the code today (src/adapters/git/safe-git.ts:34, claude-host.ts:456), but each is a second home. Fix: replace the git environment sentence with a link, keeping only the timeouts, which are the integration's own.

## Checked against code and found correct (not findings)

- Mechanical: no em dash, en dash or spaced double hyphen outside code spans in the three documents; no phase, plan, threat or ADR references; headings in sentence case; no changelog or last-updated text; each opening names modules once; no function names in prose.
- containment.md: six verified host versions and the seven required help flags (src/domain/host-admission.ts:15-23); restricted flags and the onboarding pair; the restricted line order and refused-flag list (launch-args.ts:193-232); retrieval rows and override names (run-contract.ts:111, :294, :349); the whole-file guard has no caller outside its own file; pgrep 10 s.
- data-model.md: 24 tables (20+3+1), 10 triggers, index lists, ID prefixes (src/domain/ids.ts:9), 50 event kinds in the table, 25 fixed run step names (counted), SQLite version gate (src/domain/runtime-support.ts), busy waits 5 s and 4 s (db.ts:165, pre-tool-use.ts:34).
- integrations.md: osascript 10 s, plutil and launchctl 10 s, mount 5 s, git 10 s, 60 s and 120 s timeouts; the skill text naming `avarice budget` (avarice-run-skill.ts:37) while no such command exists; restricted line and host fallback.
- Not verified line by line: git option rules 11-13 of the Bash identity section, proxy address ranges, the full onboarding step-name list, the git command table, graphify flags. Round 1 sampled these and nothing since touches them. The link-and-anchor script could not run in this sandbox; anchors were spot-checked by eye (no broken target seen).

Verdict: FAIL
