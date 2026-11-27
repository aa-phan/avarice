**Review round-1-D**

- Group: D (`docs/system/runs.md`, `docs/system/onboarding.md`, `docs/system/indexes-and-context.md`)
- Round: 1
- Reviewer: fresh
- Date: 2026-11-22
- Repo: /Users/aphan/avarice/.claude/worktrees/phase-04
- Digests: all three matched the expected values when I read them.
  - runs.md: 455375071b9bb30bab5a79834f4975ef9b0018f4b881770d25741210e846a48a
  - onboarding.md: 4f47f8ad1547a2996cd78586a6271785e3f568283adc3266c677ee89dafde8e2
  - indexes-and-context.md: b8861ce4f5eaf0083420925909cb557489a48a616ebbb128a52eb82d53fbc444
- Severities:
  - BLOCKER: a factual error against the code.
  - WARNING: a misleading or unsupported claim, or a doctrine violation.
  - NIT: polish.

**VERDICT: FAIL. 1 BLOCKER, 9 WARNING, 7 NIT.**

## Findings

### BLOCKER

**B1. indexes-and-context.md:330 says intel items are never fenced. The code fences them, and line 316 of the same document says so.**
- Problem: the quirk reads "Intel items are never fenced, although the intel files are written by a model... The fence applies to graph nodes that are not code and to the other three sources." Line 316 says "Every intel handle and item is untrusted".
- Evidence:
  - `src/adapters/context/gsd-intel.ts:97` and `:127` set `untrusted: true` on every intel handle and item.
  - `src/app/context.ts:573-577` fences every item with `untrusted === true`.
  - `src/adapters/context/derive-spec` is not involved; `src/app/derive-spec.ts:48-58` also depends on intel being untrusted, and `docs/system/findings.md:290` records that.
- Fix: delete the bullet. If a quirk is wanted, say that all four sources and the non-code graph nodes are fenced.

### WARNING

**W1. onboarding.md:279 says `resume` on a stop state takes no lease. That is wrong for an active onboarding with an unfinished promotion.**
- Problem: line 279 says "`resume` on a stop state reports where it ended and takes no lease." Line 264 says resume opens a permission decision for a promotion that started and never ended. That only happens under a lease.
- Evidence: `src/app/resume.ts:171-183`. For `active` with open privileged steps it calls `runOnboarding(..., { prelude: reconcilePrivileged })`, which takes the lease.
- Fix: add the exception "except an active onboarding with a promotion that started and did not finish, which takes the lease and reconciles only that".

**W2. onboarding.md:281-284 says "The prelude, in order" and lists two steps. The code has three, and the omitted one runs first.**
- Evidence: `src/app/resume.ts:158-165`, `reconcileOnResume`. It reconciles privileged actions first, then reaps, then reconciles the map invocation.
- Fix: add the privileged-action step as step 1, or link to the Promotion bullet that describes it.

**W3. onboarding.md:5 says runs.md covers "the unattended run of one work item".**
- Problem: runs.md describes a brief of up to 20 items with scheduling, dependencies and per-item decisions (runs.md:5, 89, 223-245).
- Evidence: runs.md:89 and `src/domain/brief.ts:66` (`items: 20`).
- Fix: say "the unattended run of one brief".

**W4. runs.md:460 claims the host's reason always ends with how to ask for restricted mode.**
- Problem: it says "A host that lacks required enforcement for a contained run makes the run stop... and the host's reason ends with how to ask for restricted mode."
- Evidence: `src/cli/composition.ts:233-235, 258-262`. The hint (`restrictedHint`) is added only when `claude` was found and failed an enforcement probe. "no admitted gsd-core", "claude was not found" and "GSD shim preamble was not found" carry no hint.
- Fix: limit the claim to a `claude` that is present and failed a containment probe.

**W5. runs.md:464 says artifact paths are tolerated under all of the scope rules. They are not.**
- Problem: the sentence lists protected, modified, added and deleted rules "with the run's artifact paths tolerated".
- Evidence: `src/app/run-stages/item.ts:348-358`.
  - A protected path is a breach before artifacts are considered.
  - Artifacts are tolerated only for modified and added paths.
  - A deleted artifact path is a breach, because the delete list is empty.
- Fix: say artifacts are tolerated for modified and added paths only.

**W6. Sentences over the 35-word hard cap in running prose.**

The first four rows are the count of in-scope sentences. The last two are lower priority.

| Location | Words |
|---|---|
| runs.md:462 ("It may edit only the paths...") | 38 |
| runs.md:464 ("A changed path is out of scope...") | 46 |
| runs.md:464 ("Out-of-scope paths are left out of the patch...") | 44 |
| runs.md:466 ("A plan or a question list that cannot be read...") | 49 |
| runs.md:466 ("Each is one sentence in the block text...") | 37 |
| runs.md:466 ("The sentences about problems...") | 48 |
| onboarding.md:158 | 57 |
| onboarding.md:263 | 49 |
| onboarding.md:283 ("That is the case when...") | 38 |
| indexes-and-context.md:252 ("The planning sections are skipped...") | 39 |
| indexes-and-context.md:316 ("A graph node whose type is anything but `code`...") | 37 |
| indexes-and-context.md:316 ("A code node is marked too...") | 53 |
| onboarding.md:247 | 140, a semicolon reference list, so arguably covered by the reference-list carve-out |
| line 3 of each document | 79, 40 and 44, the module-listing openings, exempt |

- Fix: split each at its colon or "so" clause.

**W7. Module naming in the opening is incomplete.**
- runs.md: the opening names the restricted stage and the resume files, but not `src/app/derive-spec.ts`. The document describes spec derivation at lines 65 and 154.
- indexes-and-context.md: the opening names the context modules but none of the index-stage modules it describes. That includes the cost-cap rule in `src/domain/knowledge-corpus.ts` and the stage in `src/app/stages/index-knowledge.ts`. Neither is named in the opening or covered by a directory path.
- Fix: name them once in each opening.
- Related NIT: `src/app/run-stages/` and `src/app/run-stages/restricted.ts` are both listed in the runs.md opening.

**W8. indexes-and-context.md:129 gives measured-session numbers with no source in the document.**
- Problem: the 6-chunk cost of 0.30 USD, the 12-chunk costs of 0.75 and 0.81 USD and the 0.006 USD overrun are stated as measured. The document names no evidence.
- Evidence: the numbers are in the calibration comment at `src/domain/knowledge-corpus.ts:159-176`. They are 0.302, 0.7518 and 0.8058, with 0.0058 over the cap. All are traceable, but not cited.
- Fix: name the evaluation record that holds the measurements, or mark the data points `**[source wanted: ...]**`.
- I checked the constants themselves and they match: `KNOWLEDGE_COST` = 0.0255, 1.376, 2/3. The limits come out as 9, 15 and 23 chunks at caps of 0.8, 1.6 and 3.0 (I recomputed them). The 0.52 USD model value at 9 chunks and the 7 percent spread both hold.

**W9. runs.md:154 says an index "knows" a file, but the code is narrower, and the document omits two exclusions.**
- Problem: the document says a derived file is a candidate "that an onboarded index knows". In the code a graph fact counts only when it is `fresh`, or `stale` with the cited path confirmed at HEAD. A code node whose file is under `.planning/` gives nothing.
- Evidence: `src/app/derive-spec.ts:44` and `:76` (the `usable` check).
- Fix: add one sentence on freshness and the `.planning/` exclusion. Line 65 mentions a stale index only as non-blocking.

### NIT

- **N1.** indexes-and-context.md:135 says "the manifest, and its digest, list only the documents that were sent" in the same sentence that says the manifest's excluded list names every left-out document. Say "its entries list only the documents that were sent".
- **N2.** indexes-and-context.md:129 says the exponent is log2(0.78 / 0.30). With the printed rounded values that gives 1.378, not 1.376. The code uses 0.7788 (`knowledge-corpus.ts:168`). Use 0.7788 or write "about 1.38".
- **N3.** indexes-and-context.md:268 and :316 both state that a non-code neighbour is named by type, never by label. One fact should have one home.
- **N4.** runs.md:257 and onboarding.md:45 use the filler "In practice" (banned filler list). Delete it.
- **N5.** Bold-lead bullet runs in onboarding.md:199-204 ("What is copied", "Where", "When it refuses", "The prompt", "Removal") and :261-266 match the banned bold-lead pattern. Reference-style labelled facts, so low priority.
- **N6.** indexes-and-context.md headings "What it asks", "What validation requires" and "What the record states" name the question rather than the content. "Resolving the project" is one possible replacement for the first. Low priority.
- **N7.** runs.md:464 says the supervisor "stores three artifacts". The code stores each only when it exists: a non-empty plan, a non-empty patch, and a question list with at least one question (`restricted.ts:240-257`). The decision text already says "no plan was written". Say "stores up to three".

## Checked and deliberately not flagged

**Mechanical sweep**
- No em dashes, en dashes or ` -- ` in any of the three files.
- No phase numbers, plan IDs, finding IDs or threat IDs in the prose.
- The ADR-015 link is a citation. I checked ADR-015, and its measured result (C is no less successful than B and uses fewer run tokens, but costs more to onboard) matches the sentence.
- No file paths or function names in the body prose. The camelCase backticked terms are data field names.
- Headings are in sentence case.
- No changelog section and no "last updated" field.

**Restricted stage (runs.md:456-470) against `src/app/run-stages/restricted.ts`**
- 256 KiB for the plan and questions, and 1 MiB for the patch.
- At most five named paths, each cut to 80 characters, followed by `and N more`.
- 440-character cap on the findings text, inside the 1000-character issue limit (`ISSUE_MAX_CHARS`).
- Record of the first 10 paths and the count in the `scope-of-writes` finding (`blocked.ts:60,160`).
- `captured` false then true, and no host relaunch once the step exists.
- Reap and clone reset on resume.
- Withdraw-only permission decision, with reason `enforcement_failure`.
- Preparation that skips install, validate and baseline, and writes no GSD settings.
- Start refusal exit 3 before anything is stored.
- `restricted <state>` label in status.

**Resume re-block (runs.md:414-454, 480ff) against `src/app/run-resume.ts`, `src/app/resume-refs.ts` and `src/cli/commands/resume.ts`**
- Reap order and the error for an unreapable launch.
- No-replay pause and re-block, and no second block when already `enforcement_failure`.
- Severity order of reference reasons, decision class and withdraw-only offer.
- One decision per set of references.
- Config-directory refusal with exit 3.
- 24 hour `--wait` cap and exit 70.
- Reconcile branches by state.

**Spec derivation (runs.md:154) against `src/domain/run-contract.ts` and `src/app/derive-spec.ts`**
- Code node only, with `codeNode` set on every code node.
- Label must be an identifier to give a symbol.
- Intel always untrusted, so it gives nothing.
- Files, symbols, references and config keys rules.
- Fallback to the whole write set.
- Sorted and de-duplicated output.
- Write-set containment.

**Onboarding.md against `src/app/invocation.ts`, `src/adapters/git/promotion.ts` and `src/app/resume.ts`**
- Scoped-map refusal: field `mapping:plan`, nothing reserved, and read scope never widened.
- Promotion path rule: normal form, under `.planning/`, character set, `.git` in any case or all-dot segments, same check for copy and commit.
- Commit identity and branch name.
- Reap refusal causes.
- 14 states and 29 transitions (recounted, and checked against the code's edge construction).
- Budget presets (45 minutes with 20/10/15, 600, 4, 3.00 and 12.00).
- 12/6, 2/6 and 0/3 derivations.
- Restricted spec staging limits (32 files, 512 KiB, mode 0444).

**Indexes-and-context.md**
- Heading parser: 2000-character cap (a line is body text only when longer than 2000), one to six hashes, closing-hash rule, and the `Goal#` example.
- 50 handles, 6000-character sections, 8 words and 200 characters of term, 256 KiB files.
- Exclusion at any depth for entries with no `*` or `?`, and root-anchored globs.
- 5 hits per file, 1 MiB blob cap, snippet window of 20 lines before and 19 after, and the 1500-character cap.
- Chunk packing (8 files, 64 KiB), 1 MiB chunk output, 200-file cap, 256 KiB per file.
- Cost-cap prefix semantics, the `corpusCap` fields and the 50-area cap.
- Limit 0 gives `budget_exhausted` before any corpus is written.
- Graph limits: 64 MiB, 5 and 2 minute timeouts, 200-character detail, 2048-byte node text, 10 percent dangling, 25 problems.
- `codeNode` and `untrusted` semantics, and half-budget shares.
- Tier ranking and read-rule caps (5 edges, depth 3, 300 and 1500 characters).
- 24000 default budget and the 100000 `--budget` ceiling.

**Other numbers confirmed in runs.md**
- Brief limits (64 KiB, 4096 per line, 20 items, 20 criteria, 128 list items).
- Staleness limits (25 commits and 14 days).
- 500-commit walk and 256 KiB conventions file.
- Budget preset and the 11-state, 37-transition lifecycle (recounted).
- 2000-character answer and final-text tail, and 600-character question.
- 32 KiB prompt (at most 8192 tokens), 2 MiB archive, 72-character subject.
- 60 second cancel lease, 500-character amend reason, and the thirteen refusal codes.

**Read-only proof.** `git status --short` after my run shows only `.planning/config.json` and `.planning/milestone.lock` (present at session start) and an untracked `.planning/phases/04-.../04-54-reviews/round-1-B.md` that I did not create. There is no diff in any tracked file. My only scratch file is `/tmp/rv/sl.py`, outside the repository.
