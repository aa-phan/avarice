---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 09
subsystem: retrieval
tags: [context, graphify, read-rules, token-budget, first-fit]

requires:
  - phase: 04-02
    provides: "S4-A relation census and the 16-row relation-to-read-rule table"
provides:
  - "EDGE_READ_RULES, ruleFor and widestRule in the domain, copied row for row from the spike"
  - "gsd-graph adapter reads each edge by the rule of its relation; the handle carries the widest rule"
  - "queryContext finds from every source, deduplicates, ranks, picks first-fit and only then reads the picked handles"
affects: [04-38]

actuals:
  tokens: 6500
  tasks: 2
  commits: 3
plan_head_before: 46b9cb95d968f1258b049ee86d589fbe39062fa9
plan_head_after: 3f38edd7c3700d7eef2dc2f090d28eb93a30b7bb
commits: 3

tech-stack:
  added: []
  patterns:
    - "Find everywhere, rank, pick first-fit within budget, then read: a read never happens for a handle the budget left out"
    - "Unmapped relation means id-only: an untrusted or newer graph can never widen what a pack reads"

key-files:
  created:
    - src/domain/retrieval-rules.ts
    - test/integration/context-handle-first.test.ts
    - test/unit/edge-rules.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-09-red-task1.json
  modified:
    - src/app/context.ts
    - src/adapters/context/gsd-graph.ts
    - src/ports/context-source.ts

key-decisions:
  - "Intel keeps its half-budget cap inside the first-fit pick, so a 3,000-token intel handle at budget 4,000 is left out; the plan's S-54 example is exercised with the 3,000 handle in the graph"
  - "A containment edge seen from the child counts as one-hop (it names the parent and follows nothing); descendants are followed only downward"
  - "The port's ReadRule type now lives in the domain (ports may import the domain; the domain may not import ports)"

requirements-completed: [FR-22, FR-3]

coverage:
  - id: D1
    description: "S-54 through the real queryContext: 4,000 budget, handles 3,000, 2,500 and 800 in rank order; the 3,000 and 800 are read, the 2,500 is omitted with its estimate, usedTokens 3,800"
    requirement: FR-3
    verification:
      - kind: integration
        ref: "test/integration/context-handle-first.test.ts#reads the 3000 and 800 handles, not the 2500 one, and lists the 2500 one as omitted with its estimate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every find precedes any read; read is called once per source with exactly its picked handles and not at all for a source or pack with none"
    requirement: FR-22
    verification:
      - kind: integration
        ref: "test/integration/context-handle-first.test.ts#does the same across two sources, with every find before any read"
        status: pass
      - kind: integration
        ref: "test/integration/context-handle-first.test.ts#with no handle from any source makes no read call and returns an empty pack"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dedupe by provider, kind and id keeping the first-ranked copy; stable order by source, then edge tier, then return order; pack items keep their ref"
    requirement: FR-3
    verification:
      - kind: integration
        ref: "test/integration/context-handle-first.test.ts#merging, emptiness and order"
        status: pass
    human_judgment: false
  - id: D4
    description: "EDGE_READ_RULES equals the 16 rows parsed from the spike record; unmapped, null and prototype-named relations are id-only"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/edge-rules.test.ts#carries every row of the spike table, and nothing the spike did not measure"
        status: pass
    human_judgment: false
  - id: D5
    description: "The graph adapter expands containment to depth 3 within the excerpt cap, adds label and source file for a dependency, and only the ID for a reference or unmapped relation"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/edge-rules.test.ts#the graph adapter reads each edge by the rule of its relation (FR-22)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 09: Per-edge read rules and handle-first assembly Summary

**`queryContext` now finds from intel and the graph before reading anything, deduplicates and ranks the handles, picks first-fit within the budget and reads only what it picked; the graph adapter expands each edge by the relation table the S4-A spike measured, with id-only as the default**

## Performance

- **Duration:** about 30 min
- **Tasks:** 2 (a tracer and an auto task, both TDD)
- **Files:** 4 created, 3 modified

## Accomplishments

- Assembler restructured into find, rank-and-pick, read. A source that picked nothing is not read; a pack with no handles makes no read call. The report shape, the untrusted fencing and the "not asked, budget spent" removal are the only visible differences: both sources are always asked now, so that note no longer exists.
- `src/domain/retrieval-rules.ts`: the frozen 16-row table, `ruleFor` (own properties only, so a relation named `constructor` or `__proto__` is id-only), `widestRule`.
- gsd-graph excerpt: descendants (containment, depth 3, shared five-line excerpt cap, cycle-safe), one-hop (label and source file for a code node, kind only for a document node, as before), id-only (the node ID). The hard-coded `readRule: 'one-hop'` is gone.

## Task Commits

1. **Task 1 RED: handle-first assembly tests** - `7132216` (test)
2. **Task 1 GREEN: find, pick first-fit, then read** - `3a7f72d` (feat)
3. **Task 2: relation table and per-edge expansion** - `3f38edd` (feat)

## Deviations from Plan

### Auto-fixed / interpretive

**1. [Interpretation] S-54 with the 3,000-token handle in the graph, not in intel**
- **Found during:** Task 1
- **Issue:** the behavior text puts the 3,000 handle in intel, but the same action keeps intel's half-budget cap (2,000 at budget 4,000) and the existing "intel stays within half" test requires it. Both cannot hold.
- **Fix:** the cap stays; the S-54 numbers are tested with graph handles 3,000, 2,500, 800 (used 3,800, omitted the 2,500), a two-source case with a 150-token intel handle (used 3,950), and a test that pins the cap (a 3,000 intel handle is left out).
- **Commit:** 7132216, 3a7f72d

**Total deviations:** 1 interpretive, 0 auto-fixed bugs. **Impact:** none on the criteria; see the owner review item.

## Decisions needing owner review

1. **Intel half-budget cap versus S-54.** Kept: intel may use at most half the budget inside the first-fit pick (existing FR-20 behaviour and test). The consequence is that an intel handle larger than half the budget is never read, even when nothing else competes for the space. If the owner wants the cap to bind only when the graph has handles to use the other half, say so; it is a change in `pick` only.
2. **Incoming containment edges are one-hop.** A child names its parent (label and source file) and a handle's `readRule` is computed from that effective rule, so a leaf contained by a file reads `one-hop`, not `descendants`. The plan did not say how to read an edge from its target's side.
3. **Graph find allowance is the whole budget.** The graph is now asked with the full budget (it used to get what intel left), because every source is found before any is picked. GSD's reader may therefore return more or lower-tier edges than before; the pick still bounds the pack.

## Documentation surfaces (for plan 04-38)

- Relation table: the 16 relations and their rules, the id-only default, and the classification rule (parent-child, dependency, everything else) belong in the `docs/system/indexes-and-context.md` retrieval section.
- Assembly order: find from every source (intel with half the budget as its allowance, graph with the whole budget), deduplicate by provider, kind and id, rank by source order then edge tier then return order, first-fit pick with intel capped at half, read only picked handles, list the rest as omitted with their estimates. The "token budget is spent" note is gone.
- Excerpt shape per rule: descendants indented to depth 3, the five-line cap, one-hop and id-only line forms.
- `docs/system/findings.md`: proposal text says reads follow "one-hop" for every node; the code now follows the relation table.

## Known Stubs

None.

## Threat Flags

None. T-04-23 (depth bound 3 and the excerpt cap, first-fit pick) and T-04-24 (reference and unmapped relations id-only, untrusted marking unchanged) are implemented and tested.

## Verification

- `node --test test/unit/edge-rules.test.ts test/integration/context-handle-first.test.ts test/integration/context.test.ts`: 30 pass, 0 fail
- `npm run typecheck`: clean; `npm run check:boundaries`: ok (107 files)
- `node --test "test/unit/**/*.test.ts"`: 2520 pass; `ledger-status` and `run-baseline-workflow` integration: 62 pass
- Acceptance: `grep -n "readRule: 'one-hop'" src/adapters/context/gsd-graph.ts` prints nothing; `04-09-red-task1.json` has exitCode 1; the S-54 test asserts the exact read-call arguments.

## Self-Check: PASSED

Created files exist; commits `7132216`, `3a7f72d` and `3f38edd` are on the branch.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
