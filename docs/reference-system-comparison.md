# Comparison with the 3dmk reference system

> Status: proposal. No part of AVARICE described here is built yet; present tense describes its proposed design. Statements about 3dmk describe its documented, running system.

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) and 3dmk separate the same responsibilities: durable knowledge, work state, inventory, verification and observability. In this audit's reading, the largest difference is who decides. The 3dmk author seldom lets agents make decisions and manages the stages personally; orchestration then runs the decomposed work, up to a full initiative overnight. AVARICE aims to take a brief with acceptance criteria to a reviewable change unattended. Its decision records, evidence gates and mutation gate exist to support that wider scope.

AVARICE has ten numbered gaps against 3dmk (G-1 to G-10) and five smaller ones, all listed under [Gaps in AVARICE](#gaps-in-avarice). The largest, G-1, was retrieval of individual knowledge nodes; slice 0 builds a graph with code and document nodes, and FR-22 adopts Seele's cost-aware reads (G-8). The author's answers also suggested discarding a crashed invocation's work before retrying it. [Decisions taken](#decisions-taken) records which gaps and adjustments the repository owner adopted. The [deep dive](reference-system-deep-dive.md) explains each design difference, and how AVARICE's choices serve portability and scalability.

## Sources and limits

Three sources were used, and none was independently verified:

- **The 3dmk documentation**, https://3dmk.com/documentation, version 2.1.3, retrieved on 2026-11-01 from its Markdown and SQL downloads. It is the primary source and wins where the other sources disagree. File names such as `seele.md` refer to those downloads, by Nick Olson under CC BY 4.0. Gaps G-8 to G-10 and three of the smaller gaps come from it.
- **The public site**, https://3dmk.com/, retrieved on 2026-10-30 (site version 2.0.5, 21 chapters). Only the page's visible text was read, with no 3D scene, images or linked documents. Each chapter has a plain-language view, a technical view labeled "Built here", "Off the shelf" or "Hybrid", and the author's commentary with session excerpts. Chapter numbers in this document refer to the site's chapters.
- **The author's answers** to eight questions the repository owner sent privately, relayed on 2026-10-30. They are not public and are paraphrased here as "answer 1" to "answer 8" under [The author's answers](#the-authors-answers).

Every number about 3dmk is its author's own. The site's counts vary between chapters. It gives 37 projects in the Core theme in chapter 1 and 34 in chapter 3. It gives 124 and 135 repositories in chapter 17, and 135 again in chapter 19. The site's header describes 3dmk as "a visual representation of my personal environment for agentic development". Where this document measures it against AVARICE requirements, it measures fit for AVARICE's goals, which 3dmk does not claim to share. The decision not to copy its service layout is in [ADR-004](decisions/ADR-004-modular-monolith-and-ports.md) and in the [non-goals](requirements.md#non-goals).

## Component mapping

**Relation** takes one of five values:

- *Similar*: same responsibility with a comparable rule.
- *Different by design*: same responsibility, solved another way for a stated requirement.
- *Gap*: 3dmk describes a capability AVARICE does not specify.
- *Delegated*: AVARICE leaves the responsibility to another system.
- *Not needed*: the 3dmk capability supports infrastructure that AVARICE does not run.

| 3dmk component (chapter) | What the source says | AVARICE counterpart | Relation |
|---|---|---|---|
| Core theme and themes (1, 3, 6) | Core is an ownership boundary for shared infrastructure and tooling that product themes consume; the Registry holds a Theme record that groups projects | No grouping above the repository; project records are per repository ([repository-onboarding.md](repository-onboarding.md)) | Gap |
| Core MCP (2) | A Rust gateway that "turns model requests into controlled tool calls"; "Everything I do against my development harness is routed through this MCP"; 107 tools. Session excerpts also show actions without the `core-mcp` prefix ("Read README.md", chapter 5; "ran a command", chapter 8) | The host's built-in tools inside an OS sandbox, with generated host settings and a fail-closed hook ([containment.md](containment.md)); MCP only as an optional wrapper ([extensions.md](extensions.md)) | Different by design |
| CLAUDE.md persona and routing (2) | A short CLAUDE.md loads a terse persona and routes `seele://`, `repo://` and `theme://` shorthand | The AVARICE skill teaches the agent to read the context pack ([extensions.md](extensions.md)); no addressing scheme | Gap |
| Seele (4, 4.1) | Typed nodes and edges in PostgreSQL (`node`, `edge`, `node_version`); full-text search returning handles, with vector search deferred (`seele.md`); edge relations decide how much a read loads; a token count per node | One graphify graph with code nodes and document nodes for stable documents, plus GSD intel, queried before files; handle-first reads with token estimates and per-edge read rules (FR-22, [contracts-and-state.md](contracts-and-state.md#contextsource)) | Gap, closed |
| Triggers (4 commentary) | Named procedures in CLAUDE.md whose steps moved from markdown files into Seele nodes; shared steps are one node | GSD workflows and skills | Similar |
| Seele document chain (4.5) | Overview, Vision, Product, Technical, Planning; Planning seeds Scrolls | GSD `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` and phase files; `ingest-docs` for existing documents ([repository-onboarding.md](repository-onboarding.md)) | Similar |
| Seele language governance (4.2) | Standards, scaffolds, naming and known issues for seven language families | GSD `CONVENTIONS.md` per repository, which feeds the contract; no cross-repository standards or scaffolds | Gap |
| Design and Studio decisions (4.3, 4.4, 16) | Research leads to an approved standard, and "only an approved standard binds the work"; Studio sessions turn mistakes into reusable lessons (4.4) | Decisions recorded as ADRs; runtime decision records with authority classes ([autonomy-and-decisions.md](autonomy-and-decisions.md)); no lessons store | Similar |
| Scrolls (5) | Own work graph (initiative, epic, story, task, bug, subtask) in PostgreSQL; per-agent queues; 50 tools; "replaced my Jira integration"; "a full initiative in one overnight session" | GSD milestones, phases and plans; AVARICE work items inside one run; `TaskSource` for enterprise trackers | Different by design |
| Registry (6 commentary, 6.1) | Theme, project, source, libraries and host records in one JSON file in a Git repository, rewritten atomically under a write lock and pushed every 60 seconds (`registry.md`, `registry-schema.md`); server-assigned IDs; fixed types; refuses to deactivate a host that active sources still deploy to | `inventory` module and versioned project records in the ledger ([architecture.md](architecture.md#modules)); SQLite transactions with version checks; a hash-chained event log | Similar |
| Atlas (2 commentary, 6.2) | A syntax-tree snapshot per repository at each commit, with imports, types, functions and constants; diffs show structural change without a full scan | The graphify code graph built at onboarding, with its build commit in the project record (ONB-13); AUT-17 adds a symbol-level scope check from it in slice 4 | Gap, closed |
| Magi (4.5, 6.2; trigger 8 in 4 commentary) | Machine-readable architecture graphs for libraries, applications and infrastructure, validated against a JSON Schema; a trigger validates them against code | GSD `ARCHITECTURE.md` in prose, plus a repository-owned `.avarice/architecture.json` drafted from the code graph, approved by the user and checked against code (FR-25, [ADR-012](decisions/ADR-012-architecture-model.md)) | Gap, closed |
| Fetch (8) | Playwright behind an asynchronous API; an isolated browser context per request; text, HTML, screenshots and console messages | No browser check specified; GSD ships `~/.claude/agents/gsd-dom-verifier.md` | Gap |
| Publishing (9) | One-command versioning; one immutable image promoted from dev to prod; a verification step; guards for live sessions and low disk | The normal endpoint is a reviewable change; merge, publish and deploy need separate authorization in the contract and in organizational policy (AUT-11) | Delegated |
| NervHQ (10) | React dashboard over a FastAPI hub with PostgreSQL, Redis and WebSocket; typed session-close events; token usage within about six minutes of each turn; GitHub sync | `observe` module: structured events, `doctor`, `status`; budgets recorded per run; a static, read-only HTML dashboard with no server (FR-26, [ADR-011](decisions/ADR-011-static-dashboard.md)) | Different by design |
| Consul (11) | Service discovery and shared non-secret configuration | None; the baseline runs no services | Not needed |
| Vault (12) | Secrets fetched at runtime by service identity and policy; kept out of source code and prompts; "`.env` is evil" | `CredentialProvider` broker port over Keychain, vendor CLIs and approved helpers; never copied; every lookup audited; none inside a contained run ([ADR-009](decisions/ADR-009-credential-broker.md)). It departs from 3dmk's Vault standard; see [differences by design](#differences-by-design) | Different by design |
| Nexus (13) | One package source for Python, npm and Rust; cached packages checked against OSV; blocked versions recorded in Seele | New dependencies need a `human` decision ([autonomy-and-decisions.md](autonomy-and-decisions.md#decision-matrix)); no package source or vulnerability check | Gap |
| Postgres with core-db (14) | A database per project and a login role per service (`postgres.md`); numbered SQL patches with checksums; editing an applied patch fails the deploy | One SQLite database per profile; numbered, checksummed migrations, one per transaction ([ADR-003](decisions/ADR-003-local-persistence.md)) | Similar |
| Redis (15) | Disposable cache and live state | None; SQLite WAL serves reads during writes | Not needed |
| Shared Core libraries (15 commentary) | Python and Rust libraries that force one way to reach Core services | Ports and import rules inside one package ([ADR-004](decisions/ADR-004-modular-monolith-and-ports.md)) | Similar |
| Machines (19) | The workstation runs sessions; the laptop connects over a VPN; the phone takes over a workstation session by remote control; a Docker host and a NAS serve | Personal-extended profile and a remote worker, both later ([deployment-and-portability.md](deployment-and-portability.md)); decisions answered through an authenticated reply channel | Different by design |
| AWS (20) | One EC2 host in us-east-1 runs the public sites | Production hosting belongs to the deployment system ([architecture.md](architecture.md#source-of-truth-ownership)) | Delegated |

## Similarities

**One owner per record.** 3dmk's Registry "holds structured records, not documentation. Documentation lives in Seele" (chapter 6). AVARICE states the same split in its [source-of-truth table](architecture.md#source-of-truth-ownership): GSD owns planning documents and the codebase map, and the ledger owns operational records.

**Immutable schema steps.** core-db fails a deploy when an applied patch is edited (chapter 14). AVARICE applies numbered, checksummed migrations one per transaction ([ADR-003](decisions/ADR-003-local-persistence.md)).

**Atomic, auditable inventory writes.** The Registry uses a single-writer lock and a Git audit record per write (chapter 6.1). AVARICE uses version-checked SQLite transactions and a SHA-256 hash chain over events ([contracts-and-state.md](contracts-and-state.md#persisted-entities)).

**Secrets outside code and prompts.** Vault issues secrets at runtime by policy (chapter 12), and answer 7 adds that "credentials never touch something unprotected". SEC-2 bars tokens from prompts, state, evidence, artifacts and logs, and no credential enters a contained run ([containment.md](containment.md)).

**Testable tasks.** Answer 4 says every task carries acceptance criteria and testing, with a clearly defined output that can be validated. AVARICE maps each acceptance criterion to the checks that verify it ([contracts-and-state.md](contracts-and-state.md#run-contract)).

**Upstream tools for the commodity layer.** 3dmk wraps Playwright, Docker and HashiCorp products (chapters 8 to 12). AVARICE wraps GSD, Claude Code, git and `gh` ([existing-tooling-assessment.md](existing-tooling-assessment.md)).

**Guessing as the failure to prevent.** The assistant's closing retrospective on the site says its hard stops "came after I guessed, made up a number, or added a step you never asked for" (chapter 21). AVARICE's decision matrix routes the same situations to decision records, and silence never approves ([autonomy-and-decisions.md](autonomy-and-decisions.md)).

## Differences by design

Ten design choices differ, and one has converged. The [deep dive](reference-system-deep-dive.md#component-by-component) gives the reasoning per component.

| Choice | 3dmk | AVARICE | Requirement behind the AVARICE choice |
|---|---|---|---|
| Who decides | The author; agents seldom decide, and the author treats the AI like an advanced Google that can talk back (answer 2, paraphrased) | Agents decide within authority classes the contract delegates; everything else becomes a decision record | AUT-1 to AUT-15 |
| Unattended scope | The author manages the stages and seldom uses AI to come up with a solution (answer 3); each orchestration session opens with the developer confirming the scope and approving the plan, then subagents run the decomposed work (`orchestration.md`), up to "a full initiative in one overnight session" (chapter 5) | Unattended runs from a brief to `ready_for_review`, one repository per run; multi-phase milestones only after the GSD integration suite passes ([autonomy-and-decisions.md](autonomy-and-decisions.md)) | [ADR-006](decisions/ADR-006-unattended-delegation.md); the "not supported unattended" list in [autonomy-and-decisions.md](autonomy-and-decisions.md) |
| Where control sits | A gateway that routes tool calls (chapter 2); agents "operate in their own sandboxes" (answer 6), mechanism not stated | The host and the OS: generated settings, Seatbelt or bubblewrap, a fail-closed hook | CON-1 to CON-16 |
| Runtime shape | Purpose-built services plus Consul, Vault, PostgreSQL and Redis (chapter 3), run continuously on a Docker host (chapter 19) | One package; short-lived commands plus a per-run supervisor; a shared coordination service only later ([deployment-and-portability.md](deployment-and-portability.md)) | NFR-1: no NAS, cloud account, container runtime, Kubernetes, Redis or always-on database server for the baseline |
| Work tracking | Own tracker (Scrolls) that replaced a Jira integration (chapter 5) | GSD for planning; enterprise trackers stay authoritative through `TaskSource` | [ADR-002](decisions/ADR-002-gsd-integration-mode.md); enterprise rule against replacing company systems |
| Knowledge storage | Database nodes; trigger steps were migrated from markdown files into Seele (chapter 4) | Repository files stay the source; AVARICE references them by path and digest | ONB-2 |
| Crash recovery (converged) | Work in the sandbox is discarded and restarted (answer 6) | Adopted the same approach: the attempt is discarded to the last checkpoint, then retried once (CON-16); after laptop sleep, the outcome is reconstructed from transcript, `HEAD` and `state.json` ([recovery rules](contracts-and-state.md#recovery-rules)) | FR-2, NFR-6, CON-16 |
| Observability | Live dashboard with WebSocket updates (chapter 10) | CLI `status`, `doctor`, inbox and a static, read-only HTML dashboard with no server (FR-26, [ADR-011](decisions/ADR-011-static-dashboard.md)) | FR-26, NFR-1 |
| Release | Managed promotion to production with guards (chapter 9) | Stops at a reviewable change unless the contract and policy authorize more | AUT-11 |
| Enterprise use | The same stack at home and at work; "none of it changes" (answer 7, as relayed), and external systems are documented (answers 1, 7) | A separate enterprise profile that works inside company identity, tracking, CI, secrets and release processes ([enterprise-adaptation.md](enterprise-adaptation.md)) | SEC-1 to SEC-8 |
| Retrieval quality | Judged by speed and accuracy improving over time (answer 5) | AC-8: 20 historical tasks, success rate and tokens against a baseline ([operations-and-testing.md](operations-and-testing.md#context-retrieval-evaluation)) | AC-8 |

On control, the site claims "controlled tool calls" and never claims containment, so the difference is one of scope. AVARICE assumes the host's built-in tools stay available to the agent and contains them at the OS.

On enterprise use, answer 7 does not say whether the employer restricts personal tooling. AVARICE's enterprise profile also covers employers that forbid personal services or secret stores, which the [enterprise questionnaire](enterprise-adaptation.md) settles per company.

On credentials, 3dmk's Vault standard keeps project secrets out of any local secret store (`consul-vault.md`). AVARICE stores no secret value itself, but its personal default reads from the macOS Keychain and vendor CLIs on the same machine. It accepts that because the baseline has no server and the agent never reaches those stores ([ADR-009](decisions/ADR-009-credential-broker.md)).

## The author's answers

Paraphrased from the relayed exchange; the question wording follows the repository owner's message. The right-hand column states what each answer changes in this comparison.

| Question | Answer | Effect |
|---|---|---|
| 1. Full framework or a scaled-down version at work? | The same stack for all local development, at home and at work; it also built a framework for work on another platform | Adds the "Enterprise use" row |
| 2. What decides whether the agent decides or escalates? | Agents seldom decide; the author discusses and reviews solutions with the AI | Adds the "Who decides" row; 3dmk describes no counterpart to AVARICE's delegated authority classes |
| 3. Can an initiative move from requirements to testing unattended? | The author manages the stages and seldom uses AI to come up with a solution; nearly 200 builds through the stack yielded best practices and scaffolds | Refines "Unattended scope"; prompts gap G-7 |
| 4. What evidence completes a task, and how are self-confirming tests prevented? | Jira-style hierarchy; acceptance criteria and testing in every task; a clearly testable output | Adds the "Testable tasks" similarity; the answer names no mechanism against self-confirming tests, so 3dmk describes no counterpart to the mutation gate |
| 5. How is retrieval quality evaluated beyond token savings? | Speed and accuracy, improving over time | Adds the "Retrieval quality" row |
| 6. How is a crash or timeout diagnosed before resuming? | Agents work in their own sandboxes; crashed work is discarded and restarted because that is faster | Adds the "Crash recovery" row and adjustment A-1 |
| 7. Which parts of Core stay unchanged in an employer's environment? | None change; external systems are documented; keys and tokens are stored in Vault | Adds the "Enterprise use" row and the secrets similarity |
| 8. Time spent maintaining the platform versus building products? | Early on, weeks or weekends went to repairs and hardening; about four months ago everything began to fit, and maintenance is now nearly non-existent | This audit reads it as support for front-loading reliability work; see [Maintenance](#maintenance) |

## Gaps in AVARICE

G-1 to G-7 are ordered by this audit's estimate of the effect on token cost and unattended success; no measurement supports the order. G-8 to G-10 come from the documentation and follow, unranked.

### G-1 Node-level knowledge retrieval

Seele returns one document node and its references through `seele_read` (chapter 4). The author reports 79% to 97% less context for six triggers after moving their steps into nodes; the figure covers trigger steps only. AVARICE's retrieval ladder starts with an index step ([containment.md](containment.md#retrieval-and-resource-safeguards)). At audit time its MVP sources, `git-files` and `gsd-planning`, returned file excerpts and had no node-level index. Decision 1 adopted the index adapters.

Proposed resolution: add context adapters for GSD intel (`.planning/intel/`) and the GSD-managed graphify graph (`.planning/graphs/`) to the MVP index step. Both are GSD outputs, so ONB-2 still holds. Make building them an optional, contained onboarding stage, and record each build commit in the project record. Rank model-inferred graph edges below edges extracted from code. Measure AC-8 with these adapters present. Adopted as ONB-13 and FR-20 in slice 0 (decision 1).

### G-2 Code-symbol snapshots per commit

Atlas records imports, types, functions and constants at each commit, and diffs between snapshots show structural change without a full scan (chapter 6.2). At audit time, AVARICE's drift check read committed history and reported changes to manifests and workspace layout, and its mutation gate scoped mutants by changed lines.

Proposed resolution: use graphify's code extraction as the snapshot. graphify's own documentation says its watch mode rebuilds code graphs with no model call (`~/.claude/skills/graphify/SKILL.md`, usage section). Store the build commit with the project record. Use a symbol-level diff to choose which codebase-map documents to refresh after drift. Adopted: the code graph in slice 0 (ONB-13) and the symbol-diff refresh in slice 3 (ONB-11; decision 1).

### G-3 Prompt addressing

`repo://` and `theme://` in a prompt resolve through the Registry (chapter 6), and `seele://<id>` pulls a node through `seele_read` (chapters 2 and 4). A prompt names a target, and the agent receives paths, hosts and context without searching. AVARICE resolves a repository only on the command line (`avarice repo add`, `--profile`).

Proposed resolution: let `avarice context` accept `repo:<name>` and `doc:<path>#<anchor>` references, resolved against project records and returned as a budgeted, cited excerpt. This serves attended sessions through the AVARICE skill. Contained runs receive resolved references in the context pack. Adopted as catalog entry 9, later (decision 2).

### G-4 Validated architecture model

Magi keeps machine-readable architecture graphs validated against a JSON Schema (chapter 6.2), and trigger 8 validates them against code (chapter 4 commentary). AVARICE has GSD's prose `ARCHITECTURE.md`, and nothing compares an architecture model with code.

Proposed resolution at audit time: none in the MVP. Adopted on 2026-11-01 as FR-25 and [ADR-012](decisions/ADR-012-architecture-model.md): a repository-owned model of components, edges and shared resources, drafted from the code graph, approved by the user and checked in slice 4 (decision 7).

### G-5 Package boundary and vulnerability checks

Nexus gives builds one package source and checks cached packages against OSV (chapter 13). AVARICE routes new dependencies to a `human` decision but does not check versions already present or changed in a lockfile.

Proposed resolution: add an optional check type that runs the repository's audit tool (`npm audit`, `pip-audit`, `cargo audit`) inside the sandbox. Allow network access only to the declared registry or mirror, and record the result as evidence at gate G4. A company package mirror becomes an enterprise questionnaire item. Adopted as catalog entry 10 and questionnaire question 24, later (decision 2).

### G-6 Browser verification

Fetch renders pages in isolated browser contexts and returns screenshots and console errors (chapter 8), which the Design loop uses for review (chapter 16). AVARICE's checks are repository commands only.

Proposed resolution: for repositories with a web surface, let a check run Playwright inside the sandbox against a locally started server and store screenshots and console logs as artifacts. GSD's `gsd-dom-verifier` agent can add model review, recorded as `model-review` evidence. The localhost network exception needs a containment-suite case. Adopted as catalog entry 11, later (decision 2).

### G-7 Standards and scaffolds across repositories

Seele holds per-language standards and scaffolds (chapter 4.2). Answer 3 says the author seldom uses AI to come up with a solution, and that nearly 200 builds yielded best practices and scaffolds. AVARICE reads conventions per repository from GSD and has no shared set.

Proposed resolution: a later `standards` context adapter that reads a user-chosen directory of standards and scaffolds as read-only, cited context. Contracts can name standards from it. Repository conventions in GSD's map stay authoritative for their repository. Adopted as catalog entry 12 and FR-21, later (decision 2).

### G-8 Read semantics and token cost before reading

Seele's edges carry one of three relations, and the relation sets how much a read loads: `hasPart` loads every descendant, `requires` loads the target one hop deep, and `references` returns only an ID (`seele.md`). Each node stores its token count, and search returns handles without content, so a caller sees the cost before reading (`seele-schema.md`). At audit time, AVARICE's graph edges carried only a confidence tier, and token estimates arrived with the content.

Proposed resolution: make `ContextSource.find` return handles with token estimates first and load content in a second call, so the assembler chooses within budget before reading. Give the `gsd-graph` adapter read rules per edge type: load containment edges fully, follow dependency edges one hop, and return references as IDs. This belongs with progressive retrieval in slice 3. Adopted as FR-22 (decision 6).

### G-9 Symbol-level scope checks per work item

3dmk's orchestrator pulls an Atlas snapshot after each change. A class the item's specification never named, an import the library matrix does not approve, or a job the Magi graph gives another component sends the change back, with the Atlas entry as evidence (`orchestration.md`). At audit time, AVARICE's gate G2 checked only that changed paths stayed inside the contract's globs ([contracts-and-state.md](contracts-and-state.md#phase-gates)).

Proposed resolution: once slice 0's code graph exists, extend G2 with a symbol diff between the item's start and end revisions. New imports outside the repository's declared dependencies, and new public symbols outside the paths the item names, become findings for a repair attempt or a decision. Adopted as AUT-17 in slice 4, after the slice 3 retrieval work (decision 6).

### G-10 Design-to-code reconciliation

3dmk runs two reconciliation jobs in review, reconcile or refactor mode (`reconciliation.md`). The documentation job checks the documents against each other and the configuration files. The code job reads the code through Atlas, scores each Technical section `aligned`, `drift`, `missing` or `contradicted`, and cites evidence for every finding. At audit time, AVARICE refreshed the codebase map on drift but never checked that requirements, ADRs or architecture documents still match the code.

Proposed resolution: a review-only `avarice reconcile` that runs GSD's `gsd-doc-verifier` agent (`~/.claude/agents/gsd-doc-verifier.md`) in a contained invocation over the codebase map and the documents listed for the knowledge pass. Findings become a report and, where a document is wrong, a decision; AVARICE never edits documents or code in this mode. Adopted as FR-23 and extensions catalog entry 13 (decision 6).

### Smaller gaps

- **Portfolio grouping** (the Theme record) matters once runs span repositories. Adopted as project groups in slice 7 (decision 3 below).
- **A lessons store** (chapter 4.4) overlaps GSD's `extract-learnings` workflow (`~/.claude/gsd-core/workflows/extract-learnings.md`). AVARICE should read GSD's output instead of building one.
- **An agent specification per work item.** Every Scrolls work item carries an `agent_spec` with file paths, signatures, configuration keys and Technical references (`concept-to-seed.md`, `scrolls-schema.sql`). At audit time an AVARICE work item had only an ID, a task text, dependencies and a type. Adopted as RC-7 (decision 6).
- **A model chosen per work item.** Scrolls maps each item size to a default model (`scroll_size.agent_default`, `scrolls.md`). At audit time AVARICE work items named no model. Adopted as RC-8 (decision 6).
- **The whole suite after every item.** 3dmk runs the full suite after each item, so a regression is charged to the item that caused it (`orchestration.md`). At audit time AVARICE ran required checks at G4 only. Adopted as AUT-16 (decision 6).

## Adjustments suggested by the answers

### A-1 Discard and retry as the default recovery

AVARICE already retries a crashed invocation once if budget allows ([recovery rules](contracts-and-state.md#recovery-rules)). The 3dmk approach adds one step before that retry: discard the failed attempt's changes. When a crashed or timed-out invocation left no side effect outside the machine, AVARICE resets the run worktree to the commit recorded at the item's last checkpoint, then retries. Adopted as CON-16 (decision 4).

CON-9 still holds. The reset touches only commits and files the run created after that checkpoint, and it refuses when the worktree holds anything else. Invocations that pushed a branch or created a PR still reconcile through `findByHead`. Charged budget stays charged either way.

### A-2 Pre-decomposed work before broad delegation

3dmk's unattended execution covers work a person has already decomposed and specified (answers 3 and 4, chapter 5). AVARICE's first unattended slice runs work items from a brief ([implementation-plan.md](implementation-plan.md)). The answers support keeping that slice to briefs with explicit acceptance criteria and decomposed items, and measuring the autonomy benchmark before widening delegation.

## Maintenance

Answer 8 reports heavy repair and hardening work at first; about four months ago everything began to fit, and maintenance is now nearly non-existent. AVARICE's [maintenance estimate](implementation-plan.md#maintenance-cost) differs in one respect: its largest recurring cost comes from GSD and Claude Code releases that AVARICE does not control. 3dmk's components are either the author's own code or upstream infrastructure that the author's bootstrap sets up (chapter 3).

## Specification beyond this comparison

The site and the answers describe the following only in part or not at all. AVARICE's versions are in the linked documents.

- OS-level containment of the agent and of checks. 3dmk states only that agents use their own sandboxes ([containment.md](containment.md)).
- Run contracts compiled from presets, with write scope per work item ([contracts-and-state.md](contracts-and-state.md#run-contract)).
- Evidence bound to a revision, gates G0 to G4 and a mutation gate. 3dmk describes a verification step and guards for releases (chapter 9) ([ADR-007](decisions/ADR-007-mutation-gate.md)).
- Runtime decision records with authority classes and authenticated responses. 3dmk records decisions as documents in Seele (chapters 4, 4.3) ([autonomy-and-decisions.md](autonomy-and-decisions.md)).
- Budgets for tool calls, invocations, cost and retrieval ([contracts-and-state.md](contracts-and-state.md#run-contract)).
- Contained onboarding in a staging worktree ([repository-onboarding.md](repository-onboarding.md)).
- An autonomy benchmark and metrics ([autonomy-and-decisions.md](autonomy-and-decisions.md)).

## Decisions taken

The repository owner decided on 2026-10-30:

1. G-1 and G-2 move into slice 0: requirements ONB-13 and FR-20, the index stage in [repository-onboarding.md](repository-onboarding.md#stages), and the `gsd-intel` and `gsd-graph` adapters in [contracts-and-state.md](contracts-and-state.md#contextsource). AC-8 is measured with the adapters present.
2. G-3, G-5, G-6 and G-7 become catalog entries 9 to 12 in [extensions.md](extensions.md#9-context-addressing-in-avarice-context-later). G-4 was closed later by decision 7.
3. AVARICE will run unattended work across several repositories: AUT-15 and FR-21, scheduled as slice 7 in [implementation-plan.md](implementation-plan.md#slice-7-cross-repository-runs-and-project-groups-later). This brings portfolio grouping into scope as project groups.
4. A-1 becomes the default recovery for crashed invocations: CON-16 and the [recovery rules](contracts-and-state.md#recovery-rules).
5. The document half of G-1 is split. Slice 0 adds document nodes for stable documents to the graph (ONB-14). Slice 3 adds incremental refresh and GSD phase files (ONB-15), and measures the document nodes against section reads.
6. On 2026-11-01 the remaining gaps were closed. G-8 becomes FR-22 (slice 3), G-9 becomes AUT-17 (slice 4), and G-10 becomes FR-23 with catalog entry 13. Of the smaller gaps: work-item specifications and sizes become RC-7 and RC-8, required checks after every item become AUT-16 (all slice 2), and GSD's learnings files are read by `gsd-planning`. Builds from a tag and forward-only migrations become catalog entry 14. The homelab gaps become FR-24 (host records, slice 6b) and slice 6d (the `vault:` adapter). G-4 and the dashboard are covered by decision 7.
7. On 2026-11-01 G-4 was closed as FR-25 with [ADR-012](decisions/ADR-012-architecture-model.md), and a static, read-only dashboard was scoped into the MVP as FR-26 with [ADR-011](decisions/ADR-011-static-dashboard.md). Both land in slice 4.
