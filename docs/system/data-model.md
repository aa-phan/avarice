# Data model

This document describes what AVARICE persists, as implemented in `src/adapters/sqlite/`, `src/adapters/fs/`, `src/domain/project-record.ts`, `src/domain/ids.ts`, `src/domain/run-lifecycle.ts`, `src/ports/ledger.ts`, `src/ports/artifact-store.ts` and the PreToolUse hook (`src/hook/pre-tool-use.ts`). The file layouts it lists are written by `src/app/run-start.ts`, `src/adapters/host-claude/claude-host.ts`, `src/adapters/git/run-workspace.ts` and `src/cli/shell/history.ts`.

AVARICE keeps three kinds of state: one SQLite file per profile (the ledger), a content-addressed blob store beside it, and working directories under a separate work root. The ledger holds 23 tables; 21 are written by the built code and 2 are created empty and have no writer. In the data root nothing is ever deleted: no code removes a row, a blob, a backup or a per-invocation directory, and events are append-only by trigger. Columns belong to the migrations; this document states mechanisms and consequences. Hook rules are in [containment.md](containment.md), onboarding transitions in [onboarding.md](onboarding.md), run behavior in [runs.md](runs.md), evidence meaning in [checks-and-evidence.md](checks-and-evidence.md), the interactive shell in [interactive-shell.md](interactive-shell.md) and CLI flags in [cli-reference.md](cli-reference.md).

## Profile roots on disk

A profile has three roots. Only one profile exists, named `personal-local`; the name is fixed in code.

| Root | Default | Override | Holds |
|---|---|---|---|
| Config home | `~/.config/avarice` | `AVARICE_CONFIG_HOME` | `profiles/personal-local/config.json` |
| Data root | `~/.local/share/avarice/personal-local` | `AVARICE_DATA_ROOT` | the ledger, backups, artifacts, contract files, per-invocation files, shell history |
| Work root | `~/.local/share/avarice-work/personal-local` | `AVARICE_WORK_ROOT` | staging clones, run clones, scratch directories and graph build output |

Resolution rules:

- Every root is resolved through the real path of its nearest existing ancestor before anything is created, so a symlinked root is judged by where it lands.
- A data or work root is refused when it lies under any `~/.claude*` directory or under the Claude config directory. It is also refused when it would contain the home directory or the Claude config directory, or when the two roots are nested in either direction.
- The data root must be on a local mount. On macOS the `mount` output must carry the `local` flag; on Linux a mount is local unless its type is a known network type. This is a heuristic, so a synced or FUSE mount that reports local passes.
- Directories are created with mode 0700. The config file is created with mode 0600 only when absent and is never rewritten. The built code writes it and never reads it: the roots always come from the environment and the defaults, so editing the file changes nothing. `init` only prints its path.
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

Gate results, budgets, steps and work items carry no generated identifier: they are keyed by run plus a name.

## The ledger file

The ledger is `state.db` in the data root. Facts that bind every opener except the hook:

- **Runtime gate.** Before any open, the bundled SQLite version must contain the WAL-reset fix: 3.44.6 or later on the 3.44 line, 3.50.7 or later on 3.50, 3.51.3 or later on 3.51, and any line above 3.51. Lines 3.45 to 3.49 never received the fix and are refused, as is a version string that does not parse. The refusal names the Node version to install.
- **Modes.** A new store is created 0600, and SQLite gives the `-wal` and `-shm` siblings the same mode. Each of the three files that exists must be owned by the current user, otherwise the open is refused and nothing is changed. A read-write open tightens an owned file that group or others can reach to 0600 and leaves a stricter mode (0400) alone. A read-only open never changes a mode.
- **WAL.** A read-write open switches the journal to WAL and fails if the switch does not take effect (a filesystem that cannot share memory). It sets full synchronous mode. Foreign keys are enforced and a busy store is waited on for 5 seconds before reporting unavailable.
- **Transactions.** Every write is an immediate-mode transaction, so a writer conflict surfaces at the start and a killed writer's open transaction rolls back on the next open. Each state-changing ledger operation is one transaction: either all its rows commit or none do.
- **Error mapping.** Busy and locked map to unavailable (retryable), constraint violations to conflict, values with no canonical JSON form to invalid, everything else to internal.
- **Two processes write.** The CLI process through the ledger, and the PreToolUse hook process, which opens the same file directly to charge budgets, append events and record what an agent has read. Both rely on SQLite's file locking, and each waits on a busy store (5 seconds for the CLI, 4 for the hook).
- **Hook open.** The hook opens an existing ledger read-write on its own connection with a 4 second busy wait. It does not run the version gate, the ownership and mode check or the WAL switch, and it refuses a ledger path that does not exist rather than creating one.

### Migrations and schema version

Schema version 2 is the latest of two migrations. Version 1 creates the 20 original tables and four triggers. Version 2 (the run) adds four columns to `runs`, three tables, two indexes and four triggers; the tables below describe them. The version is stored in the `meta` table under `schema_version`, and `init` and `status` read it from there. `meta` also holds `profile_id`, written once (insert-or-ignore) by the migration pass that applies the last pending migration.

The runner is forward-only:

- Each applied migration records its version, time and the SHA-256 of its SQL text in `schema_migrations`.
- Before applying, every recorded migration is checked against the shipped text. A different checksum, or a recorded version this build does not ship (a store from a newer build), refuses the store with a conflict error and changes nothing, including no backup. A checksum mismatch also tells the operator that an applied migration must never be edited and to restore from backup or run the build that wrote it. The CLI turns this into exit 70.
- Versions must be contiguous; a gap is refused.
- Each pending migration, its `schema_migrations` row and the `schema_version` update commit in one transaction. A failing migration rolls back alone; earlier ones in the same pass stay applied.
- Before the first pending migration is applied to a store that already has history, the store is copied with `VACUUM INTO` to `backups/pre-migration-{timestamp}.db` beside the database (mode 0600, directory 0700; a numeric suffix avoids collisions). If the copy cannot be written, no migration runs. A fresh store with no history gets no backup, and neither does an in-memory database. A version 1 store with history therefore gets one backup before version 2 applies.
- Backups accumulate; nothing removes them.

Eight triggers enforce immutability. Version 1 installs four: a stored project record's body and digest cannot be updated, a stored contract's body and digest cannot be updated, and events cannot be updated or deleted. Version 2 installs four more: evidence rows and gate result rows cannot be updated or deleted.

Version 2 adds two indexes: evidence by attempt, and events by run. No other table or column is indexed beyond its primary and unique keys.

Quirk: a command that is meant to be read-only first checks for pending migrations. When there are none it opens read-only. When there are some, it opens read-write, migrates (with a backup), then reopens read-only. A read-only command can therefore write once, on the first run after an upgrade.

## Tables by purpose

All 23 tables are created by the two migrations. A writer is code that inserts or updates rows: every such statement sits in the ledger adapter, the migration runner or the hook.

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
| `adapter_configs` | CLI composition | one row per named adapter, upserted each time a non-read-only command starts |

### Runs

A run is a `runs` row with its own lifecycle, contract, budgets, attempts and checkpoints, plus the run-only tables below. An onboarding has no run until its contract is stored. Storing the contract creates a carrier run (state fixed at `onboarding`) that the contract, budgets, attempts and later checkpoints of that onboarding hang off.

The run operations see only rows whose state is a run state. A carrier row is invisible to them: they report it as not found, run listings leave it out, and no run operation can lease, read or move it.

| Table | Writer | Notes |
|---|---|---|
| `runs` | store-contract (carrier row), run creation, run transition, run checkpoint, run lease | see below |
| `contracts` | store-contract, run creation | one row per run and version; body and digest are immutable by trigger; the built code stores version 1 only |
| `budgets` | contract storing, hook, budget accounting | see budgets |
| `attempts` | attempt recorder | ordinal increments per run; a run attempt ends once |
| `checkpoints` | create, transition, checkpoint (onboardings and runs) | see checkpoints |
| `run_steps` | step recorder | one row per run, step name and attempt number, replaced on re-record; see attempts and steps |
| `work_items` | run creation, work item transition | see work items |
| `decisions` | decision recorder | see decisions |
| `evidence` | evidence recorder | insert-only; see evidence and gate results |
| `gate_results` | gate recorder | insert-only; see evidence and gate results |
| `check_validations` | check validation | see check validations |
| `hook_reads` | hook | see hook reads |

The `runs` row of a real run is inserted once, in state `contract_ready` at version 1, together with its first contract, budget rows and work item. Each transition raises the version by one and commits the new state, a checkpoint and an event together. Four columns come from the second migration:

- `reason` holds the blocked reason while the run is `blocked_on_decision` and is cleared by every other transition. A reason is refused on any other target state, and a move to `blocked_on_decision` without one is refused. The seven accepted reasons are listed in [runs.md](runs.md).
- `workspace_path` is set when a transition supplies it (the move to `running`, or a block that happens before that move) and is kept by later transitions that supply none.
- `branch` and `base_revision` are set when the run is created and kept the same way.

A carrier row is inserted once per onboarding and no code updates it afterwards, so its state and version never change and its lease columns are unused (an onboarding's lease lives on `onboardings`).

### Log and artifact index

| Table | Writer | Notes |
|---|---|---|
| `events` | ledger, application layer and hook | append-only hash chain, see event log |
| `artifacts` | artifact recorder | index of stored blobs, see artifact store |

### Tables with no writer

| Table | Evidence of absence |
|---|---|
| `task_refs` | no statement in the source writes or reads it |
| `approvals` | same |

These two exist in the schema and stay empty. The port has no method for them. One unused column also sits in a written table: a checkpoint's GSD state digest, which no code sets. Two more columns are never set by any caller: an evidence row's external reference, and the answer columns of a decision (see decisions).

## Event log

The event log is the `events` table: one row per notable fact, chained by hash.

- **Append-only.** Triggers abort any update or delete. Sequence numbers come from an autoincrementing key, so they are never reused.
- **Chain.** Each row stores the previous row's hash; the first uses 64 zeros. The row hash covers the previous hash, the timestamp, the type, the run id (or empty) and the canonical data JSON. It does not cover the level, attempt id or invocation id. The previous hash is read inside the writer's transaction, so the CLI and the hook continue one chain. No shipped code verifies the chain, so tampering is detectable only by an external check.
- **Columns.** A row carries an optional run id, attempt id and invocation id beside the data. For an onboarding the run id is the onboarding's own id until its contract is stored and the carrier run id afterwards.
- **Size limits.** Event data is for identifiers, counts, digests, exit codes and short targets, never payloads. A string longer than 1024 characters anywhere in the data, or canonical data JSON longer than 8192 characters, is refused as invalid and the whole transaction rolls back. Stored documents (contracts, records, step results) are separately capped at 1 MiB and are refused with a pointer to the artifact store. Some free text still reaches events in short, cut form: a check's validation reason, an index detail, a containment finding's paths and a tool's target.
- **Atomicity.** Transition, checkpoint, contract, attempt, evidence, gate, work item and decision events commit in the same transaction as the row they describe. Events appended by the application layer (findings, invocation outcomes, check results, the hand-off) are separate transactions, so a crash between the work and its event can leave one without the other. A block of a run is several separate transactions: the finding event, the decision record, the work item move, the attempt end and the run transition. A crash between them leaves an open decision on a run that is still `running`.
- **Reads that depend on events.** The reason an onboarding is blocked or incompatible is not a column; it is read back from the latest transition event for that onboarding, by scanning events by type and by a field inside the data. A run's reason is a column. The events-by-run index serves reads of one run's events. The hook's per-invocation counts (denials, subagents in flight, consecutive searches) filter by invocation, which is not indexed, so they scan.

Event kinds emitted: 28. Every kind below has a writer in the built code. Levels are debug, info, warn and error; the table gives the level each kind is written at.

| Kind | Writer | Level | Meaning and data |
|---|---|---|---|
| `onboarding.transition` | ledger | info | a state change, including creation and activation. Data: onboarding, from, to, version, next action, checkpoint; reason when blocked or incompatible; project at creation; record version and digest at activation |
| `onboarding.checkpoint` | ledger | info | a checkpoint without a state change. Data: onboarding, state, next action, sequence, checkpoint |
| `contract.stored` | ledger | info | a contract was stored, for an onboarding's carrier run or for a run. Data: run, version, digest; plus the onboarding for a carrier |
| `run.created` | ledger | info | a run row was inserted. Data: run, project, state (always `contract_ready`), version (1) |
| `run.transition` | ledger | info | a run state change. Data: run, from, to, version, next action, checkpoint; reason when blocked; plus the caller's short fields, such as the decision, class, item, gate, a reconcile flag or an inconclusive count |
| `run.checkpoint` | ledger | info | a run checkpoint without a state change. Data: run, state, next action, sequence, checkpoint |
| `attempt.started` | ledger | info | a run attempt opened. Data: run, attempt, ordinal |
| `attempt.ended` | ledger | info | a run attempt ended. Data: run, attempt, outcome |
| `work_item.upserted` | ledger | info | a work item row was written. Data: run, item, type, whether it was newly created |
| `work_item.transition` | ledger | info | a work item changed state. Data: run, item, from, to; plus the caller's fields, such as the decision and the reason |
| `decision.opened` | ledger | info | a decision record was opened. Data: run, decision, class, urgency, contract version |
| `evidence.recorded` | ledger | info | an evidence row was inserted. Data: run, evidence, name, kind, status |
| `gate.result` | ledger | info | a gate row was inserted. Data: run, gate, passed, revision, number of failures; item when item-scoped |
| `check.validated` | application | info | a declared check was judged in the validation clone. Data: run, check name, verdict; the reason when there is one, cut short |
| `check.finished` | application | info | a check ran. Data: run, attempt, name, label, status, exit code, duration, evidence; a pre-existing flag when the check was already failing at base |
| `handoff.fetched` | application | info | the run branch was fetched into the source repository. Data: run, attempt, branch, the resulting revision, whether the ref was newly created |
| `invocation.finished` | application | info | a contained agent invocation ended. Data: the owner (onboarding, or run, attempt and item), invocation, purpose, outcome, cost reported and cost charged with its basis, duration, permission denials; when the host reported details, also exit code, signal, timed-out flag, head-moved flag, hook denials and budget denials, turns, transcript size, and optionally the result subtype, the terminal reason and the subagents spawned |
| `invocation.reaped` | application | warn | a stale invocation's host processes were ended on resume. Data: the owner (onboarding or run), invocation when known, number terminated |
| `invocation.reconciled` | application | info | an onboarding resume found the interrupted invocation's expected map files complete and treated it as finished (no event is written when the files are incomplete). Data: onboarding, attempt, invocation when known |
| `invocation.interrupted` | application | warn | a run resume marked a launch step interrupted. Data: run, step, invocation when known |
| `invocation.orphan-charged` | application | warn | budget was charged for invocations that never reported. Data: the owner (onboarding or run), number of invocations, cost charged |
| `verification.interrupted` | application | warn | a run resume reconciled a run killed during verification. Data: run, number of checks marked inconclusive, the action the run resumes at |
| `containment.finding` | application | warn | a stage found a containment violation or note. Data: the check name, plus the onboarding and invocation or the run and attempt, and where the check has them a count and a capped list of cut paths |
| `index.absent` | application | warn | an index was not built, with a reason. Data: onboarding, index, reason; a cut detail when there is one |
| `hook.decision` | hook | info for allow, warn for deny | one allow or deny. Data: onboarding, invocation, tool, agent when a subagent made the call, tool-use ID and background flag for subagent calls, decision, rule, and the budget when one was charged or exhausted |
| `loop.limit` | hook | warn | an invocation reached its limit of consecutive denials or consecutive searches. Data: run, invocation, reason, count, limit |
| `tool.completed` | hook | info | a tool call finished. Data: onboarding, invocation, tool, agent when a subagent made the call; for a file write the target relative to the clone (or a cut target and digest, or an outside-the-clone or unresolved marker); a failed flag; for subagent calls the tool-use ID and whether the call released a concurrency slot |
| `config.change.denied` | hook | warn | an attempted settings edit was refused. Data: onboarding, invocation, the source when the host named one |

The `containment.finding` check names written for onboardings are `staging-head-moved`, `scope-of-writes` and `activation-scope`. For runs the blocking stage chooses the name; [containment.md](containment.md) and [runs.md](runs.md) describe each.

Quirk: the hook names the owner of an invocation in a field called onboarding. For a run invocation that field holds the run ID, because a run has no onboarding.

## Checkpoints and continuity

A checkpoint records a from-state, a to-state, a next action and optionally a revision. A run checkpoint also records the attempt and work item it concerns when the caller names them. One is written on creation, on every transition and on every explicit checkpoint call. A run's sequence is its own: the next number is the highest for that run plus one. Two checkpoints cannot share a sequence within one run id (unique constraint).

An onboarding's sequence is continuous across its own id and its carrier run id: the next number is the highest across both plus one, and the latest checkpoint is the highest sequence. Before the contract is stored the rows carry the onboarding id as their run; afterwards they carry the carrier run id, and the sequence carries on without a restart. The next-action values a run uses are in [runs.md](runs.md).

## Leases and optimistic concurrency

A lease lives on the row of whatever holds it: the `onboardings` row for an onboarding, the `runs` row for a run. Both use one rule. Acquiring takes a free lease or one whose expiry has passed and bumps a fence counter, so a previous holder's next fenced write fails. Renew and release require the holder and fence to match. Expiry is compared as ISO timestamp text.

The fence guards the writes that move a thing forward. For an onboarding these are every transition and checkpoint; transitions also present the row version they last read. For a run these are every transition (which also presents the version), run checkpoint, contract storage and work item transition. A mismatch is a conflict and nothing is written. The other run writes take no fence: steps, attempts, evidence, gate results, decisions and budget changes. The one exception is the failed reconcile step, which presents the fence, so a superseded supervisor cannot record it. A superseded supervisor can still record the other unfenced rows until its next fenced write fails. The transition rules themselves are in [onboarding.md](onboarding.md) and [runs.md](runs.md).

## Budgets

Budget rows are created from the contract inside the contract-storing transaction, one per named budget and run. Creation leaves an existing row untouched, so a retry or resume cannot reset a counter or raise a limit. A run has five: `invocations`, `toolCalls`, `subagentsTotal`, `wallClockMs` and `costUsd`. Afterwards only two columns move, and only upward:

- Reserving adds to the reserved amount only while used plus reserved plus the amount stays within the limit; otherwise nothing changes and the caller is told it was not granted.
- Charging adds to used. From a reservation, the amount moves out of reserved first and the call fails if the reservation is too small. Charged directly (an estimated cost after the fact), it may pass the limit.
- The charges of one invocation settlement, or of one orphan conversion with its `invocation.orphan-charged` event, change their rows together in one transaction: if any charge fails, no row changes and no event is written.
- The hook charges one unit per allowed call with the same conditional update. A missing row for a charged budget is treated as a broken ledger and fails closed; a row at its limit produces a `budget_exhausted` deny.
- An invocation reserves one unit of `invocations` and a cost amount before it launches. When the holder dies before settling, the next reservation, or a run resume that has ended the host, turns the reservation into spent budget and writes `invocation.orphan-charged`.
- Nothing refunds, resets or deletes. A limit is fixed at creation.

## Attempts and steps

An onboarding attempt is a numbered try inside the carrier run and needs the contract stored first. A run attempt is numbered per run, needs a reason, and ends once with an outcome; ending it a second time is a conflict. Run attempts write `attempt.started` and `attempt.ended` events.

An onboarding step result is keyed by onboarding, step name and attempt number; a run step result is keyed by run, step name and attempt number in `run_steps`. Recording a step again for the same key replaces its status, result and timestamps, so a step row shows the latest outcome only; the history of that key is not kept (the events are the history). Step results are capped at 1 MiB.

A run step has one of six accepted statuses: `started`, `completed`, `failed`, `interrupted`, `reconciled`, `skipped`. The built code never writes `reconciled` for a run. It writes `started` and `interrupted` for launches, `skipped` for a dependency install with nothing to install, and `completed` or `failed` otherwise. The 23 step names a run writes are `start:preflight`, `host:config-dir`, `supervisor:spawn`, `supervisor:resume`, `supervisor:decide`, `workspace:prepare`, `gsd:inspect`, `gsd:configure`, `deps:install`, `checks:validate`, `baseline`, `context:pack`, `item:base`, `launch:run`, `snapshot`, `classify`, `discard`, `park`, `repair:reproducer`, `resume:fallback`, `commit`, `handoff:fetch` and `resume:reconcile`. `host:config-dir` holds the host configuration directory the run was started under and where it came from (`CLAUDE_CONFIG_DIR` or `default`); it is written once, before the first supervisor is spawned, and a run started before it was written has none. [runs.md](runs.md) says what the stages record.

## Work items

A work item is keyed by run and item ID and carries its type, the items it depends on, a size, a model, the item's specification as JSON and a state. The ledger accepts the types `implement` and `harden`; the built code writes `implement` only. A row is created in state `ready`. Writing an item again changes its description but never its state or attempt count: only a state move does, and each move to `delegated` adds one to the attempt count. The states and moves are in [runs.md](runs.md). Both writes emit an event.

## Decisions

A decision is a record opened when a run cannot finish inside its contract. It carries a class, the issue text, an optional recommendation, options, consequences and references to evidence. It also carries the affected items, an optional authorized default, a digest of the state it was opened on, an urgency and a state. Its contract version is the one the run was on.

The ledger accepts eight classes (`acceptance`, `architecture`, `scope_expansion`, `permission`, `repeated_failure`, `equivalent_mutant`, `contradiction`, `budget`), two urgencies (`blocking`, `digest`) and four states (`open`, `answered`, `stale`, `withdrawn`). The built code writes four classes (`acceptance`, `permission`, `repeated_failure`, `scope_expansion`), urgency `blocking` and state `open`. No code updates a decision, so the answer columns (who answered, when, what and through which channel) are never set. A decision is never answered, made stale or withdrawn. What a decision means for a run is in [runs.md](runs.md).

## Evidence and gate results

Evidence and gate result rows are insert-only: a trigger refuses any update or delete, and the port has no method that changes one. A correction is a new row. A check interrupted by a kill is marked by inserting a new row with status `inconclusive`, not by editing the one that was started.

An evidence row hangs off an attempt, not a run; the run is found through the attempt. It records a kind, a name, the status, the revision and tree digest it was measured on, a clean flag and the environment as JSON. It also records the contract version, the policy revision, an independence and the acceptance criteria it speaks to. Optional parts are test and command details, an exit code, a duration and an artifact digest. The ledger accepts six statuses (`passed`, `failed`, `skipped`, `unavailable`, `inconclusive`, `stale`) and three independences (`deterministic`, `external`, `model-review`). The built code writes four kinds: `check`, `test-inventory`, `gsd-verdict` and `diff`. Their independence is `deterministic`, except the `gsd-verdict`, which is `model-review`. The external reference column is always empty. What the kinds and statuses mean is in [checks-and-evidence.md](checks-and-evidence.md).

A gate result row records the gate, an optional work item, the contract version, policy revision and revision it was judged on, whether it passed and its failures as JSON. The built code writes three gates, `G0`, `G2` and `G4`, and a gate can have several rows for one run.

## Check validations

`check_validations` caches the verdict on one declared check, keyed by project, base revision, the digest of the check's specification and the check's name. It belongs to no run, so a later run on the same project, revision and specification reuses the verdict. The verdicts stored are `active` and `rejected`, with a JSON detail (the reason and, for a rejection, the offending paths or hosts). A verdict of `unavailable` is judged but never stored, so the next run looks again.

The first verdict for a key wins: a second insert is a conflict, and the validating code treats that as a concurrent run having recorded the same fact. No code updates or deletes a row, and unlike evidence no trigger forbids it. How a check is validated is in [checks-and-evidence.md](checks-and-evidence.md).

## Hook reads

`hook_reads` records what an agent has read, so that an edit can be refused when the agent has not read the file as it is now. It is keyed by invocation, agent and path. It holds the file's digest, the sequence number of the event of the call that recorded it, and a time. The hook writes it with its own SQL when three things hold. A completed read or write targets an existing file under the clone or a write root, the call did not fail, and the invocation's policy enables the read-before-edit rule (run invocations do). A later read or write of the same key replaces the digest, sequence and time. Before an edit the hook compares the recorded digest with the file on disk; the rule is in [containment.md](containment.md).

## Artifact store

Blobs are stored under `artifacts/` in the data root, addressed by the SHA-256 of their content as `sha256:` plus 64 lowercase hex characters, at `artifacts/{first two hex}/{full hex}`.

- **Writes.** A blob is written to a temporary file in its final directory, synced, then renamed, so a partial write never appears under its digest. The directory is then synced best-effort; a failure there is not an error. Files are 0600 and directories 0700.
- **Idempotent.** Putting content that is already stored is a no-op only if the stored bytes really hash to the digest; a truncated or corrupted file of the same size is replaced.
- **Reads.** A read re-hashes the bytes and reports an internal error if they no longer match, and not-found if absent. Disk-full surfaces as unavailable.
- **Kinds written.** Seven kinds are indexed. `transcript` is an agent invocation's transcript, with retention class `onboarding` for an onboarding's invocation and `run` for a run's. Onboarding writes `map-document` (each codebase map document at activation), `map-snapshot` (the manifest of those documents) and `knowledge-manifest`, all with class `onboarding`. Runs write `check-output` (the output of one check run), `test-inventory` (the test inventory a check measured) and `gsd-quick-record` (a record of the quick unit a run delegated), all with class `run`. Every row has store `local`.
- **Metadata is in the ledger.** The store itself keeps no metadata. The index row is inserted separately after the blob is stored, insert-or-ignore on the digest. The first kind and run recorded for a digest win, and a crash between the two leaves a blob with no index row.
- **Retention.** The retention value is a label, `onboarding` or `run`. No code reads it, and no code deletes or expires blobs or rows.

## Project record

The project record is the stored description of an onboarded repository: operational metadata only (paths, digests, revisions, classifications), never document text.

- **Versioning.** Activation inserts the next version for the project (highest plus one, starting at 1). A caller-declared version must equal it or the activation conflicts. The previous active version is marked superseded in the same transaction. A superseded row keeps its state text as active; the current record is the one with no superseded time. Body and digest are immutable by trigger, and only the supersession time is ever updated.
- **Digest.** The digest is over the canonical form of the body, so key order does not matter and any change to the body changes it.
- **Required content.** Activation refuses a body without the onboarded revision or the GSD version, or one whose project id differs from the onboarding's.
- **Content.** The body holds identity, revisions, profile, policy preset (`routine`) and promotion (`none`), GSD identity and the contract it was produced under. It also holds preflight facts and findings, map-document digests, mapping state, indexes, unmapped paths and granted authority. The record type is the owner of the exact shape; [onboarding.md](onboarding.md) lists what each part means.
- **Authority only narrows.** Defaults grant nothing: no write paths, endpoints or credentials. Repository proposals can only narrow what the profile policy grants; protected paths only accumulate; widening needs a new record version.
- **Completeness.** It is derived from the mapping mode, never from the files found: `full` is complete, `fast` and `paths` are partial, `skip` is none. The record builder passes no file evidence, so an adopted map is always recorded as partial. Mapping scope is stored as written, and the mode, scope and completeness are also copied to queryable columns together with the index commits.
- **Indexes.** The record folds the stored index step results. A present code graph becomes the graph entry (location, digest, build commit, tool, freshness, node and edge counts); the knowledge step, when present, replaces the graph digest and adds its document counts to that same entry; a present intel index becomes the intel entry. An index that was not built is listed under absent with a reason, never silently omitted. An index step disabled by the contract says nothing. A present step whose result is malformed counts as absent with reason `invalid-result`, and knowledge without a graph is absent with reason `graph-absent`. Absent is omitted entirely when nothing is absent. Index detail is in [indexes-and-context.md](indexes-and-context.md).
- **Reads.** The active record for a project is the highest version with active state and no superseded time.

## Files left on disk

Data root, besides the ledger:

- `backups/` holds pre-migration copies.
- `artifacts/` holds blobs.
- `onboard/{onboarding}/{purpose}-{invocation}/` holds the five generated inputs of one contained invocation of an onboarding: host settings, hook policy, agent list, a plugin directory of linked skills, and an empty MCP configuration. Files are 0600, directories 0700, written by temporary file and rename. The data root is denied to the contained agent. Nothing removes these directories.
- `run/{run}/run-{invocation}/` holds the same five inputs for one invocation of a run. The directory name is singular.
- `runs/{run}/contract-v{n}.json` holds the run's contract as canonical JSON, written by temporary file, sync and rename, mode 0600 in a 0700 directory. The built code writes version 1 only. The ledger holds the contract too: if a start is killed between the ledger transaction and the file write, the supervisor rewrites the file from the ledger before it launches anything. The directory name is plural.
- `shell-history` holds the interactive shell's command history, one entry per line, oldest first, mode 0600. It is capped at 1000 lines; at the cap the file is rewritten without its oldest line through a temporary file and a rename. An entry is stored without control characters or escape sequences. A missing, unreadable or unwritable file is an empty history or a skipped entry, never an error that stops the shell.

Work root, per onboarding:

- `{onboarding}/staging` is a full local clone of the user's repository (no hardlinks, no checkout until detached at the pinned commit), on the branch `avarice/onboard-{onboarding}`. The clone is built at a partial path and renamed into place only when complete, so `staging` is whole or absent. A leftover partial directory is removed only when it is demonstrably this adapter's clone of the same repository; `staging` itself is never removed.
- `{onboarding}/graph-build/` holds graph tool output outside the staging tree.

Work root, per run:

- `{run}/clone` is the run's clone, built by the same partial-then-rename rules as staging and detached at the onboarded revision, on the branch `avarice/{run}`.
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

Nothing is promoted anywhere else: the record's promotion field is `none`, and the map documents leave staging only as artifact blobs and record digests.

## Quirks to keep in mind

- Two tables are schema-only; do not build on them without adding a writer.
- A decision is never answered: the answer columns and three of its four states are unreachable in the built code.
- A superseded project record still says active; test the supersession time.
- A read-only command can migrate and back up the store on the first run after an upgrade.
- The config file is written once and never read.
- The event hash chain leaves out three event columns and has no verifier.
- Retention labels exist; retention behavior does not.
- Step rows are replaced on re-record; budgets, events, evidence and gate results are not.
- The run's directory in the data root is `runs` for the contract and `run` for the invocation inputs.
- The hook's event field for the owner is called onboarding even when the owner is a run.
- A block of a run is not one transaction. The fence guards a run's transitions, checkpoints, contract and work item moves, and a failed reconcile step, but not its other steps, attempts, evidence, gates or decisions.
- A carrier run row of an onboarding is invisible to every run operation, so the `runs` table holds rows that no run listing shows.
