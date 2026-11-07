# Overview

This document describes the boundary and the internal dependency map of the built system in `src/` and `bin/`. It is derived from the code's imports and wiring, not from the proposal-era architecture document: the composition root `src/cli/composition.ts`, the dependency shape `src/app/deps.ts` and the dispatcher `src/cli/main.ts`.

AVARICE as built is a local Node CLI with two slices. Onboarding takes one existing source repository to an active project record. A run takes one written brief on an onboarded repository to one reviewable local branch, unattended. Both drive GSD and Claude Code as child processes and keep their state in one SQLite file per profile. Everything a contained model does happens inside a clone, under a generated permission set, an OS sandbox and a fail-closed hook: a staging clone for onboarding, a run clone for a run. [containment.md](containment.md) labels each control as prevention, detection or recovery. The user's checkout is never written. The one write to the user's repository is the run hand-off, which adds a new local branch and the objects it needs.

## System boundary

| Inside AVARICE | Outside, driven by AVARICE | Outside, calling AVARICE |
|---|---|---|
| The `avarice` CLI and its ten commands, and the interactive shell that bare `avarice` opens on a terminal | Claude Code (`claude -p`), GSD's `gsd-tools`, git, graphify, `sandbox-exec`, `mount`, `pgrep`, `ps` | Claude Code runs AVARICE's PreToolUse hook on every tool call |
| The run supervisor, the same CLI entry started as a detached process by `start` | The user's repository (read through git objects and a local clone) | A shell, which starts a command |
| The ledger (SQLite) and the artifact store | The dependency install's tool, run in the run clone with registry-only network | |
| Staging clones, run clones and generated invocation files | | |
| One loopback proxy that relays a dependency install to the registry hosts a contract names | | |

The ten commands are `init`, `repo`, `onboard`, `start`, `supervise`, `status`, `inbox`, `resume`, `context` and `install-host`. Their flags and exit codes are in [cli-reference.md](cli-reference.md), and the shell is in [interactive-shell.md](interactive-shell.md).

AVARICE's own code opens a network connection in one place: the loopback proxy. It listens on 127.0.0.1 and relays a connection only to an exact host and port the contract allowed (port 443 for the registry hosts of a dependency install). Every other network use belongs to a child process. A source-tree test holds this: only the proxy may import a network module or listen. The same test limits detaching a child on purpose to the supervisor spawn. Two adapters are exempt, because they start a process group of their own so that they can kill it as a unit.

The writes outside the profile are few. Onboarding writes nothing to the user's repository. A run's hand-off creates one new local branch `avarice/<runId>` there, create-only, and writes no working tree, index or other ref. `install-host` writes one skill file under the Claude configuration directory. Each external system, its protocol and its failure behavior are in [integrations.md](integrations.md).

## Layers and the import rule

The source is a modular monolith in five layers. A lint, run by hand with `npm run check:boundaries`, enforces the import rule for the inner three. Domain imports nothing outside itself except a hash function and reads no process state. Ports import only domain and themselves. The application layer imports nothing from adapters or the CLI, but may import Node built-ins. The lint also refuses a dynamic import or require whose argument is not one string literal. At the commit counted in [coverage.md](coverage.md) it passes over 79 files.

| Layer | Holds | May import |
|---|---|---|
| Domain | Pure rules: onboarding and run lifecycles, preflight classification for both, contract compilation for both, the brief and the repository conventions, gates, evidence and outcome classification, quick records, mapping, validation, hook decisions, invocation scope, graph merge and validation, project record | itself only |
| Ports | Interfaces for the eleven outside dependencies: agent host, command executor, graph tool, GSD onboarding, context source, staging workspace, ledger, artifact store, run source, run workspace, egress proxy | domain |
| Application | The onboarding service and its stages, the run start service, the run supervisor and its stages, both resume paths, budgets, invocation preparation, dependency and check handling, status for both slices and context | domain, ports |
| Adapters | One production implementation per port, plus the refusing host described below and a dormant worktree staging adapter (see [onboarding.md](onboarding.md)): Claude Code host, sandboxed executor, graphify, GSD tools, GSD context readers, local clone staging, SQLite ledger, file artifact store, git run source, local clone run workspace, allowlisting egress proxy | anything |
| CLI | Argument parsing, command dispatch, the supervisor spawn, rendering, the interactive shell and the composition root that wires the adapters | anything |

The ports directory holds a twelfth file, the capability descriptor every adapter publishes; it is a shared type and not a port.

The run slice sits beside the onboarding slice in every layer. It reuses the ledger, the lease and stage-loop rules, the agent host, the executor and the budget mechanics. It adds three ports: a run source that reads conventions and drift from git objects, a run workspace that is the run's clone and its hand-off, and the egress proxy. A hand-built dependency set in a test may omit those three; a composed one always has them. [runs.md](runs.md) owns the run flow, and [onboarding.md](onboarding.md) owns the stage loop they share.

The composition root opens and migrates the ledger, locates GSD and builds each adapter. Unless the command is read-only, it also records the descriptors of the executor, graph tool, GSD adapter (when found) and host in the ledger. A read-only command never probes the sandbox or the host. The production host is the contained Claude Code adapter when an admitted GSD, an admitted `claude`, the sandbox and the hook entry are all present and the adapter reports enforcement as enforced. Otherwise it is a host that refuses every launch and records why. Tests may replace the host, the executor and the egress proxy through overrides that the production entry never passes.

Two processes besides the command itself run AVARICE code. The PreToolUse hook is a separate entry point, started by Claude Code. It uses the domain's hook decision rules and opens the ledger file directly, through two adapter helpers, without going through the ports ([containment.md](containment.md#the-pretooluse-hook)). The run supervisor is the CLI entry started again as `supervise <runId>`. It composes its own dependencies, takes the run lease and works the run to a stop state. The application layer imports no process-spawning module, and the supervisor spawn sits in the CLI layer; the lint does not enforce that.

## Where to read next

- To run the CLI: [cli-reference.md](cli-reference.md) and [config-reference.md](config-reference.md).
- To use the interactive shell: [interactive-shell.md](interactive-shell.md).
- To understand or change onboarding: [onboarding.md](onboarding.md), then [processes.md](processes.md) for the end-to-end flows.
- To understand or change a run: [runs.md](runs.md), then [checks-and-evidence.md](checks-and-evidence.md) for the install, the check validation, the baseline, the evidence and the gate rules.
- To understand confinement: [containment.md](containment.md).
- To understand what is stored: [data-model.md](data-model.md).
- To understand retrieval: [indexes-and-context.md](indexes-and-context.md).
- To see how the system arrived and what is open: [history.md](history.md), [findings.md](findings.md) and [unknowns.md](unknowns.md).

## Quirks

- The import lint covers domain, ports and the application layer only. It does not check adapters, the CLI or the hook.
- The hook imports from adapters, so "the inner layers never reach adapters" holds for the application layer and not for every process.
- Bare `avarice` opens the shell only when both standard streams are terminals and no run marker is set; otherwise it prints usage and exits 64.
- The supervisor has no console and outlives the command that started it; the ledger is its only record.
