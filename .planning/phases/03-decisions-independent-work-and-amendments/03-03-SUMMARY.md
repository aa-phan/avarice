---
phase: 03-decisions-independent-work-and-amendments
plan: 03
subsystem: domain
status: complete
tags: [brief, run-contract, work-items, budgets, spec-derivation]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-02 (schema version 3, per-item attempt key); this plan is pure domain and reads none of it
provides:
  - "Brief.items and BriefItem: the items frontmatter (one JSON array, continuation lines indented by two spaces), validated field by field with the cycle listed"
  - "The decision:<key> acceptance verifiedBy form, which G0 never accepts alone"
  - "compileRunContract emitting N work items, each with acceptance, size, model, modelSource and a spec whose derived fields are named"
  - "scaledBudgetLimits(itemCount), IndexFacts, deriveItemSpec, RunContract.contractVersion as a number"
  - "Routine preset: 10.00 USD per run, 120 minutes, repairAttemptsPerCheck 1"
affects: [03-04, 03-14, 03-17, 03-20, every plan that reads RunWorkItem.acceptance or the routine budgets, the documentation plan 03-31]

requirements-completed: [RC-7, RC-8, AUT-10, CON-15]

actuals:
  tokens: 21000
  tasks: 3
  commits: 7
plan_head_before: a447097c26cd76cffacaaadc0f876461df86d86f
plan_head_after: 7e6d2f4c5c68b59eabd6b6185524a03150c94a57
commits: 7

tech-stack:
  added: []
  patterns:
    - "The brief has no YAML: the one structured frontmatter value is a JSON array that continues on lines indented by two spaces, and only the items key may continue"
    - "A field the brief omits is derived and named in spec.derived (size, files, symbols, configKeys, references); an explicit field is kept as given"
    - "Budget ceilings are a function of the item count (scaledBudgetLimits); an override is checked against the scaled value and can only lower it"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-03-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-03-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-03-red-evidence-task3.json
  modified:
    - src/domain/brief.ts
    - src/domain/run-contract.ts
    - test/unit/brief.test.ts
    - test/unit/run-contract.test.ts
    - test/integration/run-start.test.ts
    - test/integration/run-invocation.test.ts
    - test/integration/run-status.test.ts
    - test/fixtures/json-shapes/status-runs.json

key-decisions:
  - "Only the items key continues across lines; any other indented frontmatter line is still refused with brief.frontmatter, because an existing test pins that a stray indented line after title is an error"
  - "dependsOn is required on every item (an empty array for none), so the item format has one shape and a missing key is a refusal rather than a default"
  - "An unknown spec key is reported as brief.items[n].spec.<key>, and spec.files problems as brief.items[n].spec.files"
  - "A one-item brief without a size now names size in the item's spec.derived, as the plan says a defaulted size is derived; Phase 2 contracts stored before this change keep their own body"
  - "The cycle check reports the item that closes the cycle, and the reason lists it as A -> C -> B -> A"

patterns-established:
  - "scaledBudgetLimits is the single place the routine limits and their derivation strings are computed"

coverage:
  - id: D1
    description: "A brief declares items in its frontmatter (one line or continued lines); each item is validated with a field path, ids are unique, dependsOn is acyclic with the cycle listed, every criterion belongs to one item, at most 20 items"
    requirement: "RC-7"
    verification:
      - kind: unit
        ref: "test/unit/brief.test.ts#parseBrief: items (D-06 tracer), #parseBrief: item validation (D-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A brief without items compiles to the single item A and its parseBrief digest is unchanged (pinned sha256:9ab6ad39)"
    requirement: "RC-7"
    verification:
      - kind: unit
        ref: "test/unit/brief.test.ts#pins the digest of a brief without items"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each work item carries acceptance, size, model and modelSource; a missing size, files, symbols, configKeys or references is derived from the item text and the index facts and named in spec.derived; spec files stay inside the run write set"
    requirement: "RC-7"
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#compileRunContract: a two-item brief compiles to two work items, #spec files stay inside the run write set, #spec derivation from index facts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Model per item: its own model (modelSource brief) else modelBySize[size], with small to haiku, medium to sonnet and large to opus; no fallback to a larger model"
    requirement: "RC-8"
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#RC-8: the model never exceeds the explicit model or the size map entry"
        status: pass
    human_judgment: false
  - id: D5
    description: "Routine budgets scale with the item count (invocations items x 2 + 1, subagents items x 10, tool calls items x 400), cost 10.00 USD per run, 120 minutes, repair limit 1; overrides only lower the scaled limits"
    requirement: "CON-15"
    verification:
      - kind: unit
        ref: "test/unit/run-contract.test.ts#scaledBudgetLimits, #overrides only lower the scaled limits"
        status: pass
      - kind: integration
        ref: "test/integration/run-start.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "The decision:<key> verifiedBy form parses and G0 refuses a criterion whose only references are decision: forms"
    requirement: "AUT-10"
    verification:
      - kind: unit
        ref: "test/unit/brief.test.ts#the decision: verifiedBy form, test/unit/run-contract.test.ts#checkG0Static: a decision: reference never stands alone"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 03: Work items in the brief and the contract Summary

**A brief can declare items with dependencies, and the compiler turns them into work items with their own acceptance, size, model and spec (derived fields named), under routine budgets that scale with the item count and can only be lowered.**

## Performance

- **Duration:** about 31 min (2026-11-09T02:37Z to 03:08Z)
- **Tasks:** 3 of 3 (task 1 is a tracer)
- **Commits:** 7 before this summary (3 RED, 3 GREEN, 1 evidence-format fix)
- **Files:** 3 created, 8 modified (4 source and test files this plan owns, 3 test pins outside its list, 1 snapshot)

## Accomplishments

- `items:` in the brief frontmatter is one JSON array. The first line may end the key (`items: [`) and the following lines, indented by two spaces, continue it. `readItems` refuses with `brief.items[n].<field>`: a non-array or empty array or more than 20 items (`brief.items`), a bad or repeated id, a bad title, a `dependsOn` that is not an array of known, distinct, non-self ids, a dependency cycle (reason `forms a dependency cycle: A -> C -> B -> A`), a size or model outside the enums, empty or unknown or repeated acceptance, an unknown item or spec key, and an empty, non-array or unsafe `spec.files`. A criterion owned by two items, or by none, is `brief.items`. A top-level `size` or `model` beside `items` is `brief.size` or `brief.model` ("put size and model on each item").
- `decision:<key>` (key `^[a-z][a-z0-9-]{0,39}$`) is a fourth `verifiedBy` form. G0 reports `acceptance-verified-by` with `<id> needs a check, test or diff reference beside decision:` when a criterion has no check, test or diff reference.
- `compileRunContract` builds one work item per brief item in declaration order, or the single item A that owns every criterion. Size is the item's, else the brief's when there are no items, else `medium` named in `spec.derived`. Model is the item's (`modelSource: 'brief'`, even when it equals the size map value), else `modelBySize[size]`. An explicit `spec.files` must sit inside the run write set (`globWithin`) and off protected globs, else `brief.items[n].spec.files`; `src-evil/**` under `src/**` is refused and overlapping spec files on two items are accepted.
- `deriveItemSpec` fills the spec fields an item omitted from the item title and acceptance text and the index facts (`RunCompileInput.indexFacts`): files are named paths the index knows and the write set allows (else the whole write set), symbols are backtick identifiers the index lists for those files, references are `.md` paths in the write set or under `docs/`, config keys are dotted lower-case backtick spans that are not file names. Lists are sorted and de-duplicated, so the same brief and facts give the same digest. Without facts the files are the write set and the symbols stay empty, both derived.
- `scaledBudgetLimits(n)` returns the limits and derivations: invocations `n x 2 + 1`, subagents `n x 10`, tool calls `n x 400`, wall clock 120 minutes, 10.00 USD per run and 2.00 per invocation. `applyBudgetOverrides` takes them as the ceiling and names the scaled limit in the refusal. `repairAttemptsPerCheck` is 1. `RunContract.contractVersion` is a `number`.

## TDD gate

Three RED records pass `gsd-tools check tdd-red-evidence` with `RED_EVIDENCE_OK`. Task 1: 5 of 100 failed (items key unknown; no `acceptance` on the work item) and the pinned no-items digest test passed before and after. Task 2: 23 of 150 failed on assertions over missing validation. Task 3: 15 of 99 failed with `scaledBudgetLimits` exported as a stub returning the old limits (the stub makes the test file load; it is replaced in the GREEN commit). GREEN commits `a93c8eb`, `ade307f`, `7e6d2f4`. The tracer gate (task 1 `<verify>` re-run end to end) passed before task 2 started.

## Task Commits

1. **Task 1 (tracer): a two-item brief compiles to two work items** - `e7b3fc1` (test, RED), `a93c8eb` (feat, GREEN)
2. **Task 2: item validation, the decision: form, G0 for items** - `fd410ff` (test, RED), `ade307f` (feat, GREEN)
3. **Task 3: scaled budgets, repair limit, spec derivation** - `2a44d0c` (test, RED), `7e6d2f4` (feat, GREEN)
4. **RED evidence format** - `d799719` (the first records held a summary instead of the TAP output the checker reads)

## status-runs.json diff

Regenerated with `AVARICE_SNAPSHOT_WRITE=1`. The diff is budget limit values only: `costUsd` limit 5 to 10 and `wallClockMs` limit 3600000 to 7200000. No key changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pins in tests outside the plan's file list**
- **Found during:** Task 3 (the integration and fault suites)
- **Issue:** `test/integration/run-invocation.test.ts` (reservation grants 60 minutes and 5 USD; 3 tests) and `test/integration/run-status.test.ts` (prints `of 5.00 USD`, limit 5; 2 tests) pinned the Phase 2 preset.
- **Fix:** expectations moved to 120 minutes and 10 USD (the partial-spend cases charge 110 minutes and 9.5 USD to leave the same remainders).
- **Files modified:** test/integration/run-invocation.test.ts, test/integration/run-status.test.ts
- **Commit:** 7e6d2f4

**2. [Plan wording] Continuation lines are allowed for the `items` key only**
- The plan says an indented line continues the previous key. An existing test requires `title: x` followed by `  - a` to be refused with `brief.frontmatter`, so the continuation applies only after `items`; any other key keeps one value per line.

**3. [Plan wording] Stub for `scaledBudgetLimits` in the RED commit**
- The Task 3 test file imports `scaledBudgetLimits`, so the RED commit exports a stub (returning the Phase 2 limits) and the `IndexFacts` type so the file loads; the GREEN commit replaces the stub. The RED commit does not typecheck (`SubagentDerivation.units` is used by a test before it exists).

**4. [Plan wording] Task 1 left the validation to Task 2**
- Task 1's parser accepted any array of objects; Task 2's `readItems` replaced it. Task 2's GREEN also made `compileWorkItems` honour an explicit `spec`, so Task 3 only swapped the derivation in.

**5. [Plan wording] RED evidence records**
- The first three records held a hand-written summary in `output` and the checker returned `INVALID_RED`. `d799719` replaced `output` with the real TAP output of each RED run; all three return `RED_EVIDENCE_OK`.

**Total deviations:** 5 (1 Rule 3, 4 plan-wording). **Impact:** none on scope.

## Issues Encountered

- The first integration and fault run (1072 tests) failed 5 on the Phase 2 pins above; after the fix those two files pass (30 of 30). The full group was not re-run end to end after the fix. Unit suite: 1703 of 1703. `tsc -p .` and `check-boundaries` clean.
- `test/mutation/` and the live containment suites were not run (the live suites need the real host).
- A contract stored by Phase 2 has work items without `acceptance`, and a `subagentsDerivation` without `units`. Later readers of a stored contract's work items (plans 03-14 and after) must treat a missing `acceptance` as "all criteria belong to item A".

## Documentation surfaces (for plan 03-31)

`docs/system/` was not edited in this plan; the documentation plan writes these from the code:

- **Brief format:** frontmatter key `items` (JSON array, continuation lines indented by two spaces, only for `items`); item keys `id` (`^[A-Z][A-Za-z0-9_-]{0,31}$`), `title` (1 to 200 characters), `dependsOn` (required), `size`, `model`, `acceptance` (criterion IDs, each criterion in exactly one item), `spec` with `files`, `symbols`, `configKeys`, `references`; at most 20 items; top-level `size` and `model` refused beside `items`. The refusal field paths are `brief.items`, `brief.items[n].<field>` and `brief.items[n].spec.<key>`.
- **verifiedBy forms:** `check:`, `test:`, `diff:` and `decision:<key>`; G0 rule `acceptance-verified-by` also fires for a criterion with only `decision:` references.
- **Run contract:** `intent.workItems[]` gains `acceptance`; `spec.derived` may name `size`, `files`, `symbols`, `configKeys`, `references`; `contractVersion` is a number; `budgets.subagentsDerivation.units`; `RunCompileInput.indexFacts` (`files`, `symbolsByFile`).
- **Routine preset values:** wall clock 120 minutes; cost 10.00 USD per run, 2.00 per invocation; invocations `items x 2 + 1` (formula `<n> item units + <n> retries or repairs + 1 resume = <2n+1>`); subagents `items x 10` (formula `(1 planner + 2 plan-checker + 1 executor + 1 verifier = 5 per unit) x 2 rounds ... x <n> items = <total>`); tool calls `items x 400`; concurrent subagents 2; `repairAttemptsPerCheck` 1 with reason "one repair invocation per newly failing required check, then a repeated_failure decision with the smallest reproducer (D-11)". The refusal reads `budgets can only be lowered: <value> is above the <limit> the preset allows for <n> work item(s)`. The preset change changes `policyRevision` for new runs; stored contracts keep theirs.
- **Spec derivation rules (D-07 stage 1):** candidate tokens, the files rule, the symbol rule, references, config keys, sorting.
- **Findings to revisit:** `docs/system/findings.md` and the budgets section of the system docs state 60 minutes, 5 USD and `repairAttemptsPerCheck` 0; those move to the values above. Records of the one-item-only contract (`workItems` always `A`) no longer hold.

## Known Stubs

None. The RED stub for `scaledBudgetLimits` was replaced in `7e6d2f4`. Index facts are an input to the compiler only; no caller supplies them until plan 03-17, so a started run today derives files from the write set (marked derived).

## Threat Flags

None. T-03-05 (an item spec widening the write scope) is mitigated: an explicit `spec.files` must be inside the run write set by `globWithin` and off protected globs (tests: `src-evil/**`, a protected path). T-03-06 (cycle or thousands of items) is mitigated: at most 20 items and a depth-first cycle check that names the cycle (the 64 KiB brief cap is unchanged). T-03-SC: no package installs.

## Next Phase Readiness

Plan 03-17 can collect index facts and pass them in; later stages can read `workItems[].acceptance`, `dependsOn` and `spec`; plan 03-04 and the amendment plans can write contract version n+1. Owner checks recorded in the plan (the items syntax, the `decision:` form, the per-item allowance values) are implemented as written.

## Self-Check: PASSED

Created files exist (three RED evidence records, this summary); commits e7b3fc1, a93c8eb, fd410ff, ade307f, 2a44d0c, d799719 and 7e6d2f4 are on the branch; `grep -n "contractVersion: 1;" src/domain/run-contract.ts` prints nothing, `repairAttemptsPerCheck: 1` and `perRun: 10` each print one line; the status-runs.json diff holds only `"limit"` lines; verify files 219 of 219 and run-start, json-shapes and exit-drafts 53 of 53; `tsc -p .` and `check-boundaries` clean.
