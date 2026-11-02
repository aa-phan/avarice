# ADR-011: Ship a static, read-only dashboard in the MVP

| | |
|---|---|
| **Status** | Proposed; narrows the dashboard non-goal in [requirements.md](../requirements.md#non-goals) |
| **Date** | 2026-11-01 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) needs one overview of a profile's runs, work items, decisions, gates, budgets and onboarding records. NFR-1 forbids a server in the baseline, so a live, served dashboard is out of reach there. The CLI views (`status`, `doctor`, the decision inbox) fragment that picture once runs have several work items. The 3dmk reference system shows the value of one screen for runs, sessions, queues and health (NervHQ; [reference-system-deep-dive.md](../reference-system-deep-dive.md#nervhq-oversight)).

## Decision

1. `avarice dashboard` renders one self-contained HTML file from the profile's ledger and opens it in the default browser (FR-26). The page inlines its styles and scripts, loads nothing from the network, and needs no server or listening port.
2. The page is read-only. It shows runs and their states, work items, open decisions, gate results and evidence summaries, budgets and spend, onboarding records with index freshness, and recent events. Answering a decision stays in the CLI, where identity and state-digest checks run (`avarice decide`).
3. `avarice dashboard --watch` regenerates the file when the ledger changes, for as long as the command runs, and the page reloads itself. Nothing runs after the command exits.
4. The file is written under the profile's data root with mode `0600`, never into a repository. Its content passes through the same redactor as events (SEC-3), and it shows one profile only (SEC-1).
5. A served, multi-client dashboard stays outside the MVP. It becomes possible with the coordination service or a local-services deployment ([ADR-010](ADR-010-serverless-baseline-local-services.md)).

## Consequences

**Positive:**
- One screen for the whole profile, available offline, on a managed device, with no port and no daemon.
- The page is a file, so it can be attached to a review or archived as an artifact.

**Negative:**
- No live push: freshness depends on `--watch` or a rerun.
- Rendering code and a page template become part of the `observe` module, with snapshot tests to maintain.
- A copied HTML file carries redacted run data outside the data root; the user must treat it like an export.

**Neutral:** The non-goal narrows to dashboards that need a server or a listening port.

## Alternatives considered

**Local web server on `localhost` while the command runs** - For: live updates and interaction. Against: a listening port, which some endpoint-security policies flag, and interaction would need authentication for decision answers. Why not chosen: the static file meets the need without a port; a served dashboard can follow ADR-010's rules later.

**Terminal user interface** - For: no browser, works over SSH. Against: weaker for tables, graphs and links to evidence. Why not chosen: `status` already covers the terminal; the gap is an overview page.

**No dashboard in the MVP** - For: less to build. Against: oversight of multi-item runs, decisions and budgets stays fragmented across commands. Why not chosen: oversight of multi-item runs needs one view, and the static page provides it without a server.

## Revisit when

- Rendering 1,000 runs misses AC-15.
- Two machines write the same ledger (slice 6c), which makes a served dashboard over the coordination database worth building.
- Users need to answer decisions from the page.

## References

- [operations-and-testing.md](../operations-and-testing.md#observability)
- [architecture.md](../architecture.md#modules)
- 3dmk documentation, version 2.1.3: `nervhq.md`
