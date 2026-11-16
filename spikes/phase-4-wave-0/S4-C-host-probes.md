# S4-C: installed host flags and what the D-20 offline probes can prove (plan 04-02, D-20, CON-4)

Question: which restricted-mode and budget flags does the installed Claude Code offer, and for each host behaviour AVARICE's containment relies on, does an offline check prove that the host honours it, or only that AVARICE wrote it down?

Method: `claude --version` and `claude --help` only. No prompt was given, no model was called, nothing was spent. The probes in `src/adapters/host-claude/launch-preflight.ts` were read, not run; their behaviour is taken from the code.

## 1. Installed version

```text
$ claude --version
2.1.325 (Claude Code)
```

Binary: `/Users/aphan/.local/bin/claude`. `ADMITTED_CLAUDE_VERSIONS` in `launch-preflight.ts` is `2.1.312, 2.1.316, 2.1.317, 2.1.318, 2.1.319`. **2.1.325 is not in it**, so `checkLaunchReady` and `checkHostReady` refuse this host today with `enforcement_failure:host-version-not-admitted:2.1.325`. Admitting it takes a live T3 run on 2.1.325 with 0 containment failures (`test/containment/LIVE-CASES.md`); that is plan 04-11's job, and this spike spent nothing toward it.

## 2. Flag presence in `claude --help` (2.1.325)

Present means the flag appears in the help text; it does not say the host honours it.

| Flag | In help | Help line (first line quoted) |
|---|---|---|
| --restricted | yes | `Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell and the other code-running tools) and WebFetch unless --tools names them, and ignores user, project and local settings files (managed settings and --settings still apply; add --strict-mcp-config to skip MCP servers too). Also confines the file tools to the working directories (--add-dir included), refuses bypassPermissions, and lets only a person or the configured permission handler approve writes to settings, git and tool-configuration files.` (quoted line by line below) |
| --setting-sources | yes | `--setting-sources <sources>  Comma-separated list of setting sources to load (user, project, local).` |
| --permission-prompts | yes | `--permission-prompts <target>  Who answers permission prompts with --print: "host" (the SDK host or --permission-prompt-tool) or "none" (nobody: anything that would prompt is denied automatically; the permission mode still decides everything else) (choices: "host", "none", default: "host")` |
| --max-budget-usd | yes | `--max-budget-usd <amount>  Maximum dollar amount to spend on API calls (only works with --print)` |
| --permission-mode | yes | `--permission-mode <mode>  Permission mode to use for the session (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")` |
| --settings | yes | `--settings <file-or-json>  Path to a settings JSON file or a JSON string to load additional settings from` |
| --plugin-dir | yes | `--plugin-dir <path>  Load a plugin from a directory or .zip for this session only; a folder of plugins loads each child (repeatable: --plugin-dir A --plugin-dir B.zip) (default: [])` |
| --agents | yes | `--agents <json-or-file>  JSON object defining custom agents, or with --print the path to a file that holds one` |
| --session-id | yes | `--session-id <uuid>  Use a specific session ID for the conversation (must be a valid UUID)` |
| --resume | yes | `-r, --resume [value]  Resume a conversation by session ID or name, or open interactive picker with optional search term` |
| --allowedTools | yes | `--allowedTools, --allowed-tools <tools...>  Comma or space-separated list of tool names to allow (e.g. "Bash(git *) Edit")` |

All eleven requested flags are present. Three more flags in the same help bear on containment and are not in AVARICE's launch line: `--bare` ("Minimal mode: skip hooks ..."), `--safe-mode` ("Start with all customizations (CLAUDE.md, skills, installed plugins, hooks, MCP servers ... ) disabled"; admin-managed settings still apply) and `--tools <tools...>` ("Specify the list of available tools"). `assertLaunchArgsSafe` refuses `--bare` by name; it does not name `--safe-mode`, so that flag would pass as an unknown bare flag. `buildLaunchArgs` never emits it. Plan 04-11 may want to refuse it by name, because a host started with the hooks disabled is not contained.

### The `--restricted` description, verbatim

```text
  --restricted                          Restricted mode: removes the built-in
                                        tools that run commands or code (Bash,
                                        PowerShell and the other code-running
                                        tools) and WebFetch unless --tools names
                                        them, and ignores user, project and
                                        local settings files (managed settings
                                        and --settings still apply; add
                                        --strict-mcp-config to skip MCP servers
                                        too). Also confines the file tools to
                                        the working directories (--add-dir
                                        included), refuses bypassPermissions,
                                        and lets only a person or the configured
                                        permission handler approve writes to
                                        settings, git and tool-configuration
                                        files.
```

Compared with the sentence in `docs/containment.md` ("Restricted mode", written from 2.1.312 and 2.1.316): the installed text adds four things. The tools it removes include PowerShell. `--tools` can name a removed tool back in. Settings and MCP configuration need a flag of their own (`--strict-mcp-config`) to be skipped, and `--settings` still applies. Writes to settings, git and tool-configuration files need a person or the configured permission handler. Plan 04-23 should build the restricted launch line from this text and keep `--tools` unnamed for Bash, PowerShell and WebFetch.

## 3. What the existing offline probes check

| Probe | Where | What it proves | What it cannot prove |
|---|---|---|---|
| Settings-key presence | `checkLaunchReady`, `REQUIRED_KEYS` (9 keys: `permissions.defaultMode` `dontAsk`, `permissions.disableBypassPermissionsMode` `disable`, `sandbox.enabled` `true`, `sandbox.failIfUnavailable` `true`, `sandbox.allowUnsandboxedCommands` `false`, `sandbox.autoAllowBashIfSandboxed` `false`, `sandbox.excludedCommands` `[]`, `sandbox.network.allowedDomains` `[]`, `sandbox.network.strictAllowlist` `true`) | AVARICE wrote the file with those values | that the host reads or honours any of them |
| Hook configuration | `checkLaunchReady` steps 2 (`hook-missing`, `hook-not-blocking`, `config-hook-missing`, `post-hook-missing`, `post-failure-hook-missing`, `hook-script-unreadable`) | the PreToolUse, ConfigChange and PostToolUse entries exist, carry `onFailure: "block"` where required, and name a readable script | that the host starts the hook, or blocks when the hook fails |
| Hook self-test | `hookSelfTest`, run by `checkLaunchReady` when a policy file is given | the hook script, started the way the settings start it, denies a Write outside the write roots and exits 0 with a `deny` decision | that the host calls it for every tool, or acts on `deny` |
| Sandbox probe | `checkSandbox`, `/usr/bin/sandbox-exec -p "(version 1)(allow default)" /usr/bin/true` | Seatbelt can apply a profile on this machine | that the host starts its own sandbox, or refuses to run Bash when it cannot (`failIfUnavailable`) |
| Version check | `checkHostVersion`, `claude --version` against `ADMITTED_CLAUDE_VERSIONS` | the version string is one a live run was recorded on | that this binary behaves as that version did (a renamed binary reports what it likes) |
| Launch argument check | `assertLaunchArgsSafe` on the finished argv | the AVARICE-built argv has `dontAsk`, `--permission-prompts none`, an empty `--setting-sources`, a settings file, `--strict-mcp-config` and a positive `--max-budget-usd`, and names no bypass flag | that the host accepts or obeys any of those flags |
| Flag presence in `--help` (new, none today) | not built; this spike ran it by hand | the host recognises the flag name | that it behaves as the help text says |

## 4. Host behaviours containment relies on, and who proves them

"Written-only" means the probe shows AVARICE put the setting or flag in place; "proven" means the probe itself exercises the behaviour. The last column names where host behaviour is shown today. Nothing in the offline set is "proven" against the host: the hook self-test proves AVARICE's own script, and the sandbox probe proves the operating system.

| Host behaviour | Offline probe today | Offline result | What shows the host honours it |
|---|---|---|---|
| dontAsk honoured (anything that would prompt is denied) | `REQUIRED_KEYS` `permissions.defaultMode`; `assertLaunchArgsSafe` on `--permission-mode`; `--permission-mode` choices in help list `dontAsk` | written-only | live T3 cases 01 and 02 (Edit and Write refused under `dontAsk`) |
| `disableBypassPermissionsMode` | `REQUIRED_KEYS` `permissions.disableBypassPermissionsMode` | written-only | no case in `LIVE-CASES.md` targets it; `--restricted` help states it "refuses bypassPermissions", which is the restricted-mode counterpart; a live T3 run is the only proof |
| sandbox enabled | `REQUIRED_KEYS` `sandbox.enabled`; sandbox probe | written-only for the key; proven for "Seatbelt can apply a profile" only | live T3 cases 06b and 17 (hook removed, writes fail with `Operation not permitted`) |
| sandbox `failIfUnavailable` | `REQUIRED_KEYS` `sandbox.failIfUnavailable`; sandbox probe | written-only | live T3 case 12c proves AVARICE refuses when its own probe fails; no case makes the host's sandbox fail, so the host's refusal of Bash is not observed; only a live T3 run can show it |
| `allowUnsandboxedCommands` false | `REQUIRED_KEYS` | written-only | spike item 6 on 2.1.316 (`dangerouslyDisableSandbox` ignored, `git` sandboxed); re-proved only by a live T3 run on each host |
| Hook `onFailure: "block"` | hook configuration checks; hook self-test | written-only for the setting; the hook self-test proves the script denies | live T3 case 11 (the hook script missing: every call blocked by the host) |
| Network allowlist strict (`allowedDomains: []`, `strictAllowlist: true`) | `REQUIRED_KEYS` | written-only | spike item 6 on 2.1.316 (non-allowlisted network fails at the proxy); case 10 is refused by the hook before the network layer, so it does not show the proxy; a live T3 run is needed |
| `--setting-sources ""` drops user, project and local settings | `assertLaunchArgsSafe` requires the empty value; `--setting-sources` is in help | written-only; the help line does not say an empty value is accepted | spike item 7 on 2.1.316 (accepted, loads nothing); every live T3 launch uses it |
| `--restricted` removes Bash and WebFetch, ignores user settings, confines the file tools | flag presence in help (by hand here) | the help text states all of it; no probe runs it | no live T3 case launches `--restricted` yet; `docs/containment.md` cites only `claude --help` on 2.1.312 and 2.1.316; a live T3 run is the only proof |
| `--max-budget-usd` stops spend | `assertLaunchArgsSafe` needs a positive finite value; `--max-budget-usd` is in help ("only works with --print") | written-only | every live T3 run records `total_cost_usd` against the cap in the spend ledger; the host's own estimate is client-side |

## 5. What only a live T3 run proves

Every row in section 4 where the last column says "live T3" or a spike is a behaviour the offline probes cannot establish, and the D-20 self-check (which runs the offline probes before each launch) can therefore only refuse a launch, never certify one. Specifically, only a live T3 run proves:

1. that the host starts, and obeys the verdict of, the PreToolUse hook for each tool (the hook self-test runs the script directly, not through the host);
2. that the host refuses Bash when its own sandbox cannot start (`failIfUnavailable`), and that `allowUnsandboxedCommands: false` and the strict network allowlist hold on the installed version;
3. that `dontAsk`, `disableBypassPermissionsMode` and `--setting-sources ""` have the effect AVARICE assumes on the installed version;
4. that `--restricted` removes Bash, PowerShell and WebFetch, ignores user settings, confines the file tools to the working directories, and still runs the hooks named in `--settings` (the help line says `--settings` still applies; whether hooks fire under `--restricted` is not stated and is not known);
5. that `--restricted` and `--setting-sources ""` are accepted together (`assertLaunchArgsSafe` requires `--setting-sources ""` on every line; the restricted line in `docs/containment.md` does not carry it).

An offline probe that reads `claude --help` for a flag name is worth adding to the D-20 self-check: it catches a host that dropped or renamed `--restricted`, `--permission-prompts` or `--max-budget-usd` before the launch, at no cost. It proves presence, never behaviour, and its report should say so.

## 6. For the later plans

- Plan 04-11 (host admission): 2.1.325 is not admitted; it needs a live T3 run before any launch is possible. Consider refusing `--safe-mode` by name in `assertLaunchArgsSafe`.
- Plan 04-23 (restricted mode): build the launch line from the installed `--restricted` text; do not pass `--tools` for Bash, PowerShell or WebFetch; decide whether `--setting-sources ""` stays on the restricted line (item 5 above) and settle it in the live run, not by reading help.
- The D-20 launch self-check: add flag presence from `claude --help` as an offline probe, and report what each probe proved (written-only or proven) in the same words as the section 4 table.
