# Round 3, group D: fresh-eyes review

Group: D (runs.md, onboarding.md, indexes-and-context.md)
Round: 3
Reviewer: fresh. I did not open the 04-54-reviews/ directory.
Date: 2026-11-22
Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04

All three digests match the ones you gave, as read:
- /Users/aphan/avarice/.claude/worktrees/phase-04/docs/system/runs.md: 016eebba654f09073c88971ed7dfa84223fd55c48a88485d4742c6896a273d50
- /Users/aphan/avarice/.claude/worktrees/phase-04/docs/system/onboarding.md: 8604881de62d721063c3634d1b60e73aaf7afb2d681074f9c1fe640a14704917
- /Users/aphan/avarice/.claude/worktrees/phase-04/docs/system/indexes-and-context.md: ed78728e71d5d6fbefa046667d2452c7bc68edafa1e2ccc967a0e5ce98f2be4c

Severity: BLOCKER is a factual error against the code. WARNING is a misleading or unsupported claim, or a doctrine violation. NIT is polish.

**VERDICT: FAIL. 1 BLOCKER, 5 WARNING, 3 NIT.**

## Findings

### BLOCKER

**B1. runs.md:46-47 (Order of checks, steps 7 and 8 are reversed)**
- Problem: The list says "7. Profile limits ... active-runs" comes before "8. Preflight". The code runs the preflight first. The sentence "`start` runs its checks in this order" is therefore wrong.
  - A repository that fails preflight (for example `stale-commits`) and is also at `limits.maxActiveRuns` gets the preflight refusal, not `active-runs`.
  - A malformed `retrieval` or `limits` section is reported only after preflight passes.
- Evidence: src/app/run-start.ts, in order.
  - `judgeRunPreflight` verdict at about line 268.
  - `parseConventions` at 281.
  - `profileRetrievalCaps` at 287.
  - `profileLimits` at 291.
  - The `active-runs` refusal at 296-301.
  - `compileRunContract` at 304.
- Related gap in the same list: `conventions-invalid` is raised from reading the conventions at lines 258-260, before `revision-mismatch`, `stale-commits` and `stale-age`. The list never places it, so step 8 is too coarse.
- Fix: swap steps 7 and 8, and put the conventions read and parse inside step 8, ahead of the verdict.

### WARNING

**W1. runs.md:161 (spec derivation paragraph, "a deletion is a scope failure at the first gate")**
- Problem: Deletions are judged by gate G2, not the first gate. The document itself says G1 judges the plan first (runs.md:314) and G2 holds the unit to scope (runs.md:316).
- Evidence: src/domain/gates.ts:84-106. The `deletion-scope` rule sits in `evaluateG2`. G1's rules (gates.ts:190-197) have no deletion rule.
- Fix: write "a deletion fails gate G2's deletion rule".

**W2. runs.md:72 ("A killed start therefore leaves either nothing or the whole run")**
- Problem: The sentence follows the claim that the run keeps a reference to the brief file, so it implies that reference is in the one transaction. It is not. The reference is recorded in a second write after the transaction.
- Evidence: src/app/run-start.ts:330 `createRunWithContract` is the transaction. Lines 337-343 then call `recordTaskRefs`. Line 335's comment shows the code treats a failure there as a start failure with the run already stored.
- Fix: say that the transaction stores the run, contract, budget rows and items. Then say a start killed before the brief reference is recorded leaves a run without it, as it can leave one without its contract file. Or move the reference sentence out of the "whole run" claim.

**W3. indexes-and-context.md:244 (`gsd-planning` row: "that phase's `CONTEXT.md`, `PLAN.md` and `LEARNINGS.md`")**
- Problem: The adapter does not read a file named `PLAN.md`. It reads plan files only when the name ends in `-PLAN.md`, such as `04-01-PLAN.md`. `CONTEXT.md` and `LEARNINGS.md` match with or without a prefix.
- Evidence: src/adapters/context/gsd-planning.ts:34. `PHASE_FILE = /(?:^|-)(?:CONTEXT|LEARNINGS)\.md$|-PLAN\.md$/`. `planningFiles` (line 108) and `refresh` (line 242) both use it.
- Fix: write "its context and learnings files and its `-PLAN.md` files".

**W4. onboarding.md:162 (scoped map: "preparing the invocation refuse ... a scope with no valid path")**
- Problem: This understates the rule. The invocation refuses unless every path is a valid scope path, so one bad path among good ones is refused too.
- Evidence: src/app/invocation.ts:109 uses `!(scopePaths !== undefined && scopePaths.length > 0 && scopePaths.every(isScopePath))`. The error text at line 110 says the map "names no valid scope path".
- Fix: write "a scope that is empty or holds any path that fails the scope-path check".

**W5. runs.md:161 (end of the derivation paragraph: "The preset values are in config-reference.md. Two consequences matter here.")**
- Problem: "Two consequences matter here" is an importance announcement (banned in the style rules) and has no antecedent. The two consequences are about write globs and deletion, not about derivation. The paragraph has run on from derivation into scope rules, and the preset-values pointer is orphaned in the middle of it.
- Fix: end the derivation paragraph at "never widen them". Start a new paragraph: "The unit may write only ..., and a file it creates must match the same globs. No contract lets a run delete a file: the delete list is empty, so a deletion fails gate G2, and so does a rename, which arrives as a deletion plus an addition." Put the config-reference pointer on its own sentence after the budgets or the files section.

### NIT

**N1. runs.md:439** says "The required checks of the interrupted final pass that never finished get `inconclusive` evidence". The code marks every check the final pass runs, so target checks too. Evidence: src/app/run-resume.ts:~208 loops over `checksToRun(contract)`, which is required plus target (src/app/checks.ts:96). Fix: "The checks of the interrupted final pass (required and target)".

**N2. runs.md:507-515 (Quirks)** repeats facts that have a home above. One fact, one home applies to each pair.

| Quirk line | Home |
|---|---|
| 509, parked delta | 248 |
| 510, stale decisions | 419 |
| 514, hand-recorded refs | 450 |
| 515, ref-blocked run is final | 461 |

Fix: drop the repeats or reduce each to a pointer. Separately, the "Launch." paragraph at runs.md:260 is a single paragraph of well over 1,000 words. Splitting it by topic (prompt contents, pending-failure lists, shell rules, VERIFICATION format, agent definitions) would help.

**N3. runs.md:68** "The first rules above are judged as described" does not say which rules. After fixing B1, name them or drop the clause.

## What I verified and did not flag

**Digests and mechanical sweep**
- Digests: all three match.
- Dashes: no em dash, en dash or ` -- ` in any of the three files.
- Sentence length: split with backtick spans counted by their words. None of the three documents has a sentence over 35 words. A dozen sit at exactly 33 to 35, for example runs.md lines 12, 80, 169, 260, 332, 377, 450 and 469. Those are within the cap.
- Delivery history: no phase, plan, decision or threat IDs in prose.
- File paths and function names: none in prose after the opening module lists, which is where CLAUDE.md allows them.
- Headings: all sentence case.
- Cross-references: all 19 anchors they cite exist (containment.md, autonomy-and-decisions.md, processes.md, cli-reference.md, config-reference.md, profiles-and-credentials.md, policy-and-approvals.md, and the indexes-and-context.md, runs.md and onboarding.md self-links).
- The integration tests named in "Verification" exist: index-stage, intel-step, knowledge-cost-cap, knowledge-pass, context.

**indexes-and-context.md: numbers checked against the code**
- Cost model: chunkUsd 0.0255, exponent 1.376, capShare 2/3 (src/domain/knowledge-corpus.ts:134).
- Chunk limits: 9 chunks at a 0.8 USD cap, 15 at 1.6 USD and 23 at 3.0 USD. I recomputed all three from the formula.
- Modelled 0.52 USD at 9 chunks, worst measured session scaled to 9 chunks is 0.54 USD, and the exponent of 1.376 from the two calibration means (0.7788 and 0.30).
- Calibration sessions: 0.302, 0.7518 and 0.8058 USD, and 0.0058 USD over a 0.8 USD cap.
- The 7 percent spread between the two 12-chunk sessions.
- Selection rules: the limit is at least 1 for a positive finite cap and 0 otherwise. A limit of 0 gives absent `budget_exhausted` before any corpus is written or invocation started (index-knowledge.ts:262).
- The corpus is a prefix of the priority order after the first `cost-cap` drop.
- The 200-file and 256 KiB caps, and the `corpusCap` field list with the 50-area cap.
- The cap source is the smaller of the contract's per-invocation cost and what is left of the run's cost budget (src/app/budget.ts:183).
- Chunk packing of 8 files and 64 KiB, with an oversize document in its own chunk, and the ceil-half usable-chunk rule with five skip reasons.
- Graph and knowledge validation: node text 2048 bytes, dangling share 10%, document coverage 50%, and at most 25 problems.
- `EXTRACTED` to `INFERRED` lowering, the planning-file citation rule, and the rule that validation requires `INFERRED` or `AMBIGUOUS` on edges that touch pass document nodes.
- Graphify timeouts (5 minutes extract, 2 minutes cluster) and the 64 MiB graph cap.
- Headings: the ATX parse matches headingOf line by line. That covers a 2,000-character cutoff, `## Goal#`, closing hashes, the code-fence rule, the 6000-character section cap, 50 handles, and 8 words with 200 characters.
- Planning-section reads (256 KiB, no link followed) and the deleted answer for a symlinked phases directory.
- Exclusion at any depth: a plain entry gives `entry`, `entry/**` and `**/entry/**`. A glob entry is root-anchored with `/**`. At most 5 hits per file and a 1 MiB blob cap. The 20-before and 19-after snippet window with a 1500-character cap.
- The relation table of descendants, one-hop and id-only. Depth 3 for descendants, 5 edge lines and 300-character clips. The intel excerpt is cut at 1500 characters.
- Untrusted marking: non-code nodes; code nodes whose excerpt shows a description or non-code neighbour; every intel entry, planning section and snippet.
- `codeNode` is set only by the graph source and carried through `PackItem` to `--json`.
- Fencing: `| ` prefix on every line, begin and end lines naming source and revision, a 400-character line cut, and control, zero-width and bidi characters turned to spaces.
- Pack rules: intel and planning share is ceil(budget/2). Planning is skipped when the graph returned an untrusted item. Paging is declared by no local source.
- Default budget 24,000 tokens and a maximum of 100,000.
- ADR-015: every statement in line 140 matches the ADR.
  - 4 of 6 against 4 of 6.
  - 17,557,851 against 18,715,894 tokens, a 6.19% edge.
  - 0.83 against 0.12 USD per project, about seven times.
  - The ADR calls the sample small and the tie-break thin.
  - The default stays on.

**runs.md: numbers and behaviour checked against the code**
- Start rules and limits: refusal codes (13, with 6 preflight rules in the stated order), 25 commits, 14 days, 500 candidate commits, 256 KiB conventions, 64 KiB brief, and 10 named runs in `active-runs`.
- Budgets: 120 minutes, 2n+1, 400n and 10n, 2.00 and 10.00 USD.
- Lifecycle: 11 states and 37 edges, resumable and stop states, and the 7 block reasons.
- G1's four failing cases plus the advisory.
- G2 scope and deletion rules, and the 72-character commit subject.
- The 2 MiB artifact cap, 64 KiB record cap and 600-character question cut.
- The context-pack bound of min(contextTokens, 32 KiB room), at most 8192 tokens.
- The scheduler's five dispositions and the shared continuable rule.
- Restricted stage:
  - Prompt, host composition and hint rule: the hint is added only when `claude` and gsd-core are present and a containment probe failed; a missing `claude`, gsd-core or preamble gets no hint.
  - `start --restricted` refusal before anything is stored.
  - Preparation does only the clone.
  - The three artifacts with 256 KiB, 256 KiB and 1 MiB caps.
  - Out-of-scope rules including a deleted artifact path being a breach.
  - 5 named paths cut to 80 characters, 10 recorded paths, and 440-character findings cut.
  - I computed the worst case of a roughly 936-character issue against the 1000 limit, so the ending survives.
  - The two-record step (`captured` false then true) and `scope-of-writes`.
  - `status` shows `restricted <state>`.
- Resume prelude and re-block order: reap, spend, no-replay block, reference refresh, then reconcile by state. The pause-then-block-again behaviour, `invocation.reaped` and `invocation.interrupted`, the failed `resume:reconcile` step, and that a reference-blocked run is final.
- Derivation: the derive-spec rules (fresh, or stale with the path confirmed; `.planning/` excluded; document, concept and intel nodes give nothing; derived files stay inside the write set). The run-contract candidate, symbol, config-key and reference rules match.

**onboarding.md: numbers and behaviour checked against the code**
- The `paths` scope refusal layers: 50 paths, internal error in the map stage, and invalid on `mapping:plan` in the loader.
- Promotion path rule: normal form, under `.planning/`, character set, and `.git` or dots-only segments. The `AVARICE <avarice@localhost>` identity and the `avarice/onboard-<id>` branch.
- Reap refusal: three situations, internal error naming the onboarding, no row marked.
- Stamp: after progressed, no-progress and inconclusive endings. A failed stamp is recorded and not raised. The resume path stamps fast, full and paths.
- Map invocation reconcile (more launches than validations).
- Resume entry rules: an active onboarding with an open promotion takes the lease.
- Budget preset (45 minutes split 20/10/15, 600 tool calls, 3.00 and 12.00 USD), and the derived totals of 12 and 6, 2 and 6, 0 and 3.
- Refresh constants: 29 manifest names, 3 new top-level directories, 50 scope paths and a 200-path cap.
- Validation limits: 5 percent dangling and 262144 bytes.
- 1000-entry preflight caps and 50 record findings.

**Checked and left alone (OBS-level, not findings)**
- The knowledge profile switch shows as "disabled" only for a contained onboarding. A restricted onboarding records the knowledge step absent with reason `restricted`, as indexes-and-context.md:26 says. The two statements are consistent.
- Several sentences use `;` joins at the 33-35 word edge. They pass the hard cap.

## Read-only proof
I modified no file. `git status --short` shows three untracked paths.
- `.planning/config.json` and `.planning/milestone.lock` were already untracked at the start of the run.
- `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-3-B.md` appeared during my run. I did not create it or read that directory. It is probably from the group B reviewer.

My only writes were helper scripts under /tmp, outside the repository.
