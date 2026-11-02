# Requirements

> Status: proposal. Nothing described in this document is built yet; present tense describes the proposed design.

This document owns every normative requirement for AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment). Each requirement has a stable ID; other documents cite the ID and never restate the requirement. The traceability table in [README.md](../README.md#traceability) maps each ID to components and tests.

## How to read this

| Label | Meaning |
|---|---|
| **MVP** | Required for the first usable release on one Mac (profile `personal-local`). |
| **Contract** | The interface or invariant is designed and tested now. Only the local adapter is implemented. |
| **Later** | Added after the MVP: personal infrastructure (NAS, homelab, remote worker) and cross-repository runs. |
| **Onboarding** | Decided only when a specific employer environment is known. |
| **Assumption** | Provisional. Listed in [Assumptions](#assumptions) with the decision that would replace it. |

The command-line tool and package keep the lowercase name `avarice`. Two terms are easy to confuse. A **profile** (`personal-local`, `personal-extended`, `enterprise-<org>`, selected with `--profile`) is an isolated identity and data space with its own configuration, credentials and store. A **policy preset** (for example `routine`, selected with `--policy`; [list](contracts-and-state.md#run-contract)) is a reusable set of contract limits and authority classes inside a profile. The 3dmk reference system named below is a public description of a personal multi-service agent platform at https://3dmk.com/, used as design inspiration only.

"Must" is binding. "Should" can be waived with a recorded ADR.

## Users and use cases

There is one primary user: a developer orchestrating their own work with coding agents on their own machine. In the enterprise profile the same person works inside a company's managed environment. A secondary reader is an enterprise platform or security reviewer who must decide whether the framework is acceptable.

| ID | Use case |
|---|---|
| UC-1 | Start work from a manual brief or a task reference, and get a bounded plan grounded in retrieved project context. |
| UC-2 | Implement through the existing agent host and GSD workflow, then run the repository's own checks. |
| UC-3 | Stop at any point (crash, sleep, context reset, end of day) and resume with an accurate picture of what was verified and what was not. |
| UC-4 | Prepare a reviewable change (summary, branch, PR draft) and fold review or CI feedback back into a new attempt. |
| UC-5 | Ask "what state is this work in, and what proves it?" without the model being online. |
| UC-6 | Later, move artifact bytes or command execution to a NAS or homelab without rewriting workflows. |
| UC-7 | Use the same workflow at an employer under its identity, tracker, SCM, CI and policy, with no company data leaking into personal profiles. |
| UC-8 | Set the goal and the operating boundaries, leave the desk, and come back to a verified, reviewable change or to a short list of genuine blocking decisions. |
| UC-9 | Bring an existing repository under AVARICE: let GSD learn and plan for it, while AVARICE controls where, how and under what authority that onboarding runs, and ends with an active project profile. |

## Non-goals

- Replacing GSD planning, phase execution or verification. AVARICE supplies services around GSD; see [ADR-002](decisions/ADR-002-gsd-integration-mode.md).
- A general plugin marketplace, a distributed scheduler, or a universal provider abstraction.
- A dashboard that needs a server or a listening port in the MVP. The static dashboard in FR-26 is in scope.
- Exactly-once execution across external systems.
- Defending against a user who controls the whole machine. Local controls guard against agent mistakes and injected instructions; the machine owner can bypass them.
- Zero human intervention, or guaranteed correctness of unattended results. Unattended runs end in a reviewable change or in explicit blocking decisions.
- An exact hard cost cap where the host reports usage late or not at all. Budgets use conservative request, context and tool-call limits instead.
- Merging, publishing or deploying unattended, unless a run contract and organizational policy separately authorize it.
- Replacing or bypassing enterprise identity, tracking, SCM, CI, secrets, security or release processes.
- Cloning the service layout of the 3dmk reference system.

## Functional requirements

### Workflow

| ID | Requirement | Scope |
|---|---|---|
| FR-1 | A run must start from either a manual brief (Markdown text or file) or a typed external task reference. A manual brief must be sufficient on its own. | MVP |
| FR-2 | A run must follow the explicit state machine in [contracts-and-state.md](contracts-and-state.md#run-state-machine). Every transition must be persisted before the side effect that depends on it begins. | MVP |
| FR-3 | Context assembly must produce a bounded, cited context pack: every included item records source identity, revision, retrieval time and scope. | MVP |
| FR-4 | Planning, phase decomposition and implementation must be delegated to GSD through supported commands. AVARICE must not keep a competing plan, task list or retry loop for the same work. | MVP |
| FR-5 | Verification must run the repository's own check commands as deterministic subprocesses and record exit status, duration, the command, and the verified workspace state. | MVP |
| FR-6 | Completion evidence must name the exact revision verified: a commit SHA plus a clean-tree flag, or a content digest of the dirty tree. Model-written text is never completion evidence. | MVP |
| FR-7 | A checkpoint must be written at every state transition, and a resume must rebuild the next action from checkpoints, the GSD state files and the live git state, without relying on chat history. | MVP |
| FR-8 | On resume, every external reference in the context pack must be refreshed or marked stale before the run continues. | MVP |
| FR-9 | Change preparation must produce a change summary from recorded evidence. PR creation is a privileged action ([FR-12](#authorization)). | MVP (summary), Contract (PR) |
| FR-10 | Review and CI feedback must enter as new evidence attached to a new attempt. They must never overwrite the evidence of an earlier attempt. | Contract |
| FR-11 | A read-only `status` command must print the run state, the last checkpoint, evidence and stale references. It must work offline and without a model. | MVP |

### Authorization

| ID | Requirement | Scope |
|---|---|---|
| FR-12 | Actions are classed as `read`, `local-write` (reversible inside the workspace) or `privileged` (pushes, PR creation, tracker writes, deploys, anything outside the workspace). Privileged actions require an approval reference bound to the run, the action and its parameters. The run contract is a valid approval source when it authorizes the action with its parameters (for example "push branch `avarice/<run>` to `origin` and open a draft PR"); otherwise a separate approval record is needed. | MVP |
| FR-13 | Permission to plan must not imply permission to perform privileged actions. Approval of a plan must not approve the privileged actions inside it. | MVP |
| FR-14 | Content retrieved from tickets, documents, web pages or tool output must not grant authority or change policy. | MVP |
| FR-15 | Queued privileged actions must not replay automatically after connectivity returns. Each needs a fresh decision. | MVP |

### Integration

| ID | Requirement | Scope |
|---|---|---|
| FR-16 | Every port must declare its capabilities. Calling an unsupported capability must return a typed `Unsupported` error naming the capability and the documented reduced mode. It must never return a simulated success. | Contract |
| FR-17 | Provider-specific features must be reachable through namespaced extensions and must not widen the core port. | Contract |
| FR-18 | External references must keep the provider's original identifiers. AVARICE must not mint a global identity that loses provenance. | Contract |
| FR-19 | Every external integration must have a manual equivalent: paste a ticket, paste CI output, record an approval by hand. | MVP |
| FR-20 | Context assembly must query a fresh structured index before reading whole files or document sections. Structured indexes are GSD intel and the GSD-managed graph, including its document nodes. It must rank model-inferred graph edges below edges extracted from code. | MVP |
| FR-21 | Project records may belong to a project group that shares references to standards and scaffolds. Membership must never widen any member's authority. | Later |
| FR-22 | Context retrieval must be handle-first: a source returns handles with token estimates before any content, and the assembler chooses within the budget before reading. Graph reads must follow a rule per edge type: containment loads descendants, dependency loads one hop, reference returns only the target's ID. | MVP |
| FR-23 | A review-only reconciliation must compare the codebase map and the documents listed for the knowledge pass with the code, cite evidence for every finding, and never edit documents or code. | Later |
| FR-24 | Each machine that runs work for a profile must have a host record with its identity, capability descriptor and status. A host must not be deactivated while an active project or run still depends on it. | Later |
| FR-25 | A repository may declare an architecture model in `.avarice/architecture.json`: components with path globs, allowed edges between them with contract symbols, and shared resources with UUIDs. AVARICE must draft it deterministically from the code graph as a proposal that takes effect only after the user approves it, and an `architecture-model` check must report code that departs from it ([ADR-012](decisions/ADR-012-architecture-model.md)). | MVP |
| FR-26 | `avarice dashboard` must render one self-contained, read-only HTML page from the profile's ledger, with no server, no listening port and no network access, redacted like events and limited to one profile ([ADR-011](decisions/ADR-011-static-dashboard.md)). | MVP |

### Run contract

The run contract is defined in [contracts-and-state.md](contracts-and-state.md#run-contract).

| ID | Requirement | Scope |
|---|---|---|
| RC-1 | Every run must execute under a durable, versioned run contract. The contract states intended behavior, acceptance criteria, exclusions, requirement references, workspace, readable and writable paths, protected paths, creation and deletion rules, permitted commands, tools and endpoints, delegated decision classes, budgets, required evidence, escalation rules and notification preferences. | MVP |
| RC-2 | A contract must be assembled from a reusable policy preset, repository conventions and the brief. A routine task must not need a bespoke form; `avarice start --brief <file> --policy <preset>` must be sufficient. | MVP |
| RC-3 | The user's authorization comes from the brief, the selected policy preset or an explicit instruction. AVARICE must not add a confirmation step for authority the user already granted. | MVP |
| RC-4 | Within the contract, routine actions and phase transitions must proceed without human prompts. | MVP |
| RC-5 | The agent, its subagents and any process the run starts must not be able to expand the contract's scope, change policy, increase a budget or obtain credentials. Only the user (personal) or the authorizer named by policy (enterprise) can amend a contract, through an interactive AVARICE command outside the governed run. | MVP |
| RC-6 | A contract amendment must be recorded as a new contract version with the authorizer, reason and diff. Evidence collected under an earlier version is invalidated when the amendment changes acceptance criteria, writable scope, required checks or the policy revision. | MVP |
| RC-7 | Each work item must carry a size (`small`, `medium` or `large`) and a specification: the files it may change, the public symbols it adds or changes, the configuration keys it touches and the documents it cites. When the brief omits them, the compiler derives them from the brief, the indexes and the GSD plan, and records which were derived. | MVP |
| RC-8 | The model for each work item's invocation must come from its size through the preset's size-to-model map, unless the contract overrides it for that item. | MVP |

### Containment

Each restriction's enforcement point, covered paths and limits are listed in [containment.md](containment.md#enforcement-coverage-matrix).

| ID | Requirement | Scope |
|---|---|---|
| CON-1 | Each contract restriction must name its enforcement point, covered execution paths, known bypasses, failure behavior and the test that proves it. Prevention, detection and recovery must be labeled separately. | MVP |
| CON-2 | Writes outside the contract's writable paths must be prevented on every mutation path the run can reach (editing tools, shell and its child processes, interpreters, subagents), or that path must be unavailable to the run. A post-run diff check is detection only. | MVP |
| CON-3 | Required enforcement must fail closed: missing configuration, invalid policy, enforcement timeout or enforcement crash must block the protected operation. | MVP |
| CON-4 | A host or environment where required enforcement is unavailable must run in an explicit restricted mode (read-only analysis and planning, no writes outside a disposable copy, no network). It must never fall back to instructions or unrestricted execution. | MVP |
| CON-5 | Shell-command pattern matching must not be the only containment for arbitrary executable code. | MVP |
| CON-6 | The run must not be able to modify enforcement configuration, hook implementations, permission settings, credential configuration, the policy files or the budget ledger. | MVP |
| CON-7 | Edits must be preceded by reading the target, and must check a precondition (content digest or revision) so that stale edits fail. Pre-existing user changes in the workspace must be preserved through failed work and recovery. | MVP |
| CON-8 | Paths must be canonicalized before evaluation; symlinks and traversal that resolve outside writable paths must be refused. Build and test outputs must have declared locations. | MVP |
| CON-9 | Recovery must never reset or delete changes the run did not make, and must not claim that external effects were rolled back. | MVP |
| CON-10 | Retrieval must be progressive (index, scoped search, bounded snippets, justified full reads). Broad discovery must be authorized by the contract. | MVP |
| CON-11 | Retrieval adapters must enforce scope filters, field selection, page and result caps, returned bytes, query timeouts, cancellation and cumulative budgets. Backend cost must be bounded separately from returned size. | MVP (local), Contract (remote) |
| CON-12 | Caches must record source version, freshness and access scope, and must not be reused after access is revoked or across profiles. | MVP |
| CON-13 | Budget accounting must persist across restarts, be shared by subagents and retries, and use atomic reservation where work runs concurrently. Where usage reporting is delayed or absent, AVARICE must say so and use conservative limits. | MVP |
| CON-14 | Loops must stop: repeated denials, ineffective searches and repeated repair attempts each have a limit that ends in a checkpoint and an escalation. | MVP |
| CON-15 | Subagents and delegated work must receive equal or narrower authority than their parent and draw from the parent's budget. | MVP |
| CON-16 | A crashed or timed-out invocation that left no side effect outside the machine must be discarded before any retry, by resetting the run worktree to the commit recorded at the work item's last checkpoint. The reset is limited to commits and files the run created after that checkpoint (CON-9). | MVP |

### Autonomy and human involvement

The decision matrix and interaction policy live in [autonomy-and-decisions.md](autonomy-and-decisions.md).

| ID | Requirement | Scope |
|---|---|---|
| AUT-1 | Human involvement must be triggered by decision significance (consequence, reversibility, authority, evidence), never by the end of a stage alone and never by model confidence alone. | MVP |
| AUT-2 | A needed human decision must be persisted as a decision record with issue, evidence, options, recommendation, consequences, affected dependencies and any authorized default. | MVP |
| AUT-3 | While a consequential decision is open, the run must continue independent authorized work and must not implement dependent work. With no independent work left, it must checkpoint and enter a visible blocked state without polling. | MVP |
| AUT-4 | Deadlines, silence and notification failure must never count as approval. | MVP |
| AUT-5 | A decision response must be validated for identity, scope, applicability to current state and duplication before it is applied. Relevant tickets, code, policy and credentials must be refreshed before work resumes. | MVP |
| AUT-6 | Notifications must go only to destinations the user configured. A failed delivery must leave the decision pending and visible locally. Scheduled check-ins must use software scheduling, not a waiting model. | MVP (local), Later (push adapters) |
| AUT-7 | Phase transitions must be decided by machine-checkable entry and exit conditions with persisted evidence, never by an agent summary alone. | MVP |
| AUT-8 | Acceptance criteria must map to verification. Check results must distinguish passed, failed, skipped, unavailable and inconclusive, and must be tied to the revision and environment tested. | MVP |
| AUT-9 | The run must not be able to weaken acceptance criteria, delete or disable failing tests, bypass checks, or relabel failure as success to pass a gate. Legitimate test changes need a recorded justification and review proportional to impact. | MVP |
| AUT-10 | Repair loops must be bounded and must escalate with the smallest useful reproducer and a diagnostic summary. | MVP |
| AUT-11 | The normal unattended endpoint is a reviewable change plus an evidence package. Merge, publish and deploy need separate authorization in the contract and in organizational policy. | MVP |
| AUT-12 | Every run state in the [state list](contracts-and-state.md#run-state-machine) must be visible offline, and cancellation and resumption must be safe at any point. | MVP |
| AUT-13 | When a contract enables the mutation gate, test strength on changed lines must be measured with a mutant set generated mechanically, without a model. Each mutant must be killed or accepted as equivalent by the user before `ready_for_review`. Model-proposed mutants may add to the set but never replace it ([ADR-007](decisions/ADR-007-mutation-gate.md)). | MVP |
| AUT-14 | A hardening work item may add or strengthen tests only. Its contract must make every non-test path read-only, and no test may be edited to pass under a mutation. | MVP |
| AUT-15 | An unattended run may span several repositories of one project group only when each has an active project record. Each repository gets its own worktree, contract scope, gates and change request, and the run reaches `ready_for_review` only when every repository's gates pass. | Later |
| AUT-16 | After every work item, the required checks must run on the run worktree. A check that newly fails is charged to that item and goes to repair, then to a decision. A contract may turn this off only with a recorded reason. | MVP |
| AUT-17 | Gate G2 must compare each item's symbol diff from the code graph with its specification. A new import outside the repository's declared dependencies, or a new or changed public symbol outside the specification, is a finding that goes to repair, then to a decision. | MVP |

### Codebase onboarding

The onboarding lifecycle, ownership matrix and project profile are defined in [repository-onboarding.md](repository-onboarding.md).

| ID | Requirement | Scope |
|---|---|---|
| ONB-1 | Onboarding must follow the persisted, resumable lifecycle in [repository-onboarding.md](repository-onboarding.md#onboarding-lifecycle). Every transition must be recorded before the side effect that depends on it begins. | MVP |
| ONB-2 | GSD must own semantic and planning onboarding: codebase mapping, architecture and convention discovery, requirements, roadmap and its planning artifacts. AVARICE must not create a competing architecture index, conventions store, requirements store or roadmap; it stores only operational metadata and references to GSD artifacts. AVARICE's deterministic draft of an architecture model stays a proposal inside the onboarding staging location until approved. A repository-owned architecture model that the user approves (FR-25) is repository content, and AVARICE stores only its path, digest and check results. | MVP |
| ONB-3 | During discovery and mapping, source code and existing project configuration must be read-only on every exposed mutation path. Generated onboarding artifacts may be written only to the approved staging location. | MVP |
| ONB-4 | Passive onboarding must not execute repository commands, install dependencies, run lifecycle scripts, start services, run migrations or reach production resources. Reading a script never authorizes running it. | MVP |
| ONB-5 | Committing generated artifacts must be disabled unless the onboarding contract or policy separately authorizes it. | MVP |
| ONB-6 | Existing GSD artifacts, existing AVARICE profiles, user edits to planning files and uncommitted source changes must never be silently overwritten. Provenance and source revision are reconciled first, and the outcome is adoption, refresh, migration, isolated regeneration or a recorded decision. | MVP |
| ONB-7 | Every accepted GSD artifact must be recorded with its source revision, mapping scope, mapping mode and completeness. A fast or path-scoped map must be labeled partial and must not be presented as whole-repository coverage. | MVP |
| ONB-8 | Mapping must run under an onboarding contract with path scope, file and byte limits where supported, wall-clock, tool-call, invocation and cost budgets, subagent limits and retry limits. Budgets persist across retries and restarts. | MVP |
| ONB-9 | Activation must produce a versioned project profile that references GSD artifacts and records operational policy. Repository instructions and GSD output may propose profile values but cannot grant permissions; activation validates the profile against higher-priority policy. | MVP |
| ONB-10 | Discovered setup, build, lint and test commands must stay inactive until a separate active-validation stage classifies and runs each one in an isolated, sandboxed workspace. Unexpected writes or network access fail validation. | MVP (declared check commands), Later (setup and run commands) |
| ONB-11 | Refresh must use revisions, changed paths and structural signals to choose between incremental refresh, path-scoped remapping and full remapping, and must not rescan the whole repository when the verified GSD version supports a narrower refresh. | Contract |
| ONB-12 | A missing enforcement layer, an incompatible GSD version or malformed artifacts must move onboarding to a blocking or restricted state, never to unrestricted execution. | MVP |
| ONB-13 | Onboarding must offer an index stage that builds GSD intel and the GSD-managed graph in the staging worktree under the onboarding contract, and must record each index's build commit and freshness in the project record. A failed index build must leave the record without that index, never block activation. | MVP |
| ONB-14 | Onboarding must offer a knowledge pass that adds document nodes to the graph for stable project documents: the codebase map, `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` and the repository documents the contract lists. It must run as one contained invocation under the onboarding contract. Every document node must cite its source path and revision and be recorded as model-inferred. Its text is data and never grants authority (FR-14). | MVP |
| ONB-15 | Refresh must re-extract only changed documents for the knowledge pass, and must add GSD phase files (`.planning/phases/**`, `STATE.md`) once incremental refresh exists. | MVP |

## Non-functional requirements

### Portability

| ID | Requirement | Scope |
|---|---|---|
| NFR-1 | Baseline operation on one Mac must not need a NAS, cloud account, container runtime, Kubernetes, Redis or an always-on database server. | MVP |
| NFR-2 | Local orchestration (status, resume planning, verification, checkpoints, evidence) must work without network access. [deployment-and-portability.md](deployment-and-portability.md#offline-matrix) lists exactly what remains usable. | MVP |
| NFR-3 | Domain workflow code must not contain provider identifiers, URLs, absolute paths, SQL dialect or agent-vendor APIs. A lint check enforces the import boundary. | MVP |
| NFR-4 | Moving artifact storage or execution to another host must need only configuration, explicit data migration, and possibly a new adapter. Domain workflow code must not change. | Contract (proved with a fake remote adapter), Later (real) |
| NFR-5 | SQLite databases must live on local storage and must never be placed on a network filesystem. | MVP |

### Reliability

| ID | Requirement | Scope |
|---|---|---|
| NFR-6 | After a process crash, sleep, or kill at any point, the next command must detect interrupted work and present a consistent state. That state can be "paused, needs reconciliation"; it must never silently be "done". | MVP |
| NFR-7 | Every external side effect must carry an idempotency or correlation key. An ambiguous timeout must trigger reconciliation (look up by key) before any retry. | Contract |
| NFR-8 | Every critical operation must have a defined timeout, cancellation behavior and retry eligibility ([operations-and-testing.md](operations-and-testing.md#operation-budgets)). | MVP |
| NFR-9 | Schema changes must be versioned, forward-only and tested against fixtures. An interrupted migration must leave either the old or the new schema, never a mix. | MVP |

### Security and isolation

| ID | Requirement | Scope |
|---|---|---|
| SEC-1 | Profiles (`personal-local`, `personal-extended`, `enterprise-<org>`) must have separate configuration, credential references, caches, logs, indexes, databases and artifacts. There must be no automatic fallback across profiles. | MVP |
| SEC-2 | Credentials must be resolved by reference at the moment of use, from an approved provider ([ADR-009](decisions/ADR-009-credential-broker.md)). An environment variable is not a provider. Tokens must never be written to prompts, state, evidence, artifacts or logs. | MVP |
| SEC-3 | Events and logs must pass through a redactor before persistence. Full tool payloads must not be retained by default. | MVP |
| SEC-4 | Enterprise policy must outrank repository and user settings. A repository file must not be able to loosen an organization rule. | MVP (model), Onboarding (sources) |
| SEC-5 | AVARICE must never disable TLS verification, weaken authentication, create an alternate egress path, or substitute an unapproved service to make an adapter work. | MVP |
| SEC-6 | Every control must be documented with its enforcer (host, external platform or AVARICE) and its bypass limitations. | MVP |
| SEC-7 | Employer-specific configuration and data must stay outside the personal framework distribution and repository. | MVP |
| SEC-8 | Every credential resolution attempt must be recorded as an event with the reference, purpose, calling module, profile, run and invocation IDs, outcome and duration. The event must never contain the value, its length or a digest of it. | MVP |

### Operability

| ID | Requirement | Scope |
|---|---|---|
| OPS-1 | A `doctor` command must report configuration, versions, capabilities and dependency health without revealing secrets, and must work offline. | MVP |
| OPS-2 | Structured events must carry the correlation IDs in [contracts-and-state.md](contracts-and-state.md#correlation-identifiers). | MVP |
| OPS-3 | AVARICE must provide backup, restore, export, import and uninstall commands with documented behavior. | MVP (backup, export, uninstall), Later (restore across hosts) |
| OPS-4 | Retention limits must apply to events, evidence payloads and artifacts, configurable per profile. | MVP |
| OPS-5 | The resource bounds (concurrency, context budget, artifact quota, queue length) must be configurable and enforced, with defined degradation when a bound is reached. | MVP |
| OPS-6 | Upgrading GSD, the agent host or AVARICE must be detectable by `doctor`. Incompatible versions must fail with an actionable message, not partial behavior. | MVP |

## Measurable acceptance criteria

The targets below are proposals. None has been measured; [operations-and-testing.md](operations-and-testing.md#baseline-targets) defines how the latency and size targets are measured; the scenario or suite named in each slice of the [implementation plan](implementation-plan.md) measures the rest, for example S-56 for AC-15.

| ID | Criterion | Proposed target |
|---|---|---|
| AC-1 | Time from `install` to a first successful `status` on a fresh Mac with Node already present | under 10 minutes, no admin rights |
| AC-2 | `status` latency with 1,000 runs in the store, warm cache | p95 under 300 ms |
| AC-3 | Recovery after a forced kill during verification: the next `resume` identifies the interrupted attempt and offers re-verification | 100% of fault-injection cases in the recovery suite |
| AC-4 | Duplicate privileged action after an injected ambiguous timeout | 0 duplicates in the reconciliation suite |
| AC-5 | Secret patterns found in events, evidence or artifacts after the redaction suite | 0 |
| AC-6 | Cross-profile reads in the isolation suite | 0 |
| AC-7 | Domain-code changes needed to run the portability proof against the fake remote adapter | 0 lines |
| AC-8 | Context retrieval quality on the evaluation set | task success rate with the context pack, index adapters present, at least equal to a full-repo baseline at no more than 50% of its tokens |
| AC-9 | Routine low-risk tasks in the benchmark that reach `ready_for_review` with no phase-transition prompt | at least 70%, with defect rate no worse than attended runs of the same tasks |
| AC-10 | Unnecessary escalations (a reviewer judges the answer was available in code, docs or an authorized default) | under 15% of escalations |
| AC-11 | Containment failures (a write, read, command or endpoint outside the contract that succeeded on a path listed as prevented) | 0 in the containment suite and in benchmark runs |
| AC-12 | Budget overruns beyond the declared tolerance of each budget | 0 for hard budgets; reported per run for estimated budgets |
| AC-13 | Mechanical mutants on changed lines killed in benchmark runs with the mutation gate on | at least 90% killed or accepted as equivalent; 0 `NO-RUN` verdicts scored as survivors |
| AC-14 | Brownfield benchmark repositories (5, varied stacks) that reach an active profile with no source change and no unapproved write outside the staging location | 5 of 5; 0 containment failures |
| AC-15 | `avarice dashboard` render time with 1,000 runs in the store | under 2 seconds |

The benchmark workload and the interruption, waiting-time and rework metrics are defined in [autonomy-and-decisions.md](autonomy-and-decisions.md#measuring-autonomy).

The acceptance scenarios in Given/When/Then form live in [operations-and-testing.md](operations-and-testing.md#acceptance-scenarios).

## Assumptions

Each assumption is provisional. The right-hand column names what would settle it.

| ID | Assumption | Settled by |
|---|---|---|
| A-1 | Claude Code is the primary agent host. Other hosts that GSD supports are secondary. | Confirmed by the user 2026-11-01 |
| A-2 | GSD 1.17.0 is the baseline version. GSD updates are taken deliberately, not automatically. | Confirmed by the user 2026-11-01; GSD release cadence |
| A-3 | GitHub (github.com) is the personal SCM and CI. `gh` 2.100.0 is installed. | User confirmation |
| A-4 | Personal tasks start as manual briefs. No personal tracker integration is needed for the MVP. | User confirmation |
| A-5 | The future NAS can run a small long-lived process (container or native) and is reachable over a private network or VPN. | NAS model and OS |
| A-6 | The employer's tracker, SCM, CI, identity provider, approved models and audit sink are unknown. | Enterprise onboarding questionnaire |
| A-7 | Node.js 22.22.3 or newer is acceptable as the only runtime dependency, because GSD already requires Node. | [ADR-001](decisions/ADR-001-language-and-runtime.md) revisit trigger |
| A-8 | Unattended runs execute on the Mac while it is awake and on power. A sleeping Mac stops computing; continuing during sleep needs the later remote worker. | User confirmation |
| A-9 | Model usage is billed per token through the host, and the host reports usage only at the end of each headless invocation, so per-invocation limits are the enforceable budget unit. | Host research in [containment.md](containment.md#budgets-and-usage-visibility) |
| A-10 | Onboarding targets one Git repository at a time on local storage; monorepos are handled by path scope inside that repository. | Survey of the user's own repositories |
