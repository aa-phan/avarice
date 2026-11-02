# ADR-002: AVARICE supplies services to GSD and never orchestrates the loop

| | |
|---|---|
| **Status** | Proposed; superseded in part by [ADR-006](ADR-006-unattended-delegation.md) for unattended runs |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

This decision concerns how AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) relates to GSD. GSD 1.17.0 owns discussion, planning, decomposition, execution, in-plan checkpoints, goal verification and PR creation, with its own state in `.planning/` ([existing-tooling-assessment.md](../existing-tooling-assessment.md#gsd-lifecycle-ownership)). Requirement FR-4 forbids a competing task state or retry loop. GSD exposes three kinds of supported integration surface. The first is the read-only `state.json` contract and `planning inspect` schema. The second is the `gsd_run` CLI with a defined exit-code registry, and the third is consent-gated capabilities that attach steps and gates at 12 loop points. Capability reference docs are cited by the code but not shipped, so the manifest format is known only from the validator source.

AVARICE can integrate with GSD in three modes. It extends GSD (a capability inside the loop), supplies services that GSD calls, or delegates a bounded workflow to GSD and observes it.

## Decision

AVARICE owns the **run envelope**: intake, context assembly, the run ledger, deterministic verification evidence, authorization records, profile isolation and diagnostics. GSD owns **everything between plan and ship**. Each lifecycle transition has one owner:

| Transition | Owner | AVARICE's role |
|---|---|---|
| intake → context ready | AVARICE | owns |
| context ready → planned | GSD (`/gsd-quick` or `plan-phase`) | supplies the context pack as input |
| planned → implemented | GSD executor | observes `state.json` and git |
| implemented → verified (goal) | GSD verifier | none |
| implemented → evidence recorded | AVARICE | runs repo checks, binds evidence to a revision |
| verified → PR open | GSD `ship` | gate at `ship:pre`, reconcile at `ship:post` |
| PR open → feedback attempt | AVARICE opens a new attempt; GSD plans and executes it | owns the attempt record only |
| any → paused | GSD `pause-work` for its session; AVARICE checkpoint for the run | references GSD's `HANDOFF.json` |

Integration ships in two stages, defined in [architecture.md](../architecture.md#integration-stages). In **Stage 1** AVARICE writes the context pack and a brief to files, prints the exact GSD command to run for attended work, and observes results through `state.json`, `planning inspect` and git. Stage 1 needs no GSD extension at all. **Stage 2** adds a project-scoped capability whose loop points and gates are listed in [extensions.md](../extensions.md#5-gsd-capability-avarice-bridge-stage-2). Stage 2 pins `engines.gsd` to the tested minor version.

AVARICE never retries a step inside a GSD unit, never edits `.planning/` files directly, and never decides that a GSD phase is complete.

## Consequences

**Positive:** There is one plan, one task list and one retry policy. Stage 1 survives any GSD upgrade that keeps `state.json` 1.0.0. Removing AVARICE leaves GSD fully working.

**Negative:** In Stage 1 the user runs the GSD command by hand, which is one extra step per run. Stage 2 depends on a manifest format whose reference documentation is not shipped; a GSD minor release can break it, and the capability then fails closed until re-tested. AVARICE's evidence and GSD's verifier can disagree (tests pass, verifier says `gaps_found`); AVARICE reports both and resolves neither.

**Neutral:** GSD's global hooks (commit validation, secret-read guard, worktree guard) also apply to AVARICE-initiated tool calls inside Claude Code.

## Alternatives considered

**AVARICE as outer orchestrator that drives GSD step by step** - For: fully automated runs, one command. Against: two state machines over the same work, with competing retry and approval logic; GSD workflows are prompt-driven and run inside the agent host, so driving them from outside needs private formats. Why not chosen: violates FR-4 and depends on internals.

**Replace GSD planning with AVARICE's own planner** - For: full control of formats. Against: rebuilds 35 agent definitions and the gate system; loses GSD upgrades. Why not chosen: no requirement justifies the cost.

**GSD MCP server as the bridge** - For: typed tools. Against: marked experimental, packaged only for OpenCode, and exposes raw state writes. Why not chosen: not a supported surface for Claude Code in 1.17.0.

## Revisit when

- GSD ships capability reference docs or a stable MCP server for Claude Code.
- GSD changes `state.json` beyond contract 1.x.
- The manual step in Stage 1 is measured as the main source of friction across 20 or more runs.

## References

- `~/.claude/gsd-core/bin/lib/state-contract.cjs:3-8, 83`
- `~/.claude/gsd-core/bin/lib/loop-host-contract.cjs:7`
- `~/.claude/gsd-core/bin/lib/capability-validator.cjs:22`
- `~/.claude/gsd-core/references/loop-hook-dispatch.md`
