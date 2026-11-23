# Runs

A run takes one written brief to one reviewable branch of the source repository, unattended, inside a contract compiled before anything starts. This document describes the run flow implemented by these modules:

- The start service, the supervisor, its stages, resume and the status read model: `src/app/run-start.ts`, `src/app/run-service.ts`, `src/app/run-stages/` (including `src/app/run-stages/restricted.ts`), `src/app/run-resume.ts`, `src/app/run-status.ts`, `src/app/budget.ts`, `src/app/invocation.ts`, `src/app/run-gsd-config.ts`, `src/app/resume-refs.ts`, `src/app/authorize.ts` and `src/app/derive-spec.ts`.
- The supporting domain modules for the brief, conventions, contract, lifecycle, preflight, gates, outcome classification and quick records: `src/domain/`.
- The git adapters for the source repository and the run clone: `src/adapters/git/run-source.ts` and `src/adapters/git/run-workspace.ts`.
- The agents file builder: `src/adapters/gsd/agents-json.ts`.
- The commands, the detached spawn and the host composition of a restricted run: `src/cli/commands/start.ts`, `src/cli/commands/supervise.ts`, `src/cli/commands/resume.ts`, `src/cli/spawn-supervisor.ts` and `src/cli/composition.ts`.
- The scheduling of several work items, the contract amendment and the cancel: `src/domain/work-items.ts`, `src/domain/amendment.ts`, `src/app/amend.ts`, `src/app/cancel.ts`, `src/cli/commands/contract.ts` and `src/cli/commands/cancel.ts`.

A run needs a repository that is already onboarded to an active record. `start` compiles the contract from a brief, the repository's own conventions and a fixed preset. It stores the contract and hands the run to a detached supervisor. The supervisor works in a local clone at the onboarded revision. It prepares the clone, then runs the work items of the brief one at a time, each as one GSD quick unit in a contained agent host, and judges each unit from facts it measured. It commits each item's in-scope change itself, re-verifies the final commit and fetches the run branch into the source repository. A successful run ends in `ready_for_review` on a branch named for the run. Nothing is pushed, nothing is merged, and the user's checkout is never written. Whatever the run cannot finish inside its contract ends as an open decision, never as a partial branch. An item that must ask stops only itself and the items that depend on it, and the run goes on with the rest. The owner answers from a terminal, amends the contract from a terminal, or cancels the run. The sibling documents own what this one leaves out.

- [autonomy-and-decisions.md](autonomy-and-decisions.md): decision records, classes, the response checks, notification and check-ins.
- [onboarding.md](onboarding.md): the lease, the stage loop and the resume prelude as onboarding uses them.
- [containment.md](containment.md): the hook, the sandbox, scopes and git safety.
- [checks-and-evidence.md](checks-and-evidence.md): install, check validation, baseline, required checks, evidence and the gate rules.
- [data-model.md](data-model.md): tables and events.
- [cli-reference.md](cli-reference.md): flags and exit codes.
- [config-reference.md](config-reference.md): preset values, built-in limits and the conventions keys.
- [integrations.md](integrations.md): the run ports.

## Pipeline at a glance

1. `start` checks the request, reads the brief and the conventions from git objects, compiles and stores the contract, and spawns the supervisor. The run is `contract_ready`.
2. The supervisor takes the run lease and works through the stage for the committed state: preparation (`contract_ready`), the units (`running`), final proof and hand-off (`verifying`). In `running` it asks the scheduler which item to continue or start, runs it as a unit, gates it and commits it, and asks again.
3. The run stops in `ready_for_review` (success), `blocked_on_decision` (nothing is ready and a decision is open, or a state of the whole run blocks it), `failed` (no remaining item can be delivered) or `cancelled`. All are stop states: the supervisor releases the lease and exits.
4. `decide` answers a decision and starts a supervisor when the run can continue. `contract amend` writes the next contract version. `cancel` ends a run. `resume` continues a run whose supervisor died, or a blocked run an answer made continuable. `status` and `inbox` read the ledger and change nothing.

The flows end to end are drawn in [processes.md](processes.md).

## Starting a run

`start --brief <file> --policy routine [--project <id>] [--budget name=value]... [--wait] [--restricted]` authorizes one run. Running the command is the authorization; it asks nothing and reads no input. The only policy is `routine`. The flags and exit codes are in [cli-reference.md](cli-reference.md). In short, exit 0 means the run is stored and its supervisor started (with `--wait`, that the run reached `ready_for_review`). Exit 3 means a start rule refused it or, with `--wait`, the run stopped elsewhere. Exit 64 is a usage error and 70 an internal failure.

### Order of checks and the refusals

`start` runs its checks in this order and creates nothing until every one has passed.

1. Policy: anything but `routine` is a usage error.
2. Restricted host: with `--restricted`, a host that cannot start the restricted launch is a refusal (see Restricted runs).
3. GSD: no admitted GSD installation is the refusal `gsd-not-admitted`, or `record-incompatible` for a project that already has an active record. This is judged before the brief is read, so a missing GSD refuses a start whatever the brief holds.
4. Brief: read as a regular file of at most 64 KiB, strict UTF-8, then redacted and parsed and validated. A failure is a usage error naming the field.
5. Project: the registered project whose repository contains the current directory (the deepest one when repositories nest), or the one `--project` names. None is `no-project`. A project without an active record is `no-active-record`.
6. Record: an active record built under a GSD the installed one cannot be used with is `record-incompatible`. A record made by a restricted onboarding, for a run that is not restricted, is `restricted-record`.
7. Profile limits: a `retrieval` or `limits` section that cannot be read is a usage error naming the key, and a profile with `limits.maxActiveRuns` runs that have not ended is the refusal `active-runs`.
8. Preflight, judged from git objects only: an uncommitted edit, a dirty checkout or a half-written file cannot change an answer. The pin is the active record's onboarded revision.
9. Contract compile (below). Any failure, including a failed static gate G0 and an invalid `--budget`, is a usage error.

The refusals, all exit 3:

| Code | When |
|---|---|
| `gsd-not-admitted` | No admitted GSD installation was found, and the project has no active record. |
| `record-incompatible` | The project's active record was built under a GSD that the installed one cannot be used with: none is installed, the installed one is outside the admitted range, or it is another minor than the record's. The check is derived and writes nothing; `doctor` reports the same rule. |
| `restricted-record` | The active record was made by a restricted onboarding (`partial (restricted)`) and the run is not restricted. |
| `active-runs` | The profile has `limits.maxActiveRuns` runs that have not ended; the message names up to ten of them. |
| `no-project` | The directory is in no registered repository, or `--project` names an unknown project. |
| `no-active-record` | The project has no active record. |
| `conventions-invalid` | `.avarice/config.json` was found but does not parse or validate. |
| `revision-mismatch` | The brief names a base revision that is not a prefix of the onboarded revision. |
| `not-descendant` | The source HEAD does not descend from the onboarded revision, or that revision is gone from the repository. |
| `stale-commits` | More than 25 commits past the onboarded revision touch paths outside `.avarice/` and `.planning/`. |
| `stale-age` | The oldest such commit is more than 14 days old, by its committer time. |
| `no-conventions` | `.avarice/config.json` exists neither at the onboarded revision nor at a later commit that changes only `.avarice/`. |
| `no-planning` | The onboarded revision has no `.planning/ROADMAP.md`. |

The first rules above are judged as described; the last six are the preflight rules, judged in the order `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning`. When the history does not descend from the onboarded revision, the conventions and the roadmap are never read. The limits are fixed and are not lowered per profile. The run works on the onboarded revision, not on the current HEAD, so code that moved within the limits is simply not in the run's tree.

### Records written by a successful start

One transaction stores the run (state `contract_ready`, branch `avarice/<runId>`, base revision the onboarded one) and contract version 1 with its digest. The same transaction stores the budget rows and one work item row for each item of the brief (the single item `A` for a brief without items). A secret pasted into the brief is replaced by its redaction marker before any of that is stored. The run keeps a reference to the brief file, its real path and the digest of its bytes, which a resume refreshes (see Reference refresh on resume). A killed start therefore leaves either nothing or the whole run. The compiled contract is then written to `contract-v1.json` under the run's directory in the data root (default `~/.local/share/avarice/<profile>/runs/<runId>/`), through a temporary file and a rename, mode 0600 in a 0700 directory. A reader therefore sees the whole file or none. A start killed between the transaction and the file write leaves a run without its file. The supervisor rewrites the file from the ledger before it launches anything. Last, a `start:preflight` step records the pin, the HEAD, the conventions revision, the commit count past the pin and the brief digest, and `start` prints a one-screen summary. The summary has an `index:` line that says whether the onboarded indexes were used to derive the items' files and symbols, and why not when they were not. It then has one `item` line for each item. The line gives the item's size, its model, the items it depends on and the files and symbols its spec names, marked `(derived)` when AVARICE derived them. An absent, stale or unreadable index never blocks a start.

### The detached supervisor

Before it spawns anything, `start` records the host configuration directory it runs under as a `host:config-dir` step. That is `CLAUDE_CONFIG_DIR` when set and not empty, otherwise `.claude` in the home directory, made absolute and resolved to its real path when it exists. The host keeps its sessions, its skills and the GSD installation there and looks for a paused session nowhere else. Every supervisor of the run is therefore started with the recorded directory as its `CLAUDE_CONFIG_DIR`, whatever environment the command that starts it runs in. That covers the first supervisor, the one `decide` starts after an answer and the one `resume` starts. A step that cannot be recorded is exit 70 and nothing is spawned. A run started before the step existed has none, and keeps the environment of the command that starts its supervisor.

After the summary, `start` spawns `avarice supervise <runId>` as a detached process: its own process group, standard streams ignored, working directory the data root, unreferenced, so closing the shell leaves it running. It receives the three profile roots the command resolved, the selected profile as `AVARICE_PROFILE` and the recorded host configuration directory. The spawn is refused when the CLI entry script is not an absolute path that exists (exit 70; the run stays stored and `contract_ready`). The supervisor's PID is recorded as a `supervisor:spawn` step. Without `--wait`, `start` then exits 0. With `--wait` it polls the ledger every 250 ms for at most the contract's wall clock plus 15 minutes and exits 0 at `ready_for_review`. It exits 3 at any other stop state. It also exits 3 with an "interrupted" line and the `resume` command when the supervisor is gone and no lease is live. On timeout it exits 3 with a "still running" line, and the supervisor keeps working. The supervisor's output goes nowhere; everything it did is in the ledger.

`supervise <runId>` can also be run by hand to continue a run. It always runs the resume prelude first (below), takes the lease, runs the stages and exits 0 at `ready_for_review`. It exits 3 at any other stop state, at a state with no stage, or when another supervisor still holds the lease. It exits 64 for a usage error or an unknown run and 70 for an internal failure. A run that recorded a host configuration directory is supervised only under it: when the directory this process would run the host under differs, `supervise` exits 70 before it takes the lease or writes anything. The commands that start a supervisor never produce that difference; it arises when `supervise` is run by hand from another environment.

## The brief

The brief is a Markdown file. It is data: it is parsed and validated, never read as an instruction to AVARICE, and its digest goes into the contract. Anything below that does not hold is refused with the failing field named.

Optional frontmatter sits between a first line `---` and the next `---` line. Each line is `key: value` with a scalar value (surrounding quotes are stripped). There is no nesting and there are no lists, except the one key `items`, whose value is a JSON array that may continue on lines indented by two spaces. An unknown or repeated key is refused, and so is a frontmatter that is not closed.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `title` | 1 to 200 characters, no control characters | the first `# ` heading before the first section, else `untitled` | The run title and the work item task. The commit subject comes from it. |
| `size` | `small`, `medium`, `large` | `medium` | Picks the model when `model` is absent. |
| `model` | `haiku`, `sonnet`, `opus` | by size: `small` haiku, `medium` sonnet, `large` opus | The model the unit runs on. |
| `baseRevision` | 7 to 40 hexadecimal digits | none | Must be a prefix of the onboarded revision (refusal `revision-mismatch` otherwise). |
| `expectedDecisions` | integer 0 to 1000 | none | Stored in the contract; no stage reads it. |
| `broadDiscovery` | `true` or `false` | `false` | `true` authorizes one whole-repository search in the run (see [containment.md](containment.md#retrieval-budgets)). Any other value is a usage error. |
| `items` | a JSON array of at most 20 work items | none: the brief is one item | The work items of the run, with their dependencies (below). A top-level `size` or `model` beside `items` is refused, because each item has its own. |

An item is an object with the keys `id`, `title`, `dependsOn`, `size`, `model`, `acceptance` and `spec`, and any other key is refused. The `id` matches `^[A-Z][A-Za-z0-9_-]{0,31}$` and is unique. The `title` is 1 to 200 characters. `dependsOn` is required and lists IDs of other items; an item cannot depend on itself, an unknown item or a cycle. `size` and `model` mean what they do at the top level. `acceptance` lists criterion IDs, and every criterion of the body belongs to exactly one item. `spec` may name `files`, `symbols`, `configKeys` and `references`; any field left out is derived at start (see the contract). A refusal names the failing field as `brief.items`, `brief.items[n].<field>` or `brief.items[n].spec.<key>`.

The body has five sections, each opened by a `## ` line (heading text is case-insensitive). A `## ` line inside a code fence does not open a section. An unknown heading is refused, and so is a section that appears twice.

| Section | Required | Content | Constraint |
|---|---|---|---|
| `## Behavior` | yes | Free text saying what should change. | Non-empty. |
| `## Acceptance criteria` | yes, at compile | Bullets, `- AC1: text \| verifiedBy: check:unit, test:name`. | At most 20. IDs match `AC<digits>` and are unique. Each reference is `check:<name>`, `test:<text>`, `diff:<rule>` or `decision:<key>`. A `decision:<key>` marks a choice that belongs to the owner. It never satisfies a criterion alone, so static gate G0 fails a criterion whose only references are of that kind. |
| `## Exclusions` | no | Bullets of things the unit must not do. | Bullets only. |
| `## Write` | no | Bullets of repository-relative globs the run may write. | Narrows the conventions' write set (see the contract). |
| `## Target checks` | no | Bullets of check names. | Each matches the check-name pattern: a lowercase letter, then lowercase letters, digits, `:`, `_` or `-`, 64 characters at most. |

The list sections take bullets (`-` or `*`) only; any other non-blank line in them is refused, so prose cannot hide in a list. An item wrapped in backticks has them stripped. A section holds at most 128 items. A brief with no acceptance criteria is accepted by the parser and refused at compile.

Whole-file limits: 64 KiB, 4096 characters per line, no control character other than tab and newline, no U+FFFD after decoding. A leading byte order mark and CRLF line ends are normalized.

## Repository conventions

The conventions file is `.avarice/config.json`, schema 1, read from git objects and never from the working tree. It is read from the onboarded revision or from a later commit on the source's first-parent history that changes only paths under `.avarice/`. The newest such commit wins, the onboarded revision is the last candidate, and at most 500 commits are walked. A later commit that also changes anything else never qualifies, so the conventions never come from a tree whose code differs from the onboarded revision. The file is at most 256 KiB and must be a regular file.

The file is data from whoever controls the repository, so every level refuses unknown keys: a field no stage reads cannot carry authority. For the run the keys mean:

- `checks`: the commands the run may use as evidence. Each has a name, an argument vector (never a shell string), a timeout, a required flag (default true) and non-secret environment variables. Reserved names such as `PATH`, `HOME` and `NODE_OPTIONS` and the `DYLD_`, `LD_` and `npm_config_` prefixes are refused. A check's `writes` globs become run artifacts. Required checks are what the final proof must pass. Only the checks a run executes, the required checks and the brief's target checks, are given to the agent as commands. A declared check that is neither is reported as not run and is never given to the agent.
- `paths.write`: the globs the run may write. It must not be empty after the brief narrows it. `paths.protected` adds to the preset's protected list; `paths.artifacts` adds paths that may change during the run but never reach the branch.
- `testInventory`: how the run lists the repository's tests, so a unit that weakens the test set is caught.
- `dependencies`: the install command, the lockfile path and the registry hosts the install may reach.
- `agentCommands`: the shell commands the agent may run, exactly as written. A command with chaining, substitution, escapes or redirection is refused. So is one that starts with `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` or `sudo`, matched by its last path segment without regard to case. A command may begin with `NAME=value` words, held to the rules for a check's environment: a name that is not reserved, a plain value that does not look like a secret. The program word after them is the word the never-granted list is judged on, so a leading assignment cannot hide a refused command.

The key list, limits and defaults are in [config-reference.md](config-reference.md).

## The contract

The compiler is the one place a run's authority is fixed, and it only narrows. A brief or a conventions file never raises a budget, widens the write set past the conventions, writes a protected path or grants the agent a git, AVARICE or network command. Compilation is refused, as a usage error, when:

- a conventions write glob, artifact glob or check `writes` glob lies inside a protected path;
- a brief `## Write` glob is protected or not inside the conventions' write set (a prefix alone is not containment: `lib-evil/**` is not inside `lib/**`);
- the write set is empty;
- a command (an agent command or a check argument vector) starts with a never-granted word, judged on the first word after any leading `NAME=value` assignments;
- a check's environment value is not a plain word or looks like a secret;
- the brief has no acceptance criteria;
- an override is unknown, not above zero, not an integer where one is needed, or above the preset;
- the static gate G0 fails.

Static gate G0 judges what the contract alone can show. There must be at least one acceptance criterion, and every criterion has a `verifiedBy`. Every `check:` reference names a declared check, and every `test:` reference has a declared test inventory. Every target check is declared, and at least one required check is declared. The other half of G0, whether the host enforces containment, is judged by the supervisor before the first invocation.

### Contract file format

A contract file is canonical JSON with schema 1, written as `contract-v<n>.json` for contract version n. Start writes version 1, and each amendment writes the next version beside it. The contract version is a number, and every version is stored in the ledger. The latest one is the contract in force. Its top-level sections:

| Section | Holds | Source |
|---|---|---|
| `runId`, `policyPreset`, `policyRevision`, `compiledAt` | Identity, `routine`, a digest of the preset values, the compile time. | Preset and clock. |
| `intent` | Title, behavior, acceptance criteria, exclusions, one requirement reference naming the brief and its digest, the work item list (the brief's items, or the one item `A`; each with its title, size, model, whether the model came from the brief or from the size, the items it depends on, the criteria it owns and a spec of files, symbols, configuration keys and references, with the fields AVARICE derived named), and `expectedDecisions` when given. | Brief, indexes. |
| `workspace` | Project ID, base revision, conventions revision, branch `avarice/<runId>`. | Start. |
| `files` | Read (everything), read-exclude, secret globs, write, create (equal to write), delete (none), protected (preset plus conventions), artifacts (preset, conventions and every check's writes). | Preset, conventions, brief. |
| `execution` | Agent commands (the conventions' own, plus the command of each check the run executes, a required check or a target check of the brief, written as the check's environment in `NAME=value` words sorted by name, without the names the check sandbox sets itself, then its argument vector), checks (every declared check), tool classes, endpoints (none), the install registry hosts, dependencies, environment `local-sandbox`, model by size. | Preset, conventions. |
| `decisions` | Delegated, human and prohibited decision lists; no defaults. | Preset. |
| `budgets` | See below. | Preset, overrides. |
| `verification` | Required checks, target checks, test inventory, the GSD verifier setting, the baseline mode, the per-item mode and the integrity gate names. | Preset, conventions, brief. |
| `delivery` | Endpoint `ready_for_review`, handoff `local-branch`, no push, no draft change request. | Preset. |
| `escalation` | The loop limits and the no-progress limit. | Preset. |
| `notify` | Local notification for review-ready and blocking events. | Preset. |

An item's spec fields that the brief did not give are derived at start from the item's own text. The candidates are the backtick spans and the path-like words of the item's title and acceptance text. The files are the candidates that an onboarded index knows and the run may write, or the whole write set when none qualifies. An index answer counts only when it is fresh, or stale with the cited path confirmed at the repository's HEAD, and a code node whose file is under `.planning/` gives nothing. The symbols are the backtick identifiers the index lists for those files. Only a code node of the graph is read as a code fact, and it gives its file and, when its label is an identifier, its symbol. This holds for a code node whose excerpt is marked untrusted too (because it shows a description or a non-code neighbour). A document or concept node gives nothing, whatever path it cites, and neither does any intel entry, because every intel entry is marked untrusted. The references are `.md` candidates inside the write set or under `docs/`. The configuration keys are dotted lower-case backtick spans that are not file names. Every list is sorted and de-duplicated, so the same brief and the same index answers give the same contract digest. A derived file is kept only inside the write set, so an index can narrow an item's files and never widen them. A field the brief gave is kept as written. The preset values are in [config-reference.md](config-reference.md). Two consequences matter here. The unit may write only the brief's `## Write` globs (or the conventions' write set when the brief has none), and a file it creates must match the same globs. And no contract, whatever the brief says, lets a run delete a file. The delete list is empty, so a deletion is a scope failure at the first gate. So is a rename, which arrives as a deletion plus an addition.

### Budgets and overrides

The preset's limits grow with the number of work items. For n items the limits are a wall clock of 120 minutes, `2n + 1` invocations, `400n` tool calls and `10n` subagents in total. They also include 2 subagents at a time and a cost of 2.00 USD per invocation and 10.00 USD per run. The invocation count covers each item's unit, one retry or repair for each item, and one relaunch after an interruption. The subagent total covers a planner, up to two plan-checker passes, an executor and a verifier for a unit and for its retry, for each item. The formula texts are stored in the contract. The preset also allows one repair for each newly failing required check.

`--budget name=value` at start may lower a budget below the preset's limit for the run's item count, never raise it above that limit. A value above it is refused, naming the limit the preset allows for that many items. The seven overridable names are `wallClockMinutes`, `invocations`, `toolCalls`, `subagentsTotal`, `subagentsConcurrent`, `costUsdPerInvocation` and `costUsdPerRun`; the first five are integers. Three retrieval names may be lowered in the same way: `retrieval.searches` (up to the run's tool-call limit), `retrieval.fullReads` and `retrieval.fullReadBytes` (up to the profile's caps). A per-invocation cost above the per-run cost is lowered to it, and a concurrent subagent cap above the total is lowered to it; each such move is recorded in the contract as an adjustment. A limit rises only through a contract amendment (see Amendments and contract versions), never through a brief, a conventions file or the run itself.

Five budget rows are stored with the run: invocations, tool calls, total subagents, wall clock in milliseconds and cost (the limit is the per-run cost, marked estimated). The concurrent subagent cap is carried in the invocation scope for the hook, not as a row. The contract also carries retrieval budgets (`budgets.retrieval`): the searches, whole-file reads and bytes the run may use, and whether one broad discovery is authorized. They are four more rows, `retrieval.searches`, `retrieval.fullReads`, `retrieval.fullReadBytes` and `retrieval.broadDiscovery`, spent by the hook and by the context assembler (see [containment.md](containment.md#retrieval-budgets)). `status` lists only the five. A reservation is made before the host starts and settled after; a reservation whose holder died is spent by the next reservation, or by `resume`, at the cost it was allowed, and nothing is refunded. The budgets are the run's, shared by every item and every attempt. An amendment changes a row's limit and nothing else, so what was spent stays spent. The mechanics are in [containment.md](containment.md).

## Lifecycle

A run has 11 states and 37 allowed transitions. The ledger refuses a transition outside the table in the same transaction that would commit it.

| From | Allowed next states |
|---|---|
| contract_ready | running, cancelled, paused, blocked_on_decision |
| running | running, waiting_external, blocked_on_decision, verifying, failed, paused, cancelled |
| waiting_external | running, cancelled, paused, blocked_on_decision |
| verifying | running, ready_for_review, blocked_on_decision, paused, cancelled |
| ready_for_review | awaiting_review, paused, closed, cancelled, blocked_on_decision |
| awaiting_review | running, closed, paused, blocked_on_decision, cancelled |
| blocked_on_decision | running, cancelled, paused |
| paused | running, cancelled, blocked_on_decision, verifying |
| failed, cancelled, closed | none |

Every move to `blocked_on_decision` carries one of seven reasons, and a reason is accepted on no other move: `decision`, `enforcement_failure`, `budget_exhausted`, `unauthenticated`, `ref_changed`, `ref_deleted`, `access_revoked`. The stages record six of them: `decision`, `enforcement_failure`, `budget_exhausted`, `ref_changed`, `ref_deleted` and `access_revoked`.

Stop states, where the supervisor ends without being asked to continue, are `ready_for_review`, `blocked_on_decision`, `failed`, `cancelled` and `closed`. The states `resume` continues from are `contract_ready`, `running`, `verifying` and `paused`, and `blocked_on_decision` when an answer made the run continuable.

Which states the code reaches:

- Entered by `start` or a stage: `contract_ready`, `running`, `verifying`, `ready_for_review`, `blocked_on_decision`, and `failed` when no remaining item can be delivered (see Several items). The move `running` to `running` follows each item's commit or block while another item can go on. The move `blocked_on_decision` to `running` is the supervisor's pickup after an answer.
- `cancelled` is entered only by `cancel`, from any state that has not ended.
- `paused` is entered only by the resume reconcile, which puts the run back when it finishes. A reconcile that is killed leaves the run `paused`.
- Never entered by any stage, command or adapter: `waiting_external`, `awaiting_review`, `closed`. Their edges exist in the table only.
- The reason `unauthenticated` is never recorded. `ref_changed`, `ref_deleted` and `access_revoked` are recorded by the resume when a reference the run was built from changed, was deleted or can no longer be read (see Reference refresh on resume).

A step of a run (a named piece of work, such as the workspace preparation or one launch) has one of six statuses: `started`, `completed`, `failed`, `interrupted`, `reconciled`, `skipped`. A step is recorded per name and attempt, and a later write for the same name and attempt replaces the earlier one. A run writes `interrupted` (the resume reap) and `skipped` (a dependency install with nothing to install) besides the usual three; `reconciled` is accepted by the ledger and never written for a run.

A work item has six states: `ready`, `delegated`, `implemented`, `gated`, `done`, `blocked_on_decision`. It moves `ready` to `delegated` to `implemented` to `gated` to `done`. A delegated item goes back to `ready` when its attempt is discarded. An implemented item whose required check newly failed goes back to `delegated` for one bounded repair. Any state but `done` may move to `blocked_on_decision`, which is how a block ends the item; a committed (`done`) item stays done. A blocked item goes back to `ready` when an answer releases it, and the move records the decision that released it.

Every stage commits a checkpoint naming the action it is about to run before the action's side effect. Every transition commits the new state, a checkpoint and an event in one transaction. `status` shows the latest named action as what was about to happen. The actions, in order, are as follows. For `contract_ready`: `prepare-workspace`, `configure-gsd`, `install-deps`, `validate-checks`, `baseline` and `verify-enforcement`. For `running`: `context-pack`, `unpark`, `launch:run`, `classify`, `park`, `discard-attempt`, `gate:g1`, `gate:g2`, `repair`, `gate:g3` and `commit`. For `verifying`: `verify:checks`, `gate:g4` and `handoff:fetch`. For `paused`: `reconcile`. A checkpoint of `running` also names the item and the attempt it concerns.

A run writes events as it goes. There is a creation event, then one event per transition and one per checkpoint. The invocation events are `invocation.finished`, `invocation.reaped`, `invocation.interrupted` and `invocation.orphan-charged`. The run also writes `verification.interrupted`, `loop.limit`, `handoff.fetched` and `containment.finding`. The decisions, the amendments and the cancel add events of their own: `decision.opened`, `decision.answered`, `decision.stale`, `decision.withdrawn`, `decision.rejected`, `decision.duplicate`, `amendment.requested`, `contract.amended`, `run.cancel_requested` and `item.unpark_conflict`. [checks-and-evidence.md](checks-and-evidence.md) describes the check, evidence, gate and attempt events. The kinds and their payloads are listed in [data-model.md](data-model.md).

## Supervisor and lease

The supervisor holds a lease on the run. It is the run counterpart of the onboarding stage loop and uses the same lease rules, so [onboarding.md](onboarding.md) owns the detail. A lease is taken only when free or past its expiry, and every take bumps a fence. Every checkpoint and transition carries the fence. The holder renews every third of the lifetime from a timer that does not keep the process alive. The default lifetime is 180 seconds, shortened only by the test-only environment variable listed in [config-reference.md](config-reference.md). A failed renewal ends the loop at its next check, and it also aborts the unit in flight. The host's process group is ended within the adapter's grace and the invocation stays charged. The supervisor stops with a conflict error before it judges the unit, so `supervise` exits 3 as it does for a lease another supervisor holds. Nothing is classified, discarded or retried under a lease the supervisor no longer holds; the next holder's resume reconciles the attempt. The lease is released on every exit. A run already in a stop state takes no lease, with two exceptions: a run blocked at an item decision that an answer has made continuable, and a run with a cancel request standing. The renewal timer also reads the run row, so a cancel request aborts the unit in flight within one tick (see Cancel).

The loop reads the committed state, runs the one stage registered for it and repeats until a stop state. A state with no stage ends the loop with a note, not an error. A stage that returns without changing the state or the version is an internal error. A superseded supervisor is refused at its next checkpoint, because every checkpoint presents the fence.

Within a stage, an action whose step is already `completed` or `skipped` is not run again, so a resume repeats nothing that finished.

## Stages

### Preparation (`contract_ready`)

Six actions run in order. A failure that is a decision or a containment condition ends the run `blocked_on_decision`; any other failure stops the supervisor with an internal error and leaves the run in `contract_ready`.

1. Prepare the workspace: a local clone of the source repository at `<work root>/<runId>/clone` (default work root `~/.local/share/avarice-work/personal-local`), detached at the onboarded revision and switched to `avarice/<runId>`. It is built in a partial directory and renamed into place, with hardlinks disabled and without the user's repository configuration. A leftover partial directory is removed only if it is demonstrably the adapter's own. This is a clone and not a worktree, so the source repository's git directory receives no metadata from it. It shares its clone mechanics with onboarding staging, but it is its own adapter, and there is no worktree variant for runs.
2. Configure GSD: AVARICE records where the admitted GSD and its agents are, then applies seven settings with GSD's `config-set`, outside any invocation. The settings are text mode on, both interactive gates off, audit on, no worktrees, no GSD commits of its own and no branching strategy. `config-set` leaves an untracked `.planning/config.json` in the clone. It counts as an artifact and is taken out again at commit.
3. Install dependencies: the conventions' install in the clone, with network only to the declared registry hosts. A missing sandbox or proxy is `enforcement_failure`; a host that is not an allowed registry, a missing lockfile or a failing install is a decision. With no dependencies declared the step is recorded `skipped`.
4. Validate checks: every declared check is validated in a separate scratch clone before it can become evidence. A required or targeted check that is not usable blocks the run in the permission class, with reason `enforcement_failure` when any blocking check failed for an enforcement reason and `decision` otherwise. An optional check that fails is left out and recorded.
5. Baseline: every usable required or targeted check runs once at the onboarded revision in the run clone, before the unit touches it, and the test inventory is measured. This opens the run's first attempt, which the unit then adopts, so a run that never retries has exactly one attempt. The gates judge the unit against this baseline, never against an assumed green base.
6. Verify enforcement, the dynamic half of G0: the contract's static conditions are judged again and the host must report enforcement as enforced. Otherwise the run is `blocked_on_decision` before any invocation: with reason `enforcement_failure` when the host is the failure, and with reason `decision` when the static conditions fail again. A pass moves the run to `running` and records the clone path and branch on the run. The G0 verdict is recorded as a gate row; a repeat after a kill that finds the identical verdict for the same contract, policy and revision adds no row.

The install, validation, baseline and gate rules are owned by [checks-and-evidence.md](checks-and-evidence.md).

### Several items

A run has the work items of its brief, and the `running` stage works them one at a time. After every item boundary it reads the ledger again and asks the scheduler what to do. The scheduler is a pure rule over the items and the decisions. It takes items in the order the brief declares them, and its answer is one of five dispositions.

| Disposition | When | What the stage does |
|---|---|---|
| `continue` | An item is already `delegated`, `implemented` or `gated`; the first such item in declaration order. | Carries it on. |
| `start` | No item is in flight and at least one is ready; the first ready item. | Starts it as a new unit. |
| `all-done` | Every item is `done`. | Moves the run to `verifying`. |
| `blocked` | Nothing is ready, an item is not done and a decision is open. | Moves the run to `blocked_on_decision`, reason `decision`, naming the open decisions. Nothing polls. |
| `undeliverable` | Nothing is ready, no decision is open and an item is not done, as after a withdrawn decision. | Moves the run to `failed`, naming the items that were not delivered and the decisions withdrawn. |

An item is ready when its state is `ready`, every item it depends on is `done`, and no open decision lists it or any item it transitively depends on. An answered, stale or withdrawn decision never blocks. So an item that is waiting on a question holds back exactly the items that depend on it, and an independent item goes on. The flow is drawn in [processes.md](processes.md#independent-work-around-an-open-decision).

Each item has its own attempts, its own unit, its own gates and its own commit. An attempt names its item, and ordinals count run-wide. The retry rule counts one item's attempts. Every checkpoint of the unit names the item. A commit's subject is the item's own title and its trailers name the run and the attempt. After an item's commit the run moves `running` to `running` with the next item's context pack as its next action, while another item remains, and to `verifying` after the last. An item that starts is judged against what the required checks said when it began. That is the baseline at the pin for the first item and the G2 result of the item committed last for every later one. A check that failed then and fails again is the item's pre-existing failure and one that passed then and fails now is charged to the item.

**Item-local and run-wide blocks.** A block whose reason is `decision` is about one item. The item is parked, a decision is opened for it and its dependents, and the run goes on with whatever the scheduler says next. Every other reason is a state of the whole run: containment, a spent budget, a refused host, a changed source ref. Those stop the run with its decision, and never produce a branch. An item-local block runs in this order. The park step is recorded as started with what the decision will say. The item's delta is taken out of the tree and kept under a ref. The decision is opened. The attempt ends blocked. One notice is queued for the batched banner. The item moves to `blocked_on_decision`. The run moves on. A supervisor killed between the park and the decision finishes the block on resume from the recorded park step and never runs the unit again.

**Park and unpark.** Parking keeps an item's edits and the records it wrote out of the clone's working tree. The next item therefore runs on the base content, and nothing of the parked item can reach another item's commit. The delta against the item's base snapshot is stored as a commit object under a ref inside the run clone, one ref for each run and item. The working tree is then restored to the base snapshot. The park is refused when the clone's HEAD is not the base HEAD, and an existing ref with a different delta is a conflict. The ref is never fetched into the source repository, and parking never touches the user's checkout. Unparking puts the delta's content, file modes and deletions back on the current HEAD. Unparking is refused, naming the paths, when a parked path changed between the base HEAD and the current HEAD or is modified now. It is also refused for a symlinked parent, and it reports the ref missing when the ref is gone. A second unpark of the same delta changes nothing. Dropping a park deletes only that ref. The ref is dropped when the host is launched on the item's answer and again when the item is committed.

**Release and re-check.** When the run blocks at an item decision, the supervisor releases its lease and then reads the items and decisions again before it returns. It goes on in the same process if an answer made an item ready in that window. A run blocked at an item decision is continuable under three conditions. It was blocked with reason `decision`, the block came from `running` (or from `paused` during a resume), and an item is ready or no decision is open. `decide`, `resume` and the supervisor share that one rule, so a run cannot stay blocked with an answer waiting. [autonomy-and-decisions.md](autonomy-and-decisions.md#pickup-without-polling) states the other half.

At the item boundary the supervisor delivers the notices queued so far as one banner when the batch window has passed. The notices and their banner never change what the run does.

### The unit (`running`)

One unit is one invocation of GSD's quick workflow in validate mode, in the contained agent host, per attempt of an item. The stage runs these actions in order for the item the scheduler named.

**Context pack.** AVARICE asks the profile's context sources with the brief's title. It keeps a pack bounded by the smaller of the profile's `limits.contextTokens` and the room the 32 KiB prompt leaves, at most 8192 tokens (see [config-reference.md](config-reference.md#the-context-pack-budget)). The query counts against the run's retrieval rows and is bounded by the contract's read lists and the run's clone. The step records references, freshness, sizes, both budget numbers and a digest, never text, and every item of the pack becomes a reference the run was built from. A retried item reuses an item of its previous pack when the cache rule allows it. The excerpts the owner recorded with `context add` follow the index items within what is left of the budget. The pack is data: the prompt wraps it as untrusted context.

**Launch.** The item goes `ready` to `delegated`. A snapshot of the clone is taken, so only what the unit changes counts and not the configure step's file. Then the prompt is built as one quoted `/gsd-quick --validate --text` argument. In a run with one item it holds the title, the behavior and every acceptance criterion of the brief. In a run with several items each unit is told about its own item only. Its prompt holds the item's line (the ID and title), the behavior paragraphs labelled for the item plus the unlabelled ones, and the acceptance criteria the item owns. It holds neither the run's title nor another item's labelled paragraph or criteria. Paragraphs are separated by blank lines, and a paragraph is labelled for an item when its first line starts with `Item <id>:` or `Work item <id>:` for the ID of an item of the brief. A behavior that labels no paragraph is given whole to every item, so the prompt never hides text it cannot attribute. Every prompt then holds the exclusions, the paths the unit may edit or create, the records it may write and the commands it may run. A check among the commands is listed as the contract lists it, with the check's environment as leading `NAME=value` words. The unit and its verifier therefore run it with the variables the supervisor gives it. [containment.md](containment.md) says how the hook matches such a command. A declared check the run does not execute is not among the commands. When the item begins with required checks that are not target checks and were already failing, the prompt names them after the commands, under a line that marks the names as data. They are the checks whose status at the item's start was failed: the baseline at the pin for the first item, the G2 result of the item committed last for every later one. The prompt says that the supervisor's gate judges each of them against that start, so one that still fails after the unit's change is recorded as pre-existing and does not block the item. It says such a failure is not a question for the owner and does not by itself make the VERIFICATION `human_needed` or `gaps_found`. The unit notes it in the VERIFICATION body instead. The prompt also says that a failure a check shows in a file the unit changed is the unit's own to fix. It tells the unit to give the list to the verifier. With none failing, the prompt is unchanged, and a resume prompt never repeats the list. When the run has declared checks it does not execute, the prompt names them after that list, under a line that marks the names as data. It says that the supervisor does not run them and no gate judges them. The unit must therefore not make one a condition of its work or of its VERIFICATION. A check the unit cannot run, or that fails, is not a question for the owner and does not by itself make the VERIFICATION `human_needed` or `gaps_found`. The unit gives the list to the verifier. With no such check the prompt is unchanged. After the commands it states the shell rules the hook enforces: one plain command per call, the forms that are refused, and paths written relative to the repository root. It lists the read-only commands the hook admits beside the run's own commands, and names the Read, Grep and Glob tools for reading and searching. The unit's session and each agent it starts have those tools, because the launch line keeps them, and the hook judges each search's path with the read rules. The quick workflow's own shell steps are outside the run's command list: its gsd-tools queries, its `mkdir` steps and its git steps that change the repository. The prompt tells the unit not to run them and not to stop because of them. The unit chooses the task directory under the quick-task path, creates files with the file tools, and starts the planner, plan checker, executor and verifier with the agent tool. The prompt then names the records the run's gates read in that directory: a plan, a SUMMARY and a VERIFICATION file. Skipping the workflow's own steps removes the ones that name those files, so without this line the unit picks its own. The host may refuse a subagent that writes a report file such as a SUMMARY. The unit is therefore told to have the executor and the verifier return their findings as text, and to write the SUMMARY and the VERIFICATION itself from them. The VERIFICATION opens with a fenced frontmatter block of exactly three lines: a `---` line, then a `status:` line of `passed`, `gaps_found` or `human_needed`, then a `---` line. The prompt says that a file that does not begin that way counts as `gaps_found`. A task with no VERIFICATION file fails gate G2 with the verification status read as missing. It also holds an instruction to run the whole workflow and an instruction that the supervisor commits. The prompt is at most 32 KiB. The context pack is cut from its end to fit and says so. The brief text is never cut, and a brief whose own text does not fit blocks with a decision (class `acceptance`) before any launch. The agent definitions the invocation may start (planner, plan checker, executor, verifier) are built from GSD's agent files into a generated agents file. A definition that asks for a permission mode or hooks has them stripped. Each of the four agents also gets a closing note with the same shell rules, because a subagent's refused call counts toward the same invocation's denial limit. The executor alone gets an added sentence telling it not to run `git add` or `git commit`. The verifier alone gets a note that a required check the task lists as already failing when the item began is pre-existing. The verifier reports the check and any failure the check shows in a file the task changed. A pre-existing failure alone does not make the status `human_needed` or `gaps_found`. These notes are advice, and the hook and the moved-HEAD check are the enforcement. A unit that still writes `human_needed` because of a pre-existing failure pauses like any other, because a model-written status is never overridden.

Before the host starts, a budget reservation is made. If the invocations, wall clock or cost budget is spent, the run blocks with `budget_exhausted` and the host is never called. The invocation gets the contract's wall clock or what is left of it, whichever is smaller.

**Classification.** The host's own outcome kind is not read for the verdict. The host often reports `denied` for a unit that did its work, because the model improvises compound shell lines. The verdict comes from facts AVARICE measured. They are whether a result was printed, `is_error`, the exit code, the signal and the timeout. They also include the denials (host and hook), the clone HEAD before and after, and whether a quick SUMMARY exists. The last three are how many in-scope paths changed since the snapshot, a structural pause signal, and a loop-limit stop recorded by the hook. A result with no details, no result event or no boolean `is_error` is never a success. The first rule that applies decides:

| Order | Fact | Kind |
|---|---|---|
| 1 | The clone HEAD moved | `failed`, with the head-moved flag |
| 2 | No result event, or the wall clock hit | `inconclusive` |
| 3 | Budget exhaustion (a cost-limit result, a budget terminal reason or a hook budget deny) | `budget_exhausted` |
| 4 | `is_error` is not false, a signal, or a non-zero exit | `failed` |
| 5 | A pause signal | `paused` |
| 6 | A SUMMARY exists and at least one in-scope path changed | `progressed` |
| 7 | Any host or hook denial | `denied` |
| 8 | Otherwise | `no_progress` |

A pause signal is a waiting file (`WAITING.json`) among the changes, a VERIFICATION status of `human_needed`, or a final text ending in a question followed by numbered choices. The Claude host keeps the last 2000 characters of the final result text, with control characters removed. It returns them to the supervisor as the unit's question and nowhere else: no event, step result or log line carries them. A unit that ends with a question line and numbered choices therefore signals a pause, and the choices become the decision's options. An in-scope path is a changed path that is not an artifact, not protected, and matches the write or create globs.

**A numbered choice that belongs to another item.** In a run with several items, a unit may end its final text with the numbered choice of another item. This happens, for instance, when the brief lists that item's options and the unit asks them. Such a choice is attributed to the other item, and is not the unit's own pause, only when every one of these holds:

- The signal is the numbered-choice shape. A waiting file, a VERIFICATION status of `human_needed` and a STATE that needs a human are never attributed.
- The unit's own work is verified: the VERIFICATION status is `passed`, a quick SUMMARY exists, at least one in-scope path changed, and the unit would be `progressed` without the choice.
- Every choice line equals an option of one other item. The comparison removes the number, backticks and quotation marks (straight or typographic), collapses whitespace, lowercases the text and drops one final full stop. No line equals an option of the unit's own item, of a second item or of a paragraph no item is labelled for.
- The other item owns a choice: one of its criteria names a decision reference, or it has an open decision.

An item's options are the numbered lines of its labelled behavior paragraphs, the numbered lines of its criteria that name a decision reference, and the labels of its open decisions. The unit's own side also counts the options of its own decisions in any state. When any condition cannot be established, the unit pauses as before. That covers options that match no item, two items or only some of the lines. It also covers options that sit in an unlabelled paragraph, a unit that is not verified, a run with one item, and every structural signal. An attributed unit is classified as if no pause signal were present, so it goes through the gates and the commit like any other `progressed` unit. Its classify step records the item the choice was attributed to, the signal, and for a choice that was not attributed the reason, and never the text of the question. The attribution opens, answers and withdraws no decision. The other item's decision comes from the other item's own unit.

The GSD records of the unit under `.planning/quick/` are read for three facts. The first is the VERIFICATION `status:` line: an absent record is `missing`, and one that is too large, not a regular file or has an unknown status is `gaps_found`. The `status:` line counts only inside a block fenced by `---` lines at the start of the record. A record whose first line is a bare `status: passed`, or whose status line sits in the body, has no status and reads as `gaps_found`, so gate G2 fails it. The second is the number of overrides the unit applied. The third is the number of node-repair PRUNE entries in its records. Records are read as data, at most 64 KiB each. A model-written status can fail a gate and can never pass one.

**Routing.** Only `progressed` goes on to the gates, and a unit stopped by a loop limit is escalated whatever else it did; it is never gated or committed. A block is item-local (the item is parked and the run goes on) when its reason is `decision`, and run-wide otherwise (see Several items).

| Ending | Outcome |
|---|---|
| Clone HEAD moved | Run-wide: `enforcement_failure`, class `permission`, with a containment finding. No recovery touches the clone. |
| Loop limit (consecutive denials or searches), unless the budget ran out | Item-local: `decision`, class `repeated_failure`. |
| `budget_exhausted` | Run-wide: `budget_exhausted`, class `budget`, naming the spent budgets. This is routed before the loop limit, because a spent budget denies every later call and so causes it. |
| `paused` | Item-local: `decision`, class `acceptance`, the issue being the unit's own question stored as data. |
| `denied` | Item-local: `decision`, class `permission`. |
| `no_progress` | Item-local: `decision`, class `repeated_failure`. |
| Crashed or timed out (`inconclusive`, or `failed` with a signal, a non-zero exit or no result), HEAD not moved, no host refusal | Discard and retry once (below). |
| Any other `failed` (an error result with exit 0) | Item-local: `decision`, class `repeated_failure`. |
| The host refused to launch (unavailable or denied) | Run-wide: `enforcement_failure`, class `permission`. |

### Discard and the one retry

A crashed or wall-clock-killed unit with no moved HEAD is discarded and tried once more. The retry is the second and last attempt. Before the discard, if the invocations budget cannot cover another unit (counting the killed one's reservation), the run blocks with `budget_exhausted` (class `budget`) instead. The discard checkpoints first, so a supervisor with a stale fence cannot reach it. It then puts the clone back to the snapshot taken right before the launch, limited to the paths the unit changed after it. A file that was in the clone before the snapshot is restored to that version and not to HEAD. Ignored paths are never touched, and nothing is deleted recursively. An added path is removed only as a file or link, never through a symlink. The step records what was restored, removed and left, with the side effect `none`. A unit has no network, no push and no change request, so there is no external effect to roll back. That claim is recorded with its basis so that a later delivery capability must re-check it. If the clone HEAD moved by then, the discard is refused with nothing changed, and the run blocks with `enforcement_failure`.

A supervisor superseded after the discard's checkpoint still restores the clone and records the `discard` step and the attempt's end, which take no fence. Its work item move then fails on the fence, and the run and the item stay as they were. The next supervisor's resume repeats the discard, which finds nothing left to restore, and retries once. The repeated discard replaces the step record, so the final record lists nothing restored or removed.

The attempt ends `discarded`, the item goes back to `ready`, and the retry attempt runs from the launch action with a rebuilt context pack. A second crash or timeout blocks with `decision`, class `repeated_failure`, naming both attempts and how each ended. A unit that progressed, paused, was denied or made no progress is never retried, and neither is one the host refused to launch.

### Gate G1, gate G2 and the commit

A `progressed` unit's item moves to `implemented`. Gate G1 judges the unit's quick plan first. It fails a plan in four cases. The plan is missing. The plan names a path outside the write set or outside the item's explicit spec. The plan holds a decision checkpoint with no preselected option, which the unit then resolved itself. The plan leaves an owner choice (a criterion that names `decision:<key>`) unasked. A plan that cites no acceptance ID is only an advisory. A failed G1 records its gate row, parks the item's delta and opens an item-local decision, and gate G2 never runs for that unit. A path outside the write set opens a `scope_expansion` decision. A plan checkpoint opens an `acceptance` decision whose options are the plan's own option IDs, and an unasked owner choice an `acceptance` decision answered in free text. The rules and their order are in [checks-and-evidence.md](checks-and-evidence.md).

A unit that passes G1 is judged by gate G2 over facts AVARICE measured. G2 holds the unit to the contract's scope (write, create, delete and protected globs) and to a GSD verification status of `passed`. It also requires no new override, no PRUNE entry and no weakened test inventory, and no required or targeted check regressing against the item's start. The rules and their order are in [checks-and-evidence.md](checks-and-evidence.md). The required checks run on the working tree only when every other rule already passes, so changed code of a unit that is already stopped is not run. A required check that failed when the item began and fails again is flagged pre-existing and does not block. A target check that does not pass always blocks.

A failed G2 records its gate row and blocks before any commit:

| Rules that failed | Outcome |
|---|---|
| Scope or deletion scope (alone or with others) | Run-wide: `enforcement_failure`, class `permission`, with a containment finding listing at most ten paths. |
| Only the checks delta, every blocking check one that passed at the item's start and now fails | One repair first (see Repair and gate G3); a decision only when the repair is not offered or fails. |
| Only the checks delta, otherwise | Item-local: `decision`, class `repeated_failure`, with the failing evidence and the reproducer attached. |
| Anything else, in a unit that is not a repair | Item-local: `decision`, class `acceptance`. |
| Anything else, in a repair unit | Item-local: `decision`, class `repeated_failure`. |

A passing G2 moves the item to `gated` and the supervisor commits. A repair can put the work back to the pin; with nothing in scope left to commit, the item opens a `repeated_failure` decision instead of an empty commit. Otherwise:

1. Every changed artifact record (the unit's quick records) is archived into the artifact store, up to 2 MiB each, kept for the life of the run.
2. Every artifact path is restored to HEAD, or removed when HEAD does not have it, so the clone keeps the in-scope change and nothing else. The GSD records of the unit never reach the review branch.
3. The in-scope paths are committed, and only those. The commit uses the fixed identity `AVARICE <avarice@localhost.invalid>`, is unsigned and skips hooks. Its subject is the item's title (the brief title for a brief without items; whitespace collapsed, at most 72 characters, `AVARICE run change` when empty), and it carries the trailers `Avarice-Run: <runId>` and `Avarice-Attempt: <attemptId>`. The model never writes git metadata.
4. The `commit` step is recorded and the item is `done`. The item's park ref, if it had one, is dropped. The scheduler then says what is next. The run moves `running` to `running` for the next item, or to `blocked_on_decision` when nothing is ready and a decision is open. It moves to `failed` when nothing remaining can be delivered, or to `verifying` with the revision `git:<sha>` after the last item. An item's attempt ends `committed`, except the last attempt of the run, which ends with the hand-off.

A path that G2 let through but that is neither in scope nor an artifact stops the supervisor with an internal error rather than a block.

### Repair and gate G3

A required check that passed when an item began and fails after its unit gets one bounded repair before the owner is asked. The repair is offered when four things hold. Gate G2 failed only on the checks. Every blocking check is such a regression, and each of them ran and failed. Each failing check has had fewer repairs than the contract allows since the item last started over (an answered decision restarts the count). The invocations budget has room. A check that failed at the start too, one that could not run, and every other failure go straight to the decision. A spent invocations budget at that point blocks the whole run with a `budget` decision naming `invocations`.

The repair is a second unit of the same item, on the work the first unit left in the clone. Its attempt has the reason `repair`, the item moves from `implemented` back to `delegated`, and the checkpoint `repair` and a `repair:reproducer` step precede the launch. The repair prompt names the failing check, its command, its exit code, the failing tests, a digest of its output and the paths the item changed since its base. It tells the unit to fix the code and not to delete, skip or change the failing test. The attempt that was repaired ends `repaired`; a repair attempt that never launched ends `discarded`. A repair is never retried after a crash and does not use the unit's retry.

Gate G3 judges the repair's own diff before G2 judges the whole item again. It fails a repair when the repair limit is already reached or when a failing test is gone after the repair. It also fails a repair when a failing test's file was changed (a test path an amendment authorized is exempt). Both verdicts are recorded whatever either says. A repair that fails G3 or G2 opens an item-local `repeated_failure` decision that cites the reproducer. The item's base snapshot, taken when its first unit launched, is what G2 and the commit measure against, so the first unit's changes and the repair's make one commit.

### Final proof and hand-off (`verifying`)

The final proof runs on the committed, clean revision, at the commit and not on a working tree.

1. Every required check and every brief target check runs sandboxed at the commit, one evidence row each. The GSD verifier's verdict is stored too, as model-review evidence that can never satisfy an acceptance criterion. A `diff:<path> unchanged` reference is deterministic evidence AVARICE derives by comparing the commit with the onboarded revision; any other `diff:` rule produces none and so satisfies nothing. A `test:<text>` reference is satisfied by a test ID containing the text in the passed after-unit inventory, when the checks that run the tests passed.
2. Gate G4 is the independent final proof. It passes only for one clean committed revision. No required check may block against the baseline, and every acceptance criterion must map to passed deterministic evidence. There must be no stale or inconclusive required evidence, and the diff against the onboarded revision must be clean: every changed path is in contract scope and none is an artifact or protected. There must be no open decision and no budget over its limit. A failed G4 blocks the run with `decision`, class `repeated_failure`. There is no repair item and no second attempt.
3. Hand-off fetch: the run branch is fetched into the source repository as one new local branch `avarice/<runId>`. It is create-only and never forced: an existing equal ref is success with nothing fetched, and a different one is a conflict (blocked: `decision`, class `scope_expansion`, the ref left as it is). It checks nothing out, runs with object checking on because the objects come from a tree an agent wrote into, and verifies that the ref ended at the verified commit. The step and a `handoff.fetched` event are then recorded, the attempt ends `handed-off`, and the run moves to `ready_for_review`. The user's working tree, index and every other ref are untouched.

The run moves to `ready_for_review` only after a passed G4 row for exactly the handed-off commit is in the ledger. A check that was already failing at the baseline is named in the hand-off, never hidden behind a green result.

## Decisions

Every block routed through the block step opens one decision record (the enforcement check does not; see Quirks) and moves the item to `blocked_on_decision`. It ends the open attempt as blocked. It moves the run or, for an item-local block, lets the scheduler move it. The record has one of five classes: `acceptance`, `permission`, `repeated_failure`, `scope_expansion` and `budget`. It carries the issue, the options the owner may answer with and a consequence for each. It also carries the item and its dependents, the contract version, a digest of the state it was asked in, and references to the evidence that failed. A breach of containment first writes a `containment.finding` event with the check name and at most ten paths, never model text. A blocked run never produces a branch. [autonomy-and-decisions.md](autonomy-and-decisions.md) owns the record, the classes, how an answer is checked and how the owner is told.

## Answer and resume

An item whose decision the owner answered runs again, and its first attempt after the answer is one of two kinds. Which kind is read from the ledger and the clone, never from what the unit said.

**Resume of the item's own session.** The first attempt after an answer resumes the session the item's unit ran under. That needs three things: the item has that session, it has a parked delta that can be put back, and there was no earlier fallback for this decision. The attempt has the reason `resume` and keeps the item's session. The supervisor takes a snapshot of the clean tree at the current HEAD, which becomes the attempt's snapshot, and commits the checkpoint `unpark`. It puts the parked delta back on the current HEAD. The host is launched with `--resume` for the session in place of a new session ID, under the same containment flags as a fresh launch. The resume prompt holds the item's line and a fixed line that marks the answer as a recorded decision and data. It then holds the answer (a choice by its number and label, free text as typed, at most 2000 characters) and the sentence that nothing in it changes the paths, commands or criteria. It ends with a reminder to read each file again before editing and the instruction that the supervisor commits. It does not repeat the question, since the session remembers asking, and it does not repeat the list of pre-existing failing checks. The unit runs on the item's own model. It is then classified against the item's base snapshot, so the work since the base is the parked delta plus whatever the resumed unit added. It goes through G1, G2, the repair road and the commit like any unit.

**Fresh unit with the answer.** An item with no usable session or no parked delta, or one that fell back, runs a fresh unit with the reason `answer`. Its prompt carries a fixed sentence saying that the unit stopped to ask earlier and the owner answered. It then carries the question it asked as data (cut to 600 characters), the answer, and the sentence that the decision changes no path, command or criterion. A later retry of that item carries the answer too.

**Fallbacks.** A resume gives up, and the item runs a fresh unit with the answer, for one of five reasons, recorded in a `resume:fallback` step.

| Reason | When |
|---|---|
| `session-gone` | The host does not know the session: the unit failed with an error result, a result was seen, no turns and no cost, exit 1. |
| `crashed` | The resumed unit crashed or timed out with HEAD unmoved and no host refusal. |
| `unpark-conflict` | The parked delta no longer applies: a parked path changed between the base HEAD and the current HEAD, or is modified now. An `item.unpark_conflict` event carries a count of paths, never the paths, and the delta is dropped with its ref. |
| `park-missing` | The park ref is gone. |
| `interrupted` | The supervisor was killed during the resume and the reconcile found the attempt launched (see Resume and reconcile). |

The resume attempt ends `discarded` and the clone goes back to the item's base, which takes the unparked delta out again. A host that refused to launch is not a fallback reason: no sandbox or a failed self-test blocks like any other launch. Before a fresh unit that follows a resumed one that was charged, a spent invocations budget blocks the run on a `budget` decision naming `invocations`. The fallback is not a retry. The fresh unit has its own, and an answer starts the item over: the attempts before the last `answer` attempt were about a question the owner has since settled and are not counted against it.

## Cancel

`avarice cancel <run> [--wait]` ends a run from any state that has not ended. It is refused inside a run, without a terminal and from a run's process tree, and works only for the owner's own profile. The request is recorded on the run row first, and the first request is kept. What follows depends on the lease.

- With no live lease, `cancel` takes the lease for at most 60 seconds. It ends every host the earlier holder left running by its session ID (as a resume does) and charges what that holder had reserved. It then withdraws every open decision in decision-ID order, ends the open attempt `cancelled`, moves the run to `cancelled` and releases the lease.
- With a live lease, `cancel` returns after recording the request. The supervisor's renewal timer reads the run row, aborts the unit in flight, and ends its attempt `cancelled`. The aborted unit is not classified, retried or discarded, and its invocation stays charged. The supervisor's loop looks for a request before each stage, after each stage, after a failed stage and at entry, then carries the cancel out and stops. After it releases the lease it looks once more, and `cancel` looks at the lease after it records the request, so one of them always sees the other's write. With `--wait`, `cancel` then waits for the run to become `cancelled`.
- A supervisor that dies after the request leaves the request standing. The next supervisor start, or `cancel` again, finishes it, and a run with a request never goes on with work.

A cancelled run is terminal. Its work items, park refs, clone and branch stay as they were, and `resume` only reports it. The decisions withdrawn carry the reason `cancel`. The kill points `after-cancel-request` and `mid-cancel` exist for the fault suite, and the recovery from either is `cancel` again or `supervise`. The flags and exit codes are in [cli-reference.md](cli-reference.md).

## Amendments and contract versions

The contract only narrows at compile time, and only an amendment from outside the run changes it afterwards. `avarice contract amend <run> --reason "<why>"` asks for contract version n+1 from the owner's terminal. It is refused inside a run, without a terminal on both standard input and output, and from a run's process tree, all before the profile is resolved. It records the owner as `owner:` and the operating system user name. Nothing reachable from the contained agent can call it.

An amendment can change four things, and nothing else.

| Flag | Change |
|---|---|
| `--budget name=value` | One of the seven budgets, up or down, to any finite value above zero (whole numbers for counts). There is no upper bound. The per-invocation cost may not exceed the per-run cost, and the concurrent subagent cap may not exceed the total. |
| `--add-write glob` | A write glob, added to the write and create lists. It must lie inside the conventions' write set as of the contract's conventions revision and off every protected glob. At most 128. |
| `--check +name`, `--check -name` | A declared check made required, or not required. At least one required check always remains. |
| `--acceptance-file file` | Criteria in the brief's line syntax, at most 64 KiB. A known ID changes its text or references. A new ID joins the item named by `--item`, which is required when the run has more than one item. No criterion is deleted. |

The reason is required, at most 500 characters. A request that changes nothing is refused, and so is an amended contract that fails the static conditions of G0. The policy revision, the protected globs, the notification lists, the exclusions and the work item structure cannot be amended. The next version keeps the policy revision and takes the amendment time as its compile time. `--decision` names an open `repeated_failure`, `permission`, `budget` or `scope_expansion` decision of the same run, which the amendment then answers.

A check made required by `--check +name` is also added to the agent's command list in the same amendment. It is listed as the contract lists a check (its environment, then its argument vector), and the diff records an `execution.commands` entry. Without that the unit could not run what the gate now judges. `--check -name` leaves the commands as they are, and the unit prompt then names the check as one that is not judged.

The command prints the field-level diff, what the amendment invalidates and what it answers, then asks `apply contract v<n+1>? [y/N]`. Only `y` or `yes` applies it. One ledger transaction then writes the new contract version with its diff, reason and the authorizing owner, and changes the limits of the budget rows it names (spend and reservations are untouched). The same transaction appends the stale rows and answers the decision it names as `amended:v<n+1>`, releasing the decision's items. The transaction takes no lease fence, because the command runs beside a supervisor that may be working another item. It is refused, writing nothing, when the contract version moved since it was read, when the run has failed, been cancelled or closed, and when the decision is no longer open. The contract file of the new version is written afterwards. If that write fails, the amendment stays recorded and the supervisor writes the latest version's file from the ledger before it launches anything. A running supervisor reads the latest contract when it loads the next unit or opens the next block.

**What an amendment invalidates.** Earlier results are never edited. An amendment appends a copy marked `stale` of each result it invalidates, and the originals stay.

| Field changed | Invalidates |
|---|---|
| Acceptance criteria | The gate results, the mapping of evidence to criteria, and the check runs that mapped them |
| Write, create or protected paths | The scope conformance results: gates G2 and G4 where they stood passed |
| Required checks | All check evidence |
| Budgets, notifications, exclusions | Nothing |

Each invalidated evidence row gets a `stale` copy under the new contract version, whose environment names the amendment and the row it supersedes. Each invalidated gate that stood passed gets a failed `stale-after-amendment` row. The gate and evidence selection is of the latest contract version's rows that are not already stale. A budget amendment therefore never turns an earlier pass into a fail, and an acceptance or scope amendment makes the final proof run again.

**What a stale answer does.** The contract version is part of the digest every decision is stamped with, so an amendment makes the decisions still open stale. The owner's next answer to one is not applied: the decision is re-opened on the new state with the answer kept as context. [autonomy-and-decisions.md](autonomy-and-decisions.md#the-stale-re-open) states the rule, and the flow is drawn in [processes.md](processes.md#amend-the-contract-and-answer-on-a-moved-state).

## Resume and reconcile

`resume <run_id>` continues a run; a `run_` prefix selects it over an onboarding. Before spawning anything it checks that no live lease is held. Otherwise it exits 3, changes nothing and says the lease must expire first. It prints the state and next action it resumes from and the interrupted step. When an attempt was open, it also names that attempt. A run in a stop state, or in any state `resume` does not continue, is only reported. No lease is taken, and the exit is 0 at `ready_for_review` and 3 otherwise. A run blocked on a decision is continued, not only reported, when an answer made an item ready or left no decision open and no live lease is held. In the other cases it spawns the detached supervisor as `start` does and records a `supervisor:resume` step. Before it spawns, it checks that the host configuration directory the run recorded at start is still a readable directory. When it is missing, is not a directory or cannot be read, `resume` exits 3 naming the directory, writes nothing and spawns nothing. `decide` refuses an open decision of the run the same way and leaves it open. The supervisor runs the host under the recorded directory, not under the environment of the command, so a resume finds the session a paused item left wherever the owner answers or resumes from. Without that, the host reports an unknown session, the resume attempt is discarded and a fresh unit starts, and both calls are charged. With `--wait` it follows the run for at most 24 hours. It exits 0 at `ready_for_review`, 3 at any other stop state or when the supervisor died again, and 70 when the supervisor could not reconcile.

The supervisor always runs a prelude under the lease before its loop:

1. Reap: every launch step left `started` is a host that may still be running (it is detached and outlives a killed supervisor). It is ended by the session ID its step recorded, and every reap completes before any row is marked or anything is read from the clone. A reap that fails stops the resume with every row still `started`. So does a started launch that cannot be reaped at all, because its step records no session ID or because the host cannot reap; the failed reconcile step names which. The steps are then marked `interrupted` and an event names each interrupted invocation.
2. Spend: every reservation held by the dead supervisor is spent now, whatever the run does next.
3. No replay: a privileged action that has a recorded start and no end is never run again. One permission decision per start names it, the run moves to `blocked_on_decision` with reason `enforcement_failure`, and nothing below runs. A run that was already blocked on a decision for another reason, an answered item decision for example, would otherwise be continued by this resume. It is paused and blocked again with `enforcement_failure`, and a run already blocked with that reason stays as it is. A run with none goes on.
4. References: every reference the run recorded is refreshed (see Reference refresh on resume), and a changed, deleted or revoked one stops the run before anything is reconciled or launched.
5. Reconcile by state.
   - `running`, item in flight: when the item is `delegated`, the run makes a real ledger transition to `paused` (event data reason `interrupted`) around the reconcile and then returns to `running`. A `gated` item is reconciled without the pause.
     - An attempt that was delegated is read as `inconclusive`: it is recorded as such, the clone goes back to the attempt's snapshot, and the item is retried once. An attempt with no launch step ran nothing and does not use the retry. If a second attempt is interrupted, the one chance is spent and the run blocks with `decision`, class `repeated_failure`. If the invocations budget cannot cover a retry, the run blocks with `budget_exhausted`.
     - A delegated attempt that was a resume of an answered item's session is not a retry. One that never launched its unit goes back to its snapshot, which takes the unparked delta out, and the item resumes again, because the unpark can be repeated. One that launched, whether its host was killed or its result was never classified, is reaped by the session ID its launch step recorded and goes back to its snapshot. The item then takes a fresh unit with the owner's answer, recorded as a `resume:fallback` step with the reason `interrupted`. If the invocations budget cannot cover another unit, the run blocks on a `budget` decision naming `invocations` instead.
     - An implemented item is in flight only when its gate blocked it and the supervisor died inside the block, which leaves a park step. The reconcile finishes the block by writing the decision from that step. Any other implemented item is continued by the stage as it is.
     - Items run one at a time, so at most one item is in flight. A ledger with more than one is an internal error.
     - A clone HEAD that moved under a delegated item is a breach: `enforcement_failure`, a containment finding, no discard.
     - A gated item whose HEAD moved is the supervisor's own commit only when two things hold. The HEAD message carries this run's ID and the open attempt's ID in its `Avarice-Run` and `Avarice-Attempt` trailers, and the commit has exactly one parent, the open attempt's snapshot head. Then the `commit` step is recorded with it and no second commit is made. Any other moved HEAD blocks as above, including a commit that carries the trailers but sits on another parent.
   - `verifying`: the reconcile makes a real ledger transition to `paused`, which `status` shows as `paused (verification interrupted)`. The required checks of the interrupted final pass that never finished get `inconclusive` evidence (insert-only; what the pass did record stays). Then the run goes back to `verifying`, at the hand-off when G4 already passed for this very commit and at the checks otherwise. The mid-hand-off kill point sits between the fetch and its record. A resume therefore repeats the fetch, which is idempotent, and finds the ref already there.
   - `paused`: a previous reconcile paused the run and was killed before it put it back; the item's state says which way back.
   - `contract_ready`: nothing to reap; the stage repeats the actions whose step is not recorded.
6. The stage loop continues from the committed state.

A prelude failure is recorded as a failed `resume:reconcile` step and ends the supervisor; `resume --wait` then exits 70 with that detail, not a second "interrupted". The record presents the supervisor's fence. A supervisor that another one superseded therefore records no failed reconcile step, so a later `resume --wait` does not read its refusal as one.

Nothing is claimed that was not measured. An interrupted invocation is `inconclusive`, and the budgets it was charged stay charged.

## Reference refresh on resume

A run records what it was built from in `task_refs`: the brief file it started from and every item of its context packs (the provider's own ID, verbatim, with the revision it was read at). Between the no-replay check and the reconcile, `resume` refreshes every reference in key order. A reference that was recorded by hand (a pasted excerpt, a pull request URL) names no live source and stays as recorded. The brief is compared by the digest of its bytes. It is `fresh` when equal and `changed` when different or no longer a brief (too large, not UTF-8). It is `deleted` when the file is gone or is not a regular file, `access_revoked` when it can no longer be read, and `unavailable` otherwise. Every other reference is judged by its context source against the repository as it is now (see [indexes-and-context.md](indexes-and-context.md#freshness)). The new freshness is recorded and the revision the run was built from is left alone, so a second resume finds the same change again instead of accepting it. The refresh appends one `task_refs.refreshed` event with the counts.

| Freshness | Meaning | Effect on the run |
|---|---|---|
| `fresh` | the source is where the run left it | none |
| `stale` | the index was built before the repository's current HEAD | shown by `status`; the run goes on |
| `unavailable` | nothing could be judged | a warning; the run goes on on what it recorded |
| `changed` | the reference's revision is no longer the source's, or the brief changed | the run stops with reason `ref_changed` |
| `deleted` | the source or the cited path is gone | the run stops with reason `ref_deleted` |
| `access_revoked` | the source refuses the reference | the run stops with reason `access_revoked` |

When any reference is `changed`, `deleted` or `access_revoked`, the run moves to `blocked_on_decision` with the most severe reason (`access_revoked`, then `ref_deleted`, then `ref_changed`) and no unit is launched. One decision names the references, so a resume killed after it opened the decision does not open a second. Its class is `permission` for a revoked reference and `acceptance` for the others, and it offers `withdraw` only: nothing the owner types accepts a changed reference, and the work items stay as they were. A run blocked for this reason is final: `resume` only reports it again, and `avarice cancel` ends it. A run that was blocked on an answered item decision and is continued by the resume is paused first, then blocked again with the reference's reason. `status` lists the stale references of a run (see [cli-reference.md](cli-reference.md#status)).

## Restricted runs

`start --restricted` runs analysis and planning only, for a host that cannot be contained (see [containment.md](containment.md#restricted-mode)). The contract records the mode, and every stage reads it from the stored contract, so a run killed and resumed arrives in the same place and cannot become a contained run.

The start refuses before it stores anything when the restricted host cannot start the restricted line: no restricted host is composed, or the host's reason names the probe that failed. A host that lacks required enforcement for a contained run makes the run stop `blocked_on_decision` with reason `enforcement_failure`. When `claude` is present and failed a containment probe, the host's reason ends with how to ask for restricted mode. A missing `claude`, gsd-core or shim preamble carries no such hint.

The preparation of a restricted run is the clone at the pin and nothing else. The dependency install, the check validation and the baseline run repository code, and a restricted run runs no check, so none of them runs; no GSD setting is written either, because no `/gsd-quick` unit runs. Then one restricted invocation runs in the clone with a planning prompt built from the brief. The host writes a plan and a list of open questions under a directory the patch leaves out, and edits the working copy. It has no command, no subagent and no network. It may edit only the paths the contract allows. A host that cannot be contained is not trusted to honor that, so the supervisor holds the patch to the contract after the host has run (see below). A run killed during the invocation is continued by the same stage: the host that launched is reaped, the clone goes back to the pin and the restricted line is launched again.

The run's end is one permission decision, and the run stops `blocked_on_decision` with reason `enforcement_failure`. The supervisor stores up to three artifacts, each only when it exists. They are a non-empty plan (`restricted-plan`) and a question list with at least one question (`restricted-decisions`), each at most 256 KiB, and a non-empty patch (`restricted-patch`), at most 1 MiB. The patch is the clone's diff against the pin without the restricted directory and without the paths the contract does not allow. A changed path is out of scope by the rules the contained run's scope gate applies. A protected path is out of scope. So is a modified path outside the write set, an added path outside the create set, and a deleted path outside the delete set. The run's artifact paths are tolerated for modified and added paths only, so a deleted artifact path is a breach. Out-of-scope paths are left out of the patch. The block text names at most five of them, each cut to 80 characters, then `and N more`. They are recorded as a `containment.finding` event with the check `scope-of-writes`, which lists the first 10 paths and the count.

The host is not trusted with what it leaves behind. Three kinds of problem do not stop the stage: an unreadable plan or question list, a patch that cannot be built or is over 1 MiB, and an unreadable list of changed paths. A plan or question list is unreadable when it is over 256 KiB, not a regular file, or a link out of the clone. Each is one sentence in the block text, such as `the plan could not be read (...)` or `the patch is larger than the 1 MiB limit and was not stored`. The run still ends blocked. The sentences about problems and out-of-scope paths are cut at 440 characters. The ending of the text therefore always survives the 1000-character limit of the block text. That ending says that no check and no gate ran and tells the owner to apply the patch by hand and cancel.

The supervisor records a step when the outputs are judged, with the problems, the out-of-scope paths and `captured` false, and records it again after the artifacts are stored, with their digests and `captured` true. A resume never launches the host once the step exists. When only the first record exists, a kill came between the judgment and the storage, and the outputs are taken again from the clone.

The decision names the artifacts by digest and says that no check and no gate ran and nothing was committed or handed off. It offers `withdraw` only, and answering applies nothing. The owner applies the patch by hand and ends the run with `avarice cancel`. The run never reaches `ready_for_review`, and nothing is written to the owner's repository. `status` labels the run `restricted <state>` and shows the mode. There is no command that reads the stored artifacts back.

## Status and inbox

`status` and `inbox` read run state from the ledger and change nothing: no lease, no model, no transcript. Run values are IDs, states, statuses, revisions and counts, and the inbox adds the decision issue (AVARICE's own words or the unit's question stored as data), the run title and the repository path. The `runs` array of `status --json` and `inbox --json` have the shapes owned by [cli-reference.md](cli-reference.md).

A run is interrupted when its state is one of the four resumable ones and no lease is live. It is presented as `paused (verification interrupted)` when the ledger state is `verifying` and `paused (supervisor interrupted)` otherwise. The line names the open attempt, the step that was in flight (the checkpoint action, or a step begun after the last checkpoint) and the command that continues it. The ledger state itself is unchanged until the resume. Interrupted runs sort first, then runs blocked on a decision.

Each run in `status` also lists its work items with their state and attempts. It lists its decisions with their class, state and the decision that replaced or was replaced by them. It also gives the delivery state of its notifications and a cancel request while one stands. The inbox lists open decisions (blocking before digest), each with its items, its options, the command that answers it and the delivery state of its banner. It also lists runs waiting for review, with their branch and the handed-off commit. It also names the declared checks a review did not run. The list is the record: a banner that did not arrive changes nothing there.

## Containment as the run does it

Each mechanism below is stated as what it does, so a reader can tell prevention from detection. The mechanisms themselves are in [containment.md](containment.md).

| Concern | Mechanism | Prevents, detects or recovers |
|---|---|---|
| The host enforces containment | G0 reads whether the adapter reports enforcement as enforced, a verdict decided once per process from the hook entry, the sandbox and an admitted host version. Every launch then re-checks its own generated settings and runs a hook self-test, and refuses the launch otherwise. | Detects at G0, prevents at launch. |
| Writes outside the contract | The generated settings deny existing paths outside the write set. Paths created later at places the scope cannot name are not prevented; the diff since the snapshot finds them at G2, and the commit takes only in-scope paths. | Prevents for what the scope can name; detects the rest. |
| The model committing | The hook's command allowlist denies a git commit and the executor is told not to run one. A moved HEAD is found after the unit. | Prevents at the hook; detects a moved HEAD afterwards; never recovers. |
| Verdicts | Computed by AVARICE from the clone and the records; model text can fail a gate, never pass one. | Prevents a self-certified pass. |
| GSD settings | Applied once through `config-set`, which reports each key as updated; the file is not read back before a launch. | Applied, not re-verified. |
| A crashed unit | The clone goes back to its snapshot. | Recovers inside the clone only. |
| A killed supervisor | The lease and fence refuse a stale holder; resume reaps hosts before reading anything. | Prevents two writers; recovers by reconciling. |
| Budgets | Reserved before launch, settled after, spent when orphaned. | Prevents a launch with no budget; detects overrun after. |

## Quirks

- The host's outcome kind does not decide the unit. A host `denied` with the work done is common, and the unit is judged from the clone and the quick records.
- A brief without `items` is one item `A`, so a run with no items keeps one unit, one gate and one commit. A run with several items runs them strictly one at a time, in dependency and declaration order; nothing runs two items at once.
- A repair is the same item's second unit, not an item of its own. It is offered only for a check that passed when the item began, and the item has one repair for each such check.
- A blocked run continues when an answer made an item ready or left no decision open. Withdrawing a decision releases nothing, so the item stays blocked and the run ends `failed` once the other work is done. The states `waiting_external`, `awaiting_review` and `closed` still exist in the lifecycle table with nothing driving them.
- A run blocked for any reason but `decision` is final. No answer continues it, because the pickup rule reads only item decisions, and `resume` only reports it.
- A parked item's delta lives only under a ref in the run clone. It is not fetched into the source, so it is invisible outside the clone, and it is dropped when the item commits.
- An amendment makes every open decision stale. The next answer re-opens the decision instead of applying.
- A `cancel` against a live supervisor is carried out by that supervisor, so a supervisor that is stopped but not dead keeps the run at `cancel requested` until its lease lapses.
- A block at the enforcement check opens no decision record, so the inbox shows nothing for it; the run's state and reason are the only trace. Every other block opens one.
- A restricted run's decision is a permission decision that cannot be answered into anything, so the run stays blocked until it is cancelled.
- A reference that was recorded by hand is never refreshed, so a pasted excerpt or a pull request URL cannot block a run.
- A run blocked by a changed, deleted or revoked reference is final: no answer continues it.
- `start` has thirteen refusal codes, and most errors are not refusals. A bad brief, a failed G0 and an invalid budget are usage errors (exit 64). An invalid conventions file is the refusal `conventions-invalid` (exit 3).
- The run's first attempt is opened by the baseline, before the unit exists.
- The brief's `expectedDecisions` is stored and read by nothing. The classifier has a pause signal for a STATE file that needs a human, and nothing supplies it.
- A path that G2 allowed but the commit cannot place stops the supervisor with an internal error, not a decision.
- The conventions file read by a run (schema 1 with `checks`, `paths.write`, `testInventory`, `dependencies` and `agentCommands`) refuses keys that the onboarding activation reader lists (`paths.read`, `paths.generated`, `commands`, `verificationByChangeType`). One file valid for one reader can therefore fail the other.
- An operator's SIGTERM ends the supervisor at once and does not abort the unit in flight. The unit's host keeps running, with no wall clock enforced, until it exits or the next resume reaps it by session ID.
- The supervisor has no console. Closing the shell, killing `start --wait` or losing the terminal leaves it running; the ledger and `status` are the only record.
- Retry accounting counts launched attempts. An attempt that never launched is invisible to the one-retry rule and to the attempt list in a second failure's decision.
