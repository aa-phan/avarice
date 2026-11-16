---
phase: 03-decisions-independent-work-and-amendments
plan: 31
subsystem: documentation
tags: [docs-system, decisions, autonomy, runs, data-model, processes, diagrams]
requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: the built decision, scheduling, resume, amendment, cancel and notification code of plans 03-01 to 03-74
provides:
  - 03-31-doc-worklist.md, the map of every changed surface to its docs/system section and drafting plan
  - docs/system/autonomy-and-decisions.md, the decision subsystem document (drafted, not yet reviewed)
  - runs.md, data-model.md and processes.md regrounded in the code, and three new flow diagrams
affects: [03-32, 03-33]
tech-stack:
  added: []
  patterns: [documentation grounded in the code at HEAD, diagrams as PlantUML source]
key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-31-doc-worklist.md
    - docs/system/autonomy-and-decisions.md
    - docs/system/diagrams/run-decide-resume.puml
    - docs/system/diagrams/run-decision-independent-work.puml
    - docs/system/diagrams/run-amend-stale.puml
  modified:
    - docs/system/runs.md
    - docs/system/data-model.md
    - docs/system/processes.md
key-decisions:
  - "The new subsystem document is named autonomy-and-decisions.md, after the proposal it implements, as the plan's flagged assumption says; amendments and the cancel are documented in runs.md and data-model.md."
  - "The whole subsystem document was written in the tracer task, so its Task 2 sections were not left as placeholders; Task 2 only re-checked and trimmed claims it could not ground."
status: complete
duration: about 2 hours
completed: 2026-11-14
actuals:
  tokens: 34000
  tasks: 3
  commits: 3
plan_head_before: d6c28ae024ee55aacb3592a56e4f2ac59d1a2600
plan_head_after: 25eebab5df86b9e034aa067969c8d382f8332ba9
---

# Phase 3 Plan 31: Documentation pass 1 of 3 Summary

The decision subsystem, the run with several items, the schema at version 3 and three new process flows are drafted in docs/system from the code at d6c28ae, with a worklist that assigns every remaining surface to plan 03-32 or 03-33.

## Documents drafted

- **docs/system/autonomy-and-decisions.md (new).** Decision records and their fields, the five classes written and the authority as built, the response checks in the order the code applies them, the stale re-open, withdraw, the amendment request, pickup without polling, notification and check-ins, and quirks. It carries the `drafted, not yet reviewed` mark, names its modules once in the opening, and has no path, function name, phase number, plan ID or threat ID after the opening (checked with the plan's grep).
- **docs/system/runs.md.** The brief's `items` key and the `decision:` reference form; spec derivation; the budgets that scale with the item count and the rule that only an amendment raises a limit; the lifecycle (work item edges, `failed` and `cancelled` now entered, the new checkpoints and events); a new "Several items" section (scheduler and its five dispositions, item-local versus run-wide blocks, park and unpark, release and re-check); the unit section (the commands with their environment, the pre-existing failing checks list, the verifier's closing note, the question capture); gate G1 and the reworked routing and G2 tables; repair and gate G3; answer and resume with the five fallbacks; cancel; amendments with contract versions and what each field invalidates; the reconcile of resumed and implemented items; status and inbox; quirks. Edits by plans 03-34, 03-40, 03-43, 03-46, 03-69 and 03-71 were kept.
- **docs/system/data-model.md.** Schema version 3 and its columns, table and indexes, the `ntf_` prefix, the three decision moves, notifications and their states, the cancel request, contracts and amendments with stale rows appended, the changed budget invariant, 39 event kinds (11 new), 24 step names, five gates, the profile's `notify` section now being read, and the park ref.
- **docs/system/processes.md.** Three new flows (independent work around an open decision, answering a decision and resuming the item, amending the contract and answering on a moved state), each linked to its diagram and listed in the diagram index; the opening, the hand-off bullets and the fault-point count were brought up to date.
- **Diagrams.** run-decision-independent-work.puml, run-decide-resume.puml and run-amend-stale.puml. None has been rendered or syntax-checked: the repository has no render step and PlantUML is not installed here, as the diagram index already says for the other five.

## Worklist

03-31-doc-worklist.md has 70 rows: 48 assigned to plan 03-31, all drafted, and 22 assigned to plan 03-32 (cli-reference, interactive-shell, config-reference, checks-and-evidence, integrations, containment, overview), all pending. It includes the D-35 surfaces, plan 03-61's four surfaces, plan 03-64's six, the surfaces of plans 03-69 and 03-71, and the plans with no row because they changed no built behaviour (03-59, 03-60, 03-72 to 03-74 among them). Its `Findings for plan 03-33` section holds 21 entries.

## Findings recorded for plan 03-33

Five are lines of findings.md, unknowns.md and config-reference.md that the code made false (the unreachable decision states, "no command answers a decision", the version-1-only contract, the states nothing enters, the 60-minute wall clock). The others are code-versus-proposal differences and suspected defects with file:line first. The ones the owner is most likely to want to rule on: a run blocked for `budget_exhausted` or `enforcement_failure` stays blocked after an amendment answers its decision (the pickup rule reads only reason `decision`); the contract's `notify.digest` list is empty and read by nothing; gate G3 is always given no authorized test paths; and `decide --wait` does not wait when a supervisor already holds the lease.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The tracer task wrote the whole subsystem document.**
- **Found during:** Task 1
- **Issue:** The plan has Task 1 fill only the decide sections and leave the rest as notes for Task 2. With the code read, writing the other sections in the same pass was cheaper than rereading it, and a document with placeholders would have carried unverified text between commits.
- **Fix:** Task 1 wrote every section; Task 2 re-checked the claims against the code (the enforcement block, `decide --wait`), removed two it could not ground and added the enforcement-check quirk.
- **Files modified:** docs/system/autonomy-and-decisions.md
- **Commit:** cf4c566 (written), 4cbf674 (trimmed)

**2. [Rule 1 - Bug in the plan's check] The proposals-untouched check compares with `main`, which earlier plans of the phase already changed.**
- **Found during:** Task 3
- **Issue:** README.md, coverage.md and findings.md differ from `main` because plans 03-69 and 03-71 edited them. The plan's `git diff --quiet main` can never pass.
- **Fix:** The check was run against the plan base (d6c28ae) instead and passed: none of the proposals, README.md, coverage.md or findings.md changed in this plan.

## Known Stubs

None. No code was changed.

## Threat Flags

None. This plan changed no code and no trust boundary.

## Authentication gates

None.

## Self-Check: PASSED

All five created files exist and the three commits (cf4c566, 4cbf674, 25eebab) are ancestors of HEAD.
