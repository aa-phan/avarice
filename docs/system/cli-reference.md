# CLI reference

This document describes the command-line surface in `src/cli/` (entry `bin/avarice.ts`) and the read models behind `status` and `inbox` (`src/app/status.ts`, `src/app/run-status.ts`). It also covers the start service behind `start` (`src/app/run-start.ts`) and the services behind the owner commands (`src/app/amend.ts`, `src/app/decide.ts`, `src/app/cancel.ts`, `src/app/digest.ts`). The LaunchAgent writer behind `schedule` (`src/adapters/schedule/launchd.ts`) and the skill file that `install-host` writes (`src/adapters/host-claude/avarice-run-skill.ts`, `src/adapters/host-claude/skill-install.ts`) complete the set. The `context`, `onboard` and `resume` sections defer to [indexes-and-context.md](indexes-and-context.md), [onboarding.md](onboarding.md) and [runs.md](runs.md) for their mechanics, and the owner commands defer to [autonomy-and-decisions.md](autonomy-and-decisions.md) and [runs.md](runs.md). It covers fifteen commands, a bare `avarice` that may open the interactive shell, one exit-code convention and one argument parser shared by all commands.

## Summary

- Commands: `init`, `repo add`, `onboard`, `start`, `supervise`, `status`, `inbox`, `resume`, `context`, `install-host`, `contract` (the one subcommand `amend`), `decide`, `digest`, `schedule` (the subcommands `install` and `remove`) and `cancel`. Bare `avarice` opens the interactive shell on a terminal and is a usage error elsewhere. Any other word is a usage error.
- Owner commands: `contract amend`, `decide`, `cancel`, `schedule install` and `schedule remove` need a person at a terminal. They refuse inside a run, without a terminal on standard input and output, and from the process tree of a run, before the profile is resolved (see [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule)). `digest` needs no terminal, so launchd can run it, and refuses only inside a run.
- Exit codes: `0` success, `3` the command ran correctly but the answer is "not active, not ready, refused, held, not applied or unavailable", `64` usage error, `70` internal failure.
- Streams: results go to stdout; every error and every warning goes to stderr, except the unreadable-run line of `start --wait` and `resume --wait`, which goes to stdout (see Quirks). Only `status`, `inbox` and `context` have a `--json` form. All three print pretty-printed JSON (two-space indent) and a trailing newline.
- Leases: `onboard`, `supervise` and the onboarding path of `resume` take a lease and run stages in their own process. `start`, `decide` and the run path of `resume` start a detached `supervise` process, which takes the lease. `cancel` takes the run lease for at most 60 seconds when no supervisor holds it.
- Read-only commands: `status`, `inbox` and `context` write no project, onboarding, run, adapter or lease rows. See "Order of checks and profile side effects" for what every command creates.
- Network: the CLI layer opens no network connection, and `status`, `inbox` and `context` are offline. `onboard` and the supervisor that `start`, `decide` and `resume` spawn may launch the contained agent host, whose behavior belongs to [containment.md](containment.md). `digest` and `schedule` run local tools (`osascript`, `launchctl`, `plutil`; see [integrations.md](integrations.md)) and nothing else. The supervisor also posts a banner through `osascript` when a run stops.

The PreToolUse hook entry is not a user command; it runs inside the agent host and is described in [containment.md](containment.md). What each run command does to a run is described in [runs.md](runs.md). This document owns the command lines, flags, output and exit codes.

## Global behavior

### Dispatch

| Invocation | Result | Exit |
|---|---|---|
| `avarice --help` or `avarice -h` (first word only) | usage text on stdout | 0 |
| `avarice` with no words, standard input and output both terminals, `AVARICE_RUN` unset | the interactive shell opens; its keys, views and exit codes belong to [interactive-shell.md](interactive-shell.md) | the shell's |
| `avarice` with no words in any other case (a stream is not a terminal, or `AVARICE_RUN` is set) | `avarice: no command given` plus usage text on stderr | 64 |
| `avarice <name>` where name is not one of the fifteen | `avarice: unknown command '<name>'` plus usage text on stderr | 64 |
| A listed command whose module is missing from the build | `avarice <name>: not available in this build` plus usage text on stderr | 64 |
| A command module that fails to load for another reason | `avarice <name>: cannot load: <message>` on stderr | 70 |
| A command module that exports no entry point | `avarice <name>: the command module does not export run()` on stderr | 70 |

Only the fifteen listed names are ever loaded, so a path-like name is an unknown command. `--help` and `-h` are recognised only as the first word. `avarice --help` with more words behind it still prints usage and exits 0. After a command name they are not special. `init -h` is rejected as an unexpected argument, and `status --help` is accepted and ignored.

The shell condition is checked only when there are no words at all. `avarice --json` or any other word never opens the shell. The shell module is loaded only on that path. The shell refuses again when `AVARICE_RUN` is set (exit 64, `the interactive shell does not open inside a run`).

The usage text lists the command names only; it carries no per-command help. Per-command usage lines appear on stderr with a usage error.

### Argument parsing

All commands share one parser. Its rules are the contract:

- A word starting with `--` and longer than two characters is a flag. Everything else is a positional, including single-dash words such as `-h` or `-x`. There are no short flags.
- `--flag=value` attaches a value, and the value may be empty.
- `--flag value` consumes the next word as the value unless that word starts with `--`, or the flag is declared boolean by the command. A flag with no value is the boolean `true`. A value may start with a single dash (`--budget -5` consumes `-5`).
- `--` ends flag parsing; every later word is positional.
- A flag given more than once keeps the last value. Three flags additionally use every occurrence: `--budget` (`onboard`, `start` and `contract amend`), and `--add-write` and `--check` (`contract amend`).
- Unknown flags are accepted silently and ignored. A misspelt flag is therefore not an error, except for `schedule`, which refuses every flag.
- The boolean flags are declared per command: `--json` for `status`, `inbox` and `context`; `--wait` for `start`, `resume`, `decide` and `cancel`; none for the others. A flag that a command does not declare boolean consumes the following word unless that word starts with `--`. So `--json` on `init`, `repo add`, `onboard`, `start`, `supervise`, `resume`, `install-host`, `contract`, `decide`, `digest`, `schedule` or `cancel`, and `--wait` on any other command, are unknown flags. A value that starts with a single `+` or `-` is a value, which is how `--check +name` and `--check -name` work.

### Order of checks and profile side effects

For every command that passes dispatch, the work runs in this order. It parses arguments, then runs the command's own usage check if it has one. It then resolves and prepares the profile and opens the ledger, and last it runs the command.

`init`, `repo add`, `start`, `supervise`, `inbox`, `install-host`, `context`, `contract`, `decide`, `digest`, `schedule` and `cancel` have a usage check, so a malformed command line exits 64 before anything is created. The usage checks of `install-host` and `digest` also refuse a run environment. Those of `contract amend`, `decide`, `schedule` and `cancel` also refuse a run environment, a missing terminal and a run's process tree. Those refusals create nothing either.

`onboard` and `resume` check their arguments inside the command, after the profile is prepared. A usage error from either can therefore leave a freshly created profile behind. `status` has no usage check and ignores extra words.

Checks that depend on the ledger or the repository (an unknown run, an invalid brief, a budget override the contract rules reject) run after the profile is prepared. Their exit-64 errors can therefore follow profile creation.

Preparing the profile (every command, including `status`, `inbox` and `context`):

- Roots: config home, data root and work root come from `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT` and `AVARICE_WORK_ROOT`. The only profile is `personal-local`, and the default data and work roots carry its name. Defaults and overrides are in [config-reference.md](config-reference.md).
- Placement is judged for the data root and the work root only; the config home is not checked. Either root is refused when it lies under a `~/.claude*` directory or under `CLAUDE_CONFIG_DIR`, or when it would contain the home or Claude configuration directory. Refusal also follows when the two roots are nested, or when the data root is not on local storage (or its mount cannot be determined). The refusal is exit 70 with the reason on stderr.
- Missing directories are created with mode 0700; a missing profile `config.json` is created with mode 0600 and never overwritten.
- The ledger (`state.db` in the data root) is created and migrated when absent or behind. A read-only command opens an already current ledger read-only. If the ledger is absent or has pending migrations, it is created or migrated first and then reopened read-only.
- A command that is not read-only (`init`, `repo add`, `onboard`, `start`, `supervise`, `resume`, `install-host`, `contract`, `decide`, `digest`, `schedule`, `cancel`) also records the executor, graph, GSD (when located) and agent-host adapter descriptors. The ledger holds them. `status` and `inbox` record none. `context` records none and locates GSD only to read the indexes.
- Failure of any of these steps is exit 70 with a message of the form `avarice <command>: <what>: <reason>`.

### Output style

Every command prints through one shared style. The first stdout line of a command that has a result is `<subject>: <state>`, with ` (<reason>)` appended when a reason exists, for example `run run_...: blocked_on_decision (decision)`. Errors are `avarice <command>: <message>`, or `avarice: <message>` before a command is chosen; the command may carry its subcommand (`avarice repo add: ...`). A line that names a command to run next has the form `continue with: <command>`, `next: <command>` or `run: <command>`.

Every recorded or repository-derived string that a text form prints has control and escape characters removed first. These are terminal escape sequences, control characters other than newline and tab, and invisible formatting characters. The invisible set is the bidirectional overrides, embeddings, isolates, the left-to-right, right-to-left and Arabic letter marks, the zero-width characters, the word joiner and the byte order mark. The soft hyphen is kept. The `--json` forms print values as stored and apply no such stripping.

Tables are aligned columns with a header row. A row is cut to the terminal width with an ellipsis, except columns that hold the subject of the row (IDs, states), which are never cut, so a table may overflow the terminal instead. The width is the terminal's column count, or 100 when stdout is not a terminal. Money prints as `N.NN USD`.

### Exit codes

| Code | Meaning | Used by |
|---|---|---|
| 0 | The command did what was asked. For `onboard` and the onboarding path of `resume`, the project is active. For `start`, the run is stored and its supervisor started (with `--wait`, the run reached `ready_for_review`). For `supervise` and the run path of `resume`, the run is in `ready_for_review`. | all |
| 3 | A valid request with no positive result: onboarding stopped without activating, a repository or a start was refused, the run stopped anywhere but `ready_for_review`, another process holds the lease, an install target was refused, `context` has nothing it can query, an amendment or an answer was not applied for the state of the run or the decision, a run had already ended when `cancel` was asked, or `schedule` refused to touch a file | `repo add`, `onboard`, `start`, `supervise`, `resume`, `context`, `install-host`, `contract`, `decide`, `schedule`, `cancel` |
| 64 | Usage error, an unknown run, decision or onboarding ID (`resume`, `supervise`, `contract`, `decide`, `cancel`), an invalid brief or budget override (`start`), an invalid amendment flag, a path that is not a repository (`repo add`, `onboard`), several active projects without `--project` (`context`), `install-host` or `digest` inside a run, or an owner command run inside a run, without a terminal or from a run's process tree | dispatch, `init`, `repo add`, `onboard`, `start`, `supervise`, `inbox`, `resume`, `context`, `install-host`, `contract`, `decide`, `digest`, `schedule`, `cancel` |
| 70 | Internal failure: profile, store or adapter failure, an unexpected exception, a supervisor that could not be started, a banner that was not delivered (`digest`), a tool that failed (`schedule`) | all |

`status` returns only 0 and 70. `inbox` returns 0, 64 (a positional argument) and 70. `digest` returns 0, 64 and 70. An uncaught exception inside a command is caught by dispatch, printed as `avarice <name>: failed: <message>` and returned as 70. The store is closed on every path. An exception thrown by a usage check or while preparing the profile is outside that handler (see [unknowns.md](unknowns.md)).

## init

`avarice init [--profile personal-local]`

Reports the resolved profile. It is the first-run path, and it is idempotent: a second run changes nothing.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--profile` | string | `personal-local` | Any other value is a usage error (64) naming the only accepted profile. A bare `--profile` with no value also fails, since the value is `true`. |
| positionals | none | | Any positional is a usage error (`unexpected argument`). |

Output (stdout, no `--json` form): a result line, `profile personal-local: initialized` when this run created the ledger and `profile personal-local: already initialized` otherwise. "Initialized" means a ledger migration was applied after this process started. Then one `label: value` line each: `config` (path of the profile `config.json`), `data root`, `work root`, `schema version` (read from the ledger; `unknown (...)` when it cannot be read). Last, a note that the ledger uses an experimental Node SQLite and that AVARICE refuses a runtime lacking the WAL-reset fix.

Warnings go to stderr and the exit stays 0. A line is printed for each of the config home, the data root and the work root whose group or other permission bits are set. It reads `avarice init: warning: <dir> has mode NNNN and is accessible to other users; run: chmod 700 '<dir>'`.

Exit: 0, 64 (usage), 70 (profile or store failure, including a refusal of the runtime or root placement).

Side effects: creates the profile directories, `config.json` and the migrated ledger when absent, and records adapter descriptors. Takes no lease. Not read-only.

## repo add

`avarice repo add <path>`

Registers a repository and records what preflight found, leaving an onboarding in state `discovered`. It stages nothing, runs no agent and takes no lease; `onboard` continues the same onboarding.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `add` | literal first positional | required | Missing or any other subcommand is a usage error. |
| `<path>` | string | required | Exactly one path after `add`. A path that cannot be inspected as a repository is a usage error (64). Relative paths resolve against the working directory. |

Registration uses fixed settings: policy `onboarding`, mapping mode `full`, promotion `none`, no budget overrides. There are no flags.

Behavior when the repository is already known (same root commit and path):

- An active project record exists: refused, exit 3, stderr `avarice repo add: refused: conflict: ...` naming `existing_state_conflict`, followed by the line `run: avarice status`.
- Another onboarding is past `discovered` and not stopped: refused the same way (exit 3); the message names the onboarding and the `avarice resume <id>` command.
- An onboarding still in `discovered` exists: it is reused, no second project or onboarding is created, and its stored request is not changed.
- Otherwise a new onboarding is created, on the existing project when one is registered for this root commit and path, else on a new project.

A path that is not a repository prints the error and then a line `run: ` followed by the command that prints the repository's top-level directory for that path. The path is quoted when it holds characters outside a plain set.

Output (stdout), in order, lines with no content omitted:

- `project <id>: registered` and `onboarding <id>: <state>`.
- `repository <root>`; `pin <commit>` with the branch name or `(detached HEAD)`; `tracked files N, M bytes`.
- Whether a `.planning/` directory exists and the classification of any existing codebase map, with a note when adoption is deferred and the map is regenerated in staging.
- Only when non-empty: lists of instruction files, workspace manifests, ADR directories, runtimes, submodules, nested repositories, and files not mapped (uncommitted or untracked, names only). Each list is cut at 1000 entries in the record.
- The last line, `next: avarice onboard --policy onboarding <path>`, with the path as typed.

Repository-derived text is printed on one line each, so a file name holding a newline cannot add lines. There is no `--json` form.

Exit: 0, 3 (refused), 64 (usage, or not a repository), 70 (internal).

Side effects: writes project and onboarding rows to the ledger (nothing in the repository, nothing under the work root). Takes no lease. Not read-only.

## onboard

`avarice onboard --policy onboarding [--mode full|fast] [--promote none] [--budget name=value]... <repo>`

Registers the repository (as `repo add` does), then runs the onboarding stages under a lease until the onboarding reaches a stop state, and prints where it ended. The stages are described in [onboarding.md](onboarding.md).

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--policy` | string | none | Required, and must equal `onboarding`; anything else, including absence, is a usage error (64). |
| `--mode` | `full` or `fast` | `full` | Any other value, or no value, is a usage error. |
| `--promote` | string | `none` | A bare `--promote` is a usage error. Any value other than `none` is refused with exit 64 at registration (a continued onboarding is refused too), before any new row, contract or staging exists. |
| `--budget` | `name=value`, repeatable | none | Each occurrence must match a letter-led alphanumeric name, `=`, and a finite number; otherwise 64. A bare `--budget` is a usage error. For a repeated name the last wins. Whether the name exists and whether the value is a permitted lowering is decided later by the contract compiler (see quirks). |
| `<repo>` | path | required | Exactly one positional. |

Checks run in the order `--policy`, `--promote` shape, `--mode`, path count, `--budget` shape. Because the command has no pre-profile usage check, these errors exit 64 after the profile is prepared. A usage error prints `avarice onboard: <message>` and the usage line on stderr.

Registration refusals mirror `repo add`: an active record or another in-flight onboarding of the same repository is refused with exit 3 (stderr `avarice onboard: refused: ...`). A non-repository path or a refused promotion is exit 64; other failures are 70.

Output (stdout, no `--json` form): `onboarding <id>: <state>` with ` (<reason>)` appended when the onboarding has a blocked reason. Then, when the stages left an explanation, one line with that message (for example why GSD was incompatible or why a contract was refused). Reasons are `enforcement_failure`, `budget_exhausted`, `existing_state_conflict`, `scope_unavailable`, `adapter_incompatible` and `decision`.

Exit: 0 when the final state is `active`. Exit 3 when it ends in any other state (blocked, incompatible, or an in-progress state the loop cannot advance). Exit 64 is usage. Exit 70 is a failed run (stderr `avarice onboard: onboarding <id> did not finish: ...`), including a lease already held by another process running the same `discovered` onboarding and a lease lost mid-run.

Side effects: registers the project and onboarding. Takes the lease on the onboarding (default lifetime 180 seconds, override `AVARICE_LEASE_TTL_MS`, see [config-reference.md](config-reference.md); renewed every third of the lifetime while stages run, released on exit). Creates a staging copy under the work root, runs the GSD mapping through the contained agent host, builds the code graph, intel and knowledge indexes in staging, and on success writes the active project record. The user's checkout is not modified. When GSD is missing or not admitted, the onboarding stops `incompatible` rather than failing; when the host cannot enforce containment, it ends `blocked` with reason `enforcement_failure`. Not read-only, not offline.

## start

`avarice start --brief <file> --policy routine [--project <id>] [--budget name=value]... [--wait]`

Authorizes one run of one brief against an onboarded repository and hands it to a detached supervisor. Running the command is the authorization: it asks nothing and reads no input. The run flow, the contract and the supervisor are described in [runs.md](runs.md).

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--brief` | file path | required | Absent, bare or empty is a usage error (64). The file must be a regular file of at most 65536 bytes, valid UTF-8, and a valid brief; a relative path is resolved against the working directory. Any failure is exit 64 naming the field or the reason. |
| `--policy` | string | none | Required, and must equal `routine`; absence, a bare flag or any other value is a usage error (64). |
| `--project` | project ID | the registered project whose repository contains the working directory | Bare or empty is a usage error. An unknown ID is the refusal `no-project` (exit 3). |
| `--budget` | `name=value`, repeatable | none | Shape checked as for `onboard` (usage error 64 otherwise). Whether the name exists and whether the value is a permitted lowering is decided when the contract is compiled; a violation is exit 64 and nothing is created. |
| `--wait` | boolean | off | Boolean; never consumes a following word. Follows the run to where it stops. |
| positionals | none | | Any positional is a usage error. |

The shape checks run before the profile is prepared. The checks that follow run in this order, and a failure creates nothing. They are the policy, an admitted GSD installation, the brief file and its parse, the project, the active record, the repository preflight, and the contract compile with its static checks.

Refusals (exit 3, stderr `avarice start: refused: <message>`, nothing created). Ten rules refuse a start. The message differs per rule; the rule's code is not printed.

| Code | Refused when |
|---|---|
| `gsd-not-admitted` | No admitted GSD installation was found. Judged before the brief is read. |
| `no-project` | The working directory is in no registered repository, or `--project` names an unknown project. |
| `no-active-record` | The project has no active project record. |
| `revision-mismatch` | The brief names a base revision that is not the onboarded revision. |
| `not-descendant` | The source repository's HEAD does not descend from the onboarded revision, or that revision is no longer in the repository. |
| `stale-commits` | More than 25 commits past the onboarded revision outside `.avarice/` and `.planning/`. |
| `stale-age` | The oldest such commit is more than 14 days old. |
| `no-conventions` | `.avarice/config.json` is not at the onboarded revision or at a later commit that changes only `.avarice/`. |
| `no-planning` | The onboarded revision has no `.planning/ROADMAP.md`. |
| `conventions-invalid` | `.avarice/config.json` was found but does not parse or validate. |

Usage failures (exit 64, stderr `avarice start: <message>`) are: any failed argument check above; a brief that cannot be read, is too large, is not UTF-8 or does not validate; and a compile failure. A compile failure includes a `--budget` the contract rules reject and a failed static check on the contract (G0). Failures of the run source, the ledger, the data root or the supervisor spawn are exit 70 (`avarice start: failed: ...`).

Output (stdout, no `--json` form). One summary, printed before the supervisor is spawned:

```
run <id>: contract_ready
project: <id> (<repository path>)
base revision: <commit>
conventions revision: <commit>
title: <title>
acceptance: N criterion|criteria
write paths: <globs, or none>
required checks: <names, or none>
budgets: X USD per run, Y USD per invocation; N min, N invocations, N tool calls
index: <note>
item <id>: <size>, <model>; depends on <ids>; files <list>; symbols <list>
contract: <preset> v<version> <digest>
stored at: <path of the contract file under the data root>
```

The `index:` line says whether the onboarded indexes helped to derive the items' specs. It takes one of these forms:

- `index: used (N files, M symbols)`, with `1 file` and `1 symbol` in the singular.
- `index: used, but nothing in it names these files or symbols`.
- `index: not used (absent)`, `index: not used (stale)` or `index: not used (unreadable)`.
- `index: not queried (no item names a file or a symbol)`.

An index never blocks a start. There is one `item` line per work item. It gives the size and the model (marked `(derived)` for a size the compiler chose and `(from size)` for a model that follows from the size). It then gives the items it depends on when it has any, and the spec's files and symbols, at most four each followed by `and N more`. A list that AVARICE derived from the item's text and the indexes is marked `(derived)`. The derivation is described in [runs.md](runs.md#the-contract).

Before it spawns the supervisor, the command records the host configuration directory it runs under as the step `host:config-dir`. That directory is the value of `CLAUDE_CONFIG_DIR` when it is set and not empty, otherwise `.claude` in the home directory, made absolute and resolved to its real path when it exists. The step holds the directory and where it came from (`CLAUDE_CONFIG_DIR` or `default`). The host keeps its sessions, its skills and the GSD installation in that directory and looks for a session nowhere else. Every supervisor of the run is therefore started later with the recorded directory as its `CLAUDE_CONFIG_DIR`, whichever terminal answers a decision or resumes the run. A step that cannot be recorded is exit 70 (`run <id> is stored but its host configuration directory could not be recorded: ...`) and no supervisor is started.

Without `--wait`, the command spawns the supervisor, records its process ID as the step `supervisor:spawn` and exits 0. The supervisor runs in its own process group with its streams ignored and the data root as working directory, so closing the shell or killing `start` leaves it running. It receives the three profile roots the command resolved and otherwise the command's environment.

With `--wait`, the command then polls the ledger every 250 milliseconds, for at most the contract's wall-clock minutes plus 15 minutes, and prints one result block after the summary:

| Ended with | Stdout | Exit |
|---|---|---|
| The run reached `ready_for_review` | `run <id>: ready_for_review` | 0 |
| Any other stop state (`blocked_on_decision`, `failed`, `cancelled`, `closed`) | `run <id>: <state> (<reason>)` | 3 |
| The supervisor is gone, no lease is live and the run is unfinished | `run <id>: interrupted in <state> (next: <action>)`, then `continue with: avarice resume <id>` | 3 |
| The wait budget ran out while the supervisor was still working | `run <id>: <state>`, then `still running: avarice status shows it; the supervisor keeps working` | 3 |
| The run could not be read | the error line, on stdout | 70 |

The spawn is refused when the CLI entry script is not an absolute path that exists. The error is exit 70 (`run <id> is stored but its supervisor was not started: ...`). The summary is already printed, and the run stays stored in `contract_ready`. A spawn whose step cannot be recorded is also exit 70.

Exit: 0 the run is stored and the supervisor started (with `--wait`, `ready_for_review`); 3 refused, or with `--wait` any other ending; 64 usage; 70 internal.

Side effects: writes the run, its first contract version, its budget rows and one work item row for each item of the brief in one transaction. Writes the contract file (mode 0600) under the data root, records the steps `start:preflight`, `host:config-dir` and `supervisor:spawn`, and starts a process. Takes no lease itself. Not read-only, not offline: the spawned supervisor may launch the contained host.

## supervise

`avarice supervise <runId>`

The supervisor of one run. `start` and `resume` spawn it detached; an operator can also run it by hand to continue a run. It takes the run lease, always runs the reconcile prelude first, runs the checkpointed stages until the run stops, and releases the lease. The prelude, the stages and the lease are described in [runs.md](runs.md).

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<runId>` | string | required | Exactly one non-empty positional, otherwise usage error (64). An unknown run is also 64. |

There are no flags and no `--json` form.

Output (stdout): `run <id>: <state>` with ` (<reason>)` when the run has one, then one line with the supervisor's last note when it left one. A run already in a stop state takes no lease and is only reported.

When the run stops, the supervisor tries to raise a banner through the local notifier (`osascript`; see [autonomy-and-decisions.md](autonomy-and-decisions.md#notification)). A banner that fails to deliver is recorded in the ledger and changes nothing. When no banner can be attempted at all, for example because the profile settings cannot be read, the command prints `avarice supervise: no notification raised for run <id>: <reason>` on stderr. The exit code is unchanged.

A run that recorded a host configuration directory at start is supervised only under that directory. When the directory this process would run the host under (by the rule `start` records) differs from the recorded one, the command exits 70 before it takes the lease or writes anything. It prints `avarice supervise: run <id> was started under the host configuration directory <recorded>, but this process runs the host under <effective>; ...`. `start`, `decide` and `resume` start the supervisor with the recorded directory, so they never produce the difference; it arises when an operator runs `supervise` by hand from another environment. A run without the recorded step is not checked.

Exit: 0 when the run is `ready_for_review`. 3 for any other stop state, a state with no stage, or a lease another supervisor still holds (`run <id> is held by another supervisor; its lease must expire first`). 64 usage or no such run. 70 failure (`run <id> did not finish: ...`), including a prelude that could not complete, and a host configuration directory that differs from the recorded one.

Side effects: as the run flow it drives, including the contained agent host and the banner `osascript` posts at a stop. Takes the lease (default lifetime 180 seconds, override `AVARICE_LEASE_TTL_MS`, see [config-reference.md](config-reference.md)). Not read-only, not offline.

## status

`avarice status [--json]`

Shows every registered project with its latest onboarding and active record, then the runs of every project. Read-only, offline, takes no lease.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--json` | boolean | off | Boolean; never consumes a following word. |

There is no usage check: extra positionals and unknown flags are ignored.

Human output: a first line `status: N project(s)`. With none, it is followed by `No projects registered. Add one with: avarice repo add <path>`. Otherwise:

- A table with the columns `PROJECT`, `REPOSITORY` (cut from its start when too long), `ACTIVITY` (`not onboarded`, `onboarding` or `interrupted`), `STATE` and `NEXT`. `STATE` is the ledger state with the reason in parentheses. For an interrupted onboarding it is the state it stopped in. `NEXT` is the checkpoint's next action for an interrupted onboarding and `-` otherwise.
- Per project, in table order: `onboarding <id>: <state>`, which for an interrupted one reads `<state> (interrupted)`. An interrupted one also gets `continue with: avarice resume <id>`. When an active record exists, the project gets `record vN at <revision>; mapping <mode> (<completeness>, <freshness>); indexes: <list>`. The list holds the indexes the record lists (`graph, intel`), absent ones as `graph absent (<reason>)`, or `none`.
- When any project has runs: `runs: N`, a table with `RUN`, `STATE` and `TITLE`, and one detail block per run (below). The runs of all projects are listed together: interrupted first, then those blocked on a decision, then the rest in creation order.

A run's detail block starts with its result line (`run <id>: <state>` with the reason). The following lines are indented by two spaces, and those with no content are omitted:

- For an interrupted run: `interrupted attempt <attempt> at <step>` (or `interrupted at <step>` when no attempt was open) and `continue with: avarice resume <id>`.
- `cancel requested (<local time>, <relative time>)` while an owner's cancel request stands and the run has not ended.
- `last checkpoint: <next action> (<local time>, <relative time>)`.
- `branch <name> at <short commit>` with `(clean)` or `(not clean)` once handed off, or `branch <name> (not handed off)`.
- `evidence: <name> <status>, ...`, with `(pre-existing)` for a check that already failed at the base. After the measured entries come `<name> not run: not required` entries, one for each declared check that is neither required nor a target of the brief, which the run never runs (see [checks-and-evidence.md](checks-and-evidence.md#required-checks-and-target-checks)). `evidence: none` appears only when there is neither kind.
- `gates: <gate> passed|failed, ...` or `gates: none`.
- One `item <id>  <state>  [decision <id>  ]size <size>, model <model>, after <ids or none>, N attempt(s)` line per work item. An item that an open decision names first carries that decision's ID.
- `decisions: N open (see avarice inbox)`, then one `decision <id>  <class>  <state>[  items <ids>][  replaced by <id>][  replaces <id>]` line per decision of the run in any state.
- `notifications: N delivered, N pending, N held, N failed (<code>)`: only the delivery states that hold at least one banner, and the code of the latest delivery that did not arrive. When a pending or held banner carries an error and none failed, the line ends `last error <code>`. The line is absent when the run has raised no banner. A failed banner never hides or closes a decision.
- `budget: <name> <used> of <limit>; ...`: cost, invocations, tool calls, subagents and wall clock in that order, then any other name.
- `references: <kind> <id> at <12 characters of the revision>; ...`.

An onboarding counts as interrupted when its state is a pre-activation, non-stopped state and its lease is absent or expired. A live lease, or a stopped state, never shows as interrupted.

A run counts as interrupted when its ledger state is `contract_ready`, `running`, `verifying` or `paused` and its lease is absent or expired. This is presentation: the run row keeps its ledger state. `status` shows the run as `paused`, with the reason `verification interrupted` when the state is `verifying` and `supervisor interrupted` otherwise. A run whose ledger state really is `paused` is shown the same way.

JSON output: an array, one object per project, in ledger order; `[]` when there are none.

| Field | Type | Meaning |
|---|---|---|
| `projectId` | string | Project ID. |
| `repoPath` | string | Repository root as registered. |
| `onboardingId` | string or null | Latest onboarding; null when none. |
| `state` | string | State of the latest onboarding; `unregistered` when none. |
| `reason` | string or null | Blocked reason of the latest onboarding. |
| `interrupted` | object, optional | Present only when interrupted: `state`, `nextAction` (from the latest checkpoint, `unknown` when none), `resumeCommand`. |
| `recordVersion` | number or null | Active record version. |
| `onboardedRevision` | string or null | Revision the record was built at. |
| `mapping` | object or null | The record's mapping block, passed through as stored. |
| `indexes` | object | The record's indexes block as stored, `{}` when no record. |
| `runs` | array, optional | The project's runs. Present only when the project has at least one run, and always the last key; a project with no run has no `runs` key. Interrupted runs first, then those blocked on a decision, then the rest in creation order. |

Each element of `runs`:

| Field | Type | Meaning |
|---|---|---|
| `runId` | string | Run ID. |
| `title` | string | The work item's title, free text from the brief. |
| `state` | string | The ledger state; an interrupted run keeps its real state here. |
| `reason` | string or null | Blocked reason: `decision`, `enforcement_failure`, `budget_exhausted`, `unauthenticated`, `ref_changed`, `ref_deleted` or `access_revoked`. |
| `lastCheckpoint` | object or null | The latest checkpoint that names an action (the closing `none` checkpoint of a stop state is skipped): `seq`, `nextAction`, `revision` (string or null), `at` (ISO time). When every checkpoint is a closing `none`, the latest of them. Null when there is no checkpoint. |
| `branch` | string or null | The run's branch name. |
| `commit` | string or null | The commit handed to the source repository; null until the hand-off. |
| `clean` | boolean or null | Whether every final evidence row was taken on a clean tree; null without evidence. |
| `evidence` | array | One entry per check, the latest taken at the final phase, else the latest: `name`, `kind`, `status`, `revision`, `clean`, and `preExisting` (true) only when the check already failed at the base. Only checks appear. |
| `gates` | array | The latest result per gate, sorted by gate name: `gate`, `passed`, `revision`. |
| `openDecisions` | number | Open decisions of the run. |
| `budgets` | array | `name`, `used`, `limit`. |
| `references` | array | What the run was started from: `kind`, `id`, `revision`. The brief's requirement references come first, then the repository conventions (`kind` `conventions`, the conventions file as `id`). |
| `interrupted` | object, optional | Present only when interrupted (above): `state` (the ledger state), `presentedAs` (always `paused`), `reason` (`verification interrupted` or `supervisor interrupted`), `attemptId` (string or null), `step`, `nextAction`, `resumeCommand`. |
| `items` | array | One entry per work item: `itemId`, `state`, `size`, `model`, `dependsOn` (array of item IDs), `attempts` (number of times it was delegated). |
| `decisions` | array | One entry per decision of the run in any state: `decisionId`, `class`, `state`, `affectedItems` (array), `supersedes` (the decision it re-opened, or null) and `successor` (the decision that re-opened it, or null). |
| `notifications` | object | The run's banners by delivery state: `delivered`, `pending`, `held`, `failed` (counts) and `lastError` (the short code of the latest banner that did not arrive, or null). |
| `cancelRequestedAt` | string, optional | ISO time of the owner's cancel request. Present only while the request stands on a run that has not ended. |
| `checksNotRun` | array, optional | The last key of the entry. Present only when a declared check is neither required nor a target of the brief: each entry is `name` and `reason`, and the reason is always `not required`. |

The fields `title`, `branch`, the check, gate and budget names, the item IDs, sizes and models, and the reference `id` are free text or repository-derived. The rest are IDs, states, revisions, booleans and counts.

Exit: 0, or 70 when the ledger cannot be read.

## inbox

`avarice inbox [--json]`

Lists the open decisions of runs and the runs that wait for a review. Read-only, offline, takes no lease. It is the record of what waits: a banner that did not arrive changes nothing here. A decision is answered with [`decide`](#decide), or with [`contract amend`](#contract-amend) when it offers only `withdraw` and names an amend command.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--json` | boolean | off | Boolean; never consumes a following word. |
| positionals | none | | Any positional is a usage error (64): `inbox takes no argument`. |

Unknown flags are ignored.

Human output: `inbox: N open decision(s), M review(s)`, in the singular for one. Nothing follows when both are zero. When there are decisions, the output is `decisions:` and a table with `DECISION`, `RUN`, `CLASS`, `URGENCY` and `OPENED` (local time with a relative form). Then comes one block per decision. It starts with `issue <decision id>: <text>`, the text flattened to one line and cut to the terminal width. Indented by two spaces below it come `items: <ids>` (the items the decision holds up), one `option <key>: <label>` line per option and `answer with: <command>`. When a banner was raised for the decision, one banner line follows. The command is `avarice decide <id> <option-key>`, or the stored amend command (or `avarice decide <id> withdraw` when it holds none) for a decision whose only option is `withdraw`. The banner line is `banner delivered`, `banner held for the next digest`, `banner pending`, or `banner not delivered (<code>); this list is the record`. When there are reviews: `reviews:` and a table with `RUN`, `BRANCH`, `COMMIT` (seven characters, `-` when not handed off) and `REPOSITORY`. Under the table, one `checks <run id>: <name> not run: not required, ...` line per review whose run left a declared check unrun, because it is neither required nor a target.

JSON output: an object with two arrays.

| Field | Type | Meaning |
|---|---|---|
| `decisions` | array | Each open decision of a run: `decisionId`, `runId`, `class`, `urgency` (`blocking` or `digest`), `openedAt` (ISO time), `issue` (free text, model-derived), then `items` (array of item IDs the decision holds up), `options` (array of `key`, `label` and `kind`, which is `choice`, `text` or `withdraw`), `command` (the command that answers it) and, only when a banner was raised for it, `notification`. Blocking before digest, otherwise in the order the ledger returns them. |
| `decisions[].notification` | object, optional | `state` (`pending`, `held`, `delivered` or `failed`; a failed delivery outranks a held or pending one, and those outrank a delivered one), `attempts` (number) and `lastError` (a short code, only when the state is not `delivered` and a delivery failed). |
| `reviews` | array | Each run in `ready_for_review` or `awaiting_review`: `runId`, `title` (free text), `branch` (string or null), `commit` (the handed-off commit, string or null), `repository` (the project's path) and, as the last key, `checksNotRun`. |
| `reviews[].checksNotRun` | array, optional | Present only when a declared check is neither required nor a target of the brief: each entry is `name` and `reason`, and the reason is always `not required`. |

Exit: 0, 64 for a positional, 70 when the ledger cannot be read.

## resume

`avarice resume <onboardingId | runId> [--wait]`

Continues an interrupted onboarding or run from its committed state. An ID that starts with `run_` takes the run path; any other ID takes the onboarding path.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<id>` | string | required | Exactly one non-empty positional, otherwise usage error (64). An unknown ID is also 64. |
| `--wait` | boolean | off | Boolean. Used only by the run path; on the onboarding path it is accepted and ignored. |

There is no `--json` form.

### Onboarding path

- If the onboarding is already in a stop state (`active`, `blocked`, `incompatible`, `deactivated`), nothing runs and no lease is taken: it prints the state and exits 0 for `active`, otherwise 3.
- Otherwise it takes the lease, and only when the previous holder's lease has expired; a live lease held by another process is exit 3 with `held by another process; its lease must expire first`. Of several concurrent resumes, one proceeds and the rest exit 3.
- Under the lease, before any stage, the resume ends every agent process the previous holder left running, then decides from the staging output whether an interrupted mapping finished. If a process cannot be found or ended, the resume exits 70 rather than relaunch beside it. The mechanics are in [onboarding.md](onboarding.md).
- The stage loop then runs as in `onboard`.

Output (stdout): `onboarding <id>: <state>` with ` (<reason>)`, then the explanatory message line when one exists.

Exit: 0 active; 3 stopped without activating, or lease held; 64 usage or unknown ID; 70 failure (`avarice resume: onboarding <id> did not finish: ...`).

Side effects: as `onboard` after registration; also appends `invocation.reaped` and `invocation.reconciled` events when it reaps or reconciles. Not read-only.

### Run path

- A run in a stop state, or in a state `resume` does not continue (`waiting_external`, `awaiting_review`), is only reported: `run <id>: <state>` with the reason, no lease, nothing changed. Exit 0 for `ready_for_review`, otherwise 3. The one stop state that is continued is a run blocked on a decision whose answer made an item ready (or left no decision open). It takes the path below. `decide` starts no supervisor while a live lease is held, and a supervisor that died holding it would otherwise leave the answer waiting for nobody.
- A run whose lease is held by a live supervisor is refused with exit 3 (`run <id> is held by another supervisor; its lease must expire first`), nothing changed.
- A run the command would hand to a supervisor is refused with exit 3 when the host configuration directory recorded at start is missing, is not a directory or cannot be read. The message is `avarice resume: not applied: the run's host configuration directory <dir>, recorded when it started, is missing; restore it, or run this from an environment where it exists`. The other two forms read `is not a directory` and `is unreadable`. Nothing is written and no supervisor starts. A run without the recorded step is never refused. The supervisor the command starts runs the host under the recorded directory, not under the environment of the command.
- Otherwise the command prints `run <id>: resuming from <state>`, with ` (next: <action>)` when a checkpoint exists. When a step was in flight it then prints `interrupted attempt <attempt> at <step>` (or `interrupted at <step>`).
- It then spawns a detached supervisor exactly as `start` does and records the step `supervisor:resume`. The supervisor takes the lease, reaps what the dead supervisor left running, reconciles and goes on. Without `--wait` the command then exits 0.

With `--wait` the command polls every 250 milliseconds for at most 24 hours and prints the same result block as `start --wait`. A blocked run is already in a stop state when its supervisor starts, so the wait first lets the supervisor take the run up. The exit codes are the same. Exit 0 is `ready_for_review`. Exit 3 is any other stop state, an interrupted supervisor or the wait bound. Exit 70 is a run that cannot be read. One case differs. The supervisor can stop because its own reconcile failed, through a failed reap or a reconcile that could not read the repository. The command then prints `avarice resume: run <id> could not be resumed: <reason>` on stderr, prints no result block, and exits 70. A reconcile failure is told from a second death by a new failed reconcile step on the run.

Exit: 0 `ready_for_review`, or the supervisor was spawned without `--wait`. 3 stopped elsewhere, lease held, the recorded host configuration directory unusable, or the wait ended unfinished. 64 usage or no such run. 70 failure, including a supervisor that could not be started or whose spawn step could not be recorded (`run <id> was not resumed: ...`).

Side effects: starts a process and records the step `supervisor:resume`; the supervisor does the rest. Not read-only.

## context

`avarice context <term> [--project <id>] [--budget <tokens>] [--json]`

Asks the active project record's indexes (intel first, then the graph) for a term, through GSD's own readers, and prints each item with its source path, revision and freshness. Read-only, offline, takes no lease, writes nothing. Retrieval is described in [indexes-and-context.md](indexes-and-context.md).

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<term>` | string | required | All positionals are joined with single spaces and trimmed; empty is a usage error. Quote or not, the result is the same. |
| `--project` | project ID | the only project with an active record | Bare or empty is a usage error. An unknown ID is exit 3. With several active projects and no `--project`, exit 64 listing the candidates. |
| `--budget` | integer tokens | 4000 | Must match a positive decimal integer of at most six digits with no sign and no leading zero, and be at most 100000; otherwise 64. A token is estimated as four characters. |
| `--json` | boolean | off | Boolean; never consumes a following word. |

Selection: intel may use at most half of the budget, rounded up, and the graph may use the rest, so the graph is always asked. Within a source, entries are taken in the source's order while they fit; one that does not fit is left out whole (and listed as omitted), and a smaller later one may still fit. An entry already returned by the other source is skipped. An index is skipped, with a note, when the record does not list it, when no source is configured, when the budget is already spent, or when the index cannot answer or be read.

Human output starts with a header line with the term, repository, project ID and record version and revision. Then come `budget N tokens, used about M` and, when nothing matched, `no index entry matches`. Each item has a numbered line `[source] title`, a line with source path, revision, freshness, optional confidence and estimated tokens, and the excerpt. A `left out for the budget:` list follows, then one `note:` line per note. Control, zero-width and bidirectional characters are replaced by spaces and lines are cut at 400 characters. Text that came from a document, or from a model reading one, is wrapped in a fence of the form `--- begin untrusted data ... ---`. Every content line is prefixed by `| `, so it cannot close the fence. Its title is not printed outside the fence.

JSON output (object; the text sanitising above does not apply, values are as the index returned them):

| Field | Type | Meaning |
|---|---|---|
| `term` | string | The joined term. |
| `budget` | number | Budget in force. |
| `usedTokens` | number | Estimated tokens of the picked entries. |
| `project` | object | `projectId`, `repoPath`, `recordVersion`, `onboardedRevision`. |
| `items` | array | Each: `source` (`gsd-intel` or `gsd-graph`), `ref`, `title`, `excerpt`, `estTokens`, `reason`, `freshness`; optional `confidence` (`EXTRACTED`, `INFERRED`, `AMBIGUOUS`), `untrusted` (true), `confirmed` (boolean, whether a cited path is at the repository's current HEAD). |
| `items[].ref` | object | `provider`, `kind` (`intel-entry` or `graph-node`), `id`, optional `revision`, `retrievedAt` (RFC 3339 UTC), `scope` (repository path), `freshness`. |
| `omitted` | array | `source`, `id`, `title`, `estTokens` for entries left out for the budget. |
| `notes` | array of strings | Why an index gave nothing. |

`freshness` is one of `fresh`, `stale`, `changed`, `deleted`, `access_revoked`, `unavailable`.

Exit: 0 on an answer, including `no index entry matches` and an answer where an index added only a note. 3 when there is no active project record (stderr tells you to onboard first), the project is unknown, no admitted GSD is available to read the indexes, or the staging copy cannot be read. 64 usage (including the several-projects case). 70 internal.

## install-host

`avarice install-host [--config-dir <dir>]`

Writes one skill, `avarice-run`, into a Claude Code configuration directory so that attended sessions know how to work on a repository AVARICE manages. It is the only place AVARICE writes under a Claude configuration directory, and it writes one file.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--config-dir` | directory | the `CLAUDE_CONFIG_DIR` environment variable when set and non-empty, else `~/.claude` | Bare or empty is a usage error (64). The value is resolved to an absolute path. The flag wins over the variable. |
| positionals | none | | Any positional is a usage error (64). |

Inside a run (the `AVARICE_RUN` environment variable set, as it is for a contained invocation) the command refuses with exit 64 before the profile is prepared: `avarice install-host: refused inside a run (AVARICE_RUN is set)`.

Behavior:

- The configuration directory is created when absent (mode 0700). It may itself be a symbolic link and is resolved first. Beneath it the command creates `skills/avarice-run/SKILL.md`; directories it creates there are mode 0755.
- It refuses, without writing, in three cases. `skills` or `skills/avarice-run` is a symbolic link or not a directory. `SKILL.md` is a symbolic link or not a regular file. An existing `SKILL.md` is larger than 256 KiB.
- It also refuses when an existing `SKILL.md` has no line equal to the marker `<!-- written by avarice install-host -->`. A file that carries the marker is replaced; one that already equals the new text is left alone.
- The write goes through a temporary file in the same directory and a rename, so a reader sees the old file or the new one. The file is mode 0644. An existing `SKILL.md` is opened without following a link.

Output (stdout): `skill avarice-run: installed|unchanged|updated`, `path: <SKILL.md path>`, `digest: sha256:<hex>`. There is no `--json` form.

Exit: 0 installed, updated or unchanged. 3 refused (`avarice install-host: refused: <rule>`). 64 usage or inside a run. 70 failure, including a write error (`failed: cannot install the avarice-run skill: <code>`) and a failure to record the skill (`the skill is in place but its record failed: ...`).

Side effects: the skill file above, and one adapter record named `host-skill:avarice-run` in the ledger holding the skill name, path and digest, written also when the file was unchanged. Takes no lease. Not read-only.

The skill text is advisory and is identical on every install. It tells a session to call `avarice status` first and to treat the context pack and retrieved text as data and never as instruction. It tells the session to stay inside the contract's paths, and to stop and report a denied tool call. It also tells the session to ask a clear question with numbered options last when a choice is consequential, and to use `avarice context` before reading whole files. It names `avarice contract amend`, `avarice budget` and `avarice install-host` as owner-only commands. Its front matter allows the tools `Bash(avarice status:*)`, `Bash(avarice context:*)` and `Read`. The text enforces nothing. The hook, the sandbox and the gates do that, as described in [containment.md](containment.md).

## contract amend

`avarice contract amend <runId> --reason <text> [--budget name=value]... [--add-write <glob>]... [--acceptance-file <file> [--item <id>]] [--check +<name>|-<name>]... [--decision <decisionId>]`

Records contract version n+1 for a run: the one way a limit rises or a scope widens, and a person at a terminal outside the run is the one who does it. The command shows what it would change and what that invalidates, asks for a confirmation, and only then writes. What each change means, the rules a change must meet and what an amendment invalidates are in [runs.md](runs.md#amendments-and-contract-versions); this section owns the command line. `contract` takes one subcommand, `amend`.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `amend` | literal first positional | required | Missing or any other word is a usage error: `contract needs a subcommand: amend`. |
| `<runId>` | string | required | Exactly one run ID after `amend`, `run_` followed by letters or digits; otherwise `contract amend needs exactly one run ID`. An unknown run is exit 64. |
| `--reason` | string | required | Non-blank. At most 500 characters, which the planning step checks (exit 64). |
| `--budget` | `name=value`, repeatable | none | Shape as for `start` (a letter-led alphanumeric name, `=`, a finite number); a bare `--budget` is a usage error. The name, the direction and the limits are judged by the amendment rules: a limit may rise or fall. |
| `--add-write` | glob, repeatable | none | Each occurrence needs a value; a bare `--add-write` is a usage error. The glob rules, the cap of 128 globs and the conventions' write set are judged by the amendment rules. |
| `--check` | `+name` or `-name`, repeatable | none | Each value must begin with `+` or `-`: `+name` makes a declared check required, `-name` makes it not required. A bare `--check` is a usage error. `+name` also adds the check's command to the agent's list. |
| `--acceptance-file` | file path | none | A non-empty path, read relative to the working directory. A regular file of at most 65536 bytes, valid UTF-8, in the brief's criterion syntax. Read after the profile is prepared, so an unreadable file is exit 64. |
| `--item` | work item ID | none | Only with `--acceptance-file`. Names the item that owns a new criterion; the amendment rules require it when the run has more than one item. |
| `--decision` | decision ID | none | `dec_` followed by letters or digits. An open `repeated_failure`, `permission`, `budget` or `scope_expansion` decision of the same run, which this amendment then answers. |

At least one of `--budget`, `--add-write`, `--check` and `--acceptance-file` is required, otherwise `nothing to amend: name a budget, a write glob, a check or an acceptance file`. Every shape check above runs before the profile is prepared, with the terminal checks first (see [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule); each is a usage error, exit 64). The command records the owner as `owner:<operating system user>`. It does not check that the user owns the profile; the ledger's refusal of a store owned by another user stands behind it.

Output (stdout), one item per line with control characters removed:

```
run <id>: amending contract v<n> to v<n+1>
<path>: <from> -> <to>            (a changed value, both shown as JSON)
<path>: +<added> -<removed>       (a changed list)
invalidates: <classes, or nothing>
stale gates: <gates>              (only when some)
stale evidence: <evidence IDs>    (only when some)
answers decision <id> as amended:v<n+1>    (only with --decision)
```

It then asks `apply contract v<n+1>? [y/N] ` through the shell's prompt when run from the shell, and as one line from standard input otherwise. `y` or `yes`, in any case, applies it. Any other answer, an empty line or end of input prints `not amended` and exits 0, with nothing written. On apply it prints `contract v<n+1> recorded`, then `appended N stale evidence row(s) and M stale gate row(s)` when either count is above zero. It then prints `decision <id> answered amended:v<n+1>` when `--decision` was given, and exits 0. The invalidation classes are `gates`, `acceptance-mappings`, `checks-rerun`, `scope-conformance`, `check-evidence` and `approvals`.

Failures print `avarice contract: <message>`. An invalid flag value, a rule the amendment breaks, an unknown run, or a `--decision` that is not a decision of the run is exit 64. A run that has failed, been cancelled or been closed, a contract that moved since it was read, and a decision that is no longer open are `not amended: conflict: ...` with exit 3. Nothing is written. Conventions that cannot be read at the contract's revision, and every other failure, are exit 70 (`avarice contract: failed: ...`).

Exit: 0 amended or declined. 3 not amended because of the state of the run, the contract or the decision. 64 usage, a refusal of who runs it, an invalid flag or an unknown run. 70 internal failure.

Side effects: on `y`, one ledger transaction writes the contract version, the changed budget limits, the stale rows and the answer to the decision. The contract file of the new version is written after it. It takes no lease, so it can run beside a supervisor. Not read-only. The `decide` prompt's `amend` entry reaches the same preview and confirmation.

## decide

`avarice decide <decisionId> [<option-key> | --text "<text>"] [--wait]`

Answers a decision of a run as the owner. Given an option key or `--text`, it applies that answer. Given neither, it prints the decision's record and asks for the answer at the terminal. The checks an answer passes, what a stale answer and a withdrawal do, and how the run is picked up afterwards belong to [autonomy-and-decisions.md](autonomy-and-decisions.md); this section owns the command line. `decide` never changes a contract field, a budget or the write scope. A decision that only an amendment can answer is answered with `contract amend`, or with `amend` at the prompt below.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<decisionId>` | string | required | `dec_` followed by 4 to 64 letters or digits; anything else is a usage error (64). |
| `<option-key>` | string | none | 1 to 200 characters. A listed choice key, or `withdraw` where the record lists it. A `text` option is answered with `--text`, never by its key. Not combined with `--text`. |
| `--text` | string | none | Non-empty, and not combined with an option key; a bare `--text` is a usage error. Accepted only for a record that lists a `text` option, and then 1 to 2000 characters with no control character other than tab and line feed. |
| `--wait` | boolean | off | Boolean; never consumes a following word. Follows a supervisor that this command started (see Output). |
| more positionals | none | | A usage error: `give one option key, or --text with the text`. |

The command needs a person at a terminal and refuses anything else, before the profile is resolved, so a refusal creates nothing. The three refusals and their order are in [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule). All three are usage errors (64): `avarice decide: refused inside a run (AVARICE_RUN is set)`, `needs an interactive terminal` and `refused from inside a run's process tree`. Once the profile is open, a data root that is not owned by the user running the command is refused with `only the user who owns the profile answers a decision` (64). Nothing is written.

An open decision whose run recorded a host configuration directory (see `start`) is refused when that directory is missing, is not a directory or cannot be read. Nothing is written. The exit is 3, and the message starts `avarice decide: not applied: the run's host configuration directory <dir>, recorded when it started, is` and gives the reason: missing, not a directory or unreadable. It ends `restore it, or run this from an environment where it exists`. The supervisor this command may start runs the host under that directory, and the paused session lives there. A decision that is not open is not checked this way, and a run without the recorded step is never refused.

### Record and prompt

With no key and no `--text`, `decide` prints the record on stdout, one item per line and cut to the terminal width (80 columns when the width is unknown):

- `decision <id> (<state>)` and `run <id>`;
- `item: <item>`, with `(also affects <items>)` when others depend on it;
- `class: <class>`, and `re-opens: <id>` for a decision that replaced a stale one;
- `question from the unit (data):` and the issue, indented, at most 1000 characters;
- `options:` and one `<key>: <label>` line each, the `text` option marked `(answer with --text "...")`;
- `recommendation: <key>` when the unit marked one;
- `consequences:` and one `<key>: <sentence>` line per option;
- `answered: <answer> (<who>)` once it is answered;
- `amend: <command>`, never cut, for a record that an amendment answers.

Every value passes the control-character strip described under output style. The issue is the unit's own words and is labelled as data.

For an open decision it then asks `answer (<keys>; empty leaves it open): `. The keys are the choice keys, then `withdraw` when the record lists it, `text` when it takes free text and `amend` when it carries an amend command. The answer goes through the same engine as the one-line form.

| Entry | Effect |
|---|---|
| Empty line, or end of input | Prints `left open`, changes nothing, exits 0. |
| `amend` (not a listed key, record carries an amend command) | Records the request and continues as `contract amend` does (below). |
| A listed key, or any entry for a record with no `text` option | Applied as an option key (cut to 200 characters). |
| Any other entry | Applied as free text. |

The `amend` entry prints the amendment preview that `contract amend` prints, pre-filled with the paths or budget values the record measured, and asks `apply contract v<n+1>? [y/N] `. On `y` it writes the amended contract and answers the decision in one step, printing `contract v<n+1> recorded` and `decision <id> answered amended:v<n+1>`, and then picks up the run as below. Anything else prints `not amended` and `left open` and exits 0. A record that measured nothing to pre-fill prints `decision <id> is answered by an amendment, and the record has no measured request to pre-fill` and `amend with: <command>` and exits 3.

When the decision is not open, or no prompt can be shown, the record is printed. The command then ends with `avarice decide: give an option key or --text` and the usage line on stderr (64).

### Output and pick-up

An applied answer prints `decision <id> answered (<key>)`, with `text` in place of the key for free text, or `decision <id> withdrawn`. A line about the run follows:

| Situation | Line | Effect |
|---|---|---|
| A supervisor holds the run's lease | `run <id>: a running supervisor takes item <item> next` (`a running supervisor continues the run` after a withdrawal, or when the decision names no item) | Nothing starts; that supervisor takes the item. |
| The run is blocked, the answer made it continuable and no lease is live | `run <id>: supervisor started` | Starts the detached supervisor as `start` does and records the step `supervisor:decide`. |
| Any other run state | none | Nothing starts. |

With `--wait` after a started supervisor, the command lets the supervisor take the run up and then polls every 250 milliseconds for at most 24 hours, printing the result block of `start --wait`. It exits 0 when the run reaches `ready_for_review`, 3 otherwise, and 70 when the run cannot be read. With a live supervisor already holding the lease there is nothing to follow and the command returns at once. A supervisor that cannot be started is exit 70 (`avarice decide: run <id> was not continued: <reason>`), as is a spawn whose step cannot be recorded.

Answers that apply nothing:

| Case | stdout or stderr | Exit |
|---|---|---|
| The same answer to an answered decision | `decision <id> already answered; ignored` | 0 |
| A key for a record that only an amendment answers | `decision <id> is answered by an amendment, not by an option; nothing was applied`, `amend with: <command>`, `or take it back: avarice decide <id> withdraw` | 3 |
| The state moved since the question was asked | `the run changed since decision <id> was asked (contract v<a> -> v<b>); your answer was not applied`, `decision <new> asks the same question on the new state, with your answer kept as context`, `answer it with: avarice decide <new> <option-key>` | 3 |
| A different answer to an answered decision; a withdrawn, stale or otherwise closed decision | `avarice decide: <reason>` on stderr; a stale decision names its successor | 3 |
| A key that is not listed; free text for a record with no `text` option; free text that is empty, too long or holds a control character | `avarice decide: <reason>` on stderr | 64 |
| The decision or the contract moved while the answer was written, twice | `avarice decide: not applied: conflict: ...` | 3 |
| No such decision | `avarice decide: no such decision (not found: decision <id>)` | 64 |

The version part of the stale line appears only when the contract version changed. A refused answer is recorded as an event naming the run, the decision and the check, and never the text typed.

Exit: 0 answered, withdrawn, identical answer ignored, left open, or declined at the amendment question. 3 an answer not applied for the state of the decision or the run, or a `--wait` that ended anywhere but `ready_for_review`. 64 usage, a refusal of who runs it, an unknown decision, or an option or text the record does not allow. 70 internal failure (`avarice decide: failed: ...`).

Side effects: writes the decision's new state and its events, may write contract version n+1 (the `amend` entry), and may start the detached supervisor. Takes no lease. Not read-only.

## digest

`avarice digest`

The scheduled check-in. When open decisions or runs ready for review exist, it posts one batched banner with the counts and writes one `digest` notification row. When nothing waits, it posts nothing and writes nothing. It also catches up on banners that did not arrive. The notification rules, the covering of earlier rows and the quiet-hours hold are in [autonomy-and-decisions.md](autonomy-and-decisions.md#check-ins). It runs under launchd at the profile's digest times once `schedule install` has been run, and a person can run it by hand. It takes no argument and answers no decision.

| Argument | Type | Default | Validation |
|---|---|---|---|
| positionals | none | | Any positional is a usage error (64): `digest takes no argument, found "<word>"`. |

Flags are ignored. The command needs no terminal. It refuses to run inside a run (`AVARICE_RUN` set) with exit 64, before the profile is resolved. It does not look at the process tree.

Output (stdout): when a banner was delivered, `digest: N decision(s) waiting, M run(s) ready for review`, in the singular for one. When nothing waits, when no destination is configured, and when quiet hours held the banner, it prints nothing and exits 0.

A banner that was not delivered after the last attempt is `avarice digest: the banner was not delivered (<code>); N decision(s) and M run(s) still wait in avarice inbox` on stderr, with exit 70. The code is the short code of the last failed attempt (`osascript-missing`, `osascript-timeout`, `osascript-failed` or `notifier-error`). An unreadable ledger or profile config (a notify key that does not validate) is `avarice digest: failed: <reason>`, also 70. The recorded attempts and the row states are described in [autonomy-and-decisions.md](autonomy-and-decisions.md#notification).

Exit: 0 delivered, held for quiet hours, or nothing to say. 64 an argument, or inside a run. 70 a banner that was not delivered, or a failure to read the ledger or the settings.

Side effects: writes notification rows and their delivery attempts, marks the earlier rows it covers delivered, and runs `osascript` once per attempt for a banner. It changes no decision. Takes no lease. Not read-only.

## schedule

`avarice schedule install`
`avarice schedule remove`

`install` writes one user LaunchAgent that runs `avarice digest` at the profile's digest times, and loads it. `remove` unloads it and deletes the file. launchd keeps the clock, so no AVARICE process waits between digests. The agent is written with no run-at-load and no keep-alive. The command works only for the owner's own profile.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `install` or `remove` | literal | required | Exactly one. Anything else, a second positional, or any flag at all is a usage error: `avarice schedule: usage: avarice schedule install \| remove`. |

The terminal checks of an owner command apply first (see [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule)), then the data-root owner check (`only the user who owns the profile schedules its digest`, 64). The command is refused with exit 64 on a system with no launchd, which is any system that is not macOS: `the digest schedule is a macOS LaunchAgent; this system has no launchd`.

The agent is named `io.avarice.digest.<profile>`, which is `io.avarice.digest.personal-local`, and lives at `~/Library/LaunchAgents/<label>.plist` (mode 0644, in the home directory the profile resolved). Its fixed template holds:

- the label;
- the program: the absolute path of the Node binary that runs the command, any `--disable-warning=<Name>` option of the running process, the real path of the CLI entry script, and the word `digest`. No other Node option is copied;
- an environment of three variables, `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT` and `AVARICE_WORK_ROOT`, set to the roots the command resolved;
- one calendar interval, an hour and a minute, for each of the profile's digest times (`notify.digestTimes`, default `12:30` and `17:30`; see [config-reference.md](config-reference.md#profile-config-file));
- standard output and standard error sent to `logs/digest.log` in the data root.

`install` with no digest time in the profile is exit 64 (`notify.digestTimes in the profile config is empty, so there is no time to run the digest; add at least one HH:MM`). At most six times are accepted. Every value written passes a check: a label of `a-z`, `0-9`, dot and dash after the fixed prefix, absolute paths without control characters, and times of two digits each. Every value is XML-escaped, and the Node binary and the CLI entry must exist as files. A value that fails is exit 64.

`install` writes the file under a temporary name, lints it with `/usr/bin/plutil -lint`, and renames it into place. When the label is already installed it first runs `/bin/launchctl bootout gui/<uid>/<label>`, so running `install` again replaces the agent. It then loads the file with `/bin/launchctl bootstrap gui/<uid> <file>`. It never follows a symbolic link and touches only a file that carries the marker line AVARICE writes. It creates the agents directory (mode 0755) and the log directory (mode 0700) when absent.

Output (stdout): `install` prints `digest schedule installed: <label> at <times>` (or `replaced` for an existing agent) and `log: <path of digest.log>`. `remove` prints `digest schedule removed: <label>`, or `digest schedule not installed: <label>` when there was no agent, which is not an error.

| Case | Stderr | Exit |
|---|---|---|
| The agents directory, the agent file or the log directory is a symbolic link or not the right kind of file; an existing file has no marker line or is over 64 KiB | `avarice schedule: <path> ... so nothing was written` (or `removed`, or `was not written by AVARICE ... left untouched`) | 3 |
| A value is not allowed, or the Node binary or entry does not exist | `avarice schedule: invalid <field>: <reason>` | 64 |
| `plutil` rejects the plist | `avarice schedule: failed: internal error: plutil lint refused the plist (exit N: <first line>); nothing was installed` | 70 |
| `launchctl bootstrap` fails | `... launchctl bootstrap failed (exit N: <first line>); the new file was removed again` (first install) or `the new file is in place but not loaded` (replacement) | 70 |
| `launchctl bootout` fails in `remove` with anything but "not loaded" (exit 3 or 113) | `... launchctl bootout failed (exit N: <first line>); the file was left in place` | 70 |

Each tool runs with an argument list and no shell, a 10 second limit and no input. The first line of the tool's own error, with control characters removed and cut to 160 characters, is quoted.

Exit: 0 done, or already absent. 3 a refusal that wrote nothing. 64 usage, a refusal of who runs it, a value that is not allowed, or no launchd. 70 a tool failed.

Side effects: the plist, the log directory, and a loaded or unloaded launchd job; the only thing AVARICE writes outside the profile roots here is the plist. Not read-only. Takes no lease.

## cancel

`avarice cancel <runId> [--wait]`

Cancels a run in any state that has not ended. The mechanics, including what a supervisor does with the request, are in [runs.md](runs.md#cancel).

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<runId>` | string | required | Exactly one positional, `run_` followed by 4 to 64 letters or digits; otherwise a usage error. An unknown run is exit 64. |
| `--wait` | boolean | off | Boolean; never consumes a following word. Follows a cancel that a supervisor must carry out. |

The terminal checks of an owner command apply first (see [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule)), then the data-root owner check (`only the user who owns the profile cancels a run`, 64).

The request is recorded first. What follows depends on the lease:

| Situation | Stdout | Exit |
|---|---|---|
| No live lease: the command ends the hosts the run left running, withdraws every open decision, ends the open attempt and moves the run to `cancelled` | `run <id>: cancelled; N decision(s) withdrawn` | 0 |
| A supervisor holds the lease: the request is recorded and that supervisor carries it out | `run <id>: cancel requested`, and without `--wait` the command ends | 0 |
| The same, with `--wait` | polls every 200 milliseconds for at most 24 hours, and prints `run <id>: cancelled` | 0 |

With `--wait`, a supervisor that died with the request standing leaves no live lease, so the command finishes the cancel itself, prints `run <id>: cancelled` and exits 0. A run that reaches another end instead prints `run <id>: <state>` and exits 3. When the wait runs out the command prints `avarice cancel: run <id> was still not cancelled after the wait` on stderr and exits 3.

A run that has ended already is `avarice cancel: run <id> is already <state>` with exit 3, and nothing is written. A conflict of any other kind is `not applied: ...` with exit 3. An unknown run is `no run <id> (not found: run <id>)` with exit 64. Any other failure is `run <id> was not cancelled: <reason>` with exit 70. `cancelled` is terminal: `resume` then only reports it.

Exit: 0 cancelled or requested. 3 the run had ended, or a `--wait` that did not reach `cancelled`. 64 usage, a refusal of who runs it, or an unknown run. 70 internal failure.

Side effects: the cancel request on the run row, the withdrawn decisions, the ended attempt and the run's move to `cancelled`, all as ledger rows. With no live lease it takes the run lease for at most 60 seconds, and it reaps a host the earlier supervisor left running by its session ID. The run clone, its branch and the user's checkout are not touched. Not read-only.

## Quirks

- A command named read-only still prepares the profile and may create and migrate the ledger on a first run; it writes no project, onboarding, run or adapter rows.
- Unknown flags never fail. `onboard --polcy onboarding repo` fails only because `--policy` is then missing; `status --jsno` succeeds with human output.
- `--json` on `onboard` is an unknown flag and consumes a following non-flag word: `onboard --policy onboarding --json repo` loses `repo` and exits 64, while `onboard --json --policy onboarding repo` works. The same holds for `--wait` on any command other than `start`, `resume`, `decide` and `cancel`.
- `onboard` after `repo add` continues the stored onboarding and keeps the mode and budgets recorded then (`full`, none); a `--mode` or `--budget` given to the later `onboard` is not applied.
- `onboard --budget` and `start --budget` accept any numeric shape; an unknown budget name or a raise is found only when the contract is compiled. For `onboard` that blocks the onboarding with reason `decision` and exits 3; for `start` it is exit 64 with nothing created.
- `status` prints an onboarding in state `planning` as interrupted with a `resume` hint, but `resume` has no stage for that state and ends without progress (exit 3).
- A run that was just started has not yet taken its lease: its state is `contract_ready` and it has no lease holder. `status` shows it as interrupted and `paused`, with a `resume` hint, until its supervisor takes the lease.
- A run shown as `paused` by `status` is usually a presentation: only a run whose ledger state is `paused` made that transition. The JSON keeps the real state in `state` and `interrupted.state`.
- The start refusal codes are not printed; only the message is. A script that needs to tell the refusals apart must match message text.
- Exit code 3 covers several different situations (refused, blocked, held lease, run stopped elsewhere, no answer); the message on stderr or stdout distinguishes them. `status` and `inbox` never return it.
- The error line for a run that cannot be read during `start --wait` or `resume --wait` is printed on stdout, not stderr, although it is an error and exits 70.
- The `avarice-run` skill names three owner commands: `contract amend`, `budget` and `install-host`. `contract amend` and `install-host` are commands. `budget` is not one, and dispatch treats it as an unknown command.
- A usage error from an owner command prints the command's own usage line and then the list of command names. A refusal for a run, a terminal or a process tree prints only the reason and the command list.
- The data-root owner check of `decide`, `cancel` and `schedule` runs after the profile is prepared and the ledger is opened. The ledger open itself refuses a store file owned by another user, so the command's own check is a second guard. `contract amend` makes no such check.
- `digest` exits 0 when quiet hours held its banner or when nothing waits, so a scheduled run that posted nothing is not a failure. Only an undelivered banner is exit 70.
- The wait of `start --wait` is bounded by the contract's wall clock plus 15 minutes and ends with exit 3 and a "still running" line when the supervisor outlives it. The wait of `resume --wait` is bounded by 24 hours regardless of the contract.
