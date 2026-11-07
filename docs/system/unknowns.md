# Unknowns

This document lists what the grounding did not determine, and for each entry what was checked before stopping, so the next attempt starts where this one ended. Nothing in the tree rests on these points.

## From cli-reference

- Whether the stage loop always ends in a stop state for `paused`, `stale`, `validation_failed` and `planning_ready`. Checked: the loop and stage table in the onboarding service; not executed end to end.
- The exact budget names and limits the contract compiler accepts. Checked: that the onboarding contract validates them; not enumerated in the CLI reference.
- Whether `--mode fast` differs in exit codes. Checked: mode is stored and validated; not traced further.
- `context` behavior over real index data. Checked: the context service and source port, and the exit-code assertions in the context integration test.
- No CLI command was executed for this document; behavior comes from code at HEAD and the init, preflight, ledger-status, lease and context integration tests.

## From config-reference

- Whether the hook process reads environment variables implicitly through its imports. Checked: no env reference in the hook entry; imports not read line by line.
- The exact derived invocation and subagent totals were not read for this document (see onboarding.md for the derivation).
- Internal timeouts of the sandboxed executor and staging caps were seen but left out as internals.

## From indexes-and-context

- Whether GSD's `graphify query` and `intel query` apply the described edge-trimming order in the installed GSD version. Checked: the adapter comment and the context integration test against a fake graphify; GSD source not read.
- Whether anything rewrites the record's stored graph freshness after a later commit. Checked: context recomputes freshness itself; no rewriter traced.

## From onboarding

- Whether the never-entered states (`planning`, `stale`, `deactivated`) and the edges out of `blocked` and `incompatible` are planned or leftover. Checked: git grep of each state literal outside the lifecycle and status modules.
- Whether the excludedDirectories contract input is meant to be filled later. Checked: git grep across src and test.
- Host reaping on non-macOS platforms. Checked: reaping uses absolute macOS paths for pgrep and ps; not run elsewhere.

## From data-model

- Whether the six schema-only tables are planned for specific later work. Checked: git grep of each name in src; the spec describes them without a schedule.
- Whether backups, per-invocation directories and staging clones are ever cleaned up by an operator procedure. Checked: git grep for deletions in src; no cleanup command among the six CLI commands; no runbook found.
- Hook and CLI write contention beyond the busy timeout. Not tested.

## From integrations

- Whether a `claude` installed through a launcher that needs `node` on PATH passes the readiness probe. Checked: the fixed probe PATH; no real install run.
- Whether any non-macOS run is supported. Checked: mount parsing has a Linux branch, but sandbox-exec is macOS-only.

## From containment

- Whether the three admitted host versions pass the live containment suite now. Checked: the constant and the recorded run files under test/containment; the live suite was not re-run (it needs AVARICE_LIVE=1 and spend).
- Whether the host honors each generated setting on the admitted versions. Host behavior; not determinable from code.
- Hook latency against its 5 second host timeout. No performance test run.

## From runs

- Whether the states `waiting_external`, `awaiting_review`, `failed`, `cancelled`, `closed` and the four unrecorded blocked reasons are meant to be driven by a later feature or are leftovers. Checked: a search of `src/app` and `src/cli` for a transition into each of those states (no match), a search of `src` for the four reason names (only the lifecycle definition and an unrelated freshness enum), and the command list in `src/cli/main.ts` (no command answers a decision).
- Whether containment.md is complete for the run purpose. Checked: the run-owner rule, the scope inputs, the scratch directory creation, the run skill and agents and the canonical clone working directory were read in `src/domain/invocation-scope.ts`, `src/adapters/host-claude/claude-host.ts` and `src/app/invocation.ts`; the hook rule list and the settings generator were not read for this document.
- What the install, check validation, baseline, evidence and gate rules do in detail. Checked: `src/app/checks.ts` lines 325 to 390 (the install summary and the start of the install) and `src/domain/evidence.ts` (the baseline delta); `src/app/check-validation.ts` was not read for this document.
- Whether the behavior holds on a live host. Checked: code only; no run was executed and no test was run.
- Whether the onboarding document's statement that the worktree adapter is dormant still holds for onboarding. Checked: for runs, the run workspace module is separate from the onboarding staging modules, reuses only the clone helper and has no worktree variant; the onboarding side was not re-checked here.

## Campaign-wide

- No test suite and no live run was executed for this tree; every claim rests on code read at the pinned commit and on test files read, not run.
