# Integrations

This document describes the adapter modules under `src/adapters/`, the port interfaces under `src/ports/` and the composition root `src/cli/composition.ts`, which together carry every runtime contact between AVARICE and an external system.

## Summary

AVARICE drives its tools by spawning processes; nothing it integrates with is reached over a network by AVARICE itself. Claude Code is the one system that also calls back into AVARICE (through the hook). The rest are one-way: AVARICE spawns them, reads their stdout or files, and judges the result.

| System | Direction | Protocol | Version expectation | When missing or wrong |
|---|---|---|---|---|
| Claude Code (`claude`) | AVARICE spawns it; it spawns the hook, which calls into AVARICE | `claude -p` with stream-json on stdout; settings, agents, plugin and MCP files on disk | exactly 2.1.312, 2.1.316 or 2.1.317 | production host is replaced by one that refuses every invocation; onboarding blocks as an enforcement failure |
| GSD (`@opengsd/gsd-core`) | AVARICE spawns `gsd-tools.cjs` under Node; Claude Code runs GSD's own shell shim inside the host | JSON on stdout, one verb per process | 1.17.x only | no GSD adapter; onboarding stops as incompatible; no host |
| git | AVARICE spawns it | argv arrays, minimal environment, plain-text output | none checked | the failing call returns an error; the run stops at that step |
| graphify | AVARICE spawns it, sandboxed | `extract` and `cluster-only`, files on disk | 0.9.x documented, not enforced | the code-graph and knowledge indexes are recorded absent; onboarding continues |
| `sandbox-exec` | AVARICE spawns it as a wrapper | Seatbelt profile on argv | any macOS where a probe profile applies | no command runs; no unsandboxed fallback |
| `mount` | AVARICE spawns it | text table on stdout | none | profile preparation fails closed |
| `pgrep` and `ps` | AVARICE spawns them | text on stdout | none | reaping reports unavailable |
| Node.js and `node:sqlite` | AVARICE runs on them | in process | Node 22.22.3 or newer; SQLite with the WAL-reset fix | every ledger open refuses |
| `gh` | not invoked | none | none | not applicable |

Everything that runs repository-influenced or model-directed work (GSD verbs, graphify, the host itself through its own sandbox settings) is confined. The probes and inspections in this document (the gsd-core identity check, git, `claude --version`, the hook self-test, `pgrep`, `ps`, `mount`) run unconfined. See [containment.md](containment.md) for the rules the hook and sandbox enforce. This document does not repeat them.

## Ports and wired adapters

The ports directory holds eight ports and one shared type (the capability descriptor every adapter publishes). Composition wires one production adapter per port, with two exceptions noted below. The descriptors of the command executor, graph tool, GSD adapter (when present) and agent host are written to the ledger by every command that is not read-only, so a later reader sees which adapter and enforcement level a profile ran with.

| Port | Production adapter | Test-only adapters |
|---|---|---|
| Agent host | Claude Code host when everything it needs is admitted; otherwise a host that refuses every invocation | scripted fake hosts for the map, intel and knowledge passes, plus a fake `claude` executable that replays recorded stream-json |
| Command executor | `sandbox-exec` executor | an executor that runs commands directly for a test already inside an outer sandbox, injected only by the test entry point |
| Graph tool | graphify adapter | a fake `graphify` executable |
| GSD onboarding | gsd-tools adapter, present only when an admitted gsd-core is located | a fake gsd-core tree |
| Context source | two adapters, intel and graph, built only when the GSD adapter exists; both read through GSD's own readers | none |
| Staging workspace | local clone (the strategy is a single constant) | the worktree adapter exists behind the same port and runs the shared contract tests, but no production path selects it |
| Ledger | SQLite ledger | none |
| Artifact store | local content-addressed file store | none |

The production entry point never passes the host or executor overrides; only test entry points do. A read-only command (`status`) builds the refusing host without a reason, runs no sandbox probe and never launches a host; it locates GSD only when it asks to (the `context` command does).

## Claude Code

### Direction and invocation

AVARICE spawns the host headlessly, once per contained invocation (map, intel or knowledge purpose), in the staging copy, in its own process group, with stdin closed. The command line is generated, never composed from free text:

`claude -p <prompt> --setting-sources "" --settings <file> --plugin-dir <dir> --agents <file> [--agent <name>] --permission-mode dontAsk --permission-prompts none --strict-mcp-config --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose --session-id <uuid>`

`--setting-sources ""` means none of the user's own settings load; everything the host may do comes from files AVARICE generates per invocation under the data root (settings, hook policy, agents, a plugin directory of symlinked skills, and an empty MCP server list). Before spawning, a refusal check judges the finished argument list: it refuses `--bare`, anything starting with `--dangerously`, `--allow-dangerously`, `--add-dir`, `--allowedTools`, `--allowed-tools` and `--permission-prompt-tool`, a prompt that is empty or starts with a dash, any permission mode other than `dontAsk`, a `--permission-prompts` value other than `none`, a non-empty setting-sources value, a missing settings file, a missing `--strict-mcp-config`, and a budget that is not a positive finite number.

The host's environment is built from nothing: the safe-git variables, the GSD pass-through names (`HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR`, each only when set), a `PATH` of the gsd-core `bin` directory then `/usr/bin:/bin:/opt/homebrew/bin`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and `AVARICE_RUN` set to the onboarding ID. Proxy, token and loader variables never arrive.

The session ID is chosen by the caller when it wants to record it before launch (so a resume can find a process that outlived its supervisor) and must be a UUID; the adapter generates one otherwise.

### Which agents and skills are driven

| Purpose | Prompt | Skill loaded through the plugin directory | Agent definition loaded |
|---|---|---|---|
| map | `/gsd-map-codebase` (full) or `/gsd-map-codebase --fast` | `gsd-map-codebase` | `gsd-codebase-mapper` |
| intel | `focus: full; project root: .`, started with `--agent gsd-intel-updater` | none | `gsd-intel-updater` |
| knowledge | a fixed instruction text that embeds only the chunk count and the plan file name | none | none |

The knowledge purpose has no skill, no agent and no GSD verb: the model reads prepared chunks and writes extraction JSON, and AVARICE does the merging. The plugin directory is named `avarice-run-skills`; each skill is a symlink to the real location of the user's skill directory under `$CLAUDE_CONFIG_DIR/skills` (or `~/.claude/skills`), so a skill appears to the host as `avarice-run-skills:<name>`.

### Agent definitions

Agent definitions are read from the `agents` directory beside the located gsd-core directory, one markdown file per named agent. The reader handles the subset of frontmatter GSD uses (scalars, comma lists, dash lists, block scalars, commented blocks), not general YAML. It keeps `description`, `tools`, `disallowedTools`, `effort` and the body (as the prompt). A definition that sets a permission mode or hooks is refused, in any spelling of the key, so an agent cannot step outside the generated settings. A missing file, a missing frontmatter block or a missing description fails the invocation before anything is spawned. Names that are not plain file names are refused.

### Stream-json parsing

The parser reads stdout as it arrives, line by line. It keeps only the `system/init` event, every `system/permission_denied` event and the last `result` event (error flag, subtype, terminal reason, permission denials, cost, turn count, duration, session ID, subagent counts). Model text, tool inputs and the result's text are dropped. A line that is not a JSON object, or that exceeds 16 MiB, is counted as malformed and skipped; the parser never throws. If several result events arrive, the last wins. Permission denials appear both as events and inside the result; the adapter takes the larger per-tool count of the two sources.

### Outcome classification

The outcome kind comes from facts, never from model text. The first rule that applies decides:

1. The staging HEAD moved: failed. This is also recorded as a containment finding by the caller.
2. No result event, or the wall clock fired: inconclusive.
3. Subtype `error_max_budget_usd`, terminal reason `budget_exhausted`, or a hook-recorded budget denial: budget exhausted.
4. The result's error flag is not exactly false, the exit code is not zero, or the process ended by signal: failed.
5. Every expected file exists in staging: progressed.
6. Any permission denial or hook denial: denied.
7. Otherwise: no progress.

A result with no boolean error flag is therefore never a success. The paused kind exists in the port but is never derived. A staging read above the size limit counts as the file being present.

### Time, kill and transcript

The wall clock is enforced by AVARICE: at the limit the process group gets SIGTERM, then SIGKILL after a 10 second grace; a caller abort takes the same path. After the host exits, the group is swept once more with SIGKILL so background subagent shells die with it. AVARICE waits up to 2 seconds for the output pipe to close, then cuts it. stderr is drained and discarded. The transcript (stdout) is capped at 20 MiB with a truncation note, redacted for secrets, and stored as an artifact; a transcript that cannot be stored is an error, not a silent gap. A spawn failure returns unavailable.

### Admitted versions and readiness

Three versions are admitted: 2.1.312, 2.1.316 and 2.1.317. The version is read from `claude --version` (the output must begin with `x.y.z`; 10 second timeout) before each launch, not once per process. A version is meant to join the list only after the live containment suite has run against it with no containment failure; the code checks list membership only. No range is accepted: 2.1.318 is refused until added.

Before every launch the adapter proves each layer, and any refusal is a denial with rule `enforcement_failure:<reason>` with nothing spawned:

- The generated settings carry the required permission and sandbox keys (default mode `dontAsk`, bypass disabled, sandbox enabled and fail-if-unavailable, no unsandboxed commands, no auto-allowed sandboxed Bash, no excluded commands, empty network allowlist with strict allowlist).
- The hook is configured for PreToolUse and ConfigChange with `onFailure: block`, for PostToolUse and PostToolUseFailure without that requirement, and every hook script is readable.
- A self-test starts the hook the way the settings would, feeds it a write outside the write roots, and requires a deny verdict.
- The sandbox probe applies a profile.
- The host version is admitted.

Reasons seen by callers: `host-unavailable` (`--version` failed or timed out), `host-version-unreadable`, `host-version-not-admitted:<version>`, `sandbox-unavailable`, `hook-script-unreadable`, `hook-self-test`, and the settings-shape reasons.

### Hook, called by Claude Code

The generated settings register AVARICE's hook command as the Node binary that is running AVARICE, with `--disable-warning=ExperimentalWarning`, the hook script, `--event pre|post|config-change` and `--policy <file>`. Claude Code runs it per tool call with a 5 second timeout, JSON on stdin; a deny is JSON on stdout with exit 0, and any failure exits 2, which blocks. The pre and config-change entries block on failure; the post entries do not. When the user's configuration directory holds GSD's secret read guard script, it is kept as an additional hook for `Read|Grep|Bash`, because the user's own settings are not loaded. The decision rules live in [containment.md](containment.md).

### Reaping by session ID

On resume, AVARICE ends any process still carrying the recorded session. It runs `/usr/bin/pgrep -f -- "--session-id <uuid>"` (10 second timeout) and treats exit 1 as none found. For each match it asks `/bin/ps -o pgid=` whether the process leads its own group; a leader's whole group gets SIGTERM, anything else is signalled alone. Survivors after the grace get SIGKILL; a process alive 5 seconds after that is an error. The session ID must be a UUID. Without a reap capability on the host (the refusing host has none), resume skips this step. The match is on the command line text, so any process whose command line contains that exact flag and UUID is terminated.

### The unavailable-host fallback

Composition chooses the contained host only when all of these hold; otherwise it uses a host that reports enforcement `none`, refuses every invocation with an unsupported error, and records the reason (truncated to 200 characters) in its descriptor:

- an admitted gsd-core was located (reason: no admitted gsd-core);
- a `claude` path is resolved: `AVARICE_CLAUDE_BIN` as given (not checked for existence here; a bad path fails the startup check as `host-unavailable`), or the first executable `claude` on `PATH`;
- the GSD shim preamble can be fingerprinted;
- the startup check (hook script readable, sandbox probe, admitted version) passes.

The hook script comes from `AVARICE_HOOK_ENTRY` or the script in this checkout. A profile without a usable host still runs read-only commands and the non-model parts of onboarding. The onboarding then blocks with reason `enforcement_failure` in the workspace stage, after staging and GSD configuration and before the map launch.

## GSD

### Locating gsd-core

Candidates are tried in order: `GSD_HOME`; `$CLAUDE_CONFIG_DIR/gsd-core` (only when `CLAUDE_CONFIG_DIR` is set); `$HOME/.claude/gsd-core`. The first candidate that contains `bin/gsd-tools.cjs` is the only one examined. If it is found but not admitted, the result is unsupported and later candidates are not tried, so an explicit `GSD_HOME` is never silently replaced. No candidate found yields not-found, listing the probed paths.

Admission runs `node bin/gsd-tools.cjs runtime-identity --raw` (5 second timeout, working directory the system temp directory) and requires JSON naming package `@opengsd/gsd-core` at a version matching `1.17.<n>`. A failed run, non-JSON output, a missing field, another package or another line are all unsupported, with the reason recorded. Composition turns that into a problem report naming what was found against `@opengsd/gsd-core 1.17.x`, and onboarding stops as incompatible at the contract stage.

The agents directory is derived as the sibling `agents` directory of the located gsd-core directory, not located independently.

### Verbs driven

Every other GSD call goes through the command executor, sandboxed with the network denied, as `node <gsd-core>/bin/gsd-tools.cjs <verb> ...`. The environment is rebuilt (safe-git variables, the pass-through names, gsd-core `bin` first on `PATH`). The default timeout is 15 seconds and the output limit 16 MiB. The data root, `~/.ssh`, `~/.aws` and `~/.config/gh` are denied for reading, and the staging directory is the working directory. A verb that writes may write only the staging `.planning` directory, or the single subdirectory it targets for the snapshot verbs.

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

Failure mapping: timeout or cancel is a timeout error with unknown side effects; a spawn error is unavailable; exit code 69 is unavailable; any other non-zero exit is internal, carrying the first line of stderr; an end by signal is internal, naming the signal; truncated or non-JSON output is internal. The adapter publishes a capability list: init-onboard, map-full, map-fast, stamp and verify-drift are true; map-paths and ingest-docs are false; initializing planning is unsupported.

Inside the contained host, GSD is reached through its own shim: every GSD workflow shell block begins with a long line defining `gsd_run`. Hook policy admits `gsd_run` read verbs only after a command whose first bytes hash to the fingerprint AVARICE took from that line. The line is read from the located gsd-core's `workflows/map-codebase.md` (first line starting `_GSD_SHIM_NAME=`, the file's size capped at 1 MiB). If the file or the line is missing, the host is not admitted. A GSD release that changes the line gets its own fingerprint automatically; one that moves or renames it is refused.

The read verbs the hook admits per purpose are listed in [containment.md](containment.md).

## git

AVARICE calls the `git` found on `PATH` for every operation, always through one wrapper, never a shell. No version is checked. The wrapper rejects anything but a subcommand as the first argument (so no `-c`, `-C`, `--git-dir`), rejects `--config-env` anywhere, and allows `clone` only with `--local`, `--no-hardlinks`, `--no-checkout`, `--quiet` and `-q`. Its environment holds the caller's `PATH`, `HOME` and `LANG` plus a fixed set that disables hooks (`core.hooksPath=/dev/null`), `core.fsmonitor`, system config, system attributes, optional locks and terminal prompts. On calls that compare or write working files, every `filter.<name>` clean, smudge and process command in the repository is blanked for that call. The default timeout is 10 seconds; listing the tree allows 60 and clone or checkout 120. A timeout, an unrunnable git (unavailable) and a non-zero exit (internal, with the first stderr line) are distinct errors.

| Group | Commands |
|---|---|
| Repository facts (read-only) | `rev-parse`, `rev-list --max-parents=0`, `branch --show-current`, `status --porcelain=v2 -z`, `ls-tree`, `cat-file`, `config --name-only --get-regexp` (filter discovery) |
| Local clone staging | `clone --local --no-hardlinks --no-checkout -- <repo> <partial>`, `checkout --detach <pin>`, `switch -c <branch>`, then the partial directory is renamed into place |
| Staging inspection | `diff --name-status`, `status --ignored=traditional`, `ls-tree`, `cat-file blob`, `check-ignore --no-index`, `init -q --template=` in a scratch directory, `rev-parse --git-dir --git-common-dir` |
| Staging identity | `rev-parse --show-toplevel`, `cat-file -e`, `config --get remote.origin.url` (clone identity check) |
| Context freshness | the same wrapper, for HEAD and path checks |

The clone copies the user's repository into the work root with no hardlinks, so the user's checkout is not shared with the contained host. An existing staging directory is reused only if it is its own repository, a clone of this repository, on the staging branch, at the pin; anything else is a conflict and is left untouched. An interrupted clone leaves a partial directory, which is replaced only when it is provably this repository's own leftover. The pin is a full commit SHA, validated before use.

Production never runs `git push` or `git commit`, and never writes git configuration; its `git config` calls are reads (filter discovery and the clone's remote URL). The contained host is denied `git push`, `git commit` and `git config`.

## graphify

The adapter targets graphify 0.9.x, but no version is enforced: the version printed by `graphify --version` (first `x.y.z`, 15 second timeout) is recorded in the index record and the descriptor says 0.9, and any version that prints a number is used.

The binary is `AVARICE_GRAPHIFY_BIN` when set, with no fallback if it names no executable file; otherwise the first executable `graphify` on an absolute `PATH` entry. The path is resolved to its real location. Composition does not fail when graphify is missing; the descriptor records `missing` and the error arises when the index stage needs it.

Commands run through the sandboxed executor with network denied and one writable directory, outside the staging tree:

- `graphify extract <staging> --code-only --out <dir> --max-workers 1` (5 minute timeout); code files only, single process because the sandbox needs it. The output directory must not lie inside the staging tree or contain it, and a previous build's output is cleared first.
- `graphify cluster-only <dir> --no-label --no-viz` (2 minute timeout), also used on AVARICE's own merged graph for the knowledge index.

`graphify update` and graphify's cross-repository merge are never used. No graphify command calls a model. The result is read back as JSON (64 MiB cap) and AVARICE copies three files into staging `.planning/graphs`, never through a symlink. A missing binary surfaces as an unavailable error whose cause starts `graphify-missing`; the code-graph and knowledge steps record that as an absent index with reason `graphify-missing` and the onboarding continues. The extract step also checks that `graph.json` was written, and the cluster step that the report was.

## macOS sandbox

The command executor wraps every command as `/usr/bin/sandbox-exec -p <profile> <argv>` with the given environment only, in its own process group. The profile starts from allow-default, denies network and all writes, then re-allows writes for the system temp areas, `/dev/null` and tty devices, denies writes under the command's working directory, re-allows each declared write path, and denies reads of the named paths. Paths are resolved to real locations first, and a path with a quote, backslash, newline or NUL is refused rather than escaped.

A probe (`sandbox-exec` with a permissive profile running `/usr/bin/true`) decides availability. Exit 0 caches usable and any other exit caches unusable. A timeout, signal or spawn failure is retried once with 15 seconds instead of 5. If the retry is not clean, the probe answers unavailable for that call only, without caching. When unavailable, nothing is spawned and the result is an unavailable error; there is no unsandboxed path. `sandbox-exec` exit codes 65 and 71 with a `sandbox-exec:` message are reported as the sandbox refusing the command. Commands are killed with SIGTERM at the timeout and SIGKILL 5 seconds later; output is capped at 5 MiB per stream by default.

The same probe is repeated separately by the host adapter before each Claude Code launch.

## mount

Preparing the profile runs `mount` with no arguments (first of `/sbin/mount`, `/bin/mount`, `/usr/bin/mount` that exists, 5 second timeout) and requires the data root to sit on a mount marked `local`. The mount whose point is the longest prefix of the data root is chosen. On macOS the `local` flag decides. Linux output has no such flag, so a mount is local unless its type is in a short list of network types. If `mount` is missing, fails, or no entry contains the path, the profile is refused (fail closed); a non-local mount is refused with advice to set `AVARICE_DATA_ROOT`. The check is a heuristic: a synced or FUSE folder can still report `local`.

## gh

AVARICE never spawns the GitHub CLI. The name `gh` appears only as a denied Bash command prefix for the contained host and as the read-denied credential directory `~/.config/gh` in the sandbox profiles. AVARICE has no pull request, push or GitHub API path.

## Node.js and node:sqlite

The package declares Node 22.22.3 or newer. There is no explicit Node version comparison at runtime; the gate is on the SQLite that Node bundles. Every ledger open first reads the bundled SQLite version and refuses unless it contains the WAL-reset fix: 3.44.6 or later on the 3.44 line, 3.50.7 or later on 3.50, 3.51.3 or later on 3.51, any later line, and nothing on 3.45 to 3.49 (those never received the fix). An unreadable version string is refused. The refusal is an unsupported error telling the user to install Node 22.22.3 or newer.

`node:sqlite` is experimental in Node. The CLI entry point and the generated hook command both disable the experimental warning so it does not reach stderr. GSD verbs, the hook and the hook self-test run under the same Node binary that runs AVARICE.

The ledger additionally refuses a store file (or its `-wal` and `-shm` siblings) owned by another user, tightens a group- or world-accessible one to 0600, and requires WAL mode to take effect on read-write opens.

## Failure behavior at a glance

| Condition | Result |
|---|---|
| No admitted gsd-core | no GSD adapter, no context sources, contained host replaced by the refusing host; onboarding stops incompatible |
| `claude` missing or version not admitted | refusing host; the onboarding is blocked with reason `enforcement_failure` at the workspace stage's enforcement check |
| Sandbox cannot apply a profile | executor unavailable; every GSD, graphify and host launch is refused |
| Host exceeds wall clock | process group terminated; outcome is inconclusive |
| Host moves staging HEAD | outcome failed, with a containment finding |
| graphify missing | indexes recorded absent with reason `graphify-missing`; onboarding continues |
| `mount` unusable or data root non-local | profile preparation fails; nothing runs |
| Bundled SQLite lacks the fix | ledger refuses to open |
| git cannot run or times out | the calling step returns an error |

## Related documents

- [containment.md](containment.md): hook decision rules, settings keys, read verbs per purpose.
- [onboarding.md](onboarding.md): where each stage calls these integrations.
- [indexes-and-context.md](indexes-and-context.md): what the graph and intel indexes contain.
