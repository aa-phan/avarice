---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 02
subsystem: testing
tags: [graphify, spikes, edge-relations, node-ids, claude-host, restricted-mode]

requires:
  - phase: 03
    provides: "Spike record format (S3-A) and the live T3 containment suite the host probes refer to"
provides:
  - "Relation census script and a 16-relation read-rule table for EDGE_READ_RULES (S4-A)"
  - "A1 verdict on node-ID stability of path-subset extraction, with the fallback for incremental refresh (S4-B)"
  - "Installed host flag set (Claude Code 2.1.325) and the limits of the offline D-20 probes (S4-C)"
affects: [04-09, 04-11, 04-17, 04-23]

actuals:
  tokens: 8600
  tasks: 3
  commits: 3
plan_head_before: 7de5efc504472cd759fea1ad877ff45061f94fd5
plan_head_after: 7b9541276866461db5d08ea0cb92e1a34e4f8d31
commits: 3

tech-stack:
  added: []
  patterns:
    - "Wave 0 spike record: question, commands, measured counts, verdict, what the later plans take from it"

key-files:
  created:
    - spikes/phase-4-wave-0/README.md
    - spikes/phase-4-wave-0/relation-census.mjs
    - spikes/phase-4-wave-0/S4-A-edge-relations.md
    - spikes/phase-4-wave-0/S4-B-node-id-stability.md
    - spikes/phase-4-wave-0/S4-C-host-probes.md
  modified: []

key-decisions:
  - "uses (116 edges, all INFERRED, Python type usage) is mapped id-only like references; a one-row change if plan 04-09 wants one-hop"
  - "Plan 04-17 takes the fallback: full code-only extraction plus a node-level diff, because a path-subset merge by node ID loses edges that leave the extracted set"
  - "Claude Code 2.1.325 is not in ADMITTED_CLAUDE_VERSIONS; plan 04-11 needs a live T3 run before any launch"

requirements-completed: [FR-22, ONB-11, CON-4, OPS-6]

coverage:
  - id: D1
    description: "Relation census over three real graphs (TypeScript with knowledge pass, Python, Go) and the proposed relation-to-read-rule table with an id-only default"
    requirement: FR-22
    verification:
      - kind: other
        ref: "node spikes/phase-4-wave-0/relation-census.mjs <portfolio graph.json> (prints JSON with a contains key)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Node-ID stability verdict for path-subset extraction with measured counts and a named fallback"
    requirement: ONB-11
    verification: []
    human_judgment: true
    rationale: "The verdict is a measurement record whose use (the 04-17 fallback choice) is a design judgment; no test asserts it"
  - id: D3
    description: "Installed host flag set and offline-probe coverage for restricted mode and the launch self-check"
    requirement: CON-4
    verification: []
    human_judgment: true
    rationale: "Read from claude --help and the preflight source; host behaviour is only provable by a live T3 run, which this plan does not take"

duration: 25min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 02: Wave 0 spikes Summary

**Three measured spike records for Phase 4: a 16-relation graphify read-rule table from three real graphs, a node-ID stability verdict that sends incremental refresh to a full extraction plus node diff, and the Claude Code 2.1.325 flag set with the limits of the offline launch probes**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-16
- **Tasks:** 3
- **Files modified:** 5 created, 0 modified
- **Spend:** none (every extraction is `--code-only`; `claude` was only asked for `--version` and `--help`)

## Accomplishments

- S4-A: census of 2981 nodes and 5797 edges over the portfolio (with knowledge pass), psf/requests at `3c7baaa` and spf13/cobra at `adbc881`; 16 relations mapped to descendants, one-hop or id-only; unmapped relations default to id-only. Two relations the portfolio graph alone would have missed (`inherits`, `uses`) are placed by a stated classification rule.
- S4-B: a scoped-root extraction gives 0 of 25 equal IDs against the whole tree; a mirrored subset root gives 25 of 25. One changed file merged by node ID reproduces the nodes exactly but misses 4 of 1261 edges (those leaving the extracted set). Whole-tree extraction is deterministic and takes 1.5 s on 157 files.
- S4-C: all eleven flags checked are present in 2.1.325, including `--restricted` (quoted verbatim). 2.1.325 is not admitted. Every offline probe proves "written" or "AVARICE's own script denies", never host behaviour; five behaviours only a live T3 run proves are listed.

## Verdicts for the later plans

- **04-09 (edge rules):** copy the S4-A section 4 table as `EDGE_READ_RULES`; unmapped relation means id-only.
- **04-17 (incremental refresh):** A1 holds with normalization for IDs only; use a full code-only extraction and a node-level diff, never a subset merge, never `graphify update`.
- **04-11 (host admission):** 2.1.325 needs a live T3 admission run; consider refusing `--safe-mode` by name; add a `--help` flag-presence probe that reports presence, not behaviour.
- **04-23 (restricted mode):** build the line from the installed `--restricted` text, keep `--tools` off Bash, PowerShell and WebFetch, and settle in a live run whether `--setting-sources ""` and hooks work with `--restricted`.

## Task Commits

1. **Task 1: census script, S4-A and README** - `f716c67` (docs)
2. **Task 2: node-ID stability (A1)** - `9ced8b1` (docs)
3. **Task 3: installed host flags and probe limits** - `7b95412` (docs)

## Files Created/Modified

- `spikes/phase-4-wave-0/relation-census.mjs` - per-graph and total edge relation counts by confidence tier
- `spikes/phase-4-wave-0/S4-A-edge-relations.md` - census table and proposed read-rule table
- `spikes/phase-4-wave-0/S4-B-node-id-stability.md` - A1 verdict, counts, fallback
- `spikes/phase-4-wave-0/S4-C-host-probes.md` - flag set, `--restricted` text, probe coverage table
- `spikes/phase-4-wave-0/README.md` - index of the three verdicts

## Decisions Made

See key-decisions. All three follow from measurements recorded in the spike files.

## Deviations from Plan

None - plan executed exactly as written. The task 2 spike could not use "a path list" because graphify 0.9.53 `extract` takes one directory root only; the plan allowed "whichever 0.9.53 supports", and the record states which forms exist.

## Issues Encountered

None blocking. The scratch clones (public repositories, portfolio at its pin) were cloned only, nothing installed or run, and `/tmp/avarice-s4-spike` was deleted afterwards (T-04-03). The system-level docs rule needs no update: no built behaviour changed.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 04-09, 04-11, 04-17 and 04-23 can copy their verdicts. No blockers; the 2.1.325 admission is planned work in 04-11.

## Self-Check: PASSED

All five files exist under `spikes/phase-4-wave-0/`; commits `f716c67`, `9ced8b1` and `7b95412` are on the branch.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
