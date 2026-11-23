# Round 2, group D: fresh-eyes review (stored as round-2-D.md)

- Group: D (runs.md, onboarding.md, indexes-and-context.md)
- Round: 2
- Reviewer: fresh. I read none of 04-54-reviews/. Two untracked files, round-2-B.md and round-2-C.md, appeared there during my run. I did not create or open them.
- Date: 2026-11-22
- Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04
- sha256 as read. All three match the dispatch, so there is no mismatch to report.
  - docs/system/runs.md: cdd816d658e203c99ac76beb187828dd783666288efac753977b8c94b92396da
  - docs/system/onboarding.md: 2cd91575d3e5a451612aba3c735339acb610650c6bb3989edcf2ad002c21ae12
  - docs/system/indexes-and-context.md: 1e6551adb0612f853ab414d4ffa731bee5e2fe363d593d1424cef86a52a6d0f8

Severity as defined in the dispatch: BLOCKER is a factual error against the code. WARNING is a misleading or unsupported claim, or a doctrine violation. NIT is polish.

**VERDICT: FAIL. 1 BLOCKER, 6 WARNING, 5 NIT.**

## BLOCKER

**B1. indexes-and-context.md:184 (Validation of the merge) says pass nodes may not cite phase files.**
- Quote: "No node cites `.planning/STATE.md` or a Markdown, text, reStructuredText or AsciiDoc document under `.planning/phases/`. For pass nodes, anything under `.planning/phases/` is refused."
- Problem: the code applies the ban only to nodes the pass did not add. A pass node may cite a phase file or `STATE.md` when the manifest holds it, because both are corpus documents. The sentence is also false against the same document: the corpus table (:105, :107) and :227 say these files "may have document nodes".
- Evidence:
  - src/domain/knowledge-validation.ts:58-63 defines `forbiddenForAnyNode`.
  - knowledge-validation.ts:98-103 applies it only under `!fromPass`.
  - knowledge-validation.ts:104-108 holds pass nodes to "source is in the manifest, with the manifest revision".
  - No other file under src/domain or src/adapters/graph mentions `phases`.
- Fix: replace both sentences with "A node the pass did not add may not cite `.planning/STATE.md` or a Markdown, text, MDX, reStructuredText or AsciiDoc file under `.planning/phases/`. A pass node may cite them when the manifest holds them." The extension set is `md|mdx|markdown|txt|rst|adoc`.

## WARNING

**W1. onboarding.md:285 (prelude step 3) omits `paths` from the stamped modes.**
- Quote: "AVARICE stamps the map for fast and full".
- Problem: the stamp is applied for `fast`, `full` and `paths`. The same document says so at :194: "for fast, full and paths".
- Evidence: src/app/stages/shared.ts:180, `isStampedMode = mode === 'fast' || mode === 'full' || mode === 'paths'`. It is used in resume.ts:171.
- Fix: "AVARICE stamps the map for fast, full and paths".

**W2. onboarding.md:158 (scoped-map refusal) gives the wrong error kind for the live flow and omits the 50-path cap.**
- Quote: "A stored plan for `paths` is refused with an `invalid` error on the field `mapping:plan` when it lists no path, an entry that is not a string, or a path that fails the scope-path check."
- Problem: the map stage runs a stricter check before `prepareInvocation`. It refuses an empty list, a failing path, or more than 50 paths with an `internal` error ("the stored mapping plan has no valid path scope for a paths map"). In the live flow only the non-string entry yields `invalid` on `mapping:plan`, through `loadMappingPlan`. The `invalid` refusal in the invocation module is the second line of defence. The 50-path cap is not mentioned.
- Evidence:
  - src/app/stages/map.ts:19-28 (`MAX_PATHS = 50`, `scopeOf`) and :62-65, which run before `launchMap` calls `prepareInvocation` at :127.
  - src/app/stages/shared.ts:103-106 (non-string entry, `invalid` `mapping:plan`).
  - src/app/invocation.ts:107-111 (the later check).
  - The "not launched, nothing reserved or recorded, scope never widened" half is correct.
- Fix: name both layers. "The map stage refuses a plan with no path, a failing path or more than 50 paths as an internal error. `loadMappingPlan` and the invocation preparation refuse a non-string entry and an invalid scope as `invalid` on `mapping:plan`. In every case the map is not launched and nothing is reserved or recorded."

**W3. runs.md:466 has a 37-word sentence in running prose.**
- Quote: "Each is one sentence in the block text, such as `the plan could not be read (...)` or `the patch is larger than the 1 MiB limit and was not stored`, and the run still ends blocked."
- Problem: the hard cap is 35 words (style.md).
- Fix: end the sentence after the examples, then "The run still ends blocked."

**W4. runs.md:454 uses filler.**
- Quote: "A run blocked for this reason is final in practice: `resume` only reports it again, and `avarice cancel` ends it."
- Problem: "in practice" is on the banned filler list. It also hedges a rule the code enforces absolutely. The pickup rule reads only `reason === 'decision'`.
- Evidence: src/app/run-stages/schedule.ts:38.
- Fix: "A run blocked for this reason is final: ..." The Quirks bullet at :508 already says it without the hedge.

**W5. indexes-and-context.md:137 states the ADR-015 evaluation without its sample size or the ADR's own caveat.**
- Quote: "an evaluation against a code-only arm found it no less successful and cheaper in run tokens, though dearer to onboard".
- Problem: the claim drives a default but drops the ADR's limits. The sample is 6 tasks on one repository, one run per task and arm. Success is 4 of 6 each. The token edge is 6.2% of the code-only arm's tokens (17,557,851 against 18,715,894). The ADR says the tie-break is thin and a different draw could reverse it. Onboarding cost about seven times as much. The ADR also records that AC-8 failed.
- Evidence: docs/decisions/ADR-015-knowledge-pass-default.md:25-31 and :46-49.
- Fix: "On 6 tasks of one repository, one run per task and arm, the knowledge pass matched the code-only arm's successes (4 of 6 each), used 6.2% fewer run tokens and cost about seven times as much to onboard (ADR-015, which calls the sample small)."

**W6. indexes-and-context.md uses "state file" for two different files.**
- Quotes: :107 "the state file" and :105 "`.planning/STATE.md`", against :241 "revision `gsd-state:sha256:<hex>` of GSD's state file" and :301.
- Problem: in the corpus sections the term means `STATE.md`. In the context sources it means `.planning/state.json`, the file whose digest dates a planning section. A reader cannot tell them apart. :241 also never names the file.
- Evidence: src/adapters/context/gsd-planning.ts:15-16, 193 and :242 (`state.json`).
- Fix: name `.planning/state.json` at :241 and :301. Keep "the state file" for `STATE.md`, or call the JSON one "GSD's `state.json`".

## NIT

**N1. Opening sentences over 35 words.**
- Locations: runs.md:3 (79 words), onboarding.md:3 (40) and indexes-and-context.md:3 (43 and 44).
- Problem: each is a module enumeration in running prose. CLAUDE.md requires the opening to name modules once, so the content is right.
- Fix: put the module list into bullets, which fall under the reference-list exemption.

**N2. Modules behind described behaviour are not named in the opening.**
- onboarding.md names `src/app/stages/` but not `src/app/invocation.ts`, where the scoped-map refusal lives. The refusal is described at :158.
- runs.md:3 does not name `src/cli/composition.ts` or `src/app/run-stages/restricted.ts` by file. The directory `src/app/run-stages/` covers the second. The restricted host composition at :460 is described.
- Fix: add `src/app/invocation.ts` to the onboarding opening and `src/cli/composition.ts` to the runs opening.

**N3. Indirect-question headings and duplicated heading text.**
- Headings: indexes "What validation requires", "What the record states" (twice, :69 and :209), "What a read adds from the graph" and "What it asks". Runs "What a successful start stores".
- Problem: this is the "What X ..." heading form. The duplicate gives the same anchor to two sections.
- Fix: use noun phrases, for example "Graph validation rules", "Graph record fields", "Knowledge record fields" and "Command inputs".

**N4. Planning freshness table (indexes-and-context.md:301) omits `unavailable`.**
- Problem: `find` returns `unavailable` when `state.json` is absent, and `refresh` does the same. The row lists only `fresh` and `stale`.
- Evidence: gsd-planning.ts:196-197 and :262.
- Fix: add "`unavailable` when `state.json` is absent".

**N5. indexes-and-context.md:316 says an edge in another node's excerpt names a non-code neighbour "by its type, never by its label".**
- Problem: for an `id-only` relation it names the neighbour's ID, as :266 says. "Never by its label" is true. "By its type" holds only for the `one-hop` and `descendants` rules.
- Evidence: gsd-graph.ts:60-72.
- Fix: "by its type, or by its ID for an `id-only` relation, never by its label".

## Checked and deliberately not flagged

**Numbers verified against constants.** All matched unless listed above.
- indexes-and-context.md, cost model:
  - Constants `0.0255`, `1.376` and `2/3`.
  - Limits 9, 15 and 23 chunks at 0.8, 1.6 and 3.0 USD (recomputed).
  - 0.524 USD modelled at 9 chunks, and 0.542 USD measured scaled to 9 chunks.
  - The 2.6 ratio, the 7% spread, and `Math.max(1, ...)`.
  - The zero limit reported as `budget_exhausted` before any corpus or manifest.
  - The `corpusCap` fields, with at most 50 areas and `omittedMoreAreas`.
  - The unit test pins the three sessions and the 15 and 23 limits (test/unit/knowledge-cost-cap.test.ts).
- indexes-and-context.md, corpus and chunks: 256 KiB per file, 200 files, 8 files and 64 KiB per chunk, half the plan rounded up, first 5 skip reasons, 2048-byte node text, 10% dangling, 50% coverage, 25 problems, 0.8 score cap, 1 MiB chunk file (via `CHUNK_LIMITS`).
- indexes-and-context.md, graphify: 5 and 2 minute timeouts, 64 MiB graph.
- indexes-and-context.md, planning parser (gsd-planning.ts): heading rule including `## Goal#`, 2000-character line cap, 8 words, 200 characters, 50 handles, 6000-character cut, 256 KiB file.
- indexes-and-context.md, file search (git-files.ts): 5 hits per file, 1 MiB blob, 20 lines before and 19 after, 1500 characters, exclusion at any depth for a plain entry. A glob entry is root-anchored.
- indexes-and-context.md, context command: 100000 budget cap, 24000 default, 400-character line cut, the half-budget shares and rounding (context.ts).
- indexes-and-context.md, graph excerpt: 5 edges, depth 3, 300-character clip, 1500-character intel cut. The relation table matches retrieval-rules.ts.
- indexes-and-context.md, ADR-015: link target exists.
- onboarding.md, promotion (promotion.ts): the path rule (normal form, under `.planning/`, character set, `.git` in any case or dots-only segment), commit identity and message, create-only fetch, branch collision.
- onboarding.md, resume and reap: reap order, the unreapable-launch refusal (three causes), stamp then `validating`, and the lease reconcile of a promotion on an active onboarding.
- onboarding.md, lifecycle: 14 states and 29 transitions (recomputed from the table), 17 kill points, 29 manifest names, thresholds 3 and 50, the 200-path cap, the budget presets and the derived 12 and 6, 2 and 6, and 0 and 3.
- onboarding.md, other limits: 1000-entry list cap, 5% dangling, 262144 bytes, 32 spec files and 512 KiB, mode 0444, 64 KiB proposal, 50 findings.
- runs.md, lifecycle: 11 states and 37 transitions (recomputed), the 7 block reasons, and the 180 s lease.
- runs.md, budgets and start: preset budgets (120 min, `2n+1`, `400n`, `10n`, 2, 2.00 and 10.00 USD), overrides including the retrieval ceilings, the 13 refusal codes, 25 commits and 14 days, 500 commits walked, the "ten of them" message, 250 ms poll plus 15 minutes, 24 h resume wait, 60 s cancel lease.
- runs.md, brief and amendment: brief limits (64 KiB, 4096, 20, 200, 128, 1000, 20 items, id pattern, 7 keys), conventions never-granted words, check-name pattern, 128 `--add-write` globs, 500-character reason.
- runs.md, units and restricted runs: commit subject at most 72 characters with the fallback text, 2 MiB archive, 2000-character answer, 600-character question, 32 KiB prompt giving at most 8192 tokens (32768/4), restricted limits (256 KiB, 1 MiB, 5 paths at 80 characters, 440 and 1000, 10 finding paths), breach rules.

**Behaviour checked.**
- runs.md, restricted flow:
  - The restricted host refusals, the `composition.ts` hint rule, the preparation skip, the two-step capture and the kill-resume path.
  - The status label `restricted <state>`.
- runs.md, resume re-block:
  - The prelude order.
  - The pause-then-block rule for references and for interrupted privileged actions.
  - The reference decision (class and `withdraw` only), the `resume:reconcile` failure path and exit 70, and the `gated`/HEAD reconcile with trailers and a single parent.
  - The host-config-dir refusal in `resume` and `decide`.
- runs.md, spec derivation and scope:
  - The `collectIndexFacts`/`deriveItemSpec` rules, including `codeNode` and the `.planning/` exclusion.
  - The G2 outcome table and the G1 rules. The `in-scope` definition matches `isInScope`.

**Mechanical sweep.**
- No em dash, en dash or ` -- ` in any of the three files.
- No frontmatter, no changelog or "last updated" field.
- No delivery history in prose: no phases, plan IDs, SHAs or threat IDs. The only ADR mention is a citation.
- No `src/` paths or function names outside the opening paragraph.
- No broken relative links. All 30 or so anchors resolve.
- Headings are in sentence case.
- No banned constructions beyond W4. Antithesis, triads, cursed vocabulary and inflated adjectives came up empty.
- Sentence length over 35 words: only W3 and N1. onboarding.md:247 (140 words) is a record-field reference list, exempt. Table rows and code spans were excluded.

**Not flagged as errors (the code is not contradicted).**
- runs.md:270 says the host returns the last 2000 characters "as the unit's question and nowhere else". The question is stored as data in the decision issue (:290, :474). That is host-level wording, so I left it.
- indexes-and-context.md:326 omits "unknown project" from the exit-3 list. `not_found` maps to exit 3, so the list is incomplete, not wrong.
- The refresh path in indexes-and-context.md:143 does not mention salvaged chunks from an interrupted attempt (index-knowledge.ts:324-334). That is an omission, not an error.

**Read-only proof.**
- After the run, `git status --short` shows only `.planning/config.json` and `.planning/milestone.lock`, which were untracked at the start, plus the two untracked round-2-B.md and round-2-C.md files noted above.
- `git diff --stat` is empty. The three digests were re-computed and are unchanged.
- My only writes were scratch files under /tmp/rev-d, outside the repository.
