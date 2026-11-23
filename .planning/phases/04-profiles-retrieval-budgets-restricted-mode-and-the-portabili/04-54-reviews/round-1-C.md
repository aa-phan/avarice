round-1-C.md

Group: C
Round: 1
Reviewer: fresh
Date: 2026-11-22
Binding: all four digests matched the dispatch before review. Tree: /Users/aphan/avarice/.claude/worktrees/phase-04, HEAD 826ed28.

| Document | sha256 as read |
|---|---|
| docs/system/containment.md | bed1886525aacb7654d7665439f13cc74cd021c0fd90c10373bcef6703afa901 |
| docs/system/data-model.md | f1eecef5b28def08309c4f3d5a5ce07d9f997ede3262ff743374aee557c23bae |
| docs/system/integrations.md | cb3ae44f51034f00e2d8b886999e7f5b2b2c84c1003214fb06b61f46e20ed894 |
| docs/system/unknowns.md | 9b444a7440670e4b0097645424a465523e6f3d6e2edfc605a945a81a684611d7 |

Severity as dispatched: BLOCKER = factual error against the code; WARNING = misleading or unsupported claim, or doctrine violation; NIT = polish.

VERDICT: FAIL. 8 BLOCKER, 8 WARNING, 4 NIT.

## BLOCKERS

**B1. containment.md:568 (Limits of containment, "Another profile's roots"). Onboarding is said to deny the default AVARICE parents. It does not.**
- Problem: "A run and an onboarding deny reads of their own profile's data root and work root. They also deny reads of the default parents of every profile's roots." Only the run scope denies the default parents.
- Evidence: the onboarding scope builds `denyRead = [repo, dataRoot, ...credentialPaths(home), workRoot, ...profileRoots]` (src/domain/invocation-scope.ts:304, no `defaultAvariceParents`). The run scope adds `...defaultAvariceParents(home)` (src/domain/invocation-scope.ts:570). The document itself says at :213-214 "Every run sandbox denies..." and at :282 "For a run the default AVARICE parents are denied too".
- Fix: say the run denies the default parents. Say both purposes deny the other profiles' roots found in the configurations.

**B2. containment.md:401 (Retrieval budgets, "Broad discovery"). The hook's definition of a broad discovery is wrong for Grep.**
- Problem: "A search of the whole repository with no term, glob or type filter is a broad discovery." The hook ignores the Grep pattern. A Grep with a term, no `glob` and no `type`, rooted at the clone, is unfiltered and denied `retrieval:broad-discovery-not-authorized`.
- Evidence: `filtered = tool === 'Grep' ? named(input['type']) || (glob narrows) : narrowsFiles(below)` (src/domain/hook-decision.ts:194-196). The deny reason reads "no glob or type filter" (:875). The document's own :600 says a glob or type filter ends broad status. "Term" applies only to the context assembler (:405).
- Fix: for the hook, write "no glob that narrows the files and no type"; for a Glob, "a pattern that names every file". Keep "no term" for the context assembler only.

**B3. data-model.md:258 (Budgets). Retrieval rows are said to be created lazily for an old contract. Code creates none.**
- Problem: "A contract compiled before them has none, and the rows are created, never reset, the first time a retrieval needs them." This contradicts containment.md:399 and :411.
- Evidence: `retrievalRowsOfRun` returns [] when `contract.budgets.retrieval` is undefined (src/app/budget.ts:82-84). `RetrievalGuard.forRun` returns an in-memory guard for such a contract and calls `createBudgets` only when the contract carries retrieval budgets (src/app/retrieval-guard.ts:70-73). The hook policy then carries no retrieval block, so nothing is charged.
- Fix: "A contract compiled before them has no retrieval rows and none is created; its retrievals are counted in memory against the profile's caps." Add that a store missing the rows for a contract that has them gets them created, never reset.

**B4. unknowns.md:43 (From containment). Wrong count of verified hosts.**
- Problem: "Whether the five admitted host versions pass the live containment suite now."
- Evidence: `VERIFIED_HOST_VERSIONS` holds six: 2.1.312, 2.1.316, 2.1.317, 2.1.318, 2.1.319, 2.1.326 (src/domain/host-admission.ts:8). containment.md:100 says six.
- Fix: "six verified host versions".

**B5. unknowns.md:32 (From data-model). Entry names tables that no longer exist as schema-only.**
- Problem: "Whether the six schema-only tables are planned for specific later work." data-model.md:3 says the built code writes every table.
- Evidence: I grepped INSERT and UPDATE statements for all 24 tables in src and none has zero writers. The migrations create 24 tables.
- Fix: delete the entry, or restate it for the columns that are never set (data-model.md:151).

**B6. unknowns.md:92 (From data-model, run slice). Ledger method count is stale.**
- Problem: "src/ports/ledger.ts was read only for the Ledger method list (61 methods)".
- Evidence: the `Ledger` interface declares 84 methods (src/ports/ledger.ts:772 onward, counted with `grep -cE "^  [a-zA-Z]+\("`).
- Fix: use 84, or drop the number.

**B7. unknowns.md:120 (From processes). Wrong diagram count.**
- Problem: "The eight PlantUML sources were not rendered".
- Evidence: `ls docs/system/diagrams/*.puml | wc -l` gives 9. processes.md links nine.
- Fix: "nine".

**B8. unknowns.md:76 (From config-reference, run slice). Wrong line count.**
- Problem: "the rest of the 537-line shell".
- Evidence: src/cli/shell/shell.ts has 552 lines.
- Fix: 552, or drop the number.

## WARNINGS

**W1. containment.md:392 and data-model.md:228. "One policy.denied for each command" is stated as general.**
- Problem: it holds only for an attended session. In a run the hook names the first privileged command only.
- Evidence: `decideShell` takes `classified.commands[0]` (src/domain/hook-decision.ts:817). The hook records one denial and one request for it (src/hook/pre-tool-use.ts:431-434). Only `consumeLine` records one per unapproved command (:717-737), and only attended mode uses it.
- Fix: scope the sentence to attended sessions. State that a run denies and records the first privileged command of the line.

**W2. containment.md:245. The list of rules that carry a corrective sentence is incomplete.**
- Problem: "(followed by a corrective sentence for the read-before-edit, loop, git output and git object rules)". Retrieval budget denials, `retrieval:broad-discovery-not-authorized`, the shell syntax, not-allowed and denied-prefix reasons (:341) and the privileged reasons also carry one.
- Evidence: `permissionDecisionReason` appends `final.reason` whenever it is set (src/hook/pre-tool-use.ts:~478). `spentDecision` (:385-390) and the broad-discovery deny (src/domain/hook-decision.ts:875) set reasons.
- Fix: "followed by the rule's corrective sentence when it has one".

**W3. containment.md:214. Loose description of the config-home denial.**
- Problem: "the data root, work root and configuration home of every other profile it finds under the configuration home in use and the default one". The registry returns other profiles' data and work roots plus the config home in use and the default config home. The home entries are added whether or not any other profile exists.
- Evidence: `for (const home of homes) roots.add(home)` (src/adapters/fs/profile-registry.ts:~99). The composition also adds the config home in use (src/cli/composition.ts:314).
- Fix: "the data and work roots of every other profile found, and the two configuration homes".

**W4. unknowns.md:83-84. Contradictory reading claim, an untrue negative and delivery wording.**
- Problem: line 83 says the evidence files "were not read, so no runtime claim is made". Line 84 then reports live runs on 2.1.326 with dates and results ("The delivery record reports ..."). It also says "No test at HEAD asserts it". test/containment/live-run-phase4.test.ts defines the live case `p4-restricted-run` ("issues no Bash call, writes nothing outside the clone"). It is gated by AVARICE_LIVE, like the suite at :43.
- Evidence: test/containment/live-run-phase4.test.ts:107; test/containment/LIVE-CASES.md:553-600.
- Fix: say that a live test exists and was not run, drop "delivery record", and reconcile with :83.

**W5. unknowns.md:50 and :103. Stale unread-source statements about the hook and settings generator.**
- Problem: they say the hook rule list and settings generator "were not read" and that the hook source "belongs to containment.md". containment.md now lists, counts and verifies the rules (40 of 40, reproduced here). The entry about whether containment.md is complete for the run purpose is stale.
- Fix: delete or restate the entry against the current text.

**W6. unknowns.md:57, 73, 80 and 58, 81. One fact, several homes, one with a wrong citation.**
- Problem: the validation-clone read question appears three times. The ignore-scripts question appears twice. The ignore-scripts entries (:58, :81) cite `src/app/checks.ts:364` for the env var, but that line is the `InstallAttempt` interface.
- Evidence: `npm_config_ignore_scripts` is set at src/app/checks.ts:435. findings.md:152 says "now at :381", which is also wrong; that is outside this group.
- Fix: keep one entry each, with the current citation.

**W7. integrations.md:161. The enumerated refusals are not exhaustive.**
- Problem: "The command refuses, writing nothing, in four cases (exit 3)". The code also refuses a settings.json that is not a regular file, one with a non-object `hooks`, one with a non-list `PreToolUse`, and a non-object entry.
- Evidence: src/adapters/host-claude/attended-hook-install.ts:173-198.
- Fix: say "among them" and add the non-regular file, or merge them under "not a JSON object with the hook structure".

**W8. Sentence length (hard cap 35 words; bold stripped, fences and table rows excluded; scan reproduced independently).** Over the cap:
- containment.md:158 (46 and 52 words), :263 (36), :269 (50), :401 (41 and 37), :407 (39 and 43), :411 (37), :568 (41), :569 (44). Line 409 is 71 words, or about 32 outside the two quoted denial texts; check it.
- integrations.md:161 (42), :391 (36).
- unknowns.md:50 (43), :65 (51), :84 (40), :102 (40), :105 (37), :110 (49), :116 (48), :134 (41).
- data-model.md: none.
- Fix: split each at its colon or semicolon.

## NITS

- N1. data-model.md:13: "`profiles/personal-local/config.json`, shared by every profile: the file `bindings.json`..." reads as if config.json is shared. Split into two clauses.
- N2. integrations.md:14 and :367 (credential helper row): the row omits the 5 second timeout and the refusal of an unlisted helper (`credential-helper-not-listed`), both in src/adapters/credential/cmd.ts. This matters if the table is meant to be exhaustive.
- N3. containment.md:185: the 32 KiB cap applies to the whole prompt, where the context pack is cut to fit and the contract text never is (src/app/run-gsd-config.ts:52-53). The sentence reads as a cap on the contract text alone.
- N4. unknowns.md:133 states "1236 tests, all passing". I did not run the suite, so that number is unverified.

## Verified against code, no finding
- containment.md rule counts: 40 distinct IDs (coverage command reproduced: 40), 6 allow, 35 deny, `subagent-type` on both. The six hook-entry rules are decided in src/hook/pre-tool-use.ts (`spentDecision`, the subagent concurrency check). `retrieval:broad-discovery-not-authorized` is decided by the pure rules.
- Retrieval caps: nine caps, defaults 20 files and 256 KiB (src/domain/retrieval-rules.ts:70-80). 2000 default Read lines, 64 MiB scan cap, 1 MiB hook input, 8 MiB digest threshold, 256-character target, 5 s hook timeout. Row check order toolCalls, fullReads, fullReadBytes. 20th Read allowed, 21st denied. 262144 bytes allowed, 262145 denied. Missing path, directory or empty file counts one file and 0 bytes. offset and limit ignored unless positive whole numbers. A Read charges every row or none.
- Restricted patch rules (src/app/run-stages/restricted.ts): 1 MiB patch cap, 256 KiB plan and questions cap, scope rules via `breaches` (protected, modified vs write or artifact, added vs create or artifact, deleted vs delete), first 10 paths in the finding, restricted directory excluded. Spec closure caps 32 files and 512 KiB, with the three seeds, are in src/domain/restricted-specs.ts:14-18.
- Permission-refused profile config (src/adapters/fs/profile-registry.ts): denied whole (profile directory plus default data and work roots), other read failures stop the command, corrupt or relative-root configs add nothing, and the selected profile is skipped.
- Other limits in containment.md all match: 16,384-character command, 11 read-only commands, 16 denied prefixes, 10 find actions, 11 and 14 GSD verbs, 12 credential paths, 6 verified hosts, 7 launch flags, 6 restricted flags, 3 and 25 loop limits, 10 s kill grace, 20 MiB transcript, 2000-character final text, 5 s and 15 s sandbox probes, 5 s executor grace, 5 MiB output, 15 minute install, 64-hop and 400-character ancestry, 7 `config-set` values, 10 subagents per item.
- data-model.md: 24 tables each with a writer, 50 event rows, 25 fixed run-step names, busy waits (5 s CLI, 4 s hook), event limits 1024 and 8192, 1 MiB stored documents, 30-minute approval expiry, `action.finished` with optional `startSeq`, the `policy.denied` variants (`privileged:unparseable`, `privileged:unapprovable`) and the bindings lock row (`bindings.json.lock`, holder pid and start time, 2 s wait).
- integrations.md: credential helper row (helper path as argv, stdout trimmed, 16 KiB cutoff refused as too large, stderr unread) and install-host refusals and exit codes (3 for refusals, 64 inside a run or bad arguments, 70 for failures; 5 s hook timeout; 256 KiB skill and 1 MiB settings caps).
- Mechanical sweep: no em or en dashes; the three ` -- ` hits (integrations.md:135 and :246, unknowns.md:122) are inside inline code, so exempt. No frontmatter. Headings are sentence case and none is a question. No phase numbers, plan IDs, threat IDs or file paths in the prose of containment.md, data-model.md or integrations.md beyond the opening module lists. The unknowns.md paths and commit SHAs are claim evidence, so I did not flag them; the sampled SHAs exist.

## VCS sweep
- `git status --short` after my run shows `.planning/config.json` and `.planning/milestone.lock` (present at session start) and `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-1-B.md`, which belongs to another reviewer.
- No file under docs/ or src/ is modified. My scratch files are only in /tmp (/tmp/rules.txt, /tmp/scan.py, /tmp/scan.py.bak).
- The four document digests are unchanged after the run.
