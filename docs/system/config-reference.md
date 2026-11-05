# Configuration reference

This document describes every configuration input AVARICE reads (the environment variables read and set by the `avarice` CLI and its hook, the profile `config.json`, the repository-side `.avarice/config.json` and `.planning/config.json`) and the built-in constants that act as configuration.

## Summary

- AVARICE reads 8 `AVARICE_*` variables and sets 1 (`AVARICE_RUN`) for the contained host. It reads 8 other variables: `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`. Three `AVARICE_*` names in the source (`AVARICE_WRITE_SET`, `AVARICE_TRACKED_WRITABLE`, `AVARICE_SECRET_PATTERNS`) are constants, not variables.
- `NO_COLOR`, `PYTHONDONTWRITEBYTECODE` and the `GIT_*` variables are set for child processes and never read.
- The profile `config.json` has four keys. All are written once and none is ever read back, so all four are dead knobs. The effective roots always come from the environment variables or their defaults.
- The only configuration file AVARICE parses is the repository's `.avarice/config.json`, as untrusted data that can only narrow authority. `.planning/config.json` is written by gsd-core in the staging workspace and is never parsed by AVARICE.
- There is no configuration file for budgets, versions or limits. They are built-in constants, lowered per run only through `avarice onboard --budget name=value`.

## Environment variables AVARICE reads

Every row names a read on a production path unless marked otherwise. An empty value counts as unset for every variable below except `AVARICE_FAULT` (see its row).

| Variable | Default | Effect | Usage |
|---|---|---|---|
| `AVARICE_CONFIG_HOME` | `$HOME/.config/avarice` | Directory that holds the profile config file. Resolved to an absolute path. | Set to relocate the config. It must not sit under any `~/.claude*` directory or under the real path of `CLAUDE_CONFIG_DIR`, and must not nest with the other roots; otherwise every command that opens the profile refuses. |
| `AVARICE_DATA_ROOT` | `$HOME/.local/share/avarice/personal-local` | Directory that holds the ledger database (`state.db`), artifacts and per-invocation files. Created with mode 0700. | Set to move state. It must be on a local mount: a network or non-local mount is refused because SQLite WAL is unsafe there. The same placement rules as the config home apply. |
| `AVARICE_WORK_ROOT` | `$HOME/.local/share/avarice-work/personal-local` | Directory for staging workspaces. Created with mode 0700. | Set to move staging. Same placement rules as the config home. |
| `AVARICE_CLAUDE_BIN` | first `claude` on `PATH` | Absolute path of the `claude` executable used as the contained host. | Set when `claude` is not on `PATH` or to pin one install. When neither resolves, the host is unavailable: the onboarding is blocked with reason `enforcement_failure` at the workspace stage's enforcement check, and the reason (`claude was not found ...`) is recorded in the host descriptor. The same fallback applies when no admitted gsd-core is located, the GSD shim preamble is missing, the sandbox is unusable or the version is not admitted. The binary must report an admitted version (see built-in constants). |
| `AVARICE_HOOK_ENTRY` | the `pre-tool-use` hook script of this checkout | Path of the hook program written into the host settings. | Override only to substitute a hook; the host is launched with whatever this names. A self-test of the hook runs before launch. |
| `AVARICE_GRAPHIFY_BIN` | first `graphify` on `PATH` | Path of the `graphify` executable for code extraction and the knowledge pass. | When set and non-empty it is the only candidate: if it names no executable file, graphify is reported missing and `PATH` is not tried. Only absolute `PATH` entries are searched. A missing graphify does not fail startup; it fails the index step that needs it. |
| `AVARICE_LEASE_TTL_MS` | `180000` | Lease time-to-live for an onboarding run, in milliseconds. The lease is renewed every third of the TTL. | Read on the production path, but used as a test seam (short leases for fault tests). A value that is not a positive safe integer, including an empty one, silently falls back to the default. |
| `AVARICE_FAULT` | unset | Kills the process with SIGKILL when execution reaches the named checkpoint (`name`, or `name#N` for the Nth arrival). | Test-only fault injection, but the read is on the production path: an operator who sets it gets a SIGKILL with no cleanup. Do not set it outside tests. Unlike the other variables an empty value is not treated as unset (it matches no checkpoint). |
| `HOME` | the OS home directory | Base for the default roots, the gsd-core candidate `$HOME/.claude/gsd-core`, the default `~/.claude` config directory and the graphify credential deny list. Also forwarded to children. | Normally inherited. Empty is treated as unset for AVARICE's own path resolution. |
| `PATH` | none (see children) | Search path for `claude` and `graphify` (absolute entries only for graphify). Forwarded to git children. | Must contain `git`; the git child falls back to a fixed path list only when `PATH` is empty. |
| `CLAUDE_CONFIG_DIR` | `$HOME/.claude` | Host configuration directory. Used for the root placement rules, for the gsd-core candidate `$CLAUDE_CONFIG_DIR/gsd-core`, as the skills root for the host, and forwarded to the host and gsd-core. | Set when Claude Code is installed in a nondefault directory. |
| `GSD_HOME` | unset | First gsd-core candidate directory. | Set to pin a gsd-core install. A candidate that is found but not admitted is an error; later candidates are not tried. |
| `USER`, `LOGNAME` | unset | Forwarded to gsd-core processes, the host and the host probes (the host's macOS credential lookup needs `USER`). | Read only for forwarding. |
| `LANG` | `C` for git; unset otherwise | Forwarded to git (default `C`), gsd-core, graphify, the host and the probes. | Read only for forwarding. |
| `TMPDIR` | OS default | Forwarded to gsd-core, graphify, the host and the probes. The OS temp directory is also used for graphify's version probe, the gsd-core identity probe and the hook self-test scratch directory. | Read only for forwarding and temp-directory choice. |

Test-only seam: `AVARICE_FAKE_HOST` is read only by the test fake host; nothing in the shipped source references it, so it has no effect on the CLI.

`AVARICE_RUN` is only set (next section); nothing in the shipped source reads it back, although a code comment says commands and the hook use it to recognise a contained run.

## Environment variables AVARICE sets for child processes

Children get an allowlisted environment built from nothing; names not listed here do not reach them (proxy variables, tokens, agent sockets and loader variables are never forwarded).

| Child | Variables set | Values |
|---|---|---|
| git (every git call) | `PATH`, `HOME`, `LANG`, plus the fixed safe-git set | `PATH` and `HOME` inherited (`HOME` is the empty string when unset); `PATH` falls back to `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin` when empty; `LANG` inherited or `C`. Fixed set: `GIT_CONFIG_COUNT` (2, plus one per extra config entry), `GIT_CONFIG_KEY_0=core.hooksPath` with `GIT_CONFIG_VALUE_0=/dev/null`, `GIT_CONFIG_KEY_1=core.fsmonitor` with `GIT_CONFIG_VALUE_1=false`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_ATTR_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`. Extra entries (`GIT_CONFIG_KEY_n` and `GIT_CONFIG_VALUE_n`) blank a repository's filter drivers or set `core.excludesFile=/dev/null` when a call asks for it. |
| gsd-core tools | the git set, then `HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR` when set and non-empty, and `PATH` | `PATH` is gsd-core's `bin`, `/usr/bin`, `/bin`, `/opt/homebrew/bin`. |
| claude host | the git set, the same six passthrough names, `PATH`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `AVARICE_RUN` | `PATH` is the gsd-core `bin`, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. The environment builder accepts extra trailing directories, but no caller passes any, so graphify is not on the host `PATH`. `AVARICE_RUN` is the onboarding id and overrides any inherited value. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is deliberately not set. |
| graphify | the git set with `HOME` and `LANG`, `TMPDIR` when set, `PATH`, `PYTHONDONTWRITEBYTECODE=1`, `NO_COLOR=1` | `PATH` is the directory of the graphify binary, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. |
| host and sandbox probes | `PATH=/usr/bin:/bin:/opt/homebrew/bin` and the six passthrough names | Used for the host version and capability probes and the sandbox probe. |
| hook | none set | The hook is started by the host and inherits the host environment above. |

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

Read from the staging copy at the pinned commit, only at activation, as data (parsed, never executed). Maximum size 65536 bytes; larger or unreadable files produce a finding and no values. Missing file: nothing proposed. Invalid JSON: a finding. The proposal can only narrow the profile policy; accepted values are recorded on the project record and every refusal becomes a finding (at most 50 are kept).

| Key | Accepted when | Usage |
|---|---|---|
| `paths.protected` | always (adds protection) | Globs. The profile policy already protects `.avarice/**` and `.github/**`. |
| `paths.read` | covered by the policy grant (the policy grants `**`) | Narrows the read scope. |
| `paths.write`, `paths.generated`, `paths.artifacts` | covered by the policy grant (the policy grants none, so every entry is refused as widening) | No value can currently be accepted. |
| `commands` | each entry an object with `name`, `argv`, optional `status` | Accepted only as `inactive`; any other `status` is refused as widening. |
| `verificationByChangeType` | never | Refused as unsupported. |
| any other key | never | Refused as unknown. |

Limits on entries: a glob is a non-empty string up to 256 characters, with no leading `/`, no NUL, no backslash and no `..` segment; at most 50 commands; `name` matches `[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`; `argv` has 1 to 64 strings of at most 1024 characters each without NUL. Findings clip values to 120 characters.

### `.planning/config.json`

AVARICE never parses it. In staging, gsd-core's `config-set` writes four settings: `commit_docs=false`, `workflow.text_mode=true`, `intel.enabled=true`, `graphify.enabled=true`. The file is in AVARICE's own write set, is the one tracked file that may be modified, and is permitted for the host to edit in staging. The settings are recorded on the project record.

## Command-line flags that configure a run

The full flag contract is in [cli-reference.md](cli-reference.md).

| Flag | Default | Effect |
|---|---|---|
| `onboard --policy onboarding` | required | The only policy. |
| `onboard --mode full\|fast` | `full` | Mapping mode. |
| `onboard --promote none` | `none` | Only `none` is accepted. |
| `onboard --budget name=value` (repeatable) | none | Lowers a budget; see budgets. |
| `context --budget N` | `4000` | Token budget for a context query, whole number 1 to 100000. |
| `init --profile personal-local` | `personal-local` | Only that profile is accepted. |

## Built-in constants

### Budgets (the onboarding preset)

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

### Admitted versions and gates

| Constant | Value |
|---|---|
| Claude Code versions | `2.1.312`, `2.1.316`, `2.1.317`; any other reported version is refused |
| gsd-core | package `@opengsd/gsd-core`, version matching `1.17.x` |
| Node | `>=22.22.3` declared in the package manifest; not compared at runtime |
| Bundled SQLite | accepted from 3.44.6 on the 3.44 line, 3.50.7 on 3.50, 3.51.3 on 3.51, and any later line; 3.45 to 3.49, older versions and unreadable version strings are refused |
| Sandbox | macOS `sandbox-exec` at a fixed path; absence marks the host unavailable |
| Node warning | the launcher suppresses the experimental warning |

### Timeouts and size limits

Only limits that surface to an operator as a refusal, a timeout or a cut are listed.

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

## Quirks

- An empty `AVARICE_FAULT` is read as "set"; every other variable treats empty as unset or, for the lease TTL, as invalid and therefore the default.
- `AVARICE_LEASE_TTL_MS` falls back to the default for any invalid value without a message.
- Children differ in how they get `PATH`: git falls back to a fixed `PATH` only when the parent's is empty, while graphify and the host build their own `PATH` regardless of the parent.
- `AVARICE_GRAPHIFY_BIN` set to a bad path disables the `PATH` search.
