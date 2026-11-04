# Requirements: AVARICE

**Defined:** 2026-11-01
**Core Value:** Set a goal and the operating boundaries, leave the desk, and come back to a verified, reviewable change or to a short list of genuine blocking decisions, with containment and evidence that do not depend on the model behaving.

Source: `docs/requirements.md` (PRD, precedence 1). IDs are the PRD's own (the ingest intel prefixes them `REQ-`). Text is condensed from the PRD; the PRD wording governs. Scope labels in brackets are the PRD's (MVP, Contract, Later, Onboarding). The PRD states no per-requirement acceptance criteria; the measurable targets are AC-1..AC-15 below. All requirements are proposals; nothing is built.

**Attribution rule.** Each requirement maps to exactly one phase: the last phase among the MVP phases (0-4) whose slice lists it, that is, the phase that completes its MVP scope. Earlier phases record partial coverage in "Partial and extension coverage". Post-MVP phases (5-7) extend an owned requirement and never take it over.

## v1 Requirements

Committed scope; each maps to a roadmap phase (see Traceability). Phases 1-3 are the first milestone (v1.0).

### Workflow (FR-1 to FR-11)

- [ ] **FR-1** [MVP]: A run starts from a manual brief (Markdown text or file) or a typed external task reference; a manual brief is sufficient on its own.
- [ ] **FR-2** [MVP]: A run follows the explicit run state machine; every transition is persisted before the side effect that depends on it begins.
- [ ] **FR-3** [MVP]: Context assembly produces a bounded, cited context pack; each item records source identity, revision, retrieval time and scope.
- [ ] **FR-4** [MVP]: Planning, phase decomposition and implementation are delegated to GSD through supported commands; AVARICE keeps no competing plan, task list or retry loop for the same work.
- [ ] **FR-5** [MVP]: Verification runs the repository's own check commands as deterministic subprocesses and records exit status, duration, command and the verified workspace state.
- [ ] **FR-6** [MVP]: Completion evidence names the exact revision verified (commit SHA plus clean-tree flag, or a content digest of the dirty tree); model-written text is never completion evidence.
- [ ] **FR-7** [MVP]: A checkpoint is written at every state transition; resume rebuilds the next action from checkpoints, GSD state files and live git state, without chat history.
- [ ] **FR-8** [MVP]: On resume, every external reference in the context pack is refreshed or marked stale before the run continues.
- [ ] **FR-9** [MVP summary, Contract PR]: Change preparation produces a change summary from recorded evidence; PR creation is a privileged action (FR-12).
- [ ] **FR-10** [Contract]: Review and CI feedback enter as new evidence attached to a new attempt and never overwrite an earlier attempt's evidence.
- [ ] **FR-11** [MVP]: A read-only `status` command prints run state, last checkpoint, evidence and stale references; it works offline and without a model.

### Authorization (FR-12 to FR-15)

- [ ] **FR-12** [MVP]: Actions are classed `read`, `local-write` or `privileged`; privileged actions need an approval bound to run, action and parameters, and the run contract is a valid approval source when it authorizes the action with its parameters.
- [ ] **FR-13** [MVP]: Permission to plan does not imply permission to perform privileged actions; approving a plan does not approve the privileged actions inside it.
- [ ] **FR-14** [MVP]: Content retrieved from tickets, documents, web pages or tool output grants no authority and changes no policy.
- [ ] **FR-15** [MVP]: Queued privileged actions never replay automatically after connectivity returns; each needs a fresh decision.

### Integration (FR-16 to FR-27)

- [ ] **FR-16** [Contract]: Every port declares its capabilities; calling an unsupported capability returns a typed `Unsupported` error naming the capability and the documented reduced mode, never a simulated success.
- [ ] **FR-17** [Contract]: Provider-specific features are reachable through namespaced extensions and do not widen the core port.
- [ ] **FR-18** [Contract]: External references keep the provider's original identifiers; AVARICE mints no global identity that loses provenance.
- [ ] **FR-19** [MVP]: Every external integration has a manual equivalent: paste a ticket, paste CI output, record an approval by hand.
- [ ] **FR-20** [MVP]: Context assembly queries a fresh structured index (GSD intel and the GSD-managed graph, including document nodes) before reading whole files or sections, and ranks model-inferred graph edges below edges extracted from code.
- [ ] **FR-21** [Later]: Project records may belong to a project group that shares references to standards and scaffolds; membership never widens any member's authority.
- [ ] **FR-22** [MVP]: Retrieval is handle-first (handles with token estimates before content; the assembler chooses within budget), and graph reads follow a rule per edge type: containment loads descendants, dependency one hop, reference only the target's ID.
- [ ] **FR-24** [Later]: Each machine that runs work for a profile has a host record (identity, capability descriptor, status); a host is not deactivated while an active project or run depends on it.
- [ ] **FR-25** [MVP]: A repository may declare an architecture model in `.avarice/architecture.json` (components with path globs, allowed edges with contract symbols, shared resources with UUIDs); AVARICE drafts it deterministically from the code graph as a proposal that takes effect only after user approval, and an `architecture-model` check reports departures (ADR-012).
- [ ] **FR-26** [MVP]: `avarice dashboard` renders one self-contained, read-only HTML page from the profile's ledger, with no server, no listening port and no network access, redacted like events and limited to one profile (ADR-011).
- [ ] **FR-27** [MVP]: `avarice` with no arguments, when standard input and standard output are both terminals, opens an interactive shell that shows the profile's runs, onboardings, open decisions and live progress and runs every command in-process with the one-shot checks; otherwise, or under `AVARICE_RUN`, it prints usage and exits 64; no daemon, listening port or runtime dependency (ADR-013).

### Run contract (RC-1 to RC-8)

- [ ] **RC-1** [MVP]: Every run executes under a durable, versioned run contract stating intended behavior, acceptance criteria, exclusions, requirement references, workspace, readable, writable and protected paths, creation and deletion rules, permitted commands, tools and endpoints, delegated decision classes, budgets, required evidence, escalation rules and notification preferences.
- [ ] **RC-2** [MVP]: A contract is assembled from a reusable policy preset, repository conventions and the brief; `avarice start --brief <file> --policy <preset>` is sufficient for a routine task.
- [ ] **RC-3** [MVP]: The user's authorization comes from the brief, the selected preset or an explicit instruction; AVARICE adds no confirmation step for authority already granted.
- [ ] **RC-4** [MVP]: Within the contract, routine actions and phase transitions proceed without human prompts.
- [ ] **RC-5** [MVP]: The agent, its subagents and any process the run starts cannot expand the contract's scope, change policy, raise a budget or obtain credentials; only the user (personal) or the authorizer named by policy (enterprise) can amend a contract, through an interactive AVARICE command outside the governed run.
- [ ] **RC-6** [MVP]: A contract amendment is recorded as a new contract version with authorizer, reason and diff; evidence collected under an earlier version is invalidated when the amendment changes acceptance criteria, writable scope, required checks or the policy revision.
- [ ] **RC-7** [MVP]: Each work item carries a size (`small`, `medium`, `large`) and a specification (files it may change, public symbols it adds or changes, configuration keys it touches, documents it cites); when the brief omits them the compiler derives them from the brief, the indexes and the GSD plan and records which were derived.
- [ ] **RC-8** [MVP]: The model for each work item's invocation comes from its size through the preset's size-to-model map, unless the contract overrides it for that item.

### Containment (CON-1 to CON-16)

- [x] **CON-1** [MVP]: Each contract restriction names its enforcement point, covered execution paths, known bypasses, failure behavior and the test that proves it; prevention, detection and recovery are labeled separately.
- [x] **CON-2** [MVP]: Writes outside the contract's writable paths are prevented on every mutation path the run can reach (editing tools, shell and child processes, interpreters, subagents) or that path is unavailable; a post-run diff check is detection only.
- [x] **CON-3** [MVP]: Required enforcement fails closed: missing configuration, invalid policy, enforcement timeout or crash blocks the protected operation.
- [ ] **CON-4** [MVP]: A host or environment without required enforcement runs in explicit restricted mode (read-only analysis and planning, no writes outside a disposable copy, no network) and never falls back to instructions or unrestricted execution.
- [x] **CON-5** [MVP]: Shell-command pattern matching is not the only containment for arbitrary executable code.
- [x] **CON-6** [MVP]: The run cannot modify enforcement configuration, hook implementations, permission settings, credential configuration, policy files or the budget ledger.
- [ ] **CON-7** [MVP]: Edits are preceded by reading the target and check a precondition (content digest or revision) so stale edits fail; pre-existing user changes in the workspace are preserved through failed work and recovery.
- [ ] **CON-8** [MVP]: Paths are canonicalized before evaluation; symlinks and traversal resolving outside writable paths are refused; build and test outputs have declared locations.
- [ ] **CON-9** [MVP]: Recovery never resets or deletes changes the run did not make and never claims external effects were rolled back.
- [ ] **CON-10** [MVP]: Retrieval is progressive (index, scoped search, bounded snippets, justified full reads); broad discovery must be authorized by the contract.
- [ ] **CON-11** [MVP local, Contract remote]: Retrieval adapters enforce scope filters, field selection, page and result caps, returned bytes, query timeouts, cancellation and cumulative budgets; backend cost is bounded separately from returned size.
- [ ] **CON-12** [MVP]: Caches record source version, freshness and access scope and are not reused after access is revoked or across profiles.
- [x] **CON-13** [MVP]: Budget accounting persists across restarts, is shared by subagents and retries, uses atomic reservation where work runs concurrently, and states where usage reporting is delayed or absent while using conservative limits.
- [ ] **CON-14** [MVP]: Loops stop: repeated denials, ineffective searches and repeated repair attempts each have a limit that ends in a checkpoint and an escalation.
- [ ] **CON-15** [MVP]: Subagents and delegated work receive equal or narrower authority than their parent and draw from the parent's budget.
- [ ] **CON-16** [MVP]: A crashed or timed-out invocation that left no side effect outside the machine is discarded before any retry by resetting the run worktree to the commit recorded at the work item's last checkpoint, limited to commits and files the run created after it (CON-9).

### Autonomy and human involvement (AUT-1 to AUT-17)

- [ ] **AUT-1** [MVP]: Human involvement is triggered by decision significance (consequence, reversibility, authority, evidence), never by the end of a stage alone and never by model confidence alone.
- [ ] **AUT-2** [MVP]: A needed human decision is persisted as a decision record with issue, evidence, options, recommendation, consequences, affected dependencies and any authorized default.
- [ ] **AUT-3** [MVP]: While a consequential decision is open the run continues independent authorized work and does not implement dependent work; with none left it checkpoints and enters a visible blocked state without polling.
- [ ] **AUT-4** [MVP]: Deadlines, silence and notification failure never count as approval.
- [ ] **AUT-5** [MVP]: A decision response is validated for identity, scope, applicability to current state and duplication before it is applied; relevant tickets, code, policy and credentials are refreshed before work resumes.
- [ ] **AUT-6** [MVP local, Later push adapters]: Notifications go only to destinations the user configured; a failed delivery leaves the decision pending and visible locally; scheduled check-ins use software scheduling, not a waiting model.
- [ ] **AUT-7** [MVP]: Phase transitions are decided by machine-checkable entry and exit conditions with persisted evidence, never by an agent summary alone.
- [ ] **AUT-8** [MVP]: Acceptance criteria map to verification; check results distinguish passed, failed, skipped, unavailable and inconclusive and are tied to the revision and environment tested.
- [ ] **AUT-9** [MVP]: The run cannot weaken acceptance criteria, delete or disable failing tests, bypass checks or relabel failure as success to pass a gate; legitimate test changes need a recorded justification and proportional review.
- [ ] **AUT-10** [MVP]: Repair loops are bounded and escalate with the smallest useful reproducer and a diagnostic summary.
- [ ] **AUT-11** [MVP]: The normal unattended endpoint is a reviewable change plus an evidence package; merge, publish and deploy need separate authorization in the contract and in organizational policy.
- [ ] **AUT-12** [MVP]: Every run state is visible offline, and cancellation and resumption are safe at any point.
- [ ] **AUT-13** [MVP]: When a contract enables the mutation gate, test strength on changed lines is measured with a mechanically generated, model-free mutant set; each mutant is killed or accepted as equivalent by the user before `ready_for_review`; model-proposed mutants may add to the set but never replace it (ADR-007).
- [ ] **AUT-14** [MVP]: A hardening work item may add or strengthen tests only; its contract makes every non-test path read-only, and no test is edited to pass under a mutation.
- [ ] **AUT-15** [Later]: An unattended run may span several repositories of one project group only when each has an active project record; each repository gets its own worktree, contract scope, gates and change request, and the run reaches `ready_for_review` only when every repository's gates pass.
- [ ] **AUT-16** [MVP]: After every work item the required checks run on the run worktree; a newly failing check is charged to that item and goes to repair, then to a decision; a contract may turn this off only with a recorded reason.
- [ ] **AUT-17** [MVP]: Gate G2 compares each item's symbol diff from the code graph with its specification; a new import outside the repository's declared dependencies, or a new or changed public symbol outside the specification, is a finding that goes to repair, then to a decision.

### Codebase onboarding (ONB-1 to ONB-15)

- [x] **ONB-1** [MVP]: Onboarding follows the persisted, resumable lifecycle; every transition is recorded before the side effect that depends on it begins.
- [ ] **ONB-2** [MVP]: GSD owns semantic and planning onboarding (mapping, architecture and convention discovery, requirements, roadmap); AVARICE creates no competing index, conventions store, requirements store or roadmap and stores only operational metadata and references; its deterministic architecture-model draft stays a proposal in staging until approved, after which AVARICE stores only the model's path, digest and check results (ADR-012).
- [x] **ONB-3** [MVP]: During discovery and mapping, source code and existing project configuration are read-only on every exposed mutation path; generated artifacts are written only to the approved staging location.
- [ ] **ONB-4** [MVP]: Passive onboarding does not execute repository commands, install dependencies, run lifecycle scripts, start services, run migrations or reach production resources; reading a script never authorizes running it.
- [ ] **ONB-5** [MVP]: Committing generated artifacts is disabled unless the onboarding contract or policy separately authorizes it.
- [ ] **ONB-6** [MVP]: Existing GSD artifacts, existing AVARICE profiles, user edits to planning files and uncommitted source changes are never silently overwritten; provenance and source revision are reconciled first, and the outcome is adoption, refresh, migration, isolated regeneration or a recorded decision.
- [ ] **ONB-7** [MVP]: Every accepted GSD artifact is recorded with source revision, mapping scope, mapping mode and completeness; a fast or path-scoped map is labeled partial and never presented as whole-repository coverage.
- [ ] **ONB-8** [MVP]: Mapping runs under an onboarding contract with path scope, file and byte limits where supported, wall-clock, tool-call, invocation and cost budgets, subagent limits and retry limits; budgets persist across retries and restarts.
- [ ] **ONB-9** [MVP]: Activation produces a versioned project profile referencing GSD artifacts and recording operational policy; repository instructions and GSD output may propose profile values but cannot grant permissions, and activation validates the profile against higher-priority policy.
- [ ] **ONB-10** [MVP declared check commands, Later setup and run commands]: Discovered setup, build, lint and test commands stay inactive until a separate active-validation stage classifies and runs each in an isolated, sandboxed workspace; unexpected writes or network access fail validation.
- [ ] **ONB-11** [Contract]: Refresh uses revisions, changed paths and structural signals to choose between incremental refresh, path-scoped remapping and full remapping, and does not rescan the whole repository when the verified GSD version supports a narrower refresh.
- [ ] **ONB-12** [MVP]: A missing enforcement layer, an incompatible GSD version or malformed artifacts move onboarding to a blocking or restricted state, never to unrestricted execution.
- [ ] **ONB-13** [MVP]: Onboarding offers an index stage that builds GSD intel and the GSD-managed graph in the staging worktree under the onboarding contract and records each index's build commit and freshness; a failed index build leaves the record without that index and never blocks activation.
- [ ] **ONB-14** [MVP]: Onboarding offers a knowledge pass that adds model-inferred document nodes (citing source path and revision) for stable project documents, as one contained invocation under the onboarding contract; the text is data and never grants authority (FR-14).
- [ ] **ONB-15** [MVP]: Refresh re-extracts only changed documents for the knowledge pass and adds GSD phase files (`.planning/phases/**`, `STATE.md`) once incremental refresh exists.

### Portability and reliability (NFR-1 to NFR-9)

- [x] **NFR-1** [MVP]: Baseline operation on one Mac needs no NAS, cloud account, container runtime, Kubernetes, Redis or always-on database server.
- [ ] **NFR-2** [MVP]: Local orchestration (status, resume planning, verification, checkpoints, evidence) works without network access.
- [x] **NFR-3** [MVP]: Domain workflow code contains no provider identifiers, URLs, absolute paths, SQL dialect or agent-vendor APIs; a lint check enforces the import boundary.
- [ ] **NFR-4** [Contract proved with a fake remote adapter, Later real]: Moving artifact storage or execution to another host needs only configuration, explicit data migration and possibly a new adapter; domain workflow code does not change.
- [x] **NFR-5** [MVP]: SQLite databases live on local storage and are never placed on a network filesystem.
- [x] **NFR-6** [MVP]: After a process crash, sleep or kill at any point, the next command detects interrupted work and presents a consistent state ("paused, needs reconciliation" is allowed); it never silently shows "done".
- [ ] **NFR-7** [Contract]: Every external side effect carries an idempotency or correlation key; an ambiguous timeout triggers reconciliation (lookup by key) before any retry.
- [ ] **NFR-8** [MVP]: Every critical operation has a defined timeout, cancellation behavior and retry eligibility.
- [x] **NFR-9** [MVP]: Schema changes are versioned, forward-only and tested against fixtures; an interrupted migration leaves the old or the new schema, never a mix.

### Security and isolation (SEC-1 to SEC-8)

- [ ] **SEC-1** [MVP]: Profiles (`personal-local`, `personal-extended`, `enterprise-<org>`) have separate configuration, credential references, caches, logs, indexes, databases and artifacts, with no automatic fallback across profiles.
- [ ] **SEC-2** [MVP]: Credentials are resolved by reference at the moment of use from an approved provider (ADR-009); an environment variable is not a provider; tokens are never written to prompts, state, evidence, artifacts or logs.
- [ ] **SEC-3** [MVP]: Events and logs pass through a redactor before persistence; full tool payloads are not retained by default.
- [ ] **SEC-4** [MVP model, Onboarding sources]: Enterprise policy outranks repository and user settings; a repository file cannot loosen an organization rule.
- [ ] **SEC-5** [MVP]: AVARICE never disables TLS verification, weakens authentication, creates an alternate egress path or substitutes an unapproved service to make an adapter work.
- [ ] **SEC-6** [MVP]: Every control is documented with its enforcer (host, external platform or AVARICE) and its bypass limitations.
- [ ] **SEC-7** [MVP]: Employer-specific configuration and data stay outside the personal framework distribution and repository.
- [ ] **SEC-8** [MVP]: Every credential resolution attempt is recorded as an event with reference, purpose, calling module, profile, run and invocation IDs, outcome and duration, and never the value, its length or a digest of it.

### Operability (OPS-1 to OPS-7)

- [ ] **OPS-1** [MVP]: A `doctor` command reports configuration, versions, capabilities and dependency health without revealing secrets and works offline.
- [ ] **OPS-2** [MVP]: Structured events carry the correlation IDs defined in the contracts specification.
- [ ] **OPS-3** [MVP backup, export, uninstall; Later restore across hosts]: AVARICE provides backup, restore, export, import and uninstall commands with documented behavior.
- [ ] **OPS-4** [MVP]: Retention limits apply to events, evidence payloads and artifacts, configurable per profile.
- [ ] **OPS-5** [MVP]: Resource bounds (concurrency, context budget, artifact quota, queue length) are configurable and enforced, with defined degradation when a bound is reached.
- [ ] **OPS-6** [MVP]: Upgrading GSD, the agent host or AVARICE is detectable by `doctor`; incompatible versions fail with an actionable message, not partial behavior.
- [ ] **OPS-7** [MVP]: Human-readable output follows the one style in the extensions specification, shared by the one-shot commands and the shell; `--json` output does not depend on it.

## v2 Requirements (Deferred)

Acknowledged and unscheduled; not in the current roadmap.

- **FR-23** [Later]: A review-only reconciliation compares the codebase map and the documents listed for the knowledge pass with the code, cites evidence for every finding, and never edits documents or code. Unscheduled in the implementation plan (extension catalog entry 13); schedule only on a measured need.

## Use Cases (context; not counted in coverage)

Delivered across phases by the requirements above. The phase column is roadmapper-derived: first end-to-end availability, with the completing phase in parentheses where it differs.

| ID | Use case | Delivered by |
|----|----------|--------------|
| UC-1 | Start from a manual brief or task reference; get a bounded plan grounded in retrieved context | Phase 2 (Phase 4) |
| UC-2 | Implement through the agent host and GSD, then run the repository's own checks | Phase 2 |
| UC-3 | Stop at any point and resume with an accurate picture of what was verified | Phase 2 |
| UC-4 | Prepare a reviewable change and fold review or CI feedback into a new attempt | Phase 5 |
| UC-5 | Ask "what state is this work in, and what proves it?" without the model online | Phase 2 |
| UC-6 | Later, move artifact bytes or command execution to a NAS or homelab without rewriting workflows | Phase 4 proof (Phase 7 real) |
| UC-7 | Use the same workflow at an employer under its identity, tracker, SCM, CI and policy | Phase 4 (enterprise adapters not planned) |
| UC-8 | Set the goal and boundaries, leave the desk, return to a verified change or blocking decisions | Phase 3 |
| UC-9 | Bring an existing repository under AVARICE with GSD learning and planning for it | Phase 1 |

## Acceptance Criteria (PRD AC-1 to AC-15)

The success metric. Targets are the PRD's; "Measured in" follows the implementation plan's verification lists.

| AC | Target | Measured in |
|----|--------|-------------|
| AC-1 | Install to first successful `status` on a fresh Mac with Node present: under 10 minutes, no admin rights | Phase 1 |
| AC-2 | `status` with 1,000 runs, warm cache: p95 under 300 ms | Phase 4 |
| AC-3 | Forced kill during verification: next `resume` identifies the interrupted attempt in 100% of recovery-suite fault-injection cases | Phase 2 |
| AC-4 | Duplicate privileged action after an injected ambiguous timeout: 0 in the reconciliation suite | Phase 5 |
| AC-5 | Secret patterns in events, evidence or artifacts after the redaction suite: 0 | Phase 4 |
| AC-6 | Cross-profile reads in the isolation suite: 0 | Phase 4 |
| AC-7 | Domain-code changes needed for the portability proof against the fake remote adapter: 0 lines | Phase 4 |
| AC-8 | Retrieval quality: task success with the context pack and index adapters at least equal to a full-repo baseline at no more than 50% of its tokens | Phase 4 |
| AC-9 | Routine low-risk benchmark tasks reaching `ready_for_review` with no phase-transition prompt: at least 70%, defect rate no worse than attended runs | Phase 5 (subset: 16 R1, 8 R2) |
| AC-10 | Unnecessary escalations: under 15% of escalations | Phase 6 (full 40-task benchmark) |
| AC-11 | Containment failures in the containment suite and benchmark runs: 0 | Containment suites from Phase 1; full benchmark Phase 6 |
| AC-12 | Budget overruns beyond declared tolerance: 0 for hard budgets; reported per run for estimated budgets | Phase 5 (subset) |
| AC-13 | Mechanical mutants on changed lines killed or accepted as equivalent: at least 90%; 0 `NO-RUN` scored as survivors | Phase 5 (subset) |
| AC-14 | Brownfield benchmark repositories reaching an active profile with no source change and no unapproved write outside staging: 5 of 5, 0 containment failures | Phase 4 |
| AC-15 | `avarice dashboard` render with 1,000 runs: under 2 seconds | Phase 5 |

## Out of Scope

| Feature | Reason |
|---------|--------|
| Replacing GSD planning, phase execution or verification (NG-1) | AVARICE supplies services around GSD (ADR-002) |
| Plugin marketplace, distributed scheduler, universal provider abstraction (NG-2) | No measured need |
| A dashboard that needs a server or listening port in the MVP (NG-3) | The static dashboard (FR-26) is in scope |
| Exactly-once execution across external systems (NG-4) | At-most-once initiation plus reconciliation by key |
| Defending against a user who controls the whole machine (NG-5) | Controls guard against agent mistakes and injected instructions |
| Zero human intervention or guaranteed correctness of unattended results (NG-6) | Runs end in a reviewable change or explicit decisions |
| Exact hard cost cap where the host reports usage late (NG-7) | Conservative request, context and tool-call limits |
| Unattended merge, publish or deploy (NG-8) | Needs separate contract and organizational authorization |
| Replacing or bypassing enterprise identity, tracking, SCM, CI, secrets or release processes (NG-9) | Enterprise systems stay authoritative |
| Cloning the 3dmk service layout (NG-10) | Design inspiration only |
| Enterprise tracker, non-GitHub SCM, audit sink, policy delivery, managed hook packaging, enterprise credential provider | Not planned; decided when an employer is known |

## Traceability

Each v1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FR-1 | Phase 2 | Pending |
| FR-2 | Phase 2 | Pending |
| FR-3 | Phase 4 | Pending |
| FR-4 | Phase 2 | Pending |
| FR-5 | Phase 2 | Pending |
| FR-6 | Phase 2 | Pending |
| FR-7 | Phase 2 | Pending |
| FR-8 | Phase 4 | Pending |
| FR-9 | Phase 5 | Pending |
| FR-10 | Phase 5 | Pending |
| FR-11 | Phase 2 | Pending |
| FR-12 | Phase 4 | Pending |
| FR-13 | Phase 4 | Pending |
| FR-14 | Phase 4 | Pending |
| FR-15 | Phase 4 | Pending |
| FR-16 | Phase 4 | Pending |
| FR-17 | Phase 4 | Pending |
| FR-18 | Phase 4 | Pending |
| FR-19 | Phase 4 | Pending |
| FR-20 | Phase 1 | Gaps Found |
| FR-21 | Phase 8 | Pending |
| FR-22 | Phase 4 | Pending |
| FR-24 | Phase 7 | Pending |
| FR-25 | Phase 5 | Pending |
| FR-26 | Phase 5 | Pending |
| FR-27 | Phase 2 | Pending |
| RC-1 | Phase 2 | Pending |
| RC-2 | Phase 2 | Pending |
| RC-3 | Phase 2 | Pending |
| RC-4 | Phase 2 | Pending |
| RC-5 | Phase 2 | Pending |
| RC-6 | Phase 3 | Pending |
| RC-7 | Phase 3 | Pending |
| RC-8 | Phase 3 | Pending |
| CON-1 | Phase 2 | Complete |
| CON-2 | Phase 2 | Complete |
| CON-3 | Phase 2 | Complete |
| CON-4 | Phase 4 | Pending |
| CON-5 | Phase 2 | Complete |
| CON-6 | Phase 2 | Complete |
| CON-7 | Phase 2 | Pending |
| CON-8 | Phase 2 | Pending |
| CON-9 | Phase 2 | Pending |
| CON-10 | Phase 4 | Pending |
| CON-11 | Phase 4 | Pending |
| CON-12 | Phase 4 | Pending |
| CON-13 | Phase 2 | Complete |
| CON-14 | Phase 2 | Pending |
| CON-15 | Phase 3 | Pending |
| CON-16 | Phase 2 | Pending |
| AUT-1 | Phase 3 | Pending |
| AUT-2 | Phase 3 | Pending |
| AUT-3 | Phase 3 | Pending |
| AUT-4 | Phase 3 | Pending |
| AUT-5 | Phase 3 | Pending |
| AUT-6 | Phase 3 | Pending |
| AUT-7 | Phase 2 | Pending |
| AUT-8 | Phase 2 | Pending |
| AUT-9 | Phase 2 | Pending |
| AUT-10 | Phase 3 | Pending |
| AUT-11 | Phase 5 | Pending |
| AUT-12 | Phase 3 | Pending |
| AUT-13 | Phase 5 | Pending |
| AUT-14 | Phase 5 | Pending |
| AUT-15 | Phase 8 | Pending |
| AUT-16 | Phase 3 | Pending |
| AUT-17 | Phase 5 | Pending |
| ONB-1 | Phase 1 | Complete |
| ONB-2 | Phase 1 | Gaps Found |
| ONB-3 | Phase 1 | Complete |
| ONB-4 | Phase 1 | Gaps Found |
| ONB-5 | Phase 1 | Gaps Found |
| ONB-6 | Phase 4 | Pending |
| ONB-7 | Phase 1 | Gaps Found |
| ONB-8 | Phase 1 | Gaps Found |
| ONB-9 | Phase 1 | Gaps Found |
| ONB-10 | Phase 2 | Pending |
| ONB-11 | Phase 4 | Pending |
| ONB-12 | Phase 1 | Gaps Found |
| ONB-13 | Phase 1 | Gaps Found |
| ONB-14 | Phase 1 | Gaps Found |
| ONB-15 | Phase 4 | Pending |
| NFR-1 | Phase 2 | Complete |
| NFR-2 | Phase 1 | Gaps Found |
| NFR-3 | Phase 2 | Complete |
| NFR-4 | Phase 4 | Pending |
| NFR-5 | Phase 2 | Complete |
| NFR-6 | Phase 2 | Complete |
| NFR-7 | Phase 5 | Pending |
| NFR-8 | Phase 5 | Pending |
| NFR-9 | Phase 2 | Complete |
| SEC-1 | Phase 4 | Pending |
| SEC-2 | Phase 4 | Pending |
| SEC-3 | Phase 4 | Pending |
| SEC-4 | Phase 4 | Pending |
| SEC-5 | Phase 1 | Gaps Found |
| SEC-6 | Phase 4 | Pending |
| SEC-7 | Phase 4 | Pending |
| SEC-8 | Phase 5 | Pending |
| OPS-1 | Phase 4 | Pending |
| OPS-2 | Phase 2 | Pending |
| OPS-3 | Phase 5 | Pending |
| OPS-4 | Phase 5 | Pending |
| OPS-5 | Phase 4 | Pending |
| OPS-6 | Phase 4 | Pending |
| OPS-7 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 106 total (107 normative minus FR-23 deferred)
- Mapped to phases: 106
- Unmapped: 0
- Owned per phase: Phase 1: 14, Phase 2: 35, Phase 3: 13, Phase 4: 28, Phase 5: 13, Phase 6: 0, Phase 7: 1, Phase 8: 2
- Milestone v1.0 (Phases 1-3): 62. Milestone v1.1 (Phases 4-5): 41. Milestone v2.0 (Phases 6-8): 3.

## Partial and extension coverage

An earlier phase delivers part of a requirement that a later phase completes (the later phase owns it), or a later phase extends a requirement owned earlier. Not a second mapping.

| Requirement | Owner | Partial or extension coverage |
|-------------|-------|-------------------------------|
| CON-2, CON-3, CON-5, CON-6, CON-13 | Phase 2 | Phase 1 delivers them for the onboarding contract; Phase 2 completes them for run contracts. CON-13 here covers tool calls, invocations, wall clock and cost cap; Phase 3 CON-15 adds subagent budget sharing |
| NFR-1, NFR-3, NFR-5, NFR-6, NFR-9 | Phase 2 | Phase 1 establishes them for onboarding (package skeleton and lint, ledger schema 1, resume); Phase 2 completes them for runs |
| AUT-2, AUT-12 | Phase 3 | Phase 2 delivers the decision record only and run states and cancellation for one item |
| ONB-6 | Phase 4 | Phase 1 delivers detection and refusal; Phase 4 delivers adoption, migration and refresh flows |
| SEC-2 | Phase 4 | Phase 2 delivers the scrubbed environment and no credentials in the run; Phase 4 completes provider and reference rules |
| FR-3 | Phase 4 | Phase 2 builds context packs from the four MVP adapters; Phase 4 completes bounded, cited packs and retrieval caps |
| FR-4 | Phase 2 | Stage 1 only; Phase 6 extends with the Stage 2 GSD capability |
| AUT-6 | Phase 3 | Local notification only; Phase 6 extends with push adapters (ntfy, Pushover, Telegram) |
| OPS-6 | Phase 4 | `doctor` version detection; Phase 6 extends it to Stage 2 `engines.gsd` gating |
| NFR-4 | Phase 4 | Proved with fake remote adapters; Phase 7 extends with real adapters |
| CON-11 | Phase 4 | Local adapters; remote adapters arrive with Phase 7 |
| ONB-10 | Phase 2 | Declared check commands only; active validation of setup and run commands is Later and unscheduled |
| OPS-3 | Phase 5 | Backup, export, uninstall (and the plan's restore and import on one host); restore across hosts is Later and unscheduled |
| SEC-4 | Phase 4 | Policy model; enterprise policy sources are Onboarding-labeled and not planned |

---
*Requirements defined: 2026-11-01*
*Last updated: 2026-11-01 after initial definition*
