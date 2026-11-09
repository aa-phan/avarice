# Containment

This document describes how AVARICE confines, judges and records the agent work it starts, and which of those controls prevent or detect, and which recover. It covers the contained agent invocation, the sandboxed command executor and its egress proxy, the PreToolUse hook and its pure decision rules, the invocation scope for the four purposes, the budget and invocation services, the run gates that judge a unit's changes, the supervisor's git safety, the activation scope check and proposal narrowing, the local-mount check and the root-placement rules (`src/adapters/host-claude/`, `src/adapters/exec/`, `src/hook/`, `src/domain/hook-decision.ts`, `src/domain/invocation-scope.ts`, `src/domain/run-shell-rules.ts`, `src/domain/gates.ts`, `src/domain/outcome.ts`, `src/domain/policy-narrowing.ts`, `src/domain/secret-patterns.ts`, `src/domain/root-rules.ts`, `src/app/budget.ts`, `src/app/invocation.ts`, `src/app/checks.ts`, `src/app/check-validation.ts`, `src/app/run-gsd-config.ts`, `src/app/run-service.ts`, `src/app/run-stages/prepare.ts`, `src/app/run-stages/item.ts`, `src/app/stages/activate.ts`, `src/domain/conventions.ts`, `src/adapters/graph/graphify.ts`, `src/adapters/gsd/gsd-onboarding.ts`, `src/adapters/git/safe-git.ts`, `src/adapters/git/run-workspace.ts`, `src/adapters/gsd/agents-json.ts`, `src/adapters/fs/local-mount.ts`, `src/ports/command-executor.ts`).

A contained invocation is one headless Claude Code process that AVARICE starts, confines and judges, for an onboarding (purposes `map`, `intel`, `knowledge`) or for a run (purpose `run`). Nothing starts unless launch readiness and launch argument judgment pass, and a failed check refuses; none falls back to a weaker mode. The allow and deny lists and the filesystem lists of the generated settings are generated, not re-verified at launch.

Two things are detected after the fact and not prevented: a file created at a location the sandbox does not list, and, for runs, any change that matches no contract glob. A moved HEAD is prevented by the git directory write deny, the protected globs and the denied commit prefix. It is also checked after the work as a backstop. Recovery is limited to the orphan charge of a killed invocation on the next reservation, the reaping of a surviving host by its session ID and the discard of a crashed unit in the clone. See "Staging and clone checks after the work" and "Limits of containment".

The onboarding lifecycle is in [onboarding.md](onboarding.md). The run lifecycle, the stage order and how a block is routed are in [runs.md](runs.md). The checks pipeline is in [checks-and-evidence.md](checks-and-evidence.md), the stored contract and ledger schema in [data-model.md](data-model.md), CLI flags in [cli-reference.md](cli-reference.md) and environment variables in [config-reference.md](config-reference.md).

## Layers at a glance

| Layer | What it enforces | Enforced by | Effect |
|---|---|---|---|
| Launch readiness | Nine settings keys, AVARICE hook entries blocking and readable, hook self-test denies an outside write, sandbox applies a profile, host version admitted | AVARICE, before every launch | Prevents the launch: no process starts; `enforcement_failure:{reason}` |
| Launch argument judgment | Fixed permission mode, no bypass or widening flag, settings and cost cap present | AVARICE, before every launch | Prevents the launch: `enforcement_failure:launch-args:{reason}` |
| Environment allowlist | Only listed variable names reach the host and its children | AVARICE | Prevents: a name not listed is absent; there is no failure path |
| Host permission rules | Read, edit, shell and web tool grants for one purpose | Claude Code, from generated settings | Prevents: anything not allowed is denied (`dontAsk`, no prompts); not re-verified by AVARICE |
| Host sandbox (Seatbelt) | Shell and child-process writes, reads and network | Claude Code, from generated settings | Prevents; the host refuses shell commands when the sandbox is unavailable |
| PreToolUse hook | Every tool call: read confinement, write set, command identity, subagent types, budgets; for runs also protected paths, read-before-edit and loop limits | AVARICE hook process | Prevents: exit 2 or a deny blocks the call; settings also say block on failure |
| ConfigChange hook | No settings, hook or permission change during the invocation | AVARICE hook process | Prevents: always refuses |
| Budgets | Invocation, tool-call, subagent, wall-clock and cost limits | AVARICE ledger, hook, host cost cap, adapter timer | Prevents a reservation, a call or a launch; kills the process group at the wall clock |
| Sandboxed executor | AVARICE's own subprocesses: network only to one loopback port a supervisor step names, declared writes only, named reads denied | AVARICE, Seatbelt | Prevents; `unavailable` when no sandbox, and the command is not run |
| Egress proxy | A supervisor step reaches only the registry hosts named for it | AVARICE process, outside the sandbox | Prevents and records every attempt |
| Safe git | No repository hook, fsmonitor or prompt runs; filter drivers are blanked only on AVARICE's own status, diff, checkout, worktree and clone-commit calls; the supervisor's commit and hand-off use fixed options | AVARICE | Prevents: unsafe arguments refused before git runs |
| Staging and clone checks | Staging diff inside the union of write sets; HEAD unmoved; for runs, gates G2 and G4 over the clone's changes | AVARICE after the work | Detects: a G2 scope failure blocks with `enforcement_failure` and a finding; G4 blocks with `decision` and records no finding |
| Root placement | Roots outside Claude config directories, not nested, data root on local storage | AVARICE at profile resolution | Prevents: profile refused, nothing is created |

## How a launch is assembled

One invocation produces five inputs in its own directory under the data root, then the launch checks, then the launch.

The directory is `onboard/{onboarding}/{purpose}-{invocation}` for an onboarding and `run/{run}/run-{invocation}` for a run. The owner and invocation IDs must be plain names (letters, digits, underscore, hyphen; no leading dot or separator), or the adapter returns `invalid` before writing anything. A run purpose needs a run owner and a run owner needs the run purpose, or the adapter returns `invalid`. Directories are created mode 0700 and files mode 0600, each written beside its target and renamed, so a reader never sees half a file. The inputs are:

- The generated settings file (permission rules, sandbox lists, hook entries).
- The hook policy file: the same scope in the form the hook reads, with every path canonicalized (symlinks resolved, on-disk case on a case-insensitive volume). A path that cannot be canonicalized fails the build.
- The agents file: one entry per agent the purpose names, built from GSD's agent markdown. An agent definition that sets a permission mode or hooks is refused. Only description, prompt, tools, disallowed tools and effort are passed on. For the run purpose, every agent's prompt ends with a note stating the same shell rules the hook enforces (one plain command per call, the read-only commands, the file tools, and no gsd-tools, `mkdir` or repository-changing git). The executor agent's prompt then also carries a closing addendum telling it to edit files only and never to run `git add` or `git commit`, because the supervisor commits. The map and intel agents carry neither note.
- The plugin directory: symlinks to the real location of each allowed skill, so nothing is copied and nothing else loads. The real skill location is added to the read roots.
- An MCP file with no servers. Together with strict MCP config, no MCP server loads.

The launch line is generated from these inputs and never composed from free text. It carries the items below. The exact command line is in [integrations.md](integrations.md).

- the prompt;
- an empty setting-sources list (no user, project or local settings load, so the generated file is the only non-managed layer);
- the settings file, the plugin directory and the agents file;
- the named agent, when the purpose runs an agent directly;
- permission mode `dontAsk` and permission prompts `none`;
- strict MCP config with the empty MCP file;
- the model, and the cost cap as the host's budget flag;
- stream-json output with verbose, and the session ID.

### Session ID

The application layer generates a random UUID per invocation and records it in the `launch:{purpose}` step with status `started` before the request is returned, so a supervisor killed mid-run leaves the ID a resume needs. The adapter refuses (`invalid`) a session ID that is not a UUID. Reaping a stale host searches process command lines for the session ID. It ends a whole process group when the matched process leads one, otherwise the process alone. It sends SIGTERM, then SIGKILL after the grace period, and returns `unavailable` if a process survives SIGKILL.

### Refusals before launch

Checks run in this order and the first failure is the only one reported. Every refusal is `denied` with rule `enforcement_failure:{reason}` and nothing is started.

| Order | Reason | Condition |
|---|---|---|
| 0 | `invocation-files:{kind}` | The five inputs could not be written |
| 1 | `settings-missing`, `settings-invalid` | Settings file absent (`settings-missing`), or unreadable, not JSON or not an object (`settings-invalid`) |
| 1 | `settings-key:{path}` | One of nine required keys differs from its expected value (see below) |
| 2 | `hook-missing` | No PreToolUse entry carrying `--event pre` |
| 2 | `hook-not-blocking` | A PreToolUse or ConfigChange AVARICE entry lacks `onFailure: block` |
| 2 | `config-hook-missing`, `post-hook-missing`, `post-failure-hook-missing` | Required AVARICE hook entry absent |
| 2 | `hook-script-unreadable` | The script of any AVARICE hook entry is not a readable file |
| 2b | `hook-self-test` | The hook, started as the settings start it against a scratch copy of the policy and a scratch ledger, does not deny a Write outside the write roots (cannot start, crashes, times out, prints non-JSON, or allows) |
| 3 | `sandbox-unavailable` | The sandbox probe (Seatbelt applying an allow-default profile to a trivial command) fails or cannot start |
| 4 | `host-unavailable` | `claude --version` fails, hangs past 10 seconds or exits non-zero |
| 4 | `host-version-unreadable` | The output does not start with a version number |
| 4 | `host-version-not-admitted:{version}` | The version is not in the admitted list |
| 5 | `launch-args:{reason}` | The finished argument list fails judgment (below) |

The nine required settings keys are: permission mode `dontAsk`; bypass permissions mode disabled; sandbox enabled; sandbox fail-if-unavailable true; unsandboxed commands false; auto-allow-bash-if-sandboxed false; excluded commands empty; network allowed domains empty; network allowlist strict. Preflight checks these keys and the hook entries only. It does not re-check the allow and deny lists or the filesystem lists; those are trusted from the generator.

The admitted host versions are a constant list of five: 2.1.312, 2.1.316, 2.1.317, 2.1.318 and 2.1.319. A version is meant to be added only after a live containment run on it shows no containment failure; the code does not check that, it checks membership. The version probe, the sandbox probe and the hook self-test run with a minimal environment (a fixed `PATH` plus `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR` and `CLAUDE_CONFIG_DIR` when set).

Launch argument judgment refuses:

- the `--bare` flag (it would skip hooks and settings);
- any flag starting `--dangerously` or `--allow-dangerously`;
- the widening flags `--add-dir`, `--allowedTools`, `--allowed-tools` and `--permission-prompt-tool`;
- an empty prompt or a prompt starting with a dash;
- a permission mode other than `dontAsk` (including the `=` form and a missing one), and permission prompts other than `none`;
- setting-sources other than the empty string, a missing settings file, or missing strict MCP config;
- a cost cap that is not a positive finite number.

Judgment is over flags, not prompt text: a prompt that mentions a banned flag passes.

A refused launch still settles its reservation: the invocation unit is spent, with zero cost and the recorded duration. What a refusal does to the owner depends on the owner. An onboarding blocks with reason `enforcement_failure` only when the refusal is `denied` with an `enforcement_failure` rule; any other host error is returned as an error. A run blocks with `enforcement_failure` when the host error is `denied` or `unavailable`, and with `decision` for any other host error.

### Host readiness

The host adapter also has a startup readiness check behind its capability descriptor: hook script readable, sandbox probe, admitted version. It is evaluated once per adapter, so it does not run the hook self-test and does not read any settings file. The production composition replaces the adapter with a host that refuses every invocation when that check fails, recording the reason.

A run reads the same descriptor in its `verify-enforcement` action, the dynamic half of gate G0. The two halves select different reasons. A descriptor that does not report `enforced` blocks the run with `enforcement_failure`. A static G0 failure from the contract blocks it with `decision`. Both are recorded as a G0 gate row before the run moves on or blocks. Every launch still repeats the version, sandbox and hook checks itself, so a stale descriptor cannot launch a host that no longer passes them.

### Running the host

The host starts in its own process group with its working directory set to the purpose's working directory, the allowlisted environment and no stdin. A run starts in the symlink-resolved path of its clone, because the generated rules name that form. The adapter enforces the wall clock itself. It sends SIGTERM to the whole group at the limit and SIGKILL after a 10 second grace. It sends one more SIGKILL sweep after the process exits, so background subagent shells die with it. The caller also passes an abort signal. An onboarding passes one with the same timeout. A run passes one that is aborted when the supervisor loses its run lease. Either abort ends the process group as the wall clock does (SIGTERM, then SIGKILL after the same grace), and the invocation is still settled and stays charged. stderr is drained and dropped. Stdout is parsed as stream-json while it runs and kept up to 20 MiB, with a truncation marker. The transcript is redacted for secrets before it is stored as an artifact. A transcript that cannot be stored is an error, not a silent gap.

The outcome kind comes from facts only (the host's final result, the exit, the HEAD before and after, the hook's recorded denials), never from model text. The first rule that applies decides:

1. A moved HEAD is `failed`, whatever else happened.
2. No result event, or a wall-clock kill, is `inconclusive`.
3. The host's budget error, a terminal reason of budget exhausted, or a hook denial with rule `budget_exhausted` is `budget_exhausted`. A denial for the concurrent-subagent limit counts only as an ordinary denial.
4. An error result, a non-zero exit or a signal is `failed`.
5. A structural pause signal is `paused`; the host adapter never supplies one, so only a stage that derives it gets this kind.
6. Every expected file present is `progressed`. A run invocation names no expected files by default, so the adapter alone never classifies one as `progressed`.
7. Any host permission denial or hook denial is `denied`; otherwise `no_progress`.

A run's unit stage classifies the unit again with its own facts, the pause signal and the clone's changes, so for runs the adapter's kind is an input, not the final word. Stage handling of each kind belongs to [onboarding.md](onboarding.md) and [runs.md](runs.md).

## Purposes and their scopes

Four purposes exist, each with its own write scope, extensions and shell policy. The scope is computed from the stored contract and the working copy before any budget is reserved. A work root that is not a normalized absolute path (empty, relative, the filesystem root, or not normalized) is refused as `invalid` at that point, so nothing is reserved or started.

| Purpose | Working directory | Writable | Reads | Shell | Skill and agents | Subagents |
|---|---|---|---|---|---|---|
| map | staging | the codebase map directory under the planning directory | staging, the GSD core and agents directories, the allowed skill's real directory | Bash allowed, hook identity rules | the map skill; the mapper agent | contract totals |
| intel | staging | the intel directory under the planning directory | as map | as map, plus three intel-writing GSD verbs | no skill; the intel-updater agent runs directly | none |
| knowledge | the knowledge corpus directory inside staging | the extraction directory inside the corpus | the corpus only | none: Bash denied in settings and by the hook | none | none |
| run | the run's clone | the contract's write, create and artifact globs, plus the run's scratch directory | the clone, the scratch directory, the GSD core and agents directories, the allowed skill's real directory | Bash allowed; the hook admits read-only commands, the allowed GSD verbs and the contract's own commands | the quick skill; the planner, plan checker, executor and verifier agents | contract totals |

For the three onboarding purposes, a write directory the contract does not authorize is not writable at all: the write roots list is empty and every write is denied. The write directory is created by AVARICE before launch.

### The run purpose scope

A run has no single write directory. Its scope is built from the stored run contract and the clone, and differs from the onboarding purposes in these ways:

- **Write set.** The writable paths are the contract's write, create and artifact globs. Each glob's static prefix (the segments before the first wildcard) becomes a write root, or a file root when the glob has no wildcard. A glob that is empty, absolute, or holds an empty, `.` or `..` segment is dropped.
- **Protected paths.** The contract's protected globs always include the clone's git directory and the GSD configuration file under the planning directory. The hook refuses a write that matches a protected glob (`protected-path`) before it checks the write globs.
- **Scratch directory.** A scratch directory beside the clone is writable and readable. The host's temporary directory and the package manager cache live in it, and the package manager's update notifier is switched off, because the sandbox lets the run write nowhere else outside the clone. AVARICE creates these directories (mode 0700) before launch.
- **Denied tools.** The interactive question tool is refused by name by the host settings and by the hook (`no-human-prompts`). A Bash call with `run_in_background` is refused by the hook (`background-shell`).
- **Read before edit and loop limits.** Both are on; see "The PreToolUse hook".
- **Reads.** Reads are confined to the clone, the scratch directory and the read roots. Everything in "Read rules" applies, and the denied roots are wider than for the onboarding purposes (below).
- **Commands.** The contract's commands are admitted as exact word lists, with the form the hook checks described under "Command identity". The two denied prefixes `npm` and `npx` leave the denied list only when the contract lists a command starting with that word.

The run skill is the quick skill and its agents are the planner, plan checker, executor and verifier. AVARICE applies GSD's own settings for the run outside any invocation, before the first launch. They are seven `config-set` values: text mode on, the two gates off, audit on, worktrees off, GSD's own docs commit off and the branching strategy none. The run's prompt is one `/gsd-quick --validate --text` line with the contract text in it, capped at 32 KiB; a contract whose own text exceeds the cap is refused rather than cut.

### Generated settings, in effect

The settings carry these effects (names are the host's own):

- Allow: Read under staging (the corpus only for knowledge) and under each read root; Glob; Grep; Skill when a skill is linked; Agent when the subagent total is above zero; Edit under each write root; for a run, an Edit rule per literal file root and Read and Edit under the scratch directory; Bash (blanket) for the production strategy.
- Deny: Read of the user checkout and the data root; Edit of the data root; Read of the other denied roots, except any root that equals or contains the working copy (a permission deny has no re-allow and would deny every read of it); Read of each secret glob under the working copy; WebFetch; WebSearch; NotebookEdit; Edit of the planning config file in the working copy; each denied tool by name; Bash outright for knowledge; Bash for each denied command prefix.
- Sandbox filesystem: writes allowed only at the write roots, the literal file roots and, for a run, the scratch directory. Writes are denied for every existing working-copy entry outside the write set (listed one by one), the git directory, the planning config file and the git paths of the workspace. For a run they are also denied at the data root and the credential locations. Reads are denied for the user checkout, the data root and the work root. They are also denied for the credential locations, which are these paths under the home directory: `.ssh`, `.aws`, `.config/gh`, `.gnupg`, `.netrc`, `.npmrc`, `.docker`, `.kube`, `.config/gcloud`, `Library/Keychains`, `.git-credentials` and `.pgpass`. One list serves every sandbox AVARICE builds (the host sandbox of onboarding and runs, the supervisor's check commands, and the graph and GSD tool commands) and the hook's read denials. A run's reads are also denied for the default AVARICE parents (below). Reads are re-allowed for the invocation's own working copy only (not the directory above it, not a sibling whose name shares a prefix) and, for a run, its scratch directory.
- Sandbox network: no allowed domain, strict allowlist. The model API traffic is the host's own and sits outside the sandbox; a shell command has no network.
- Hooks: AVARICE's PreToolUse (matcher `.*`, 5 second timeout, block on failure), PostToolUse and PostToolUseFailure (same command, not blocking), ConfigChange (block on failure). GSD's secret read guard is appended as an extra PreToolUse entry (10 second timeout, not blocking) only when the Claude configuration directory has that script; no other user hook is kept.

Every existing entry is listed in the sandbox write denies for one reason. The working directory is always writable to a sandboxed shell, and a deny on a path overrides an allow beneath it. The only way to keep a shell out of the source tree is therefore to deny each existing entry. For the onboarding purposes the list comes from the staging tree. For a run it comes from the entries the clone tracks at its head, on the chain above each write root, plus the static prefix of every protected glob. A file created later at an unlisted location is not prevented; the checks after the work detect it.

### The default AVARICE parents

Every run sandbox denies reads of the default parents of all AVARICE profile roots: `~/.local/share/avarice` (all default data roots), `~/.config/avarice` (the config home) and `~/.local/share/avarice-work` (all default work roots, which hold other profiles' run clones). The run's own clone and scratch directory lie under the work parent and are re-allowed one by one. The Seatbelt profile also gives back the metadata of each directory between a denied root and a re-allowed path. It gives no contents and no listing, so programs can resolve the real path of a file below it. The same denial and re-allowance apply to the supervisor commands in "Commands AVARICE runs for checks". The limit this leaves is under "Limits of containment".

### Bash strategies

Four Bash strategies exist: blanket Bash with hook identity, narrow per-command allow rules, hook-allow (no allow rule; the hook prints an explicit allow) and none (no shell). Production selects blanket for map, intel and run, and none for knowledge. The narrow and hook-allow strategies are supported and tested but no production caller selects them.

## Environment scrubbing

The host's environment is built from nothing; a name is present only when listed. The host and everything it starts inherit it, and the sandbox passes it on unchanged. Present:

- The safe-git variables (see "Git safety").
- `HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME` and `CLAUDE_CONFIG_DIR`, each only when the parent has a non-empty value (no default is invented). For a run, `TMPDIR` is then replaced by the scratch directory's `tmp` subdirectory.
- `PATH`: the GSD core `bin` directory first, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. The builder accepts extra trailing directories, but no caller names any, so graphify is not on the host `PATH`.
- Two switches that keep instruction files and auto memory out.
- A run marker, `AVARICE_RUN`: the onboarding ID, or the run ID for a run. A value inherited from the parent is ignored.
- For a run only: `npm_config_cache` set to the scratch directory's `npm-cache` subdirectory, and `npm_config_update_notifier` set to `false`.

Proxy variables, TLS overrides, model-backend keys, cloud and SCM tokens, agent sockets and loader variables are never listed, so none arrives from the parent. In particular a run's invocation carries no proxy variable, whatever the supervisor process has. The background-task switch is deliberately not set, because the full map starts its mappers in the background.

The executor's own commands take their environment from the caller and inherit nothing. The GSD adapter builds it from the same git variables, the same passthrough names and a GSD `PATH`. The exact names are in [config-reference.md](config-reference.md).

## The PreToolUse hook

The hook is a separate process, started once per tool call by the host, outside the sandbox. It reads the invocation's policy file, decides, records, and answers. Any problem ends in exit 2, which the host treats as a block. The problems are:

- an unreadable or malformed policy;
- malformed or oversize (above 1 MiB) input, or input with no tool name or a missing required field;
- a missing ledger file (the hook never creates one, because an empty database has no budgets);
- a ledger with no row for the budget being charged;
- a file the edit rules cannot read, or any thrown error.

A deny is not an error: it prints the PreToolUse deny JSON with reason `avarice: {rule}` (followed by a corrective sentence for the read-before-edit, loop, git output and git object rules) and exits 0. An allow prints nothing and defers to the host's own permission rules, except under the hook-allow strategy, where an allow is printed for shell commands that pass identity.

The decision and its charge are one step. The pure rules decide first. For an allowed call, one transaction (immediate lock) then applies the read-before-edit and search-loop rules, checks the subagent concurrency limit, charges the budget with a conditional update and appends the `hook.decision` event. A call is therefore never charged without a row and never allowed without a charge, and parallel hook processes cannot overshoot a limit. A denied call charges nothing. Relative tool paths resolve against the `cwd` in the hook input when it is absolute, otherwise against the working copy. Every path is compared canonically: symlinks and `..` are resolved through the nearest existing parent, and a path that cannot be resolved is denied as `unresolvable-path`. A path is "under" a root when it equals the root or continues with a slash, so a sibling sharing a name prefix is outside. The one exception to the canonical comparison is the path part of a git object name, which is also matched against the secret globs as written (see rule 12).

### Tool decisions

| Tool | Decision | Charges |
|---|---|---|
| Any tool named in the policy's denied tools | Deny `no-human-prompts` (set for runs: the interactive question tool) | none |
| Edit, Write, MultiEdit, NotebookEdit | Allow when the target passes the write rules below (`write-set`); else `outside-write-set` or `protected-path`; `unresolvable-path` if it cannot be resolved | toolCalls |
| Read | Read rules below (`read-set` on allow) | toolCalls |
| Grep, Glob | Read rules applied to the search path (the working directory when no path is given); for a Glob whose pattern is absolute, also to the literal directory prefix before the first wildcard | toolCalls |
| Bash | Deny `background-shell` when the call runs in the background and the policy denies that (runs); otherwise command identity rules below (`shell-identity` on allow, `agent-command` when the allow rests on a contract command) | toolCalls |
| Agent, Task | Allow when the subagent type is in the policy's list (`subagent-type`); a call with no type counts as `general-purpose`, which no purpose lists; else deny `subagent-type` | subagentsTotal |
| WebFetch, WebSearch | Deny `network-tool` | none |
| Skill, TodoWrite, TaskOutput, BashOutput | Allow (`meta`); the host's rules decide which skill loads | toolCalls |
| Any other tool name | Deny `unknown-tool` | none |

The subagent types a policy lists are the names in the invocation's agents file plus a per-purpose extra list that is empty for every purpose. Subagent tool calls reach the same hook with an agent identifier, which is recorded, and draw on the same budget.

The decision rule names are a contract surface: 35 distinct rule IDs, of which 6 appear on allow decisions (`write-set`, `read-set`, `subagent-type`, `meta`, `shell-identity`, `agent-command`) and 30 on deny decisions. `subagent-type` appears on both. Two of the deny rules, `budget_exhausted` and `budget:subagentsConcurrent`, are decided by the hook entry when it applies the budget, not by the pure rules. The count and its command are in the coverage ledger.

### Read rules

One ordered rule set confines every read kind: the Read tool, search paths and shell operands.

1. If the policy confines reads (knowledge), a path outside the confinement root is `outside-read-set`, even inside the working copy.
2. A path under a denied root is `deny-read`, unless it is also under a re-allowed root.
3. A path not under the working copy, a read root or a re-allowed root is `outside-read-set`.
4. A path below the working copy that matches a secret glob is `deny-secret-read`. The glob is matched against the path relative to the working copy; the root itself is never matched; the glob applies to paths below the working copy, wherever the read rule came from.

An operand of an admitted git command that names a git object by path (`<revision>:<path>`, `:<path>` or `:<stage>:<path>`) is judged on its path part in two ways (rule 12). The path is matched as written, and then after the working copy's symlinks are resolved. A symlink in the working copy therefore cannot stand in for a secret name that git reads from history or the index. Together with the git output rules below, this keeps an admitted read-only command from printing a secret file in readable form, for the working copy, for history and for the index. This rule does not cover a contract command or the compressed object store (see Limits of containment).

The denied roots are the user checkout, the data root, the credential locations and the work root; the invocation's own working copy is re-allowed beneath the work root. For a run the default AVARICE parents are denied too, and the clone and scratch directory are the re-allowed roots. The secret globs come from the contract.

### Write rules

For the onboarding purposes a write is allowed when its canonical target is under a write root. For a run the rule is finer:

1. A target below the clone must match no protected glob, else `protected-path`.
2. It must then match a write, create or artifact glob (taken together, relative to the clone), else `outside-write-set`.
3. A target outside the clone is allowed only under a write root, which for a run is the scratch directory. Another run's clone, whose ID may share a prefix, is outside.

The hook cannot tell a modification from a creation, so a path matching only a create glob passes at call time. The gate over the changes after the work separates the classes (see "Staging and clone checks after the work").

### Read before edit (run purpose)

An edit of an existing file needs a recorded read of that file by the same agent in this invocation, and the file must be unchanged since. Edit, MultiEdit and NotebookEdit always count as edits; Write counts as an edit only when the file exists, so creating a new file needs no read. The rules, applied only after the path rules allowed the write:

- No recorded read: `edit-without-read`.
- The file is gone, or its content differs from the recorded read: `file-changed-since-read`.

Both denials carry a sentence telling the model to read the file again. The digest is a SHA-256 of the content, or the size and modification time for a file over 8 MiB. Digests are written by the hook after a successful Read or write, in the same transaction as the `tool.completed` event, one row per invocation, agent and path, replaced on every later read or write. A failed call records nothing, and a path outside the clone and the write roots records nothing. A write by the agent updates its own digest, so a second edit after its own write is allowed. The main agent and each subagent have separate records. Grep and Glob record no read.

### Loop limits (run purpose)

The contract's escalation limits stop an invocation that is going nowhere; the preset values are 3 consecutive denials and 25 consecutive searches. A limit of 0 turns that control off.

- **Consecutive searches.** A Grep or Glob call is refused `ineffective-search` when the unbroken run of Grep and Glob decisions before it has reached the limit. A shell call or a skill neither adds to the run nor ends it; an allowed Read, Edit or Write ends it.
- **Consecutive denials.** When the denial being decided is the Nth in a row for the invocation (counting hook decisions across all agents, by sequence), the limit is reached.

When either limit is reached the hook appends a `loop.limit` event (reason, count, the limit) and its output also carries `continue: false` with a stop reason, which ends the invocation. A refused search counts as a denial too. The count is taken inside the decision transaction, so two hook processes cannot both miss the limit.

### Command identity (Bash)

The hook admits a shell command only when it is a plain pipeline of admitted commands whose every operand passes the read rules. Everything else is denied. The rules, in the order applied:

1. Strategy none denies every call: `shell-disabled`.
2. An empty command or one over 16,384 characters is `shell-syntax`.
3. GSD preamble. The policy may carry a fingerprint: the SHA-256 and byte length of the first line of the GSD shim preamble, taken at GSD inspection. When the command starts with bytes that match it, the rest must be empty or start with a newline (otherwise `shell-preamble-trailing`). Each remaining non-blank, non-comment line is judged separately. Without a verified preamble the whole command is one line.
4. Per line, the only admitted special forms are two. One is the GSD init file-fallback line (matched exactly, preamble only). The other is an assignment of a variable to a command substitution of the form `NAME=$(gsd_run ...)` holding exactly one GSD segment. That form is admitted with a preamble only; otherwise it is `shell-gsd-no-preamble`, or `shell-syntax` when the substitution holds anything else.
5. Lexing. Quoting and a single `|` between segments are the only syntax allowed. Outside quotes these refuse as `shell-syntax`: `;`, `&`, `<`, `>`, backtick, `$`, parentheses, backslash, newline, `||`, an empty pipeline segment, and a word starting with `~` or `#`. Inside double quotes `$`, backtick and backslash refuse; single quotes are literal; an unterminated quote refuses. Redirection, chaining, substitution and backgrounding are therefore all denied by syntax.
6. Per segment, a first word `gsd_run` needs the verified preamble (else `shell-gsd-no-preamble`), a verb from the policy's GSD list (longest match; else `shell-gsd-verb`), no unquoted glob character (`shell-syntax`), and then the GSD argument rules below.
7. Contract commands (run purpose) are judged before the denied prefixes. A segment matches a contract command when its words equal the command's words. It also matches when the contract entry ended in `<paths>`, the segment starts with those words and every further word is a relative path that passes the read rules. An option, an absolute path or a word the shell would expand is refused. The rule is `shell-not-allowed`, or `shell-syntax` for an expanding word. A command whose first word is `git`, `avarice`, `claude`, `gh`, `curl`, `wget`, `ssh`, `scp` or `sudo` (by last path segment, any case) is never matched, whatever the policy file says.
8. Otherwise a segment that starts with a denied prefix is `shell-denied-prefix`. A segment that matches no admitted read-only command is `shell-not-allowed`.
9. An unquoted `*`, `?`, `[` or `{` in an admitted command is `shell-syntax`: the shell would expand it into names the path check never sees.
10. `find` with any denied action is `shell-find-action`. `git` with `--output`, `--ext-diff` or `--textconv` (bare or with `=`) is `shell-git-option`.
11. Every operand and every option value is treated as a path candidate and given the read rules, so a value that is not a path (a search term starting with `/`) is still judged as a path. Option clusters are read per character. Letters that take a value consume the rest of the cluster or the next word. A character in a cluster that is not an ASCII letter or digit and not consumed as a value is `shell-option-value`. A word after a bare double hyphen is an operand even when it looks like an option. A lone `-` is standard input and names no path. A short option that takes a value (for example `head -n`, `git log -n`, `git ls-files -x`) consumes its value as a path candidate.
12. Git object names. A word with a colon in the operands of an admitted git command is treated as a git object name by path: `<revision>:<path>`, `:<path>` or `:<stage>:<path>` with a stage number from 0 to 3. A brace anywhere in the word is `shell-git-object`, because a reflog or date form can hold a colon of its own and git would split the word at a different colon from the hook. So is a path part that starts with a slash, `!`, `(` or `^`. So is a path part that holds a wildcard (`*`, `?`, `[`) or a backslash. The hook refuses these forms rather than model them. Git can read the same word as a message search (`:/text`) or as a pathspec (`:!`, `:^`, `:(`, or a quoted `:*`). `git show` then prints HEAD's patch for the paths the pathspec matches. A backslash reaches git only inside a quoted word, and git reads a word that holds one as a pathspec. A path part that passes these tests is judged from two bases: the working copy root, where git resolves it, and the shell's directory, for the `./` and `../` forms. For each base the name is first matched against the secret globs as written, with `.` segments removed and `..` applied to the string without consulting the file system. A match is `deny-secret-read`, and a name that climbs above the root of the file system is `outside-read-set`. Then the name is given every read rule after the working copy's symlinks are resolved. All of these checks must pass. Git reads the name from the revision's tree or the index, not from the working copy. A symlink in the working copy (a live one, a dangling one, or one on a parent directory) therefore cannot stand in for a secret name. The cost is that `git show <revision>:.env` is refused even when that revision stores a symlink at `.env`, where git would print only the link text. Git resolves an object path from the top of the repository that contains the shell's directory. The hook resolves it from the working copy root and from the shell's directory. That matches git while the model has no admitted command that changes directory (`cd` and `git -C` are not admitted, and `git -c` is refused). An empty path part is judged as the working copy root and as the shell's directory, like any other path. After a revision it names that revision's root tree, and `git show <revision>:` prints the names in that tree, not file content.
13. Git output forms. `git log` and `git status` are admitted only with the options below, and `git show` with none. The options print no file content. They are an allow-list, because some git commands accept an unambiguous abbreviation of a long option (`git status --verb` is `--verbose`). Several spellings also imply a patch. A long option is compared as a whole word. A short option cluster is read per character. Any other option is `shell-git-output`. An option listed both bare and with a value (`--pretty`, `--decorate`, `--porcelain`, `--untracked-files`, `--ignored`) is admitted in both forms.
    - `git log`:
      - Short options: `-s`, and `-n` with its count attached or in the next word. A count of the form `-<digits>` is also admitted.
      - Long options without a value: `--oneline`, `--abbrev-commit`, `--no-abbrev-commit`, `--all`, `--branches`, `--tags`, `--remotes`, `--reverse`, `--no-merges`, `--merges`, `--first-parent`, `--graph`, `--decorate`, `--no-decorate`, `--follow`, `--stat`, `--shortstat`, `--name-only`, `--name-status`, `--relative-date`, `--pretty`, `--no-color` and `--no-patch`.
      - Long options with a non-empty `=value`: `--format`, `--pretty`, `--max-count`, `--skip`, `--since`, `--until`, `--after`, `--before`, `--author`, `--committer`, `--grep`, `--date` and `--decorate`.
    - `git status`:
      - Short options: `-s`, `-b`, `-z` and `-u`. The mode of `-u` is only attached, as in `-uall`. The next word is an option or an operand like any other.
      - Long options without a value: `--short`, `--branch`, `--porcelain`, `--long`, `--ignored`, `--untracked-files`, `--ahead-behind`, `--no-ahead-behind`, `--renames`, `--no-renames`, `--show-stash` and `--null`.
      - Long options with a non-empty `=value`: `--porcelain`, `--untracked-files`, `--ignored`, `--ignore-submodules` and `--find-renames`.
    - `git show` takes no option, and every operand must be an object by path (rule 12). With no operand it is `shell-git-object`. So it is with an operand that has no colon (a revision or an object name). Git prints a commit's patch or an object's content, and the hook cannot tell which a name is. A word that starts with a dash is `shell-git-output`, a bare `--` and a lone `-` included.

A `shell-git-output` or `shell-git-object` refusal tells the model the admitted spelling. Options are written whole with any value after `=` (`--max-count=5`). The files a commit changed come from `git log -1 --stat <revision>`. An object is named as `<revision>:<path>` or `:<path>`.

A `shell-syntax`, `shell-not-allowed` or `shell-denied-prefix` refusal also carries a reason that names what is admitted instead. For `shell-syntax` it is one plain command per call without the refused forms. For the other two it lists the commands this policy admits: the contract's commands as written and the read-only commands. Every reason adds the Read, Grep and Glob tools for reading and searching. A reason is built from fixed text and the policy's command names, so it never repeats the refused command and never names a path. The decision and the rule recorded in the ledger do not change; the reason goes only to the model.

For a git command the checks that follow the command match run in this order.

1. `shell-syntax` for an expanding word.
2. `shell-git-option`.
3. `shell-option-value`.
4. The read rules on every operand and option value.
5. Rule 12, per object name: `shell-git-object` for a refused form, then the match of the path part as written, then the read rules on it. Every word that the read parser of rule 11 or the option grammar of rule 13 takes as an operand is judged as an object name. For example `git status -M HEAD:.env` is `deny-secret-read`. Git takes the value of `-M` only attached, so rule 11 reads no value letter for `git status`, and `HEAD:.env` is an operand that is judged before rule 13 refuses `-M`.
6. Rule 13: `shell-git-output`, or `shell-git-object` for a `git show` operand that is not an object by path.

For `git show` the option test comes before the test that every operand names an object by path, so `git show -s HEAD` is `shell-git-output`. A git global option before the subcommand (`git --no-pager log`, `git -C dir show`) matches no admitted command and is `shell-not-allowed`; `git -c` is `shell-denied-prefix`.

The run scope drops from the contract any command that chains, redirects, substitutes, quotes, starts with a refused word or starts with a prefix that stays denied, before the policy is written. A contract command that runs repository code, such as a test command, is admitted by its words alone. What it does after that is limited by the sandbox and detected by the gates, not by the hook.

The admitted read-only commands are eleven: `ls`, `cat`, `head`, `tail`, `wc`, `find`, `git ls-files`, `git log`, `git rev-parse`, `git status` and `git show`. `git log`, `git show` and `git status` are admitted only in the forms of rule 13, and a git operand that names an object is admitted only as rule 12 allows.

The denied prefixes are sixteen: `git push`, `git commit`, `git -c`, `git config`, `gh`, `claude`, `avarice`, `npm`, `npx`, `pnpm`, `yarn`, `curl`, `wget`, `pip`, `uv pip` and `make`. The host's own deny rules carry the same list. For a run, `npm` and `npx` are removed from both lists when the contract lists a command that starts with that word; any other form of either still ends in `shell-not-allowed`.

The denied `find` actions are ten: `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-rm`, `-fprint`, `-fprint0`, `-fprintf` and `-fls`. The shell may run `find` as an implementation where `-rm` is an alias of `-delete`.

`grep` is not admitted, by name or through any wrapper. The shell tool may run it as an embedded or a system binary chosen per call, so the hook cannot model its options. Searching goes through the Grep tool, whose path the read rules judge.

GSD arguments. For a `gsd_run` verb, the words after the verb pass an option allow-list: `--raw` for every verb; `--budget` for `graphify query`; `--default` for `query config-get`; `--validate` for `query init.quick`. A value must not start with a dash. Any other option, a missing option value, or a value that is itself an option is `shell-gsd-option`; this keeps GSD's own working-directory and project-directory redirection out. Two verbs take exactly one operand from a fixed list, else `shell-gsd-operand`: `query config-get` takes one of seven configuration keys the quick workflow reads, and `loop render-hooks` takes `plan:pre` or `execute:post`. Every operand and option value is then read-checked. For `intel patch-meta`, whose operand GSD rewrites, each operand is also write-checked against the write roots.

The admitted GSD verbs are eleven for map: `runtime-identity`, `query init.map-codebase`, `query agent-skills`, `verify codebase-drift`, `state json`, `roadmap analyze`, `graphify status`, `graphify query`, `intel status`, `intel diff` and `intel query`. Intel adds three: `intel patch-meta`, `intel validate` and `intel snapshot`. Run adds three: `query init.quick`, `query config-get` and `loop render-hooks`. Knowledge has none. Verbs that write (`config-set`, `stamp-codebase-map`, `init onboard`) are run by AVARICE outside any invocation and are not on the list.

### Subagent limits

For an allowed Agent call the hook first counts the invocation's subagents in flight from its own events: admissions minus completions that freed a slot. At the concurrency limit the call is denied `budget:subagentsConcurrent`, unless the total is also spent, in which case the charge reports `budget_exhausted` (the more fundamental limit is named). The count is scoped to the invocation, so a killed invocation leaves nothing behind for a later one. A foreground completion frees its slot once. A call started in the background never frees its slot, because its completion event reports the launch, not the end. It holds the slot until the invocation ends. A subagent call that fails ends in the failure event and frees its slot the same way.

### Events the hook records

- `hook.decision`: level info for allow and warn for deny; carries tool, rule, the owner and invocation IDs, the agent identifier when present, the charged budget name, and for subagent calls the tool-use ID and a background flag. Never a tool payload. For a run the owner ID field carries the run ID.
- `tool.completed` (post events, including failures, which add a failed flag): attributes the completed call. A file write records its working-copy-relative target (clipped to 256 characters with a digest when longer), or an outside-the-working-copy flag, or an unresolved-target flag. A subagent completion records whether it freed a slot.
- `loop.limit`: the reason (`consecutive-denials` or `ineffective-search`), the count and the limit, written in the same transaction as the decision that reached it.
- `config.change.denied`: written best effort on every ConfigChange, which is refused every time whether or not the event could be written.

Post-hook failures do not block anything: the call has already run, and the settings do not set block on failure for them. A completion that cannot be recorded only leaves a subagent slot held, and loses the read record a later edit would need.

## Budgets and reservations

Five budgets live in the ledger, created from the contract when it is stored and surviving kills and resumes: invocations, toolCalls, subagentsTotal, wallClockMs and costUsd. An onboarding and a run each have their own five. The first four are exact. Cost carries the exactness the contract declares (estimated, because the host reports cost only at the end). A run's wall clock is the contract's minutes, stored in milliseconds, and its cost limit is the per-run cost.

| Budget | Charged by | When |
|---|---|---|
| invocations | The application layer | Reserved before launch; moved to used when the invocation settles |
| toolCalls | The hook | One per allowed tool call, at decision time |
| subagentsTotal | The hook | One per allowed Agent call |
| wallClockMs | The application layer | After the invocation, from its measured duration |
| costUsd | The application layer | After the invocation, from the host's reported cost |

An invocation reservation, and each hook charge for tool calls and subagents, succeeds only when used plus reserved plus the amount stays within the limit. Settlement charges for wall clock and cost are applied unconditionally after the run, so those two totals can pass their limits; the reservation and the cost cap bound the overshoot. The budget is shared by every invocation and every subagent of its owner, so parallel work draws from one balance. The concurrent subagent cap is carried in the invocation scope for the hook and is not a budget row.

Reservation. Before anything launches, the application layer grants an invocation only when wall clock, cost and an invocation unit are all left. For an onboarding the wall-clock allowance is the smaller of the purpose's share and what remains. For a run it is the smaller of the contract's wall clock and what remains. The cost cap is the smaller of the contract's per-invocation cap and what remains of the budget. It is passed to the host as its budget flag and bounds how far the total can pass its plan. When any budget is spent the grant is refused with that budget named, nothing is launched or recorded, and the owner ends blocked with `budget_exhausted`.

Settlement. Nothing is refunded. An invocation always settles after it ran: one invocation unit, the measured duration, and the cost. A killed, interrupted or crashed invocation is charged the larger of its reported cost and its full cost reservation, not zero. Kills include a signal, the wall clock and a cancel that may have left the process running. A crash is an ending without a result, whether the host exited non-zero or exited 0 and printed none. Such a host reports no cost, so what it cost is unknown, as for a kill. A killed host prints no result, and an orphaned host keeps working. An invocation that reported a result and was not killed is charged its reported cost. A host the adapter cannot start is charged its invocation unit, the elapsed time and no cost. The charges of one settlement (the unit moved from reserved to used, the wall clock and the cost) are written in one transaction. A failure or a kill between them leaves all of them unwritten, and the reservation is later converted as an orphan (below). For a settled outcome the `invocation.finished` event records both figures and the basis; when the host returns an error, the failed `launch:{purpose}` step records the charged amount. A reservation whose holder died without settling is converted to spent on the next reservation attempt, each orphan charged the cost reservation it was granted, and an `invocation.orphan-charged` warning is recorded. The orphan's charges and that warning are written in one transaction too, so a kill between them cannot leave a reservation spent while its cost is uncharged. An orphan is charged its invocation and its cost only; its wall clock is not charged. A resumed run converts an orphan at once, as soon as it has ended the orphan's host, so a run that stops before it reserves again still shows the killed invocation as charged.

These services write two events. Neither carries transcript text.

- `invocation.finished`: the owner IDs, the invocation ID, purpose, outcome, reported cost, charged cost and its basis, duration and the permission denial count. When the host ran it also carries its exit, signal, timeout flag, moved-HEAD flag, hook denial counts, turn count, transcript size, result subtype, terminal reason and subagent count.
- `invocation.orphan-charged`: the owner ID, the invocations charged and the cost charged.

## The sandboxed executor

AVARICE's own subprocesses go through a local executor. They are the GSD verbs it runs in staging, the graphify commands, and the supervisor's install, check and inventory commands for a run. The executor runs every command as the system sandbox launcher with a generated Seatbelt profile. Production always uses it; only test entry points that already run inside a sandbox replace it. Argument lists are never shell strings, the environment is exactly what the caller gives, and the command leads its own process group.

The profile is built in this order, relying on later rules winning:

1. Start from allow-default; deny all network; deny all file writes.
2. For each loopback port the caller names, allow outbound connections to localhost on that port. There is none by default.
3. Allow writes to the per-user temp areas (`/private/var/folders`, `/private/tmp`), `/dev/null`, `/dev/dtracehelper` and tty devices.
4. Deny writes below the command's working directory (it may itself lie under a temp area).
5. Allow writes below each declared write path (these win over step 4).
6. Deny reads below each deny-read path.
7. Allow reads below each allow-read path (these win over step 6).
8. Allow the metadata of each directory above an allow-read path that lies inside a denied path, one literal each.

So the model is: everything is readable except the named paths, only declared paths and temp areas are writable, and the network is denied except the one loopback port a supervisor step names. Only AVARICE's own supervisor steps set a port; an agent invocation never gets one. Every path is resolved to its real location first, and a path containing a double quote, backslash, newline, carriage return or NUL is refused rather than escaped. A port that is not an integer from 1 to 65535 is refused. For GSD verbs, the write path is the staging planning directory, an explicit list the caller names, or empty for a read verb. The read denies are the data root and the credential locations, not the user checkout or the work root.

When the sandbox cannot be used, the result is `unavailable` and nothing is spawned; there is no unsandboxed fallback. The probe runs once per launcher path per process. A clean exit is cached. A timeout, signal or spawn error is retried once with a longer timeout and, if still unclean, answers false for that call only. The launcher's own failures (profile did not compile, sandbox could not be applied) surface as `unavailable`. Commands end `passed`, `failed`, `timed_out` or `cancelled` (SIGTERM, then SIGKILL after 5 seconds; stragglers die with the group), or `spawn_error`. Output per stream is cut at the limit with a marker (5 MiB by default). The working directory must be absolute and an existing directory, and the timeout positive, or the call is `invalid`.

### The egress proxy

The sandbox cannot filter by host name, so a supervisor step that needs the network gets one loopback port and an allowlisting proxy listens on it. The proxy runs inside AVARICE's own process, outside the sandbox, binds 127.0.0.1 on an ephemeral port and lives for that one command. Its rules:

- It accepts CONNECT only, to an exact host and port from its allowlist (host compared lower-case). Any other target is answered 403, a malformed target 400, a request that is not CONNECT 405, and an allowed target it cannot reach 502.
- Every attempt is recorded as host, port and whether it was allowed, never a path or a header, and reported to the caller.
- An allowlist entry that is not an exact host and port (a DNS name or IPv4 literal and a decimal port) is refused as `invalid`.
- For an allowed target the proxy resolves the host name itself and checks every address the name resolves to. If any of them is not a public unicast address, the tunnel is refused with 403 and recorded as refused. In IPv4 the refused ranges are this network (`0/8`), private, loopback, shared (`100.64/10`, carrier-grade NAT), link-local, `192.0.0/24`, benchmarking (`198.18/15`), and multicast and everything from `224.0.0.0` up. In IPv6 they are unspecified, loopback, the deprecated IPv4-compatible block (`::/96`), unique local, link-local and multicast. An IPv4-mapped address and an address under the NAT64 prefix (`64:ff9b::/96`) are judged by the IPv4 address they carry. Every other address is admitted, the IPv4 documentation ranges and the 6to4 and Teredo forms among them. A name with no address is refused with 403. A name that does not resolve is answered 502 and recorded as allowed.
- The proxy connects to the first address it checked, not to the name, so the name is not resolved a second time and cannot be pointed somewhere else between the check and the connection.
- An allowed tunnel is opaque: the proxy does not inspect the traffic.

Two supervisor steps use it. The dependency install gets an allowlist of the registry hosts the repository conventions name, each on port 443, and nothing else. Active validation of declared checks gets an empty allowlist: there the proxy is a detector that records what a check tries to reach, and allows nothing.

### Commands AVARICE runs for checks

The install, validation, baseline, item and final check commands and the test-inventory list command all run through the executor with the same posture. The checks pipeline itself is in [checks-and-evidence.md](checks-and-evidence.md).

- **Environment.** No variable is inherited from AVARICE except `PATH`, which is the directory of the running node followed by AVARICE's own `PATH`. The command also gets `HOME` and `TMPDIR` set to the run's scratch directory, the package manager cache inside it, `CI=1` and `LANG=C`. These go over the check's own declared environment, and the sandbox values win.
- **Reads.** Denied: the credential locations, the profile's data root and the default AVARICE parents. Re-allowed: the working tree the command runs in, and the scratch directory. The user checkout and a work root moved off the default are not in the denied list.
- **Output.** A check's output is redacted for secret-shaped strings before it is stored as an artifact, as transcripts are (see "Secret redaction").
- **Writes.** A check may write its declared write paths (the static prefix of each declared glob) and the scratch directory. The install may write the clone's `node_modules` and the scratch directory. The test-inventory list command may write the declared paths of every check and the scratch directory. Validation lets a check write anywhere in the validation clone, because the writes are what is measured.
- **Network.** None, except one loopback port. The install's proxy allows the registry hosts. The validation proxy allows nothing and records the attempts. The install also sets the package manager's proxy variables, switches off its update notifier and sets its ignore-scripts switch through the environment.
- **Install timeout.** 15 minutes.

## Git safety

Every git subprocess AVARICE starts carries one environment. Repository hooks are disabled by pointing the hooks path at the null device, and fsmonitor is off. System config and system attributes are not read. Optional locks are off, so read-only calls do not refresh the user's index. Terminal prompts are off. Nothing from the caller's environment reaches git except `PATH` (with a default), `HOME` and `LANG`. The contained host inherits the same variables, so GSD's own git calls carry the guard. The host environment does not carry filter blanking; that exists only on AVARICE's own calls.

Refused before git runs:

- any leading global option (the subcommand must come first, which also rules out the config, directory and exec-path options);
- the config-env option anywhere;
- for `clone`, any option outside a short allowlist (`--local`, `--no-hardlinks`, `--no-checkout`, `--quiet`, `-q`);
- for `fetch`, any option outside `--no-tags`, `--no-write-fetch-head`, `--quiet` and `-q`, and any refspec starting with `+` (a forced update);
- for `commit`, any option outside `--no-verify`, `--no-gpg-sign`, `--quiet`, `-q` and `-m` with its message.

The clone and fetch checks are allowlists because git accepts abbreviations such as `--conf` for `--config`. Other subcommands have no option allowlist, and options such as `switch -c` stay allowed.

Filter neutralization. git runs a clean filter to compare a working-tree file with the same size as its index entry, so `git status` of a repository with a hostile filter would run code. Calls that compare or write working-tree files get this treatment. They are status, diff, checkout, worktree add, and the run clone's commit, restore and tree computations. AVARICE queries the repository's filter drivers with a configuration read, which runs nothing. For that one call it blanks the clean, smudge and process commands of every driver and sets required to false. A failed query yields no overrides and the real command reports its own error. A caller can also ignore the user's and machine's exclude files for one call, so only the repository's own rules decide what is ignored.

### The supervisor's commit and the hand-off

The supervisor commits, never the model; the hook denies `git commit` and `git add`, and the git directory is a protected path. The run clone's commit takes exactly the clone-relative paths it is given. Each path must be relative, inside the clone, not start with a dash and not name git's own directory; the message must be non-empty and free of NUL; trailers must be single `Key: value` lines. Pathspecs are literal (no glob, no magic). The commit uses a fixed identity (name `AVARICE`, address `avarice@localhost.invalid`), `--no-verify` and `--no-gpg-sign`, and fails with a conflict when the paths hold no change.

The hand-off is the one write AVARICE makes to the user's repository. It fetches the run branch, `avarice/{run}`, from the clone into the source repository as `refs/heads/avarice/{run}` and nothing else. It never forces and never checks anything out. It turns the source repository's automatic garbage collection and maintenance off for the call. It runs with object checking on, because the objects come from a tree an agent wrote into. It is create-only by check: a ref that already exists at the same commit is success, and at a different commit is a conflict with nothing fetched. The run clone itself is built by a partial clone then rename, so a half-built clone never appears at the final path.

## Staging and clone checks after the work

These detect what the sandbox and hook did not prevent; they do not prevent it.

- **HEAD.** The head is read before and after the host runs. A moved HEAD classifies the invocation `failed`. The onboarding stages for map, intel and knowledge each record a `containment.finding` (check `staging-head-moved`). A run that sees a moved clone HEAD blocks with `enforcement_failure` and a `containment.finding` (check `head-moved`), and no recovery touches the clone.
- **Activation scope check (onboarding).** Immediately before the project record is built, AVARICE judges the whole staging diff against the pinned revision. That diff lists modified, added and deleted names, including ignored untracked files one by one. It must lie inside the union of the write sets of every purpose that ran plus AVARICE's own. A modified or deleted path must be inside the write set and in a place where a tracked file may change. An added path must be inside the write set and must not be a tracked path outside those places (a deleted-and-recreated file). Any violation appends a `containment.finding` event (check `activation-scope`, a count, and up to a capped number of paths), and the onboarding blocks with reason `enforcement_failure`. The same judgment runs in validation before the index steps. Activation repeats it afterwards, so a write by an index step or a late invocation cannot reach an active record.
- **Gate G2 (run).** After a unit, AVARICE measures the clone's changes against a snapshot taken before it, from facts only, and judges them. The scope rules are as follows. A path matching a protected glob fails. A modified path must match a write or artifact glob, an added path must match a create or artifact glob, and a deleted path must match a delete glob. G2 also judges the outcome, the test inventory, the GSD verification status, new overrides, prune entries and the checks delta, in a fixed rule order. A failure of the scope rules or the deletion rule blocks the run with `enforcement_failure` and a `containment.finding` (check `scope-of-writes`, at most ten paths). Any other G2 failure blocks with `decision`.
- **Gate G4 diff gate (run).** Before the hand-off, every path the run branch changed against the pin must be inside the contract. There is no protected or artifact path, a modified path is inside the write globs, an added path is inside the create globs and a deleted path is inside the delete globs. G4 also requires a committed clean revision, a clean checks delta, mapped acceptance criteria, no stale or inconclusive required evidence, no open decision and no exceeded budget.

The comparison G2 uses covers tracked and untracked content that git does not ignore. A write into a git-ignored location is not in it (see "Limits of containment"). Restoring the clone after a failed unit is described in [runs.md](runs.md).

### Repository proposals narrow only

At activation, the repository's proposed paths and commands are checked against the profile policy, and a proposal can only narrow authority. The policy grants read of everything, write of nothing, and protects the AVARICE and CI directories. Protected additions are always accepted. Read entries are accepted when the policy already grants them. Write, generated and artifact entries are accepted only when covered by what the policy grants, which is nothing, so each is rejected as `widens`. Commands are accepted only as `inactive`; any other status is `widens`. An unknown key is `unknown`, the verification-by-change-type key is `unsupported`, and a malformed or oversize value is `invalid`. A glob entry is invalid when empty, over 256 characters, absolute, containing NUL or a backslash, or holding a `..` segment. The command list is capped at 50 entries and each argument list at 64 words of at most 1,024 characters. Proposal input is parsed, never executed or mutated. Every rejection becomes a finding on the record (field, a clipped copy of the value, reason). A proposal file over 64 KiB, unreadable or not valid JSON becomes a single finding and activation continues with nothing accepted. The record shape is in [data-model.md](data-model.md).

## Root placement and local mount

Profile resolution judges the data root and the work root before creating anything, each resolved through its nearest existing ancestor's real path so a symlinked root is judged by where it lands. Rules, reported in this order (data root first, then work root):

1. A root under `~/.claude*` (any first segment below home starting with `.claude`) is refused, because sandboxed runs cannot write there.
2. A root equal to or under the real Claude config directory is refused.
3. A root that would contain the home directory or the Claude config directory is refused.
4. The two roots may not be nested in either direction, and may not be the same directory.

Each refusal is `invalid` for the root's field; the `~/.claude*` and non-local-mount refusals also name the environment variable to change. Then the data root must sit on a mount that the `mount` command reports with the `local` flag (macOS; SQLite WAL is unsafe on network storage). On Linux output, which has no such flag, a mount is local unless its type is a known network type (NFS, CIFS, SMB, AFP, WebDAV, 9p, Ceph, GlusterFS, sshfs and similar). The mount whose mount point is the longest path-boundary prefix of the root decides. If the mount table cannot be read, no mount command exists or no entry contains the path, the result is `unavailable` and the profile is refused (fail closed); a non-local mount is `invalid`. Only after both checks are the directories created (mode 0700) and the config file written (mode 0600, only when absent). The work root gets the placement rules but not the local-mount check. The default roots are in [config-reference.md](config-reference.md).

## Secret redaction

The stored transcript is redacted before it is written: secret-shaped strings (private keys, tokens, cloud key IDs, authorization headers, credentials in URLs) are replaced by `[REDACTED:{kind}]`. The output of each declared check is redacted the same way before it is stored as an artifact. Secret scanning of map documents and the knowledge corpus is described in [onboarding.md](onboarding.md) and [indexes-and-context.md](indexes-and-context.md).

## Limits of containment

These are the places where containment detects, or does not reach, instead of preventing.

- **A new entry at an unlisted location.** The sandbox lets a shell write anywhere under the working directory except the existing entries it lists. A file created at an unlisted location is not prevented. Onboarding detects it at activation. A run detects it at G2 and G4, but only when git does not ignore the path. The run's list of denied existing entries comes from what the clone tracks at its head. An untracked entry that already exists (installed dependencies, for example) is therefore writable and, when git ignores it, outside the gate. Only a command the contract lists, or a file tool inside its write globs, can write at all; the hook admits no other writer.
- **Protected globs and write roots at the sandbox.** The sandbox denies writes at the static prefix of each protected glob and at the listed entries a glob matches. A protected glob that starts with a wildcard has no prefix. Inside a write root it is held by the hook for file tools and by the gates for contract commands, not by the sandbox. The sandbox grants writes by directory root. The finer glob rules, the split between modify, create and delete, and read-before-edit are therefore enforced by the hook and the gates, not at the shell.
- **Profile roots outside the default parents.** A run denies its own profile's data root and work root, and the default parents of every profile's roots. A profile whose roots were moved with `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT` or `AVARICE_CONFIG_HOME` is not covered, and neither is this profile's config home when it is moved. Another profile's moved roots stay readable to a run and to the supervisor's check commands.
- **Credentials stored elsewhere.** The credential denial is a list of known locations. A credential kept anywhere else under the home directory stays readable to a sandboxed command, because reads are otherwise allowed by default. An allow list of readable paths would close this, but node and npm need many system paths, so it is not in place.
- **Network detection in declared-check validation.** Validation prevents network access with the sandbox: no domain, and one loopback port in front of a proxy that allows nothing. It detects an attempt in two ways: the proxy records a connection made through the proxy, and the check's output is searched for the resolver and connection error text. A program that ignores the proxy settings is blocked by the sandbox and is detected only when its error text reaches the output. A check that swallows the failure leaves nothing to find, and the verdict is `active`. When the proxy cannot start, the check runs with no network at all and only the output search remains. A check that exits non-zero is not rejected for that; validation judges only the writes outside its declared paths and the network.
- **Install scripts.** The install's ignore-scripts switch is an environment variable for the package manager. It does not constrain a package manager that does not read it. The sandbox bounds what a script can do either way: network only to the allowed registry, writes only to `node_modules` and the scratch directory.
- **Generated, not re-verified at launch.** The allow and deny lists, the filesystem lists and the hook policy are generated by AVARICE and are not re-checked at launch. Launch readiness checks nine settings keys, the hook entries and the hook self-test only, and the self-test proves one thing: a Write outside the write roots is denied.
- **The model's own traffic.** The model API traffic is the host's, outside the sandbox and not confined by AVARICE. Whether the host honors each setting is the host's behavior; AVARICE verifies the admitted version and the hook self-test, not each setting's effect. Results of live runs against real host versions are runtime evidence and are not asserted here.
- **Secret files read by code the run executes.** The secret globs confine the model's own tools and the admitted shell commands, through the hook and the host's Read deny rules. The sandbox denies reads by root, not by secret glob. Code that a contract command runs (a test the run wrote, for example) can therefore read a secret file present in the clone and print it. The clone is checked out at the pin, so it starts with only the files committed there. Installs and the run's own writes add more. The git object store under the clone's git directory holds every object of the source repository's object store, committed or not, compressed. The read rules do not refuse that directory, and `cat` of an object file there prints it compressed. No admitted command decompresses an object file that it names by path, but a contract command's code can. Whether to deny the clone's secret paths at the sandbox, which can break a check that loads them, is an open owner decision (see [findings.md](findings.md)).
- **Registry resolution and tunnels.** The proxy still trusts DNS to choose among public addresses, and it does not inspect an allowed tunnel. A registry reachable only on a private network cannot be used by the install. That covers a mirror on a local network, an address in a private or shared range, and a public name that resolves to a private address. The repository conventions refuse the host names that can only mean a local target (see [config-reference.md](config-reference.md)).
- **Local-mount heuristic.** A FUSE or synced-folder mount can still report `local`.

## Quirks to know

- Launch readiness trusts the generator for the allow and deny lists and the filesystem lists; it verifies only nine settings keys and the hook entries, plus the hook self-test.
- The hook self-test proves one thing: a Write outside the write roots is denied. It does not exercise read rules, shell rules, budgets, read-before-edit or loop limits, and it runs against a scratch ledger.
- A refused launch costs an invocation unit.
- A concurrency denial is not counted as a budget denial in the outcome; only `budget_exhausted` is.
- Read confinement checks the path a tool names, not the Grep pattern or file-type filters. Reads outside confinement through a pattern are stopped only by the sandbox and host deny rules for shell, and by the Read allow rules for file tools.
- The GSD secret read guard, when present, is non-blocking, so a crash in it does not stop a call.
- Shell reads under the sandbox can reach anything not in the sandbox read denies; the hook's allow-list (the working copy, read roots) is stricter than the sandbox's deny-list, which is why both exist.
- `git show` of a commit and `git log -p` are refused even when no secret file changed, because the hook cannot tell which paths a patch or an object name will print. `git log -1 --stat <revision>` lists the changed paths with line counts, and `git show <revision>:<path>` prints a file as it stood at that revision; neither prints the patch.
- `git show <revision>:<path>` is refused for a secret name even when that revision stores a symlink there (see rule 12).
- The host's own Read deny rules name each denied root as a directory, so they do not match the credential entries that are files (`.netrc`, `.npmrc`, `.git-credentials`, `.pgpass`). The sandbox and the hook still refuse those files (see [findings.md](findings.md)).
- A hook with an unreadable policy blocks every call, including harmless ones.
- The hook cannot tell a modification from a creation, so a file tool can modify a tracked file that matches only a create glob. The gate after the unit refuses it.
- For a run, `hook.decision` and `tool.completed` events name the run in the field that holds the onboarding ID for an onboarding.
- A background Bash call is refused for a run, but a background Agent call is still allowed and holds its concurrency slot until the invocation ends.
- Read-before-edit keeps one record per agent, so a read by the main agent does not let a subagent edit the file.
- The decision rule `subagent-type` is both an allow and a deny rule ID.
- The run's check commands may read the user's checkout and a moved work root, which an agent invocation cannot.
- Validation of declared checks passes the read denials without the read re-allowance that the other check commands pass. The validation clone lies in the run's directory under the work root, so under the default roots it falls inside a denied parent. Whether a check can then read its clone was not tested.
