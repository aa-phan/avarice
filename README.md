# AVARICE

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) is a proposed local-first service layer around GSD for agentic software development. You give it a brief and a policy preset, and it compiles a run contract. It runs GSD units headless inside an OS sandbox with fail-closed hooks and shared budgets. Consequential questions become decision records. Evidence gates bound to the exact revision check the result, and the run ends with a reviewable change or a short list of blocking decisions. GSD keeps planning and execution inside each unit. AVARICE adds what GSD does not cover: the contract, containment, budgets, decision routing, integrity gates, evidence, profile isolation and diagnostics.

This repository holds a specification package. No code exists yet; every interface, limit and configuration sample in it is a proposal.

## Recommendation

Build AVARICE as a TypeScript CLI on Node 22.22.3 or newer, with one local SQLite database per profile through `node:sqlite` and a content-addressed artifact directory ([ADR-001](docs/decisions/ADR-001-language-and-runtime.md), [ADR-003](docs/decisions/ADR-003-local-persistence.md)). For unattended work, a per-run supervisor launches Claude Code headless (`claude -p`) with generated settings ([containment.md](docs/containment.md)). Those settings enable the Bash sandbox with `failIfUnavailable`, use `dontAsk` permissions, load no user or project settings, and add AVARICE's own PreToolUse hook with `onFailure: "block"`. The launch also scrubs the environment and caps cost per invocation. Each invocation runs one GSD unit (`/gsd-quick --validate --text`). The supervisor classifies how it ended and answers GSD pauses only with a validated human decision or a default the contract declares ([ADR-006](docs/decisions/ADR-006-unattended-delegation.md)). Attended work keeps the simpler handoff of [ADR-002](docs/decisions/ADR-002-gsd-integration-mode.md).

## Boundaries

| AVARICE owns | AVARICE does not own |
|---|---|
| Run contracts, budgets, decision records, approvals in the personal profile | Plans, phases, tasks and retries inside a GSD unit (GSD) |
| Generating containment configuration and refusing to run without it | Executing containment (OS sandbox, agent host, external platforms) |
| Context packs with citations, revisions and freshness | Knowledge sources (repository, `.planning/`, docs systems) |
| Deterministic checks, test inventories, mutation gate, gates G0 to G4 | Goal verification verdicts (GSD verifier) |
| Profile isolation, notifications, diagnostics | Identity, model access, branch protection, reviews, release gates |

## Example unattended run

Target behavior after slice 4, with push notifications from slice 5. All numbers are illustrative.

```text
$ avarice start --brief briefs/expired-tokens.md --policy routine
  contract v1: 4 work items, write src/auth/** test/auth/**, 600 tool calls, $20 estimated cost cap
  enforcement: enforced (sandbox, dontAsk, fail-closed hook)    supervisor started
# you leave; items A and C finish; item B asks which status code expired tokens return
# phone: "avarice: 1 decision needed (run_01JC8), nothing else left to do"
$ avarice inbox
  D1 [acceptance] Expired token response: 401 or 403?  recommendation: 401 (matches existing ApiError)
$ avarice decide D1 401
  answer valid for contract v1, base 4f2c9e1; resuming item B
# later: "avarice: run_01JC8 ready for review"
$ avarice status run_01JC8
  ready_for_review  head a1b2c3d (clean)  unit, lint, types passed  AC1 AC2 AC3 mapped  assumptions: 1  draft PR #212
```

## Document map

| Document | Purpose |
|---|---|
| [docs/requirements.md](docs/requirements.md) | Use cases, non-goals, every requirement ID, acceptance criteria, assumptions |
| [docs/existing-tooling-assessment.md](docs/existing-tooling-assessment.md) | Verified inventory, GSD ownership, GSD autonomy and Claude Code enforcement surfaces, reuse and gap matrix |
| [docs/architecture.md](docs/architecture.md) | Context, process view, modules, dependency direction, trust boundaries, source-of-truth ownership |
| [docs/containment.md](docs/containment.md) | Launch configuration, enforcement coverage matrix, fail-closed behavior, restricted mode, file and retrieval safeguards, budgets |
| [docs/autonomy-and-decisions.md](docs/autonomy-and-decisions.md) | Supported unattended workflow, decision matrix, interaction policy, notifications, end-to-end sequence, autonomy metrics and benchmark |
| [docs/repository-onboarding.md](docs/repository-onboarding.md) | Onboarding existing repositories with GSD as the mapper: ownership matrix, lifecycle, onboarding contract, mapping modes, project record, active validation, migration, failure and recovery |
| [docs/contracts-and-state.md](docs/contracts-and-state.md) | Run contract, budgets, ports, state machines, decision records, evidence schema, phase gates, persistence |
| [docs/reference-system-deep-dive.md](docs/reference-system-deep-dive.md) | How AVARICE differs from 3dmk per component, with 3dmk's documentation as the primary source; the design choice behind each difference; portability, scalability and homelab convergence |
| [docs/reference-system-comparison.md](docs/reference-system-comparison.md) | Audit against the 3dmk reference system: component mapping, similarities, differences by design, the 3dmk author's answers, gaps G-1 to G-10 and recovery and delegation adjustments |
| [docs/extensions.md](docs/extensions.md) | Placement of skills, hooks, sandbox, plugin, MCP and capability; prioritized catalog; compatibility |
| [docs/deployment-and-portability.md](docs/deployment-and-portability.md) | Local baseline, offline matrix, NAS and homelab migration, portability limits |
| [docs/enterprise-adaptation.md](docs/enterprise-adaptation.md) | Compatibility matrix, enforcement strength by profile, policy model, profile isolation, onboarding |
| [docs/operations-and-testing.md](docs/operations-and-testing.md) | Diagnostics, operation budgets, observability, containment suite, tests, acceptance scenarios S-1 to S-59 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Eight vertical slices (0 to 7) with exit criteria; GSD-compatible planning input |
| [docs/gsd-ingest-manifest.yaml](docs/gsd-ingest-manifest.yaml) | Manifest for `/gsd-ingest-docs` |
| [docs/decisions/](docs/decisions/) | ADR-001 runtime, ADR-002 GSD integration, ADR-003 persistence, ADR-004 modular monolith, ADR-005 policy and profiles, ADR-006 unattended delegation, ADR-007 mutation gate, ADR-008 repository onboarding, ADR-009 credential broker, ADR-010 serverless baseline with optional local services, ADR-011 static dashboard, ADR-012 architecture model, ADR-013 interactive shell |

## Answers to the design questions

| Question | Short answer | Owner document |
|---|---|---|
| How is an existing repository onboarded? | GSD maps and plans it inside a contained staging worktree; AVARICE validates the result, records provenance, and activates a project record | [repository-onboarding.md](docs/repository-onboarding.md) |
| How does retrieval stay token-efficient? | Onboarding builds GSD intel and one graph in staging, with code nodes and document nodes for stable project documents. Context packs query the graph and intel before whole files or sections, under a token budget and per-step retrieval caps | [contracts-and-state.md](docs/contracts-and-state.md#contextsource) |
| What runs on my laptop on day one? | A Node CLI and a SQLite file per profile; during a run, a supervisor and contained `claude -p` invocations. No permanent daemon, container or server | [deployment-and-portability.md](docs/deployment-and-portability.md#local-baseline) |
| What remains owned by GSD and other tools? | Planning, decomposition, execution, checkpoint semantics, goal verification; the sandbox and permission enforcement belong to the host and OS | [existing-tooling-assessment.md](docs/existing-tooling-assessment.md#gsd-lifecycle-ownership) |
| Which custom extensions are necessary? | CLI with supervisor and host adapter, a fail-closed hook set, run-scoped GSD configuration, the mutation gate, onboarding with its index adapters, the static dashboard, the architecture-model check, one skill and a local notifier; a GSD capability later | [extensions.md](docs/extensions.md#extension-catalog) |
| Where does state live, and how does interrupted work recover? | Local SQLite per profile; transitions and budget reservations are atomic; interrupted runs become `paused` and resume from the last checkpoint; a crashed invocation is discarded and retried once from the item's last checkpoint | [contracts-and-state.md](docs/contracts-and-state.md#recovery-rules) |
| How do I move artifacts or execution to a homelab? | Swap the `ArtifactStore` or `CommandExecutor` adapter and run the explicit migration; the database stays local | [deployment-and-portability.md](docs/deployment-and-portability.md#migration-matrix) |
| What changes when an enterprise disallows an integration? | The port reports `unsupported` and the manual mode takes over; a missing enforcement layer drops the run to restricted mode | [enterprise-adaptation.md](docs/enterprise-adaptation.md#enforcement-strength-by-profile) |
| How are personal and company data kept separate? | Separate profiles with separate roots, credentials and stores; explicit repository binding; no fallback | [enterprise-adaptation.md](docs/enterprise-adaptation.md#profile-isolation) |
| Which permissions are enforced, by whom? | Per restriction in the coverage matrix: OS sandbox, host rules and hook, scoped credentials, AVARICE adapters; external platforms stay authoritative | [containment.md](docs/containment.md#enforcement-coverage-matrix) |
| What evidence proves a task is complete? | Gate G4: every required check passed on one clean revision in the declared environment, every acceptance criterion mapped to deterministic evidence, no integrity-gate failure | [contracts-and-state.md](docs/contracts-and-state.md#phase-gates) |
| What does maintenance cost? | Re-running the GSD integration suite on GSD upgrades and the containment suite on every Claude Code upgrade | [implementation-plan.md](docs/implementation-plan.md#maintenance-cost) |
| Can I leave my desk? | Yes for the supported workflow on an awake Mac: routine transitions need no one, decisions wait in the inbox, and silence never approves | [autonomy-and-decisions.md](docs/autonomy-and-decisions.md#supported-unattended-workflow) |

## Guarantee classification

[containment.md](docs/containment.md#enforcement-coverage-matrix) owns the strength of every restriction (enforced, partial or detect-only) and [the unresolved host limitations](docs/containment.md#unresolved-host-limitations) that must pass before a row may claim "enforced". In summary:

| Class | Covers |
|---|---|
| Enforced in the baseline | Directory-level write scope for shell and its children; blocked reads of secrets and the store; Bash and WebFetch network scope; no credentials in the run; protection of the run's contract, policy, settings and budgets; fail-closed behavior; count budgets; preservation of user changes |
| Detection only | Unexpected files inside an allowed directory; assertion weakening inside allowed test files (measured on changed lines by the mutation gate when enabled); command identity under evasion |
| Dependent on host or enterprise controls | Hook coverage as documented by the host; tamper resistance against the user; egress beyond the sandbox proxy; model cost (an estimate capped per invocation) |
| Unverified | The unresolved host behaviors; outcome-classification accuracy on GSD text-mode output; the `/gsd-autonomous` double-execute path ([ADR-006](docs/decisions/ADR-006-unattended-delegation.md)) |

## Consequential trade-offs

Unattended runs use contained headless invocations. That requires `--permission-prompts none` and fail-closed hooks, so AVARICE must classify how each invocation ended, and endings it cannot classify become escalations that cost interruptions ([ADR-006](docs/decisions/ADR-006-unattended-delegation.md)). AVARICE routes GSD pauses to decision records and never uses `discuss --auto`, so consequential questions reach a human; fewer interruptions only count when defects and rework do not rise.

The OS sandbox is the real boundary, because command-text rules and hooks are bypassable for executed code. Hosts and enterprises without it get restricted mode only. Local SQLite gives atomic reservations with no server, and concurrent multi-machine work later needs a coordination service ([ADR-003](docs/decisions/ADR-003-local-persistence.md)). Node is the only runtime, so an enterprise that blocks modern Node blocks AVARICE ([ADR-001](docs/decisions/ADR-001-language-and-runtime.md)). Sleep stops a run; computing while the Mac sleeps needs the later remote worker.

## Traceability

Tests refer to suites in [operations-and-testing.md](docs/operations-and-testing.md#test-strategy), containment cases CS-1 to CS-16 and scenarios S-1 to S-59. The slice that delivers each requirement is owned by [implementation-plan.md](docs/implementation-plan.md#slices).

| Requirement | Components | Tests |
|---|---|---|
| RC-1, RC-2, RC-3 | `policy` contract compiler; G0 | Contract compilation tests; S-12 |
| RC-4 | `workflow` supervisor; run-scoped GSD configuration | S-12 |
| RC-5 | `policy`; data root placement; amendment TTY check | CS-10, CS-11; S-15 |
| RC-6 | `policy` amendments; `verify` invalidation | Amendment invalidation tests |
| RC-7, RC-8 | `policy` contract compiler; work-item sizes, specifications and `modelBySize` | S-50, S-51 |
| CON-1 | Coverage matrix | Containment suite |
| CON-2, CON-5, CON-8 | Sandbox, host rules, run hook | CS-1 to CS-6; S-13 |
| CON-3 | Hook `onFailure`, `failIfUnavailable`, launch refusal | CS-12 to CS-14; S-14 |
| CON-4 | Restricted mode | S-22 |
| CON-6 | Data root, protected paths, ConfigChange hook | CS-10, CS-11; S-15 |
| CON-7, CON-9 | Run worktree; hook precondition | S-20; stale-edit test |
| CON-10, CON-11, CON-12 | `context` adapters | CS-16; S-16 |
| CON-13, CON-15 | Budget ledger; hook reservations | S-16, S-19; reservation race |
| CON-14 | `workflow` escalation counters | Repeated-denial and no-progress tests |
| CON-16 | `workflow` recovery; run worktree reset to the last checkpoint | S-42 |
| AUT-1, AUT-2, AUT-3 | `decisions`; scheduler | S-17 |
| AUT-4, AUT-6 | `decisions`, `Notifier` | S-18 |
| AUT-5 | `decide` validation | S-19; response validation suite |
| AUT-7, AUT-8 | Gates G0 to G4; evidence schema | Gate suite; S-12 |
| AUT-9 | Gates G2, G4; protected test paths | S-21 |
| AUT-10 | Gate G3; reproducer | S-21 |
| AUT-11 | Delivery outside the run | S-8 |
| AUT-12 | Operational states; cancellation | S-3, S-19 |
| AUT-13 | `verify` mutant generator and probe; G4 | Mutation probe suite; S-23, S-25 |
| AUT-14 | `harden` items; derived contract; G2 | S-24 |
| AUT-16 | `verify` checks after every item | S-52 |
| AUT-17 | G2 symbol-scope check from the code graph | S-53 |
| ONB-1, ONB-8, ONB-12 | `onboarding` lifecycle, contract, budgets | S-26, S-35, S-36 |
| ONB-2, ONB-7, ONB-9 | Project record, provenance, validation | S-27, S-33 |
| ONB-3, ONB-4, ONB-5 | Staging worktree, onboarding sandbox, hook | S-30, S-31, S-32 |
| ONB-6 | Preflight, migration table | S-28, S-29 |
| ONB-10 | Active command validation | Validation suite |
| ONB-11 | `GsdOnboarding.checkDrift`, mapping-mode table, graph structural diff | S-34, S-38 |
| ONB-13 | `onboarding` index stage; project record index fields | S-39, S-40 |
| ONB-14, ONB-15 | Knowledge pass in the index stage; incremental refresh | S-45, S-46, S-47 |
| FR-1 | `workflow`, `TaskSource` manual | Baseline workflow; S-1 |
| FR-2, FR-7 | `workflow`, `Ledger` | Kill-point suite; S-3 |
| FR-3, FR-8 | `context`, `ContextSource`, `TaskSource.get` | Retrieval evaluation; S-5, S-6 |
| FR-4 | Host adapter (Stage 1); `avarice-bridge` (Stage 2) | GSD integration suite |
| FR-5, FR-6 | `verify`, `CommandExecutor`, `Workspace` | Evidence binding tests |
| FR-9, FR-10 | Delivery; feedback attempts | Baseline workflow; feedback test |
| FR-11 | `observe` | `status` snapshot tests; S-2 |
| FR-12 to FR-15 | `policy`, attended hook | Denied-action table; S-7 |
| FR-16 to FR-19 | Ports, descriptors, manual adapters | Contract suite |
| FR-20 | `gsd-intel` and `gsd-graph` adapters | S-41; retrieval evaluation (AC-8) |
| FR-21, AUT-15 | Project groups in `inventory`; per-repository contracts and delivery (later) | S-43, S-44 |
| FR-22 | Handle-first `ContextSource`; per-edge read rules | S-54 |
| FR-23 | `avarice reconcile --review` (later) | Entry 13 tests in [extensions.md](docs/extensions.md#13-avarice-reconcile---review-later) (later) |
| FR-24 | Host records in `inventory` (later) | S-11; deactivation-guard test |
| FR-25 | Architecture model draft and `architecture-model` check in `verify` | S-58, S-59 |
| FR-26 | `avarice dashboard` in `observe` | S-56, S-57; AC-15 |
| NFR-1, NFR-2 | Whole system | S-1, S-2 |
| NFR-3 | Import-boundary lint | Lint in CI |
| NFR-4 | Ports, fake-remote adapters | Portability proof (AC-7); S-10, S-11 later |
| NFR-5 | `Ledger` adapter, `doctor` | Network-mount refusal test |
| NFR-6, NFR-9 | `Ledger`, migrations | Kill-point suite; migration fixtures |
| NFR-7, NFR-8 | `ChangeRequests`, `exec` | Duplicate-retry suite (AC-4); S-8 |
| SEC-1 | `inventory` | Isolation suite (AC-6); S-9 |
| SEC-2, SEC-3 | Environment scrubbing, redactor | Redaction suite (AC-5) |
| SEC-4 | `policy` precedence | Precedence tests |
| SEC-5 | Adapters | Proxy and custom-CA tests |
| SEC-6 | Coverage matrix, enforcement map | `doctor` enforcement level; S-4 |
| SEC-7 | Packaging | Repository content check |
| SEC-8 | `CredentialProvider` events | S-48, S-49 |
| OPS-1, OPS-5, OPS-6 | `doctor`, bounds | Snapshot and version tests |
| OPS-2 | `observe` | Event correlation tests |
| OPS-3, OPS-4 | `backup`, `export`, retention | Restore drill (T-7) |

## Remaining decisions

Slice 0 onboards `~/aa-phan-portfolio-v2` (decided 2026-11-01) for its exit criterion.

1. Decided 2026-11-01: Claude Code is the primary host and GSD 1.17.0 is the baseline (assumptions A-1, A-2 confirmed).
2. Decided 2026-11-01: attended use targets whichever directory `CLAUDE_CONFIG_DIR` names, falling back to `~/.claude`; no path is hard-coded in the MVP. The developer's active directory is `~/.claude-edu`. Unattended runs load neither directory's settings.
3. Confirm GitHub as the personal SCM and manual briefs as the only personal task source for the MVP (A-3, A-4).
4. Choose the default limits of the `routine` policy preset (the example contract's numbers are illustrative only) and whether `routine` may push a branch and open a draft PR.
5. Choose the notification destination for decisions away from the desk (ntfy, Pushover or Telegram) and the check-in times.
6. Confirm that unattended runs only happen while the Mac is awake (A-8), or bring the remote worker forward.
7. Name the NAS model and OS before slice 6 (A-5).
8. Choose the default promotion mode for onboarded artifacts: `none` (artifacts stay in the staging worktree), `copy` into your checkout, or `commit` on an onboarding branch.
9. Answer the enterprise onboarding questionnaire when an employer environment is known (A-6).

## Sources

GSD facts come from the installed GSD 1.17.0 under `~/.claude/gsd-core/`, read on 2026-10-29. Claude Code behavior comes from https://code.claude.com/docs/en/ (sandboxing, permissions, permission-modes, hooks, settings, sub-agents, headless, scheduled-tasks, statusline, plugins-reference, skills, mcp), retrieved 2026-10-29 through a summarizing fetch, and from `claude --help` of versions 2.1.312 (2026-10-29) and 2.1.316 (2026-11-01). SQLite behavior comes from https://www.sqlite.org/wal.html and https://www.sqlite.org/useovernet.html. The architectural inspiration is https://3dmk.com/, retrieved 2026-10-29 through a summarizing fetch; its component descriptions are public claims that were not independently verified.
