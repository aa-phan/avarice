# Built system documentation

This tree describes AVARICE as it is built: the onboarding of one existing repository to an active project record. Every document here is checked against the code and describes current behavior. The proposal-era specification in [`docs/`](../) describes the intended design and stays as written; where the code differs, this tree follows the code and the difference is listed in [findings.md](findings.md).

## How to read this

Start with [overview.md](overview.md). Reference documents ([cli-reference.md](cli-reference.md), [config-reference.md](config-reference.md)) are exhaustive for their surface. Descriptive documents state the mechanism and its consequences; the code owns the implementation, so they name their modules once in the opening and not again. Each document ends with the quirks a reader is likely to trip over.

A document marked "drafted, not yet reviewed" under its title has not had a second reader; do not rely on it before the others. The review status of every document is in [coverage.md](coverage.md).

## Documents

| Document | What it covers |
|---|---|
| [overview.md](overview.md) | System boundary, layers and the import rule |
| [cli-reference.md](cli-reference.md) | Every command, flag, exit code and output |
| [config-reference.md](config-reference.md) | Every environment variable, config file key and built-in limit |
| [onboarding.md](onboarding.md) | Lifecycle, preflight, contract and budgets, staging, mapping, validation, activation, resume |
| [containment.md](containment.md) | Launch checks, generated settings, the PreToolUse hook, budgets, the sandboxed executor, git safety, root placement |
| [indexes-and-context.md](indexes-and-context.md) | The code graph, intel and knowledge indexes, and `avarice context` |
| [data-model.md](data-model.md) | The ledger, events, budgets, the artifact store, the project record, files on disk |
| [integrations.md](integrations.md) | Claude Code, GSD, git, graphify, the macOS sandbox, `mount`, Node and SQLite |
| [processes.md](processes.md) | The onboard flow and the kill-then-resume flow, end to end, with [diagrams](diagrams/) |
| [history.md](history.md) | How the built system arrived, from the git history |
| [findings.md](findings.md) | Suspected defects and code-versus-specification differences, for the owner |
| [unknowns.md](unknowns.md) | What was not determined, and what was checked |
| [coverage.md](coverage.md) | Denominators, documented counts and review status |

## Proposal counterparts

Each proposal in `docs/` maps to the living documents that describe the part of it that is built. A proposal with no counterpart has nothing built yet. The documents here are written from the code, not copied from the proposals, so their names and boundaries follow the built system.

| Proposal | Living counterparts |
|---|---|
| [repository-onboarding.md](../repository-onboarding.md) | [onboarding.md](onboarding.md), [indexes-and-context.md](indexes-and-context.md) |
| [containment.md](../containment.md) | [containment.md](containment.md) |
| [contracts-and-state.md](../contracts-and-state.md) | [data-model.md](data-model.md) |
| [architecture.md](../architecture.md) | [overview.md](overview.md) |
| [existing-tooling-assessment.md](../existing-tooling-assessment.md) | [integrations.md](integrations.md) |
| [requirements.md](../requirements.md) | partly: [cli-reference.md](cli-reference.md), [config-reference.md](config-reference.md) |
| [operations-and-testing.md](../operations-and-testing.md) | partly: [processes.md](processes.md), [coverage.md](coverage.md) |
| [autonomy-and-decisions.md](../autonomy-and-decisions.md) | none yet |
| [extensions.md](../extensions.md) | none yet |
| [deployment-and-portability.md](../deployment-and-portability.md) | none yet |
| [enterprise-adaptation.md](../enterprise-adaptation.md) | none yet |
| [implementation-plan.md](../implementation-plan.md), [reference-system-comparison.md](../reference-system-comparison.md), [reference-system-deep-dive.md](../reference-system-deep-dive.md) | none: planning and comparison material, not a description of the system |
