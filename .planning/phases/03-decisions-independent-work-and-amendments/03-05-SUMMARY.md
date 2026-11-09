---
phase: 03-decisions-independent-work-and-amendments
plan: 05
subsystem: domain
status: complete
tags: [decisions, classifier, state-digest, response-validation, pure-domain]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: detectPause in src/domain/outcome.ts, storedText in src/domain/quick-record.ts, digestOf in src/domain/digest.ts, the blockRun inline digest and RunDecisionClass
provides:
  - src/domain/decision-policy.ts (DecisionOption, DecisionSignal, DecisionClassification, DecisionRecordDraft, AmendConsequence, classifyDecision, parseNumberedOptions, buildDecisionRecord, amendCommandFor, blockScope, optionsOf)
  - src/domain/state-digest.ts (computeStateDigest, the one digest for blockRun, decide and the stale re-open)
  - src/domain/response-validation.ts (ResponseFacts, ResponseVerdict, RESPONSE_CHECKS, validateResponse)
affects: [03-18, 03-20, 03-12, 03-15, 03-25, the documentation plan 03-31]

actuals:
  tokens: 16400
  tasks: 3
  commits: 6
plan_head_before: 50cfd3b688fe1dcc208e7ae0f421e8a58b6fe48d
plan_head_after: 620d722ffbedb22d52a040879b6097e92a017503
commits: 6

tech-stack:
  added: []
  patterns:
    - "A signal union with one structural kind per row of the classifier table; no field carries model confidence or a model-written claim"
    - "Non-pause decisions offer only withdraw; the printed amend command and the request a terminal chain pre-fills come from one value (amendCommandFor)"
    - "The contract is the only source of a default: buildDecisionRecord re-checks a classification's claimed default against contract.decisions.defaults"
    - "validateResponse is one ordered pure function over measured facts with no time input; the first failing check decides"
    - "RED stubs export every planned name so tests fail on assertions, not on load"

key-files:
  created:
    - src/domain/decision-policy.ts
    - src/domain/state-digest.ts
    - src/domain/response-validation.ts
    - test/unit/decision-policy.test.ts
    - test/unit/state-digest.test.ts
    - test/unit/response-validation.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-05-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-05-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-05-red-evidence-task3.json
  modified: []

key-decisions:
  - "A choice is routine only when the contract lists it as delegated (and not also as human) or the plan declared an auto_select; both are assumptions that open no decision row; an empty auto_select is not declared"
  - "A class in contract.decisions.defaults gets authority default and the named default only while the decision offers a real answer; permission, budget, scope_expansion and repeated_failure (withdraw only) are never lifted by a default"
  - "buildDecisionRecord re-checks a claimed default against the contract and downgrades the authority to human when the contract does not name it (AUT-2 prohibition)"
  - "Non-pause decisions: scope_expansion and repeated_failure are authority human, budget and permission (including enforcement) are prohibited; all offer only withdraw; permission and enforcement name no amend command because widening does not answer a refusal"
  - "amendCommandFor flags never go past what the signal measured: the paths it named (10 at most, 200 characters each, shell-quoted), the budget value it spent, or limit+1 invocations; an unmeasured budget prints <value> and stays out of the request"
  - "The decision ID is unknown until the ledger assigns it, so the draft prints the placeholder <decision-id>; the caller may pass decisionId to substitute it"
  - "validateResponse rejects carry a stage (the RESPONSE_CHECKS name) and a code (identity:not-interactive, identity:avarice-run, identity:run-tree, identity:profile-owner, decision-stale, decision-withdrawn, decision-not-open, option-not-listed, answer-missing, answer-ambiguous, free-text-not-allowed, text-invalid, decision-answered)"
  - "An empty state digest on either side is never a match: the verdict is stale. A withdraw is the one answer applied whatever the digest says"
  - "computeStateDigest adds ticketRevisions (sorted kind:id:revision) only for requirement references that are not the manual brief, so a manual brief equals the Phase 2 digest"

requirements-completed: [AUT-1, AUT-2, AUT-4, AUT-5]

coverage:
  - id: D1
    description: "classifyDecision maps structural signals (pause, plan checkpoint, plan scope, owner-choice criterion, permission, budget, repeated failure, enforcement, auto_select, delegated) to a class, an authority and options; model confidence and model-written claims are never inputs; an unclassifiable pause is a human acceptance decision"
    requirement: "AUT-1"
    verification:
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#classifyDecision: a pause"
        status: pass
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#classifyDecision: signals that are not a pause"
        status: pass
    human_judgment: true
    rationale: "Edge probe (plan flagged assumption): AUT-1 is unclassified in the coverage report; the owner reviews the classifier table, its authorities and the structural-signals-only rule"
  - id: D2
    description: "A decision record holds issue, evidence references, options, a recommendation that is data, a consequence for each option, affected items (the item and its transitive dependents) and an authorized default only when the contract names one; a non-pause decision offers withdraw and prints the amend command"
    requirement: "AUT-2"
    verification:
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#buildDecisionRecord"
        status: pass
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#buildDecisionRecord: non-pause decisions"
        status: pass
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#amendCommandFor"
        status: pass
    human_judgment: true
    rationale: "Edge probe (plan flagged assumption): AUT-2 is unclassified in the coverage report; the owner reviews the record fields and the amend command text"
  - id: D3
    description: "computeStateDigest is the one digest function and equals the Phase 2 digest for a manual brief; a ticket reference, a contract version, base revision or policy revision change it"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/state-digest.test.ts#computeStateDigest"
        status: pass
    human_judgment: false
  - id: D4
    description: "validateResponse applies identity, open, option, duplicate then state-digest checks in order; a digest mismatch is stale and never apply; there is no time input"
    requirement: "AUT-4"
    verification:
      - kind: unit
        ref: "test/unit/response-validation.test.ts#validateResponse: identity"
        status: pass
      - kind: unit
        ref: "test/unit/response-validation.test.ts#validateResponse: the state digest"
        status: pass
      - kind: unit
        ref: "test/unit/response-validation.test.ts#validateResponse takes no time: silence cannot approve (AUT-4)"
        status: pass
    human_judgment: false
  - id: D5
    description: "blockScope is item for reason decision and run for every other blocked reason; optionsOf reads a stored option list and gives withdraw for a Phase 2 decision"
    requirement: "AUT-1"
    verification:
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#blockScope"
        status: pass
      - kind: unit
        ref: "test/unit/decision-policy.test.ts#optionsOf"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-09
---

# Phase 3 Plan 05: Decision policy, state digest and response validation Summary

**Pure decision rules: structural signals classified to a class, authority and options, a full AUT-2 record builder with the amend command, one state digest equal to the Phase 2 value for a manual brief, and a five-check response validator in the D-15 order with no time input.**

## Performance

- **Duration:** about 45 min
- **Started:** 2026-11-09T00:25:00Z (approximate; not captured at start)
- **Completed:** 2026-11-09T01:09:00Z
- **Tasks:** 3 (one tracer, two auto, all TDD)
- **Files modified:** 9 created (3 source, 3 test, 3 RED evidence), none modified

## Accomplishments

- A numbered-choice pause on item B becomes a decision record with parsed options, a recommendation stored as data, one consequence per option, and B plus its dependents as affected items (tracer, proven end to end).
- Every signal has one classification: pause, plan checkpoint and owner-choice go to a human; scope and repeated failure are withdraw-only and human; budget, permission and enforcement are withdraw-only and prohibited; `auto_select` and delegated choices are assumptions with no decision row.
- `computeStateDigest` is the single digest for block, decide and the stale re-open; for a manual brief it equals `digestOf({ contractVersion, baseRevision, policyRevision })`.
- `validateResponse` judges a response in the D-15 order and can only return `apply` on a matching digest (or a withdraw); no input carries time.

## Task Commits

1. **Task 1: Tracer, a numbered-choice pause becomes a full decision record** - `b53af8f` (test, RED), `db2bea2` (feat)
2. **Task 2: Non-pause classes, defaults and delegation, legacy options, block scope, state digest** - `86d7027` (test, RED), `6499c64` (feat)
3. **Task 3: validateResponse in the D-15 order** - `a9b7e93` (test, RED), `620d722` (feat)

**Plan metadata:** recorded in the docs commit that follows this summary.

## Files Created/Modified

- `src/domain/decision-policy.ts` - signal union, classifier, numbered-option parser, record builder, amend command, block scope, stored-option reader
- `src/domain/state-digest.ts` - `computeStateDigest`
- `src/domain/response-validation.ts` - `validateResponse`, `RESPONSE_CHECKS`, facts and verdict types
- `test/unit/decision-policy.test.ts`, `test/unit/state-digest.test.ts`, `test/unit/response-validation.test.ts` - 86 tests
- `.planning/phases/03-decisions-independent-work-and-amendments/03-05-red-evidence-task{1,2,3}.json` - RED evidence

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans depend on:

- Plan 03-18 (block) passes `dependents` from `transitiveDependents`, calls `classifyDecision` then `buildDecisionRecord`, and substitutes the real decision ID into the printed command (the builder takes an optional `decisionId`; without it the draft prints `<decision-id>`).
- Plan 03-20 (decide) builds `ResponseFacts` from the terminal, reads `optionsOf(record.options)`, and recomputes the digest with `computeStateDigest`. The `check` code names the reason to show; `stage` names the D-15 check.
- `DecisionRecordDraft.authority` is not a ledger column. The caller keeps it for the assumption log and the notification text.

## Deviations from Plan

### Auto-fixed Issues

None required by the deviation rules. Additions within the plan's discretion, recorded so later plans know the exact surface:

- `DecisionSignal` kinds carry the fields the plan left open: `g1-checkpoint {question?, options[{id,label?}]}`, `auto-select {autoSelect}`, `delegated {choice}`, `g1-scope {paths}`, `g1-owner-choice {acceptanceId, key?}`, `budget {names, values?}`, `repeated-failure {limit}`, `permission`/`enforcement {check?}`.
- `buildDecisionRecord` takes an optional `decisionId`, and returns `class`, `authority`, `evidenceRefs` and `urgency` in addition to the fields the plan listed, so the caller does not recompute them.
- A reject verdict has a `stage` field next to `check` and `detail`, so each RESPONSE_CHECKS name is testable. Free text that is empty or only whitespace is `text-invalid`; an answer with neither or both of key and text is `answer-missing` or `answer-ambiguous`.
- RED evidence for task 2 covers `test/unit/decision-policy.test.ts` alone: the RED checker rejects TAP concatenated from two test files. The `state-digest` RED run (5 of 6 failed on assertions) is stated in the evidence's semantic assessment.

**Total deviations:** 0 auto-fixed. **Impact on plan:** none; the additions are the minimum fields the pure functions need.

## Issues Encountered

None.

## Known Stubs

None. The RED stubs were never committed; the committed tree holds only the implementations.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Documentation surfaces (for plan 03-31)

- **Decision classes written by these rules:** `acceptance`, `scope_expansion`, `permission`, `repeated_failure`, `budget` (the ledger accepts eight; `architecture`, `equivalent_mutant`, `contradiction` are not produced here).
- **Authorities:** `human`, `prohibited`, `default` (only when the contract names one), `delegated`; an assumption record (`auto_select`, delegated) opens no decision.
- **Option kinds:** `choice` (keys `1` to `9` or a plan option id), `text` (key `text`, only when no choices parse), `withdraw` (key `withdraw`, the only option of a non-pause decision and of a Phase 2 decision).
- **Response checks, in order:** `identity`, `open`, `option`, `duplicate`, `state-digest`. Reject codes: `identity:not-interactive`, `identity:avarice-run`, `identity:run-tree`, `identity:profile-owner`, `decision-stale`, `decision-withdrawn`, `decision-not-open`, `option-not-listed`, `answer-missing`, `answer-ambiguous`, `free-text-not-allowed`, `text-invalid`, `decision-answered`. Verdicts: `apply`, `stale`, `duplicate`, `reject`.
- **Limits:** issue 1000 characters, option label 200, at most 9 options, free text 2000 characters with no control characters other than tab and line feed.
- **Amend command shape:** `avarice contract amend <run> --decision <id> --reason "<why>"` followed by `--add-write '<path>'` (at most 10) or `--budget <name>=<value>`; `costUsd` is named `costUsdPerRun`.
- **State digest:** contract version, base revision and policy revision, plus sorted ticket revisions only for non-brief requirement references.
- **Findings to consider:** none new beyond the open entries CONTEXT D-25 lists.

## Next Phase Readiness

Plans 03-18 (block) and 03-20 (decide) can import these three modules directly. No blockers.

## Self-Check: PASSED

- Created files exist: the three `src/domain` modules, three test files and three RED evidence files.
- Commits `b53af8f`, `db2bea2`, `86d7027`, `6499c64`, `a9b7e93`, `620d722` are ancestors of HEAD.
- `node --test "test/unit/**/*.test.ts"`: 1509 pass, 0 fail. `npx tsc -p .` clean. `node scripts/check-boundaries.ts` ok. `grep -n confidence src/domain/decision-policy.ts` prints only the header comment.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09*
