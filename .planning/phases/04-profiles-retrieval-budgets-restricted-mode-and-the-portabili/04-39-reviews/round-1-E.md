# Round 1, group E review

Documents reviewed (sha256 at review time):

- docs/system/indexes-and-context.md 83a698ea42a06972a6c2ce01e109136633db0ff6c689817a35bd59eb5cacbdad
- docs/system/onboarding.md 07ae6c13543782c0cd1bc5415edd8f6b6f5312673ec12535d742fd2013f541ad
- docs/system/runs.md 93369ba29ef62694006df6f7d1faef5054e26f9215d7ba0601174bfe644283cf
- docs/system/checks-and-evidence.md 5e34cf9d8db06b891a5900a38de673477336c64e503b89279a9c947550d53937
- docs/system/processes.md 38c57f2faac1d609f7ff93d0467362242aaa0a0fa645219b5f923fe58a398711

Severity: BLOCKER (a claim the code contradicts, or a hard-rule breach), WARNING (likely rework), NIT (polish).

## Findings

### 1. BLOCKER, checks-and-evidence.md, section "Evidence"

Claim: "The domain also names `mutation`, `ci`, `review` and `manual`; none is written." and "The value `external` exists in the type and is never written."

Evidence: `src/app/manual-inputs.ts:306` writes `independence: 'external'`, and the same module stores kinds `ci`, `review` and `manual` as manual evidence (artifact kind `manual-evidence`). The same document's section "Manual evidence" and one of its Quirks bullets say the opposite (`ci`, `review`, `manual` and `external` are written by `evidence add`). Only `mutation` is unwritten. The statuses table also says `inconclusive` is written for "A timeout or a cancel; also a check the resume reconcile marks", which omits manual evidence (always `inconclusive`).

Fix: change the two sentences to "The domain also names `mutation`, which is never written; `ci`, `review` and `manual` are written only by `evidence add` (see Manual evidence)" and "`external` is written only by `evidence add`". Add manual evidence to the `inconclusive` row.

### 2. WARNING, sentence length over the 35-word hard maximum

Examples (running prose; counts approximate, links stripped; line numbers are file lines):

- onboarding.md line 171 (Mapping), "Every map prompt, whatever the mode and restricted included, also ends with a secrets rule: ..." (about 70 words); the next sentence, "It names the connection string ..." (about 49).
- onboarding.md line 226 (Index stage), "When the onboarding is a refresh with an incremental plan, ..." (about 68).
- onboarding.md line 116, "A full map has 4 mappers and a re-run allowance of 2 per round, because ..." (about 52) and "The per-invocation cost also bounds the knowledge corpus ..." (about 40).
- onboarding.md line 194, "It names the staged paths relative to the working directory, ..." (about 50).
- indexes-and-context.md line 268 (Reuse and access), "A retried item's new pack may keep an item from the pack it built before, ..." (about 62).
- indexes-and-context.md line 56 (Refreshing the code graph), "The previous graph is read from the staging copy ..." (about 56); line 141 "The pass runs whole, and the block says `whole` ..." (about 50); line 221 (about 46); line 242 (about 45).
- runs.md line 464, "The supervisor stores the plan (`restricted-plan`), the patch, ..." (about 56); runs.md line 65, "A secret pasted into the brief ..." (about 46).

Not flagged: onboarding.md line 238 (project record contents, about 138 words) reads as a reference list inside one colon sentence and falls under the reference-list carve-out, though a bullet list would read better (NIT). Opening paragraphs that enumerate module paths are exempt by the house rule.

Fix: split each sentence at its colon or semicolon so each claim has its own sentence.

### 3. WARNING, one fact one home, onboarding.md line 116 (Contract compilation and budgets)

Claim: the paragraph restates the knowledge corpus formula `floor((cost cap x 2/3 / 0.0255)^(1 / 1.376))`, its constants and the omission rule.

Evidence: the formula and constants (`KNOWLEDGE_COST` in `src/domain/knowledge-corpus.ts:176`) are owned by indexes-and-context.md, section "The cost cap", which states them in full. Two copies will drift when the model is refitted.

Fix: replace the sentence in onboarding.md with "The per-invocation cost also bounds how many documents the knowledge pass may send; the rule is in [indexes-and-context.md](indexes-and-context.md#the-cost-cap)." The Index stage paragraph already links the same section.

### 4. WARNING, function or method name in prose, indexes-and-context.md line 270 and runs.md line 443

Claim: "`ContextSource.refresh` judges a reference against the repository as it is now" and "(`ContextSource.refresh`, see ...)".

Evidence: `ContextSource.refresh` is the port method at `src/ports/context-source.ts:105`. The house rule keeps function names out of `docs/system/` prose.

Fix: write "each context source judges a reference against the repository as it is now" in both places.

### 5. NIT, processes.md line 114 (Answer a decision and resume the item, step 9)

Claim: "A resume gives up and runs a fresh unit in four cases."

Evidence: runs.md, section "Answer and resume", lists five fallback reasons (`session-gone`, `crashed`, `unpark-conflict`, `park-missing`, `interrupted`). The fifth needs a kill, which this flow does not include, so the count is defensible, but it reads as the full list and disagrees with the owner document.

Fix: "in these cases (a supervisor killed during the resume adds a fifth, see runs.md)" or link the owner table.

### 6. NIT, processes.md Diagram index table

The "Drift anchor" column names specific source files (`src/app/resume.ts`, `src/app/decide.ts` and others) in a document whose opening names only `src/cli/`, `src/app/`, `src/adapters/` and `src/hook/`. The house rule is to name modules once in the opening. If the column is a deliberate drift check, say so in a sentence under the table; otherwise reduce it to the flow's owner document.

## Verified and deliberately not flagged

Checked against the code at HEAD, all matching:

- Lifecycle tables: onboarding 14 states and 29 transitions, run 11 states and 37 transitions (computed from the exported transition tables; the run table in runs.md matches row for row), stop states, resumable states, block reasons.
- Budgets and presets: onboarding preset (45 min split 20/10/15, 600 tool calls, 4 concurrent, 3.00 and 12.00 USD), derived defaults (12 and 6, 2 and 6, 0 and 3), run preset (120 min, 2n+1, 400n, 10n, 2.00 and 10.00 USD), lease 180 s, 250 ms poll, 15 minute wait margin, 24 hour resume wait, 60 s cancel lease, preflight limits (25 commits, 14 days, 500 candidates), prompt cap 32 KiB, answer 2000 and question 600 characters, archive 2 MiB.
- Knowledge pass: cost model constants and the 9, 15 and 23 chunk limits (recomputed), chunk limits (8 files, 64 KiB, 1 MiB read-back), corpus caps (200 files, 256 KiB), node text cap 2048 bytes, retag score cap 0.8, graphify timeouts (5 min, 2 min), 64 MiB graph cap.
- Retrieval: caps (planning 6000 characters, 50 handles, 8 words, 200 characters; file search 5 hits per file, 1500 characters, 20 before and 19 after, 1 MiB blob; graph depth 3, 5 edges, 300 characters; intel 1500), half-budget shares for intel and planning, `--budget` 1 to 100000, default 24000.
- Checks: install timeout 15 min, 16 registry hosts, 20 proxy groups, 32 MiB lockfile, 20 paths and 10 hosts in validation, network error patterns, 5 MiB output default, inventory limits (50000 IDs, 500 characters, 20000 files, 4 MiB, 120 s), reproducer command cap 1000; rule counts for G1 (6), G2 (8), G3 (3), G4 (7); refusal codes (13).
- Kill points: 17 onboarding points (test/fault/killpoints.test.ts) and 27 run points (test/fault/run-killpoints.test.ts).
- Cross-references: every cited anchor in config-reference, containment, autonomy-and-decisions, integrations, cli-reference, data-model, policy-and-approvals and profiles-and-credentials exists; ADR-015 exists and supports the sentence that cites it; the nine diagram files named in processes.md exist.
- Mechanical sweep: no em dash, en dash or ` -- `; no phase, plan, threat or ticket IDs in prose; headings in sentence case; no changelog or "last updated" text. Paths appear in the openings (allowed); the only other paths are runtime paths (`.planning/...`, `graph.json`) and the diagram table (finding 6).
- The run touched no tracked file; git status showed only the two untracked planning files present at the start, plus this report.

Not verified line by line (sampled only): the long prompt-construction paragraph in runs.md (Launch), the path-reference rules in onboarding.md validation check 4, and the freshness table for intel in indexes-and-context.md.

Verdict: FAIL
