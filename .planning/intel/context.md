# Context intel (from DOC docs and non-ingested README context)

Four DOCs (precedence 5, lowest). Entries are topic-keyed and carry source attribution. The implementation plan is preserved with its slice structure and exit criteria so the roadmapper can use phases 0 to 2 as the first milestone.

## Topic: Implementation plan overview (8 vertical slices, 0 to 7)
- source: /Users/aphan/avarice/docs/implementation-plan.md
- status: proposal; nothing built yet. Implementation itself runs through GSD 1.17.0.
- notes: Slice 0 onboards one existing repository with GSD as mapper, builds GSD's structured indexes, and builds the shared kernel (ledger, contract compiler, sandbox and hook generation, contained host adapter). Slice 1 is already a contained, unattended tool (contract from brief and policy preset, one GSD unit headless in the OS sandbox with fail-closed hooks and budgets; a GSD pause becomes a decision record; checks through evidence gates; resume after a kill). Containment is not deferred to a hardening phase. Each later slice adds one capability and names the complexity it leaves out. Requirement IDs come from requirements.md.
- scope tiers: MVP requirements = slices 0 to 4 (contained repository onboarding, contract, containment, budgets, unattended single and multi-item runs, decisions with local notification, gates and evidence, resume, profiles, restricted mode, `doctor`, delivery to a draft PR, backup, static dashboard, architecture model check). Portability contracts designed now = all ports, capability descriptors, fake-remote adapters, contract suite (slices 0 to 3 interfaces, 3 proof). Later = review-only reconciliation (FR-23, catalog entry 13, unscheduled); GSD capability bridge, plugin, push notifiers (slice 5); NAS artifact adapter, remote worker, coordination service (slice 6); cross-repository runs and project groups (slice 7). Enterprise decisions deferred to onboarding = tracker, SCM other than GitHub, audit sink, policy file delivery, managed hook packaging, credential provider (not planned).

## Topic: Slice 0 - Contained onboarding of one repository (GSD Phase 0)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Slice 0")
- goal: `avarice onboard --policy onboarding` takes one existing local Git repository to an active project record, with GSD as the semantic mapper and GSD intel and graph indexes recorded, source read-only and writes confined to the staging worktree's `.planning/`, `graphify-out/` and `.avarice-knowledge/`.
- requirements: ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-6 (detection and refusal; adoption flows in slice 3), ONB-7, ONB-8, ONB-9, ONB-12, ONB-13, ONB-14, FR-20, CON-2, CON-3, CON-5, CON-6, CON-13, SEC-5, NFR-1, NFR-2, NFR-3, NFR-5, NFR-6, NFR-9
- deliverables: Package skeleton with import-boundary lint; ledger on `node:sqlite` with schema version 1; minimal `init` and registration for one profile; preflight; contract compiler with the `onboarding` preset; staging worktree; generated host settings with sandbox, `dontAsk`, `--setting-sources ""`, scrubbed environment; run hook set with `onFailure: "block"`; contained Claude Code host adapter; `GsdOnboarding` adapter for GSD 1.17.x (`inspect`, `probeState`, `planMapping` for full and fast, `startMapping`, `stamp`, `validateArtifacts`); artifact snapshot; index stage (sandboxed `graphify update .` chain, contained intel refresh, knowledge pass over stable documents merged into the graph, index validation); a first spike confirms (a) the knowledge corpus can be limited to the listed documents, (b) where `/graphify` writes its output, (c) whether `graphify merge-graphs` keeps confidence tiers that GSD's built-in reader can read; `gsd-intel` and `gsd-graph` context adapters with `avarice context <term>` for attended queries; project record with index build commits, and activation with promotion `none`; `status` and `resume` for onboarding.
- dependencies: Node 22.13 or newer; a Claude Code version admitted in extensions.md version compatibility (2.1.312 and 2.1.316 today); GSD 1.17.0.
- verification: S-26, S-27, S-29, S-30, S-31, S-32, S-33 (fast map), S-35, S-36, S-39, S-40, S-45, S-46; AC-1; CS-1 to CS-4, CS-7, CS-10 to CS-14 adapted to the onboarding contract; resolve unresolved host limitations 1, 2, 5, 6 and 7 in containment.md.
- excluded: Remote workers, NAS migration, the dashboard (slice 4), distributed scheduling, enterprise connectors, planning initialization (`ingest-docs`), path-scoped and incremental refresh, adoption of existing maps, promotion `copy` and `commit`, active command validation.
- exit criterion: One real brownfield repository reaches an active record that lists a graph with code and document nodes, and intel, built at the onboarded revision. A scripted source edit through Edit, Bash and Python is blocked, and so is a scripted edit of the policy file. Killing mapping and running `resume` reaches the same active record.
- target repository (from README "Remaining decisions", not an ingested doc): slice 0 onboards `~/aa-phan-portfolio-v2` (decided 2026-11-01) for its exit criterion.

## Topic: Slice 1 - Contained unattended run of one work item (GSD Phase 1)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Slice 1")
- goal: `avarice start --brief b.md --policy routine` takes one work item to `ready_for_review` without prompts, or to `blocked_on_decision` with a decision record, inside enforced containment, surviving a kill at any point.
- requirements: RC-1, RC-2, RC-3, RC-4, RC-5, CON-1, CON-2, CON-3, CON-5, CON-6, CON-7, CON-8, CON-9, CON-13 (tool calls, invocations, wall clock, cost cap), CON-14, CON-16, AUT-2 (record only), AUT-7, AUT-8, AUT-9, AUT-12 (states and cancellation for one item), SEC-2 (scrubbed environment, no credentials in the run), FR-1, FR-2, FR-4 (Stage 1), FR-5, FR-6, FR-7, FR-11, NFR-1, NFR-3, NFR-5, NFR-6, NFR-9, OPS-2, ONB-10
- deliverables: On the slice 0 kernel: contract compilation from a brief and G0; run worktree on a new branch; generated host settings with sandbox (`failIfUnavailable`, `allowUnsandboxedCommands: false`), `dontAsk`, `--setting-sources ""`, scrubbed environment; run hook set with `onFailure: "block"` (canonical paths, read-before-edit, tool-call reservation, Agent `permissionMode` denial, background Bash denial); Claude Code host adapter for `/gsd-quick --validate --text`; run-scoped GSD configuration; outcome classification; discard-and-retry for crashed invocations (CON-16); context packs from the four MVP adapters; checks, test inventory, gates G2 and G4; `status`, `inbox`, `resume`; `install-host` for the `avarice-run` skill.
- dependencies: Slice 0; an active project record for the target repository; a spike confirming the sandbox runtime can wrap AVARICE's own check commands.
- verification: Containment cases CS-1 to CS-4, CS-6, CS-7, CS-10 to CS-14 on the installed host; scenarios S-3, S-12, S-13, S-14, S-15, S-20, S-41, S-42; AC-3; baseline unattended workflow with a fake host; kill-point suite; resolve unresolved host limitation 8; active validation of the repository's declared check commands (ONB-10).
- excluded: Several work items and independent scheduling, answering decisions and resuming GSD sessions, notifications beyond the local inbox, contract amendments (none exist yet, so RC-5 holds by absence), more than one profile, policy presets other than `routine` and `onboarding`, retrieval adapters beyond `git-files`, `gsd-planning`, `gsd-intel` and `gsd-graph`, push and PR delivery, Stage 2 capability.
- exit criterion: Three R1 benchmark tasks on a real repository reach `ready_for_review` with no human input after start, and a scripted out-of-scope write through Bash, Python and Edit fails on each path.

## Topic: Slice 2 - Decisions, independent work and amendments (GSD Phase 2)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Slice 2")
- goal: Runs with several work items continue independent work around an open decision, take a validated answer, resume the paused GSD session and finish.
- requirements: AUT-1, AUT-2, AUT-3, AUT-4, AUT-5, AUT-6 (local), AUT-10, AUT-12, AUT-16, RC-6, RC-7, RC-8, CON-15 (subagent budget sharing)
- deliverables: Work-item scheduler with dependencies; work-item sizes and specifications with derivation from the brief, indexes and GSD plan; model per item from `modelBySize`; required checks after every item; authority-class matching and authorized defaults; `decide` with identity, duplicate and state-digest checks; resume through `claude -p --resume`; batching; local notifier and launchd digest scheduler; `contract amend` with evidence invalidation; gates G1 and G3; integrity gates for overrides and PRUNE; subagent concurrency reservation.
- dependencies: Slice 1.
- verification: S-17, S-18, S-21, S-50, S-51, S-52; CS-5, CS-15; decision response validation suite; amendment invalidation tests.
- excluded: Push notifiers, reply channels other than the terminal.
- exit criterion: not stated as a separate line in the source; the GSD Phase 2 success criteria below serve (blocking question leaves an independent item completed with evidence; silence and failing notifier leave the decision open; stale answer re-opened rather than applied).

## Topic: Slice 3 - Profiles, retrieval budgets, restricted mode and the portability proof
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Slice 3")
- goal: Separate profiles, progressive retrieval with enforced caps, explicit degradation, and proof that domain code is adapter-independent.
- requirements: ONB-6 (adoption), ONB-11, ONB-15, FR-22, SEC-1, SEC-2, SEC-3, SEC-4 (model), SEC-6, SEC-7, CON-4, CON-10, CON-11, CON-12, OPS-1, OPS-5, OPS-6, NFR-4 (proof), FR-3, FR-8, FR-12 to FR-19
- deliverables: Onboarding adoption and migration of existing GSD maps, path-scoped and incremental refresh with `verify codebase-drift` and the graph's structural diff, incremental knowledge-pass refresh with GSD phase files added, planning initialization through `ingest-docs`, promotion `copy` and `commit`, enterprise onboarding modes; profile resolver and repository binding; restricted mode (`--restricted`, disposable copy); progressive retrieval and per-step caps; handle-first retrieval and per-edge read rules (FR-22) with the spike mapping graphify relations to read rules; three-arm retrieval evaluation and the knowledge-pass default it decides; manual-equivalent commands (`context add`, `evidence add`, `pr record`, `comment --print`; FR-19); cache scoping; redactor; attended privileged-action hook and approvals; `doctor` with enforcement levels and `--extensions`; fake-remote `CommandExecutor` and `ArtifactStore`; shared contract suite package.
- dependencies: Slices 1 and 2.
- verification: S-28, S-33 (scoped), S-34, S-37, S-38, S-47, S-49, S-54; AC-2; AC-8 with three-arm evaluation; AC-14 on the brownfield benchmark; S-1, S-2 (without `backup`), S-4, S-5, S-7, S-9, S-16, S-22; resolve unresolved host limitations 3 and 4; CS-8, CS-9, CS-16; isolation suite (AC-6); portability proof (AC-7); redaction suite (AC-5).
- excluded: Real remote adapters, enterprise policy delivery.

## Topic: Slice 4 - Delivery, test strength, review feedback and data safety (completes the MVP)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Slice 4")
- goal: From `ready_for_review` to a pushed branch and draft PR when the contract authorizes it, and back to a new attempt on review feedback, with no duplicate PRs.
- requirements: AUT-11, AUT-13, AUT-14, AUT-17, SEC-8, FR-9, FR-10, FR-25, FR-26, NFR-7, NFR-8, OPS-3, OPS-4
- deliverables: Push and draft PR by AVARICE outside the contained invocation; `ChangeRequests` adapter on `gh`; reconciliation on resume; feedback attempts; `avarice mutate`, mechanical mutant generator and Node mutation probe; `harden` work items and `hardening` preset; symbol-scope check in G2; architecture model draft and `architecture-model` check; `avarice dashboard` with `--watch`; `backup`, `restore`, `export`, `import`, `uninstall`, `gc`, retention.
- dependencies: Slices 1 to 3.
- verification: S-6, S-8, S-19, S-23, S-24, S-25, S-48, S-53, S-56, S-57, S-58, S-59; AC-15; duplicate-retry suite (AC-4); mutation probe suite; restore drill (T-7).
- excluded: Merge, release, deploy.
- note: Benchmark subset (16 R1 and 8 R2 tasks) runs at the end of this slice to measure AC-9, AC-12 and AC-13. AC-10 and AC-11 need the C1, C2 and X classes and are measured with the full benchmark in slice 5.

## Topic: Slices 5 to 7 (later)
- source: /Users/aphan/avarice/docs/implementation-plan.md (sections "Slice 5", "Slice 6", "Slice 7")
- slice 5 (GSD capability bridge, phased work, plugin, push notifiers): requirements FR-4 (Stage 2), AUT-6 (push), OPS-6; deliverables `avarice-bridge` capability with contributions and blocking gates, integration test of the plan-phase double-execute path before enabling `/gsd-autonomous` units, plugin for attended use, `ntfy`/`pushover`/`telegram` adapters; depends on slice 4 and a confirmed reading of the capability schema; verification GSD integration suite runs `loop render-hooks` per point plus the full 40-task benchmark; excluded GSD versions outside the pinned range. Revisit trigger: if GSD changes the capability schema or adds a headless mode before this slice, re-run the GSD investigation and update ADR-006 first.
- slice 6 (personal infrastructure, parts independent except 6c needs 6b workers): 6a `s3` artifact adapter and `artifacts migrate` (S-10 against MinIO or NAS; trigger disk pressure); 6b remote worker and host records with deactivation guard FR-24 (S-11, CS-1 to CS-16 on worker OS; trigger runs continuing while Mac sleeps or checks that cannot run on macOS); 6c coordination service and `coordination-api` ledger adapter (concurrency suite with two workers; trigger two machines advancing runs at once); 6d `vault:` credential adapter for personal-extended (S-55; trigger second machine or local service needing same secrets). Each part may also run on `localhost` (ADR-010).
- slice 7 (cross-repository runs and project groups; starts when two repositories regularly need changes together): requirements AUT-15, FR-21; project groups in `inventory`, contracts with one workspace per repository, cross-repo work-item dependencies, per-repo gates and linked change requests, standards context adapter; depends on slice 4; verification S-43, S-44 and containment suite with two worktrees; excluded coordinated merging, cross-profile groups.
- dependency graph: s0 -> s1; s1 -> s2; s1 and s2 -> s3; s3 -> s4; s4 -> s5, 6a, 6b, 6d, s7; 6b -> 6c.

## Topic: GSD-compatible planning input (phases 0 to 2 verbatim; first milestone)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "GSD-compatible planning input")
- note: Slices map onto GSD roadmap phases in the format of `gsd-core/templates/roadmap.md`; the first three are given in the source, the rest follow the same pattern from the slice tables. Slices 0 and 1 suit `/gsd-mvp-phase` (vertical MVP slice). Phase requirement lists overlap by design: CON-2, CON-3, CON-5, CON-6, CON-13, NFR-1, NFR-3, NFR-5, NFR-6, NFR-9 appear in both Phase 0 and Phase 1; AUT-2 and AUT-12 appear in both Phase 1 and Phase 2 (partial scoping per slice, e.g. "AUT-2 (record only)" in slice 1). Roadmapper must decide how to allocate partially-covered requirements.

### Phase 0: Contained onboarding of one repository
**Goal**: avarice onboard takes one existing repository to an active project record with GSD as the mapper, source read-only
**Depends on**: Nothing (first phase)
**Requirements**: [ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-6, ONB-7, ONB-8, ONB-9, ONB-12, ONB-13, ONB-14, FR-20, CON-2, CON-3, CON-5, CON-6, CON-13, SEC-5, NFR-1, NFR-2, NFR-3, NFR-5, NFR-6, NFR-9]
**Success Criteria** (what must be TRUE):
  1. One brownfield repository reaches an active project record
  2. Source edits and policy edits during mapping are blocked
  3. An interrupted mapping resumes to the same active record
  4. The active record lists a graph with code and document nodes, and intel, built at the onboarded revision
**Plans**: TBD

### Phase 1: Contained unattended run of one work item
**Goal**: avarice start takes one work item to ready_for_review without prompts, or to blocked_on_decision, inside enforced containment
**Depends on**: Phase 0
**Requirements**: [RC-1, RC-2, RC-3, RC-4, RC-5, CON-1, CON-2, CON-3, CON-5, CON-6, CON-7, CON-8, CON-9, CON-13, CON-14, CON-16, AUT-2, AUT-7, AUT-8, AUT-9, AUT-12, SEC-2, FR-1, FR-2, FR-4 (Stage 1), FR-5, FR-6, FR-7, FR-11, NFR-1, NFR-3, NFR-5, NFR-6, NFR-9, OPS-2, ONB-10]
**Success Criteria** (what must be TRUE):
  1. Three routine tasks reach ready_for_review with no human input after start
  2. An out-of-scope write through Edit, Bash and Python fails on every path
  3. A broken hook or missing sandbox blocks the protected operation
  4. Killing the supervisor and running avarice resume continues from the last checkpoint
**Plans**: TBD

### Phase 2: Decisions, independent work and amendments
**Goal**: Runs continue independent work around an open decision, take a validated answer, resume the paused GSD session and finish
**Depends on**: Phase 1
**Requirements**: [AUT-1, AUT-2, AUT-3, AUT-4, AUT-5, AUT-6, AUT-10, AUT-12, AUT-16, RC-6, RC-7, RC-8, CON-15]
**Success Criteria** (what must be TRUE):
  1. A blocking question on one item leaves an independent item completed with evidence
  2. Silence and a failing notifier leave the decision open
  3. A stale answer is re-opened rather than applied
**Plans**: TBD

## Topic: Maintenance cost (estimates)
- source: /Users/aphan/avarice/docs/implementation-plan.md (section "Maintenance cost")
- notes: Estimates, not measured. GSD minor releases: unknown frequency (installed 1.17.0 ships 12 installer migration modules), re-run GSD integration suite and outcome-classifier fixtures, Stage 2 re-check capability schema. Claude Code releases (frequent): re-run containment suite before enabling unattended runs on the new version; `doctor` pins last verified version. Node majors yearly: re-run all suites, `node:sqlite` API check. Schema migrations: one migration plus fixture per persisted-data feature. Each enterprise adapter: owned by employer package, contract suite keeps it honest. Containment suite likely the most expensive recurring cost (spends model budget on every host upgrade).

## Topic: Decisions already taken by the repository owner (README, not ingested; read for context)
- source: /Users/aphan/avarice/README.md (section "Remaining decisions"; context only, outside the ingest manifest)
- notes: Decided 2026-11-01: (1) Claude Code is the primary host and GSD 1.17.0 the baseline (assumptions A-1, A-2 confirmed). (2) Attended use targets whichever directory `CLAUDE_CONFIG_DIR` names, falling back to `~/.claude`; no path hard-coded in the MVP; the developer's active directory is `~/.claude-edu`; unattended runs load neither directory's settings. Slice 0 onboards `~/aa-phan-portfolio-v2`. Still open: (3) confirm GitHub as personal SCM and manual briefs as only personal task source (A-3, A-4); (4) default limits of `routine` preset and whether it may push a branch and open a draft PR; (5) notification destination (ntfy, Pushover, Telegram) and check-in times; (6) confirm unattended runs only while Mac awake (A-8) or bring the remote worker forward; (7) name NAS model and OS before slice 6 (A-5); (8) default promotion mode for onboarded artifacts (`none`, `copy`, `commit`); (9) enterprise onboarding questionnaire when an employer is known (A-6).

## Topic: Existing tooling assessment (GSD 1.17.0, Claude Code, local toolchain)
- source: /Users/aphan/avarice/docs/existing-tooling-assessment.md
- status: inventory records observed facts; reuse decisions are proposals
- notes: GSD 1.17.0 already owns the development loop from discussion to PR creation, so AVARICE is a service layer around GSD and does not orchestrate the steps inside it. Gaps GSD leaves: for any run, intake from task references, cited and freshness-tracked context, a run ledger spanning GSD sessions, evidence bound to an exact revision, profile isolation, authorization for privileged actions; for unattended runs, a headless driver, decision routing, budgets, enforced file scope and test-integrity gates. Claude Code supplies the enforcement layers (sandbox, permission modes, hooks). Document sections (read at heading level plus introduction only): Environment inventory (agent host and configuration, GSD, hooks, plugins/skills/MCP, local toolchain), GSD lifecycle ownership and supported integration surfaces, Autonomy and enforcement surfaces (GSD autonomy surfaces; Claude Code 2.1.312 and 2.1.316), Reuse and gap matrix, Open questions about tooling.

## Topic: Comparison with the 3dmk reference system
- source: /Users/aphan/avarice/docs/reference-system-comparison.md
- status: proposal; statements about 3dmk describe its documented running system (version 2.1.3 docs, site 2.0.5); every number about 3dmk is its author's own and unverified
- notes: AVARICE and 3dmk separate the same responsibilities (durable knowledge, work state, inventory, verification, observability); the largest difference is who decides (3dmk's author seldom lets agents decide; AVARICE aims to take a brief with acceptance criteria to a reviewable change unattended). Gaps G-1 to G-10 plus smaller gaps and adjustments A-1 (discard and retry as default recovery), A-2 (pre-decomposed work). Decisions taken by the repository owner: 2026-10-30: G-1 and G-2 into slice 0 (ONB-13, FR-20, `gsd-intel` and `gsd-graph` adapters; AC-8 measured with adapters present); G-3, G-5, G-6, G-7 become catalog entries 9 to 12; unattended work across several repositories (AUT-15, FR-21, slice 7); A-1 becomes CON-16; document half of G-1 split (ONB-14 in slice 0, ONB-15 in slice 3). 2026-11-01: G-8 becomes FR-22 (slice 3), G-9 becomes AUT-17 (slice 4), G-10 becomes FR-23 with catalog entry 13, RC-7, RC-8, AUT-16 (slice 2), builds from a tag and forward-only migrations become catalog entry 14, homelab gaps become FR-24 (slice 6b) and slice 6d; G-4 closed as FR-25 with ADR-012 and static dashboard scoped into MVP as FR-26 with ADR-011 (both slice 4). Sections: Sources and limits, Component mapping (relations Similar / Different by design / Gap / Delegated / Not needed), Similarities, Differences by design, The author's answers (eight private answers, paraphrased), Gaps in AVARICE, Adjustments, Maintenance, Specification beyond this comparison, Decisions taken.

## Topic: How AVARICE differs from 3dmk (deep dive)
- source: /Users/aphan/avarice/docs/reference-system-deep-dive.md
- status: proposal; statements about 3dmk describe its documented, running system
- notes: Both hold an agent to a design a person approved but place human review differently: in 3dmk the developer approves each design document and, at the start of each session, scope and plan, after which subagents run unattended held by structural checks; AVARICE puts no approval at the start of a run and enforces through an OS sandbox, a run contract and evidence gates, stopping for a person only on consequential decisions. Sections (read at heading level plus introduction only): Two methods side by side; Component by component (Seele, Scrolls, Registry and Atlas, Magi and reconciliation, Core MCP, Publishing and infrastructure, NervHQ, Consul and Vault, Nexus, Postgres and Redis, Fetch and Design); Portability; Scalability; Convergence on a homelab; Gaps from the documentation. Cited as design inspiration by ADR-004, ADR-009, ADR-010, ADR-011, ADR-012; not a source of requirements.
