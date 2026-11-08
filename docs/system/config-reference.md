# Configuration reference

This document describes every configuration input AVARICE reads and every built-in limit that acts as configuration. The inputs are the environment variables that the `avarice` CLI, its detached supervisor and its hook read and set. They also include the profile `config.json`, the repository-side `.avarice/config.json` and `.planning/config.json`, the `routine` and `onboarding` presets, and the sandbox and egress-proxy settings. The sources are the profile and root resolution (`src/adapters/fs/profile-paths.ts`); the repository conventions and the run contract (`src/domain/conventions.ts`, `src/domain/run-contract.ts`, `src/domain/run-preflight.ts`, `src/domain/policy-narrowing.ts`); the run services (`src/app/`); the host, executor and proxy adapters (`src/adapters/`); and the CLI (`src/cli/`).

## Summary

- AVARICE reads 9 `AVARICE_*` variables and sets 4: `AVARICE_RUN` for the contained host, and the three root variables for the detached run supervisor. It reads 10 other variables: `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `NO_COLOR` and `TERM`. Six more `AVARICE_*` names in the source are constants, not variables: `AVARICE_WRITE_SET`, `AVARICE_TRACKED_WRITABLE`, `AVARICE_SECRET_PATTERNS`, `AVARICE_COMMIT_IDENTITY`, `AVARICE_EXECUTOR_ADDENDUM` and `AVARICE_RUN_SKILL`.
- `PYTHONDONTWRITEBYTECODE`, the proxy variables, `CI` and the `GIT_*` variables are set for child processes and never read. `NO_COLOR` is both read (by the CLI) and set (for graphify).
- The profile `config.json` has four keys. All are written once and none is ever read back, so all four are dead knobs. The effective roots always come from the environment variables or their defaults.
- The repository's `.avarice/config.json` is the only configuration file AVARICE parses, as untrusted data that can only narrow authority. Two readers parse it for different purposes and accept different keys. `.planning/config.json` is written by gsd-core in the working copy and is never parsed by AVARICE.
- There is no configuration file for budgets, versions or limits. They are built-in constants. A run's budgets are lowered per run only through `avarice start --budget name=value`, and an onboarding's through `avarice onboard --budget name=value`.
- The sandboxed executor listens on no port. Its only network allowance is outbound connections to loopback ports that an AVARICE supervisor step names. The only listener is a per-step allowlist proxy on an operating-system-chosen port of 127.0.0.1.

## Environment variables AVARICE reads

Every row names a read on a production path unless marked otherwise. An empty value counts as unset for every variable below except `AVARICE_FAULT`, `AVARICE_RUN` and `NO_COLOR` (see their rows).

| Variable | Default | Effect | Usage |
|---|---|---|---|
| `AVARICE_CONFIG_HOME` | `~/.config/avarice` | Directory that holds the profile config file. Resolved to an absolute path. | Set to relocate the config. It must not sit under any `~/.claude*` directory or under the real path of `CLAUDE_CONFIG_DIR`, and must not nest with the other roots; otherwise every command that opens the profile refuses. |
| `AVARICE_DATA_ROOT` | `~/.local/share/avarice/personal-local` | Directory that holds the ledger database (`state.db`), artifacts, run contract files, the shell history and per-invocation files. Created with mode 0700. | Set to move state. It must be on a local mount: a network or non-local mount is refused because SQLite WAL is unsafe there. The same placement rules as the config home apply. |
| `AVARICE_WORK_ROOT` | `~/.local/share/avarice-work/personal-local` | Directory for staging workspaces and for each run's clone and scratch directory. Created with mode 0700. | Set to move staging and run clones. Same placement rules as the config home. Under a custom value the supervisor's own sandboxed commands deny it less completely (see the quirks). |
| `AVARICE_CLAUDE_BIN` | first `claude` on `PATH` | Absolute path of the `claude` executable used as the contained host. | Set when `claude` is not on `PATH` or to pin one install. When neither resolves, the host is unavailable: an onboarding is blocked with reason `enforcement_failure` at the workspace stage's enforcement check, and the reason (`claude was not found ...`) is recorded in the host descriptor. The same fallback applies when no admitted gsd-core is located, the GSD shim preamble is missing, the sandbox is unusable or the version is not admitted. The binary must report an admitted version (see built-in constants). |
| `AVARICE_HOOK_ENTRY` | the `pre-tool-use` hook script of this checkout | Path of the hook program written into the host settings. | Override only to substitute a hook; the host is launched with whatever this names. A self-test of the hook runs before launch. |
| `AVARICE_GRAPHIFY_BIN` | first `graphify` on `PATH` | Path of the `graphify` executable for code extraction and the knowledge pass. | When set and non-empty it is the only candidate: if it names no executable file, graphify is reported missing and `PATH` is not tried. Only absolute `PATH` entries are searched. A missing graphify does not fail startup; it fails the index step that needs it. |
| `AVARICE_LEASE_TTL_MS` | `180000` | Lease time-to-live, in milliseconds, for an onboarding and for a run supervisor. The lease is renewed every third of the TTL (at least 1 ms). | Read on the production path, but used as a test seam (short leases for fault tests). A value that is not a positive safe integer, including an empty one, silently falls back to the default. |
| `AVARICE_FAULT` | unset | Kills the process with SIGKILL when execution reaches the named checkpoint (`name`, or `name#N` for the Nth arrival). | Test-only fault injection, but the read is on the production path: an operator who sets it gets a SIGKILL with no cleanup. The run supervisor also fires checkpoints named `after-checkpoint:<action>` and `after-transition:<state>`. Do not set it outside tests. Unlike the other variables an empty value is not treated as unset (it matches no checkpoint). |
| `AVARICE_RUN` | unset | The run marker. Any value, including an empty one, counts as set. | Not for operators to set. The host launch sets it (next section). While set, bare `avarice` does not open the interactive shell and exits 64 with the usage text, the shell refuses to open, and `install-host` is refused with exit 64. No other command reads it. A process can unset it, so it is a guard against accidental use, not a containment control. |
| `HOME` | the OS home directory | Base for the default roots, the gsd-core candidate `~/.claude/gsd-core`, the default `~/.claude` config directory and the default skill directory of `install-host`. It is also the base of the credential locations that sandboxed commands may not read, and it is forwarded to children. | Normally inherited. Empty is treated as unset for AVARICE's own path resolution. |
| `PATH` | none (see children) | Search path for `claude` and `graphify` (absolute entries only for graphify). Forwarded to git children. Its value is also appended to the directory of the running Node binary to form the `PATH` of check, install and list commands. | Must contain `git`; the git child falls back to a fixed path list only when `PATH` is empty. The check sandbox falls back to `/usr/bin:/bin` when `PATH` is unset. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Host configuration directory. Used for the root placement rules, for the gsd-core candidate `<dir>/gsd-core`, as the skills root for the host, as the default target of `install-host`, and forwarded to the host and gsd-core. | Set when Claude Code is installed in a nondefault directory. `install-host --config-dir` overrides it. |
| `GSD_HOME` | unset | First gsd-core candidate directory. | Set to pin a gsd-core install. A candidate that is found but not admitted is an error; later candidates are not tried. |
| `USER`, `LOGNAME` | unset | Forwarded to gsd-core processes, the host and the host probes (the host's macOS credential lookup needs `USER`). | Read only for forwarding. |
| `LANG` | `C` for git; unset otherwise | Forwarded to git (default `C`), gsd-core, graphify, the host and the probes. | Read only for forwarding. |
| `TMPDIR` | OS default | Forwarded to gsd-core, graphify, an onboarding host and the probes. The OS temp directory is also used for graphify's version probe, the gsd-core identity probe and the hook self-test scratch directory. A run's host gets its own `TMPDIR` instead (next section). | Read only for forwarding and temp-directory choice. |
| `NO_COLOR` | unset | Any value, including an empty one, turns colour and cursor escapes off. | Standard convention. Colour is on only when the stream is a terminal, `NO_COLOR` is unset and `TERM` is not `dumb`. |
| `TERM` | unset | `dumb` selects the plain line mode of the interactive shell and turns colour off. | Any other value, or none, leaves the full-screen mode and colour on when the streams are terminals. |

Test-only seam: `AVARICE_FAKE_HOST` is read only by the test fake host; nothing in the shipped source references it, so it has no effect on the CLI.

## Environment variables AVARICE sets for child processes

Children get an allowlisted environment built from nothing; names not listed here do not reach them (proxy variables from the parent, tokens, agent sockets and loader variables are never forwarded). The one exception is the detached supervisor, which inherits the whole environment of the command that started it.

| Child | Variables set | Values |
|---|---|---|
| git (every git call) | `PATH`, `HOME`, `LANG`, plus the fixed safe-git set | `PATH` and `HOME` inherited (`HOME` is the empty string when unset); `PATH` falls back to `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin` when empty; `LANG` inherited or `C`. Fixed set: `GIT_CONFIG_COUNT` (2, plus one per extra config entry), `GIT_CONFIG_KEY_0=core.hooksPath` with `GIT_CONFIG_VALUE_0=/dev/null`, `GIT_CONFIG_KEY_1=core.fsmonitor` with `GIT_CONFIG_VALUE_1=false`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ATTR_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`. |
| git, per call | `GIT_CONFIG_KEY_n` and `GIT_CONFIG_VALUE_n` entries from 2 up, `GIT_INDEX_FILE`, `GIT_LITERAL_PATHSPECS` | Only when a call asks. Extra entries blank a repository's filter drivers, set `core.excludesFile=/dev/null`, set `user.name`, `user.email` and `commit.gpgsign=false` (the commit identity), set `transfer.fsckObjects` and `fetch.fsckObjects` to `true`, and for `fetch` set `gc.auto=0` and `maintenance.auto=false`. `GIT_INDEX_FILE` names an absolute temporary index (a relative path is refused). `GIT_LITERAL_PATHSPECS=1` makes every pathspec literal. |
| gsd-core tools | the git set, then `HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR` when set and non-empty, and `PATH` | `PATH` is gsd-core's `bin`, `/usr/bin`, `/bin`, `/opt/homebrew/bin`. |
| claude host, onboarding | the git set, the same six passthrough names, `PATH`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `AVARICE_RUN` | `PATH` is the gsd-core `bin`, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. The environment builder accepts extra trailing directories, but no caller passes any, so graphify is not on the host `PATH`. `AVARICE_RUN` is the onboarding ID and overrides any inherited value. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is deliberately not set. |
| claude host, run | the same set, with three changes | `AVARICE_RUN` is the run ID. `TMPDIR` is `<scratch>/tmp` and `npm_config_cache` is `<scratch>/npm-cache`, both in realpath form, and `npm_config_update_notifier=false`. `<scratch>` is the `scratch` directory of the run under the work root. `HOME` is still the forwarded `HOME`, not the scratch directory. |
| check, install and list commands (sandboxed) | `PATH`, `HOME`, `TMPDIR`, `npm_config_cache`, `CI`, `LANG` | `PATH` is the directory of the running Node binary followed by the inherited `PATH`. `HOME` and `TMPDIR` are the run's scratch directory (realpath form), `npm_config_cache` is `<scratch>/npm-cache`, `CI=1`, `LANG=C`. Nothing else is inherited. |
| check (sandboxed) | the sandbox set above, plus the check's own `env` | The check's `env` goes in first and the sandbox set overrides it, so a check cannot change `CI`, `LANG` or the other sandbox names. The install command and the test-inventory list command receive the sandbox set only, never a check's `env`. |
| dependency install (sandboxed) | the sandbox set, plus `npm_config_https_proxy`, `npm_config_proxy` and `HTTPS_PROXY` (all `http://127.0.0.1:<proxy port>`), `npm_config_update_notifier=false`, `npm_config_ignore_scripts=true` | Install scripts are switched off whatever the declared install command says. |
| check validation (sandboxed) | the sandbox set, the check's `env`, plus `HTTP_PROXY`, `HTTPS_PROXY`, `npm_config_proxy`, `npm_config_https_proxy` (all `http://127.0.0.1:<proxy port>`) | Proxy variables only when the detector proxy started. Here too the sandbox set overrides the check's `env`. |
| graphify | the git set with `HOME` and `LANG`, `TMPDIR` when set, `PATH`, `PYTHONDONTWRITEBYTECODE=1`, `NO_COLOR=1` | `PATH` is the directory of the graphify binary, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. |
| host and sandbox probes | `PATH=/usr/bin:/bin:/opt/homebrew/bin` and the six passthrough names | Used for the host version and capability probes and the sandbox probe. |
| run supervisor (detached) | the whole environment of the starting command, with three overrides, and `NODE_TEST_CONTEXT` removed | `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT` and `AVARICE_WORK_ROOT` are set to the roots the starting command resolved, whatever the environment said. `NODE_TEST_CONTEXT` is dropped so a test entry does not do nothing. The supervisor then builds every child environment as in the rows above. |
| hook | none set | The hook is started by the host and inherits the host environment above. |

Every sandboxed command runs with exactly the environment it is given: the executor inherits nothing.

## Profile config file

Location: `<config home>/profiles/personal-local/config.json`, mode 0600. It is created when absent, by any command that opens the profile (not only `avarice init`), and never rewritten. `avarice init` only reports it. Only one profile exists, `personal-local`; `init --profile` accepts that name only.

| Key | Written value | Read by | Status |
|---|---|---|---|
| `schema` | `1` | nothing | dead knob |
| `profile` | `personal-local` | nothing | dead knob |
| `dataRoot` | the resolved data root at first creation | nothing | dead knob |
| `workRoot` | the resolved work root at first creation | nothing | dead knob |

Editing the file changes nothing. Because it is written once, it can disagree with the roots in use after an environment variable changes. The roots come from `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT` and the defaults on every run.

## Repository-side files

### `.avarice/config.json`

One file, two readers. Both treat it as data (parsed, never executed). They read different copies, accept different keys and refuse different values, so a file can be valid for one reader and produce findings in the other.

| Reader | Reads from | When | Purpose |
|---|---|---|---|
| Onboarding proposal reader | the staging copy at the pinned commit | at activation | Proposes values for the project record. |
| Run conventions reader | git objects: the onboarded revision, or a later commit that changes only paths under `.avarice/` | at `avarice start` | Supplies the checks, write set and commands a run may use. |

#### Run conventions reader (schema 1)

The file is read from git objects only, never from the working tree. The newest qualifying commit on the first-parent chain wins, and at most 500 commits are walked. The file must be a regular file of at most 262144 bytes, valid JSON, and a JSON object. A missing file refuses the start with `no-conventions`; an invalid one refuses it with `conventions-invalid`. Every level refuses unknown keys, so a field no stage reads cannot carry authority. Duplicate JSON keys are not detected: the last one wins.

Top-level keys:

| Key | Required | Default | Constraint | Usage |
|---|---|---|---|---|
| `schema` | yes | none | The number `1`. | Any other value or a missing key is refused. |
| `checks` | no | none | Array of at most 32 check objects. | The commands that prove a run. |
| `paths` | no | all three lists empty | Object with the keys `write`, `protected`, `artifacts`. | The path scopes of a run. |
| `testInventory` | no | none | Object with the keys `argv` and `globs`. | How the run lists tests so a unit that weakens the set is caught. |
| `dependencies` | no | none | Object with the keys `install`, `lockfile`, `registryHosts`. | The install step before any check. |
| `agentCommands` | no | none | Array of at most 64 command strings. | Shell commands the agent may run. |

Each `checks` entry (keys `name`, `argv`, `timeoutSec`, `required`, `env`, `writes`; any other key is refused):

| Key | Required | Default | Constraint | Usage |
|---|---|---|---|---|
| `name` | yes | none | Matches `[a-z][a-z0-9:_-]{0,63}`; unique among the checks. | Brief `verifiedBy` and target-check references use it. |
| `argv` | yes | none | 1 to 64 non-empty strings of at most 1024 characters each, no NUL. | Never a shell string: the vector is run as written. |
| `timeoutSec` | no | `600` | Integer from 1 to 3600. | Kill time of the check, in seconds. |
| `required` | no | `true` | Boolean. | A required check must pass at final proof. |
| `env` | no | empty | Object of at most 32 variables. A name matches `[A-Z_][A-Z0-9_]*`, a value is a string of at most 1024 characters without NUL. | Non-secret environment for the check. The sandbox values override it (see the process environment section). |
| `writes` | no | empty | Array of at most 128 globs. | Paths the check may write besides the scratch directory; they become run artifacts. |

Reserved check environment names are refused at parse. `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `BASH_ENV`, `ENV`, `SHELL`, `IFS`, compared as written. Any name starting with `DYLD_`, `LD_` or `npm_config_` is also refused, compared without regard to case.

`paths` keys (any other key is refused):

| Key | Default | Constraint | Usage |
|---|---|---|---|
| `write` | empty | Array of at most 128 globs. | What the run may write. Must not be empty after the brief narrows it, and must stay off protected paths. |
| `protected` | empty | Array of at most 128 globs. | Added to the preset's protected list; nothing here removes a preset entry. |
| `artifacts` | empty | Array of at most 128 globs. | Paths that may change during the run but never reach the branch. Must stay off protected paths. |

`testInventory` keys (any other key is refused):

| Key | Required | Constraint | Usage |
|---|---|---|---|
| `globs` | yes | Array of at most 128 globs. | The files counted as test files, and scanned for skip and focus markers. |
| `argv` | no | 1 to 64 non-empty strings of at most 1024 characters, no NUL. | The list command whose output lines are the test IDs. Without it, only files and markers are measured. |

`dependencies` keys (any other key is refused):

| Key | Required | Constraint | Usage |
|---|---|---|---|
| `install` | yes | 1 to 64 non-empty strings of at most 1024 characters, no NUL. | The install command, run in the clone. |
| `lockfile` | yes | A repository-relative path that obeys the glob rules and holds no `*`, `?`, `[`, `]`, `{` or `}`. | Its digest is recorded; a missing lockfile at the onboarded revision blocks the run. |
| `registryHosts` | no (empty) | At most 16 bare host names (no scheme, no port), lower-cased, at most 253 characters, labels of letters, digits and inner hyphens. Refused: `localhost`, any name under it, a single-label name, and a name whose last label is all digits or a `0x` form. No spelling of an IP address is therefore accepted. | The only hosts the install may reach, on port 443. A registry on a private network cannot be used (see [containment.md](containment.md#limits-of-containment)). |

Each `agentCommands` entry is a string with these rules.

- At most 256 characters, with no control character or NUL.
- None of the characters semicolon, ampersand, pipe, dollar sign, backtick or backslash.
- Words separated by exactly one space (no leading, trailing or doubled space).
- No `<` or `>` except a single final word `<paths>` that is not the only word.
- The first word, by its last path segment and without regard to case, is not one of `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` or `sudo`. At compile, each check's argument vector, joined by spaces, must pass the last rule too.

Glob rule, used by every glob above and by the brief's `## Write` section. A glob is a non-empty string of at most 512 characters, with no control character or NUL, no backslash, no leading `/`, no leading `~`, and no empty, `.` or `..` segment.

Whole-file limit: 262144 characters. The compiler's own refusals (a write glob inside a protected path, a brief glob outside the write set, an empty write set, static gate failures) are listed in [runs.md](runs.md).

#### Onboarding proposal reader

Read from the staging copy at the pinned commit, only at activation. Maximum size 65536 bytes; larger or unreadable files produce a finding and no values. Missing file: nothing proposed. Invalid JSON: a finding. The proposal can only narrow the profile policy; accepted values are recorded on the project record and every refusal becomes a finding (at most 50 are kept). The profile policy grants read of everything, no write, no generated and no artifact paths, and protects `.avarice/**` and `.github/**`.

| Key | Accepted when | Usage |
|---|---|---|
| `paths.protected` | always (adds protection) | Globs. |
| `paths.read` | covered by the policy grant (the policy grants `**`) | Narrows the read scope. |
| `paths.write`, `paths.generated`, `paths.artifacts` | covered by the policy grant (the policy grants none, so every entry is refused as widening) | No value can currently be accepted. |
| `commands` | each entry an object with `name`, `argv`, optional `status` | Accepted only as `inactive`; any other `status` is refused as widening. |
| `verificationByChangeType` | never | Refused as unsupported. |
| any other key, including `schema`, `checks`, `testInventory`, `dependencies` and `agentCommands` | never | Refused as unknown. |

Limits on entries: a glob is a non-empty string up to 256 characters, with no leading `/`, no NUL, no backslash and no `..` segment. At most 50 commands are kept; `name` matches `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`; `argv` has 1 to 64 strings of at most 1024 characters each without NUL. Findings clip values to 120 characters.

#### Where the two readers disagree

The run reader refuses `paths.read`, `paths.generated`, `commands` and `verificationByChangeType` as unknown keys. The onboarding reader accepts `paths.read` and `commands` (as inactive), refuses every `paths.generated` entry as widening, and refuses `verificationByChangeType` as unsupported. A file written for a run therefore carries findings on the project record: `schema`, `checks`, `testInventory`, `dependencies` and `agentCommands` are refused as unknown, and each `paths.write` or `paths.artifacts` entry is refused as widening. The run reader does not read the project record's accepted paths, so these findings do not change what a run may do. A file written for the onboarding reader fails the run reader at its first unknown key.

### `.planning/config.json`

AVARICE never parses it. It is written by gsd-core's `config-set` in two places.

- Onboarding staging: four settings, `commit_docs=false`, `workflow.text_mode=true`, `intel.enabled=true`, `graphify.enabled=true`. The file is in AVARICE's own write set, is the one tracked file that may be modified, and is permitted for the host to edit in staging. The settings are recorded on the project record.
- Run clone: seven settings, applied by AVARICE before the first invocation and never by the agent: `workflow.text_mode=true`, `gates.execute_next_plan=false`, `gates.confirm_transition=false`, `audit.enabled=true`, `workflow.use_worktrees=false`, `commit_docs=false`, `git.branching_strategy=none`. A run agent can never write the file, and it is restored to its committed state before the run is judged because it is a run artifact.

## Command-line flags that configure a run

The full flag contract is in [cli-reference.md](cli-reference.md).

| Flag | Default | Effect |
|---|---|---|
| `onboard --policy onboarding` | required | The only onboarding policy. |
| `onboard --mode full\|fast` | `full` | Mapping mode. |
| `onboard --promote none` | `none` | Only `none` is accepted. |
| `onboard --budget name=value` (repeatable) | none | Lowers an onboarding budget; see the onboarding preset. |
| `start --brief <file>` | required | The brief file; see the run limits for its caps. |
| `start --policy routine` | required | The only run policy. |
| `start --project <id>` | the registered repository that contains the current directory | Names the project instead. |
| `start --budget name=value` (repeatable) | none | Lowers a run budget; see the routine preset. |
| `start --wait` | off | Follows the run for at most its wall-clock budget plus 15 minutes. |
| `resume <id> --wait` | off | Follows a resumed run for at most 24 hours. |
| `install-host --config-dir <dir>` | the `CLAUDE_CONFIG_DIR` value, else `~/.claude` | Directory that receives the `avarice-run` skill. |
| `context --budget N` | `4000` | Token budget for a context query, whole number 1 to 100000. |
| `init --profile personal-local` | `personal-local` | Only that profile is accepted. |

The `--budget` value is `name=value` with a number. The name and the lower-only rule belong to the preset's compiler, so a misspelled name is refused after the command line is accepted.

## Built-in constants

### The `routine` preset

The preset is the constant that the run compiler copies into each contract. A digest of the whole preset is stored as the policy revision, so changing any value changes it. No file or variable changes a preset value; only budgets can be lowered, per run.

Budgets. An override can only lower a value: a value above the preset is refused. The name must be one of the seven below, and the number must be finite and above 0, and an integer where marked.

| Budget | Preset | Override name | Integer |
|---|---|---|---|
| Wall clock | 60 minutes per run | `wallClockMinutes` | yes |
| Invocations | 3 (one unit, one discard-and-retry, one relaunch after an interruption) | `invocations` | yes |
| Tool calls | 400 | `toolCalls` | yes |
| Subagents, total | 10 (a planner, up to two plan checkers, an executor and a verifier make 5 per unit; two rounds) | `subagentsTotal` | yes |
| Subagents, concurrent | 2 | `subagentsConcurrent` | yes |
| Cost per invocation | 2.0 USD | `costUsdPerInvocation` | no |
| Cost per run | 5.0 USD (estimated) | `costUsdPerRun` | no |
| Retry | 1 | not overridable | not applicable |
| Repair attempts per check | 0 | not overridable | not applicable |

Two consistency adjustments run after the overrides and are recorded in the contract. A per-invocation cost above the per-run cost is lowered to it, and a concurrent subagent cap above the total is lowered to it. A killed or interrupted invocation is charged its full reservation, the smaller of the per-invocation cap and what is left of the run's cost, and nothing is refunded. The retry count is read by the retry logic. The repair-attempt count is recorded and read by nothing.

Other values:

| Value | Setting | Read at run time |
|---|---|---|
| Policy name | `routine` | yes, the only accepted `--policy` |
| Default size and models | size `medium`; `small` haiku, `medium` sonnet, `large` opus | the work item's model is read; the size-to-model map in the contract is recorded only |
| Protected paths | `.avarice/**`, `.github/**`, `.claude/**`, `.git/**`, `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `.gitignore`, `CLAUDE.md`, plus the conventions' `paths.protected` | yes |
| Run artifacts | `.planning/quick/**`, `.planning/STATE.md`, `.planning/config.json`, plus the conventions' `paths.artifacts` and every check's `writes` | yes |
| Always protected from the agent | `.git/**` and `.planning/config.json`, added when the agent's scope is built | yes |
| Secret globs (read denied) | `**/*.key`, `**/*.pem`, `**/.env`, `**/.env.*`, `**/id_ed25519*`, `**/id_rsa*` | yes |
| Read scope | everything (`**`), read-exclude `.git` | the read-exclude list is recorded only |
| Escalation: consecutive denials | 3 | yes, by the hook |
| Escalation: consecutive searches | 25 | yes, by the hook |
| Escalation: no-progress invocations | 2 | dead: recorded, read by nothing |
| Tool classes | `read`, `search`, `edit`, `write`, `shell`, `subagent` | recorded only |
| Decisions, delegated | internal naming, test structure, refactors inside write paths | recorded only |
| Decisions, human | user-visible behavior changes, new dependencies, public API changes, scope expansion, acceptance criteria changes | recorded only |
| Decisions, prohibited | policy changes, budget changes, credential changes, merge, push | recorded only |
| Delivery | endpoint `ready_for_review`, hand-off `local-branch`, no push, no draft change request | recorded only; the hand-off in code is fixed |
| Notification | `local` for review-ready and blocking events | recorded only |
| Verification | GSD verifier `required-passed`, baseline `delta`, per-item `required-checks`, integrity gates `no-new-overrides`, `no-test-deletion`, `no-skip-markers`, `scope-conformance`, `prune-is-decision` | recorded only; the gates run from code, not from this list |

The loop limits are prevention. At 25 searches in a row with no read, edit or write between, the next search is refused. At 3 denials in a row, the third denial is the one that reaches the limit. In both cases the invocation is also stopped and a loop-limit event is appended. A limit of zero would turn that control off; the preset has none. What each setting does is described in [runs.md](runs.md), and the hook rules are in [containment.md](containment.md).

### Run limits

| Constant | Value |
|---|---|
| Staleness: commits | at most 25 commits past the onboarded revision outside `.avarice/` and `.planning/`; more refuses the start (`stale-commits`) |
| Staleness: age | the oldest such commit at most 14 days old; older refuses the start (`stale-age`) |
| Start refusal order | `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning`; the first that applies is reported |
| Brief file | 64 KiB; 4096 characters per line; title 1 to 200 characters; at most 128 items per list section; at most 20 acceptance criteria; `expectedDecisions` 0 to 1000 (format in [runs.md](runs.md)) |
| Conventions file | 262144 bytes read; 500 commits walked |
| Run prompt | 32 KiB for the whole `/gsd-quick` prompt; the context pack is cut to fit, the contract text never is |
| Context pack in a run | 4000 tokens |
| Quick record read | 64 KiB; a larger record counts as a verifier verdict of gaps found, which can only block |
| Quick record archive | 2 MiB per changed artifact file; a larger file makes the classification step return an error |
| Blocked issue text | 1000 characters |
| Wait margins | `start --wait` polls every 250 ms for the wall-clock budget plus 15 minutes; `resume --wait` polls every 250 ms for 24 hours |
| Lease | 180000 ms, renewed every third (override `AVARICE_LEASE_TTL_MS`) |
| Hook command length | a shell command over 16384 characters is denied |
| Hook edit fingerprint | a file over 8 MiB is fingerprinted by size and modified time, not content |
| Dependency install | timeout 15 minutes; lockfile read cap 32 MiB; at most 20 grouped network attempts kept |
| Test inventory | list command 120 s; at most 50000 test IDs of 500 characters each; at most 20000 test files of 4 MiB each |
| Check validation | at most 20 unexpected paths and 10 hosts kept |
| Check output | 5 MiB per stream, then cut with a marker |
| Run branch hand-off | fetch 120 s; tree and snapshot calls 120 s; at most 10000 ignored entries listed; the snapshot step record stores 200 of them and the total count |

### The sandboxed executor and the egress proxy

The sandbox runs a command under `/usr/bin/sandbox-exec` with a generated profile. The profile denies all network and all writes, then allows the declared paths back. The only network rule is outbound connections to `localhost:<port>` for each port the command asks for. A port must be an integer from 1 to 65535, or the command is refused. Only AVARICE's own supervisor steps ask for a port, never an agent invocation: the agent's generated settings allow no network domain and no loopback port.

| Setting | Value |
|---|---|
| Port the sandbox allows | the one port of the step's proxy; none for a command that gets no proxy |
| Proxy bind address | `127.0.0.1` only |
| Proxy port | chosen by the operating system for each step (ephemeral); there is no fixed or configurable port |
| Proxy lifetime | one step: started before the command, closed after it |
| Accepted request | `CONNECT host:port` to an exact entry of the allowlist, host compared lower-case |
| Target form | DNS name or IPv4 literal and a decimal port from 1 to 65535 |
| Answers | 200 to an allowed target; 403 to any other target; 400 to a malformed target; 405 to a request that is not `CONNECT`; 502 when the upstream connection fails before it opens |
| Allowlist entry | exact `host:port`; an entry that is not is refused when the proxy starts |
| Start failure | the proxy could not listen: reported as unavailable |
| What is recorded | host and port of every attempt and whether it was allowed, never a path or header |
| Dependency install | allowlist is each `registryHosts` entry on port 443 |
| Check validation | allowlist is empty; the proxy only records attempts |

For the dependency install the proxy prevents: a connection to any host not on the allowlist is answered 403, and the sandbox gives no other route. A refused attempt then blocks the run as a decision. For check validation the proxy detects. Every attempt is refused, and the verdict comes from the recorded hosts and from the sandbox's own error text in the check output. A check that attempts the network is `rejected` and not activated. When the validation proxy cannot start, the check runs with no loopback port at all, and only the error text can reveal an attempt.

### Admitted versions and gates

| Constant | Value |
|---|---|
| Claude Code versions | `2.1.312`, `2.1.316`, `2.1.317`, `2.1.318`; any other reported version is refused |
| gsd-core | package `@opengsd/gsd-core`, version matching `1.17.x` |
| Node | `>=22.22.3` declared in the package manifest; not compared at runtime |
| Bundled SQLite | accepted from 3.44.6 on the 3.44 line, 3.50.7 on 3.50, 3.51.3 on 3.51, and any later line; 3.45 to 3.49, older versions and unreadable version strings are refused |
| Sandbox | macOS `sandbox-exec` at the fixed path `/usr/bin/sandbox-exec`; absence marks the host unavailable |
| Node warning | the launcher suppresses the experimental warning |
| Commit identity | name `AVARICE`, email `avarice@localhost.invalid`, unsigned, hooks skipped; a constant, not configurable |

### The onboarding preset

Overrides can only lower a value: a value above the preset is refused. Names must be one of the eight below, numbers finite and non-negative, integers where marked.

| Budget | Preset | Override name | Integer |
|---|---|---|---|
| Wall clock | 45 minutes (shares: map 20, intel 10, knowledge 15) | `wallClockMinutes` | yes |
| Tool calls | 600 | `toolCalls` | yes |
| Concurrent subagents | 4 | `subagentsConcurrent` | yes |
| Total subagents | derived from mapping mode and retry | `subagentsTotal` | yes |
| Invocations | derived from mapping mode and retry | `invocations` | yes |
| Cost per invocation | 3.0 USD | `costUsdPerInvocation` | no |
| Cost per run | 12.0 USD (estimated) | `costUsdPerRun` | no |
| Retry | 1 | `retry` | yes |

Subagents per map round: full 4, fast 1, paths 4, skip 0, adopt 0; the knowledge pass and intel add none. The contract also fixes the model (`haiku`), the read-excluded directories (`.git`, `build`, `coverage`, `dist`, `node_modules`, `vendor`), the secret globs (`**/*.key`, `**/*.pem`, `**/.env`, `**/.env.*`, `**/id_ed25519*`, `**/id_rsa*`) and the read-only command list. The source states that changing any preset value changes the policy revision. How the derived totals are computed is in [onboarding.md](onboarding.md).

The two presets differ in two override rules: a run override must be above 0 where an onboarding override may be 0, and a run has no `retry` override.

### Timeouts and size limits

Only limits that surface to an operator as a refusal, a timeout or a cut are listed. The run-specific ones are in the run limits table above.

| Constant | Value |
|---|---|
| Lease TTL | 180000 ms (override `AVARICE_LEASE_TTL_MS`) |
| Ledger busy timeout | 5 s (the hook waits 4 s) |
| Sandboxed command kill grace | 5 s after SIGTERM |
| Map document cap | 1 MiB per document read back |
| Intel file cap | 4 MiB per intel file read back |
| Git call timeout | 10 s default; clone and detached checkout 120 s; listing 60 s |
| Git output buffer | 64 MiB |
| gsd-core tool timeout | 15 s default; identity probe 5 s; output cap 16 MiB |
| Graphify | extract 300 s, cluster 120 s, version 15 s; graph size cap 64 MiB |
| Host kill grace | 10 s; transcript cap 20 MiB; stream line cap 16 MiB |
| Host preflight probe timeout | 10 s |
| Hook | stdin cap 1 MiB; database busy timeout 4 s |
| Event caps | string 1024 characters; JSON 8192 characters |
| Context query budget | default 4000, max 100000 tokens |
| Proposal file | 65536 bytes |
| Installed skill | an existing `SKILL.md` over 256 KiB is not one AVARICE wrote and is left untouched |
| Shell history | `shell-history` in the data root, mode 0600, at most 1000 lines, oldest dropped |
| Shell live view | the ledger is read again every 1000 ms; width 100 columns when the terminal reports none |

## Quirks

- An empty `AVARICE_FAULT` is read as "set", an empty `AVARICE_RUN` counts as set, and an empty `NO_COLOR` counts as set. Every other variable treats empty as unset or, for the lease TTL, as invalid and therefore the default.
- `AVARICE_LEASE_TTL_MS` falls back to the default for any invalid value without a message.
- `AVARICE_RUN` is read at only three places. `start`, `supervise` and the other commands do not look at it, so it blocks only the shell and `install-host`.
- Children differ in how they get `PATH`: git falls back to a fixed `PATH` only when the parent's is empty, while graphify and the host build their own `PATH` regardless of the parent.
- A run host and a run's checks differ in home and temp. The host keeps the forwarded `HOME` and gets `TMPDIR` at `<scratch>/tmp`. Checks, install and list commands get both set to the scratch directory itself.
- A check's `env` cannot change `CI`, `LANG` or the other sandbox names, although only the reserved names and prefixes listed above are refused at parse, and `CI`, `LANG` and the rest of the sandbox names are not. The sandbox value silently wins.
- `AVARICE_GRAPHIFY_BIN` set to a bad path disables the `PATH` search.
- Sandboxed supervisor commands (checks, install, list) deny reading the credential locations of the home directory (listed in [containment.md](containment.md#generated-settings-in-effect)), the data root and the three default AVARICE parent directories. They then allow back the run's own clone and scratch. A work root or config home placed elsewhere by an environment variable is not denied by name, except the data root.
- The preset records values that no code reads back: the no-progress limit, the decision lists, the tool classes, delivery, notification, the verification list and the repair-attempt count. Changing them would change only the policy revision.
- The install proxy admits only port-443 targets, so a registry that needs another port or plain HTTP cannot be reached.
- The same `.avarice/config.json` produces onboarding findings for every key the run reader needs. They do not affect a run.
