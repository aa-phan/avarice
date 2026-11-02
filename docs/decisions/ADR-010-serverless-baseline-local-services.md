# ADR-010: Keep the serverless baseline; allow an optional local-services deployment

| | |
|---|---|
| **Status** | Proposed; amends [ADR-003](ADR-003-local-persistence.md) and [ADR-004](ADR-004-modular-monolith-and-ports.md), whose no-server stance now holds for the baseline only |
| **Date** | 2026-11-01 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) requires no server for its baseline (NFR-1). [ADR-004](ADR-004-modular-monolith-and-ports.md) builds on it with one package and ports instead of services.

3dmk runs a full set of services and, by its author's account, is used at work too ([reference-system-comparison.md](../reference-system-comparison.md#the-authors-answers)). That raises the question of whether a serverful design would be just as portable if every service ran locally on the developer's machine. Three findings answer it:

- **Most of 3dmk's services are not local.** Fetch (for now) and the Design site run on the workstation (`fetch.md`, `design.md`), and the rest run on a separate home Docker host and on AWS. The workstation runs Core MCP in proxy mode and forwards calls to them (3dmk documentation: `core-mcp.md`, `consul-vault.md`). Used at work, that design either sends company material to personal servers or needs a copy of the stack inside the employer.
- **Local services solve data locality and leave the permission problem.** Services kept on one machine keep company data on that machine. They still need a container runtime or native daemons. Many managed devices block both, and installing either usually needs admin rights. Docker Desktop also needs a paid subscription at companies with 250 or more employees or $10 million or more in revenue (https://docs.docker.com/subscription-billing/desktop-license/, retrieved 2026-11-01). The enterprise compatibility table already lists "containers blocked" and "background daemons forbidden" as cases AVARICE must survive ([enterprise-adaptation.md](../enterprise-adaptation.md#compatibility-assessment)).
- **Conflicts come from duplicating systems of record, wherever they run.** Each of these collides with enterprise rules: a local Vault holding company tokens, a package mirror forced on every install, a private tracker treated as the record, or a DNS change for discovery. Running the server locally changes none of that.

So a local-services design is as portable as the serverless one on machines that allow containers or daemons, and less portable on machines that do not. Single-user AVARICE also gains nothing from a local database server today: in-process SQLite gives the same transactions with no second writer ([ADR-003](ADR-003-local-persistence.md)).

## Decision

1. **The baseline stays serverless.** NFR-1 is unchanged. Every capability in the MVP works with no container runtime, no daemon and nothing listening on a port.
2. **A local-services deployment becomes a supported option.** The same service adapters planned for a homelab ([deployment-and-portability.md](../deployment-and-portability.md#local-services-deployment)) may run on the developer's own machine on `localhost`, through Docker Compose, Podman or native installs. The adapter and its configuration are the same; only the endpoint differs. Moving a service from `localhost` to a homelab is an endpoint change plus that service's migration command.
3. **Where it is allowed.** The personal-extended profile may use it freely. An enterprise profile may use it only when the onboarding questionnaire confirms containers or daemons are permitted (question 25).
4. **Each service stays optional.** A stopped or missing local service degrades exactly as an unreachable homelab service does. The ledger falls back to read-only and local drafts. Artifact writes fall back to local disk only where the profile allows it, and no run starts without enforcement.
5. **Services never replace a system of record.** In an enterprise profile, no local service holds company credentials, acts as the package source, or records work in place of the company tracker. A local service may cache or index company data that stays on the device.
6. **Services stay local to the machine.** They bind to `localhost` only. AVARICE changes no DNS resolver, proxy or machine-wide package setting, unlike 3dmk's Consul DNS and Nexus group (homepage chapter 11; `nexus.md`).
7. **A service is added only for a measured need.** The slice 6 triggers apply unchanged ([implementation-plan.md](../implementation-plan.md#slice-6-personal-infrastructure-later-each-part-independent)). A further trigger is the need for a live dashboard, or a knowledge service shared by several sessions, as with 3dmk's Seele.

## Consequences

**Positive:**
- AVARICE still installs and runs on the most locked-down device it targets.
- Where containers are allowed, the services listed in [local services deployment](../deployment-and-portability.md#local-services-deployment) run without a second machine.
- The homelab path and the local path share adapters, configuration and migration commands, so neither is a separate design.

**Negative:**
- Two supported deployments for the same services double the deployment test matrix: `localhost` and remote endpoints for each slice 6 part.
- A local-services user operates the services: start order, health checks, port clashes, upgrades and backups.
- Running PostgreSQL on the same laptop as the CLI adds a server without adding a second writer, unless several processes share it.

**Neutral:** The enterprise questionnaire grows by one question.

## Alternatives considered

**Serverful baseline, as in 3dmk** - For: one architecture everywhere; richer services from day one, such as a shared in-memory knowledge graph and a dashboard. Against: fails on devices that block containers or daemons; Docker Desktop licensing; operations burden on every machine. Why not chosen: violates NFR-1 and the enterprise rule that AVARICE must run where the employer allows only user-space tools.

**Strictly serverless forever** - For: one deployment to test. Against: the slice 6 services are already specified as adapters, and forbidding them on `localhost` would force a homelab purchase for capabilities one machine can host. Why not chosen: no requirement gains from it.

**Local services required only in the personal profiles** - For: a richer personal setup. Against: the personal-local profile is the one used on a laptop that may later be managed; requiring services there breaks the path to an enterprise profile on the same machine. Why not chosen: decision 3 already lets personal-extended use them.

## Revisit when

- An employer is known and its questionnaire answers permit containers, which may make the local-services deployment the default there.
- A need appears that only a long-lived service meets: concurrent writers, a live dashboard, or a shared knowledge service.
- The local-services matrix proves too costly to test; then support only the homelab endpoint.

## References

- [deployment-and-portability.md](../deployment-and-portability.md)
- [reference-system-deep-dive.md](../reference-system-deep-dive.md#portability)
- [ADR-003](ADR-003-local-persistence.md), [ADR-004](ADR-004-modular-monolith-and-ports.md), [ADR-009](ADR-009-credential-broker.md)
- https://docs.docker.com/subscription-billing/desktop-license/
- 3dmk documentation, version 2.1.3: `core-mcp.md`, `consul-vault.md`, `nexus.md`, `fetch.md`, `design.md`
