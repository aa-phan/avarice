# Data model

This document describes what AVARICE persists, as implemented in `src/adapters/sqlite/`, `src/adapters/fs/`, `src/domain/project-record.ts`, `src/domain/ids.ts`, `src/domain/run-lifecycle.ts`, `src/ports/ledger.ts`, `src/ports/artifact-store.ts` and the PreToolUse hook (`src/hook/pre-tool-use.ts`). The file layouts it lists are written by `src/app/run-start.ts`, `src/adapters/host-claude/claude-host.ts`, `src/adapters/git/run-workspace.ts` and `src/cli/shell/history.ts`.

AVARICE keeps three kinds of state: one SQLite file per profile (the ledger), a content-addressed blob store beside it, and working directories under a separate work root. The ledger holds 24 tables, and the built code writes every one of them. In the data root nothing is ever deleted: no code removes a row, a blob, a backup or a per-invocation directory, events are append-only by trigger, and approvals are never deleted. Columns belong to the migrations; this document states mechanisms and consequences. Hook rules are in [containment.md](containment.md), onboarding transitions in [onboarding.md](onboarding.md), run behavior in [runs.md](runs.md), evidence meaning in [checks-and-evidence.md](checks-and-evidence.md), the interactive shell in [interactive-shell.md](interactive-shell.md) and CLI flags in [cli-reference.md](cli-reference.md).

## Profile roots on disk

A profile has three roots, and each profile has its own ledger and its own roots. The profiles are `personal-local`, `personal-extended` and `enterprise-<org>` (see [profiles-and-credentials.md](profiles-and-credentials.md)); the table gives the paths of the default one, with the profile's name in place of `personal-local` for another.

| Root | Default | Override | Holds |
|---|---|---|---|
| Config home | `~/.config/avarice` | `AVARICE_CONFIG_HOME` | `profiles/personal-local/config.json`. Shared by every profile are the file `bindings.json`, which binds repositories to profiles, and `bindings.json.lock`, which exists while a process writes it and holds that process's ID and start time |
| Data root | `~/.local/share/avarice/personal-local` | `AVARICE_DATA_ROOT` | the ledger, backups, artifacts, contract files, per-invocation files, shell history |
| Work root | `~/.local/share/avarice-work/personal-local` | `AVARICE_WORK_ROOT` | staging clones, run clones, scratch directories and graph build output |

Resolution rules:

- Every root is resolved through the real path of its nearest existing ancestor before anything is created, so a symlinked root is judged by where it lands.
- A data or work root is refused when it lies under any `~/.claude*` directory or under the Claude config directory. It is also refused when it would contain the home directory or the Claude config directory, or when the two roots are nested in either direction.
- The data root must be on a local mount. On macOS the `mount` output must carry the `local` flag; on Linux a mount is local unless its type is a known network type. This is a heuristic, so a synced or FUSE mount that reports local passes.
- Directories are created with mode 0700. The config file is created with mode 0600 only when absent and is never rewritten. Every command reads it back, without following a symlink and up to 64 KiB. A root comes from the environment variable, then the file, then the default, so editing the file changes the roots; [config-reference.md](config-reference.md) lists the keys. `init` only prints its path. The binding registry is a file of mode 0600 in the config home, outside every ledger, so the profile can be chosen before any ledger opens.
- A ledger belongs to the profile it was created for: the meta key `profile_id` holds it, and a command under another profile refuses the store untouched. No table has a profile column, because every row of a file has the same profile.
- `init` warns, but does not fix, a root whose mode lets other users in.

## Identifiers

Every identifier is a prefix plus a 26-character ULID (a 48-bit millisecond time and 80 random bits in Crockford base32), so identifiers sort by creation time. The prefix names the kind, and the ID source refuses a prefix outside this list.

| Prefix | Names |
|---|---|
| `proj_` | a registered project |
| `onb_` | an onboarding |
| `run_` | a run, and also the carrier run of an onboarding |
| `inv_` | one contained agent invocation |
| `att_` | an attempt |
| `ckp_` | a checkpoint |
| `ev_` | an evidence row |
| `dec_` | a decision record |
| `ntf_` | a notification |
| `apr_` | an approval request, which is an event and not a row |
| `apv_` | an approval |

Gate results, budgets, steps and work items carry no generated identifier: they are keyed by run plus a name.

## The ledger file

The ledger is `state.db` in the data root. Facts that bind every opener except the hook:

- **Runtime gate.** Before any open, the bundled SQLite version must contain the WAL-reset fix: 3.44.6 or later on the 3.44 line, 3.50.7 or later on 3.50, 3.51.3 or later on 3.51, and any line above 3.51. Lines 3.45 to 3.49 never received the fix and are refused, as is anything older than 3.44.6 and a version string that does not parse. The refusal names the Node version to install.
- **Modes.** A new store is created 0600, and SQLite gives the `-wal` and `-shm` siblings the same mode. Each of the three files that exists must be owned by the current user, otherwise the open is refused and nothing is changed. A read-write open tightens an owned file that group or others can reach to 0600 and leaves a stricter mode (0400) alone. A read-only open never changes a mode.
- **WAL.** A read-write open switches the journal to WAL and fails if the switch does not take effect (a filesystem that cannot share memory). It sets full synchronous mode. Foreign keys are enforced and a busy store is waited on for 5 seconds before reporting unavailable.
- **Transactions.** Every write is an immediate-mode transaction, so a writer conflict surfaces at the start and a killed writer's open transaction rolls back on the next open. Each state-changing ledger operation is one transaction: either all its rows commit or none do.
- **Error mapping.** Busy and locked map to unavailable (retryable), constraint violations to conflict, values with no canonical JSON form to invalid, everything else to internal.
- **Two processes write.** The CLI process through the ledger, and the PreToolUse hook process, which opens the same file directly to charge budgets, append events and record what an agent has read. Both rely on SQLite's file locking, and each waits on a busy store (5 seconds for the CLI, 4 for the hook).
- **Hook open.** The hook opens an existing ledger read-write on its own connection with a 4 second busy wait. It does not run the version gate, the ownership and mode check or the WAL switch, and it refuses a ledger path that does not exist rather than creating one.

### Migrations and schema version

Schema version 4 is the latest of four migrations. Version 1 creates the 20 original tables and four triggers. Version 2 adds four columns to `runs`, three tables, two indexes and four triggers. Version 3 adds a column `item_id` to `attempts`, `supersedes` to `decisions`, `cancel_requested_at` and `cancel_requested_by` to `runs`, the table `notifications` and two indexes, with no trigger; the tables below describe them. Version 4 adds five indexes and two triggers and changes no row, column or table; it is described below. A row written before version 3 reads `NULL` in every new column, and an attempt with no item reads as item `A`. The version is stored in the `meta` table under `schema_version`, and `init` and `status` read it from there; `init` prints `4`. `meta` also holds `profile_id`, written once (insert-or-ignore) by the migration pass that applies the last pending migration, and `events_dropped_debug`, the count of debug events refused past the profile's event bound.

The runner is forward-only:

- Each applied migration records its version, time and the SHA-256 of its SQL text in `schema_migrations`.
- Before applying, every recorded migration is checked against the shipped text. A different checksum, or a recorded version this build does not ship (a store from a newer build), refuses the store with a conflict error and changes nothing, including no backup. A checksum mismatch also tells the operator that an applied migration must never be edited and to restore from backup or run the build that wrote it. The CLI turns this into exit 70.
- Versions must be contiguous; a gap is refused.
- Each pending migration, its `schema_migrations` row and the `schema_version` update commit in one transaction. A failing migration rolls back alone; earlier ones in the same pass stay applied.
- Before the first pending migration is applied to a store that already has history, the store is copied with `VACUUM INTO` to `backups/pre-migration-{timestamp}.db` beside the database (mode 0600, directory 0700; a numeric suffix avoids collisions). If the copy cannot be written, no migration runs. A fresh store with no history gets no backup, and neither does an in-memory database. A store with history therefore gets one backup before the first pending migration applies, whether that brings it to version 2, 3 or 4, and all pending migrations of one pass share that backup.
- Backups accumulate; nothing removes them.

Ten triggers enforce immutability. Version 1 installs four: a stored project record's body and digest cannot be updated, a stored contract's body and digest cannot be updated, and events cannot be updated or deleted. Version 2 installs four more: evidence rows and gate result rows cannot be updated or deleted. Version 4 installs two on `approvals`. `approvals_no_delete` means a row is never deleted. `approvals_update_guard` means a row changes only by setting `consumed_at` or `revoked_at`, each once and only from empty, so an approval cannot be replayed, extended or re-pointed.

Version 2 adds two indexes: evidence by attempt, and events by run. Version 3 adds two more: attempts by run and item, and notifications by state. Version 4 adds five. `decisions_run`, `gate_results_run` and `notifications_run` hold the rows of one run, for the status view. `runs_project` holds the runs of one project. `approvals_match` holds approvals by scope, action and parameter digest, the key an authorization is matched on. No other table or column is indexed beyond its primary and unique keys.

Quirk: a command that is meant to be read-only first checks for pending migrations. When there are none it opens read-only. When there are some, it opens read-write, migrates (with a backup), then reopens read-only. A read-only command can therefore write once, on the first run after an upgrade.

## Tables by purpose

All 24 tables are created by the first three migrations. A writer is code that inserts or updates rows: every such statement sits in the ledger adapter, the migration runner or the hook.

### Bookkeeping

| Table | Writer | Notes |
|---|---|---|
| `meta` | migration runner | `schema_version`, `profile_id` |
| `schema_migrations` | migration runner | one row per applied migration, with checksum |

### Projects and onboarding

| Table | Writer | Notes |
|---|---|---|
| `projects` | register | one row per repository, unique on root commit plus repository path; registering again returns the existing row |
| `onboardings` | create, transition, lease, checkpoint, store-contract | the operational spine of an onboarding; carries state, row version, lease and the staging path |
| `onboarding_steps` | step recorder | one row per onboarding, step name and attempt number |
| `project_records` | activation | versioned records, see the project record section |
| `adapter_configs` | CLI composition, `install-host` | one row per named adapter, upserted each time a non-read-only command starts; see below |

### Runs

A run is a `runs` row with its own lifecycle, contract, budgets, attempts and checkpoints, plus the run-only tables below. An onboarding has no run until its contract is stored. Storing the contract creates a carrier run (state fixed at `onboarding`) that the contract, budgets, attempts and later checkpoints of that onboarding hang off.

The run operations see only rows whose state is a run state. A carrier row is invisible to them: they report it as not found, run listings leave it out, and no run operation can lease, read or move it.

| Table | Writer | Notes |
|---|---|---|
| `runs` | store-contract (carrier row), run creation, run transition, run checkpoint, run lease, cancel request | see below |
| `contracts` | store-contract, run creation, amendment | one row per run and version; body and digest are immutable by trigger; start stores version 1 and each amendment stores the next version (see contracts and amendments) |
| `budgets` | contract storing, hook, budget accounting, amendment | see budgets |
| `attempts` | attempt recorder | ordinal increments per run; a run attempt ends once; a run attempt names its work item |
| `checkpoints` | create, transition, checkpoint (onboardings and runs) | see checkpoints |
| `run_steps` | step recorder | one row per run, step name and attempt number, replaced on re-record; see attempts and steps |
| `work_items` | run creation, work item transition | see work items |
| `decisions` | decision recorder, answer, stale re-open, withdraw, amendment | see decisions |
| `evidence` | evidence recorder | insert-only; see evidence and gate results |
| `gate_results` | gate recorder | insert-only; see evidence and gate results |
| `check_validations` | check validation | see check validations |
| `hook_reads` | hook | see hook reads |
| `notifications` | notification recorder | see notifications |
| `task_refs` | context pack, brief reference, manual inputs, resume | see task references |
| `approvals` | approve command | see approvals |

The `runs` row of a real run is inserted once, in state `contract_ready` at version 1, together with its first contract, budget rows and one work item row for each item of the brief. Each transition raises the version by one and commits the new state, a checkpoint and an event together. Four columns come from the second migration:

- `reason` holds the blocked reason while the run is `blocked_on_decision` and is cleared by every other transition. A reason is refused on any other target state, and a move to `blocked_on_decision` without one is refused. The seven accepted reasons are listed in [runs.md](runs.md).
- `workspace_path` is set when a transition supplies it (the move to `running`, or a block that happens before that move) and is kept by later transitions that supply none.
- `branch` and `base_revision` are set when the run is created and kept the same way.

Two columns come from the third migration. `cancel_requested_at` and `cancel_requested_by` hold the owner's request to cancel the run, written by the first request and kept: a repeated request returns the first and appends nothing. A run in `failed`, `cancelled` or `closed` refuses a request as a conflict. The request is committed before anything acts on it, and a run with a request standing never goes on with work. [runs.md](runs.md) describes how it is carried out.

A carrier row is inserted once per onboarding and no code updates it afterwards, so its state and version never change and its lease columns are unused (an onboarding's lease lives on `onboardings`).

### Log and artifact index

| Table | Writer | Notes |
|---|---|---|
| `events` | ledger, application layer and hook | append-only hash chain, see event log |
| `artifacts` | artifact recorder | index of stored blobs, see artifact store |

### Adapter descriptors

`adapter_configs` is keyed by a name and holds the adapter's port, name, a digest of its descriptor and the descriptor itself, which holds no secret. A non-read-only command upserts one row for each adapter it composed, so a later reader sees what the profile ran with. The names are:

- `executor`, `artifacts`, `staging`, `run-source`, `run-workspace` and `egress`;
- `graph`, `gsd` (only when an admitted GSD was located) and `agent-host`;
- one `context-<source>` for each context source the profile builds (`context-gsd-intel`, `context-gsd-graph`, `context-gsd-planning`, `context-git-files`);
- one `credential-<provider>` for each provider the profile's class allows (`credential-keychain`, `credential-cmd`, `credential-delegated`);
- the two that `install-host` writes: `host-skill:avarice-run` and `host-hook:attended`.

The restricted host is built beside the host and is not recorded. A read-only command records none.

Two columns are never set by any caller: a checkpoint's GSD state digest and an evidence row's external reference.

### Approvals

An approval is one row of `approvals`, written only by `avarice approve` after the owner says yes. It holds the scope in `run_id`. The scope is a run ID, an onboarding ID, or `attended:` and the host session ID, which is why the column has no foreign key. It also holds the action, the digest of the parameters, an idempotency key that is the digest of scope, action, digest and an ordinal, and the source `local-user`. Finally it holds who granted it as `owner:<operating system user>`, when, an expiry 30 minutes later, and `consumed_at` and `revoked_at`. A request is not a row: it is the event `approval.requested` and is found by its `apr_` ID in the event data. Consuming an approval and recording the action's start are one transaction. The rules are in [policy-and-approvals.md](policy-and-approvals.md#approvals).

### Task references

`task_refs` records what a run was built from, keyed by run, provider, kind and the provider's own ID, with the revision it was read at, when it was last retrieved, the scope and a freshness. Recording the same key again replaces the row; a resume updates only the freshness and the retrieval time, never the revision, so a changed reference is found again by the next resume.

| Provider and kind | ID | Revision | Scope | Written by |
|---|---|---|---|---|
| `manual-brief`, `brief-file` | the brief file's real path | `sha256:` and the digest of the file's bytes | the same path | `start` |
| `gsd-intel`, `intel-entry` | `<intel file>#<key>` | the intel index's revision | the intel file | a context pack |
| `gsd-graph`, `graph-node` | the node ID | the graph's build revision | the node's source path, or the graph file | a context pack |
| `gsd-planning`, `section` | `<file>#<heading slug>` | `gsd-state:sha256:<hex>` of GSD's state file, or `gsd-state:absent` | the planning file | a context pack |
| `git-files`, `snippet` | `<path>:<line>` | `git:<commit>` | the path | a context pack |
| `manual-context`, `excerpt` | the `--source` text | `sha256:` and the file's digest | the file name | `context add` |
| `github`, `pull-request` | `<owner>/<repository>#<number>` | none | the pull request URL | `pr record` |

The freshness is one of `fresh`, `stale`, `changed`, `deleted`, `access_revoked` and `unavailable` (see [runs.md](runs.md#reference-refresh-on-resume)). The last two providers are ledger-only references: no source judges them.

## Event log

The event log is the `events` table: one row per notable fact, chained by hash.

- **Append-only.** Triggers abort any update or delete. Sequence numbers come from an autoincrementing key, so they are never reused.
- **Redaction.** Every event's data is redacted before it is bounded and hashed, by the ledger and by the hook alike: a secret-shaped string or a credential value the process seeded becomes `[REDACTED:<kind>]`. The stored row hash therefore covers the stored, redacted text, and the hook, which seeds nothing, redacts by pattern only.
- **Chain.** Each row stores the previous row's hash; the first uses 64 zeros. The row hash covers the previous hash, the timestamp, the type, the run id (or empty) and the canonical data JSON. It does not cover the level, attempt id or invocation id. The previous hash is read inside the writer's transaction, so the CLI and the hook continue one chain. No shipped code verifies the chain, so tampering is detectable only by an external check.
- **Columns.** A row carries an optional run id, attempt id and invocation id beside the data. For an onboarding the run id is the onboarding's own id until its contract is stored and the carrier run id afterwards.
- **Size limits.** Event data is for identifiers, counts, digests, exit codes and short targets, never payloads. A string longer than 1024 characters anywhere in the data, or canonical data JSON longer than 8192 characters, is refused as invalid and the whole transaction rolls back. Stored documents (contracts, records, step results) are separately capped at 1 MiB and are refused with a pointer to the artifact store. Some free text still reaches events in short, cut form: a check's validation reason, an index detail, a containment finding's paths and a tool's target.
- **Atomicity.** Transition, checkpoint, contract, attempt, evidence, gate, work item and decision events commit in the same transaction as the row they describe. Events appended by the application layer (findings, invocation outcomes, check results, the hand-off) are separate transactions, so a crash between the work and its event can leave one without the other. A block of a run is several separate transactions: the finding event, the decision record, the work item move, the attempt end and the run transition. A crash between them leaves an open decision on a run that is still `running`.
- **Reads that depend on events.** The reason an onboarding is blocked or incompatible is not a column. It is read back from the latest transition event for that onboarding, by scanning events by type and by a field inside the data. A run's reason is a column. The events-by-run index serves reads of one run's events. The hook's per-invocation counts (denials, subagents in flight, consecutive searches) filter by invocation, which is not indexed, so they scan.

Event kinds emitted: 50. Every kind below has a writer in the built code. Levels are debug, info, warn and error; the table gives the level each kind is written at.

| Kind | Writer | Level | Meaning and data |
|---|---|---|---|
| `onboarding.transition` | ledger | info | a state change, including creation and activation. Data: onboarding, from, to, version, next action, checkpoint; reason when blocked or incompatible; project at creation; record version and digest at activation |
| `onboarding.checkpoint` | ledger | info | a checkpoint without a state change. Data: onboarding, state, next action, sequence, checkpoint |
| `contract.stored` | ledger | info | a contract was stored, for an onboarding's carrier run or for a run. Data: run, version, digest; plus the onboarding for a carrier |
| `run.created` | ledger | info | a run row was inserted. Data: run, project, state (always `contract_ready`), version (1) |
| `run.transition` | ledger | info | a run state change. Data: run, from, to, version, next action, checkpoint; reason when blocked; plus the caller's short fields, such as the decision, class, item, gate, a reconcile flag or an inconclusive count |
| `run.checkpoint` | ledger | info | a run checkpoint without a state change. Data: run, state, next action, sequence, checkpoint |
| `attempt.started` | ledger | info | a run attempt opened. Data: run, attempt, ordinal; the item when the caller names one |
| `attempt.ended` | ledger | info | a run attempt ended. Data: run, attempt, outcome |
| `work_item.upserted` | ledger | info | a work item row was written. Data: run, item, type, whether it was newly created |
| `work_item.transition` | ledger | info | a work item changed state. Data: run, item, from, to; plus the caller's fields, such as the decision that blocked or released the item and the reason |
| `decision.opened` | ledger | info | a decision record was opened. Data: run, decision, class, urgency, contract version; the decision it replaced when a stale answer re-opened it |
| `decision.answered` | ledger | info | an open decision was answered, by `decide` or by an amendment. Data: run, decision, channel, number of items released. Never the answer |
| `decision.stale` | ledger | info | an answer arrived on a state that had moved and the decision was closed as stale with the answer kept. Data: run, decision, channel |
| `decision.withdrawn` | ledger | info | a decision was withdrawn. Data: run, decision, reason (`owner` or `cancel`) |
| `decision.rejected` | application | info | an answer was refused by a response check. Data: run, decision, the check's name. Not written for a refusal at the identity check |
| `decision.duplicate` | application | info | the same answer was given again to an answered decision and ignored. Data: run, decision |
| `amendment.requested` | application | info | the owner asked for an amendment to answer an amend-only decision. Data: run, decision |
| `contract.amended` | ledger | info | the next contract version was written. Data: run, version, number of budget changes, number of stale evidence rows and stale gate rows appended, and the decision the amendment answered when it named one |
| `notify.delivered` | ledger | info | one delivery attempt of a notification succeeded. Data: notification, run (null for a digest), attempt number |
| `notify.failed` | ledger | info | one delivery attempt failed. Data: notification, run (null for a digest), attempt number, a short error code |
| `run.cancel_requested` | ledger | info | the owner asked to cancel a run. Data: run, who asked |
| `item.unpark_conflict` | application | warn | the parked delta of an answered item no longer applied, so the item gave up on its resume. Data: run, item, a count of paths, never the paths |
| `evidence.recorded` | ledger | info | an evidence row was inserted. Data: run, evidence, name, kind, status |
| `gate.result` | ledger | info | a gate row was inserted. Data: run, gate, passed, revision, number of failures; item when item-scoped |
| `check.validated` | application | info | a declared check was judged in the validation clone. Data: run, check name, verdict; the reason when there is one, cut short |
| `check.finished` | application | info | a check ran. Data: run, attempt, name, label, status, exit code, duration, evidence; a pre-existing flag when the check was already failing at base |
| `handoff.fetched` | application | info | the run branch was fetched into the source repository. Data: run, attempt, branch, the resulting revision, whether the ref was newly created |
| `invocation.finished` | application | info | a contained agent invocation ended. Data: the owner (onboarding, or run, attempt and item), invocation, purpose, the model of a run's unit, outcome, cost reported and cost charged with its basis, duration, permission denials; when the host reported details, also exit code, signal, timed-out flag, head-moved flag, hook denials and budget denials, turns, transcript size, and optionally the result subtype, the terminal reason and the subagents spawned; and, when the adapter measured them, `tokens` (the input, cache-creation, cache-read and output counts of the invocation summed) and `transcriptDigest` |
| `invocation.reaped` | application | warn | a stale invocation's host processes were ended on resume. Data: the owner (onboarding or run), invocation when known, number terminated |
| `invocation.reconciled` | application | info | an onboarding resume found the interrupted invocation's expected map files complete and treated it as finished (no event is written when the files are incomplete). Data: onboarding, attempt, invocation when known |
| `invocation.interrupted` | application | warn | a run resume marked a launch step interrupted. Data: run, step, invocation when known |
| `invocation.orphan-charged` | application | warn | budget was charged for invocations that never reported. Data: the owner (onboarding or run), number of invocations, cost charged |
| `verification.interrupted` | application | warn | a run resume reconciled a run killed during verification. Data: run, number of checks marked inconclusive, the action the run resumes at |
| `containment.finding` | application | warn | a stage found a containment violation or note. Data: the check name, plus the onboarding and invocation or the run and attempt, and where the check has them a count and a capped list of cut paths |
| `index.absent` | application | warn | an index was not built, with a reason. Data: onboarding, index, reason; a cut detail when there is one |
| `hook.decision` | hook | info for allow, warn for deny | one allow or deny. Data: onboarding, invocation, tool, agent when a subagent made the call, tool-use ID and background flag for subagent calls, decision, rule, the budget when one was charged or exhausted, and, on an allow, `alsoCharged`, the retrieval rows the call was charged to as well |
| `loop.limit` | hook | warn | an invocation reached its limit of consecutive denials or consecutive searches. Data: run, invocation, reason, count, limit |
| `tool.completed` | hook | info | a tool call finished. Data: onboarding, invocation, tool, agent when a subagent made the call; for a file write the target relative to the clone (or a cut target and digest, or an outside-the-clone or unresolved marker); a failed flag; for subagent calls the tool-use ID and whether the call released a concurrency slot |
| `config.change.denied` | hook | warn | an attempted settings edit was refused. Data: onboarding, invocation, the source when the host named one |
| `policy.denied` | hook | warn | a privileged shell form was denied for want of an approval. Data: the rule ID (`privileged:<action>`), action, scope, the run when there is one, the request ID, tool, parameter digest, a bounded summary of the parameters and `source: hook`. Written in one transaction with the request. In an attended session a line with several privileged commands writes one for each command without an approval; a run writes one for the first privileged command only. In an attended session two denials carry no request and no command text: a line that could not be read (rule `privileged:unparseable`; data: rule ID, scope, tool, reason, source) and a command no approval can bind (rule `privileged:unapprovable`; the same data and the action) |
| `approval.requested` | hook, application | info | an action needs an approval. Data: request ID, scope, action, parameter digest, parameter summary and the rule that asked. In an attended session it carries no run ID |
| `approval.granted` | ledger | info | the owner approved a request. Data: approval ID, request ID, scope, action, parameter digest and expiry |
| `approval.revoked` | ledger | info | the owner revoked an approval. Data: approval ID, scope, action, parameter digest |
| `action.started` | application; hook | info | a privileged action began. Data: scope, action, parameter digest and summary, the source that allowed it (`policy`, `contract` or `approval`), the item when there is one, and the approval ID when the source is `approval`. Written in the same transaction that consumes an approval. The hook writes it only in an attended session |
| `action.finished` | application | info (warn when failed) | a privileged action ended. Data: scope, action, status, and `startSeq`, the sequence number of the start it closes. `startSeq` is optional: an end written without it closes the earliest open start of its action |
| `action.interrupted` | application | warn | a resume found a start with no end and marked it. Data: scope, action, the start's sequence number, and the decision it opened |
| `credential.resolve` | application | info (warn when it did not resolve) | a credential reference was resolved or refused. Data: the reference as written, purpose, module, profile, outcome (`resolved`, `denied`, `invalid` or `unavailable`) and duration. Never the value; an attempt that cannot be recorded hands out nothing |
| `manual.context_recorded` | application | info | the owner recorded an excerpt. Data: run, source, file name, file digest, artifact digest, who recorded it |
| `manual.pr_recorded` | application | info | the owner recorded a pull request URL. Data: run, host, owner, repository, number, who recorded it |
| `task_refs.refreshed` | application | info (warn when any reference is not fresh) | a resume refreshed the run's references. Data: run, number refreshed, and the count per freshness |

The `containment.finding` check names written for onboardings are `staging-head-moved`, `scope-of-writes` and `activation-scope`. For runs the blocking stage chooses the name; [containment.md](containment.md) and [runs.md](runs.md) describe each.

Quirk: the hook names the owner of an invocation in a field called onboarding. For a run invocation that field holds the run ID, because a run has no onboarding.

## Checkpoints and continuity

A checkpoint records a from-state, a to-state, a next action and optionally a revision. A run checkpoint also records the attempt and work item it concerns when the caller names them. One is written on creation, on every transition and on every explicit checkpoint call. A run's sequence is its own: the next number is the highest for that run plus one. Two checkpoints cannot share a sequence within one run id (unique constraint).

An onboarding's sequence is continuous across its own id and its carrier run id: the next number is the highest across both plus one, and the latest checkpoint is the highest sequence. Before the contract is stored the rows carry the onboarding id as their run; afterwards they carry the carrier run id, and the sequence carries on without a restart. The next-action values a run uses are in [runs.md](runs.md).

## Leases and optimistic concurrency

A lease lives on the row of whatever holds it: the `onboardings` row for an onboarding, the `runs` row for a run. Both use one rule. Acquiring takes a free lease or one whose expiry has passed and bumps a fence counter, so a previous holder's next fenced write fails. Renew and release require the holder and fence to match. Expiry is compared as ISO timestamp text.

The fence guards the writes that move a thing forward. For an onboarding these are every transition and checkpoint; transitions also present the row version they last read. For a run these are every transition (which also presents the version), run checkpoint, contract storage and work item transition. A mismatch is a conflict and nothing is written. The other run writes take no fence: steps, attempts, evidence, gate results, decisions and budget changes. That includes the three decision moves (an answer, a stale re-open and a withdrawal), an amendment and a cancel request, which come from the owner's terminal beside a supervisor that may be working another item. They take the run's lock for the length of their transaction, and each re-checks its own preconditions inside it. A withdrawal and a stale re-open check that the decision is still open. An answer also checks that the contract is the version the caller read. An amendment checks that version and that the run has not ended, and, when it names a decision, that the decision is open. A cancel request checks that the run has not ended. The one exception is the failed reconcile step, which presents the fence, so a superseded supervisor cannot record it. A superseded supervisor can still record the other unfenced rows until its next fenced write fails. The transition rules themselves are in [onboarding.md](onboarding.md) and [runs.md](runs.md).

## Budgets

Budget rows are created from the contract inside the contract-storing transaction, one per named budget and run. Creation leaves an existing row untouched, so a retry or resume cannot reset a counter or raise a limit. A run has five: `invocations`, `toolCalls`, `subagentsTotal`, `wallClockMs` and `costUsd`. A run whose contract carries retrieval budgets has four more rows, `retrieval.searches`, `retrieval.fullReads`, `retrieval.fullReadBytes` and `retrieval.broadDiscovery` (see [containment.md](containment.md#retrieval-budgets)). A contract compiled before them has no retrieval rows and none is created: its retrievals are counted in memory against the profile's caps. A store that lacks the rows of a contract that carries retrieval budgets gets them created, never reset. The status view lists the five and not the retrieval rows. Afterwards two columns move, and only upward, while running:

- Reserving adds to the reserved amount only while used plus reserved plus the amount stays within the limit; otherwise nothing changes and the caller is told it was not granted.
- Charging adds to used. From a reservation, the amount moves out of reserved first and the call fails if the reservation is too small. Charged directly (an estimated cost after the fact), it may pass the limit.
- The charges of one invocation settlement, or of one orphan conversion with its `invocation.orphan-charged` event, change their rows together in one transaction: if any charge fails, no row changes and no event is written.
- The hook charges one unit per allowed call with the same conditional update. A missing row for a charged budget is treated as a broken ledger and fails closed; a row at its limit produces a `budget_exhausted` deny.
- An invocation reserves one unit of `invocations` before it launches and is granted a cost cap: the smaller of the per-invocation cap and what remains of the cost budget. The cap is not an amount reserved on the cost row. When the holder dies before settling, the next reservation, or a run resume that has ended the host, turns the reservation into spent budget and writes `invocation.orphan-charged`.
- Nothing refunds, resets or deletes spend. Only a contract amendment changes a limit, up or down to any finite value, and it does so in one statement that also records the contract version the limit belongs to. Used and reserved amounts are never touched by it, so spend carries over, and no run, hook or stage can raise its own limit. The amendment command runs from the owner's terminal outside the run.

## Attempts and steps

An onboarding attempt is a numbered try inside the carrier run and needs the contract stored first. A run attempt is numbered per run, needs a reason, and ends once with an outcome; ending it a second time is a conflict. An attempt names the work item it served. A row with no item reads as item `A`, so a run that began before attempts named items keeps its history. The ordinals still count run-wide. The reasons the built code writes are `initial`, `con16-retry`, `answer`, `resume` and `repair`. An attempt's outcome is a short token such as `committed`, `discarded`, `repaired`, `cancelled`, `handed-off` or `blocked:` and the block's reason. Run attempts write `attempt.started` and `attempt.ended` events.

An onboarding step result is keyed by onboarding, step name and attempt number. The names include `gsd:probe`, `gsd:inspect`, `gsd:configure`, `mapping:plan`, `gsd:stamp`, `validate`, `index:<name>` for each index step, `gsd:intel-snapshot` and `promote` (the outcome of a promotion). A run step result is keyed by run, step name and attempt number in `run_steps`. Recording a step again for the same key replaces its status, result and timestamps, so a step row shows the latest outcome only. The history of that key is not kept, because the events are the history. Step results are capped at 1 MiB.

A run step has one of six accepted statuses: `started`, `completed`, `failed`, `interrupted`, `reconciled`, `skipped`. The built code never writes `reconciled` for a run. It writes `started` and `interrupted` for launches, `skipped` for a dependency install with nothing to install, and `completed` or `failed` otherwise. The step names a run writes are `start:preflight`, `host:config-dir`, `supervisor:spawn`, `supervisor:resume`, `supervisor:decide`, `workspace:prepare`, `gsd:inspect`, `gsd:configure` and `deps:install`. It also writes `checks:validate`, `baseline`, `context:pack`, `item:base`, `launch:run`, `snapshot`, `classify`, `discard`, `park`, `spec:plan` and `repair:reproducer`. The last names are `resume:fallback`, `commit`, `handoff:fetch`, `resume:reconcile`, `restricted:outputs` for a restricted run, and `manual-context:` followed by 16 hexadecimal characters for each excerpt `context add` recorded (25 fixed names and one per excerpt). The `context:pack` step holds the references of the pack, the notes, the ceiling and the effective budget, the tokens used, the number omitted, the reuse report and a digest of the pack, never an excerpt. The `launch:run` step carries the invocation's `transcriptDigest` and the artifact digest of its `transcriptSummary`. A step of the unit carries the attempt and the item it belongs to, and the `gsd:configure` step is written again for each later item. `host:config-dir` holds the host configuration directory the run was started under and where it came from (`CLAUDE_CONFIG_DIR` or `default`). It is written once, before the first supervisor is spawned, and a run started before it was written has none. [runs.md](runs.md) says what the stages record.

## Work items

A work item is keyed by run and item ID and carries its type, the items it depends on, a size, a model, the item's specification as JSON and a state. It also holds the session ID its unit runs under, set when the unit is delegated, which an answer resumes. The ledger accepts the types `implement` and `harden`; the built code writes `implement` only. A row is created in state `ready`. Writing an item again changes its description but never its state or attempt count: only a state move does, and each move to `delegated` adds one to the attempt count. The states and moves are in [runs.md](runs.md). Both writes emit an event.

## Decisions

A decision is a record opened when a run cannot finish inside its contract. It carries a class, the issue text, an optional recommendation, options, consequences and references to evidence. It also carries the affected items, an optional authorized default, a digest of the state it was opened on, an urgency and a state. Its contract version is the one the run was on.

The ledger accepts eight classes (`acceptance`, `architecture`, `scope_expansion`, `permission`, `repeated_failure`, `equivalent_mutant`, `contradiction`, `budget`), two urgencies (`blocking`, `digest`) and four states (`open`, `answered`, `stale`, `withdrawn`). The built code writes five classes (`acceptance`, `permission`, `repeated_failure`, `scope_expansion`, `budget`) and urgency `blocking`.

A decision leaves `open` in one of three ways, each one transaction under the run's lock that refuses with a conflict when the decision is no longer open.

- **Answered.** The answer, who gave it, when and the channel are set, and the decision event carries the channel and a count, never the answer. The ledger first re-checks that the run's latest contract version is the one the caller validated against. Every affected item that no other open decision of the run lists then moves from `blocked_on_decision` to `ready`, with the decision's ID on the move. An amendment answers a decision the same way with the answer `amended:v` and the new version, and the owner who signed the amendment as the answerer.
- **Stale.** The old row becomes `stale` and keeps the answer, who and the channel as context. A new row opens with the same class, issue, recommendation, options, consequences, affected items and default, on the new state digest and contract version, and its `supersedes` names the old decision. The affected items keep their state.
- **Withdrawn.** The row becomes `withdrawn`, and the affected items keep their state. A cancel withdraws every open decision of the run.

Only an open decision blocks work. The channel is always the terminal. What a decision means for a run is in [runs.md](runs.md), and the answer rules are in [autonomy-and-decisions.md](autonomy-and-decisions.md).

## Notifications

A notification row records the delivery of one banner. It names the run it is about (empty for a digest), a kind (`decisions`, `review`, `blocked-run` or `digest`), a destination, and the IDs of the decisions or runs it concerns. It also holds a state, the number of attempts, the time of the next attempt, the last error code and the times it was created, updated and delivered.

- The states are `pending`, `held`, `delivered` and `failed`. A row moves from `pending` to `delivered`, `failed` or `held`, from `held` to `delivered` or `failed`, and from `failed` to `delivered`. `delivered` is final.
- A delivery attempt on a pending or held row adds one to the attempts. A delivered attempt makes the row `delivered`. A failed attempt with a next-attempt time keeps the state and schedules the retry, and one without it makes the row `failed`. The error is a short code of lower-case letters, digits and hyphens, at most 64 characters, and a delivered attempt carries none. A delivered or failed row refuses another attempt as a conflict.
- The one way out of `failed` is moving a row to `delivered` directly, which a digest does for a banner it covered. A move that is not on the list is refused as invalid, and a move of several rows commits all or none.
- Events carry the IDs, the attempt count and the error code, never the banner text.

## Contracts and amendments

Every contract version is a row. Start stores version 1 and an amendment stores the next version in one transaction without a lease: its diff, its reason and who authorized it are in columns of the contract row. The transaction also changes the limits of the budget rows it names, appends the stale rows, appends the `contract.amended` event and, when the amendment names a decision, answers it. It is refused, with nothing written, when the run's latest version is not the one the caller read or when the run has failed, been cancelled or closed. It is also refused when a budget it names does not exist. It is refused when the decision it names is not open, or when its class is not one an amendment answers (`repeated_failure`, `permission`, `budget` or `scope_expansion`). The run's contract body and digest are immutable like version 1's.

An amendment invalidates by appending. Each evidence row it invalidates gets a copy with the status `stale` under the new contract version, in the same attempt, and its environment names the amendment and the row it supersedes. Each gate it invalidates gets a new failed row under the new version, with the failure `stale-after-amendment`, for the gate's latest row. The originals stay, so the history of what was measured on each version is intact. Evidence and gate result rows remain insert-only.

## Evidence and gate results

Evidence and gate result rows are insert-only: a trigger refuses any update or delete, and the port has no method that changes one. A correction is a new row. A check interrupted by a kill is marked by inserting a new row with status `inconclusive`, not by editing the one that was started.

An evidence row hangs off an attempt, not a run; the run is found through the attempt. It records a kind, a name, the status, the revision and tree digest it was measured on, a clean flag and the environment as JSON. It also records the contract version, the policy revision, an independence and the acceptance criteria it speaks to. Optional parts are test and command details, an exit code, a duration and an artifact digest. The ledger accepts six statuses (`passed`, `failed`, `skipped`, `unavailable`, `inconclusive`, `stale`) and three independences (`deterministic`, `external`, `model-review`). The built code writes four kinds: `check`, `test-inventory`, `gsd-verdict` and `diff`. Their independence is `deterministic`, except the `gsd-verdict`, which is `model-review`. The external reference column is always empty. What the kinds and statuses mean is in [checks-and-evidence.md](checks-and-evidence.md).

A gate result row records the gate, an optional work item, the contract version, policy revision and revision it was judged on, whether it passed and its failures as JSON. The built code writes five gates, `G0`, `G1`, `G2`, `G3` and `G4`. A gate can have several rows for one run: one for each item and attempt it judged, and a failed `stale-after-amendment` row for each gate an amendment invalidated. An item's rows name the item, and the rows of the final proof name none. Evidence is written with the `stale` status only by an amendment.

## Check validations

`check_validations` caches the verdict on one declared check, keyed by project, base revision, the digest of the check's specification and the check's name. It belongs to no run, so a later run on the same project, revision and specification reuses the verdict. The verdicts stored are `active` and `rejected`, with a JSON detail (the reason and, for a rejection, the offending paths or hosts). A verdict of `unavailable` is judged but never stored, so the next run looks again.

The first verdict for a key wins: a second insert is a conflict, and the validating code treats that as a concurrent run having recorded the same fact. No code updates or deletes a row, and unlike evidence no trigger forbids it. How a check is validated is in [checks-and-evidence.md](checks-and-evidence.md).

## Hook reads

`hook_reads` records what an agent has read, so that an edit can be refused when the agent has not read the file as it is now. It is keyed by invocation, agent and path. It holds the file's digest, the sequence number of the event of the call that recorded it, and a time. A path that holds a secret-shaped string is stored with the redaction marker, a `#` and 16 hexadecimal characters of the digest of the whole path. Two such files therefore stay two keys, and a secret is never stored as typed. The hook writes it with its own SQL when three things hold. A completed read or write targets an existing file under the clone or a write root, the call did not fail, and the invocation's policy enables the read-before-edit rule (run invocations do). A later read or write of the same key replaces the digest, sequence and time. Before an edit the hook compares the recorded digest with the file on disk; the rule is in [containment.md](containment.md).

## Artifact store

Blobs are stored under `artifacts/` in the data root, addressed by the SHA-256 of their content as `sha256:` plus 64 lowercase hex characters, at `artifacts/{first two hex}/{full hex}`.

- **Writes.** A blob is written to a temporary file in its final directory, synced, then renamed, so a partial write never appears under its digest. The directory is then synced best-effort; a failure there is not an error. Files are 0600 and directories 0700.
- **Idempotent.** Putting content that is already stored is a no-op only if the stored bytes really hash to the digest; a truncated or corrupted file of the same size is replaced.
- **Reads.** A read re-hashes the bytes and reports an internal error if they no longer match, and not-found if absent. Disk-full surfaces as unavailable.
- **Quota.** A new blob that would take the store past the profile's `limits.artifactQuotaMiB` is refused before anything is written, as unavailable, with a message naming the profile. The caller stores no record that points at it. The count is taken when the process starts, so the quota stops runaway growth and does not account for another process's writes.
- **Redaction.** Every text kind except the map documents and the map snapshot is redacted before it is hashed, so the digest of such an artifact is the digest of its redacted bytes. A map document is stored as given, because validation already refuses one that holds a secret and rewriting accepted bytes would change their recorded digest. A payload that is not valid UTF-8 is stored as given.
- **Kinds written.** Thirteen kinds are indexed. `transcript-summary` is written for every invocation: a JSON object with the session ID, the turn count, the reported cost, the tool uses and the last text of the result, redacted. `transcript` is the whole redacted transcript, written only when the profile's `retention.transcripts` is `full` or `AVARICE_DEBUG_TRANSCRIPTS` is `1`, so it is optional. Its digest is kept on the launch step and the `invocation.finished` event either way. Both carry retention class `onboarding` for an onboarding's invocation and `run` for a run's. Onboarding writes `map-document` (each codebase map document at activation), `map-snapshot` (the manifest of those documents) and `knowledge-manifest`, all with class `onboarding`. Runs write `check-output` (the output of one check run), `test-inventory` (the test inventory a check measured) and `gsd-quick-record` (a record of the quick unit a run delegated), all with class `run`. A restricted run writes `restricted-plan`, `restricted-patch` and `restricted-decisions`, and the manual inputs write `manual-context` and `manual-evidence`, all with class `run`. Every row has store `local`.
- **Metadata is in the ledger.** The store itself keeps no metadata. The index row is inserted separately after the blob is stored, insert-or-ignore on the digest. The first kind and run recorded for a digest win, and a crash between the two leaves a blob with no index row.
- **Retention.** The retention value is a label, `onboarding` or `run`. No code reads it, and no code deletes or expires blobs or rows.

## Project record

The project record is the stored description of an onboarded repository: operational metadata only (paths, digests, revisions, classifications), never document text.

- **Versioning.** Activation inserts the next version for the project (highest plus one, starting at 1). A caller-declared version must equal it or the activation conflicts. The previous active version is marked superseded in the same transaction. A superseded row keeps its state text as active; the current record is the one with no superseded time. Body and digest are immutable by trigger, and only the supersession time is ever updated.
- **Digest.** The digest is over the canonical form of the body, so key order does not matter and any change to the body changes it.
- **Required content.** Activation refuses a body without the onboarded revision or the GSD version, or one whose project id differs from the onboarding's.
- **Content.** The body holds identity, revisions, profile, policy preset (`routine`) and promotion (`none`), GSD identity and the contract it was produced under. It also holds preflight facts and findings, map-document digests, mapping state, indexes, unmapped paths and granted authority. The record type is the owner of the exact shape; [onboarding.md](onboarding.md) lists what each part means.
- **Authority only narrows.** Defaults grant nothing: no write paths, endpoints or credentials. Repository proposals can only narrow what the profile policy grants; protected paths only accumulate; widening needs a new record version.
- **Completeness.** It is derived from the mapping mode and, for an adopted map, from the map files present. `full` is complete, `fast` and `paths` are partial, `skip` is none, and `adopt` is complete only when all seven map files are present. A map made under the restricted launch is partial and carries `restricted: true`. Mapping scope is stored as written, and the mode, scope and completeness are also copied to queryable columns together with the index commits. An adopted map carries `provenance: adopted` in its mapping block.
- **Existing state.** The `existingState` block holds whether a planning directory exists, the class of the existing map, the outcome that class had after GSD's drift check, the drift verdict and the user-owned planning files. The preflight of an onboarding of an active project also records which record it refreshes. The mapping plan step (`mapping:plan`) holds the mode, the reason, the paths of a scoped map, the drift and a `refresh` block with the plan and the facts behind it.
- **Indexes.** The record folds the stored index step results. A present code graph becomes the graph entry (location, digest, build commit, tool, freshness, node and edge counts). The knowledge step, when present, replaces the graph digest and adds its document counts to that same entry. A present intel index becomes the intel entry. An index that was not built is listed under absent with a reason, never silently omitted. An index step disabled by the contract says nothing. A present step whose result is malformed counts as absent with reason `invalid-result`, and knowledge without a graph is absent with reason `graph-absent`. Absent is omitted entirely when nothing is absent. Index detail is in [indexes-and-context.md](indexes-and-context.md).
- **Reads.** The active record for a project is the highest version with active state and no superseded time.

## Files left on disk

Data root, besides the ledger:

- `backups/` holds pre-migration copies.
- `artifacts/` holds blobs.
- `onboard/{onboarding}/{purpose}-{invocation}/` holds the five generated inputs of one contained invocation of an onboarding: host settings, hook policy, agent list, a plugin directory of linked skills, and an empty MCP configuration. Files are 0600, directories 0700, written by temporary file and rename. The data root is denied to the contained agent. Nothing removes these directories.
- `run/{run}/run-{invocation}/` holds the same five inputs for one invocation of a run. The directory name is singular.
- `runs/{run}/contract-v{n}.json` holds the run's contract as canonical JSON, written by temporary file, sync and rename, mode 0600 in a 0700 directory. Start writes version 1, and each amendment writes the next version beside it. The ledger holds every version too. If a start is killed between the ledger transaction and the file write, or an amendment between its transaction and its file, the supervisor rewrites the latest file from the ledger before it launches anything. The directory name is plural.
- `shell-history` holds the interactive shell's command history, one entry per line, oldest first, mode 0600. It is capped at 1000 lines; at the cap the file is rewritten without its oldest line through a temporary file and a rename. An entry is stored without control characters or escape sequences, and redacted. A missing, unreadable or unwritable file is an empty history or a skipped entry, never an error that stops the shell.

Work root, per onboarding:

- `{onboarding}/staging` is a full local clone of the user's repository (no hardlinks, no checkout until detached at the pinned commit), on the branch `avarice/onboard-{onboarding}`. The clone is built at a partial path and renamed into place only when complete, so `staging` is whole or absent. A leftover partial directory is removed only when it is demonstrably this adapter's clone of the same repository; `staging` itself is never removed.
- `{onboarding}/graph-build/` holds graph tool output outside the staging tree.

Work root, per run:

- `{run}/clone` is the run's clone, built by the same partial-then-rename rules as staging and detached at the onboarded revision, on the branch `avarice/{run}`.
- Inside the clone's own git directory, an item that stopped to ask keeps its delta under one ref, `refs/avarice/park/{run}/{item}`, until the item commits or its resume gives up on the delta. The ref is never fetched into the user's repository.
- `{run}/validate` is a second, scratch clone, detached at the same revision, where declared checks are validated.
- `{run}/scratch/` holds the agent's temporary directory and package cache (`tmp` and `npm-cache`), mode 0700, writable by the contained agent.
- `{run}/tmp/` holds short-lived temporary index directories used to snapshot the clone. Each is removed after use; the parent stays.

Nothing removes a run's directories.

The user's own repository is not written by an onboarding: no worktree metadata, branch ref or object. A worktree strategy exists in code but the strategy constant selects the clone. A run writes exactly one thing there: at hand-off, the branch ref `avarice/{run}` is created from the run clone. The write is create-only, never forced and never checked out, and an existing ref at a different revision is a conflict that transfers nothing.

Inside staging, under `.planning/`:

- `codebase/` holds the map documents. The directory is created empty before the mapper launches even for a repository with no map. GSD itself writes the documents.
- `config.json` is rewritten by GSD's configure step, which AVARICE runs.
- `graphs/` receives three files installed from the graph build (the code-only graph, its merged form and the report), plus GSD's build snapshot marker. Installation refuses to go through a symlinked `.planning` or `graphs`.
- `intel/` holds the intel documents the agent writes and a refresh marker written by GSD's snapshot step.
- Next to `.planning/`, `.avarice-knowledge/` holds copied documents for the knowledge pass and the extraction files the model writes. The knowledge manifest is kept in the data root, not inside the corpus.

Nothing is promoted unless the owner asked for it with `--promote`. The record's promotion field is `none` whatever was asked. The map documents leave staging as artifact blobs and record digests, or, when promotion was requested, as files in the checkout or one new branch (see [cli-reference.md](cli-reference.md#promotion)).

## Quirks to keep in mind

- A reference is replaced when a pack records it again, so a reference's revision is the one of its latest pack. Only a resume refreshes a reference without changing its revision.
- An approval's scope is held in a column named for runs, and an attended scope is not a run ID.
- A status read builds each run from one batched read of its rows (one query set per run). The cost of `status` therefore grows with the number of runs and not with the rows each run holds.
- A restricted run's three artifacts and a manual input's artifact are text kinds, redacted before they are stored.
- A withdrawn decision does not release its items, and an amendment makes every decision still open stale, so the next answer to one re-opens it.
- A notification row can move from `failed` to `delivered`, but only through the digest's bulk move. A single delivery attempt refuses a failed row.
- A superseded project record still says active; test the supersession time.
- A read-only command can migrate and back up the store on the first run after an upgrade.
- The config file is written once and hand-edited after that: no command writes any section, and every command reads the file back.
- The event hash chain leaves out three event columns and has no verifier.
- Retention labels exist; retention behavior does not.
- Step rows are replaced on re-record; budgets, events, evidence and gate results are not.
- The run's directory in the data root is `runs` for the contract and `run` for the invocation inputs.
- The hook's event field for the owner is called onboarding even when the owner is a run.
- A block of a run is not one transaction. The fence guards a run's transitions, checkpoints, contract and work item moves, and a failed reconcile step, but not its other steps, attempts, evidence, gates or decisions. An answer, an amendment and a cancel request are unfenced too and re-check their own preconditions inside their transaction.
- A carrier run row of an onboarding is invisible to every run operation, so the `runs` table holds rows that no run listing shows.
