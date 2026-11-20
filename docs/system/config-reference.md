# Configuration reference

This document describes every configuration input AVARICE reads and every built-in limit that acts as configuration. The inputs are the environment variables that the `avarice` CLI, its detached supervisor and its hook read and set. They also include the profile `config.json`, the repository-side `.avarice/config.json` and `.planning/config.json`, the `routine` and `onboarding` presets, and the sandbox and egress-proxy settings. The sources are the profile and root resolution and the section readers (`src/domain/profile.ts`, `src/adapters/fs/profile-paths.ts`, `src/adapters/fs/profile-config.ts`, `src/domain/notify-policy.ts`, `src/domain/resource-bounds.ts`, `src/domain/retrieval-rules.ts`, `src/domain/context-adapters.ts`, `src/domain/credential-ref.ts`, `src/domain/redactor.ts`). They also include the repository conventions and the run contract (`src/domain/conventions.ts`, `src/domain/run-contract.ts`, `src/domain/run-preflight.ts`, `src/domain/policy-narrowing.ts`), the run services (`src/app/`), the host, executor and proxy adapters (`src/adapters/`), and the CLI (`src/cli/`).

## Summary

- AVARICE reads 11 `AVARICE_*` variables and sets 5: `AVARICE_RUN` for the contained host, and `AVARICE_PROFILE` with the three root variables for the detached run supervisor. It reads 10 other variables: `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `NO_COLOR` and `TERM`. Eight more `AVARICE_*` names in the source are constants, not variables: `AVARICE_WRITE_SET`, `AVARICE_TRACKED_WRITABLE`, `AVARICE_SECRET_PATTERNS`, `AVARICE_COMMIT_IDENTITY`, `AVARICE_EXECUTOR_ADDENDUM`, `AVARICE_VERIFIER_ADDENDUM`, `AVARICE_RUN_SHELL_ADDENDUM` and `AVARICE_RUN_SKILL`.
- `PYTHONDONTWRITEBYTECODE`, the proxy variables, `CI` and the `GIT_*` variables are set for child processes and never read. `NO_COLOR` is both read (by the CLI) and set (for graphify).
- Each profile has one `config.json` with a closed set of 14 keys. AVARICE writes four of them once, when it creates the file, and reads every key back; `workspaceRoots` and `freshnessWindowHours` are in the set and read by nothing, so they are dead knobs. The sections the owner writes by hand are `notify`, `limits`, `retrieval`, `credentials`, `adapters`, `retention`, `policy` and `remotePatterns`. The effective roots come from the environment variable, then the file, then a default that carries the profile's name.
- The repository's `.avarice/config.json` is the only configuration file AVARICE parses, as untrusted data that can only narrow authority. Two readers parse it for different purposes and accept different keys. `.planning/config.json` is written by gsd-core in the working copy and is never parsed by AVARICE.
- Resource limits and retrieval caps are profile settings (the `limits` and `retrieval` sections). Versions and the budgets of a run or an onboarding are built-in constants. A run's budgets are lowered per run only through `avarice start --budget name=value`, and an onboarding's through `avarice onboard --budget name=value`.
- The sandboxed executor listens on no port. Its only network allowance is outbound connections to loopback ports that an AVARICE supervisor step names. The only listener is a per-step allowlist proxy on an operating-system-chosen port of 127.0.0.1.

## Environment variables AVARICE reads

Every row names a read on a production path unless marked otherwise. An empty value counts as unset for every variable below except `AVARICE_FAULT`, `AVARICE_RUN` and `NO_COLOR` (see their rows).

| Variable | Default | Effect | Usage |
|---|---|---|---|
| `AVARICE_CONFIG_HOME` | `~/.config/avarice` | Directory that holds the profile config file. Resolved to an absolute path. | Set to relocate the config. It must not sit under any `~/.claude*` directory or under the real path of `CLAUDE_CONFIG_DIR`, and must not nest with the other roots; otherwise every command that opens the profile refuses. |
| `AVARICE_PROFILE` | unset (then `personal-local`) | The profile a command runs under when no `--profile` flag is given and the repository is not bound to one. | Set to work under a profile other than the default. It must follow the profile grammar (`personal-local`, `personal-extended`, `enterprise-<org>`) when it is the value that would be chosen, otherwise the command exits 64. It is ignored for a repository bound to a profile. The detached supervisor and the digest LaunchAgent receive it from the command that started them. |
| `AVARICE_DEBUG_TRANSCRIPTS` | unset | The value `1` stores the whole redacted transcript of every host invocation, as the profile's `retention.transcripts: "full"` does. | Any other value, including an empty one, leaves the profile's `retention` in force. Read where the host is launched (see [profiles-and-credentials.md](profiles-and-credentials.md#transcript-retention)). |
| `AVARICE_DATA_ROOT` | `~/.local/share/avarice/<profile>` | Directory that holds the ledger database (`state.db`), artifacts, run contract files, the shell history and per-invocation files. Created with mode 0700. | Set to move state. It must be on a local mount: a network or non-local mount is refused because SQLite WAL is unsafe there. The same placement rules as the config home apply. |
| `AVARICE_WORK_ROOT` | `~/.local/share/avarice-work/<profile>` | Directory for staging workspaces and for each run's clone and scratch directory. Created with mode 0700. | Set to move staging and run clones. Same placement rules as the config home. Under a custom value the supervisor's own sandboxed commands deny it less completely (see the quirks). |
| `AVARICE_CLAUDE_BIN` | first `claude` on `PATH` | Absolute path of the `claude` executable used as the contained host. | Set when `claude` is not on `PATH` or to pin one install. When neither resolves, the host is unavailable: an onboarding is blocked with reason `enforcement_failure` at the workspace stage's enforcement check, and the reason (`claude was not found ...`) is recorded in the host descriptor. The same fallback applies when no admitted gsd-core is located, the GSD shim preamble is missing, the sandbox is unusable or the version is not admitted. The binary must report an admitted version (see built-in constants). |
| `AVARICE_HOOK_ENTRY` | the `pre-tool-use` hook script of this checkout | Path of the hook program written into the host settings. | Override only to substitute a hook; the host is launched with whatever this names. A self-test of the hook runs before launch. |
| `AVARICE_GRAPHIFY_BIN` | first `graphify` on `PATH` | Path of the `graphify` executable for code extraction and the knowledge pass. | When set and non-empty it is the only candidate: if it names no executable file, graphify is reported missing and `PATH` is not tried. Only absolute `PATH` entries are searched. A missing graphify does not fail startup; it fails the index step that needs it. |
| `AVARICE_LEASE_TTL_MS` | `180000` | Lease time-to-live, in milliseconds, for an onboarding and for a run supervisor. The lease is renewed every third of the TTL (at least 1 ms). | Read on the production path, but used as a test seam (short leases for fault tests). A value that is not a positive safe integer, including an empty one, silently falls back to the default. |
| `AVARICE_FAULT` | unset | Kills the process with SIGKILL when execution reaches the named checkpoint (`name`, or `name#N` for the Nth arrival). | Test-only fault injection, but the read is on the production path: an operator who sets it gets a SIGKILL with no cleanup. The run supervisor also fires checkpoints named `after-checkpoint:<action>` and `after-transition:<state>`. Do not set it outside tests. Unlike the other variables an empty value is not treated as unset (it matches no checkpoint). |
| `AVARICE_RUN` | unset | The run marker. Any value, including an empty one, counts as set. | Not for operators to set. The host launch sets it (next section). While set, bare `avarice` does not open the interactive shell and exits 64 with the usage text, the shell refuses to open, and `install-host`, `digest`, `contract amend`, `decide`, `cancel`, `schedule`, `approve`, `context add`, `evidence add` and `pr record` are refused with exit 64. No other command reads it. A process can unset it, so it is a guard against accidental use, not a containment control; the owner commands also judge the process tree (see [containment.md](containment.md#owner-commands-and-the-terminal-identity-rule)). |
| `HOME` | the OS home directory | Base for the default roots, the gsd-core candidate `~/.claude/gsd-core`, the default `~/.claude` config directory and the default skill directory of `install-host`. It is also the base of the credential locations that sandboxed commands may not read, and it is forwarded to children. | Normally inherited. Empty is treated as unset for AVARICE's own path resolution. |
| `PATH` | none (see children) | Search path for `claude` and `graphify` (absolute entries only for graphify). Forwarded to git children. Its value is also appended to the directory of the running Node binary to form the `PATH` of check, install and list commands. | Must contain `git`; the git child falls back to a fixed path list only when `PATH` is empty. The check sandbox falls back to `/usr/bin:/bin` when `PATH` is unset. |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Host configuration directory. Used for the root placement rules, for the gsd-core candidate `<dir>/gsd-core`, as the skills root for the host, as the default target of `install-host`, and forwarded to the host and gsd-core. | Set when Claude Code is installed in a nondefault directory. `install-host --config-dir` overrides it. |
| `GSD_HOME` | unset | First gsd-core candidate directory. | Set to pin a gsd-core install. A candidate that is found but not admitted is an error; later candidates are not tried. |
| `USER`, `LOGNAME` | unset | Forwarded to gsd-core processes, the host and the host probes (the host's macOS credential lookup needs `USER`). | Read only for forwarding. |
| `LANG` | `C` for git; unset otherwise | Forwarded to git (default `C`), gsd-core, graphify, the host and the probes. | Read only for forwarding. |
| `TMPDIR` | OS default | Forwarded to gsd-core, graphify, an onboarding host and the probes. The OS temp directory is also used for graphify's version probe, the gsd-core identity probe and the hook self-test scratch directory. A run's host gets its own `TMPDIR` instead (next section). | Read only for forwarding and temp-directory choice. |
| `NO_COLOR` | unset | Any value, including an empty one, turns colour and cursor escapes off. | Standard convention. Colour is on only when the stream is a terminal, `NO_COLOR` is unset and `TERM` is not `dumb`. |
| `TERM` | unset | `dumb` selects the plain line mode of the interactive shell and turns colour off. | Any other value, or none, leaves the full-screen mode and colour on when the streams are terminals. |

Test-only seams: `AVARICE_FAKE_HOST` is read only by the test fake host. `AVARICE_TEST_NOTIFIER` is read only by the test entry point, which then keeps the real osascript notifier (pointed at a fake script by the profile's `notify.local.osascriptPath`) instead of a silent one. `AVARICE_TEST_REMOTE=1` makes the test entry point replace the executor and the artifact store with the fake-remote adapters (see [portability.md](portability.md#fake-remote-adapters)), and three variables shape them: `AVARICE_TEST_REMOTE_SEED` (a non-negative integer, default 42, the seed of the fault source), `AVARICE_TEST_REMOTE_LOG` (a file that receives every drop, duplicate and run as one JSON line) and `AVARICE_TEST_REMOTE_ROOT` (the data root of the store that plays the remote, by default the data root with `-remote` appended). The live-spend tooling of the test suite reads `AVARICE_PHASE4_CEILING_USD` (lowers the live-model spend ceiling of 40 USD and never raises it; a value that is not a positive number is ignored), `AVARICE_PHASE4_LEDGER` (the file the spend is recorded in) and `AVARICE_PHASE4_PLAN` (the plan name new spend is recorded under). Nothing in the shipped source references any of them, so none has any effect on the CLI. The notify keys of the profile config are in "Profile config file".

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
| run supervisor (detached) | the whole environment of the starting command, with four overrides, a fifth for a run that recorded a host configuration directory, and `NODE_TEST_CONTEXT` removed | `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT` and `AVARICE_WORK_ROOT` are set to the roots the starting command resolved, whatever the environment said, and `AVARICE_PROFILE` to the profile it selected, because a supervisor has no repository to read a binding from. `CLAUDE_CONFIG_DIR` is set to the directory the run recorded when it started, so every supervisor of the run, from whichever terminal, runs the host under the same one; a run that recorded none keeps the command's value. `NODE_TEST_CONTEXT` is dropped so a test entry does not do nothing. The supervisor then builds every child environment as in the rows above. |
| hook | none set | The hook is started by the host and inherits the host environment above. |
| `osascript`, `launchctl`, `plutil` (banner and schedule) | none set | Started with an argument list and no `env` option, so each inherits the whole environment of the AVARICE process that starts it. They are the owner's own tools, run outside any sandbox. |
| digest LaunchAgent (launchd) | `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`, `AVARICE_PROFILE` | Written into the agent's property list by `schedule install` from the roots and the profile the command selected, and the only variables it writes, so the scheduled `avarice digest` reads the same profile as the command that installed it. |

Every sandboxed command runs with exactly the environment it is given: the executor inherits nothing.

## Profile config file

Location: `<config home>/profiles/<profile>/config.json`, mode 0600, one file per profile. It is created when absent, by any command that opens the profile (not only `avarice init`), holding `schema`, `profile`, `dataRoot` and `workRoot`, and it is never rewritten. After that the owner edits it by hand and every command reads it back. It is opened without following a symbolic link and used only as a regular file of at most 64 KiB; a missing file means every default. `avarice init` only reports it. Who reads each key, what a bad section stops, and how profiles are selected are in [profiles-and-credentials.md](profiles-and-credentials.md#the-configuration-file).

The key set is closed: a key outside the table is refused by name. Sections stay raw until the module that owns them parses them, so a bad value is reported by the command that reads it.

| Key | Type | Default | Constraint | Usage |
|---|---|---|---|---|
| `schema` | number | `1` (may be left out of a hand-written file) | Must be `1`. | Checked and nothing else. |
| `profile` | string, or `{ id, class }` | the selected profile (may be left out) | Must name the selected profile, and the class must be the one its name has. | Checked and nothing else. |
| `dataRoot` | string | `~/.local/share/avarice/<profile>` | An absolute path or one that starts with `~/`, at most 4096 characters, no control character. A relative path is refused. | Where the ledger, artifacts and run contract files live. The variable `AVARICE_DATA_ROOT` wins over it. |
| `workRoot` | string | `~/.local/share/avarice-work/<profile>` | The same. | Where clones and scratch live. `AVARICE_WORK_ROOT` wins over it. |
| `notify` | object | see [The `notify` section](#the-notify-section) | Per that section. | Banner destinations, digest times, quiet hours. |
| `limits` | object | see [The `limits` section](#the-limits-section) | Per that section. | The six resource bounds. |
| `retrieval` | object | see [The `retrieval` section](#the-retrieval-section) | Per that section. | The nine retrieval caps. |
| `credentials` | object | none | Per [The `credentials` section](#the-credentials-section). | Named credential references and approved helpers. |
| `adapters` | object | see [The `adapters` section](#the-adapters-section) | Per that section. | Which context sources are built and whether the knowledge pass runs. |
| `retention` | object | `{ "transcripts": "summary" }` | `transcripts` is `summary` or `full`; any other value, or a non-object, is refused. | How much of a host transcript is stored (see [profiles-and-credentials.md](profiles-and-credentials.md#transcript-retention)). |
| `policy` | object | none | `organizationFile`: a path of at most 1024 characters with no control character, resolved against the directory of this file, read only for an enterprise profile. The remaining keys are a policy file's `schema` and `rules`, judged by the policy rules. | The organization policy file and the user's own policy (see [policy-and-approvals.md](policy-and-approvals.md#policy-sources-and-ranks)). |
| `remotePatterns` | list of strings | none | At most 64 entries, each 1 to 256 characters, in the form `host/path` with `*` for characters within one path segment. | The remotes an enterprise profile claims (see [profiles-and-credentials.md](profiles-and-credentials.md#selecting-a-profile)). |
| `workspaceRoots` | any | none | None. | Dead knob: in the key set and read by no code. |
| `freshnessWindowHours` | any | none | None. | Dead knob: in the key set and read by no code. |

The roots come from the environment variable, then the configuration key, then the default, on every run. Placement rules for them are in [profiles-and-credentials.md](profiles-and-credentials.md#roots-and-isolation).

### The `limits` section

An object of limit names to whole numbers above 0, parsed as a whole: an unknown name, a value that is not a whole number above 0 and a `maxConcurrentChecks` above 2 are refused, naming `limits.<key>`. A profile may raise or lower a limit within that. Nothing in a run's contract overrides a limit. A section that cannot be used does not stop composition: the defaults stay in force so a typo never removes a bound, `start` refuses the run, and `doctor` names the section.

| Key | Default | Unit | Effect when reached |
|---|---|---|---|
| `contextTokens` | 24000 | tokens (four characters each) | The ceiling of a run's context pack and the default budget of `avarice context`. A run's pack is also bound by the room the 32 KiB prompt leaves, so the smaller of the two applies (see [The context pack budget](#the-context-pack-budget)). Past it the pack drops its lowest-ranked items and lists them as omitted. |
| `maxConcurrentChecks` | 1 | checks | The checks of one run that may run at once; at most 2, because they share one clone. Further checks wait in a queue in the supervisor and start in declaration order. |
| `artifactQuotaMiB` | 2048 | MiB | Stored artifact bytes per profile. A new blob that would pass the quota is refused before anything is written and nothing records a pointer to it. The count is taken when the process starts, so the quota stops runaway growth and is not an exact ledger. |
| `maxActiveRuns` | 20 | runs | Runs that have not ended (not failed, cancelled or closed). At the limit `start` is refused, before anything is created, and names up to ten of the runs. |
| `maxEventRows` | 500000 | rows | Rows of the events table after which a `debug` event is refused and counted in the meta key `events_dropped_debug`. An event at `info` or above is always written, and nothing prunes old rows. |
| `checkOutputBytes` | 5242880 | bytes of one stream | Bytes of one output stream of one check that are kept; the rest is cut with a marker. |

### The `retrieval` section

An object of cap names to whole numbers above 0, each at most the built-in value. An unknown name, a value that is not a whole number above 0 and a value above the built-in one are refused, naming `retrieval.<key>`: caps can only be lowered. A bad section refuses `start` and every query that reads it.

| Key | Built-in | Unit | What it bounds |
|---|---|---|---|
| `indexEntries` | 2000 | handles | Handles one source's search may return; more are cut and a note says so. |
| `returnedBytes` | 65536 | bytes | Bytes of excerpt text one source's answer may carry; the excerpts after the limit keep only a marker. |
| `searchHits` | 200 | hits | Hits of one scoped search. |
| `queryTimeoutMs` | 10000 | milliseconds | How long one search may run before it is abandoned. |
| `snippetLines` | 40 | lines | Lines in one bounded snippet. |
| `snippets` | 30 | snippets | Snippets read into one pack; later ones are listed as omitted. |
| `fullReads` | 20 | files per run | Whole-file reads a run may make. A run's contract may lower it with `--budget retrieval.fullReads`. |
| `fullReadBytes` | 262144 | bytes per run | Bytes of whole-file reads in all. A run's contract may lower it with `--budget retrieval.fullReadBytes`. |
| `maxPages` | 5 | pages | Pages of a source that declares itself paged. No local source does. |

A run's contract adds two retrieval counters of its own: `searches`, whose built-in limit is the run's tool-call limit and which `--budget retrieval.searches` may lower, and `broadDiscovery`, 1 when the brief authorizes it and 0 otherwise. The counters, the rows that hold them and the hook's rules for them are in [containment.md](containment.md#retrieval-budgets).

### The `credentials` section

An object whose keys are credential names, each a string reference, plus one reserved key `helpers`. A name is 1 to 128 letters, digits, `.`, `_` or `-`. A reference is `keychain:<service>`, `cmd:<helper name>` or `delegated:<cli>`, with the name after the colon following the same grammar; `env:` and any other scheme are refused. `helpers` maps a helper name to an absolute path of at most 1024 characters with no control character and no `.`, `..` or empty segment, and a `cmd:` reference runs only a helper listed there. Which providers a profile may use depends on its class (see [profiles-and-credentials.md](profiles-and-credentials.md#credentials)). A bad section stops every command that is not read-only with exit 70, naming `credentials.<key>`.

### The `adapters` section

| Key | Type | Default | Constraint | Usage |
|---|---|---|---|---|
| `adapters.context` | list of strings | `["gsd-intel", "gsd-graph", "gsd-planning", "git-files"]` | Each entry is one of those four names, once. An empty list is accepted and selects no source, so no pack is built. Anything that is not a list is refused. | The context sources composition builds, each recorded in `adapter_configs` as `context-<source>`. |
| `adapters.knowledgePass` | boolean | `true` | Any other type is refused. | `false` records the knowledge index step as disabled and starts no knowledge invocation during onboarding (see [onboarding.md](onboarding.md#index-stage)). |

A bad `adapters` section stops every command, read-only ones included, with exit 70.

### The context pack budget

A run's context pack is bound by two numbers, and the smaller is the budget: the profile's `limits.contextTokens`, and a quarter of the bytes the 32 KiB run prompt (32768 bytes) leaves after the unit's contract text and the fixed text around the pack. The second number is at most 8192 tokens and shrinks with the contract, so the default ceiling of 24000 does not bind a run's pack until the ceiling is set below the room. The step that records the pack holds both numbers and the tokens used, so a short pack says which bound applied. A pack that does not fit the prompt is cut from its end. `avarice context` has no prompt and uses `limits.contextTokens` as its default budget.

### The `notify` section

AVARICE never writes this section: the owner adds it by hand. It sets where a banner may go, when a digest runs and when banners are held. The behavior it configures is described in [autonomy-and-decisions.md](autonomy-and-decisions.md#notification). The file is read each time a banner, a digest or a schedule needs the settings, so an edit applies to the next one with no restart. There are two exceptions. The `osascriptPath` is read once when a command starts, so a supervisor already running keeps the path it started with. And launchd keeps the times that `schedule install` last wrote until it is run again.

A missing file or a missing `notify` section gives every default below, and a missing key inside the section takes its own default. The file is opened without following a symbolic link and must be a regular file of at most 65536 bytes holding a JSON object. Any other file, a section that is not an object and any key that this table does not list (in `notify` or in `notify.local`) is refused with the field and the reason. `schedule install` reports that as exit 64 and `digest` as exit 70.

| Key | Type | Default | Constraint | Usage |
|---|---|---|---|---|
| `notify.destinations` | array of strings | `["local"]` | Each entry must be `local`, the one destination built. A repeated name counts once. An empty array is accepted and posts no banner. | The profile's list of places a banner may go. A contract can only choose a subset of it; a destination the profile does not list is dropped, and a contract cannot add one. |
| `notify.digestTimes` | array of `HH:MM` strings | `["12:30", "17:30"]` | At most 6. Each is two digits for the hour (00 to 23), a colon and two for the minute (00 to 59). Sorted and de-duplicated. An empty array is accepted. | The local times at which launchd runs `avarice digest`. `schedule install` refuses an empty list. |
| `notify.quietHours` | string `HH:MM-HH:MM`, or `null` | `null` (off) | The two ends must differ. | A half-open range of local time that includes its start and excludes its end, and wraps past midnight when the start is later than the end. No banner is posted inside it; the rows are held for the next digest and the inbox still lists everything. |
| `notify.batchWindowMinutes` | integer | `10` | A whole number from 1 to 120. | How long the first queued notice of a run waits before the supervisor posts the queued notices as one banner, counted from the oldest queued notice. |
| `notify.local.osascriptPath` | string | `/usr/bin/osascript` | An absolute path of at most 1024 characters with no control character. | The program the local banner runs. |

A banner is posted only when both the contract's list for that kind of event and `notify.destinations` name the destination. The contract's own `notify` lists hold `local` for review-ready and blocking events and are not configurable; its `digest` list is always empty and nothing reads it, so a digest uses the profile's destinations.

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
| `env` | no | empty | Object of at most 32 variables. A name matches `[A-Z_][A-Z0-9_]*`, a value is a string of at most 1024 characters without NUL. | Non-secret environment for the check. The sandbox values override it (see the process environment section). At compile, every variable the check sandbox does not set itself must have a plain word as its value: letters, digits and `_@%+=:,./-`, possibly empty. The value must also match no secret pattern. Otherwise the start is refused as a compile error naming the variable, because the value is also written to the agent as a leading `NAME=value` word and compared word for word. |
| `writes` | no | empty | Array of at most 128 globs. | Paths the check may write besides the scratch directory; they become run artifacts. |

Reserved check environment names are refused at parse. `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `BASH_ENV`, `ENV`, `SHELL`, `IFS`, compared as written. Any name starting with `DYLD_`, `LD_` or `npm_config_` is also refused, compared without regard to case. The same names are refused as the leading assignment of an `agentCommands` entry.

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
- The entry may begin with assignment words `NAME=value`, and the words after them are the command. Each assignment must name an upper-case variable that matches `[A-Z_][A-Z0-9_]*` and is not reserved (the list and prefixes above). Its value must be a plain word (letters, digits and `_@%+=:,./-`, possibly empty) that matches no secret pattern. A program word must follow the assignments, and it is not `<paths>`. Any other assignment makes the conventions invalid.
- The program word is the first word after any assignments. By its last path segment and without regard to case, it is not one of `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` or `sudo`. An assignment never hides it. At compile, each check's argument vector, joined by spaces, must pass this rule too.

The contract lists each required check and each target check of the brief as an agent command. The command is written as its environment in `NAME=value` words sorted by name (leaving out the names the check sandbox sets), followed by its argument vector. See [containment.md](containment.md#command-identity-bash) for how the hook matches such a command.

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
| `--profile <name>` (every command) | `AVARICE_PROFILE`, else `personal-local` | The profile the command runs under; `repo add --profile` also binds the repository to it. |
| `onboard --mode full\|fast` | `full` | Mapping mode. |
| `onboard --restricted` | off | Maps fast under the restricted launch, for a host that cannot be contained; conflicts with `--mode full`. |
| `onboard --promote none\|copy\|commit` | `none` | What happens to the accepted map after activation; any other value is refused. |
| `onboard --budget name=value` (repeatable) | none | Lowers an onboarding budget; see the onboarding preset. |
| `start --brief <file>` | required | The brief file; see the run limits for its caps. |
| `start --policy routine` | required | The only run policy. |
| `start --project <id>` | the registered repository that contains the current directory | Names the project instead. |
| `start --budget name=value` (repeatable) | none | Lowers a run budget; see the routine preset. The three retrieval caps `retrieval.searches`, `retrieval.fullReads` and `retrieval.fullReadBytes` are among the names. |
| `start --restricted` | off | Starts the run in restricted mode: analysis and planning only. |
| `start --wait` | off | Follows the run for at most its wall-clock budget plus 15 minutes. |
| `resume <id> --wait` | off | Follows a resumed run for at most 24 hours. |
| `decide <id> ... --wait` | off | Follows a supervisor that `decide` started, for at most 24 hours. |
| `cancel <id> --wait` | off | Follows a cancel that a supervisor carries out, for at most 24 hours. |
| `contract amend <run> --budget name=value` (repeatable) | none | Changes a budget of a running contract, up or down. It is the one way a limit rises. |
| `install-host --config-dir <dir>` | the `CLAUDE_CONFIG_DIR` value, else `~/.claude` | Directory that receives the `avarice-run` skill and the attended hook entry in `settings.json`. |
| `context --budget N` | the profile's `limits.contextTokens` (24000) | Token budget for a context query, whole number 1 to 100000. |
| `init --profile <name>` | `personal-local` | Any name that follows the profile grammar. |
| `doctor --json\|--online\|--repair\|--extensions` | off | Output form and the extra sections of the diagnosis (see [doctor.md](doctor.md#the-command)). |

The `--budget` value is `name=value` with a number. The name and the lower-only rule belong to the preset's compiler, so a misspelled name is refused after the command line is accepted.

## Built-in constants

### The `routine` preset

The preset is the constant that the run compiler copies into each contract. A digest of the whole preset is stored as the policy revision, so changing any value changes it. No file or variable changes a preset value. A run's budgets can be lowered when it starts, and a contract amendment can raise or lower them afterwards; neither changes the preset.

Budgets. The limits that scale grow with the number of work items n in the brief. A start override can only lower a value: a value above the limit the preset gives for n items is refused. The name must be one of the seven below, and the number must be finite and above 0, and an integer where marked. Only a contract amendment raises a limit.

| Budget | Preset | Override name | Integer |
|---|---|---|---|
| Wall clock | 120 minutes per run | `wallClockMinutes` | yes |
| Invocations | `2n + 1`: two per item (its unit and one retry or repair) and one relaunch after an interruption | `invocations` | yes |
| Tool calls | `400n` | `toolCalls` | yes |
| Subagents, total | `10n` (a planner, up to two plan checkers, an executor and a verifier make 5 per unit; two rounds) | `subagentsTotal` | yes |
| Subagents, concurrent | 2 | `subagentsConcurrent` | yes |
| Cost per invocation | 2.0 USD | `costUsdPerInvocation` | no |
| Cost per run | 10.0 USD (estimated) | `costUsdPerRun` | no |
| Retry | 1 | not overridable | not applicable |
| Repair attempts per check | 1 | not overridable | not applicable |

Two consistency adjustments run after the overrides and are recorded in the contract. A per-invocation cost above the per-run cost is lowered to it, and a concurrent subagent cap above the total is lowered to it. A killed or interrupted invocation is charged its full reservation, the smaller of the per-invocation cap and what is left of the run's cost, and nothing is refunded. The retry count is read by the retry logic. The repair-attempt count is read by the repair rule: a required check that passed when an item began and fails after it gets that many repair units on the same item, and then a decision.

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
| Decisions, delegated | internal naming, test structure, refactors inside write paths | yes: the unit prompt lists them as choices the unit may make, and the decision classifier takes them as input (its delegated path has no caller, see [autonomy-and-decisions.md](autonomy-and-decisions.md#quirks)) |
| Decisions, human | user-visible behavior changes, new dependencies, public API changes, scope expansion, acceptance criteria changes | yes: the unit prompt lists them as choices to ask the owner about, and the decision classifier takes them as input |
| Decisions, prohibited | policy changes, budget changes, credential changes, merge, push | recorded only |
| Delivery | endpoint `ready_for_review`, hand-off `local-branch`, no push, no draft change request | recorded only; the hand-off in code is fixed |
| Notification | `local` for review-ready and blocking events; the digest list is empty | the review-ready and blocking lists, yes: a banner goes only to a destination that this list and the profile's `notify.destinations` both name; the digest list is read by nothing |
| Verification | GSD verifier `required-passed`, baseline `delta`, per-item `required-checks`, integrity gates `no-new-overrides`, `no-test-deletion`, `no-skip-markers`, `scope-conformance`, `prune-is-decision` | the integrity gate names, yes: a failed gate's event lists which of them it broke (see [checks-and-evidence.md](checks-and-evidence.md#the-integrity-gates)); the rest are recorded only, and the gates run from code, not from this list |

The loop limits are prevention. At 25 searches in a row with no read, edit or write between, the next search is refused. At 3 denials in a row, the third denial is the one that reaches the limit. In both cases the invocation is also stopped and a loop-limit event is appended. A limit of zero would turn that control off; the preset has none. What each setting does is described in [runs.md](runs.md), and the hook rules are in [containment.md](containment.md).

### Run limits

| Constant | Value |
|---|---|
| Staleness: commits | at most 25 commits past the onboarded revision outside `.avarice/` and `.planning/`; more refuses the start (`stale-commits`) |
| Staleness: age | the oldest such commit at most 14 days old; older refuses the start (`stale-age`) |
| Start refusal order | `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning`; the first that applies is reported. `record-incompatible`, `restricted-record` and `active-runs` are judged before them (see [cli-reference.md](cli-reference.md#start)). |
| Brief file | 64 KiB; 4096 characters per line; title 1 to 200 characters; at most 128 items per list section; at most 20 work items; at most 20 acceptance criteria; `expectedDecisions` 0 to 1000 (format in [runs.md](runs.md)) |
| Conventions file | 262144 bytes read; 500 commits walked |
| Run prompt | 32 KiB for the whole `/gsd-quick` prompt; the context pack is cut to fit, the contract text never is |
| Context pack in a run | the smaller of `limits.contextTokens` and a quarter of what the 32 KiB prompt leaves, so at most 8192 tokens (see [The context pack budget](#the-context-pack-budget)) |
| Quick record read | 64 KiB; a larger record counts as a verifier verdict of gaps found, which can only block |
| Quick record archive | 2 MiB per changed artifact file; a larger file makes the classification step return an error |
| Blocked issue text | 1000 characters |
| Wait margins | `start --wait` polls every 250 ms for the wall-clock budget plus 15 minutes; `resume --wait` polls every 250 ms for 24 hours |
| Lease | 180000 ms, renewed every third (override `AVARICE_LEASE_TTL_MS`) |
| Cancel lease | the lease `cancel` takes when no supervisor holds one: at most 60 s, or the lease time-to-live when that is shorter |
| Wait margins, decide and cancel | `decide --wait` polls every 250 ms and `cancel --wait` every 200 ms, each for at most 24 hours |
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
| Claude Code versions | Verified: `2.1.312`, `2.1.316`, `2.1.317`, `2.1.318`, `2.1.319`, `2.1.326`. A patch of the verified minor 2.1 at or above 2.1.312 that is not listed is admitted as an unverified patch when `claude --help` still lists every flag the contained launch line uses. Any other version is refused: `host-minor-unverified` (a minor with no verified patch), `host-patch-below-range` (a patch under 312), `host-version-unknown` (not three numbers), `host-flag-missing:<flag>` (an unverified patch whose help lacks a flag) or `host-unavailable` (the help cannot be read). See [doctor.md](doctor.md#host-admission-and-enforcement) and [containment.md](containment.md#launch-readiness). |
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

The cost per invocation also sets how large the knowledge corpus may be: the corpus is limited to `floor((cost cap x 2/3 / 0.0255)^(1 / 1.376))` chunks, so 9 chunks at 0.8 USD, 15 at 1.6 USD and 23 at the 3.0 USD preset, and the documents past the limit are left out and recorded (see [indexes-and-context.md](indexes-and-context.md)). Lowering `costUsdPerInvocation` therefore shrinks the corpus; it is not only a ceiling on spend.

Subagents per map round: full 4, fast 1, paths 4, skip 0, adopt 0, plus a mapper re-run allowance per round of 2 for full and none for the other modes (a full map therefore derives 12 with one retry); the knowledge pass and intel add none. The contract also fixes the model (`haiku`), the read-excluded directories (`.git`, `build`, `coverage`, `dist`, `node_modules`, `vendor`), the secret globs (`**/*.key`, `**/*.pem`, `**/.env`, `**/.env.*`, `**/id_ed25519*`, `**/id_rsa*`) and the read-only command list. The source states that changing any preset value changes the policy revision. How the derived totals are computed is in [onboarding.md](onboarding.md).

### Refresh planning

When an onboarding refreshes an active record, the plan for how much of the map to rebuild comes from these constants (the decision table is in [onboarding.md](onboarding.md#refresh)).

| Constant | Value |
|---|---|
| Drift threshold | 3: at least 3 new top-level directories since the revision the map describes send the refresh to a full map; fewer than 3 leave the choice to GSD's drift verdict. It is GSD's own default `workflow.drift_threshold`, reused here as a count of directories. Not configurable. |
| Manifest names | 29 basenames, matched at any depth: `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock`, `bun.lockb`, `turbo.json`, `nx.json`, `lerna.json`, `rush.json`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `go.work`, `pyproject.toml`, `poetry.lock`, `requirements.txt`, `Pipfile`, `Gemfile`, `Gemfile.lock`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `composer.json`, `mix.exs`. A change to one sends the refresh to a full map. |
| Scoped refresh cap | at most 50 affected paths; more, or a path that cannot travel as one `--paths` value, is not scoped |

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
| Context query budget | default `limits.contextTokens` (24000), max 100000 tokens |
| Proposal file | 65536 bytes |
| Installed skill | an existing `SKILL.md` over 256 KiB is not one AVARICE wrote and is left untouched |
| Profile config read | 64 KiB, opened without following a symbolic link |
| Banner | body at most 200 characters; up to three attempts, at once and after 10 s and 60 s; `osascript` killed after 10 s |
| Schedule | `launchctl` and `plutil` 10 s each; at most six digest times; an existing agent file over 64 KiB is not one AVARICE wrote |
| Amendment | reason at most 500 characters; acceptance file at most 64 KiB; at most 128 added write globs |
| Decision answer | option key at most 200 characters; free text 1 to 2000 characters; issue shown at most 1000 characters |
| Shell history | `shell-history` in the data root, mode 0600, at most 1000 lines, oldest dropped |
| Shell live view | the ledger is read again every 1000 ms; width 100 columns when the terminal reports none |

## Quirks

- An empty `AVARICE_FAULT` is read as "set", an empty `AVARICE_RUN` counts as set, and an empty `NO_COLOR` counts as set. Every other variable treats empty as unset or, for the lease TTL, as invalid and therefore the default.
- `AVARICE_LEASE_TTL_MS` falls back to the default for any invalid value without a message.
- `AVARICE_RUN` is read by the shell gate, `install-host`, `digest` and the owner commands (`contract amend`, `decide`, `cancel`, `schedule`, `approve`), and by the commands that record a manual input (`context add`, `evidence add`, `pr record`). `start`, `supervise` and the other commands do not look at it.
- `AVARICE_PROFILE` is ignored under a repository binding and is judged only when it is the value that would be chosen, so a malformed value in the environment does not stop a command that names `--profile` or runs in a bound repository.
- The `limits` section does not stop composition when it is bad (the defaults stay in force), while a bad `retrieval`, `credentials`, `retention` or `adapters` section stops the commands that read it. `start` and `doctor` are where a bad `limits` section is reported.
- The default `limits.contextTokens` of 24000 is above the 8192 tokens the 32 KiB run prompt can ever hold, so it is a ceiling for `avarice context` only until it is set below that.
- `workspaceRoots` and `freshnessWindowHours` are accepted in a profile config and read by nothing.
- Children differ in how they get `PATH`: git falls back to a fixed `PATH` only when the parent's is empty, while graphify and the host build their own `PATH` regardless of the parent.
- A run host and a run's checks differ in home and temp. The host keeps the forwarded `HOME` and gets `TMPDIR` at `<scratch>/tmp`. Checks, install and list commands get both set to the scratch directory itself.
- A check's `env` cannot change `CI`, `LANG` or the other sandbox names. Only the reserved names and prefixes listed above are refused at parse, so the sandbox names are accepted there and the sandbox value silently wins.
- `AVARICE_GRAPHIFY_BIN` set to a bad path disables the `PATH` search.
- Sandboxed supervisor commands (checks, install, list) deny reading the credential locations of the home directory (listed in [containment.md](containment.md#generated-settings-in-effect)), the data root and the three default AVARICE parent directories. They then allow back the run's own clone and scratch. A work root or config home placed elsewhere by an environment variable is not denied by name, except the data root.
- The preset records values that no code reads back. They are the no-progress limit, the prohibited decision list, the tool classes, delivery, the notification digest list, and the GSD verifier, baseline and per-item settings of the verification list. Changing them would change only the policy revision.
- The `notify` section of the profile config is the one part of that file that is read, and AVARICE never writes it. A misspelt key in it is refused rather than ignored, unlike an unknown flag on the command line.
- The install proxy admits only port-443 targets, so a registry that needs another port or plain HTTP cannot be reached.
- The same `.avarice/config.json` produces onboarding findings for every key the run reader needs. They do not affect a run.
