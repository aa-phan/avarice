# Onboarding

This document describes the onboarding flow implemented by the onboarding service, its stages, the resume and reconcile logic, the supporting domain modules (lifecycle, preflight, mapping, onboarding contract, validation, project record) and the git staging adapters (`src/app/onboarding-service.ts`, `src/app/stages/`, `src/app/resume.ts`, `src/domain/`, `src/adapters/git/`).

Onboarding takes one existing git repository to one immutable project record, in a fixed pipeline: register and preflight, compile a contract, stage a clone, map with GSD in a contained host, validate, build indexes, activate. Nothing is written to the user's repository or to its `.planning/`. Every stage commits a checkpoint before its side effect and a transition after it, so a killed run resumes from the committed state. The sibling documents own what this one leaves out. They are [containment.md](containment.md) (hook and sandbox), [data-model.md](data-model.md) (tables), [indexes-and-context.md](indexes-and-context.md) (index internals) and [cli-reference.md](cli-reference.md) (flags). [runs.md](runs.md) covers the unattended run of one work item, which starts from the active record this pipeline produces.

## Entry points

Three commands drive the flow.

- `repo add` registers the project and preflights it. It creates an onboarding in `discovered`, takes no lease and runs no stage. It always stores mapping mode `full`, promotion `none` and no budget overrides, and with `--profile` it binds the repository to a profile (see [profiles-and-credentials.md](profiles-and-credentials.md#selecting-a-profile)).
- `onboard` does the same registration, then takes the lease and runs the stage loop to a stop state. It accepts mode `full` or `fast`, a promotion of `none`, `copy` or `commit`, budget overrides, and `--restricted`; the CLI rejects any other mode. On a project that already has an active record it is a refresh of that record (see [Refresh](#refresh)).
- `resume` continues an onboarding by ID.

An onboarding ends in `active` only through activation. The other stop states are `blocked`, `incompatible` and `deactivated`.

## Lifecycle states

The lifecycle has 14 states and 29 allowed transitions. A transition outside the table is refused by the ledger inside the same transaction that would commit it, so no stage can skip an edge.

| From | Allowed next states |
|---|---|
| unregistered | discovered |
| discovered | contract_proposed, blocked, incompatible |
| contract_proposed | mapping, blocked, incompatible |
| mapping | validating, paused, blocked |
| paused | mapping, blocked |
| validating | validation_failed, planning, planning_ready, blocked |
| validation_failed | mapping, blocked |
| planning | planning_ready, blocked |
| planning_ready | active, blocked |
| active | stale, incompatible, deactivated |
| stale | mapping |
| incompatible | contract_proposed |
| blocked | contract_proposed |
| deactivated | discovered |

Every pre-activation state (discovered through planning_ready) may move to `blocked`. A block carries one of six reasons: `enforcement_failure`, `budget_exhausted`, `existing_state_conflict`, `scope_unavailable`, `adapter_incompatible`, `decision`. A reason is accepted only on a move to `blocked` or `incompatible`, and every move to `blocked` requires one. Stages record four of them: `enforcement_failure`, `budget_exhausted`, `scope_unavailable` and `decision`. `existing_state_conflict` and `adapter_incompatible` exist in the type only, and a move to `incompatible` carries no reason.

Which states the code reaches:

- Reached by the stage loop: discovered, contract_proposed, mapping, validating, validation_failed, planning_ready, active, blocked, incompatible.
- `paused` is entered only by the resume prelude, which also leaves it. The map stage has a `paused` branch for an invocation outcome. The outcome classifier returns `paused` only when a caller passes it a structural pause signal, and no onboarding stage does, so that branch is not reached.
- Never entered by any stage, command or adapter: `planning`, `stale`, `deactivated`. Their edges exist in the table only.
- The edges out of `blocked` and `incompatible` (back to `contract_proposed`) and out of `deactivated` are never driven. A blocked or incompatible onboarding is final in practice: resume reports it and changes nothing, and a new `onboard` creates a fresh onboarding for the same project.

Each state with a stage has a recorded next action, written to the checkpoint so `status` can tell an operator what was about to happen. The actions are: discovered (compile the contract); contract_proposed (prepare workspace, configure GSD, verify enforcement); mapping (launch the map); paused (reconcile the invocation); validating (validate); validation_failed (retry or block); planning_ready (the three index steps, then activate).

## Stage loop and leases

The loop reads the committed state, runs the one stage for it, and repeats until a stop state. A stage that returns without changing the row's state or version is an internal error, which stops the loop instead of spinning.

A run holds a lease on its onboarding. Taking it succeeds only when the lease is free or its expiry has passed, and every take bumps a fence number. The default lifetime is 180 seconds (an environment variable overrides it in the fault tests). The holder renews every third of the lifetime from a background timer, so a stage that waits on the host for a long time keeps the lease. Every transition, checkpoint and activation carries the fence, so a previous holder that wakes up after a takeover is refused at its next write. A failed renewal ends the loop at its next check. The lease is released on the way out.

Consequence: two processes racing for an expired lease produce exactly one runner; the loser reports a conflict and changes nothing. A live lease also blocks `resume`; `status` shows a pre-activation onboarding as interrupted when its lease is absent or expired. The unattended run takes its lease on its own row by the same rules; [runs.md](runs.md) describes that supervisor.

## Preflight and refusals

Preflight inspects the repository without opening any working-tree file. Committed content is read from git objects at the pinned commit; uncommitted and untracked files are known by name only and are never mapped. The pin is the HEAD commit at registration time.

Refusals, checked in this order:

1. A promotion value other than `none`, `copy` or `commit` is refused as invalid, naming the three. Promotion itself runs after activation (see [Promotion](#promotion)).
2. For `repo add`, a project (same root commit and path) that already has an active record is refused as a conflict. `onboard` does not refuse it: the onboarding is a refresh of the record.
3. A project with a live onboarding in any state other than `discovered` is refused as a conflict that names the onboarding and the resume command.

An onboarding still in `discovered` is continued instead of duplicated, whether it came from `repo add` or from a kill right after registration. It keeps the request it was registered with, so `--restricted` given to one registered without it, or the reverse, is refused. Onboardings in stop states are ignored, so a blocked project can be onboarded again from scratch.

What preflight records, as names and classifications only, is the default branch, uncommitted and untracked file names, instruction files, submodules, nested repositories, workspace manifests, ADR directories, runtimes and tracked file and byte counts. It also records the existing-state block and, when the project has an active record, the record version and revision the onboarding refreshes. Each list is capped at 1000 entries; a cut is named under a `truncated` key. The existing-state block holds whether a `.planning/` directory exists and the class of the codebase map (see below). It also holds the outcome that class has before GSD's drift check, the drift (empty until staging) and the user-owned planning files.

### An existing codebase map

The existing `.planning/codebase/` map is classified as one of these:

- none;
- stamped-complete (all seven files stamped);
- stamped-partial;
- unstamped;
- unknown-format (a file that is not one of GSD's seven);
- user-edited (a commit touched a file after the commit that wrote its stamp, or uncommitted changes sit under `.planning/`). Classes are tested in this order. First is none (no map files and no uncommitted change under `.planning/codebase/`). Then come unknown-format, user-edited and unstamped, and last stamped-complete or stamped-partial. Unknown-format therefore outranks user-edited.

The class decides what happens to the map. A stamp alone never makes a map adoptable: a complete stamped map is adopted only when GSD's own drift check, run in staging and never in the user's checkout, passes.

| Class | Outcome |
|---|---|
| none | the map is made |
| stamped-complete | adopted when the drift check passes; refreshed when it blocks; mapped in full in staging when the verdict cannot be given (no stamp that resolves, no structure document, a failed run) |
| stamped-partial, unstamped | mapped in full in staging |
| unknown-format, user-edited | isolated regeneration: the map is mapped in staging and the user's files stay as they are |

Preflight, which reads only the checkout, records the outcome as it stands without a drift verdict. The workspace stage runs the drift check for a stamped-complete map, plans the refresh (see [Refresh](#refresh)), and records the final outcome and the drift result in the mapping plan and in the project record. Every regeneration happens in staging, and the user's `.planning/` is never written except by a promotion the owner asked for.

The files that stay the user's are named in the existing-state block as the user-owned planning files. For an unknown-format map that is every file of it. For a user-edited one it is the files edited after their stamp and every changed file under `.planning/`. `repo add` prints them and the note for the class.

## Contract compilation and budgets

The `discovered` stage first checks that GSD is present and inside the admitted version range. A missing or out-of-range GSD stops the onboarding in `incompatible` with what was found and what is admitted, before any contract or staging exists.

It then compiles the onboarding contract from the stored request and preflight, stores it with its digest and creates the budget rows in the same step, and moves to `contract_proposed`. A crash after storing and before the transition is repaired on resume: the stored contract is reused, never recompiled. A refused compile blocks with reason `decision`.

The contract fixes, for this run only:

- Mapping mode: default `full`.
- Agent write sets, one each for map, intel and knowledge: `.planning/codebase/**`, `.planning/intel/**`, `.avarice-knowledge/**`. Files AVARICE itself writes are separate: the GSD config and the `.planning/graphs/` directory. The delete list is the map write set when the existing-map answer is `refresh` and the repository has a map, and empty otherwise. It describes the staging copy, where every regeneration happens, and never the user's checkout.
- Read exclusions (`.git`, `build`, `coverage`, `dist`, `node_modules`, `vendor`), secret-path globs removed from the read scope, and read-only inspection commands plus the intel verb.
- Knowledge documents: all Markdown under `docs/`, plus each ADR directory preflight found.
- The existing-map answer: `refresh`. It is passed to the mapper in its prompt (see mapping).
- Which indexes are on: all three. The profile may switch the knowledge pass off (`adapters.knowledgePass`), which the record then shows as disabled.
- The decision lists: four decisions that need a human, four prohibited decisions.

Budgets, with the preset ceilings:

| Budget | Preset |
|---|---|
| Wall clock | 45 minutes, split 20 map, 10 intel, 15 knowledge |
| Tool calls | 600 |
| Concurrent subagents | 4 |
| Cost | 3.00 per invocation, 12.00 per run, flagged as estimated |
| Retry | 1 |
| Subagent total | derived from mode |
| Invocation total | derived from mode |

Overrides can only lower a value; a higher one is refused, as is an unknown budget name or a non-integer where an integer is required. When wall clock is lowered, the three shares scale down with it. The subagent total is map agents per round plus the mapper re-runs the mode allows in a round, times the map rounds (1 plus retries); the knowledge pass and intel contribute none. A full map has 4 mappers and a re-run allowance of 2 per round, because the orchestrator of GSD's map workflow may spawn a mapper again when its first answer was wrong. Fast has 1 mapper and no allowance, skip and adopt have none, and paths has 4 mappers and no allowance. A spawn beyond the total is still denied by the hook, and any hook denial still blocks the onboarding. The invocation total is map invocations times rounds, plus one relaunch allowance per map round (one in total when no mapper runs), plus one intel and one knowledge invocation. Both derivations are stored with their formula text inside the contract. The defaults come to 12 subagents and 6 invocations for full, 2 and 6 for fast, and 0 and 3 for skip. The per-invocation cost also bounds how many documents the knowledge pass may send; the rule is in [indexes-and-context.md](indexes-and-context.md#the-cost-cap).

Budget rows live in the ledger and survive kills. An invocation is reserved before the host starts and settled after. A reservation whose holder died is charged as spent by the next reservation, at the cost it had been allowed to use, not at zero. Nothing is refunded. An exhausted budget before a map launch blocks with reason `budget_exhausted`.

## Staging

Staging is a local clone of the user's repository, made with hardlinks disabled and no checkout, detached at the pin and switched to a branch named for the onboarding, under the profile work root. The clone keeps its own git directory, so the sandbox can deny that directory entirely and the user's repository stays byte-identical: no worktree metadata, no branch ref, no object written. The clone starts without the user's repository configuration, so the user's filter drivers and file-monitor settings do not exist in staging.

The clone is built in a partial directory and renamed into place only when it sits on the branch at the pin, so a staging directory is either complete or absent. Re-preparing is idempotent. An existing staging directory is reused only if it is its own repository, cloned from this repository, on the staging branch, at the pin; anything else is a conflict and is left alone. A leftover partial directory from a crash is removed only if it is demonstrably this adapter's own; otherwise it is a conflict.

The worktree adapter is dormant. It is a complete implementation behind the same port, selected only by the strategy constant, and the constant is fixed to the clone. The composition root builds the workspace from that constant; no configuration, flag or environment variable changes it. Only tests construct the worktree adapter. It differs in that it would write worktree metadata and a branch ref into the user's `.git`.

## Mapping

Before the first host invocation, AVARICE probes GSD in staging, decides the mapping mode and configures GSD, all with the staging directory as working directory. The settings applied turn off GSD's own commits and enable text mode, intel and graph indexing. The decision is stored as the mapping plan; later stages read the mode from the plan, falling back to the contract.

Mode decision, in order:

1. GSD reports the repository is not brownfield (for example a README-only repository): mode `skip`, completeness none, whatever was requested.
2. Requested `skip`: skip. Requested `fast`, or a restricted onboarding: fast.
3. Requested `adopt`: adopt when the outcome for the existing map is adoption, otherwise refused as unsupported with the reduced mode `full`.
4. Requested `paths`: the directories of the contract's read scope, or invalid when that scope is the whole repository.
5. Otherwise, when a refresh plan exists, by the plan (see [Refresh](#refresh)). An incremental plan adopts the map with no mapper, a scoped plan maps its paths, and a full plan maps everything, or the directories of a narrower contract read scope.
6. Otherwise by the outcome for the existing map. Adoption takes the map with no mapper. A refresh outcome with no plan, or any other outcome, maps in full in staging, or in the directories of a narrower contract read scope.

Before the first invocation the mode also has to be one the admitted GSD can perform. A mode whose capability GSD lacks (`map-paths` for `paths`, `adopt-map` for `adopt`) blocks the onboarding with `scope_unavailable`, naming the capability and the reduced mode, and nothing is simulated. The admitted GSD declares both capabilities. The CLI offers only full and fast, so `adopt` and `paths` are reached through a refresh or an existing map, or through a stored request that bypasses the CLI.

| Mode | Files required | Completeness | Scope in the record |
|---|---|---|---|
| full | seven map files | complete | `.` |
| fast | four map files (stack, integrations, architecture, structure) | partial | those four files |
| paths | seven map files | partial | the named directories |
| adopt | four map files | complete when all seven map files are present, otherwise partial | the files of the map |
| skip | none | none | empty |

Completeness is derived from the mode and, for an adopted map, from the files present, never from what the documents say. An adopted map runs no invocation and no budget, and goes straight to validation, which judges its files like any other map's. The record then says the map was adopted (`provenance: adopted`).

### Refresh

An onboarding of a project that has an active record is a refresh of that record, and so is the onboarding of a repository whose existing map is stamped complete. The workspace stage plans how much of the map to rebuild from what changed since the revision the map describes, which is the active record's revision or the map's stamp. The facts are GSD's drift verdict in staging, the paths that changed (outside `.planning/`), the top-level directories the new HEAD added, and whether a manifest or workspace file changed. The plan is chosen by this table, the first row that applies deciding.

| Order | Condition | Plan, and the reason it records |
|---|---|---|
| 1 | no stamp, or no revision to measure from | full: `no-stamp` |
| 2 | GSD could not judge the map | full: `drift-unreadable` |
| 3 | a manifest or workspace file changed | full: `manifest-change` |
| 4 | at least 3 new top-level directories | full: `new-top-level-dirs` |
| 5 | GSD reports no drift | incremental: `no-change` when nothing changed, else `no-structural-change` |
| 6 | drift confined to at most 50 named paths that can travel as one `--paths` value and are no manifest | paths: `drift-block`, mapping those paths |
| 7 | any other drift | full: `drift-block` |

An incremental plan adopts the map and runs no mapper, and the indexes are brought up to date from the changed paths (see [indexes-and-context.md](indexes-and-context.md#refreshing-the-code-graph)). The constants, including the 29 manifest names, are in [config-reference.md](config-reference.md#refresh-planning). Changed paths or revisions that git cannot resolve, or a diff past the port's bound, plan a full map with the reason `changed-paths-unavailable`. The plan and the facts behind it are the `refresh` block of the mapping plan, which keeps at most 200 changed paths; an incremental refresh whose list was cut is not used for the indexes.

The map an active record holds in AVARICE's artifact store is not restored into the new staging copy, which is cloned from the user's repository. A refresh of a project whose map the owner never promoted therefore has no stamp to measure from and plans a full map.

The map stage runs one contained host invocation in staging: the full or fast map command. `skip` runs no invocation and moves straight to validation. The existing-map answer is always appended to the prompt. Every map prompt, whatever the mode and restricted included, also ends with a secrets rule. The map documents are scanned for credentials and a document that holds one is rejected. The mapper is therefore told never to write a value of any kind the scan reports, whether it is a real secret, a placeholder, a development default or an example. The kinds are read from the scan's own pattern list. The rule names the connection string with a user name and password before the host as the common case. It tells the mapper to describe the setting instead (its name, where its value comes from and where a local default lives), and to pass the rule to the mapper subagent. The rule carries no example URL, so a copy of it cannot trip the scan. The scan itself is unchanged. Staging holds an empty map directory even for a repository with no map, because AVARICE creates it before launch. GSD reads an existing directory as an existing map and asks, and a headless session cannot answer.

The invocation's outcome is classified from measured facts, not from what the model wrote, in this order:

1. The staging HEAD moved: failed, with a containment finding.
2. No final result, or the wall clock ran out: inconclusive.
3. A budget signal from the host, or a hook deny for a spent budget: budget exhausted. A hook deny for the subagent concurrency limit does not count here.
4. An error flag that is not exactly false, a signal or a non-zero exit: failed.
5. The expected files are present: progressed.
6. Any permission or hook deny: denied.
7. Otherwise: no progress.

The next state follows: progressed or inconclusive go to `validating`; budget exhausted, denied, failed and no progress go to `blocked` (`budget_exhausted` for the first, `decision` for the rest). A host that refuses to start for lack of a containment layer blocks with `enforcement_failure`. A hook-recorded deny for a spent budget during the invocation overrides the host's own outcome.

AVARICE stamps the map itself after the invocation, for fast, full and paths, through GSD's stamp command, because the mapper's own stamp call is a write the hook denies. The stamp runs after progressed, no-progress and inconclusive endings. A failed stamp is recorded and not raised; the unstamped files then fail validation. Inconclusive endings are not treated as failures: the staging map is validated and accepted if complete.

### Restricted map

`onboard --restricted` runs one fast map through the restricted host instead of the contained one, for a host that cannot be contained (see [containment.md](containment.md#restricted-mode)). The mode is fast whatever an existing map or a refresh would choose, so the map never claims more than four files, and the record says `partial (restricted)`. Only the code graph is built; the intel and knowledge steps are recorded absent with the reason `restricted`. That host has no shell and confines its file tools to the working directory, whatever the hook admits, and AVARICE grants it no other directory. GSD's workflow specs sit outside the staging copy, so before the map stage reserves its invocation it copies the specs the fast map reads into the staging copy. A contained onboarding stages nothing. A restricted onboarding whose host cannot start the restricted line blocks with `enforcement_failure` before any invocation and does not fall back to the contained host.

- **What is copied.** Three seed files are copied: the map workflow, the fast scan workflow and the reference the mapper agent loads. So is every Markdown file under GSD's workflows, references or templates directories that they name, followed transitively. The source is the gsd-core directory that GSD's inspect recorded, the same directory the hook policy holds as a read root. A closure of more than 32 files or 512 KiB is refused whole, and so is a missing seed; nothing is written in either case.
- **Where.** Under `.claude/gsd-core/` in the staging copy, the place the map skill reads before its global install. Every file is mode 0444, and a marker file names the directory as AVARICE's.
- **When it refuses.** A `.claude/gsd-core` that the repository itself holds is never replaced, and a symbolic link at `.claude` is never written through. The onboarding blocks with reason `decision` and no host starts.
- **The prompt.** It names the staged paths relative to the working directory, with no home-directory or absolute form. It tells the model to read a spec there wherever a spec names a home-directory path. It also says the staged files are not part of the project and are not to be mapped or cited.
- **Removal.** The staged files are removed as soon as the host returns, before the outcome moves the onboarding on, and again if the map stage ends any other way. Validation, the activation scope check, the record and its digests, and promotion therefore never see them; promotion reads the accepted map from the artifact store. A removal that fails is recorded as a containment finding (`staged-specs-not-removed`), and the scope checks then report the leftover files as writes outside the write sets.

The restricted line itself is unchanged: it carries no directory grant, and the hook policy's read roots are the same as for a contained map.

## Enforcement check

After GSD is configured and before mapping, the workspace stage reads the host's declared enforcement. Anything other than "enforced" blocks with `enforcement_failure`, and the message says to rerun with `--restricted`; this is where an unavailable host stops an onboarding. For a restricted onboarding the stage reads the restricted host's own descriptor instead, which needs only a `claude` that lists the restricted flags. No host invocation has happened when this block comes from the workspace stage. The same stage checks that the admitted GSD declares what the chosen mapping mode needs, and an onboarding that needs a capability GSD lacks is blocked with `scope_unavailable`.

## Validation and the retry rule

Validation reads the map documents, the staging diff against the pin and the tracked paths at the pin, and runs seven checks in order. The map is accepted only if all pass.

1. Presence: every file the mode requires exists.
2. Stamp: every required file's stamp equals the staging HEAD.
3. Scope of writes: the staging diff lies inside the union of the write sets of the invocation purposes that actually ran, plus AVARICE's own. A tracked file may be modified or deleted only inside an agent write set or in the GSD config file; re-creating a deleted tracked file elsewhere is also a violation.
4. Path references: paths named in the documents must exist at the pin. Extraction is deliberately narrow and skips fenced code and clauses that say the thing is absent. Dangling paths may be at most 5 percent of those named. References the repository's own committed ignore rules cover, import specifiers, unique path suffixes, committed package dependency names and committed workflow action names count as known. A token counts as a path at all only when it plausibly names one. A slash path with no known file extension counts only in three cases. Its first segment is a top-level entry of the tree, or the document wrote it as a directory (trailing slash), or the document wrote it in the `./` form. A path that starts with a host name is a URL. A bare file name that is the last segment of an ignored reference, or of a token that is no path, takes that reference's standing. Model ids (`org/model`), language constructs (`try/finally`) and time zones (`Region/City`) therefore count neither as named nor as dangling; the check detail lists how many tokens it did not count. A path with a known extension always counts.
5. Secrets: pattern scan. Names, line numbers and pattern kinds are recorded, never text.
6. Size and structure: at most 262144 bytes, non-empty, a Markdown heading, and for the stack and architecture documents the section headings of GSD's templates.
7. Coverage: always passes; it sets the completeness label and scope.

Outcomes:

- Accepted: move to `planning_ready`.
- A secret hit: block at once with `decision`, no retry, and no document bytes are stored.
- Any other failure: move to `validation_failed`, where one rejection is counted per row version (so a crash and rerun does not count twice). With retry 1, the first rejection sends the onboarding back to `mapping` for one more round; the second blocks with `decision`. Each round is one launch followed by one validation.
- A write outside the write sets is also recorded as a containment finding.

Extra files the mapper leaves in the map directory are neither validated nor stored nor listed in the snapshot. The record names each one as a finding by path.

## Index stage

In `planning_ready` the index steps run in a fixed order: code-graph, intel, knowledge. Their detail is in [indexes-and-context.md](indexes-and-context.md). For each step the checkpoint is committed first, the step runs, and its result is stored as a step row. A resumed onboarding skips steps with a completed row and reruns the one that was cut short. A step that fails, throws or finds nothing is stored as absent with a reason and a warning event; an index never blocks activation. A step may also report disabled when the contract turned it off or, for the knowledge step, the profile did (`adapters.knowledgePass`), and the record then says nothing about it. When the onboarding is a refresh with an incremental plan, the code-graph and knowledge steps work from the changed paths and the changed documents instead of building new. The knowledge corpus holds the documents of the map, the planning documents, the decision records, the contract's documents and GSD's phase files and state file. The cost cap decides how many of them one invocation can pay for ([indexes-and-context.md](indexes-and-context.md#the-cost-cap)). A restricted onboarding builds the code graph only. The last checkpoint names activation.

## Activation

Activation re-checks the whole staging diff against the write sets before building a record. This check is separate from validation and runs after the index steps, so a write by an index step or a late invocation cannot reach an active record. It uses the write sets of every invocation that ran, plus AVARICE's own, and additionally allows tracked changes under the graph output directory, since the index steps regenerate those. Any violation is a containment finding and blocks with `enforcement_failure`.

If the check passes, activation:

1. Reads the accepted map documents from staging and stores each in the artifact store, then a snapshot manifest listing path, digest, size and stamp of each. A document without a stamp here is an internal error.
2. Reads an optional repository proposal file from staging at the pin (size capped at 64 KiB), treats it as data, and narrows it against the profile policy. Rejected parts, unparseable input and oversize input become findings.
3. Builds the record and inserts it as the next version while moving to `active`, in one ledger transaction.

Project record contents: schema and record version; repository identity (root commit, remote, default branch); the onboarded revision and an active revision that starts equal to it; profile; routine policy preset; promotion `none`; GSD version, runtime, adapter and capabilities and the config AVARICE applied; the contract's run ID, version and digest; the existing-state block (with the final outcome and drift result from the mapping plan), instruction files and not-mapped names from preflight; `restricted: true` when the map was made under the restricted launch; findings (rejected earlier validation attempts, extra map files, narrowing refusals; capped at 50); artifacts (staging location and path, per-file path, digest and stamp, and the snapshot digest); mapping (mode, scope, completeness label, mapped-at time, freshness fresh, and `provenance: adopted` for an adopted map); folded index results (graph, intel, and an absent list); path grants, execution grants and commands. The record holds paths, digests and revisions, never document text.

Authority defaults grant nothing: no write paths, no endpoints, no credentials, read-only tool class, local-sandbox environment. Repository proposals can only narrow: the protected path list only grows, and accepted commands arrive as proposals with a status.

The completeness label is the mode's label (complete for full, partial for fast and paths, none for skip) and, for an adopted map, complete only when all seven files are present. The record states the label and scope that validation judged. The status of a restricted record reads `partial (restricted)`.

The record version is the previous version plus one. A refresh activates the next version and marks the previous one superseded in the same transaction, so a project's record version grows with each completed refresh.

## Promotion

`onboard --promote copy` or `commit` puts the accepted map into the user's repository after activation. It runs by AVARICE itself, outside any contained invocation, in the stage after activation under the same lease, and it is the only code that writes to the user's checkout during an onboarding. `none` does nothing. The onboarding is already active when promotion runs, so nothing here moves its state, and a promotion that did not happen is a note and a recorded outcome, not a failure.

Promotion is a privileged action, `onboarding.promote.copy` or `onboarding.promote.commit`. It starts only after the approval gate lets it, with the onboarding contract as the source: the contract names exactly this action and the onboarding, so it needs no approval from the owner. A policy rule that denies the action refuses it, and the output names the rule (see [policy-and-approvals.md](policy-and-approvals.md#how-an-action-reaches-an-approval)). The start is recorded before anything is written, so a kill leaves a start with no end.

- **Copy.** Each accepted file is written under `.planning/` of the checkout only where the target is absent. A target with the same bytes is counted as present. A target that differs, a symbolic link, a directory or a path whose parent is not a directory is left untouched and reported as a conflict. A file is written beside its target and linked into place, and a link refuses an existing name, so a file that appears between the check and the write is a conflict too. Nothing is replaced or deleted. One permission decision on the onboarding lists the files left untouched.
- **Commit.** One commit is built in the staging clone from the pin and the accepted files, then fetched into the user's repository by a create-only fetch to the branch `avarice/onboard-<onboarding id>`. The commit message is `docs(planning): adopt GSD codebase map from AVARICE onboarding <id>` and its identity is `AVARICE <avarice@localhost>`, whatever the machine's own identity and signing configuration say. HEAD, the index, the working tree and every other ref stay as they were. A branch of that name that already exists is a failure, reported in the output.
- **Source of the files.** The accepted files are read back from the artifact store by the digests the active record names, the bytes that were validated, and not from the staging tree. A promoted path is a path under `.planning/` of plain segments.
- **Resume.** A promotion whose start was recorded and whose end was not is never run again. Resume opens one permission decision on the onboarding that names it and writes nothing. The decisions of an onboarding hang off its contract's carrier run, never appear in `avarice inbox`, and offer only `withdraw`; nothing can answer them into an approval.
- **Kill points.** The test seam names two points between a privileged action's recorded start and its end: right after the start and after the write took effect but before its outcome was recorded.

The outcome is the step `promote` of the onboarding. The command line is in [cli-reference.md](cli-reference.md#promotion).

## Checkpoints and kill points

Every checkpoint and transition runs through helpers that also fire fault points, so no stage carries fault code. Setting an environment variable to a point name makes the process kill itself with SIGKILL, with no cleanup, the first time that point is reached; `name#N` fires on the Nth time. Points are `after-transition:<state>` and `after-checkpoint:<action>`. The integration test set kills at 17 points. They are the transitions to discovered, contract_proposed, mapping, validating and planning_ready. They also include the checkpoints at prepare-workspace, configure-gsd, verify-enforcement, validate, each index step and activate, and the second firing of the first index checkpoint (see below). The last are the mid-invocation points for map, intel and knowledge. After each kill, resume reaches the same normalized record as an uninterrupted run, with an intact store and no half-activated record.

One checkpoint fires twice: the first index checkpoint is committed once with the planning_ready transition and once by the index stage before the step; `#2` targets the gap between them.

## Resume, reconcile and reaping

This section describes the resume of an onboarding. The resume of an unattended run is in [runs.md](runs.md).

`resume` on a stop state reports where it ended and takes no lease. Otherwise it takes over the lease (only once expired) and runs a prelude before the stage loop.

The prelude, in order:

1. Reap every interrupted launch. Every launch step left `started` by the previous holder belongs to a host process that is detached in its own process group and may still be writing. The host is found by a process-table search for the session ID recorded at launch. It is ended with a terminate signal, then killed after a grace period; if it survives the kill, resume fails. A host that cannot be searched for or ended stops the resume: no stage and no relaunch runs beside a survivor. All reaps complete before any launch row is marked `interrupted`, so a failed reap leaves every row `started` and the next resume retries. A reap that ended at least one process appends a warning event. A launch row without a session ID is skipped silently, and so is the whole reap when the host has no reap capability (the refusing host used when no contained host is available).
2. Reconcile the map invocation. This applies to an onboarding in `mapping` or `paused`. A `mapping` row is first moved to `paused`. If the previous holder launched an invocation that no validation has yet followed (more launches than validations), the staging map files decide. If every required file is present, the launch row is marked reconciled and a reconciled event is appended. AVARICE stamps the map for fast and full, and the onboarding goes straight to `validating` without a second launch. Otherwise the launch row is marked interrupted and the onboarding returns to `mapping`, where the map stage launches again, charged against the invocation budget.

Every other stage is idempotent and simply runs again from the committed state. In particular the workspace stage repeats its whole probe, plan and configure block after a kill.

## Quirks to know about

- `repo add` stores mode `full` and no budget overrides. A later `onboard --mode fast` or `--budget ...` continues that same onboarding and its stored request wins, so the flags are ignored. Likewise the pin is HEAD at the first registration: commits made between `repo add` and `onboard` are not mapped.
- A user-edited or unknown-format map is regenerated in staging and the user's files are never touched, while a stamped-complete one can be adopted or refreshed; the final outcome waits for GSD's drift check in staging.
- A refused contract compile blocks with reason `decision`. A raised or unknown `--budget` is the normal way to reach it, because the CLI checks only the shape of budget values. An unknown promotion value is refused earlier, by preflight.
- The mapping modes `paths` and `adopt` are chosen by a refresh or an existing map, and by a stored request that bypasses the CLI. A request for `adopt` on a map that is not adoptable is refused as unsupported with the reduced mode `full`, and `paths` with a contract read scope that is the whole repository is invalid.
- A refresh of a project whose map was never promoted has no stamp, so it maps in full: the artifact store's copy of the map is not put back into staging.
- A restricted record cannot start a contained run. `start` refuses it until a contained onboarding on an enforced host replaces it.
- A README-only repository takes mode `skip` regardless of the requested mode, and ends active with an empty codebase list and completeness none.
- An inconclusive map ending is not a failure; a denied one is never retried.
- A resume costs budget. The interrupted invocation's reservation is charged as spent at the next reservation attempt (the relaunch, or the intel invocation when reconciliation accepts the files). The charge covers invocations and cost but not wall clock, and a relaunch is a new invocation. The prelude itself charges nothing.
- The staging path is recorded in the active record, and the record's artifacts location is staging: the staged map documents live there as well as in the artifact store.
