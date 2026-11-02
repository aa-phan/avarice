# ADR-003: One local SQLite database per profile, artifact bytes in a separate store

| | |
|---|---|
| **Status** | Proposed; amended by [ADR-010](ADR-010-serverless-baseline-local-services.md) (optional local services) |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) must persist runs, checkpoints, evidence, approvals and events with atomic transitions (FR-2, NFR-6), with no always-on server (NFR-1), and with profiles kept apart (SEC-1). Artifact bytes (check logs, context packs) may later move to a NAS (NFR-4). SQLite documents that WAL mode requires all processes on one host and does not work over a network filesystem (https://www.sqlite.org/wal.html), and that network filesystem locking has been known to fail and corrupt databases (https://www.sqlite.org/useovernet.html).

## Decision

Each profile has one SQLite database in WAL mode, on local storage, opened through `node:sqlite`. Artifact bytes live outside the database in a content-addressed store behind the `ArtifactStore` port; the database keeps only digests and metadata. Backups use `VACUUM INTO` to produce a consistent snapshot file, never a file copy of a live database. Schema migrations are numbered, checksummed and applied one per transaction.

`doctor` refuses to open a database whose path is on a network mount, detected by `statfs` filesystem type on macOS and Linux and by drive type on Windows. The profile configuration cannot point `dataRoot` at a network mount.

## Consequences

**Positive:** Atomic multi-row transitions with no server. Read-only commands work during writes. Artifact bytes can move to a NAS later without touching the database. Backups are consistent.

**Negative:** Concurrent workers on several machines cannot share this database. That needs a server-owned coordination service later ([deployment-and-portability.md](../deployment-and-portability.md#local-checkpoints-to-shared-coordination)), which is a real migration. Network-mount detection is heuristic; a user who bypasses it can still corrupt the store.

**Neutral:** The `sqlite3` CLI on the machine is not required; `avarice db shell` can be added later through `node:sqlite`.

## Alternatives considered

**JSON files per run with atomic rename** - For: human-readable, trivially portable, no schema. Against: no multi-record transactions, so a crash between writing the checkpoint and the evidence leaves inconsistent state; concurrent writers need a hand-built lock. Why not chosen: NFR-6 needs atomic transitions.

**Embedded PostgreSQL or a local server** - For: same engine as a future shared service. Against: a background process, which NFR-1 forbids and managed devices often block. Why not chosen: violates the baseline.

**Store blobs inside SQLite** - For: one file to back up. Against: blocks moving bytes separately; large blobs bloat the WAL. Why not chosen: conflicts with NFR-4.

## Revisit when

- Two or more machines must advance the same run concurrently.
- The store exceeds 1 GiB or `status` misses AC-2.
- An enterprise forbids local databases (then the ledger moves behind a remote adapter, with offline mode reduced to read-only).

## References

- https://www.sqlite.org/wal.html
- https://www.sqlite.org/useovernet.html
- https://www.sqlite.org/lang_vacuum.html (`VACUUM INTO`)
- https://www.sqlite.org/backup.html
