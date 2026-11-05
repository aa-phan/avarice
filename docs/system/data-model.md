# Data model

This document describes what AVARICE persists, as implemented in `src/adapters/sqlite/`, `src/adapters/fs/`, `src/domain/project-record.ts`, `src/ports/ledger.ts` and `src/ports/artifact-store.ts`.

AVARICE keeps three kinds of state: one SQLite file per profile (the ledger), a content-addressed blob store beside it, and working directories under a separate work root. The ledger holds 20 tables; 14 are written by the built code and 6 are created empty and have no writer. In the data root nothing is ever deleted: rows only grow, events are append-only by trigger, and no code prunes blobs, backups or per-invocation directories. Columns belong to the migration; this document states mechanisms and consequences. Hook rules are in [containment.md](containment.md), lifecycle transitions in [onboarding.md](onboarding.md), CLI flags in [cli-reference.md](cli-reference.md).

## Profile roots on disk

A profile has three roots. Only one profile exists, named `personal-local`; the name is fixed in code.

| Root | Default | Override | Holds |
|---|---|---|---|
| Config home | `~/.config/avarice` | `AVARICE_CONFIG_HOME` | `profiles/personal-local/config.json` |
| Data root | `~/.local/share/avarice/personal-local` | `AVARICE_DATA_ROOT` | the ledger, backups, artifacts, per-invocation files |
| Work root | `~/.local/share/avarice-work/personal-local` | `AVARICE_WORK_ROOT` | staging clones and graph build output |

Resolution rules:

- Every root is resolved through the real path of its nearest existing ancestor before anything is created, so a symlinked root is judged by where it lands.
- A data or work root is refused when it lies under any `~/.claude*` directory or under the Claude config directory, when it would contain the home directory or the Claude config directory, or when the two roots are nested in either direction.
- The data root must be on a local mount. On macOS the `mount` output must carry the `local` flag; on Linux a mount is local unless its type is a known network type. This is a heuristic, so a synced or FUSE mount that reports local passes.
- Directories are created with mode 0700. The config file is created with mode 0600 only when absent and is never rewritten. The built code writes it and never reads it: the roots always come from the environment and the defaults, so editing the file changes nothing. `init` only prints its path.
- `init` warns, but does not fix, a root whose mode lets other users in.

## The ledger file

The ledger is `state.db` in the data root. Facts that bind every opener except the hook:

- **Runtime gate.** Before any open, the bundled SQLite version must contain the WAL-reset fix: 3.44.6 or later on the 3.44 line, 3.50.7 or later on 3.50, 3.51.3 or later on 3.51, and any line above 3.51. Lines 3.45 to 3.49 never received the fix and are refused, as is a version string that does not parse. The refusal names the Node version to install.
- **Modes.** A new store is created 0600, and SQLite gives the `-wal` and `-shm` siblings the same mode. Each of the three files that exists must be owned by the current user, otherwise the open is refused and nothing is changed. A read-write open tightens an owned file that group or others can reach to 0600 and leaves a stricter mode (0400) alone. A read-only open never changes a mode.
- **WAL.** A read-write open switches the journal to WAL and fails if the switch does not take effect (a filesystem that cannot share memory). It sets full synchronous mode. Foreign keys are enforced and a busy store is waited on for 5 seconds before reporting unavailable.
- **Transactions.** Every write is an immediate-mode transaction, so a writer conflict surfaces at the start and a killed writer's open transaction rolls back on the next open. Each state-changing ledger operation is one transaction: either all its rows commit or none do.
- **Error mapping.** Busy and locked map to unavailable (retryable), constraint violations to conflict, values with no canonical JSON form to invalid, everything else to internal.
- **Two processes write.** The CLI process through the ledger, and the PreToolUse hook process, which opens the same file directly to charge budgets and append events. Both rely on SQLite's file locking, and each waits on a busy store (5 seconds for the CLI, 4 for the hook).
- **Hook open.** The hook opens an existing ledger read-write on its own connection with a 4 second busy wait. It does not run the version gate, the ownership and mode check or the WAL switch, and it refuses a ledger path that does not exist rather than creating one.

### Migrations and schema version

Schema version 1 is the only migration. The version is stored in the `meta` table under `schema_version`, and `init` and `status` read it from there. `meta` also holds `profile_id`, written once (insert-or-ignore) by the migration pass that applies the last pending migration.

The runner is forward-only:

- Each applied migration records its version, time and the SHA-256 of its SQL text in `schema_migrations`.
- Before applying, every recorded migration is checked against the shipped text. A different checksum, or a recorded version this build does not ship (a store from a newer build), refuses the store with a conflict error and changes nothing, including no backup. A checksum mismatch also tells the operator that an applied migration must never be edited and to restore from backup or run the build that wrote it. The CLI turns this into exit 70.
- Versions must be contiguous; a gap is refused.
- Each pending migration, its `schema_migrations` row and the `schema_version` update commit in one transaction. A failing migration rolls back alone; earlier ones in the same pass stay applied.
- Before the first pending migration is applied to a store that already has history, the store is copied with `VACUUM INTO` to `backups/pre-migration-{timestamp}.db` beside the database (mode 0600, directory 0700; a numeric suffix avoids collisions). If the copy cannot be written, no migration runs. A fresh store with no history gets no backup, and neither does an in-memory database.
- Backups accumulate; nothing removes them.

The migration also installs four triggers: a stored project record's body and digest cannot be updated, a stored contract's body and digest cannot be updated, and events cannot be updated or deleted.

Quirk: a command that is meant to be read-only first checks for pending migrations. When there are none it opens read-only. When there are some, it opens read-write, migrates (with a backup), then reopens read-only. A read-only command can therefore write once, on the first run after an upgrade.

No table has a secondary index. Lookups rely on primary keys and unique constraints only.

## Tables by purpose

All 20 tables are created by the single migration. A writer is code that inserts or updates rows: every such statement sits in the ledger adapter, the migration runner or the hook.

### Bookkeeping

| Table | Writer | Notes |
|---|---|---|
| `meta` | migration runner | `schema_version`, `profile_id` |
| `schema_migrations` | migration runner | one row per applied migration, with checksum |

### Projects and onboarding

| Table | Writer | Notes |
|---|---|---|
| `projects` | register | one row per repository, unique on root commit plus repository path; registering again returns the existing row |
| `onboardings` | create, transition, lease, checkpoint, store-contract | the operational spine; carries state, row version, lease and the staging path |
| `onboarding_steps` | step recorder | one row per onboarding, step name and attempt number |
| `project_records` | activation | versioned records, see the project record section |
| `adapter_configs` | CLI composition | one row per named adapter, upserted each time a non-read-only command starts |

### Run-shaped tables used by onboarding

An onboarding has no run until its contract is stored. Storing the contract creates a carrier run (state fixed at `onboarding`) that the contract, budgets, attempts and later checkpoints hang off.

| Table | Writer | Notes |
|---|---|---|
| `runs` | store-contract | inserted once per onboarding; no code updates it afterwards, so its state and version never change and its own lease columns are unused (leases live on `onboardings`) |
| `contracts` | store-contract | one row per run and version; the built code stores version 1 only; body and digest are immutable by trigger |
| `budgets` | store-contract, hook, budget accounting | see budgets |
| `attempts` | attempt recorder | ordinal increments per carrier run |
| `checkpoints` | create, transition, checkpoint | see checkpoints |

### Log and artifact index

| Table | Writer | Notes |
|---|---|---|
| `events` | ledger and hook | append-only hash chain, see event log |
| `artifacts` | artifact recorder | index of stored blobs, see artifact store |

### Tables with no writer

| Table | Evidence of absence |
|---|---|
| `task_refs` | no statement in the source writes or reads it |
| `evidence` | same |
| `gate_results` | same |
| `approvals` | same |
| `decisions` | same |
| `work_items` | same |

These six exist in the schema and stay empty. The port has no method for them. Two unused columns also sit in written tables (a checkpoint's item and GSD state digest); no code sets them.

## Event log

The event log is the `events` table: one row per notable fact, chained by hash.

- **Append-only.** Triggers abort any update or delete. Sequence numbers come from an autoincrementing key, so they are never reused.
- **Chain.** Each row stores the previous row's hash; the first uses 64 zeros. The row hash covers the previous hash, the timestamp, the type, the run id (or empty) and the canonical data JSON. It does not cover the level, attempt id or invocation id. The previous hash is read inside the writer's transaction, so the CLI and the hook continue one chain. No shipped code verifies the chain, so tampering is detectable only by an external check.
- **Size limits.** Event data is for identifiers, counts, digests, exit codes and short targets, never payloads. A string longer than 1024 characters anywhere in the data, or canonical data JSON longer than 8192 characters, is refused as invalid and the whole transaction rolls back. Stored documents (contracts, records, step results) are separately capped at 1 MiB and are refused with a pointer to the artifact store.
- **Atomicity.** Transition, checkpoint and contract events commit in the same transaction as the state change they describe. Events appended by the application layer (findings, invocation outcomes) are separate transactions, so a crash between the work and its event can leave one without the other.
- **Reads that depend on events.** The reason an onboarding is blocked or incompatible is not a column; it is read back from the latest transition event for that onboarding, by scanning events. The cost grows with the log, since there is no index.

Event kinds emitted: 12.

| Kind | Writer | Meaning |
|---|---|---|
| `onboarding.transition` | ledger | a state change, including creation and activation |
| `onboarding.checkpoint` | ledger | a checkpoint without a state change |
| `contract.stored` | ledger | the contract and carrier run were stored |
| `invocation.finished` | application | a contained agent invocation ended, with cost and outcome |
| `invocation.reaped` | application | a stale invocation was closed on resume |
| `invocation.reconciled` | application | a resume found the interrupted invocation's expected map files complete and treated it as finished (no event is written when the files are incomplete) |
| `invocation.orphan-charged` | application | budget was charged for invocations that never reported |
| `containment.finding` | application | a stage found a containment violation or note (map, validate, activate, intel and knowledge stages) |
| `index.absent` | application | an index was not built, with a reason |
| `hook.decision` | hook | one allow or deny, with the rule and budget named |
| `tool.completed` | hook | a tool call finished |
| `config.change.denied` | hook | an attempted settings edit was refused |

Levels are debug, info, warn and error; denials and absent indexes are warn.

## Checkpoints and continuity

A checkpoint records a from-state, a to-state, a next action and optionally a revision. One is written on creation, on every transition and on every explicit checkpoint call. Sequence numbers are continuous across an onboarding's own id and its carrier run id: the next number is the highest across both plus one, and the latest checkpoint is the highest sequence. Before the contract is stored the rows carry the onboarding id as their run; afterwards they carry the carrier run id, and the sequence carries on without a restart. Two checkpoints cannot share a sequence within one run id (unique constraint).

## Leases and optimistic concurrency

Leases live on the `onboardings` row only. Acquiring takes a free lease or one whose expiry has passed and bumps a fence counter, so a previous holder's next write fails. Renew and release require the holder and fence to match. Expiry is compared as ISO timestamp text. Every transition and checkpoint presents the fence it last saw; transitions also present the row version they last read. A mismatch is a conflict and nothing is written. The transition rules themselves are in [onboarding.md](onboarding.md).

## Budgets

Budget rows are created from the contract inside the contract-storing transaction, one per named budget and run. Creation leaves an existing row untouched, so a retry or resume cannot reset a counter or raise a limit. Afterwards only two columns move, and only upward:

- Reserving adds to the reserved amount only while used plus reserved plus the amount stays within the limit; otherwise nothing changes and the caller is told it was not granted.
- Charging adds to used. From a reservation, the amount moves out of reserved first and the call fails if the reservation is too small. Charged directly (an estimated cost after the fact), it may pass the limit.
- The hook charges one unit per allowed call with the same conditional update. A missing row for a charged budget is treated as a broken ledger and fails closed; a row at its limit produces a `budget_exhausted` deny.
- Nothing refunds, resets or deletes. A limit is fixed at creation.

## Attempts and onboarding steps

An attempt is a numbered try inside the carrier run and needs the contract stored first. An onboarding step result is keyed by onboarding, step name and attempt number. Recording a step again for the same key replaces its status, result and timestamps, so a step row shows the latest outcome only; the history of that key is not kept (the events are the history). Step results are capped at 1 MiB.

## Artifact store

Blobs are stored under `artifacts/` in the data root, addressed by the SHA-256 of their content as `sha256:` plus 64 lowercase hex characters, at `artifacts/{first two hex}/{full hex}`.

- **Writes.** A blob is written to a temporary file in its final directory, synced, then renamed, so a partial write never appears under its digest. The directory is then synced best-effort; a failure there is not an error. Files are 0600 and directories 0700.
- **Idempotent.** Putting content that is already stored is a no-op only if the stored bytes really hash to the digest; a truncated or corrupted file of the same size is replaced.
- **Reads.** A read re-hashes the bytes and reports an internal error if they no longer match, and not-found if absent. Disk-full surfaces as unavailable.
- **Kinds written.** `transcript` (an agent invocation's transcript), `map-document` (each codebase map document at activation), `map-snapshot` (the manifest of those documents) and `knowledge-manifest`. All four are recorded with retention class `onboarding` and store `local`.
- **Metadata is in the ledger.** The store itself keeps no metadata. The index row is inserted separately after the blob is stored, insert-or-ignore on the digest, so the first kind and run recorded for a digest win and a crash between the two leaves a blob with no index row.
- **Retention.** The retention value is a label. No code deletes or expires blobs or rows.

## Project record

The project record is the stored description of an onboarded repository: operational metadata only (paths, digests, revisions, classifications), never document text.

- **Versioning.** Activation inserts the next version for the project (highest plus one, starting at 1). A caller-declared version must equal it or the activation conflicts. The previous active version is marked superseded in the same transaction. A superseded row keeps its state text as active; the current record is the one with no superseded time. Body and digest are immutable by trigger, and only the supersession time is ever updated.
- **Digest.** The digest is over the canonical form of the body, so key order does not matter and any change to the body changes it.
- **Required content.** Activation refuses a body without the onboarded revision or the GSD version, or one whose project id differs from the onboarding's.
- **Content.** The body holds identity, revisions, profile, policy preset (`routine`) and promotion (`none`), GSD identity, the contract it was produced under, preflight facts and findings, map-document digests, mapping state, indexes, unmapped paths and granted authority. The record type is the owner of the exact shape; [onboarding.md](onboarding.md) lists what each part means.
- **Authority only narrows.** Defaults grant nothing: no write paths, endpoints or credentials. Repository proposals can only narrow what the profile policy grants; protected paths only accumulate; widening needs a new record version.
- **Completeness.** It is derived from the mapping mode, never from the files found: `full` is complete, `fast` and `paths` are partial, `skip` is none. The record builder passes no file evidence, so an adopted map is always recorded as partial. Mapping scope is stored as written, and the mode, scope and completeness are also copied to queryable columns together with the index commits.
- **Indexes.** The record folds the stored index step results. A present code graph becomes the graph entry (location, digest, build commit, tool, freshness, node and edge counts); the knowledge step, when present, replaces the graph digest and adds its document counts to that same entry; a present intel index becomes the intel entry. An index that was not built is listed under absent with a reason, never silently omitted. An index step disabled by the contract says nothing. A present step whose result is malformed counts as absent with reason `invalid-result`, and knowledge without a graph is absent with reason `graph-absent`. Absent is omitted entirely when nothing is absent. Index detail is in [indexes-and-context.md](indexes-and-context.md).
- **Reads.** The active record for a project is the highest version with active state and no superseded time.

## Files left on disk by an onboarding

Data root, besides the ledger:

- `backups/` holds pre-migration copies.
- `artifacts/` holds blobs.
- `onboard/{onboarding}/{purpose}-{invocation}/` holds the five generated inputs of one contained invocation: host settings, hook policy, agent list, a plugin directory of linked skills, and an empty MCP configuration. Files are 0600, directories 0700, written by temporary file and rename. The data root is denied to the contained agent. Nothing removes these directories.

Work root, per onboarding:

- `{onboarding}/staging` is a full local clone of the user's repository (no hardlinks, no checkout until detached at the pinned commit), on the branch `avarice/onboard-{onboarding}`. The clone is built at a partial path and renamed into place only when complete, so `staging` is whole or absent. A leftover partial directory is removed only when it is demonstrably this adapter's clone of the same repository; `staging` itself is never removed.
- `{onboarding}/graph-build/` holds graph tool output outside the staging tree.

The user's own repository is not written by the clone strategy: no worktree metadata, branch ref or object. A worktree strategy exists in code but the strategy constant selects the clone.

Inside staging, under `.planning/`:

- `codebase/` holds the map documents. The directory is created empty before the mapper launches even for a repository with no map. GSD itself writes the documents.
- `config.json` is rewritten by GSD's configure step, which AVARICE runs.
- `graphs/` receives three files installed from the graph build (the code-only graph, its merged form and the report), plus GSD's build snapshot marker. Installation refuses to go through a symlinked `.planning` or `graphs`.
- `intel/` holds the intel documents the agent writes and a refresh marker written by GSD's snapshot step.
- Next to `.planning/`, `.avarice-knowledge/` holds copied documents for the knowledge pass and the extraction files the model writes. The knowledge manifest is kept in the data root, not inside the corpus.

Nothing is promoted anywhere else: the record's promotion field is `none`, and the map documents leave staging only as artifact blobs and record digests.

## Quirks to keep in mind

- Six tables are schema-only; do not build on them without adding a writer.
- A superseded project record still says active; test the supersession time.
- A read-only command can migrate and back up the store on the first run after an upgrade.
- The config file is written once and never read.
- The event hash chain leaves out three event columns and has no verifier.
- Retention labels exist; retention behavior does not.
- Step rows are replaced on re-record; budgets and events are not.
