# Round 3, group C: containment.md, data-model.md, integrations.md

Reviewed digests (sha256):
- docs/system/containment.md 2a9e13df7df1270f9b05af7876d582c9e3b99be40d27077df7973155c6c4cdc1
- docs/system/data-model.md 65f171c312db5d2ee693d10866538cbe9a806d3b050345b5518d4b831d504f65
- docs/system/integrations.md 94dec0d4e7890e44250eb1a5c38206b0ba04bd942f2c857df6cb004023679170

Severity: BLOCKER (hard-rule violation or a claim the code contradicts, with no qualifier that saves it), WARNING (loosely supported claim, internal contradiction, hard-cap breach, structural defect), NIT (polish).

## Earlier WARNINGs

- Round 1 C-W1 to C-W7: stay resolved (retrieval counts, capability list, live-run sentence, restricted-seed refusal, migration counts, one-fact links). Migration counts re-checked against the four migrations: v1 20 tables and 4 triggers; v2 3 tables, 2 indexes, 4 triggers, 4 runs columns; v3 1 table, 2 indexes, 4 columns; v4 5 indexes, 2 triggers.
- Round 2 F1 (Glob and Grep removal stated flatly): resolved in substance. containment.md (launch-line list) and integrations.md ("Direction and invocation") both say a code comment records it and no test checks it (src/adapters/host-claude/launch-args.ts:30-33). The rewrite created W2 below.
- Round 2 N1, N2, N3: resolved (malformed span fixed; data-model blank line present; the wrapper sentence now links to containment.md).

## Findings

### W1 (WARNING, high confidence) integrations.md, "Node.js and node:sqlite", first paragraph

- Claim: "There is no explicit Node version comparison at runtime; the gate is on the SQLite that Node bundles."
- Evidence: `doctor` compares the running Node version with the package's engines rule (src/app/doctor.ts:219 `nodeSatisfies`, used at :697, error at :699 "does not satisfy the engines rule"). doctor.md lists the same check ("Node does not satisfy the engines rule"). The claim is true of ledger open only.
- Fix: scope it: "The ledger open makes no Node version comparison; its gate is on the bundled SQLite. `doctor` is the one place that compares the Node version with the engines rule."

### W2 (WARNING, high confidence) integrations.md, "Direction and invocation", line 88

- Claim: the sentence "A code comment records that the host removes its Glob and Grep tools from a session that has a shell, and from every agent that session starts, unless the launch line names them as allowed tools." is 36 words; the hard maximum is 35 (references/style.md line 7). It is the only sentence over the cap in the three documents (counted with code spans as one word, bold markers and tables excluded).
- Evidence: word count of the sentence as quoted.
- Fix: cut "every": "...and from the agents that session starts, unless the launch line names them as allowed tools" (35), or split before "unless".

### W3 (WARNING, medium confidence) containment.md, "Retrieval budgets", opening paragraph versus its last paragraph and "Quirks to know"

- Claim: "Two of the nine, `retrieval.fullReads` and `retrieval.fullReadBytes`, are counted for a run." The same section says the two rows "are therefore created and never spent", and Quirks says "The retrieval caps `fullReads` and `fullReadBytes` are counted nowhere".
- Evidence: the contract carries both counters (src/domain/run-contract.ts:111, :349), but no production caller spends them; the whole-file guard has no caller outside tests, as the document itself says. "Counted" and "counted nowhere" read as a contradiction.
- Fix: in the opening, say "Two of the nine, `retrieval.fullReads` and `retrieval.fullReadBytes`, have a row in the run's ledger, which nothing spends (see below)", or drop "counted for a run".

### N1 (NIT) one fact, one home

- data-model.md "The ledger file", Runtime gate, and integrations.md "Node.js and node:sqlite" both list the full SQLite version thresholds (3.44.6, 3.50.7, 3.51.3, nothing on 3.45 to 3.49). Keep the list in one and link from the other. The local-mount rule is stated in data-model.md (resolution rules), containment.md (root placement) and integrations.md (mount); the 5 MiB output cap and the 5 s then 15 s probe retry are in both integrations.md and containment.md. All agree with the code today (src/domain/runtime-support.ts, src/adapters/exec/sandboxed-executor.ts:21-23, src/ports/command-executor.ts:9).

### N2 (NIT) integrations.md line 88 versus containment.md launch-line list

- The Glob and Grep comment is stated at length in both documents. integrations.md could say "see containment.md" and keep only the command line.

## Checked against code and found correct (not findings)

- Mechanical: no em dash, en dash or spaced double hyphen outside code spans in the three documents; no phase, plan, threat or ADR IDs; headings in sentence case; no changelog or last-updated text; openings name modules once; no function names in prose.
- containment.md: six verified versions and minor floor 312 (host-admission.ts:8, :11); 16 denied prefixes, 11 read-only commands, 10 find actions, never-granted words (invocation-scope.ts:86-165, conventions.ts:65); loop presets 3 and 25 (run-contract.ts:118); subagent 10 per item, concurrent 2 (run-contract.ts:99, :103); prompt cap 32 KiB (run-gsd-config.ts:53); 20 MiB transcript, 10 s grace (claude-host.ts:40-41); pgrep 10 s, ps 5 s, 5 s after SIGKILL (claude-host.ts:456-490); executor grace 5 s, 5 MiB output, probe 5 s then 15 s; proxy ranges, status codes and the NAT64 and mapped handling (allowlist-proxy.ts:79-107, :155-208); owner-command identity order and the three commands that apply checks 1 and 3 (identity.ts:24-40; context, evidence, pr); five owner commands.
- data-model.md: 24 tables, 10 triggers, index lists, ID prefixes (ids.ts:9), 50 event kinds (every kind found in code, and no code kind missing from the table), approvals triggers (0004-profiles.ts), busy waits (db.ts:165), event caps 1024 and 8192 (events.ts:14-15), shell history cap 1000, 64 KiB config files, approval expiry 30 minutes, 13 stored artifact kinds (code stores no context-pack artifact).
- integrations.md: gsd-tools 15 s and 16 MiB, graphify 300 s, 120 s, 15 s and 64 MiB, stream-json 16 MiB line and 2 s pipe wait, run-source 500 candidates, 256 KiB, 60 s and 120 s timeouts, ignored cap 10,000 and restore batches of 200, run ID 64 characters, osascript codes and 160-character cut, launchctl exits 3 and 113, install-host exit codes and size caps, refusing-host 200-character reason, the capability list (ingest-docs false), the skill text naming `avarice budget` while no such command exists.
- Not verified line by line: option rules 11 to 13 of the Bash identity section in full, the command table rows, the onboarding step-name list, the full list of credential locations (spot-checked).

Verdict: FAIL
