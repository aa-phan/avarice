# Built system documentation

This tree describes AVARICE as it is built. It covers the onboarding of one existing repository to an active project record, and the unattended run of one or several work items on an onboarded repository to a reviewable local branch. It includes the decisions a run opens, the owner's answers, amendments and cancel, and the notifications and check-ins that reach the owner. It also covers the interactive shell, the profiles that keep one owner's contexts apart with their credentials and redaction, the policy and approvals that gate privileged actions, the `doctor` diagnosis and the portability layer. Every document here is written from the code and describes current behavior. The proposal-era specification in [`docs/`](../) describes the intended design and stays as written; where the code differs, this tree follows the code and the difference is listed in [findings.md](findings.md).

## How to read this

Start with [overview.md](overview.md). Reference documents ([cli-reference.md](cli-reference.md), [config-reference.md](config-reference.md)) are exhaustive for their surface. Descriptive documents state the mechanism and its consequences; the code owns the implementation, so they name their modules once in the opening and not again. Each document ends with the quirks a reader is likely to trip over.

A new document carries the mark "drafted, not yet reviewed" under its title until a second reader has checked it. A document that changed after its review is listed as `changed after review` in [coverage.md](coverage.md) until a fresh reviewer has read the changes. Do not rely on a marked or changed document before the others. The review status of every document is in [coverage.md](coverage.md).

## Documents

| Document | What it covers |
|---|---|
| [overview.md](overview.md) | System boundary, layers and the import rule |
| [cli-reference.md](cli-reference.md) | Every command, flag, exit code and output |
| [config-reference.md](config-reference.md) | Every environment variable, config file key and built-in limit |
| [onboarding.md](onboarding.md) | Lifecycle, preflight, contract and budgets, staging, mapping, validation, activation, resume |
| [runs.md](runs.md) | The unattended run: start and its refusals, the brief and the contract, the supervisor and its lease, the stages, several items in dependency order, park and unpark, discard and retry, repair, the hand-off, escalation to a decision, answer and resume, amendments, cancel and the status read model |
| [autonomy-and-decisions.md](autonomy-and-decisions.md) | Decision records, their classes and authority, the response checks, the stale re-open, withdraw, the amendment request, pickup without polling, notification and check-ins |
| [checks-and-evidence.md](checks-and-evidence.md) | The dependency install, validation of declared checks, the baseline, required checks, the test inventory, evidence and gates G1 to G4, repair |
| [interactive-shell.md](interactive-shell.md) | The shell that `avarice` opens with no arguments on a terminal |
| [profiles-and-credentials.md](profiles-and-credentials.md) | Profile names and classes, selection and binding, the config file and its keys, roots and isolation, credential references and providers, redaction, transcript retention |
| [policy-and-approvals.md](policy-and-approvals.md) | The action table, the ranked policy sources, approvals from request to expiry, privileged commands in the hook, no replay after an interruption, the enforcement map, the manual equivalents |
| [doctor.md](doctor.md) | The diagnosis command: what it reads and writes, its report sections, findings, flags and exit codes, host admission and enforcement, record incompatibility |
| [portability.md](portability.md) | Capability descriptors, step requirements and the unsupported refusal, the fake-remote adapters, the contract suite and the portability proof |
| [containment.md](containment.md) | Launch checks, generated settings, the PreToolUse hook, budgets, the sandboxed executor, the egress proxy, git safety, root placement, the identity rule of the owner commands |
| [indexes-and-context.md](indexes-and-context.md) | The code graph, intel and knowledge indexes, and `avarice context` |
| [data-model.md](data-model.md) | The ledger, events, decisions and notifications, contract versions, budgets, the artifact store, the project record, files on disk |
| [integrations.md](integrations.md) | Claude Code, GSD, git, graphify, the macOS sandbox, the egress proxy and package registry, the Claude configuration directory, the detached supervisor, `mount`, `osascript`, `launchctl`, `plutil` and launchd, Node and SQLite |
| [processes.md](processes.md) | Nine flows end to end, with [diagrams](diagrams/): onboard, kill then resume, start to ready for review, kill during the unit then resume a run, a crashed unit discarded and retried, independent work around an open decision, answering a decision and resuming the item, an amendment with a stale answer, and the approval of a privileged action |
| [history.md](history.md) | How the built system arrived, from the git history |
| [findings.md](findings.md) | Suspected defects and code-versus-specification differences, for the owner |
| [unknowns.md](unknowns.md) | What was not determined, and what was checked |
| [coverage.md](coverage.md) | Denominators, documented counts and review status |

## Proposal counterparts

Each proposal document in `docs/`, and each decision record in `docs/decisions/` that has a counterpart, maps to the living documents that describe the part of it that is built. A proposal with no counterpart has nothing built yet. The decision records not listed here have no counterpart of their own. The documents here are written from the code, not copied from the proposals, so their names and boundaries follow the built system.

| Proposal | Living counterparts |
|---|---|
| [repository-onboarding.md](../repository-onboarding.md) | [onboarding.md](onboarding.md), [indexes-and-context.md](indexes-and-context.md) |
| [containment.md](../containment.md) | [containment.md](containment.md), [runs.md](runs.md) for the run rows |
| [contracts-and-state.md](../contracts-and-state.md) | [data-model.md](data-model.md), [runs.md](runs.md), [checks-and-evidence.md](checks-and-evidence.md) |
| [architecture.md](../architecture.md) | [overview.md](overview.md) |
| [existing-tooling-assessment.md](../existing-tooling-assessment.md) | [integrations.md](integrations.md) |
| [requirements.md](../requirements.md) | partly: [cli-reference.md](cli-reference.md), [config-reference.md](config-reference.md), [runs.md](runs.md), [checks-and-evidence.md](checks-and-evidence.md) |
| [operations-and-testing.md](../operations-and-testing.md) | partly: [processes.md](processes.md), [coverage.md](coverage.md), [checks-and-evidence.md](checks-and-evidence.md), [doctor.md](doctor.md) for `doctor`, [portability.md](portability.md) for the portability proof |
| [autonomy-and-decisions.md](../autonomy-and-decisions.md) | partly: [autonomy-and-decisions.md](autonomy-and-decisions.md), [runs.md](runs.md), [cli-reference.md](cli-reference.md) for `decide`, `digest`, `schedule` and `cancel`, [config-reference.md](config-reference.md) for the profile `notify` keys |
| [extensions.md](../extensions.md) | partly: [cli-reference.md](cli-reference.md), [interactive-shell.md](interactive-shell.md), [runs.md](runs.md), for the command table, the shell and the supervisor; [doctor.md](doctor.md) for version compatibility and `--extensions` |
| [decisions/ADR-006-unattended-delegation.md](../decisions/ADR-006-unattended-delegation.md) | partly: [runs.md](runs.md), [autonomy-and-decisions.md](autonomy-and-decisions.md) (the proposal is still marked Proposed) |
| [decisions/ADR-013-interactive-shell.md](../decisions/ADR-013-interactive-shell.md) | [interactive-shell.md](interactive-shell.md) |
| [deployment-and-portability.md](../deployment-and-portability.md) | partly: [portability.md](portability.md), for the local adapters, the descriptors and the portability proof; nothing of a remote deployment is built |
| [enterprise-adaptation.md](../enterprise-adaptation.md) | partly: [policy-and-approvals.md](policy-and-approvals.md), [profiles-and-credentials.md](profiles-and-credentials.md), [doctor.md](doctor.md), for the policy model, the profiles, the credential references, the enforcement map and the manual modes |
| [decisions/ADR-005-policy-approvals-and-profiles.md](../decisions/ADR-005-policy-approvals-and-profiles.md) | partly: [policy-and-approvals.md](policy-and-approvals.md), [profiles-and-credentials.md](profiles-and-credentials.md) |
| [decisions/ADR-009-credential-broker.md](../decisions/ADR-009-credential-broker.md) | partly: [profiles-and-credentials.md](profiles-and-credentials.md) (the broker is wired and has no caller yet) |
| [decisions/ADR-014-host-patch-admission.md](../decisions/ADR-014-host-patch-admission.md) | [containment.md](containment.md) and [doctor.md](doctor.md), for the admitted host versions, the admission labels and the launch self-check of an unverified patch |
| [decisions/ADR-015-knowledge-pass-default.md](../decisions/ADR-015-knowledge-pass-default.md) | [indexes-and-context.md](indexes-and-context.md), for the knowledge pass default |
| [decisions/ADR-016-ac8-token-bound.md](../decisions/ADR-016-ac8-token-bound.md) | partly: [findings.md](findings.md), for the AC-8 bound and the recorded result; the evaluation harness has no document in this tree |
| [implementation-plan.md](../implementation-plan.md), [reference-system-comparison.md](../reference-system-comparison.md), [reference-system-deep-dive.md](../reference-system-deep-dive.md) | none: planning and comparison material, not a description of the system |
