---
phase: 03-decisions-independent-work-and-amendments
plan: 40
subsystem: run-supervisor
status: complete
tags: [gap-closure, prompt-scope, pause-attribution, fail-closed, exit-run-1, offline, aut-1, aut-2, aut-3, tdd]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-28's work-item prompt and the item-local decisions, and 03-29's exit run 1 evidence (the defect)"
provides:
  - "itemBehavior and the item choice options (src/domain/item-scope.ts): an item's own and shared Behavior paragraphs, and the normalized options an item owns"
  - "attributeNumberedChoice and choiceLines (src/domain/outcome.ts): the fail-closed rule that says whether a numbered choice belongs to another item"
  - "classify records pauseAttribution and pauseAttributedTo on the classify step; an attributed unit is classified as if no pause signal were present"
  - "an item prompt without the run title and with only the item's own and shared Behavior paragraphs"
  - "an offline reproduction of exit run 1 (test/integration/run-pause-attribution.test.ts) with three controls"
  - "docs/system/runs.md and containment.md describe both fixes; one findings line"
affects: [03-41, 03-42, 03-30, 03-31, 03-32, 03-33]

actuals:
  tokens: 70000
  tasks: 3
  commits: 5
plan_head_before: dec660ea89177df3fce8802792ce3c597dadb70b
plan_head_after: bd02c8b174b44000e45a1ee80e817aaf0c9f8bc5
commits: 5

tech-stack:
  added: []
  patterns:
    - "Attribution is a pure rule over normalized option sets, built by the caller from the brief and the ledger; it returns the item or a fixed reason, and any doubt means no attribution"
    - "A stub with inert bodies is committed with the RED tests so the target fails on assertions, not on a missing import"

key-files:
  created:
    - src/domain/item-scope.ts
    - test/integration/run-pause-attribution.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-40-evidence-red-unit.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-40-evidence-red-integration.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-40-evidence-red-prompt-unit.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-40-evidence-red-prompt-integration.json
  modified:
    - src/domain/outcome.ts
    - src/app/run-stages/item.ts
    - src/app/run-gsd-config.ts
    - test/unit/outcome.test.ts
    - test/unit/run-gsd-config.test.ts
    - docs/system/runs.md
    - docs/system/containment.md
    - docs/system/findings.md

key-decisions:
  - "A criterion's options are its own numbered lines (the criterion text split on newlines), not the whole criterion text: a decision criterion usually carries none, and the whole text as an option would add a way to be attributed without a listed wording"
  - "The unit's own side also counts the options of its own decisions in every state, not only open ones: a choice the unit asked and the owner answered stays its own. This only adds pauses"
  - "An unreadable decision list means no attribution (today's pause), not a stage error"
  - "An item label matches an item ID exactly; the 'Item' and 'Work item' keywords are case-insensitive. A label for an ID that is not an item of the brief leaves the paragraph shared"
  - "No requirement is marked complete: requirements.ready-ids reported 0 of 3 ready (AUT-1, AUT-2 and AUT-3 are declared by sibling plans without a SUMMARY yet)"

requirements-completed: []

coverage:
  - id: D1
    description: "Exit run 1's shape offline through the real supervisor and the fake host: A (verified) ends with B's numbered choice and is committed with passed G2; only B blocks, on its own question; C is ready with no attempt; one open decision (affected B and C) and one delivered notification; A's classify step records pauseAttributedTo B and no question text"
    requirement: "AUT-3"
    verification:
      - kind: test
        ref: "test/integration/run-pause-attribution.test.ts#exit run 1 offline: A is verified and ends with B's numbered choice, A commits and only B blocks (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Controls: a choice listed in A's own paragraph, a unit whose VERIFICATION is gaps_found, and one wording plus a paraphrase each pause A as today, with the reason recorded on the classify step"
    requirement: "AUT-1"
    verification:
      - kind: test
        ref: "test/integration/run-pause-attribution.test.ts#control: A ends with a numbered choice whose options its own Behavior paragraph lists"
        status: pass
      - kind: test
        ref: "test/integration/run-pause-attribution.test.ts#control: A ends with B's wordings but its VERIFICATION is gaps_found"
        status: pass
      - kind: test
        ref: "test/integration/run-pause-attribution.test.ts#control: A ends with one of B's wordings and one paraphrase"
        status: pass
    human_judgment: false
  - id: D3
    description: "The attribution rule is fail closed: shared paragraphs, two candidate items, a split match, no owner choice, one item, a structural signal, an unverified unit and empty lines all keep the pause"
    requirement: "AUT-2"
    verification:
      - kind: test
        ref: "test/unit/outcome.test.ts#attributeNumberedChoice"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each unit's prompt carries only its own item's title, its own and the shared Behavior paragraphs and its own criteria, with no run title; a single-item prompt is byte-identical to the recorded snapshot; the resume, answer and repair lines are unchanged. In the integration run A's recorded prompt has neither wording of B and B's has both"
    requirement: "AUT-1"
    verification:
      - kind: test
        ref: "test/unit/run-gsd-config.test.ts#runUnitPrompt scoped to one item (plan 03-40)"
        status: pass
      - kind: test
        ref: "test/integration/run-pause-attribution.test.ts#exit run 1 offline: each unit is shown only its own item's part of the brief"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/system/runs.md and containment.md describe the scoped item prompt and the attribution rule without naming a plan, file or function in the prose"
    verification:
      - kind: command
        ref: "node -e check of runs.md and containment.md (the plan's fourth automated check)"
        status: pass
    human_judgment: true
    rationale: "Whether the prose reads clearly and is complete is for the fresh reviewer of plan 03-33"
---

# Phase 3 Plan 40: Item prompt scope and pause attribution Summary

A unit now sees only its own item's part of the brief, and a numbered choice that belongs to another item no longer parks a verified unit; the rule fails closed and the exit-run-1 shape completes offline.

## Performance

- **Duration:** about 1 h 40 min of wall clock (shared, loaded machine)
- **Tasks:** 3 (one tracer, two auto, TDD)
- **Files:** 8 modified, 6 created (four RED evidence records, the new domain module and the integration suite)
- **Spend:** none. No live call, no AVARICE_LIVE run, no contact with the owner's portfolio

## The rule as built

**Prompt scope.** In a run with several items, an item prompt writes `Behavior:` from the item's own part of the brief and writes no `Task:` line. A Behavior paragraph (blank-line separated) whose first non-empty line starts with `Item <id>:` or `Work item <id>:` for an item ID of the brief belongs to that item. Unlabelled paragraphs are shared. A Behavior that labels no paragraph is given whole. The `Work item <id>:` line, the item's criteria, exclusions, paths, records, commands, shell rules, decision sentence, workflow sentence and no-commit sentence are unchanged. A single-item prompt is byte-identical to a recorded snapshot.

**Attribution.** `classify` asks `attributeNumberedChoice` only when `detectPause` returned `numbered-choice`. A choice is attributed to item Y only when: the signal is the numbered-choice shape; the unit is verified (VERIFICATION `passed`, a SUMMARY, at least one in-scope change, and `classifyOutcome` of the same facts with no pause is `progressed`); the run has two or more items; every choice line (normalized: number, backticks and all quote characters removed, whitespace collapsed, lowercased, one trailing period dropped) equals an option of Y; no line equals an option of any other item, of the unit's own side (own item, its decisions, shared paragraphs); and Y has a `decision:` criterion or an open decision. Y's options are the numbered lines of its labelled paragraphs and of its `decision:` criteria, plus the labels of its open decisions. An attributed unit is classified `progressed`, goes through G1, G2 and the commit like any other, and the classify step records `pauseAttribution` (`signal`, `attributedTo`, and the reason when not attributed) and `pauseAttributedTo`. The question text is never recorded, and nothing is opened, answered or withdrawn on Y.

## RED evidence (TDD)

All four records were accepted by `gsd-tools check tdd-red-evidence` (`RED_EVIDENCE_OK`) and are in the phase directory.

| Record | Target failed on | Semantic assessment |
|---|---|---|
| `03-40-evidence-red-unit.json` | `attributes a verified unit's numbered choice to the other item...` (12 failing of 60) | the inert stub returned null; the planned result was `{ attributedTo: 'B' }` |
| `03-40-evidence-red-integration.json` | A's item state `blocked_on_decision`, expected `done` (4 failing of 7; the three controls passed as regression guards) | reproduces the exit run 1 defect: two decisions, A uncommitted |
| `03-40-evidence-red-prompt-unit.json` | `shows item A none of B's wordings...` (4 failing of 46; the single-item snapshot passed as a guard) | A's prompt carried the whole Behavior and the run title |
| `03-40-evidence-red-prompt-integration.json` | A's recorded prompt held B's wordings (2 failing of 2) | the live prompt leaked the other item's owner choice |

RED commits carried signature-only stubs (inert bodies, and the optional `behavior` field) so each target failed on an assertion, not on a missing import.

## Task commits

| Task | Commit | Type | What |
|---|---|---|---|
| 1 RED | a850b72 | test | unit cases, run-1-shaped integration, stubs, evidence |
| 1 GREEN | e82728c | feat | item-scope, choiceLines, attributeNumberedChoice, classify wiring |
| 2 RED | 5b6d987 | test | scoped prompt unit cases, single-item snapshot, prompt assertions |
| 2 GREEN | 0a47963 | feat | item prompt without the run title, promptItemOf behavior |
| 3 | bd02c8b | docs | runs.md, containment.md, findings.md |

## Verification

- `node --test test/unit/outcome.test.ts test/integration/run-pause-attribution.test.ts`: pass (60 unit, 7 integration)
- S-17 offline, decision resume, decision policy, prompt policy, models: pass unchanged
- Whole unit suite (`test/unit/**`): 1924 pass, 0 fail
- All `test/integration/run-*.test.ts` and `test/fault/run-park.test.ts`: 477 pass, 0 fail
- `npm run typecheck` and `node scripts/check-boundaries.ts` (99 files): clean
- The plan's docs check (labelled and attribution described, no plan, file or function in the prose): pass

## Deviations from Plan

None in the rule or the scope. Small choices inside it (all listed under key-decisions): a criterion contributes its numbered lines only; the unit's own side counts its decisions in any state; an unreadable decision list means no attribution. All three can only add pauses. The integration scenario has B make no edit, as the plan says, and the host parks nothing for it.

**Total deviations:** 0 auto-fixed.

## Known stubs

None. The RED-stage stubs were replaced in the GREEN commits.

## Threat flags

None. No new endpoint, auth path, file access or schema. T-03-87 to T-03-89 are mitigated as planned: an attributed unit still goes through G1 and G2, the classify step records the attribution, and A's prompt is tested to hold none of B's wordings.

## Documentation surfaces (for plans 03-31 to 03-33)

- **Changed sections to review fresh (plan 03-33):** `docs/system/runs.md`, the "Launch." paragraph (the scoped item prompt and what a labelled paragraph is) and the new paragraph "A numbered choice that belongs to another item" in "Classification."; `docs/system/containment.md`, the paragraph after the outcome rule list (the one added sentence on attribution).
- **History entry for plan 03-33:** the item prompt is scoped to its own item and a numbered choice that belongs to another item no longer pauses a verified unit (found by exit run 1, fixed offline, to be repeated live by plans 03-41, 03-42 and 03-30).
- **Findings line added:** yes, one under "From runs", for `docs/containment.md:121`, which says a numbered-choice ending is always a pause; the code now attributes a verified unit's choice to another item. `docs/autonomy-and-decisions.md:46` (an unclassifiable pause stays consequential) still holds and is noted in the line.
- `README.md`, `coverage.md` and `history.md` were not edited here, as the plan says.

## Next

Ready for plans 03-41, 03-42 and 03-30: the three exit runs are repeated after this fix (D-03). Nothing was spent here.

## Self-Check: PASSED

Created files exist (src/domain/item-scope.ts, test/integration/run-pause-attribution.test.ts, the four evidence records). Commits a850b72, e82728c, 5b6d987, 0a47963 and bd02c8b are ancestors of HEAD.
