# CLI reference

This document describes the command-line surface in `src/cli/` (entry `bin/avarice.ts`): six commands, one exit-code convention, and one argument parser shared by all of them.

## Summary

- Commands: `init`, `repo add`, `onboard`, `status`, `resume`, `context`. Anything else is a usage error.
- Exit codes: `0` success, `3` the command ran correctly but the answer is "not active, refused, held or unavailable", `64` usage error, `70` internal failure.
- Streams: results go to stdout; every error and every warning goes to stderr. Only `status` and `context` have a `--json` form; both print pretty-printed JSON (two-space indent) and a trailing newline.
- Only `onboard` and `resume` take a lease and run stages. `status` and `context` write no project, onboarding, adapter or lease rows, but see "Order of checks and profile side effects" for what every command creates.
- The CLI code opens no network connection. `context` and `status` are offline; `onboard` and `resume` may launch the contained agent host, whose behavior belongs to [containment.md](containment.md).

The PreToolUse hook entry is not a user command; it runs inside the agent host and is described in [containment.md](containment.md).

## Global behavior

### Dispatch

| Invocation | Result | Exit |
|---|---|---|
| `avarice --help` or `avarice -h` (first word only) | usage text on stdout | 0 |
| `avarice` with no words | `avarice: no command given` plus usage text on stderr | 64 |
| `avarice <name>` where name is not one of the six | `avarice: unknown command '<name>'` plus usage text on stderr | 64 |
| A listed command whose module is missing from the build | `avarice: '<name>' is not available in this build` plus usage on stderr | 64 |
| A command module that fails to load for another reason, or exports no entry point | message on stderr | 70 |

Only the six listed names are ever loaded, so a name such as `../main` is an unknown command. `--help` and `-h` are recognised only as the first word. After a command name they are not special: `init -h` is rejected as an unexpected argument, and `status --help` is accepted and ignored.

The usage text lists the command names only; it carries no per-command help. Per-command usage lines appear on stderr with a usage error.

### Argument parsing

All commands share one parser. Its rules are the contract:

- A word starting with `--` and longer than two characters is a flag. Everything else is a positional, including single-dash words such as `-h` or `-x`. There are no short flags.
- `--flag=value` attaches a value, and the value may be empty.
- `--flag value` consumes the next word as the value unless that word starts with `--`, or the flag is declared boolean by the command. A flag with no value is the boolean `true`. A value may start with a single dash (`--budget -5` consumes `-5`).
- `--` ends flag parsing; every later word is positional.
- A flag given more than once keeps the last value; `onboard --budget` additionally uses every occurrence.
- Unknown flags are accepted silently and ignored. A misspelt flag is therefore not an error.
- Only `status` and `context` declare `--json` as boolean. On the other commands `--json` is an unknown flag; it consumes the following word unless that word starts with `--`.

### Order of checks and profile side effects

For every command that passes dispatch, the work runs in this order: parse arguments; run the command's own usage check if it has one; resolve and prepare the profile and open the ledger; run the command.

`init`, `repo add` and `context` have a usage check, so a malformed command line exits 64 before anything is created. `onboard` and `resume` check their arguments inside the command, after the profile is prepared, so a usage error from either can leave a freshly created profile behind. `status` has no usage check and ignores extra words.

Preparing the profile (every command, including `status` and `context`):

- Roots: config home, data root and work root come from `AVARICE_CONFIG_HOME` (default `~/.config/avarice`), `AVARICE_DATA_ROOT` (default `~/.local/share/avarice/personal-local`) and `AVARICE_WORK_ROOT` (default `~/.local/share/avarice-work/personal-local`). The only profile is `personal-local`. See [config-reference.md](config-reference.md).
- Placement is refused when a root lies under a `~/.claude*` directory or under `CLAUDE_CONFIG_DIR`, when roots are nested, or when the data root is not on local storage (or its mount cannot be determined). The refusal is exit 70 with the reason on stderr.
- Missing directories are created with mode 0700; a missing profile `config.json` is created with mode 0600 and never overwritten.
- The ledger (`state.db` in the data root) is created and migrated when absent or behind. A read-only command opens an already current ledger read-only; if the ledger is absent or has pending migrations it is created or migrated first and then reopened read-only.
- A command that is not read-only (`init`, `repo add`, `onboard`, `resume`) also records the executor, graph, GSD (when located) and agent-host adapter descriptors in the ledger. `status` and `context` record none.
- Failure of any of these steps is exit 70 with a message of the form `avarice: <what>: <reason>`.

### Exit codes

| Code | Meaning | Used by |
|---|---|---|
| 0 | The command did what was asked. For `onboard` and `resume`, the project is active. | all |
| 3 | A valid request with no positive result: onboarding stopped without activating, a repository was refused, another process holds the lease (`resume` only), or `context` has nothing it can query | `repo add`, `onboard`, `resume`, `context` |
| 64 | Usage error, an unknown ID or project, or a path that is not a git repository | dispatch, `init`, `repo add`, `onboard`, `resume`, `context` |
| 70 | Internal failure: profile, store or adapter failure, an unexpected exception | all |

An uncaught exception inside a command is caught by dispatch, printed as `avarice: <name> failed: <message>` and returned as 70. The store is closed on every path.

## init

`avarice init [--profile personal-local]`

Reports the resolved profile. It is the first-run path, and it is idempotent: a second run changes nothing.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--profile` | string | `personal-local` | Any other value is a usage error (64) naming the only accepted profile. A bare `--profile` with no value also fails, since the value is `true`. |
| positionals | none | | Any positional is a usage error (`unexpected argument`). |

Output (stdout, no `--json` form), one `label: value` line each: `profile`, `config` (path of the profile `config.json`), `data root`, `work root`, `schema version` (read from the ledger; `unknown (...)` when it cannot be read), then a note that the ledger uses an experimental Node SQLite and that AVARICE refuses a runtime lacking the WAL-reset fix.

Warnings (stderr, exit stays 0): for each of config home, data root and work root, a line `warning: <dir> has mode NNNN and is accessible to other users; run: chmod 700 '<dir>'` when group or other permission bits are set.

Exit: 0, 64 (usage), 70 (profile or store failure, including a refusal of the runtime or root placement).

Side effects: creates the profile directories, `config.json` and the migrated ledger when absent, and records adapter descriptors. Takes no lease. Not read-only.

## repo add

`avarice repo add <path>`

Registers a repository and records what preflight found, leaving an onboarding in state `discovered`. It stages nothing, runs no agent and takes no lease; `onboard` continues the same onboarding.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `add` | literal first positional | required | Missing or any other subcommand is a usage error. |
| `<path>` | string | required | Exactly one path after `add`. A path that cannot be inspected as a git repository is a usage error (64). Relative paths resolve against the working directory. |

Registration uses fixed settings: policy `onboarding`, mapping mode `full`, promotion `none`, no budget overrides. There are no flags.

Behavior when the repository is already known (same root commit and path):

- An active project record exists: refused, exit 3, stderr `avarice repo add: refused: conflict: ...` naming `existing_state_conflict`.
- Another onboarding is past `discovered` and not stopped: refused the same way (exit 3); the message names the onboarding and the `avarice resume <id>` command.
- An onboarding still in `discovered` exists: it is reused, no second project or onboarding is created, and its stored request is not changed.
- Otherwise a new project and onboarding are created.

Output (stdout), in order, lines with no content omitted: `project <id>`; `onboarding <id>: <state>`; `repository <git root>`; `pin <commit>` with the branch name or `(detached HEAD)`; `tracked files N, M bytes`; whether a `.planning/` directory exists and the classification of any existing codebase map (with a note when adoption is deferred and the map is regenerated in staging); then, only when non-empty, lists of instruction files, workspace manifests, ADR directories, runtimes, submodules, nested repositories, and files not mapped (uncommitted or untracked, names only). The last line is `next: avarice onboard --policy onboarding <path>` with the path as typed. Each list is cut at 1000 entries in the record. There is no `--json` form.

Exit: 0, 3 (refused), 64 (usage, or not a git repository), 70 (internal).

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

Registration refusals mirror `repo add`: an active record or another in-flight onboarding of the same repository is refused with exit 3 (stderr `avarice onboard: refused: ...`); a non-repository path or a refused promotion is exit 64; other failures are 70.

Output (stdout, no `--json` form): `onboarding <id>: <state>` with ` (<reason>)` appended when the onboarding has a blocked reason; then, when the stages left an explanation, one line with that message (for example why GSD was incompatible or why a contract was refused). Reasons are `enforcement_failure`, `budget_exhausted`, `existing_state_conflict`, `scope_unavailable`, `adapter_incompatible` and `decision`.

Exit: 0 when the final state is `active`; 3 when it ends in any other state (blocked, incompatible, or an in-progress state the loop cannot advance); 64 usage; 70 when the run fails (stderr `onboarding <id> did not finish: ...`), including a lease already held by another process (another process running the same `discovered` onboarding) and a lease lost mid-run.

Side effects: registers the project and onboarding; takes the lease on the onboarding (default lifetime 180 seconds, override `AVARICE_LEASE_TTL_MS`, see [config-reference.md](config-reference.md); renewed every third of the lifetime while stages run, released on exit); creates a staging copy under the work root, runs the GSD mapping through the contained agent host, builds the code graph, intel and knowledge indexes in staging, and on success writes the active project record. The user's checkout is not modified. When GSD is missing or not admitted, the onboarding stops `incompatible` rather than failing; when the host cannot enforce containment, it ends `blocked` with reason `enforcement_failure`. Not read-only, not offline.

## status

`avarice status [--json]`

Shows every registered project with its latest onboarding and active record. Read-only, offline, takes no lease.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `--json` | boolean | off | Boolean; never consumes a following word. |

There is no usage check: extra positionals and unknown flags are ignored.

Human output: `No projects registered.` when there are none. Otherwise per project: `<repo path>  [<project id>]`; an onboarding line (`onboarding <id>: <state>` with the reason in parentheses, or `not onboarded`; for an interrupted onboarding, `interrupted in <state> (next: <action>)` followed by `continue with: avarice resume <id>`); and, when an active record exists, `record vN at <revision>`, the mapping mode with completeness and freshness, and the indexes the record lists (`graph, intel`), with absent ones shown as `graph absent (<reason>)`, or `none`.

An onboarding counts as interrupted when its state is a pre-activation, non-stopped state and its lease is absent or expired. A live lease, or a stopped state, never shows as interrupted.

JSON output: an array, one object per project, in ledger order; `[]` when there are none.

| Field | Type | Meaning |
|---|---|---|
| `projectId` | string | Project ID. |
| `repoPath` | string | Git root as registered. |
| `onboardingId` | string or null | Latest onboarding; null when none. |
| `state` | string | State of the latest onboarding; `unregistered` when none. |
| `reason` | string or null | Blocked reason of the latest onboarding. |
| `interrupted` | object, optional | Present only when interrupted: `state`, `nextAction` (from the latest checkpoint, `unknown` when none), `resumeCommand`. |
| `recordVersion` | number or null | Active record version. |
| `onboardedRevision` | string or null | Revision the record was built at. |
| `mapping` | object or null | The record's mapping block, passed through as stored. |
| `indexes` | object | The record's indexes block as stored, `{}` when no record. |

Exit: 0, or 70 when the ledger cannot be read.

## resume

`avarice resume <onboardingId>`

Continues an interrupted onboarding from its committed state.

| Argument | Type | Default | Validation |
|---|---|---|---|
| `<onboardingId>` | string | required | Exactly one non-empty positional, otherwise usage error (64). An unknown ID is also 64. |

There are no flags and no `--json` form.

Behavior:

- If the onboarding is already in a stop state (`active`, `blocked`, `incompatible`, `deactivated`), nothing runs and no lease is taken: it prints the state and exits 0 for `active`, otherwise 3.
- Otherwise it takes the lease, and only when the previous holder's lease has expired; a live lease held by another process is exit 3 with `held by another process; its lease must expire first`. Of several concurrent resumes, one proceeds and the rest exit 3.
- Under the lease, before any stage, the resume ends every agent process the previous holder left running, then decides from the staging output whether an interrupted mapping finished. If a process cannot be found or ended, the resume exits 70 rather than relaunch beside it. The mechanics are in [onboarding.md](onboarding.md).
- The stage loop then runs as in `onboard`.

Output (stdout): `onboarding <id>: <state>` with ` (<reason>)`, then the explanatory message line when one exists.

Exit: 0 active; 3 stopped without activating, or lease held; 64 usage or unknown ID; 70 failure (`onboarding <id> did not finish: ...`).

Side effects: as `onboard` after registration; also appends `invocation.reaped` and `invocation.reconciled` events when it reaps or reconciles. Not read-only.

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

Human output: a header line with the term, repository, project ID and record version and revision; `budget N tokens, used about M`; `no index entry matches` when empty; then per item a numbered line `[source] title`, a line with source path, revision, freshness, optional confidence and estimated tokens, and the excerpt; a `left out for the budget:` list; and one `note:` line per note. Control, zero-width and bidirectional characters are replaced by spaces and lines are cut at 400 characters. Text that came from a document, or from a model reading one, is wrapped in a fence of the form `--- begin untrusted data ... ---` with every content line prefixed by `| `, so it cannot close the fence. Its title is not printed outside the fence.

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

Exit: 0 on an answer, including `no index entry matches` and an answer where an index added only a note; 3 when there is no active project record (stderr tells you to onboard first), the project is unknown, no admitted GSD is available to read the indexes, or the staging copy cannot be read; 64 usage (including the several-projects case); 70 internal.

## Quirks

- A command named read-only still prepares the profile and may create and migrate the ledger on a first run; it writes no project, onboarding or adapter rows.
- Unknown flags never fail. `onboard --polcy onboarding repo` fails only because `--policy` is then missing; `status --jsno` succeeds with human output.
- `--json` on `onboard` is an unknown flag and consumes a following non-flag word: `onboard --policy onboarding --json repo` loses `repo` and exits 64, while `onboard --json --policy onboarding repo` works.
- `onboard` after `repo add` continues the stored onboarding and keeps the mode and budgets recorded then (`full`, none); a `--mode` or `--budget` given to the later `onboard` is not applied.
- `onboard --budget` accepts any numeric shape; an unknown budget name or a raise is found only when the contract is compiled, which blocks the onboarding with reason `decision` and exits 3, not 64.
- `status` prints an onboarding in state `planning` as interrupted with a `resume` hint, but `resume` has no stage for that state and ends without progress (exit 3).
- Exit code 3 covers several different situations (refused, blocked, held lease, no answer); the message on stderr or stdout distinguishes them.
