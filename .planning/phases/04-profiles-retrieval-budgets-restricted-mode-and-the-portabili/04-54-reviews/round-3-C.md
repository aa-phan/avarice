# Round 3, group C review (reviewer: fresh)

**Group:** C. **Round:** 3. **Reviewer:** fresh (I did not open `04-54-reviews/`). **Date:** 2026-11-22.

**Artifacts.** All four sha256 digests matched the dispatch, so I reviewed the files as dispatched:

| File | sha256 |
|---|---|
| `docs/system/containment.md` | 9db51688db0a724ec2ccbe0ef7109114f4f90c145387c5ac5727d62600a2fa22 |
| `docs/system/data-model.md` | 8812430c2a22951a20209b282074bfaab7307b54cf0f3bff6c2891a4bb7c1cbc |
| `docs/system/integrations.md` | ff87d3355f3ecd45963496a0e783b9079f1dfd292090c6e51e834517a9ab7acb |
| `docs/system/unknowns.md` | c79741a19fec2f8bad070aff3b2b229e75758b7db37300d31492be088face16a |

**Verdict: FAIL.** BLOCKER 0, WARNING 3, NIT 7.

Severity: BLOCKER is a factual error against the code. WARNING is a misleading or unsupported claim, an internal contradiction, or a doctrine violation. NIT is polish.

## Findings

### 1. WARNING: integrations.md:53, context sources and the GSD adapter contradict each other
- **Problem:** The ports table says "the first two and the planning sections are built only when the GSD adapter exists". That implies the file-search source (`git-files`) is built without GSD. The code builds all four context sources only when GSD exists. Line 364 ("No admitted gsd-core | no GSD adapter, no context sources") and line 45 say that correctly, so the document contradicts itself.
- **Evidence:** `src/cli/composition.ts:537-545`. The `context = {}` block, including the `GitFilesContext` branch at line 544, sits inside `if (gsd !== undefined)`.
- **Fix:** Write "all four are built only when the GSD adapter exists; the first two read through GSD's own readers".

### 2. WARNING: data-model.md:264, an invocation does not reserve a cost amount
- **Problem:** The sentence reads "An invocation reserves one unit of `invocations` and a cost amount before it launches". The ledger reserves only the `invocations` unit. The cost cap is computed from the remaining budget and passed to the host. No `costUsd` reserved amount is written, and settlement charges cost directly. A reader will assume `costUsd.reserved` moves.
- **Evidence:**
  - `src/app/budget.ts:160` calls `reserveBudget(runId, 'invocations', 1)` and nothing else.
  - `src/app/budget.ts:243-248` settles the cost with `fromReserved: false`.
  - containment.md:424 and :432 describe it correctly.
- **Fix:** "An invocation reserves one unit of `invocations` and is granted a cost cap (the smaller of the per-invocation cap and what remains), which is not a reserved amount on the cost row." Then define "cost reservation" once at containment.md:434 as that cap.

### 3. WARNING: unknowns.md:43, 62, 70, 76, 79, 81, 83, 96, 98, 100, 126, 128 and 92-94, delivery history in the prose
- **Problem:** CLAUDE.md keeps delivery history out of `docs/system/` prose. These entries narrate how the work was delivered:
  - section headings "(run slice)";
  - "the run-slice pass below did not re-read them";
  - "the earlier text of this tree";
  - "Campaign-wide";
  - "What the documentation pass executed";
  - "the exit run" and commit-subject provenance.
  Readers cannot tell what "run slice" or "earlier text" refers to.
- **Evidence:** Document text only. A plain `src/` file path in unknowns prose is reasonable for an unknowns ledger and I did not flag it.
- **Fix:** Rename the "(run slice)" headings by subsystem, or merge them into the matching "From X" section. Replace "earlier text of this tree" with "carried from the previous description, not re-read". Keep the commit hashes only as claim evidence.

### 4. NIT: containment.md:314-322, the command-identity "order applied" omits the privileged-form step
- **Problem:** The list is headed "in the order applied" and goes from rule 2 (empty or over 16,384 characters) to rule 3 (preamble). The code classifies privileged forms between them. An unreadable line becomes `shell-syntax` there, and a privileged form is denied there, before preamble, lexing and contract commands. Line 263 says "before the prefix rules", which is true but gives no position.
- **Evidence:** `src/domain/hook-decision.ts:804-819`. `classifyLine` runs after the length check and before the preamble handling at line 824.
- **Fix:** Add a numbered step 2b or one sentence in the list: "Between 2 and 3, a line holding a privileged form is denied `privileged:<action>`, and a line the classifier cannot read is denied `shell-syntax`."

### 5. NIT: containment.md:414, a stray sentence attaches to the last bullet
- **Problem:** " At the built-in caps the 20th Read is allowed and the 21st denied..." begins with a space directly after the three-bullet list. Markdown makes it a continuation of the `budget:retrieval.fullReadBytes` bullet, but it describes both rows.
- **Fix:** Put a blank line before it and drop the leading space.

### 6. NIT: containment.md:269, the run denial of an unapprovable command is only conditionally `privileged:scm.api.write`
- **Problem:** "In a run ... the second is `privileged:scm.api.write`" holds only when the unapprovable `gh api` is the first privileged command of the line. A run records the first privileged command only.
- **Evidence:** `src/domain/hook-decision.ts:816-818` uses `classified.commands[0]`.
- **Fix:** Add "when it is the first privileged command of the line".

### 7. NIT: data-model.md:232, `action.started` data omits `approvalId`
- **Problem:** The approval path adds `approvalId` to the data, written in the same transaction as the consume. This covers the hook's attended write and the application's approval source. The Data list does not name it.
- **Evidence:** `src/adapters/sqlite/approval-rows.ts:52-55`.
- **Fix:** Add "and the approval ID when the source is `approval`".

### 8. NIT: unknowns.md:50, the line range does not match the described code
- **Problem:** The entry cites `src/app/checks.ts` lines 325-390 as "the install summary and the start of the install". Lines 325-341 are the end of the check pass. The install summary types are at 363-390, and the install function starts at line 407, outside the range.
- **Fix:** Cite 363-440, or drop the line numbers.

### 9. NIT: unknowns.md:80, a recorded live result for the restricted run exists
- **Problem:** The entry treats the restricted live case as not run. `test/containment/live-spend-phase4.jsonl:20` records the `p4-restricted-run` case with cost 0.0048 on host 2.1.326. The entry's wording ("not read") stays true, but the open question may be partly answerable from that file. The same applies to unknowns.md:43, where "the recorded run files" were checked and line 79 says the evidence files were not read.
- **Fix:** Read that evidence and either close the entry or name the file as the unread evidence.

### 10. NIT: containment.md:478 and 573, the cited anchor "Another profile's roots" is a bold bullet
- **Problem:** It is not a heading. The reference resolves to a bullet in "Limits of containment". Also, the reads-denied list in line 478 omits the two configuration homes that `deps.profile.otherRoots` adds (`src/app/checks.ts:139`; composition.ts:313). Line 214 states them correctly.
- **Fix:** Cite "Limits of containment" and add the configuration homes to line 478.

## Verified against the code, no fault found
- **Hook rule counts.** I re-ran the coverage ledger command and got 40 distinct IDs. The allow rules are 6 and the deny rules 35. `subagent-type` is on both. The retrieval rules are 5 (`budget:retrieval.searches`, `.fullReads`, `.fullReadBytes`, `retrieval:broad-discovery-not-authorized`, `retrieval:broad-discovery-spent`). The six hook-entry budget rules and the six `privileged:<action>` actions match `src/domain/privileged-commands.ts`.
- **Attended hook.**
  - `privileged:unparseable` and `privileged:unapprovable` carry no action suffix, and neither records a command text or makes a request.
  - The `unapprovable` event records the action; the `unparseable` event records none.
  - A run records only the first privileged command; an attended line records one per command without an approval.
  - Hook flags match `parseArgs` and `attendedMain`.
- **Read charging.**
  - Caps are 20 reads and 262144 bytes (256 KiB). The 20th Read is allowed and the 21st denied. A Read past the last line costs 0 bytes.
  - The default limit is 2000 lines and the scan cap is 64 MiB. The check order is toolCalls, fullReads, fullReadBytes.
  - A non-positive or non-integer `offset` or `limit` is ignored.
  - An unopenable regular file gives exit 2.
- **Broad discovery.** The glob patterns, brace handling, authorization and `alsoCharged` match. The caps are nine, with four budget rows. Start overrides cover three names, and broad discovery is not among them.
- **Restricted patch rules** (`src/app/run-stages/restricted.ts`, `item.ts:348`).
  - Out-of-scope paths are held to the contract.
  - Artifact paths are tolerated for modified and added paths only.
  - Patch cap 1 MiB, plan and question files 256 KiB, the finding names at most 10 paths, spec closure 32 files and 512 KiB.
- **Sandbox deny lists.**
  - The 12 credential paths, the three default parents, and `knownProfileRoots` all match the documents.
  - That covers the permission-refused config adding the profile directory plus default roots, and a corrupt config or relative root adding nothing.
  - Other read failures stop the command, the config homes are listed, the profiles directory fails closed, and the check-command environment, install timeout and validation without re-allowance match.
- **data-model.md.**
  - 24 tables, the migration shape (v1 creates 20 tables; 19 triggers and indexes in total), and 50 event kinds.
  - Event levels match the sampled kinds. `startSeq` is optional, and an end without it closes the earliest open start.
  - The `bindings.json.lock` row (pid and start time) and the adapter-config names also match.
- **integrations.md.**
  - Credential-helper limits are 16 KiB, 5 seconds and `credential-helper-not-listed`; the 15, 5 and 120 second limits and the GSD and graphify limits also match.
  - `install-host` exit codes 3, 64 and 70.
  - Refusals cover the symlinks, the 256 KiB marker file, the 1 MiB settings file, the invalid JSON or structure, the mixed marker, the hook-entry script check before any write, and the 5 second `onFailure: block` entry.
  - The two rows written are `host-skill:avarice-run` and `host-hook:attended`.
- **unknowns.md counts.** Six versions, twenty commands, 84 Ledger methods, 552 shell lines, 27 run kill points and nine PlantUML sources all match.
- **Mechanical sweeps.**
  - No em dash, en dash or ` -- ` in any of the four files.
  - No sentence over 35 words in running prose after stripping bold markers and excluding code fences and table rows. The longest are 35 and are not flagged.
  - No strict-YAML issue (no frontmatter) and no banned vocabulary hits.
  - Headings are sentence case. Every internal link and anchor resolves; I checked all of them with a script.
  - Plan IDs and phase numbers are absent from running prose, except the unknowns.md items in finding 3. File paths stay in the openings of containment, data-model and integrations.

## Run hygiene
I modified no repository file. `git status` shows only `.planning/config.json` and `.planning/milestone.lock`, which were untracked at the start. It also shows `.planning/phases/04-.../04-54-reviews/round-3-B.md`, which I did not create or read. My only scratch files were `/tmp/sl.py`, `/tmp/anch.py` and `/tmp/rules.txt`.
