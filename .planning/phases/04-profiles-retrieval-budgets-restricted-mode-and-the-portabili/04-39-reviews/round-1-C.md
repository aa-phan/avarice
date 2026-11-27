# Round 1, group C: containment.md, data-model.md, integrations.md

Reviewed digests (sha256, HEAD 8c6eaa7):
- docs/system/containment.md ea33b95dd2d33d662eaa868abe62e22a335c2e17efa9da86d9d3e778c7c68489
- docs/system/data-model.md e7a42e7b88c924a4201a5c6177694e4626b050ccb243e3e9a66471211518af28
- docs/system/integrations.md 5f192d351f1ab4aeae7f6cd4926b64b32d1a5385ee5db469d0d9e076794208f1

Severity: BLOCKER (hard-rule violation, or a claim the code contradicts that cannot stand), WARNING (claim wrong in part, internal contradiction, structural defect, rework needed), NIT (polish).

## Findings

### W1 (WARNING, high confidence) containment.md, "Retrieval budgets", line 372: "Four of them" is wrong

- Claim: "The caps are the nine of the profile's retrieval section ... Four of them are counted for a run and live as budget rows ...: retrieval.searches, retrieval.fullReads, retrieval.fullReadBytes and retrieval.broadDiscovery."
- Evidence: the nine caps are indexEntries, returnedBytes, searchHits, queryTimeoutMs, snippetLines, snippets, fullReads, fullReadBytes and maxPages (src/domain/retrieval-rules.ts:70-80). searches and broadDiscovery are not among the nine; the contract adds them (src/domain/run-contract.ts:111, :349). Only two of the nine become rows. docs/system/config-reference.md:121 says so ("adds two retrieval counters of its own"), so the two documents disagree.
- Fix: "Two of the nine (retrieval.fullReads and retrieval.fullReadBytes) are counted for a run, and the contract adds two counters of its own (retrieval.searches and retrieval.broadDiscovery); the four live as budget rows beside the five budgets."

### W2 (WARNING, high confidence) integrations.md, "Verbs driven", line 256 contradicts line 236 and the code

- Claim (line 256): "The adapter publishes a capability list: init-onboard, map-full, map-fast, stamp and verify-drift are true; map-paths and ingest-docs are false; initializing planning is unsupported."
- Evidence: line 236 of the same document says map-paths, adopt-map, stamp and verify-drift are true and ingest-docs false. The code has 'map-paths': true and 'adopt-map': true (src/adapters/gsd/gsd-onboarding.ts:56-66). Line 256 omits adopt-map and has map-paths wrong.
- Fix: delete the capability sentence at line 256 (one fact, one home at line 236). Keep "initializing planning is unsupported" only if wanted (src/adapters/gsd/gsd-onboarding.ts:382).

### W3 (WARNING, medium-high confidence) Live-run observations stated as fact, dated, and contradicting containment.md's own limit

- containment.md line 139: "Live runs on 2.1.326 (2026-11-17 and 2026-11-18) showed the host accepting --restricted beside --setting-sources and --strict-mcp-config, its tool list holding no shell and no web fetch, the hooks still running under the flag, and the file tools writing only inside the clone."
- integrations.md line 88: "As observed on 2.1.316 to 2.1.319, the admitted host removes its Glob and Grep tools from a session that has a shell ..."
- Evidence: neither claim traces to code or a test at HEAD (the only code trace is a comment at src/adapters/host-claude/stream-json.ts:122 and the launch-line allowed-tools rule). containment.md line 535 says "Results of live runs against real host versions are runtime evidence and are not asserted here", and line 530 says AVARICE proves flags are listed, not behavior. The dates are delivery history in prose.
- Fix: state only the code-checkable part (the launch line names the allowed tools Glob and Grep; AVARICE checks that --restricted is listed). Move the live-run outcome to findings.md or unknowns.md as one cited, dated line, or mark it as a source-wanted gap. Drop the dates from prose.

### W4 (WARNING, medium confidence) containment.md line 145: "seven files, about 56 KB, on GSD 1.17" has no source in code

- Evidence: src/domain/restricted-specs.ts computes the file set as a transitive closure of three seeds, capped at 32 files and 512 KiB, and refuses the whole set when a cap is exceeded (lines 20-28, 70-74). The figures seven and 56 KB appear only in a planning summary (.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-34-SUMMARY.md:59), not in code or a test. The document omits the caps and the refusal.
- Fix: replace the figures with the mechanism ("the closure of three seed specs, refused whole above 32 files or 512 KiB"), or cite a test that pins the count. Drop "on GSD 1.17".

### W5 (WARNING, medium confidence) data-model.md line 60: migration labels are delivery history

- Claim: "Version 2 (the run) ... Version 3 (decisions, independent work and amendments) ... Version 4 (status indexes and approval guards)".
- Evidence: the labels are the delivery phase titles, not what the migration files say (src/adapters/sqlite/migrations/0002-run.ts, 0003-decisions.ts, 0004-profiles.ts). The counts are right (v1 20 tables and 4 triggers; v2 3 tables, 4 columns, 2 indexes, 4 triggers; v3 1 table, 4 columns, 2 indexes; v4 5 indexes, 2 triggers), so only the parentheticals are wrong in kind.
- Fix: delete the parentheticals, or describe each migration by what it adds.

### W6 (WARNING, high confidence) Sentences over the 35-word hard cap

A mechanical count (code spans collapsed, tables and code fences excluded) finds about 34 sentences over 35 words: containment.md 16, data-model.md 12, integrations.md 6. The worst: containment.md line 3 (96 words, the module list), line 518 (about 100, the redaction boundaries), line 179 (82, the deny list), line 178 (60), line 188 (56), line 145 (49), line 402 (49); data-model.md line 147 (about 69, the approval row), line 141 (54), line 265 (56, step names); integrations.md line 45 (57), lines 145, 193 and 236 (42 to 49).
Fix: split at the semicolons. Lists of names (data-model.md lines 141 and 265, containment.md line 3) may become bullet lists, which the length rule exempts.

### W7 (WARNING, medium confidence) One fact, one home: large blocks stated twice with drift risk

containment.md and integrations.md both own the same facts:
- the verified version list and unverified-patch rule (containment.md line 87; integrations.md lines 11 and 145, near-verbatim);
- the host environment (containment.md lines 196-205; integrations.md line 97);
- the outcome classification (containment.md lines 114-122; integrations.md lines 126-135, seven rules against eight);
- the Seatbelt profile order (containment.md lines 409-420; integrations.md lines 346-358);
- the hand-off fetch and the safe-git environment (containment.md lines 470-488; integrations.md lines 264 and 306-312);
- reaping by session ID (containment.md line 60; integrations.md line 163);
- the launch refusal list (containment.md lines 89-98; integrations.md lines 88-95).
W2 shows the drift this causes. Fix: pick the owner per fact (containment.md for enforcement rules, integrations.md for the external system and its command line) and replace the other copy with a link.

### N1 (NIT) containment.md line 3

The opening names modules once, as the house rule allows, but as one 96-word sentence of about 40 paths. Make it a bullet list.

## Checked and found correct (not findings)

Mechanical sweep: no em dash, en dash or spaced double hyphen in prose in any of the three documents (the occurrences are inside code spans); no phase numbers, plan IDs, threat IDs or ADR references in prose; no function names in prose; every in-document and cross-document link and anchor resolves (script check); headings are sentence case and name content.

Code-verified claims (sampled across all three documents):
- Verified host versions, the seven launch help flags, the six restricted flags plus the onboarding pair, the restricted refused flags (src/domain/host-admission.ts, src/adapters/host-claude/launch-args.ts); hook timeout 5 s and GSD guard 10 s (settings.ts:60, :133); pgrep 10 s and ps 5 s (claude-host.ts:456, :468); transcript cap 20 MiB, final text tail 2000, parser line cap 16 MiB; install timeout 15 min (src/app/checks.ts:388); GSD default timeout 15 s and output 16 MiB; graphify timeouts 5 min, 2 min, 15 s; git default timeout 10 s; hook busy wait 4 s and CLI 5 s.
- 38 rule IDs (re-ran the coverage.md command: 38); eleven read-only commands, sixteen denied prefixes, ten find actions; loop-limit presets 3 and 25; subagent budget 10 per item and concurrent cap 2; the seven config-set values for a run; the scope-of-writes and head-moved findings with the ten-path cap (src/app/run-stages/blocked.ts:60); activation-scope and staging-head-moved.
- Owner-command identity checks, order and messages (src/cli/identity.ts and the cancel, decide, approve, schedule refusals); the attended hook marker; the restricted descriptor capabilities (restricted-invocation, headless, no resume).
- data-model.md: 24 tables, the 20/3/1 split over migrations, 10 triggers, the index lists, profile_id insert-or-ignore, 50 event kinds (the document's kind set equals the code's event types), 13 artifact kinds (context-pack is a redaction-list entry no code writes, correctly absent), 25 fixed run step names, run step statuses, approval 30-minute expiry, history cap 1000, event size limits 1024 and 8192, status view hides retrieval rows.
- integrations.md: fifteen port files split twelve and three, the capability list at line 236, avarice budget not being a command, Node 22.22.3, restricted start refusal.

Not verified line by line: the git option rules 11-13 of the Bash identity section and the proxy address ranges in containment.md; the full onboarding step-name list and the project record paragraphs in data-model.md; the git command table in integrations.md. coverage.md records earlier fresh reviews of these.

Verdict: FAIL
