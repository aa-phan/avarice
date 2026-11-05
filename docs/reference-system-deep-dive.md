# How AVARICE differs from 3dmk

> Status: proposal. Present tense describes AVARICE's proposed design. The onboarding of one existing repository is built; its behavior as built is described in [docs/system/](system/README.md), which is the source of truth for built behavior, and the differences are listed in [docs/system/findings.md](system/findings.md). Statements about 3dmk describe its documented, running system.

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) and 3dmk both hold an agent to a design a person approved. They place human review differently. In 3dmk the developer approves each design document and, at the start of each session, the scope and plan; after that approval, subagents run unattended, held by structural checks after each change. AVARICE puts no approval at the start of a run. It enforces through an OS sandbox, a run contract and evidence gates, and stops for a person only on consequential decisions.

The reason is portability. 3dmk is portable across the hosts its author owns: the same service names, a per-host Consul and Vault, and one image that runs at home and on AWS. AVARICE must be portable across environments it does not own: a lone laptop with no server, and an employer's identity, tracker, CI and secret systems. So AVARICE requires no service, keeps knowledge in repository files, and puts every external system behind a port.

3dmk's documentation shows growth by adding services and hosts its author controls, although it states no scaling goal. AVARICE grows by swapping adapters behind those ports; past one machine, that path is designed but not built. The [comparison](reference-system-comparison.md) keeps the audit record: the component mapping, the gaps, the author's answers and the decisions taken.

## Sources

The primary source is the 3dmk documentation at https://3dmk.com/documentation, version 2.1.3, retrieved on 2026-11-01. It was read from its Markdown downloads: 19 documents and two SQL schemas under `https://3dmk.com/downloads/`. File names below refer to those downloads. The documentation is by Nick Olson and licensed under CC BY 4.0; this document paraphrases it and quotes no more than short phrases.

The 3dmk homepage (version 2.0.5) and the author's answers to the repository owner are secondary sources, used as in the [comparison](reference-system-comparison.md#sources-and-limits). Where the homepage and the documentation disagree, the documentation wins. One such case matters here: Seele's vector search is deferred (`seele.md`), although the homepage describes it.

## The two methods side by side

| Stage | 3dmk | AVARICE | Design choice behind the difference |
|---|---|---|---|
| Idea to design | A conversation, then a document chain in Seele: Overview, Vision, Product, Technical, Magi, Planning. The developer approves each document, and the agent checks it against the one before (`concept-to-seed.md`) | GSD's own discussion, planning and `ingest-docs`; AVARICE adds a brief with acceptance criteria and compiles a run contract ([contracts-and-state.md](contracts-and-state.md#run-contract)) | AVARICE owns no design documents. GSD owns them and they live in the repository (ONB-2, [ADR-002](decisions/ADR-002-gsd-integration-mode.md)) |
| Design to work | `trigger scrolls` seeds Scrolls after a dry run and a confirmation. Every task carries an agent specification, dependencies, and an acceptance-criteria and a testing subtask | The contract lists one to five work items with dependencies; each acceptance criterion names the checks that verify it | AVARICE delegates decomposition to GSD and keeps work items inside one run |
| Execution | `trigger orchestration` opens each session with a stop: the developer confirms the scope and approves the plan. The orchestrator then routes items to subagents, picking Haiku, Sonnet or Opus by item size; a sample schedule shows four at once, and no limit is stated (`orchestration.md`) | A supervisor starts contained headless `claude -p` invocations, one GSD unit each; no session-start approval; a pause becomes a decision record ([ADR-006](decisions/ADR-006-unattended-delegation.md)) | AVARICE moves human review from the start of each session to consequential decisions, so work continues while the developer is away |
| Validation | The orchestrator treats a subagent's report as a claim and runs every check itself. The whole suite runs after every item, and Atlas shows whether a change stayed in bounds | Gates G0 to G4 bind evidence to one revision; required checks run after every item (AUT-16); G2 checks path scope and, from slice 4, symbol scope against the item's specification (AUT-17); an optional mutation gate ([contracts-and-state.md](contracts-and-state.md#phase-gates)) | Same principle: no self-reported success. AVARICE adopted 3dmk's per-item checks and symbol-level bounds as requirements |
| Structural integrity | Magi is checked at each epic's close; one reconciliation job checks documents against each other and the configuration files, and another checks code through Atlas (`reconciliation.md`) | GSD's drift check refreshes the codebase map; a later review-only reconciliation compares the map and listed documents with the code (FR-23, catalog entry 13) | AVARICE has no design model of its own (ONB-2), so it reviews documents against code without a Magi-style graph |
| Release | One tag, one image, development first, production after approval, guards, forward-only database patches, rollback to the previous release (`orchestration.md`, `publishing.md`) | Stops at a reviewable change or a draft PR; merge, publish and deploy need separate authorization (AUT-11) | Release belongs to the employer's or the user's own release system |
| Oversight | NervHQ dashboard with sessions, token use, queues and health (`nervhq.md`) | `status`, `doctor`, inbox, a hash-chained event log and a static HTML dashboard (FR-26) | No server on the baseline (NFR-1), so the dashboard is a generated file |

## Component by component

### Seele: durable knowledge

**3dmk.** One FastAPI service over three PostgreSQL tables: `node`, `edge` and `node_version` (`seele-schema.md`). A node carries a six-character base62 ID, title, type, theme, subject tags, Markdown content without headings, an optional vector and a `tokens` count. Every edge has one of three relations, and the relation decides how much a read loads:

- `hasPart` loads every descendant;
- `requires` loads the target one hop deep;
- `references` returns only the target's ID.

Search ranks title, then subject tags, then content, and returns node handles without content. Reads walk an in-memory rustworkx graph, and PostgreSQL stays the source of truth. Every write stores a full snapshot in `node_version`.

**AVARICE.** Knowledge stays in repository files. GSD writes the codebase map and planning documents. Onboarding builds GSD intel and one graphify graph, with code nodes and document nodes for stable documents (ONB-13, ONB-14). The context pack queries those first and cites path and revision ([contracts-and-state.md](contracts-and-state.md#contextsource)).

**Choice.** Files travel with the repository into any environment, need no server, and stay under the employer's source control. The cost is precision. Seele's typed relations and per-node token counts let a caller see a read's cost and size before loading anything. AVARICE adopts the same idea as FR-22: sources return handles with token estimates before any content, and graph reads follow a rule per edge type ([contracts-and-state.md](contracts-and-state.md#contextsource)).

### Scrolls: work tracking

**3dmk.** A FastAPI service that is the only reader and writer of a 15-table PostgreSQL schema (`scrolls-schema.md`). Themes hold initiatives, initiatives hold epics, and epics hold stories, tasks and bugs, each with subtasks. Check constraints hold names to kebab case and identifiers to forms such as `MCP-TASK-002-000003`. A trigger rejects a status that does not apply to the row's kind. `scroll_size` maps each size to a default model. Every work-item table carries `agent_spec` and `depends_on`, and stories also carry `doc_references` and `standards_references` (`scrolls-schema.sql`). Core MCP exposes 50 tools for the lifecycle.

**AVARICE.** GSD owns milestones, phases and plans. AVARICE's work items live in the ledger for one run, and an enterprise tracker stays authoritative through the `TaskSource` port.

**Choice.** A personal tracker cannot replace an employer's tracker, so AVARICE reads trackers instead of owning one. Two Scrolls ideas apply anyway: an agent specification that names files and signatures for each item, and a model chosen per item size. AVARICE adopts both: every work item carries a size that picks its model and a specification of files, symbols, configuration keys and cited documents (RC-7, RC-8).

### Registry and Atlas: inventory and code structure

**3dmk.** One FastAPI service with seven parts, including a write lock, an ID minter and a Git client (`registry.md`). Agents read and write through its API. Behind it, the records sit in one JSON file in a dedicated Git repository. Each change rewrites the file atomically and commits it, and a loop pushes to GitHub every 60 seconds. The schema (`registry-schema.md`, version 1.2) defines theme, project, source, libraries, host and meta records with length and character limits. It has 10 project types and 13 source types. Records are deactivated, never deleted, and a host stays active while a source deploys to it. Atlas parses five languages into one snapshot per commit, kept in a separate local Git repository, so a Git diff shows structural change.

**AVARICE.** The `inventory` module and versioned project records in the profile's SQLite ledger hold operational metadata per repository. The graphify code graph from onboarding plays Atlas's role, with its build commit in the project record.

**Choice.** The two designs agree more than they differ. Both use one local store with atomic writes, an audit trail and no deletion. AVARICE's store is per profile, so personal and employer records never mix (SEC-1). The difference is use. 3dmk's orchestrator checks every change against Atlas: a class the specification never named, an import the library matrix does not approve, or a job the graph gives another component sends the change back (`orchestration.md`). G2's scope check in AVARICE covered paths only; AUT-17 adds a symbol-level check from the code graph in slice 4 (gap G-9).

### Magi and reconciliation: design held against code

**3dmk.** Magi restates the Technical document as a typed graph of services, processes, interfaces, data stores, applications and views. Every data edge names the model that crosses it, and shared systems carry one UUID in every graph (`concept-to-seed.md`, `reconciliation.md`). A node without running code leaves the graph. Two jobs run in review, reconcile or refactor mode (`reconciliation.md`). The documentation job checks the documents against each other and the configuration files and never reads code. The code job reads the code through Atlas and scores each Technical section `aligned`, `drift`, `missing` or `contradicted`. Every finding cites evidence, and a guess is not recorded. Only an approved document changes the design.

**AVARICE.** GSD owns the architecture document. AVARICE validates onboarding artifacts for presence, stamp, scope, path references, secrets and size, and refreshes the map on drift ([repository-onboarding.md](repository-onboarding.md#validation)).

**Choice.** Not owning design documents keeps AVARICE thin and leaves GSD as the single source of meaning. A machine-checkable design therefore lives in the repository as `.avarice/architecture.json`, which the user approves and AVARICE checks against the code graph (FR-25, [ADR-012](decisions/ADR-012-architecture-model.md)). The review-only reconciliation (FR-23) compares documents with code.

### Core MCP: the tool surface

**3dmk.** One Rust program serves 107 tools in 11 groups (`core-mcp.md`). In proxy mode it runs on each developer machine, runs file, Git, Docker and PowerShell tools locally, and forwards the rest. In service mode it runs on a server with no file, Git, shell or Docker access, and passes each call to the service that owns it. Relays fail over in order and skip a failed relay for 30 seconds. Any Registry host with a Core MCP address can run a tool through a `remote_host` argument. Tools load by group, so a session carries only what it needs.

**AVARICE.** The agent uses the host's built-in tools inside an OS sandbox with generated host settings and a fail-closed hook. AVARICE itself is a CLI; an MCP server is a later, optional wrapper ([extensions.md](extensions.md)).

**Choice.** Core MCP is a routing layer that gives the agent one map of the environment. It does not claim to contain the agent, and the host's built-in tools remain beside it. AVARICE's first need is containment that holds without a person present, which only the host and OS can enforce. A gateway would also be one more service to run inside an employer. The `remote_host` pattern returns in AVARICE as the remote worker behind `CommandExecutor` ([deployment-and-portability.md](deployment-and-portability.md#local-execution-to-remote-worker)).

### Publishing and infrastructure: release

**3dmk.** A stateless CLI and a service that records manifests, stacks, deployments and drift events in PostgreSQL, with a Redis deploy queue (`publishing.md`). A deploy takes a tag that exists on the remote and builds from an archive of it. One image runs in both environments, each supplying its own configuration and secrets. Stacks move through `planned`, `applying`, `running`, `stopped`, `failed`, `destroying` and `destroyed`. An infrastructure service answers apply, describe, list, discover and destroy for seven AWS services (`orchestration.md`).

**AVARICE.** Ends at a reviewable change; delivery to a pushed branch and a draft PR needs contract authorization.

**Choice.** Release is where employers differ most and control most, so AVARICE leaves it to the release system in place. Two 3dmk rules carry over directly to any repository AVARICE works on. A build comes from a tag, never the working tree, and a database patch only moves forward. Catalog entry 14 specifies both as checks a repository declares ([extensions.md](extensions.md#14-release-hygiene-checks-later)).

### NervHQ: oversight

**3dmk.** A React dashboard served as static files, over a FastAPI service with collector daemons, a scheduler, PostgreSQL, Redis and WebSocket streams (`nervhq.md`). A session ingester sums token use per session, model and agent every minute, and Core MCP sends a typed close event at the end of each session.

**AVARICE.** Events in the ledger with correlation IDs, `status`, `doctor`, the decision inbox and budgets per run ([operations-and-testing.md](operations-and-testing.md#observability)).

**Choice.** A served dashboard needs a server, which the baseline forbids. AVARICE renders a static, read-only HTML page from the ledger instead, with `--watch` regenerating it while the command runs (FR-26, [ADR-011](decisions/ADR-011-static-dashboard.md)). The coordination service in slice 6c would make a served, multi-client dashboard possible.

### Consul and Vault: addresses and secrets

**3dmk.** Each Docker host runs its own Consul and Vault under the same names, so one compose file deploys to either host (`consul-vault.md`). Services find each other by name at call time. Each service authenticates to Vault with its own identity and reads only its own secrets, holding them in memory. The standard forbids secrets in source, environment files, plaintext configuration or a local secret store.

**AVARICE.** No service discovery: worker endpoints are configured explicitly with pinned keys. Credentials go through a broker over the macOS Keychain, vendor CLIs and approved helpers; no environment variables; every lookup audited; none inside a contained run ([ADR-009](decisions/ADR-009-credential-broker.md)).

**Choice.** The two standards differ in scope; the [comparison](reference-system-comparison.md#differences-by-design) records the difference and ADR-009 the reasoning. Vault protects every service from every other; AVARICE's threat is the agent, and containment answers that. On a homelab, ADR-009's `vault:` adapter closes the gap for the personal-extended profile.

### Nexus: packages

**3dmk.** Every build resolves through one Nexus group per language that joins a proxy of the public registry and a hosted repository for internal packages (`nexus.md`). Machine-level settings send every install through the group. Two checks compare the proxy cache with OSV and record blocked versions in Seele.

**AVARICE.** New dependencies need a human decision. A later dependency audit check runs the repository's own audit tool against a declared registry or mirror ([extensions.md](extensions.md#10-dependency-audit-check-later)).

**Choice.** An employer's package mirror and policy outrank anything AVARICE could impose, so AVARICE consumes a mirror rather than running one.

### Postgres and Redis: state

**3dmk.** Each project gets its own database, and each service that uses it gets its own login role; no service role holds superuser rights (`postgres.md`). `core-db` applies numbered patches, each in one transaction, refuses to run when an applied patch was edited, and refreshes grants after every run. Redis is the only cache, keyed `<service-id>:<domain>:<key>`. It never writes to disk and refuses writes when full instead of evicting (`redis.md`).

**AVARICE.** One SQLite database per profile on local disk, numbered and checksummed migrations one per transaction, `VACUUM INTO` backups, no cache server ([ADR-003](decisions/ADR-003-local-persistence.md)).

**Choice.** The migration discipline is the same. The engine differs because the baseline allows no database server. PostgreSQL arrives with the coordination service when more than one machine writes. Redis has no role at AVARICE's scale.

### Fetch and Design: rendering

**3dmk.** Fetch queues browser requests and runs each in an isolated Chromium context, two at a time by default (`fetch.md`). It returns title, text capped at 20,000 characters, HTML and screenshot artifacts. Queued requests live only in memory. Design renders design files in a browser frame for review and reads the Design knowledge base in Seele (`design.md`).

**AVARICE.** A later browser check runs Playwright inside the sandbox against a local server ([extensions.md](extensions.md#11-browser-check-later)).

**Choice.** A browser check per repository needs no shared service. A long-lived browser service suits 3dmk's research and design work, which AVARICE does not cover.

## Portability

3dmk is portable across hosts its author owns; AVARICE is portable across environments it does not own.

| Mechanism | 3dmk: portable across hosts it owns | AVARICE: portable across environments it does not own |
|---|---|---|
| Where state lives | PostgreSQL per service on each Docker host; the Registry in a Git-backed JSON file | One SQLite file per profile on local disk; artifacts content-addressed and movable ([ADR-003](decisions/ADR-003-local-persistence.md)) |
| How parts find each other | Consul names, identical on every host | Ports and adapters inside one process; explicit endpoints for remote workers |
| Secrets | Vault per host, one identity per service | A broker over whatever store the environment approves ([ADR-009](decisions/ADR-009-credential-broker.md)) |
| Knowledge | Seele nodes in PostgreSQL | Repository files and GSD indexes, which move with the repository |
| Tool access | Core MCP on every machine, relays on servers | The host's built-in tools, contained by the OS sandbox |
| Install | Core bootstrap brings up foundation, infrastructure and application tiers | A CLI with no admin rights and nothing listening on a port ([deployment-and-portability.md](deployment-and-portability.md#local-baseline)) |
| Offline | Inferred, not stated in the documentation: local tools keep working, and forwarded tools need the relays | Status, decisions, verification and context from local indexes work offline ([offline matrix](deployment-and-portability.md#offline-matrix)) |
| Inside an employer | The same stack runs at work (author's answer 7) | A separate enterprise profile that defers to company identity, tracking, CI, secrets and release ([enterprise-adaptation.md](enterprise-adaptation.md)) |
| Moving to new hardware | Inferred from `consul-vault.md`: bootstrap a new host under the same service names | Swap one adapter and run its migration command ([migration matrix](deployment-and-portability.md#migration-matrix)) |

3dmk's documentation does not address employer restrictions. AVARICE assumes an employer may forbid its services and stores, so every external integration has a manual equivalent (FR-19), every external system sits behind a port, and personal and employer data never share a store.

## Scalability

| Dimension | 3dmk today | AVARICE in the MVP | AVARICE's designed path |
|---|---|---|---|
| Repositories | 124 to 135 in 15 or 16 themes in one Registry; the homepage gives both figures | One project record per repository, onboarded one at a time | Project groups and cross-repository runs (slice 7, AUT-15) |
| Concurrent agent work | Parallel subagents per orchestrator session, four in the sample schedule, model chosen by item size | Several work items per run with a dependency scheduler; subagent budgets reserved atomically (CON-13, CON-15) | Remote workers, then concurrent workers with leases and fencing (slices 6b, 6c) |
| Data and writers | Several PostgreSQL instances (a general one and a Seele one on the development host, one in production), many services writing | One SQLite file, one machine writing | A coordination service that owns PostgreSQL behind the `Ledger` port |
| Retrieval cost | Per-node token counts; reads expanded by relation type; search returns handles first | Token budget per pack, per-step retrieval caps, index-first queries; handle-first retrieval and read rules per edge type from slice 3 (FR-22) | Unchanged in shape; the indexes grow with project groups (slice 7) |
| Machines | Five, in two roles (homepage figures) | One Mac, awake (A-8) | NAS artifacts, a remote worker, a coordination service (slice 6) |
| Verification cost | Whole suite after every item; Atlas checks per change; Magi per epic | Required checks after every item and at G4 (AUT-16); symbol-level scope checks from slice 4 (AUT-17); mutation gate on changed lines | Review-only reconciliation (FR-23, later) |

3dmk's numbers describe a system in use. AVARICE's last column is a plan. Each step there replaces one adapter, keeps domain code unchanged (NFR-4), and starts only when a measured need exists, as each slice 6 part states ([implementation-plan.md](implementation-plan.md#slice-6-personal-infrastructure-later-each-part-independent)).

## Convergence on a homelab

A homelab removes AVARICE's no-server constraint for the personal-extended profile only. The enterprise profile keeps the employer's systems.

| AVARICE today | On a homelab | Result |
|---|---|---|
| No long-lived services | A remote worker (slice 6b) and a coordination service (slice 6c) | Partly converges: two services, against 3dmk's full set |
| SQLite | PostgreSQL owned by the coordination service; local SQLite becomes a read cache | Converges, with the same patch discipline as `core-db` |
| Artifacts on the Mac | An `s3` adapter on the NAS (slice 6a) | Converges |
| Work only while the Mac is awake | The worker runs checks, then contained agent invocations once its Linux containment suite passes | Converges with 3dmk's split between directing and serving machines |
| Explicit worker endpoints | Unchanged; Core MCP's `remote_host` lookup shows the alternative | Stays different until the number of workers makes host records worth keeping |
| Credential broker | A `vault:` adapter ([ADR-009](decisions/ADR-009-credential-broker.md)) | Converges for the personal profile |
| Static dashboard file | The coordination database gives a served dashboard something to read | Can converge; the served form is not designed |
| No package mirror | A homelab mirror becomes the declared registry for the dependency audit check | Converges if you run one |

Three rules hold after any move. Every homelab service is an optional adapter, and the personal-local profile still works on the Mac alone. Every move is explicit and has its own migration command. Homelab services serve the personal profile only.

Two needs a migration would expose are specified. Host records follow 3dmk's rule of refusing to deactivate a host still in use (`registry-schema.md`): FR-24, in slice 6b. The `vault:` adapter is specified in [contracts-and-state.md](contracts-and-state.md#credentialprovider) and scheduled as slice 6d.

## Gaps from the documentation

The [comparison](reference-system-comparison.md#gaps-in-avarice) owns the gap list, including the gaps this documentation added (G-8 to G-10 and three smaller gaps) and the release checks in catalog entry 14. Its [decisions taken](reference-system-comparison.md#decisions-taken) record how each was closed.
