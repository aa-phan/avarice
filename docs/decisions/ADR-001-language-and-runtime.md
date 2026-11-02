# ADR-001: TypeScript on Node.js with built-in SQLite

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) needs one implementation language for a local CLI and library that runs on a managed laptop without admin rights. It must persist small amounts of transactional state, spawn subprocesses, and call git, GSD and the agent host. Requirements: NFR-1, NFR-3, NFR-5, A-7 in [requirements.md](../requirements.md).

Observed on the target Mac on 2026-10-29:

- Node v26.9.0 at `/opt/homebrew/bin/node`. `require('node:sqlite')` opens a `DatabaseSync` with no experimental warning and reports SQLite 3.53.4.
- GSD 1.17.0 is Node CommonJS (`~/.claude/gsd-core/bin/gsd-tools.cjs`) and launches its hooks through a node runner. Every machine that runs GSD therefore already has Node.
- `/usr/bin/python3` is 3.9.6. Python 3.12.13 and 3.14.6 exist through Homebrew, and `uv` 0.12.7 is installed.
- The system `sqlite3` CLI is 3.43.2, older than the WAL-reset fix that sqlite.org/wal.html lists for 3.44.6, 3.50.7 and 3.51.3.

## Decision

We write AVARICE in TypeScript, restricted to erasable syntax so Node runs it with type stripping and no build step during development. A bundled JavaScript build is shipped for distribution. Persistence uses `node:sqlite`, so AVARICE has no native dependencies. The minimum supported runtime is Node 22.22.3 on the 22.x line and 24.15.0 on the 24.x line: the first releases that bundle SQLite 3.51.3, which contains the WAL-reset fix (https://sqlite.org/wal.html). Node 22.13.0 bundles SQLite 3.47.2 without the fix and cannot run `.ts` files without `--experimental-strip-types`; 22.22.3 runs them unflagged ([pre-slice-0 spikes](../../spikes/2026-11-01-pre-slice-0/README.md), 2026-11-01). From v22.13.0 and v23.4.0, `node:sqlite` is no longer behind `--experimental-sqlite` but is still experimental; from v25.7.0 it is a release candidate (stability 1.2; https://nodejs.org/api/sqlite.html, retrieved 2026-11-01). On 22.x and 24.x, AVARICE accepts the module's experimental status, and `doctor` reports it. `doctor` does not rely on the version number alone: it imports `node:sqlite`, opens an in-memory database, and reads `sqlite_version()`. A bundled SQLite older than the WAL-reset fix (3.44.6, 3.50.7 or 3.51.3 in their release lines) makes `doctor` refuse to start, so AVARICE never ships a single-process restriction.

## Consequences

**Positive:** AVARICE adds no runtime beyond the one GSD already requires, which matters on locked-down enterprise machines. The bundled SQLite on the target Mac (3.53.4, with Node 26.9.0) includes the WAL fix, so AVARICE does not depend on the outdated system `sqlite3`. A single language covers the CLI, the hook scripts and a later MCP server.

**Negative:** `node:sqlite` is younger than Python's `sqlite3` module and its API is synchronous; long queries block the event loop, which is acceptable only because the store is small. We depend on the Node release line keeping `node:sqlite`; if an enterprise pins an older Node, the store needs a fallback (`better-sqlite3`, which is a native module). TypeScript type stripping forbids enums, namespaces and parameter properties.

**Neutral:** Contract tests run under the Node test runner (`node --test`) without a framework dependency.

## Alternatives considered

**Python 3.12 with `sqlite3` and uv** - For: mature stdlib SQLite, readable for scripting, uv installs without admin. Against: adds a second runtime next to Node; the system Python on this Mac is 3.9.6, so a managed interpreter is required, which enterprise packaging may block. Why not chosen: it adds an install dependency that GSD does not already guarantee.

**Go single binary** - For: one static binary, strong subprocess control, easy cross-compilation. Against: unsigned binaries are often blocked on managed devices; no Go toolchain is installed; GSD integration code would be in a different language from GSD. Why not chosen: distribution friction on managed machines outweighs the benefit at this scale.

**Bun runtime** - For: built-in SQLite and TypeScript, fast startup; Bun 1.4.4 is installed. Against: not guaranteed on enterprise machines and not required by GSD. Why not chosen: it would be a second runtime.

## Revisit when

- An enterprise environment provides Python but blocks or pins Node below 22.22.3.
- `node:sqlite` changes its stability status or is removed.
- `status` latency misses AC-2 (p95 under 300 ms with 1,000 runs) in [requirements.md](../requirements.md#measurable-acceptance-criteria).

## References

- Node.js `node:sqlite` documentation: https://nodejs.org/api/sqlite.html
- Node.js TypeScript type stripping: https://nodejs.org/api/typescript.html
- SQLite WAL: https://www.sqlite.org/wal.html
