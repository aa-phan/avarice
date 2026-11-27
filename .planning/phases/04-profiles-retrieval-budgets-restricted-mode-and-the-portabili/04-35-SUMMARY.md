---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 35
subsystem: testing
tags: [ac-14, brownfield-benchmark, onboarding, knowledge-pass, live-spend, containment, secrets]

requires:
  - phase: 04-34
    provides: the verified host (Claude 2.1.326), the restricted-mode live cases and the live-spend ledger helpers
  - phase: 04-10
    provides: the onboarding outcomes (map, isolated regeneration) and the existing-map classification
  - phase: 04-14
    provides: the refresh planner and the refresh modes
  - phase: 04-17
    provides: the knowledge pass and its cache
provides:
  - "AC-14 measured live: 5 of 5 approved repositories active with the knowledge pass, every checkout and ref set byte-identical before and after, 0 containment failures"
  - "scripts/exit-run-phase4-tools.ts (dry-run, authorize, run-one, classify, verify, finish, ids) and scripts/exit-run-phase4.sh"
  - "the AC-14 evidence file with nine attempts, four owner rulings and the recorded finish"
  - "seven product and harness fixes found by the live run, each with a failing test first"
affects: [04-36, 04-38, phase-4-verification, phase-4-documentation-plan]

actuals:
  tokens: 41600
  tasks: 3
  commits: 32
plan_head_before: dc7403d
plan_head_after: 8639b9f

tech-stack:
  added: []
  patterns:
    - "an AC-14 entry passes only when the record is active AND the knowledge index is present (judgeEntry and verify)"
    - "the mapper is told what the validation secrets check rejects, from the check's own pattern list"
    - "the knowledge corpus is limited to the chunks one invocation can pay for, in priority order"

key-files:
  created:
    - scripts/exit-run-phase4-tools.ts
    - scripts/exit-run-phase4.sh
    - test/unit/exit-run-phase4-tools.test.ts
    - test/unit/mapper-secrets-rule.test.ts
    - test/unit/knowledge-cost-cap.test.ts
    - test/integration/knowledge-cost-cap.test.ts
    - test/unit/path-references-plausibility.test.ts
    - src/domain/chunk-packing.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-35-evidence-ac14.json
  modified:
    - src/domain/mapping.ts
    - src/domain/secret-patterns.ts
    - src/app/stages/map.ts
    - src/domain/knowledge-corpus.ts
    - src/app/stages/index-knowledge.ts
    - src/domain/path-references.ts
    - src/domain/onboarding-contract.ts
    - src/domain/validation.ts
    - src/app/budget.ts
    - docs/system/onboarding.md
    - docs/system/indexes-and-context.md
    - docs/system/config-reference.md
    - docs/system/findings.md
    - test/containment/live-spend-phase4.jsonl

key-decisions:
  - "Owner ruling 4 (2026-11-18T18:44:21Z, \"a\"): the GroceriesGPT secrets block is a product-defect; the mapper is told never to write a credential-bearing value and to describe the setting instead, and the validation secrets gate stays exactly as it was"
  - "The mapper rule lists the kinds the validation scan reports by reading the scan's own pattern list (secretKinds), and carries no example URL so a copy of it cannot trip the scan"
  - "The knowledge corpus chunk limit is floor((per-invocation cap x 2/3 / 0.0255)^(1/1.376)), 9 chunks at 0.8 USD, fitted to measured session cost (rulings 2 and 3)"
  - "A repository that ends active with its knowledge index absent fails the AC-14 judge and verify, and the stop-loss counts stopped attempts only (ruling 3)"

patterns-established:
  - "Live benchmark stop: record the evidence, propose a D-04 classification, return to the owner; no retry, no cap raise and no product fix-and-respend without a ruling"
  - "Fix by ruling: record the ruling in the evidence file and commit before any change or spend, then a failing test, then the fix"

requirements-completed: [ONB-6, ONB-11, ONB-15]

coverage:
  - id: D1
    description: "5 of 5 approved brownfield repositories reach an active record with the knowledge pass, each checkout and ref set byte-identical before and after, 0 containment failures (AC-14, SC4)"
    requirement: ONB-6
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase4.sh --verify (exit 0: 5 of 5 active, spend under 04-35 3.7407 USD, Phase 4 3.9267 USD)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-run-phase4-tools.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "auto_search_workflow, a repository with existing GSD artifacts (map class user-edited, 9 user-owned paths), is onboarded by isolated regeneration with its checkout unchanged"
    requirement: ONB-6
    verification:
      - kind: other
        ref: "04-35-evidence-ac14.json entry auto_search_workflow attempt 2: state active, outcome isolated-regeneration, differences []"
        status: pass
    human_judgment: false
  - id: D3
    description: "The portfolio's onboarding is a refresh of its active record: refresh mode full (no-stamp), knowledge cache hits null because no earlier knowledge cache existed"
    requirement: ONB-11
    verification:
      - kind: other
        ref: "04-35-evidence-ac14.json entry aa-phan-portfolio-v2 attempt 3: expectedPath refresh, refresh.mode full, knowledgeCacheHits null"
        status: pass
    human_judgment: true
    rationale: "ONB-11 and ONB-15 ask for a cache-hit measurement; the portfolio had no prior knowledge cache, so the hit count is null, not a measured positive. The owner decides whether a second portfolio run to measure hits is wanted."
  - id: D4
    description: "Every map prompt (full, fast, paths and restricted) tells the mapper never to write a value the validation secrets check reports and to describe the setting instead; the check is unchanged"
    requirement: ONB-15
    verification:
      - kind: unit
        ref: "test/unit/mapper-secrets-rule.test.ts"
        status: pass
      - kind: other
        ref: "GroceriesGPT attempt 2 ended active after attempt 1 blocked on url-userinfo at validate"
        status: pass
    human_judgment: false

duration: "16h 19m elapsed across continuations (2026-11-17T20:50 to 2026-11-18T13:09 -06:00), most of it waiting on rulings"
completed: 2026-11-18
status: complete
---

# Phase 04 Plan 35: The AC-14 brownfield benchmark Summary

**Five owner-approved brownfield repositories onboarded live with the knowledge pass, 5 of 5 active with byte-identical checkouts and 0 containment failures, for 3.7407 USD, after seven fixes the live run forced and four owner rulings.**

## Performance

- **Duration:** 16h 19m elapsed (waiting on rulings included)
- **Started:** 2026-11-17T20:50:53-06:00 (first commit of the plan)
- **Completed:** 2026-11-18T19:08:48Z (finish recorded)
- **Tasks:** 3 (tracer, owner authorization, the five onboardings)
- **Files modified:** 28 (33 including evidence and ledger)

## Accomplishments

- AC-14 passed: `scripts/exit-run-phase4.sh --verify` and `--finish` exit 0 with 5 of 5 active, every digest equal, 0 containment failures, and the knowledge index present on each repository.
- One repository with existing GSD artifacts, auto_search_workflow (class `user-edited`, 9 user-owned paths such as `.planning/config.json` and `.planning/state.json`), took the `isolated-regeneration` path; its checkout, including `.planning/`, is byte-identical after.
- The portfolio refreshed its active personal-local record: refresh mode `full` (reason `no-stamp`: the old map carried no `last_mapped_commit`), expected path `refresh`.
- The exit tools: a dry run with digests and a spend projection, terminal-only authorization, `run-one` with the stop-loss and ruling guards, `classify`, `verify`, `finish`.

## Per-repository results

| Repository | Path | Mapping mode | Map class and outcome | Final attempt | Knowledge pass | Cost (final / all attempts) | Containment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| aa-phan-portfolio-v2 | refresh (personal-local) | full | none, map | 3 of 3 | present: 9 chunks, 41 documents kept, 140 omitted (cost-cap), 41 document nodes, 0 dropped; cache hits null | 0.6544 / 2.0181 | 0 |
| auto_search_workflow | onboard (personal-extended) | full | user-edited, isolated-regeneration | 2 of 2 | present: 12 chunks, 41 documents kept, 34 omitted (cost-cap), 41 document nodes | 0.9743 / 1.1717 | 0 |
| GroceriesGPT | onboard (personal-extended) | full | none, map | 2 of 2 | present: 8 documents (map and docs), none omitted, 8 document nodes | 0.1550 / 0.2724 | 0 |
| spf13-cobra | onboard (personal-extended) | full | none, map | 1 | present: 7 documents (the map), none omitted | 0.1116 / 0.1116 | 0 |
| BurntSushi-ripgrep | onboard (personal-extended) | full | none, map | 1 | present: 7 documents (the map), none omitted | 0.1668 / 0.1668 | 0 |

All five ended `active`, `completeness: complete`, indexes `graph` and `intel` present, `knowledge` present, `indexesAbsent` empty. The 9 attempts total 3.7407 USD under plan 04-35 of the 8.00 USD group cap (per-invocation cap 0.8, per-repository 1.6, unchanged since the owner's authorization at 2026-11-18T03:06:08Z). Phase 4 spend is 3.9267 USD of the 40 USD ceiling (38 ledger lines).

## Checkout and ref digests

Taken by `scripts/checkout-digest.ts` before and after each run; every pair is equal (`differences: []`). The files digest and refs digest before and after:

| Repository | HEAD | Files digest | Refs digest |
| --- | --- | --- | --- |
| aa-phan-portfolio-v2 | 9f63d91 | c4041f1c27f5023e8fd316dddab4c2301482acb64ed6747bae9732b944b258e8 | 566b6dd37048f074ba14f5a1b2f6951571c97002ae05f3db0b7ff6944fd76e14 |
| auto_search_workflow | 6a82d35 | 0beb598c4f54dbcdb2400809e909ced3992303ff3ee82e359f91dfcd2787c2f1 | cd09e4e35d73d08a7dcc6ef30d41fd2c34ed0884744a7baca77ef1665ee1624a |
| GroceriesGPT | 1913423 | 54dcf445db817190a3e2cdedbf05b2aec63330a176c92a058baee2985f769d9b | d201fc7841499579b434bbc78a854707d03939179364e5678d9ae0419cddf9e1 |
| spf13-cobra | 88b30ab | 084351da151fd5cab554c714d7d937b848ab12f3c9732a0c755bfa315e364bfd | b37788640e99516e95be09a76e3592966d1288de82d8c6100627fa372ad9769b |
| BurntSushi-ripgrep | e89fff8 | d02260d0eddc8b752c441dc18ed9fd79236c68c31889082e44429f7f1b09f282 | 861abc8548ee705b2a1d5abeda61927980f67d2a77cf82239d7af3c5d5363ae9 |

The status, worktrees, index, git-metadata and ignored-file digests are in the evidence file.

HEAD-past-pin notes (the onboarding maps HEAD, never the pin): aa-phan-portfolio-v2 HEAD 9f63d91 is past the listed pin 9f1cd8d (the old record is at 9f1cd8d; the refresh moved it to 9f63d91); auto_search_workflow HEAD 6a82d35 is past the pin c81c231. The three public repositories were cloned at their pins and are at their pins. Uncommitted entries at dry run: the portfolio 1, auto_search_workflow 8, GroceriesGPT 14 (digested before and after; the onboarding reads committed content).

## Task Commits

Commits are measured from the sentinel `dc7403d` (plan head before): 32 commits to `8639b9f`, this SUMMARY's commit excluded.

1. **Task 1: tracer, the exit tools' dry run** - `c93f1d6` (test), `0759ec3` (feat)
2. **Task 2: owner authorization** - `c01d5f6` (docs; the owner ran `authorize` in their own terminal, `ownerConfirmedAt` 2026-11-18T03:06:08Z, profile choice `extended`)
3. **Task 3: the five onboardings and the evidence** - `af1a103`, `50aea87`, `c6d7483`, `836708a`, `eac38a7`, `820c3a8`, `8639b9f` (evidence), with the fixes below between them

**Plan metadata:** the commit that follows this file (docs: complete plan)

## Fixes the live run forced

Each was classified (D-04) and ruled on by the owner before the retry; each has a failing test committed first.

1. **Host path (harness defect), `4048684`.** `run-one` expanded the host path the authorization records home-redacted (`~/...`) before spawning. The authorization stores the pinned host as `~/.local/share/...`, so `run-one` refused before starting anything; no spend, nothing started.
2. **Path plausibility (product defect), `4a8cc2d`, `1054bab`.** The validation path-references check counted non-path tokens as named paths: auto_search_workflow's first map was rejected at 9 of 115 named paths dangling (7.8 percent, limit 5), the dangling names being model ids, Python syntax and a timezone (`openai/gpt-oss-120b`, `try/finally`, `America/Chicago`). A slash path with no extension now counts only under a top-level entry or in an explicit directory form; a host-name path is counted neither as named nor as dangling. The 5 percent limit and every extension-bearing path are unchanged. Ruling 1.
3. **Subagent budget (product defect), `cb1afde`, `7faafe2`.** The in-run retry of auto_search_workflow's map spent its four subagents and asked for a fifth (a re-run of the concerns mapper); the hook denied it and the onboarding blocked (`budget_exhausted`, 0.197 USD) although the files were written. A full map's subagent total is now (4 + 2) x 2 = 12; any hook denial still blocks. Ruling 1, option (i).
4. **Corpus cap (product defect), `4ec5d0f`, `3ec843f`.** The portfolio's 181-document, 53-chunk knowledge corpus could not be read in one contained session (the first session wrote 6 chunks near 0.30 USD and ended `no_progress`). The corpus is now limited by the cost of one invocation, in priority order (map, planning documents, ADRs, docs, then phase files). Ruling 2, option A; the partial-end add-on was not chosen, so a clean partial end stays `no_progress`.
5. **Corpus cap recalibration (product defect), `2b2f70e`, `62d90ac`.** At 12 chunks the portfolio session overran its 0.8 USD cap by 0.0058 USD and the stage discarded 12 complete chunk files. Measured cost is superlinear in chunks, so the limit is now fitted to the measured curve: 9 chunks at 0.8 USD. How a `budget_exhausted` ending is classified is unchanged. Ruling 3, option a.
6. **Re-run guard (harness), `be33bdb`, `428e13d`.** `run-one` refused every second run of an active repository; it now runs one again, with a ruling reference, only when its knowledge index was absent.
7. **Verify gap and stop-loss counting (harness), `97305f5`, `6097602`.** An active entry whose knowledge index is absent now fails `judgeEntry` and `--verify` (the plan's truth is active WITH the knowledge pass), and the stop-loss counts stopped attempts only, so the owner's third portfolio attempt was not blocked by two earlier active ones. Ruling 3.
8. **Mapper secrets rule (product defect), `bfa6acb`, `69fb0a2`.** The mapper contract did not forbid writing credential-bearing values, and GroceriesGPT's map quoted the repository's own development database URL (`postgresql://` with a user name and password, from its platform config) in INTEGRATIONS.md and CONCERNS.md; validation rejected both for `url-userinfo`. Every map prompt now ends with a rule that names the kinds the secrets check reports and tells the mapper to describe the setting instead. Ruling 4.

Item 8 is the mapper rule asked for under ruling 4; items 1 to 7 are the "tool 4048684, path plausibility, subagent budget, corpus cap and its recalibration, re-run guard, verify gap and stop-loss counting" set.

### Where the secrets rule lives and its test

- `mapperSecretsRule()` and `withMapperSecretsRule()` in `src/domain/mapping.ts`; the kind list and their descriptions come from `secretKinds()` and `SECRET_KIND_DESCRIPTIONS` in `src/domain/secret-patterns.ts`, read from the scan's own pattern list. `promptFor` in `src/app/stages/map.ts` (full, fast, paths, with or without the existing-map answer) and `restrictedMapPrompt` both apply it, once.
- `test/unit/mapper-secrets-rule.test.ts` (18 tests): the rule names every kind the check reports, the list cannot gain a kind without a description, the rule forbids a user-name-and-password URL and says to describe the setting, the rule text itself holds nothing the check would report, every mode's prompt and its restricted form carries it exactly once, and the validation check is unchanged (a development database URL still reports `url-userinfo`; the kind list is unchanged). RED was 15 failing assertions against a skeleton.
- The validation secrets gate was not touched: not loosened, skipped or allowlisted.

## Owner rulings (all four)

| Ruling | Time | Reply | Decision |
| --- | --- | --- | --- |
| 1 | 2026-11-18T03:44:06Z | "fix all, retry(i)" | auto_search_workflow stop: product defects, fix all, subagent option (i), retry (attempt 2 of 2), re-run the portfolio to measure the knowledge pass, then the other three; same authorization and caps |
| 2 | 2026-11-18T07:05:38Z | "A" | cap the knowledge corpus by cost; the partial-end add-on not chosen |
| 3 | 2026-11-18T08:03:10Z | "a" | recalibrate the cap (9 chunks at 0.8 USD), close the verify gap, a third portfolio attempt only; classification of a `budget_exhausted` ending unchanged |
| 4 | 2026-11-18T18:44:21Z | "a" | GroceriesGPT secrets block is a product-defect: add the mapper rule, keep the gate as is, re-run GroceriesGPT once, then spf13-cobra and BurntSushi-ripgrep; caps unchanged |

## Offline proof before the last spend (after the mapper rule)

Under `caffeinate -i`: the unit suite 2852 of 2852; `onboard-adopt`, `validation-failures`, `restricted-onboarding`, `knowledge-pass`, `index-stage`, `profile-isolation` and `run-sandbox-other-profiles` (AC-6), `redaction-suite` (AC-5) and the 04-35 tools test, 162 of 162 together; `npm run typecheck` and `npm run check:boundaries` clean. `redaction-suite` (AC-5) was run again on the final state: 5 of 5.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The mapper wrote a credential-bearing URL and validation blocked the onboarding**
- **Found during:** Task 3 (GroceriesGPT attempt 1)
- **Fix:** the mapper secrets rule above, under owner ruling 4.
- **Commits:** `bfa6acb`, `69fb0a2`

Fixes 1 to 7 above are the earlier deviations of Task 3, each classified and ruled on (Rules 1 and 3 where they were mine, the rulings where a classification was the owner's).

**Total deviations:** 8 fixes (product defects 5, harness defects 3). **Impact on plan:** each fix was needed for AC-14 to be measured on the real pipeline; none widened the benchmark's scope or the authorized caps.

## Authentication Gates

Task 2 is the owner's terminal-only authorization (`authorize` refuses without an interactive terminal); it is a designed checkpoint, not a deviation.

## Issues Encountered

- GroceriesGPT stopped once (secrets at validate), auto_search_workflow once (path-reference false positives, then the denied fifth subagent), and the portfolio ended active without its knowledge index twice (no knowledge pass, then `budget_exhausted` with 12 of 12 chunks written). Each stop was recorded with a proposed classification and ruled on before any retry.
- `knowledgeCacheHits` is null for the portfolio: it had no earlier knowledge cache, so there was nothing to hit. See coverage D3.

## Known Stubs

None.

## Threat Flags

None. The mapper rule adds text to a prompt; it adds no endpoint, path or trust boundary.

## Next Phase Readiness

- 04-36 and 04-38 can cite the evidence file's `finish` block (5 of 5, 3.7407 USD under the plan, Phase 4 3.9267 USD).
- The phase's documentation plan must review `docs/system/onboarding.md` and `indexes-and-context.md` (the secrets rule, the corpus cap), and the owner decides the two findings logged here (the proposal says nothing about telling the mapper not to write a credential, and ONB-14 and ONB-15 name no cost cap).

## Self-Check

## Self-Check: PASSED

Every created file above exists on disk, and every commit hash cited is an ancestor of HEAD (read from `git log dc7403d..HEAD`, 32 commits).

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-18*
