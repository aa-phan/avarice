# Overview

> Status: drafted, not yet reviewed.

This document describes the boundary and the internal dependency map of the built system in `src/` and `bin/`, derived from the code's imports and wiring rather than from the proposal-era architecture document.

AVARICE as built is a local Node CLI that onboards one existing git repository to an active project record. It drives GSD and Claude Code as child processes, keeps its state in one SQLite file per profile, and never contacts a network service itself. Everything a contained model does happens inside a staging clone, under a generated permission set, an OS sandbox and a fail-closed hook, and the user's own repository is not written.

## System boundary

| Inside AVARICE | Outside, driven by AVARICE | Outside, calling AVARICE |
|---|---|---|
| The `avarice` CLI and its six commands | Claude Code (`claude -p`), GSD's `gsd-tools`, git, graphify, `sandbox-exec`, `mount`, `pgrep`, `ps` | Claude Code runs AVARICE's PreToolUse hook on every tool call |
| The ledger (SQLite) and the artifact store | The user's repository (read through git objects and a local clone) | |
| Staging clones and generated invocation files | | |

Each external system, its protocol and its failure behavior are in [integrations.md](integrations.md).

## Layers and the import rule

The source is a modular monolith in five layers. A lint run on every change enforces the import rule for the inner three: domain imports nothing outside itself except a hash function and reads no process state; ports import only domain; the application layer imports nothing from adapters or the CLI. The lint passes at the pinned commit.

| Layer | Holds | May import |
|---|---|---|
| Domain | Pure rules: lifecycle, preflight classification, contract compilation, mapping, validation, hook decisions, invocation scope, graph merge and validation, project record | itself only |
| Ports | Interfaces for the eight outside dependencies: agent host, command executor, graph tool, GSD onboarding, context source, staging workspace, ledger, artifact store | domain |
| Application | The onboarding service and its stages, resume, budgets, invocation preparation, status and context | domain, ports |
| Adapters | One implementation per port: Claude Code host, sandboxed executor, graphify, GSD tools, GSD context readers, local clone staging, SQLite ledger, file artifact store | anything |
| CLI | Argument parsing, command dispatch and the composition root that wires one adapter per port | anything |

The PreToolUse hook is a separate entry point. It runs as its own process, started by Claude Code, and uses the domain's hook decision rules and the ledger file directly ([containment.md](containment.md#the-pretooluse-hook)).

## Where to read next

- To run the CLI: [cli-reference.md](cli-reference.md) and [config-reference.md](config-reference.md).
- To understand or change onboarding: [onboarding.md](onboarding.md), then [processes.md](processes.md) for the end-to-end flows.
- To understand confinement: [containment.md](containment.md).
- To understand what is stored: [data-model.md](data-model.md).
- To understand retrieval: [indexes-and-context.md](indexes-and-context.md).
