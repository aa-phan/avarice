# ADR-004: Modular monolith with ports only at realistic migration boundaries

| | |
|---|---|
| **Status** | Proposed; amended by [ADR-010](ADR-010-serverless-baseline-local-services.md) (optional local services) |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

The 3dmk site (https://3dmk.com/, retrieved 2026-10-29 and 2026-10-30) describes a personal agent platform. It separates durable knowledge (Seele), work execution (Scrolls), inventory (Registry), tool access (Core MCP), browser rendering (Fetch), release management (Core Publishing) and observability (NervHQ). By its own description, these run as separate services on PostgreSQL, Redis, Consul and Vault; that description was not independently verified. The separation of responsibilities is useful. The service count and the always-on infrastructure conflict with NFR-1. AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) must still keep its responsibilities apart ([architecture.md](../architecture.md#modules)) and allow later moves to a NAS (NFR-4).

## Decision

AVARICE is one package, run as short-lived commands plus a per-run supervisor. Its responsibilities are modules separated by import rules; [architecture.md](../architecture.md#modules) owns the module list. Ports exist only where a second implementation is expected within the roadmap or where the provider must be swappable per environment; [contracts-and-state.md](../contracts-and-state.md#ports) owns the port list. Policy is not a port. MCP is not an internal transport; a stdio MCP server is a thin optional wrapper over the same application services.

## Consequences

**Positive:** No service to run, deploy or keep alive. Refactoring across modules needs only a code change. The portability proof tests each port against a fake remote adapter without building a network service.

**Negative:** Modules share a process, so a crash in one aborts the command. Import rules are only as good as the lint check that enforces them. When a remote worker arrives, the `CommandExecutor` port gains a network implementation and new failure modes that in-process code never had.

**Neutral:** The structure maps onto a later split if one is ever justified: each port is already the seam.

## Alternatives considered

**Separate services per responsibility, after the reference system** - For: independent deployment, clear ownership, matches the inspiration. Against: needs a container runtime, service discovery and a database server on day one. Why not chosen: violates NFR-1 with no requirement that needs it.

**MCP as the internal bus between modules** - For: every capability is automatically exposed to any MCP host. Against: adds serialization and process boundaries to every internal call; MCP is still evolving (https://modelcontextprotocol.io/specification/latest resolved to revision 2026-07-28 on 2026-10-29, which removed connection-scoped initialization). Why not chosen: no interoperability requirement inside AVARICE.

**No ports, direct calls to git, gh and SQLite** - For: least code. Against: NFR-3 and NFR-4 become rewrites. Why not chosen: portability is a stated requirement.

## Revisit when

- A port gains no second implementation within two slices after its planned slice: merge it back.
- Two independent consumers need the same capability over the network: consider a service for that one boundary.

## References

- https://3dmk.com/ (architectural inspiration only, not verified implementation)
- https://modelcontextprotocol.io/specification/latest
