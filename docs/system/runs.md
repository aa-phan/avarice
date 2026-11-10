# Runs

A run takes one written brief to one reviewable branch of the source repository, unattended, inside a contract compiled before anything starts. This document describes the run flow implemented by the start service, the supervisor, its stages, resume and the status read model (`src/app/run-start.ts`, `src/app/run-service.ts`, `src/app/run-stages/`, `src/app/run-resume.ts`, `src/app/run-status.ts`, `src/app/budget.ts`, `src/app/invocation.ts`, `src/app/run-gsd-config.ts`), the supporting domain modules for the brief, conventions, contract, lifecycle, preflight, gates, outcome classification and quick records (`src/domain/`), the git adapters for the source repository and the run clone (`src/adapters/git/run-source.ts`, `src/adapters/git/run-workspace.ts`), the agents file builder (`src/adapters/gsd/agents-json.ts`) and the commands with the detached spawn (`src/cli/commands/start.ts`, `src/cli/commands/supervise.ts`, `src/cli/commands/resume.ts`, `src/cli/spawn-supervisor.ts`).

A run needs a repository that is already onboarded to an active record. `start` compiles the contract from a brief, the repository's own conventions and a fixed preset. It stores the contract and hands the run to a detached supervisor. The supervisor works in a local clone at the onboarded revision. It prepares the clone, runs one GSD quick unit in a contained agent host and judges the unit from facts it measured. It then commits the in-scope change itself, re-verifies the commit and fetches the run branch into the source repository. A successful run ends in `ready_for_review` on a branch named for the run. Nothing is pushed, nothing is merged, and the user's checkout is never written. Whatever the run cannot finish inside its contract ends as an open decision, never as a partial branch. The sibling documents own what this one leaves out.

- [onboarding.md](onboarding.md): the lease, the stage loop and the resume prelude as onboarding uses them.
- [containment.md](containment.md): the hook, the sandbox, scopes and git safety.
- [checks-and-evidence.md](checks-and-evidence.md): install, check validation, baseline, required checks, evidence and the gate rules.
- [data-model.md](data-model.md): tables and events.
- [cli-reference.md](cli-reference.md): flags and exit codes.
- [config-reference.md](config-reference.md): preset values, built-in limits and the conventions keys.
- [integrations.md](integrations.md): the run ports.

## Pipeline at a glance

1. `start` checks the request, reads the brief and the conventions from git objects, compiles and stores the contract, and spawns the supervisor. The run is `contract_ready`.
2. The supervisor takes the run lease and works through the stage for the committed state: preparation (`contract_ready`), the unit (`running`), final proof and hand-off (`verifying`).
3. The run stops in `ready_for_review` (success) or `blocked_on_decision` (an open decision). Both are stop states: the supervisor releases the lease and exits.
4. `resume` continues a run whose supervisor died. `status` and `inbox` read the ledger and change nothing.

The three flows end to end are drawn in [processes.md](processes.md).

## Starting a run

`start --brief <file> --policy routine [--project <id>] [--budget name=value]... [--wait]` authorizes one run. Running the command is the authorization; it asks nothing and reads no input. The only policy is `routine`. The flags and exit codes are in [cli-reference.md](cli-reference.md). In short, exit 0 means the run is stored and its supervisor started (with `--wait`, that the run reached `ready_for_review`). Exit 3 means a start rule refused it or, with `--wait`, the run stopped elsewhere. Exit 64 is a usage error and 70 an internal failure.

### Order of checks and the refusals

`start` runs its checks in this order and creates nothing until every one has passed.

1. Policy: anything but `routine` is a usage error.
2. GSD: no admitted GSD installation is the refusal `gsd-not-admitted`. This is judged before the brief is read, so a missing GSD refuses a start whatever the brief holds.
3. Brief: read as a regular file of at most 64 KiB, strict UTF-8, then parsed and validated. A failure is a usage error naming the field.
4. Project: the registered project whose repository contains the current directory (the deepest one when repositories nest), or the one `--project` names. None is `no-project`. A project without an active record is `no-active-record`.
5. Preflight, judged from git objects only: an uncommitted edit, a dirty checkout or a half-written file cannot change an answer. The pin is the active record's onboarded revision.
6. Contract compile (below). Any failure, including a failed static gate G0 and an invalid `--budget`, is a usage error.

The refusals, all exit 3:

| Code | When |
|---|---|
| `gsd-not-admitted` | No admitted GSD installation was found. |
| `no-project` | The directory is in no registered repository, or `--project` names an unknown project. |
| `no-active-record` | The project has no active record. |
| `conventions-invalid` | `.avarice/config.json` was found but does not parse or validate. |
| `revision-mismatch` | The brief names a base revision that is not a prefix of the onboarded revision. |
| `not-descendant` | The source HEAD does not descend from the onboarded revision, or that revision is gone from the repository. |
| `stale-commits` | More than 25 commits past the onboarded revision touch paths outside `.avarice/` and `.planning/`. |
| `stale-age` | The oldest such commit is more than 14 days old, by its committer time. |
| `no-conventions` | `.avarice/config.json` exists neither at the onboarded revision nor at a later commit that changes only `.avarice/`. |
| `no-planning` | The onboarded revision has no `.planning/ROADMAP.md`. |

The last six are the preflight rules, judged in the order `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning`. When the history does not descend from the onboarded revision, the conventions and the roadmap are never read. The limits are fixed and are not lowered per profile. The run works on the onboarded revision, not on the current HEAD, so code that moved within the limits is simply not in the run's tree.

### What a successful start stores

One transaction stores the run (state `contract_ready`, branch `avarice/<runId>`, base revision the onboarded one), contract version 1 with its digest, the budget rows and the single work item `A`. A killed start therefore leaves either nothing or the whole run. The compiled contract is then written to `contract-v1.json` under the run's directory in the data root (default `~/.local/share/avarice/personal-local/runs/<runId>/`), through a temporary file and a rename, mode 0600 in a 0700 directory. A reader therefore sees the whole file or none. A start killed between the transaction and the file write leaves a run without its file. The supervisor rewrites the file from the ledger before it launches anything. Last, a `start:preflight` step records the pin, the HEAD, the conventions revision, the commit count past the pin and the brief digest, and `start` prints a one-screen summary.

### The detached supervisor

Before it spawns anything, `start` records the host configuration directory it runs under as a `host:config-dir` step. That is `CLAUDE_CONFIG_DIR` when set and not empty, otherwise `.claude` in the home directory, made absolute and resolved to its real path when it exists. The host keeps its sessions, its skills and the GSD installation there and looks for a paused session nowhere else. Every supervisor of the run is therefore started with the recorded directory as its `CLAUDE_CONFIG_DIR`, whatever environment the command that starts it runs in: the first one, the one `decide` starts after an answer and the one `resume` starts. A step that cannot be recorded is exit 70 and nothing is spawned. A run started before the step existed has none, and keeps the environment of the command that starts its supervisor.

After the summary, `start` spawns `avarice supervise <runId>` as a detached process: its own process group, standard streams ignored, working directory the data root, unreferenced, so closing the shell leaves it running. It receives the three profile roots the command resolved and the recorded host configuration directory. The spawn is refused when the CLI entry script is not an absolute path that exists (exit 70; the run stays stored and `contract_ready`). The supervisor's PID is recorded as a `supervisor:spawn` step. Without `--wait`, `start` then exits 0. With `--wait` it polls the ledger every 250 ms for at most the contract's wall clock plus 15 minutes and exits 0 at `ready_for_review`. It exits 3 at any other stop state. It also exits 3 with an "interrupted" line and the `resume` command when the supervisor is gone and no lease is live. On timeout it exits 3 with a "still running" line, and the supervisor keeps working. The supervisor's output goes nowhere; everything it did is in the ledger.

`supervise <runId>` can also be run by hand to continue a run. It always runs the resume prelude first (below), takes the lease, runs the stages and exits 0 at `ready_for_review`. It exits 3 at any other stop state, at a state with no stage, or when another supervisor still holds the lease. It exits 64 for a usage error or an unknown run and 70 for an internal failure. A run that recorded a host configuration directory is supervised only under it: when the directory this process would run the host under differs, `supervise` exits 70 before it takes the lease or writes anything. The commands that start a supervisor never produce that difference; it arises when `supervise` is run by hand from another environment.

## The brief

The brief is a Markdown file. It is data: it is parsed and validated, never read as an instruction to AVARICE, and its digest goes into the contract. Anything below that does not hold is refused with the failing field named.

Optional frontmatter sits between a first line `---` and the next `---` line. Each line is `key: value` with a scalar value (surrounding quotes are stripped); no nesting, no lists. An unknown or repeated key is refused, and so is a frontmatter that is not closed.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `title` | 1 to 200 characters, no control characters | the first `# ` heading before the first section, else `untitled` | The run title and the work item task. The commit subject comes from it. |
| `size` | `small`, `medium`, `large` | `medium` | Picks the model when `model` is absent. |
| `model` | `haiku`, `sonnet`, `opus` | by size: `small` haiku, `medium` sonnet, `large` opus | The model the unit runs on. |
| `baseRevision` | 7 to 40 hexadecimal digits | none | Must be a prefix of the onboarded revision (refusal `revision-mismatch` otherwise). |
| `expectedDecisions` | integer 0 to 1000 | none | Stored in the contract; no stage reads it. |

The body has five sections, each opened by a `## ` line (heading text is case-insensitive). A `## ` line inside a code fence does not open a section. An unknown heading is refused, and so is a section that appears twice.

| Section | Required | Content | Constraint |
|---|---|---|---|
| `## Behavior` | yes | Free text saying what should change. | Non-empty. |
| `## Acceptance criteria` | yes, at compile | Bullets, `- AC1: text \| verifiedBy: check:unit, test:name`. | At most 20. IDs match `AC<digits>` and are unique. Each reference is `check:<name>`, `test:<text>` or `diff:<rule>`. |
| `## Exclusions` | no | Bullets of things the unit must not do. | Bullets only. |
| `## Write` | no | Bullets of repository-relative globs the run may write. | Narrows the conventions' write set (see the contract). |
| `## Target checks` | no | Bullets of check names. | Each matches the check-name pattern: a lowercase letter, then lowercase letters, digits, `:`, `_` or `-`, 64 characters at most. |

The list sections take bullets (`-` or `*`) only; any other non-blank line in them is refused, so prose cannot hide in a list. An item wrapped in backticks has them stripped. A section holds at most 128 items. A brief with no acceptance criteria is accepted by the parser and refused at compile.

Whole-file limits: 64 KiB, 4096 characters per line, no control character other than tab and newline, no U+FFFD after decoding. A leading byte order mark and CRLF line ends are normalized.

## Repository conventions

The conventions file is `.avarice/config.json`, schema 1, read from git objects and never from the working tree. It is read from the onboarded revision or from a later commit on the source's first-parent history that changes only paths under `.avarice/`. The newest such commit wins, the onboarded revision is the last candidate, and at most 500 commits are walked. A later commit that also changes anything else never qualifies, so the conventions never come from a tree whose code differs from the onboarded revision. The file is at most 256 KiB and must be a regular file.

The file is data from whoever controls the repository, so every level refuses unknown keys: a field no stage reads cannot carry authority. For the run the keys mean:

- `checks`: the commands the run may use as evidence. Each has a name, an argument vector (never a shell string), a timeout, a required flag (default true) and non-secret environment variables. Reserved names such as `PATH`, `HOME` and `NODE_OPTIONS` and the `DYLD_`, `LD_` and `npm_config_` prefixes are refused. A check's `writes` globs become run artifacts. Required checks are what the final proof must pass.
- `paths.write`: the globs the run may write. It must not be empty after the brief narrows it. `paths.protected` adds to the preset's protected list; `paths.artifacts` adds paths that may change during the run but never reach the branch.
- `testInventory`: how the run lists the repository's tests, so a unit that weakens the test set is caught.
- `dependencies`: the install command, the lockfile path and the registry hosts the install may reach.
- `agentCommands`: the shell commands the agent may run, exactly as written. A command with chaining, substitution, escapes or redirection is refused. So is one that starts with `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` or `sudo`, matched by its last path segment without regard to case.

The key list, limits and defaults are in [config-reference.md](config-reference.md).

## The contract

The compiler is the one place a run's authority is fixed, and it only narrows. A brief or a conventions file never raises a budget, widens the write set past the conventions, writes a protected path or grants the agent a git, AVARICE or network command. Compilation is refused, as a usage error, when:

- a conventions write glob, artifact glob or check `writes` glob lies inside a protected path;
- a brief `## Write` glob is protected or not inside the conventions' write set (a prefix alone is not containment: `lib-evil/**` is not inside `lib/**`);
- the write set is empty;
- a command (an agent command or a check argument vector) starts with a never-granted word;
- the brief has no acceptance criteria;
- an override is unknown, not above zero, not an integer where one is needed, or above the preset;
- the static gate G0 fails.

Static gate G0 judges what the contract alone can show. There must be at least one acceptance criterion, and every criterion has a `verifiedBy`. Every `check:` reference names a declared check, and every `test:` reference has a declared test inventory. Every target check is declared, and at least one required check is declared. The other half of G0, whether the host enforces containment, is judged by the supervisor before the first invocation.

### Contract file format

`contract-v1.json` is canonical JSON with schema 1 and contract version 1. Its top-level sections:

| Section | Holds | Source |
|---|---|---|
| `runId`, `policyPreset`, `policyRevision`, `compiledAt` | Identity, `routine`, a digest of the preset values, the compile time. | Preset and clock. |
| `intent` | Title, behavior, acceptance criteria, exclusions, one requirement reference naming the brief and its digest, the work item list (always the one item `A`, with its size, its model, whether the model came from the brief or from the size, and a spec listing the write globs), and `expectedDecisions` when given. | Brief. |
| `workspace` | Project ID, base revision, conventions revision, branch `avarice/<runId>`. | Start. |
| `files` | Read (everything), read-exclude, secret globs, write, create (equal to write), delete (none), protected (preset plus conventions), artifacts (preset, conventions and every check's writes). | Preset, conventions, brief. |
| `execution` | Agent commands (the conventions' plus each check's argument vector), checks, tool classes, endpoints (none), the install registry hosts, dependencies, environment `local-sandbox`, model by size. | Preset, conventions. |
| `decisions` | Delegated, human and prohibited decision lists; no defaults. | Preset. |
| `budgets` | See below. | Preset, overrides. |
| `verification` | Required checks, target checks, test inventory, the GSD verifier setting, the baseline mode, the per-item mode and the integrity gate names. | Preset, conventions, brief. |
| `delivery` | Endpoint `ready_for_review`, handoff `local-branch`, no push, no draft change request. | Preset. |
| `escalation` | The loop limits and the no-progress limit. | Preset. |
| `notify` | Local notification for review-ready and blocking events. | Preset. |

The preset values are in [config-reference.md](config-reference.md). Two consequences matter here. The unit may write only the brief's `## Write` globs (or the conventions' write set when the brief has none), and a file it creates must match the same globs. And no contract, whatever the brief says, lets a run delete a file. The delete list is empty, so a deletion is a scope failure at the first gate. So is a rename, which arrives as a deletion plus an addition.

### Budgets and overrides

`--budget name=value` may lower a budget, never raise it. The seven overridable names are `wallClockMinutes`, `invocations`, `toolCalls`, `subagentsTotal`, `subagentsConcurrent`, `costUsdPerInvocation` and `costUsdPerRun`; the first five are integers. A per-invocation cost above the per-run cost is lowered to it, and a concurrent subagent cap above the total is lowered to it; each such move is recorded in the contract as an adjustment. The default invocation count covers the unit, its one retry and one relaunch after an interruption, and the formula text is stored in the contract. The subagent total covers a planner, up to two plan-checker passes, an executor and a verifier per unit, for the unit and its retry.

Five budget rows are stored with the run: invocations, tool calls, total subagents, wall clock in milliseconds and cost (the limit is the per-run cost, marked estimated). The concurrent subagent cap is carried in the invocation scope for the hook, not as a row. A reservation is made before the host starts and settled after; a reservation whose holder died is spent by the next reservation, or by `resume`, at the cost it was allowed, and nothing is refunded. The mechanics are in [containment.md](containment.md).

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

Every move to `blocked_on_decision` carries one of seven reasons, and a reason is accepted on no other move: `decision`, `enforcement_failure`, `budget_exhausted`, `unauthenticated`, `ref_changed`, `ref_deleted`, `access_revoked`. The stages record three of them: `decision`, `enforcement_failure` and `budget_exhausted`.

Stop states, where the supervisor ends without being asked to continue, are `ready_for_review`, `blocked_on_decision`, `failed`, `cancelled` and `closed`. The states `resume` continues from are `contract_ready`, `running`, `verifying` and `paused`.

Which states the code reaches:

- Entered by `start` or a stage: `contract_ready`, `running`, `verifying`, `ready_for_review`, `blocked_on_decision`.
- `paused` is entered only by the resume reconcile, and always left again by it.
- Never entered by any stage, command or adapter: `waiting_external`, `awaiting_review`, `failed`, `cancelled`, `closed`. Their edges exist in the table only. The edges out of `blocked_on_decision` are not driven either: no command answers a decision, so a blocked run is final in practice (see Quirks).
- The reasons `unauthenticated`, `ref_changed`, `ref_deleted` and `access_revoked` are never recorded.

A step of a run (a named piece of work, such as the workspace preparation or one launch) has one of six statuses: `started`, `completed`, `failed`, `interrupted`, `reconciled`, `skipped`. A step is recorded per name and attempt, and a later write for the same name and attempt replaces the earlier one. A run writes `interrupted` (the resume reap) and `skipped` (a dependency install with nothing to install) besides the usual three; `reconciled` is accepted by the ledger and never written for a run.

The single work item has six states: `ready`, `delegated`, `implemented`, `gated`, `done`, `blocked_on_decision`. It moves `ready` to `delegated` to `implemented` to `gated` to `done`. A delegated item goes back to `ready` when its attempt is discarded. Any state but `done` may move to `blocked_on_decision`, which is how a block ends the item; a committed (`done`) item stays done. A run with any number of work items other than one stops with an internal error.

Every stage commits a checkpoint naming the action it is about to run before the action's side effect. Every transition commits the new state, a checkpoint and an event in one transaction. `status` shows the latest named action as what was about to happen. The actions, in order, are as follows: for `contract_ready`, `prepare-workspace`, `configure-gsd`, `install-deps`, `validate-checks`, `baseline` and `verify-enforcement`; for `running`, `context-pack`, `launch:run`, `classify`, `discard-attempt`, `gate:g2` and `commit`; for `verifying`, `verify:checks`, `gate:g4` and `handoff:fetch`; and `reconcile` for `paused`.

A run writes events as it goes. There is a creation event, then one event per transition and one per checkpoint. The invocation events are `invocation.finished`, `invocation.reaped`, `invocation.interrupted` and `invocation.orphan-charged`. The run also writes `verification.interrupted`, `loop.limit`, `handoff.fetched` and `containment.finding`. [checks-and-evidence.md](checks-and-evidence.md) describes the check, evidence, gate and attempt events. The kinds and their payloads are listed in [data-model.md](data-model.md).

## Supervisor and lease

The supervisor holds a lease on the run. It is the run counterpart of the onboarding stage loop and uses the same lease rules, so [onboarding.md](onboarding.md) owns the detail. A lease is taken only when free or past its expiry, and every take bumps a fence. Every checkpoint and transition carries the fence. The holder renews every third of the lifetime from a timer that does not keep the process alive. The default lifetime is 180 seconds, shortened only by the test-only environment variable listed in [config-reference.md](config-reference.md). A failed renewal ends the loop at its next check, and it also aborts the unit in flight. The host's process group is ended within the adapter's grace and the invocation stays charged. The supervisor stops with a conflict error before it judges the unit, so `supervise` exits 3 as it does for a lease another supervisor holds. Nothing is classified, discarded or retried under a lease the supervisor no longer holds; the next holder's resume reconciles the attempt. The lease is released on every exit. A run already in a stop state takes no lease.

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

### The unit (`running`)

One unit is one invocation of GSD's quick workflow in validate mode, in the contained agent host, per attempt. The stage runs these actions in order.

**Context pack.** AVARICE queries the intel and graph indexes with the brief's title and keeps a pack of at most 4000 tokens. The step records references, freshness, sizes and a digest, never text. The pack is data: the prompt wraps it as untrusted context.

**Launch.** The item goes `ready` to `delegated`. A snapshot of the clone is taken, so only what the unit changes counts and not the configure step's file. Then the prompt is built as one quoted `/gsd-quick --validate --text` argument. In a run with one item it holds the title, the behavior and every acceptance criterion of the brief. In a run with several items each unit is told about its own item only. Its prompt holds the item's line (the ID and title), the behavior paragraphs labelled for the item plus the unlabelled ones, and the acceptance criteria the item owns. It holds neither the run's title nor another item's labelled paragraph or criteria. Paragraphs are separated by blank lines, and a paragraph is labelled for an item when its first line starts with `Item <id>:` or `Work item <id>:` for the ID of an item of the brief. A behavior that labels no paragraph is given whole to every item, so the prompt never hides text it cannot attribute. Every prompt then holds the exclusions, the paths the unit may edit or create, the records it may write and the commands it may run. After the commands it states the shell rules the hook enforces: one plain command per call, the forms that are refused, and paths written relative to the repository root. It lists the read-only commands the hook admits beside the run's own commands, and names the Read, Grep and Glob tools for reading and searching. The quick workflow's own shell steps are outside the run's command list: its gsd-tools queries, its `mkdir` steps and its git steps that change the repository. The prompt tells the unit not to run them and not to stop because of them. The unit chooses the task directory under the quick-task path, creates files with the file tools, and starts the planner, plan checker, executor and verifier with the agent tool. The prompt then names the records the run's gates read in that directory: a plan, a SUMMARY and a VERIFICATION file. Skipping the workflow's own steps removes the ones that name those files, so without this line the unit picks its own. The host may refuse a subagent that writes a report file such as a SUMMARY. The unit is therefore told to have the executor and the verifier return their findings as text, and to write the SUMMARY and the VERIFICATION itself from them. The VERIFICATION opens with a fenced frontmatter block of exactly three lines: a `---` line, then a `status:` line of `passed`, `gaps_found` or `human_needed`, then a `---` line. The prompt says that a file that does not begin that way counts as `gaps_found`. A task with no VERIFICATION file fails gate G2 with the verification status read as missing. It also holds an instruction to run the whole workflow and an instruction that the supervisor commits. The prompt is at most 32 KiB. The context pack is cut from its end to fit and says so. The brief text is never cut, and a brief whose own text does not fit blocks with a decision (class `acceptance`) before any launch. The agent definitions the invocation may start (planner, plan checker, executor, verifier) are built from GSD's agent files into a generated agents file. A definition that asks for a permission mode or hooks has them stripped. Each of the four agents also gets a closing note with the same shell rules, because a subagent's refused call counts toward the same invocation's denial limit. The executor alone gets an added sentence telling it not to run `git add` or `git commit`. These notes are advice, and the hook and the moved-HEAD check are the enforcement.

Before the host starts, a budget reservation is made. If the invocations, wall clock or cost budget is spent, the run blocks with `budget_exhausted` and the host is never called. The invocation gets the contract's wall clock or what is left of it, whichever is smaller.

**Classification.** The host's own outcome kind is not read for the verdict. In practice the host often reports `denied` for a unit that did its work, because the model improvises compound shell lines. The verdict comes from facts AVARICE measured. They are whether a result was printed, `is_error`, the exit code, the signal and the timeout. They also include the denials (host and hook), the clone HEAD before and after, and whether a quick SUMMARY exists. The last three are how many in-scope paths changed since the snapshot, a structural pause signal, and a loop-limit stop recorded by the hook. A result with no details, no result event or no boolean `is_error` is never a success. The first rule that applies decides:

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

A pause signal is a waiting file (`WAITING.json`) among the changes, a VERIFICATION status of `human_needed`, or a final text ending in a question followed by numbered choices. The Claude host hands no final text to the supervisor, so for it only the waiting file and the VERIFICATION status signal a pause. An in-scope path is a changed path that is not an artifact, not protected, and matches the write or create globs.

**A numbered choice that belongs to another item.** In a run with several items, a unit may end its final text with the numbered choice of another item, for instance when the brief lists that item's options and the unit asks them. Such a choice is attributed to the other item, and is not the unit's own pause, only when every one of these holds:

- The signal is the numbered-choice shape. A waiting file, a VERIFICATION status of `human_needed` and a STATE that needs a human are never attributed.
- The unit's own work is verified: the VERIFICATION status is `passed`, a quick SUMMARY exists, at least one in-scope path changed, and the unit would be `progressed` without the choice.
- Every choice line equals an option of one other item, after the number, backticks and quotation marks (straight or typographic) are removed, whitespace is collapsed, the text is lowercased and one final full stop is dropped. No line equals an option of the unit's own item, of a second item or of a paragraph no item is labelled for.
- The other item owns a choice: one of its criteria names a decision reference, or it has an open decision.

An item's options are the numbered lines of its labelled behavior paragraphs, the numbered lines of its criteria that name a decision reference, and the labels of its open decisions. The unit's own side also counts the options of its own decisions in any state. When any condition cannot be established, the unit pauses as before. That covers options that match no item, two items or only some of the lines, options that sit in an unlabelled paragraph, a unit that is not verified, a run with one item, and every structural signal. An attributed unit is classified as if no pause signal were present, so it goes through the gates and the commit like any other `progressed` unit. Its classify step records the item the choice was attributed to, the signal, and for a choice that was not attributed the reason, and never the text of the question. The attribution opens, answers and withdraws no decision. The other item's decision comes from the other item's own unit.

The GSD records of the unit under `.planning/quick/` are read for three facts. The first is the VERIFICATION `status:` line: an absent record is `missing`, and one that is too large, not a regular file or has an unknown status is `gaps_found`. The `status:` line counts only inside a block fenced by `---` lines at the start of the record: a record whose first line is a bare `status: passed`, or whose status line sits in the body, has no status and reads as `gaps_found`, so gate G2 fails it. The second is the number of overrides the unit applied. The third is the number of node-repair PRUNE entries in its records. Records are read as data, at most 64 KiB each. A model-written status can fail a gate and can never pass one.

**Routing.** Only `progressed` goes on to the gate, and a unit stopped by a loop limit is escalated whatever else it did; it is never gated or committed.

| Ending | Outcome |
|---|---|
| Clone HEAD moved | Blocked: `enforcement_failure`, class `permission`, with a containment finding. No recovery touches the clone. |
| Loop limit (consecutive denials or searches), unless the budget ran out | Blocked: `decision`, class `repeated_failure`. |
| `budget_exhausted` | Blocked: `budget_exhausted`, class `permission`, naming the spent budgets. This is routed before the loop limit, because a spent budget denies every later call and so causes it. |
| `paused` | Blocked: `decision`, class `acceptance`, the issue being the unit's own question stored as data. |
| `denied` | Blocked: `decision`, class `permission`. |
| `no_progress` | Blocked: `decision`, class `repeated_failure`. |
| Crashed or timed out (`inconclusive`, or `failed` with a signal, a non-zero exit or no result), HEAD not moved, no host refusal | Discard and retry once (below). |
| Any other `failed` (an error result with exit 0) | Blocked: `decision`, class `repeated_failure`. |
| The host refused to launch (unavailable or denied) | Blocked: `enforcement_failure`, class `permission`. |

### Discard and the one retry

A crashed or wall-clock-killed unit with no moved HEAD is discarded and tried once more. The retry is the second and last attempt. Before the discard, if the invocations budget cannot cover another unit (counting the killed one's reservation), the run blocks with `budget_exhausted` (class `permission`) instead. The discard checkpoints first, so a supervisor with a stale fence cannot reach it. It then puts the clone back to the snapshot taken right before the launch, limited to the paths the unit changed after it. A file that was in the clone before the snapshot is restored to that version and not to HEAD. Ignored paths are never touched, and nothing is deleted recursively. An added path is removed only as a file or link, never through a symlink. The step records what was restored, removed and left, with the side effect `none`. A unit has no network, no push and no change request, so there is no external effect to roll back. That claim is recorded with its basis so that a later delivery capability must re-check it. If the clone HEAD moved by then, the discard is refused with nothing changed, and the run blocks with `enforcement_failure`.

A supervisor superseded after the discard's checkpoint still restores the clone and records the `discard` step and the attempt's end, which take no fence. Its work item move then fails on the fence, and the run and the item stay as they were. The next supervisor's resume repeats the discard, which finds nothing left to restore, and retries once. The repeated discard replaces the step record, so the final record lists nothing restored or removed.

The attempt ends `discarded`, the item goes back to `ready`, and the retry attempt runs from the launch action with a rebuilt context pack. A second crash or timeout blocks with `decision`, class `repeated_failure`, naming both attempts and how each ended. A unit that progressed, paused, was denied or made no progress is never retried, and neither is one the host refused to launch.

### Gate G2 and the commit

A `progressed` unit's item moves to `implemented` and is judged by gate G2 over facts AVARICE measured. G2 holds the unit to the contract's scope (write, create, delete and protected globs) and to a GSD verification status of `passed`. It also requires no new override, no PRUNE entry and no weakened test inventory, and no required or targeted check regressing against the baseline. The rules and their order are in [checks-and-evidence.md](checks-and-evidence.md). The required checks run on the working tree only when every other rule already passes, so changed code of a unit that is already stopped is not run. A required check that failed at the baseline and fails again is flagged pre-existing and does not block. A target check that does not pass always blocks.

A failed G2 records its gate row and blocks the run before any commit:

| Rules that failed | Outcome |
|---|---|
| Scope or deletion scope (alone or with others) | `enforcement_failure`, class `permission`, with a containment finding listing at most ten paths. |
| Only the checks delta | `decision`, class `repeated_failure`, with the failing evidence attached. |
| Anything else | `decision`, class `acceptance`. |

A passing G2 moves the item to `gated` and the supervisor commits:

1. Every changed artifact record (the unit's quick records) is archived into the artifact store, up to 2 MiB each, kept for the life of the run.
2. Every artifact path is restored to HEAD, or removed when HEAD does not have it, so the clone keeps the in-scope change and nothing else. The GSD records of the unit never reach the review branch.
3. The in-scope paths are committed, and only those. The commit uses the fixed identity `AVARICE <avarice@localhost.invalid>`, is unsigned and skips hooks. Its subject is the brief title (whitespace collapsed, at most 72 characters, `AVARICE run change` when empty), and it carries the trailers `Avarice-Run: <runId>` and `Avarice-Attempt: <attemptId>`. The model never writes git metadata.
4. The `commit` step is recorded, the item is `done` and the run moves to `verifying` with the revision `git:<sha>`.

A path that G2 let through but that is neither in scope nor an artifact stops the supervisor with an internal error rather than a block.

### Final proof and hand-off (`verifying`)

The final proof runs on the committed, clean revision, at the commit and not on a working tree.

1. Every required check and every brief target check runs sandboxed at the commit, one evidence row each. The GSD verifier's verdict is stored too, as model-review evidence that can never satisfy an acceptance criterion. A `diff:<path> unchanged` reference is deterministic evidence AVARICE derives by comparing the commit with the onboarded revision; any other `diff:` rule produces none and so satisfies nothing. A `test:<text>` reference is satisfied by a test ID containing the text in the passed after-unit inventory, when the checks that run the tests passed.
2. Gate G4 is the independent final proof. It passes only for one clean committed revision. No required check may block against the baseline, and every acceptance criterion must map to passed deterministic evidence. There must be no stale or inconclusive required evidence, and the diff against the onboarded revision must be clean: every changed path is in contract scope and none is an artifact or protected. There must be no open decision and no budget over its limit. A failed G4 blocks the run with `decision`, class `repeated_failure`. There is no repair item and no second attempt.
3. Hand-off fetch: the run branch is fetched into the source repository as one new local branch `avarice/<runId>`. It is create-only and never forced: an existing equal ref is success with nothing fetched, and a different one is a conflict (blocked: `decision`, class `scope_expansion`, the ref left as it is). It checks nothing out, runs with object checking on because the objects come from a tree an agent wrote into, and verifies that the ref ended at the verified commit. The step and a `handoff.fetched` event are then recorded, the attempt ends `handed-off`, and the run moves to `ready_for_review`. The user's working tree, index and every other ref are untouched.

The run moves to `ready_for_review` only after a passed G4 row for exactly the handed-off commit is in the ledger. A check that was already failing at the baseline is named in the hand-off, never hidden behind a green result.

## Decisions

Every block routed through the block step opens one decision record (the enforcement check does not; see Quirks), moves the item to `blocked_on_decision`, ends the open attempt as blocked, and moves the run. The record has one of four classes: `acceptance`, `permission`, `repeated_failure`, `scope_expansion`. It carries the issue in AVARICE's own words or the model's text stored as data. Control, zero-width and bidirectional characters are removed from that text, and it is cut to 1000 characters. The record has no options and urgency `blocking`. It also holds the contract version, a digest of the contract version, base revision and policy revision, and references to the evidence that failed. A breach of containment first writes a `containment.finding` event with the check name and at most ten paths, never model text. A blocked run never produces a branch.

## Resume and reconcile

`resume <run_id>` continues a run; a `run_` prefix selects it over an onboarding. Before spawning anything it checks that no live lease is held. Otherwise it exits 3, changes nothing and says the lease must expire first. It prints the state and next action it resumes from and the interrupted step. When an attempt was open, it also names that attempt. A run in a stop state, or in any state `resume` does not continue, is only reported. No lease is taken, and the exit is 0 at `ready_for_review` and 3 otherwise. A run blocked on a decision is continued, not only reported, when an answer made an item ready or left no decision open and no live lease is held. In the other cases it spawns the detached supervisor as `start` does and records a `supervisor:resume` step. Before it spawns, it checks that the host configuration directory the run recorded at start is still a readable directory. When it is missing, is not a directory or cannot be read, `resume` exits 3 naming the directory, writes nothing and spawns nothing; `decide` refuses an open decision of the run the same way and leaves it open. The supervisor runs the host under the recorded directory, not under the environment of the command, so a resume finds the session a paused item left wherever the owner answers or resumes from. Without that, the host reports an unknown session, the resume attempt is discarded and a fresh unit starts, and both calls are charged. With `--wait` it follows the run for at most 24 hours. It exits 0 at `ready_for_review`, 3 at any other stop state or when the supervisor died again, and 70 when the supervisor could not reconcile.

The supervisor always runs a prelude under the lease before its loop:

1. Reap: every launch step left `started` is a host that may still be running (it is detached and outlives a killed supervisor). It is ended by the session ID its step recorded, and every reap completes before any row is marked or anything is read from the clone. A reap that fails stops the resume with every row still `started`. So does a started launch that cannot be reaped at all, because its step records no session ID or because the host cannot reap; the failed reconcile step names which. The steps are then marked `interrupted` and an event names each interrupted invocation.
2. Spend: every reservation held by the dead supervisor is spent now, whatever the run does next.
3. Reconcile by state.
   - `running`, item in flight: when the item is `delegated`, the run makes a real ledger transition to `paused` (event data reason `interrupted`) around the reconcile and then returns to `running`. A `gated` item is reconciled without the pause.
     - An attempt that was delegated is read as `inconclusive`: it is recorded as such, the clone goes back to the attempt's snapshot, and the item is retried once. An attempt with no launch step ran nothing and does not use the retry. If a second attempt is interrupted, the one chance is spent and the run blocks with `decision`, class `repeated_failure`. If the invocations budget cannot cover a retry, the run blocks with `budget_exhausted`.
     - A clone HEAD that moved under a delegated item is a breach: `enforcement_failure`, a containment finding, no discard.
     - A gated item whose HEAD moved is the supervisor's own commit only when two things hold. The HEAD message carries this run's ID and the open attempt's ID in its `Avarice-Run` and `Avarice-Attempt` trailers, and the commit has exactly one parent, the open attempt's snapshot head. Then the `commit` step is recorded with it and no second commit is made. Any other moved HEAD blocks as above, including a commit that carries the trailers but sits on another parent.
   - `verifying`: the reconcile makes a real ledger transition to `paused`, which `status` shows as `paused (verification interrupted)`. The required checks of the interrupted final pass that never finished get `inconclusive` evidence (insert-only; what the pass did record stays). Then the run goes back to `verifying`, at the hand-off when G4 already passed for this very commit and at the checks otherwise. The mid-hand-off kill point sits between the fetch and its record. A resume therefore repeats the fetch, which is idempotent, and finds the ref already there.
   - `paused`: a previous reconcile paused the run and was killed before it put it back; the item's state says which way back.
   - `contract_ready`: nothing to reap; the stage repeats the actions whose step is not recorded.
4. The stage loop continues from the committed state.

A prelude failure is recorded as a failed `resume:reconcile` step and ends the supervisor; `resume --wait` then exits 70 with that detail, not a second "interrupted". The record presents the supervisor's fence. A supervisor that another one superseded therefore records no failed reconcile step, so a later `resume --wait` does not read its refusal as one.

Nothing is claimed that was not measured. An interrupted invocation is `inconclusive`, and the budgets it was charged stay charged.

## Status and inbox

`status` and `inbox` read run state from the ledger and change nothing: no lease, no model, no transcript. Run values are IDs, states, statuses, revisions and counts, and the inbox adds the decision issue (AVARICE's own words or the unit's question stored as data), the run title and the repository path. The `runs` array of `status --json` and `inbox --json` have the shapes owned by [cli-reference.md](cli-reference.md).

A run is interrupted when its state is one of the four resumable ones and no lease is live. It is presented as `paused (verification interrupted)` when the ledger state is `verifying` and `paused (supervisor interrupted)` otherwise. The line names the open attempt, the step that was in flight (the checkpoint action, or a step begun after the last checkpoint) and the command that continues it. The ledger state itself is unchanged until the resume. Interrupted runs sort first, then runs blocked on a decision.

The inbox lists open decisions (blocking before digest) and runs waiting for review, with their branch and the handed-off commit.

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
- A run has exactly one work item, and the contract compiler always makes it. There is no repair item: a failing required check ends the run in a decision.
- A blocked run is final in practice. No command answers or closes a decision, and `resume` only reports a `blocked_on_decision` run. The states and edges that would continue, review or close a run exist in the lifecycle table but nothing drives them, so `ready_for_review` and `blocked_on_decision` are where a run ends.
- A block at the enforcement check opens no decision record, so the inbox shows nothing for it; the run's state and reason are the only trace. Every other block opens one.
- `start` has ten refusal codes, and most errors are not refusals. A bad brief, a failed G0 and an invalid budget are usage errors (exit 64). An invalid conventions file is the refusal `conventions-invalid` (exit 3).
- The run's first attempt is opened by the baseline, before the unit exists.
- The brief's `expectedDecisions` is stored and read by nothing. The classifier has a pause signal for a STATE file that needs a human, and nothing supplies it.
- A path that G2 allowed but the commit cannot place stops the supervisor with an internal error, not a decision.
- The conventions file read by a run (schema 1 with `checks`, `paths.write`, `testInventory`, `dependencies` and `agentCommands`) refuses keys that the onboarding activation reader lists (`paths.read`, `paths.generated`, `commands`, `verificationByChangeType`). One file valid for one reader can therefore fail the other.
- An operator's SIGTERM ends the supervisor at once and does not abort the unit in flight. The unit's host keeps running, with no wall clock enforced, until it exits or the next resume reaps it by session ID.
- The supervisor has no console. Closing the shell, killing `start --wait` or losing the terminal leaves it running; the ledger and `status` are the only record.
- Retry accounting counts launched attempts. An attempt that never launched is invisible to the one-retry rule and to the attempt list in a second failure's decision.
