# Integrations

This document describes the adapter modules under `src/adapters/`, the port interfaces under `src/ports/`, the composition root `src/cli/composition.ts`, the dependency container `src/app/deps.ts` and the supervisor launcher `src/cli/spawn-supervisor.ts`. Together they carry every runtime contact between AVARICE and an external system.

## Summary

AVARICE drives its tools by spawning processes. The only network traffic it brokers is the dependency install of a run, which reaches a package registry through a loopback allowlist proxy that AVARICE itself runs. Claude Code is the one system that also calls back into AVARICE (through the hook). The rest are one-way: AVARICE spawns them, reads their stdout or files, and judges the result.

| System | Direction | Protocol | Version expectation | When missing or wrong |
|---|---|---|---|---|
| Claude Code (`claude`) | AVARICE spawns it; it spawns the hook, which calls into AVARICE | `claude -p` with stream-json on stdout; settings, agents, plugin and MCP files on disk | exactly 2.1.312, 2.1.316, 2.1.317 or 2.1.318 | production host is replaced by one that refuses every invocation; onboarding and runs block as an enforcement failure |
| Claude configuration directory | AVARICE writes one file; the host adapter reads skills and a guard script | `skills/avarice-run/SKILL.md` written by `install-host`; GSD and user skills read | none | `install-host` refuses a link or an unmarked file (exit 3), refuses a run environment or bad arguments (exit 64) or fails (exit 70); a missing skill fails the invocation |
| GSD (`@opengsd/gsd-core`) | AVARICE spawns `gsd-tools.cjs` under Node; Claude Code runs GSD's own shell shim inside the host; a run drives GSD's quick workflow through the host | JSON on stdout, one verb per process | 1.17.x only | no GSD adapter; onboarding stops as incompatible; no host |
| git | AVARICE spawns it | argv arrays, minimal environment, plain-text output | none checked | the failing call returns an error; the run or onboarding stops at that step |
| User's source repository | AVARICE reads it through git; the run hand-off writes one branch ref into it | `git` against the repository's object database | none | the hand-off fails with a conflict or an error; the run stays unhanded |
| Package registry | the install step reaches it through the allowlist proxy only | HTTPS tunnelled through HTTP `CONNECT` to `<host>:443` | none | the install fails; see the egress section |
| graphify | AVARICE spawns it, sandboxed | `extract` and `cluster-only`, files on disk | 0.9.x documented, not enforced | the code-graph and knowledge indexes are recorded absent; onboarding continues |
| `sandbox-exec` | AVARICE spawns it as a wrapper | Seatbelt profile on argv | any macOS where a probe profile applies | no command runs; no unsandboxed fallback |
| `mount` | AVARICE spawns it | text table on stdout | none | profile preparation fails closed |
| `pgrep` and `ps` | AVARICE spawns them | text on stdout | none | reaping reports unavailable |
| Detached supervisor (`node`) | the CLI spawns a copy of itself | `supervise <runId>` on argv; the ledger is the only channel | the Node that runs the CLI | the command exits 70 and the run stays stored |
| Node.js and `node:sqlite` | AVARICE runs on them | in process | Node 22.22.3 or newer; SQLite with the WAL-reset fix | every ledger open refuses |
| `gh` | not invoked | none | none | not applicable |

Everything that runs repository-influenced or model-directed work (GSD verbs, graphify, the dependency install, declared checks, the host itself through its own sandbox settings) is confined. The probes and inspections in this document (the gsd-core identity check, git, `claude --version`, the hook self-test, `pgrep`, `ps`, `mount`) run unconfined, and so does the supervisor. See [containment.md](containment.md) for the rules the hook and sandbox enforce. This document does not repeat them.

The spawn sites are these: `sandbox-exec` (probe and wrapper), git, `claude` (launch and `--version`), `node` for the gsd-core identity check, `node` for the hook self-test, `node` for the detached supervisor, `pgrep`, `ps` and `mount`. GSD verbs and graphify do not spawn directly; they go through the sandboxed executor. No source file spawns `gh`.

## Ports and wired adapters

The ports directory holds eleven ports and one shared type (the capability descriptor every adapter publishes). Composition wires one production adapter per port. It substitutes a refusing host when the host is not admitted, leaves out the GSD adapter when none is found and leaves out the context sources when they are absent. A worktree staging adapter exists and is never selected. The descriptors of the command executor, graph tool, GSD adapter (when present) and agent host are written to the ledger by every command that is not read-only. A later reader therefore sees which adapter and enforcement level a profile ran with. The three run ports have no descriptor and are not recorded.

| Port | Production adapter | Test-only adapters |
|---|---|---|
| Agent host | Claude Code host when everything it needs is admitted; otherwise a host that refuses every invocation | scripted fake hosts for the map, intel and knowledge passes and for the run purpose, plus a fake `claude` executable that replays recorded stream-json |
| Command executor | `sandbox-exec` executor | an executor that runs commands directly for a test already inside an outer sandbox, injected only by the test entry point |
| Graph tool | graphify adapter | a fake `graphify` executable |
| GSD onboarding | gsd-tools adapter, present only when an admitted gsd-core is located | a fake gsd-core tree |
| Context source | two adapters, intel and graph, built only when the GSD adapter exists; both read through GSD's own readers | none |
| Staging workspace | local clone (the strategy is a single constant) | the worktree adapter exists behind the same port and runs the shared contract tests, but no production path selects it |
| Run source | git adapter that reads repository objects only | none |
| Run workspace | local-clone adapter for one run | none |
| Egress proxy | in-process allowlisting `CONNECT` proxy | a proxy injected only by the test entry point, for a registry that is a local server on a port the conventions cannot name |
| Ledger | SQLite ledger | none |
| Artifact store | local content-addressed file store | none |

The production entry point never passes the host, executor or egress overrides; only test entry points do. The three run ports are built on every composition, including a read-only one, because building them executes nothing. A read-only command (`status`) builds the refusing host without a reason, runs no sandbox probe and never launches a host; it locates GSD only when it asks to (the `context` command does). The dependency container carries the run ports as optional members, so a hand-built container in an onboarding test need not supply them; a composed container always has all three.

### Executor port fields

A command is described by its argv (no shell), working directory, whole environment, timeout, output limit, writable paths and read-denied paths. Two fields serve the run:

- Re-allowed read paths: subtrees readable again below a denied path, winning over every denial. They exist because a run's clone and scratch directory sit under a work root whose parent is denied.
- Loopback ports: integers from 1 to 65535 that the command may connect to. Only AVARICE's own supervisor steps set it, never an agent invocation. A value outside the range, or not an integer, makes the profile invalid and nothing runs.

### Ledger port

The ledger port also carries the run operations: runs and their lease, checkpoints, contracts, steps, attempts, evidence, gate results, work items, decisions, check validations, run events and the hook's read-before-edit rows. Their lifecycle is in [runs.md](runs.md) and their storage in [data-model.md](data-model.md). One more adapter-config row, named `host-skill:avarice-run` with port `host-skill`, is written by `install-host` and holds the digest of the installed skill. `host-skill` is not a port in the ports directory.

### Agent host port fields

An invocation has a purpose: map, intel, knowledge or run. Onboarding stages know only the first three. An invocation names its owner: absent or `onboarding` means the onboarding ID, and `run` names the run in a separate owner ID. The host refuses the invocation when the run purpose is paired with an onboarding owner or the reverse. Both the owner ID and the invocation ID must be plain names (a letter or digit first, then letters, digits, underscore or hyphen). An invocation's details also report whether the host printed a result at all, and the result's own error flag when it did.

## Claude Code

### Direction and invocation

AVARICE spawns the host headlessly, once per contained invocation (map, intel, knowledge or run purpose), in its own process group, with stdin closed. An onboarding invocation starts in the staging copy; a run invocation starts in the real location of the run's clone. The command line is generated, never composed from free text:

`claude -p <prompt> --setting-sources "" --settings <file> --plugin-dir <dir> --agents <file> [--agent <name>] --permission-mode dontAsk --permission-prompts none --strict-mcp-config --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose --session-id <uuid>`

`--setting-sources ""` means none of the user's own settings load. Everything the host may do comes from files AVARICE generates per invocation under the data root: settings, hook policy, agents, a plugin directory of symlinked skills, and an empty MCP server list. An onboarding keeps these files in a directory per onboarding and a run keeps them in a directory per run. Before spawning, a refusal check judges the finished argument list. It refuses each of these:

- `--bare`, anything starting with `--dangerously`, `--allow-dangerously`, `--add-dir`, `--allowedTools`, `--allowed-tools` and `--permission-prompt-tool`;
- a prompt that is empty or starts with a dash;
- any permission mode other than `dontAsk`, and a `--permission-prompts` value other than `none`;
- a non-empty setting-sources value, a missing settings file and a missing `--strict-mcp-config`;
- a budget that is not a positive finite number.

The host's environment is built from nothing. It holds the safe-git variables, the GSD pass-through names (`HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR`, each only when set), a `PATH` of the gsd-core `bin` directory then `/usr/bin:/bin:/opt/homebrew/bin`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and `AVARICE_RUN`. For an onboarding `AVARICE_RUN` holds the onboarding ID; for a run it holds the run ID. A run that has a scratch directory also gets `TMPDIR` set to a `tmp` directory inside it, `npm_config_cache` set to an `npm-cache` directory inside it, and `npm_config_update_notifier=false`, so the notifier cannot reach for the network. AVARICE makes both directories before the launch. Proxy, token and loader variables never arrive.

The session ID is chosen by the caller when it wants to record it before launch. A resume can then find a process that outlived its supervisor. The ID must be a UUID, and the adapter generates one otherwise.

### Which agents and skills are driven

| Purpose | Prompt | Skill loaded through the plugin directory | Agent definitions loaded |
|---|---|---|---|
| map | `/gsd-map-codebase` (full) or `/gsd-map-codebase --fast` | `gsd-map-codebase` | `gsd-codebase-mapper` |
| intel | `focus: full; project root: .`, started with `--agent gsd-intel-updater` | none | `gsd-intel-updater` |
| knowledge | a fixed instruction text that embeds only the chunk count and the plan file name | none | none |
| run | `/gsd-quick --validate --text` followed by one quoted task text built from the contract | `gsd-quick` | `gsd-planner`, `gsd-plan-checker`, `gsd-executor`, `gsd-verifier` |

The run purpose starts no named agent (no `--agent`). The quick workflow starts its own subagents from the four loaded definitions, and no other subagent type is admitted. The run depends on GSD's quick workflow being present in the located gsd-core installation and in the user's skill directory; a missing skill or agent definition fails the invocation before anything is spawned. The knowledge purpose has no skill, no agent and no GSD verb: the model reads prepared chunks and writes extraction JSON, and AVARICE does the merging. The plugin directory is named `avarice-run-skills`; each skill is a symlink to the real location of the user's skill directory under `$CLAUDE_CONFIG_DIR/skills` (or `~/.claude/skills`), so a skill appears to the host as `avarice-run-skills:<name>`.

### Agent definitions

Agent definitions are read from the `agents` directory beside the located gsd-core directory, one markdown file per named agent. The reader handles the subset of frontmatter GSD uses (scalars, comma lists, dash lists, block scalars, commented blocks), not general YAML. It keeps `description`, `tools`, `disallowedTools`, `effort` and the body (as the prompt). A definition that sets a permission mode or hooks is refused, in any spelling of the key, so an agent cannot step outside the generated settings. A missing file, a missing frontmatter block or a missing description fails the invocation before anything is spawned. Names that are not plain file names are refused.

One sentence is appended to the body of `gsd-executor` wherever it is loaded. Only the run purpose loads it. It tells the agent to edit files only, leave the commit to the supervisor and never run `git add` or `git commit`. The sentence is guidance only. The hook denial of those commands, the denial of writes to git metadata and the moved-HEAD rule are what enforce it.

### Stream-json parsing

The parser reads stdout as it arrives, line by line. It keeps only the `system/init` event, every `system/permission_denied` event and the last `result` event (error flag, subtype, terminal reason, permission denials, cost, turn count, duration, session ID, subagent counts). Model text, tool inputs and the result's text are dropped. A line that is not a JSON object, or that exceeds 16 MiB, is counted as malformed and skipped; the parser never throws. If several result events arrive, the last wins. Permission denials appear both as events and inside the result; the adapter takes the larger per-tool count of the two sources.

### Outcome classification

The outcome kind comes from facts, never from model text. The first rule that applies decides:

1. The staging HEAD moved: failed. This is also recorded as a containment finding by the caller. For a run, the HEAD checked is the run clone's.
2. No result event, or the wall clock fired: inconclusive.
3. Subtype `error_max_budget_usd`, terminal reason `budget_exhausted`, or a hook-recorded budget denial: budget exhausted.
4. The result's error flag is not exactly false, the exit code is not zero, or the process ended by signal: failed.
5. A structural pause signal was supplied: paused.
6. Every expected file exists in staging: progressed.
7. Any permission denial or hook denial: denied.
8. Otherwise: no progress.

A result with no boolean error flag is therefore never a success. The host adapter never supplies a pause signal, so the host never returns paused. Only the run's unit stage supplies one. It reads a waiting-JSON file, a verification status that asks for a human, or a final message that ends in a question followed by numbered choices. [runs.md](runs.md) owns that stage. A pause only ever blocks the run on a decision. A staging read above the size limit counts as the file being present. A run passes no expected files.

### Time, kill and transcript

The wall clock is enforced by AVARICE: at the limit the process group gets SIGTERM, then SIGKILL after a 10 second grace; a caller abort takes the same path. After the host exits, the group is swept once more with SIGKILL so background subagent shells die with it. AVARICE waits up to 2 seconds for the output pipe to close, then cuts it. stderr is drained and discarded. The transcript (stdout) is capped at 20 MiB with a truncation note, redacted for secrets, and stored as an artifact; a transcript that cannot be stored is an error, not a silent gap. A spawn failure returns unavailable.

### Admitted versions and readiness

Five versions are admitted: 2.1.312, 2.1.316, 2.1.317, 2.1.318 and 2.1.319. The version is read from `claude --version` (the output must begin with `x.y.z`; 10 second timeout) before each launch, not once per process. A version is meant to join the list only after the live containment suite has run against it with no containment failure; the code checks list membership only. No range is accepted: any version not on the list is refused until added.

Before every launch the adapter proves each layer, and any refusal is a denial with rule `enforcement_failure:<reason>` with nothing spawned. These checks prevent a launch. None of them asks the running host which sandbox it applied.

- The generated settings carry the required permission and sandbox keys (default mode `dontAsk`, bypass disabled, sandbox enabled and fail-if-unavailable, no unsandboxed commands, no auto-allowed sandboxed Bash, no excluded commands, empty network allowlist with strict allowlist). The check reads the generated file, not the host's effective settings.
- The hook is configured for PreToolUse and ConfigChange with `onFailure: block`, for PostToolUse and PostToolUseFailure without that requirement, and every hook script is readable.
- A self-test starts the hook the way the settings would, feeds it a write outside the write roots, and requires a deny verdict.
- The sandbox probe applies a profile. It proves that `sandbox-exec` works on this machine.
- The host version is admitted.

Reasons seen by callers: `host-unavailable` (`--version` failed or timed out), `host-version-unreadable`, `host-version-not-admitted:<version>`, `sandbox-unavailable`, `hook-script-unreadable` and `hook-self-test`. Four groups of reasons follow. The settings group has `settings-missing`, `settings-invalid` and `settings-key:<path>`. The hook configuration group has `hook-missing`, `config-hook-missing`, `hook-not-blocking`, `post-hook-missing` and `post-failure-hook-missing`. The invocation files group has `invocation-files:<kind>`, and the launch arguments group has `launch-args:<rule>`.

### Hook, called by Claude Code

The generated settings register AVARICE's hook command as the Node binary that is running AVARICE, with `--disable-warning=ExperimentalWarning`, the hook script, `--event pre|post|config-change` and `--policy <file>`. Claude Code runs it per tool call with a 5 second timeout, JSON on stdin; a deny is JSON on stdout with exit 0, and any failure exits 2, which blocks. The pre and config-change entries block on failure; the post entries do not. When the user's configuration directory holds GSD's secret read guard script, it is kept as an additional hook for `Read|Grep|Bash`, because the user's own settings are not loaded. The decision rules live in [containment.md](containment.md).

### Reaping by session ID

On resume, for an onboarding and for a run alike, AVARICE ends any process still carrying the recorded session. It runs `/usr/bin/pgrep -f -- "--session-id <uuid>"` (10 second timeout) and treats exit 1 as none found. For each match other than itself and process 1 it asks `/bin/ps -o pgid=` whether the process leads its own group; a leader's whole group gets SIGTERM, anything else is signalled alone. Survivors after the grace get SIGKILL; a process alive 5 seconds after that is an error. The session ID must be a UUID. Without a reap capability on the host (the refusing host has none), an onboarding's resume skips this step. A run's resume stops instead when a launch row is left `started` and cannot be reaped (the step recorded no session ID, or the host cannot reap). Every row stays `started`: the launched host may still be running, and nothing may read the clone beside it. The match is on the command line text, so any process whose command line contains that exact flag and UUID is terminated.

### The unavailable-host fallback

Composition chooses the contained host only when all of these hold. Otherwise it uses a host that reports enforcement `none`, refuses every invocation with an unsupported error, and records the reason (truncated to 200 characters) in its descriptor:

- an admitted gsd-core was located (reason: no admitted gsd-core);
- a `claude` path is resolved: `AVARICE_CLAUDE_BIN` as given (not checked for existence here; a bad path fails the startup check as `host-unavailable`), or the first executable `claude` on `PATH`;
- the GSD shim preamble can be fingerprinted;
- the startup check (hook script readable, sandbox probe, admitted version) passes.

The hook script comes from `AVARICE_HOOK_ENTRY` or the script in this checkout. A profile without a usable host still runs read-only commands and the non-model parts of onboarding. The onboarding then blocks with reason `enforcement_failure` in the workspace stage, after staging and GSD configuration and before the map launch.

## Claude configuration directory

`install-host` writes exactly one file, `skills/avarice-run/SKILL.md`, under a Claude configuration directory. The directory is the `--config-dir` flag, else `CLAUDE_CONFIG_DIR`, else `~/.claude`. This is the only place AVARICE writes under that directory. The skill is guidance for attended sessions: it says to call `avarice status` first, treat retrieved text as data, stay inside the contract's paths, stop on a denial, and leave configuration to the owner. It restricts its own tools to `avarice status`, `avarice context` and reading. A contained run never loads it.

The write is conservative. These rules prevent the overwrite or the write:

- The command refuses to run when `AVARICE_RUN` is set, before any profile or store is touched.
- The configuration directory itself may be a symbolic link; the `skills` directory, the `avarice-run` directory and the file may not. A link or a non-directory there is refused and nothing is written.
- An existing file is overwritten only when it is a regular file of at most 256 KiB that carries the AVARICE marker line. Any other file is left untouched and refused.
- The write goes to a temporary file created exclusively, then a rename, so a reader sees the old file or the new one. An identical existing file is reported unchanged.

A refusal of a link, a non-directory or an unmarked file exits 3. The `AVARICE_RUN` refusal and bad arguments exit 64, and a read or write failure exits 70. The digest of the installed text is recorded in the ledger as the adapter-config row `host-skill:avarice-run`; if only that record fails, the file is in place and the command still exits 70.

The host adapter also reads this directory: it links skills from it into the plugin directory and keeps GSD's secret read guard script as a hook. It never writes there.

## Egress proxy and the package registry

A supervisor step that needs the network never gets the network. The sandbox lets the command connect to one loopback port, and an in-process proxy listening on that port admits only an exact allowlist. The proxy is never given to an agent invocation, and the contained host's own settings keep an empty network allowlist.

### Proxy behavior

The proxy listens on `127.0.0.1` on an ephemeral port, for one step, and is closed when the step ends (an idempotent close that also destroys open tunnels). Each allowlist entry must be an exact `host:port` with a DNS name or IPv4 literal host; the host is compared in lower case. Any other entry fails the start as invalid. A listen failure fails the start as unavailable.

| Request | Answer | Recorded as |
|---|---|---|
| `CONNECT` to an allowlisted `host:port` | `200`, then a byte tunnel to the target | allowed |
| `CONNECT` to any other `host:port` | `403` | refused |
| `CONNECT` with a target that is not `host:port`, or a request line the parser rejects | `400` | refused, host `invalid`, port 0 |
| Any other method (a plain HTTP request) | `405` with `Allow: CONNECT` | refused, with the host and port named by the absolute URL or the `Host` header |
| Allowlisted target whose name resolves to any address that is not public (the ranges are in [containment.md](containment.md#the-egress-proxy)), or to no address | `403` | refused |
| Allowlisted target that cannot be reached, or whose name fails to resolve | `502` | allowed |

Every attempt is recorded in order with host, port, verdict and time, never a path or header, and handed to an optional observer; an observer failure never changes what the proxy admits. The proxy resolves an allowlisted host name itself, outside the sandbox, and connects to an address it checked rather than to the name ([containment.md](containment.md#the-egress-proxy) has the rules). A plain HTTP registry cannot work, because only `CONNECT` is accepted.

### Dependency install

The install step runs the install command declared in the repository's conventions, in the run clone, through the sandboxed executor. The allowlist is `<host>:443` for each registry host in the conventions, and nothing else. The proxy address is passed as `npm_config_https_proxy`, `npm_config_proxy` and `HTTPS_PROXY`. A tool that ignores those variables finds no network, because the sandbox denies everything but the one loopback port. The refusal is prevention: the proxy answers 403 and the sandbox blocks everything else. The failed step is detection that reports the attempt, grouped by host, port and verdict.

[checks-and-evidence.md](checks-and-evidence.md) owns the outcomes of the step, its limits and its read and write sets.

### Check validation

Validating a declared check in the scratch validation clone starts a proxy with an empty allowlist. It prevents nothing the sandbox does not already prevent, and it records what the check tries to reach. If the proxy cannot start, the check runs with no network at all. Every other check run, and the inventory list command, runs with no loopback port. [checks-and-evidence.md](checks-and-evidence.md) describes the verdicts.

## GSD

### Locating gsd-core

Candidates are tried in order: `GSD_HOME`; `$CLAUDE_CONFIG_DIR/gsd-core` (only when `CLAUDE_CONFIG_DIR` is set); `$HOME/.claude/gsd-core`. The first candidate that contains `bin/gsd-tools.cjs` is the only one examined. If it is found but not admitted, the result is unsupported and later candidates are not tried, so an explicit `GSD_HOME` is never silently replaced. No candidate found yields not-found, listing the probed paths.

Admission runs `node bin/gsd-tools.cjs runtime-identity --raw` (5 second timeout, working directory the system temp directory) and requires JSON naming package `@opengsd/gsd-core` at a version matching `1.17.<n>`. A failed run, non-JSON output, a missing field, another package or another line are all unsupported, with the reason recorded. Composition turns that into a problem report naming what was found against `@opengsd/gsd-core 1.17.x`, and onboarding stops as incompatible at the contract stage.

The agents directory is derived as the sibling `agents` directory of the located gsd-core directory, not located independently.

### Verbs driven

Every other GSD call goes through the command executor, sandboxed with the network denied, as `node <gsd-core>/bin/gsd-tools.cjs <verb> ...`. The environment is rebuilt (safe-git variables, the pass-through names, gsd-core `bin` first on `PATH`). The default timeout is 15 seconds and the output limit 16 MiB. The data root and the credential locations (listed in [containment.md](containment.md#generated-settings-in-effect)) are denied for reading, and the staging directory is the working directory. A verb that writes may write only the staging `.planning` directory, or the single subdirectory it targets for the snapshot verbs. These verbs run during onboarding. A run's unit reaches GSD through the host and its shim, not through these verbs.

| Verb | Use | Writes |
|---|---|---|
| `init onboard --raw` | probe state: brownfield flag, map readiness (`complete`, `fast` or `none`), missing map files, candidate documents | staging `.planning` |
| `config-set <key> <value>` | applies `commit_docs=false`, `workflow.text_mode=true`, `intel.enabled=true`, `graphify.enabled=true`, one process per key | staging `.planning` |
| `stamp-codebase-map [--files a,b]` | stamps the generated map after the host finishes | staging `.planning` |
| `verify codebase-drift` | drift check | none |
| `graphify build snapshot` | records the installed graph's baseline | `.planning/graphs` only |
| `graphify status` | freshness of the installed graph | none |
| `graphify query <term> --budget <n>` | reads the graph (GSD's built-in reader, not the standalone graphify command) | none |
| `intel validate`, `intel diff`, `intel status`, `intel query <term>` | validate and read the five intel files | none |
| `intel snapshot` | hashes the intel files as baseline | `.planning/intel` only |

Setting keys must be dotted identifiers and values plain tokens; query terms must be non-empty, at most 200 characters, free of control characters and not start with a dash. Output is JSON; output that starts with `@file:` is a spill, followed to the absolute path it names (up to 16 MiB). Several fields are validated (map readiness and the brownfield flag), and a result that fails the shape check is an invalid error. A disabled capability is a result, not an error, for intel and graph reads.

Failure mapping: timeout or cancel is a timeout error with unknown side effects. A spawn error is unavailable, and so is exit code 69. Any other non-zero exit is internal, carrying the first line of stderr. An end by signal is internal, naming the signal. Truncated or non-JSON output is internal. The adapter publishes a capability list: init-onboard, map-full, map-fast, stamp and verify-drift are true; map-paths and ingest-docs are false; initializing planning is unsupported.

Inside the contained host, GSD is reached through its own shim: every GSD workflow shell block begins with a long line defining `gsd_run`. Hook policy admits `gsd_run` read verbs only after a command whose first bytes hash to the fingerprint AVARICE took from that line. The line is read from the located gsd-core's `workflows/map-codebase.md` (first line starting `_GSD_SHIM_NAME=`, the file's size capped at 1 MiB). If the file or the line is missing, the host is not admitted. A GSD release that changes the line gets its own fingerprint automatically; one that moves or renames it is refused.

The read verbs the hook admits per purpose are listed in [containment.md](containment.md).

## git

AVARICE calls the `git` found on `PATH` for every operation, always through one wrapper, never a shell. No version is checked. The wrapper rejects anything but a subcommand as the first argument (so no `-c`, `-C`, `--git-dir`) and rejects `--config-env` anywhere. Its environment holds the caller's `PATH`, `HOME` and `LANG` plus a fixed set that disables hooks (`core.hooksPath=/dev/null`), `core.fsmonitor`, system config, system attributes, optional locks and terminal prompts. On calls that compare or write working files, every `filter.<name>` clean, smudge and process command in the repository is blanked for that call. The default timeout is 10 seconds. Run source listings allow 60. Clone, checkout and fetch allow 120, and so do the run workspace tree operations and the hand-off fetch. A timeout, an unrunnable git (unavailable) and a non-zero exit (internal, with the first stderr line) are distinct errors.

Three subcommands accept only listed options. Anything else is refused before git runs, which prevents a caller from re-enabling what the environment turns off.

| Subcommand | Options admitted |
|---|---|
| `clone` | `--local`, `--no-hardlinks`, `--no-checkout`, `--quiet`, `-q` |
| `fetch` | `--no-tags`, `--no-write-fetch-head`, `--quiet`, `-q`; a refspec with a leading `+` is refused anywhere |
| `commit` | `--no-verify`, `--no-gpg-sign`, `--quiet`, `-q`, and `-m` with its message as the value |

A caller can also ask for a fixed commit identity (name, email and signing off), fsck of transferred objects, a temporary index file (an absolute path only) and literal pathspecs. These map to fixed configuration keys and environment variables, never free-form ones. A `fetch` always runs with automatic gc and maintenance off, so it cannot start a repack or prune of the repository it writes to.

| Group | Commands |
|---|---|
| Repository facts (read-only) | `rev-parse`, `rev-list --max-parents=0`, `branch --show-current`, `status --porcelain=v2 -z`, `ls-tree`, `cat-file`, `log -1`, `symbolic-ref --short`, `remote get-url origin`, `config --name-only --get-regexp` (filter discovery), `config --file <partial>/.git/config --get` (clone identity) |
| Local clone staging | `clone --local --no-hardlinks --no-checkout -- <repo> <partial>`, `checkout --detach <pin>`, `switch -c <branch>` (omitted for a detached clone), then the partial directory is renamed into place |
| Staging inspection | `diff --name-status`, `status --ignored=traditional`, `ls-tree`, `cat-file blob`, `check-ignore --no-index`, `init -q --template=` in a scratch directory, `rev-parse --git-dir --git-common-dir` |
| Staging identity | `rev-parse --show-toplevel`, `cat-file -e`, `config --get remote.origin.url` (clone identity check) |
| Run source | `rev-parse --verify`, `rev-parse --show-toplevel`, `merge-base`, `rev-list --first-parent`, `ls-tree -l` and `ls-tree -z`, `diff-tree`, `cat-file blob` and `cat-file -e`, `log --format=%ct` |
| Run workspace | `rev-parse HEAD`, `rev-parse --verify --quiet <ref>^{commit}`, `rev-parse --show-toplevel` and `--path-format=absolute --git-dir`; `read-tree`, `add -A` and `write-tree` on a temporary index; `diff-tree`; `restore --source=<tree> --worktree`; `ls-files`; `ls-tree --name-only`; `log -1 --format=%B`; `status --ignored=traditional`; `add`, `diff --cached` and `commit`; `fetch` into the source |
| Unselected worktree staging | `worktree add`, `worktree list`, `worktree lock` and `merge-base --is-ancestor`; the adapter is never selected |
| Context freshness | the same wrapper, for HEAD and path checks |

### Staging and run clones

Onboarding staging and the run's clone are built by the same rules. The clone copies the user's repository into the work root with no hardlinks, so the user's checkout is not shared with the contained host. An existing target directory is reused only if it is its own repository, a clone of this repository, on the expected branch (or detached when no branch is expected), at the pin. Anything else is a conflict and is left untouched. An interrupted clone leaves a `.partial` directory, which is replaced only when it is provably this repository's own leftover. The pin is a full commit id of 40 lowercase hexadecimal digits, validated before use. Onboarding refuses the 64-digit pin of a repository with SHA-256 object names as invalid when it prepares the staging clone, after the project, the onboarding and its contract are recorded. Run start refuses it too (see [Run source](#run-source)). The run's clone is on a branch named after the run. The scratch clone used to validate declared checks is detached at the pin with no branch.

### Run workspace

The run workspace is the git side of one run. Everything in it runs in the supervisor, outside any invocation, and the contained model never calls it. The run ID may contain only letters, digits and underscore, up to 64 characters.

- Snapshot, status and change detection: the tree of the clone's tracked and untracked non-ignored content is computed through a temporary index file beside the clone, so the clone's own index is never touched. Ignored entries are listed (at most 10,000) but are never part of the tree.
- Discard: puts every path the run changed since a snapshot back to its snapshot content and deletes the paths the snapshot did not have. It restores in batches of 200 literal paths, never as a reset or a clean. It removes no directory except an empty one standing where a snapshot file belongs, never writes through a symbolic link, and leaves ignored entries alone. It refuses with a conflict, changing nothing, when HEAD is no longer the snapshot's HEAD.
- Restore and remove: put named tracked files back to their content at HEAD, or delete named untracked files and the directories they leave empty. An untracked path given to restore, or a tracked path given to remove, is a conflict and nothing is changed.
- Commit: the supervisor commits exactly the given clone-relative paths under the fixed identity `AVARICE <avarice@localhost.invalid>`, unsigned, with `--no-verify`. Trailers are appended after a blank line, and each must be a single `Key: value` line. An empty list, an absolute path, a `..` segment, a `.git` segment, a leading dash, an empty message or a message with a NUL is refused. A path is split into segments at a slash only, so a backslash is part of a file name and `a\b` is one name, not `a/b`. A commit with no change in the paths is a conflict. The `Avarice-Run:` and `Avarice-Attempt:` trailers of the HEAD message can be read back together with the parents of the HEAD commit. Only a line of exactly that form counts as a trailer, so message text cannot pose as one.
- Read: a clone file as UTF-8 under a size limit, refusing traversal, absolute paths and symbolic links that leave the clone.

### Fetch into the source repository

The hand-off is the one write AVARICE makes to the user's repository. It fetches the run branch of the clone into the source as a new local branch of the same name, and it is create-only:

- It resolves the branch in the clone and the source's top level, then checks the source for that ref. The same commit already there is success with nothing created; a different commit is a conflict and nothing is fetched.
- The fetch is never forced, takes no tags, writes no fetch-head, and runs with fsck on, because the objects come from a tree an agent wrote into.
- Afterwards the ref must exist at the commit; any other state is an internal error.

It runs no checkout, reset or clean and changes neither the index nor the working tree of the user's checkout. It does write the objects the new branch needs into the source's object database. After a failure the ref may or may not exist, and a later hand-off finds it through the same check. Onboarding staging never writes to the user's repository.

### Run source

The run source answers four questions about the source repository from git objects alone. It never opens a working-tree file, so an uncommitted edit, a dirty checkout or a half-written file cannot change an answer, and it reads no clock.

- HEAD: the source's current HEAD commit.
- Conventions: the text of `.avarice/config.json` at the pin, or at a newer commit on the first-parent chain from HEAD back to the pin whose whole difference against the pin lies under `.avarice/`. The newest such commit wins. The file must be a regular file of at most 256 KiB. No candidate is `not_found`, a HEAD that does not descend from the pin is a conflict, and an oversize file is invalid.
- Staleness: whether HEAD is the pin or descends from it, how many commits since the pin touch a path outside `.avarice/` and `.planning/`, and the committer time of the oldest. When HEAD does not descend, the counts are zero and null.
- File presence: whether a revision holds a regular file at a literal path (a link or a directory is not a file).

Pin and HEAD must be commit ids of 40 lowercase hexadecimal digits that exist in the repository. A repository with SHA-256 object names is refused when HEAD is read, with an error that names the object format. Run start therefore exits 70 before it creates any row or file. The conventions walk looks at the newest 500 first-parent commits above the pin and then the pin.

## Detached supervisor

`start` and `resume` spawn the Node binary that is running the CLI, with its own execution arguments, the running CLI script, `supervise` and the run ID. The child is detached into its own process group. Its standard streams are ignored, its working directory is the data root and it is unreferenced. Closing the shell or killing `start --wait` therefore leaves it running. It runs the supervisor unconfined, as AVARICE itself.

Its environment is the parent's whole environment plus the three profile roots the parent resolved (configuration, data and work), with the test-runner marker removed. It is therefore not minimal like the host's. A relative or missing entry script refuses the spawn; the caller then exits 70 and the run stays stored. A spawn failure reported after the fact is swallowed. The only channel back is the ledger. The caller records the child's process ID in a step row. With `--wait` it polls the run's state, lease and that process until the run stops, the process is gone with the lease lapsed, or the wait budget runs out. The lifecycle is in [runs.md](runs.md).

## graphify

The adapter targets graphify 0.9.x, but no version is enforced. The version printed by `graphify --version` (first `x.y.z`, 15 second timeout) is recorded in the index record and the descriptor says 0.9, and any version that prints a number is used.

The binary is `AVARICE_GRAPHIFY_BIN` when set, with no fallback if it names no executable file; otherwise the first executable `graphify` on an absolute `PATH` entry. The path is resolved to its real location. Composition does not fail when graphify is missing; the descriptor records `missing` and the error arises when the index stage needs it.

Commands run through the sandboxed executor with network denied and one writable directory, outside the staging tree:

- `graphify extract <staging> --code-only --out <dir> --max-workers 1` (5 minute timeout); code files only, single process because the sandbox needs it. The output directory must not lie inside the staging tree or contain it, and a previous build's output is cleared first.
- `graphify cluster-only <dir> --no-label --no-viz` (2 minute timeout), also used on AVARICE's own merged graph for the knowledge index.

`graphify update` and graphify's cross-repository merge are never used. No graphify command calls a model. The result is read back as JSON (64 MiB cap) and AVARICE copies three files into staging `.planning/graphs`, never through a symlink. A missing binary surfaces as an unavailable error whose cause starts `graphify-missing`; the code-graph and knowledge steps record that as an absent index with reason `graphify-missing` and the onboarding continues. The extract step also checks that `graph.json` was written, and the cluster step that the report was.

## macOS sandbox

The command executor wraps every command as `/usr/bin/sandbox-exec -p <profile> <argv>` with the given environment only, in its own process group. The profile starts from allow-default and denies network and all writes. It then applies these rules in order, and later rules win:

1. For each loopback port the command was given, allow outbound connections to `localhost:<port>`. This is the only network a command can have, because Seatbelt cannot filter by host name.
2. Re-allow writes for the system temp areas, `/dev/null`, `/dev/dtracehelper` and tty devices.
3. Deny writes under the command's working directory.
4. Re-allow writes under each declared write path.
5. Deny reads of the named paths.
6. Re-allow reads of each re-allowed path, which wins over the denials.
7. Give back the metadata (not the contents, not a listing) of each directory above a re-allowed path that lies inside a denied one, so a program can resolve the real path of a file below it.

Paths are resolved to real locations first, and a path with a quote, backslash, newline or NUL is refused rather than escaped.

A probe (`sandbox-exec` with a permissive profile running `/usr/bin/true`) decides availability. Exit 0 caches usable and any other exit caches unusable. A timeout, signal or spawn failure is retried once with 15 seconds instead of 5. If the retry is not clean, the probe answers unavailable for that call only, without caching. When unavailable, nothing is spawned and the result is an unavailable error; there is no unsandboxed path. `sandbox-exec` exit codes 65 and 71 with a `sandbox-exec:` message are reported as the sandbox refusing the command. Commands are killed with SIGTERM at the timeout and SIGKILL 5 seconds later; output is capped at 5 MiB per stream by default.

The same probe is repeated separately by the host adapter before each Claude Code launch.

## mount

Preparing the profile runs `mount` with no arguments (first of `/sbin/mount`, `/bin/mount`, `/usr/bin/mount` that exists, 5 second timeout) and requires the data root to sit on a mount marked `local`. The mount whose point is the longest prefix of the data root is chosen. On macOS the `local` flag decides. Linux output has no such flag, so a mount is local unless its type is in a short list of network types. If `mount` is missing, fails, or no entry contains the path, the profile is refused (fail closed); a non-local mount is refused with advice to set `AVARICE_DATA_ROOT`. The check is a heuristic: a synced or FUSE folder can still report `local`.

## gh

AVARICE never spawns the GitHub CLI. The name `gh` appears in three places. It is a denied Bash command prefix for the contained host, a command word that a repository's declared agent commands may not use, and a read-denied credential location (`~/.config/gh`) in the sandbox profiles. The other credential locations are listed in [containment.md](containment.md#generated-settings-in-effect). AVARICE has no pull request, push or GitHub API path. The run hand-off produces a local branch in the source repository, and nothing pushes it.

## Node.js and node:sqlite

The package declares Node 22.22.3 or newer. There is no explicit Node version comparison at runtime; the gate is on the SQLite that Node bundles. Every ledger open first reads the bundled SQLite version and refuses unless it contains the WAL-reset fix. The accepted versions are 3.44.6 or later on the 3.44 line, 3.50.7 or later on 3.50, 3.51.3 or later on 3.51, any later line, and nothing on 3.45 to 3.49 (those never received the fix). An unreadable version string is refused. The refusal is an unsupported error telling the user to install Node 22.22.3 or newer.

`node:sqlite` is experimental in Node. The CLI entry point and the generated hook command both disable the experimental warning so it does not reach stderr. GSD verbs, the hook, the hook self-test and the supervisor run under the same Node binary that runs AVARICE.

The ledger additionally refuses a store file (or its `-wal` and `-shm` siblings) owned by another user, tightens a group- or world-accessible one to 0600, and requires WAL mode to take effect on read-write opens.

## Failure behavior at a glance

| Condition | Result |
|---|---|
| No admitted gsd-core | no GSD adapter, no context sources, contained host replaced by the refusing host; onboarding stops incompatible |
| `claude` missing or version not admitted | refusing host; the onboarding is blocked with reason `enforcement_failure` at the workspace stage's enforcement check |
| Sandbox cannot apply a profile | executor unavailable; every GSD, graphify, install, check and host launch is refused |
| Host exceeds wall clock | process group terminated; outcome is inconclusive |
| Host moves the clone's HEAD | outcome failed, with a containment finding |
| graphify missing | indexes recorded absent with reason `graphify-missing`; onboarding continues |
| `mount` unusable or data root non-local | profile preparation fails; nothing runs |
| Bundled SQLite lacks the fix | ledger refuses to open |
| git cannot run or times out | the calling step returns an error |
| An install that reaches any target the proxy refuses, including a name that resolves to a non-public address | the install step fails with a permission decision; the proxy has already refused the connection |
| Egress proxy cannot start | the install fails with `enforcement_failure`; a check validation runs with no network instead |
| Run branch already in the source at another commit | the hand-off is a conflict and nothing is fetched |
| Supervisor cannot be spawned | the command exits 70; the run stays stored |
| `install-host` meets a link or an unmarked file | refused (exit 3), nothing written |
| `install-host` runs inside a run or with bad arguments | refused (exit 64), nothing written |

## Quirks

- The executor descriptor reports offline, although a supervisor step can be given one loopback port. The flag describes the adapter, not a particular command.
- The three run ports (run source, run workspace, egress proxy) are built on every composition, read-only ones included. Only the executor, graph, GSD and host descriptors are recorded, so the run ports leave no record of which adapter a profile ran with.
- The registry allowlist can only name port 443. A registry on another port works only through the test entry point's override.
- A registry that is reachable only on a private network is unsupported (see [containment.md](containment.md#limits-of-containment)). In the tests, the proxy reaches the local registry only through a test-only resolver that skips the address check; production never passes it.
- A refused proxy attempt fails the install even when the install command exited 0 and finished its work.
- The supervisor inherits the user's whole environment, unlike the host and every sandboxed command.
- The hand-off writes objects as well as one ref into the user's repository. A failed fetch can leave unreferenced objects there.
- The conventions walk examines the newest 500 first-parent commits above the pin. A conventions-only commit older than that is not found, and the pin's own file is used.
- The installed skill tells the model not to run `avarice contract amend` and `avarice budget`, and neither is a command of this CLI.
- The supervisor's own install and check commands set `HOME` and `TMPDIR` to the scratch directory itself, while the host's `TMPDIR` is a subdirectory of it.
- Reaping matches any process whose command line contains the exact session flag and UUID, not only processes AVARICE started.

## Related documents

- [runs.md](runs.md): where the run calls these integrations, and the run lifecycle, hand-off and resume.
- [containment.md](containment.md): hook decision rules, settings keys, read verbs per purpose.
- [checks-and-evidence.md](checks-and-evidence.md): the dependency install outcomes, check validation, evidence and gates.
- [onboarding.md](onboarding.md): where each onboarding stage calls these integrations.
- [indexes-and-context.md](indexes-and-context.md): what the graph and intel indexes contain.
- [config-reference.md](config-reference.md): the environment variables and keys named here.
