# Containment

This document describes the contained agent invocation as built in the Claude host adapter, the sandboxed command executor, the PreToolUse hook entry and its pure decision rules, the invocation scope, budget and invocation application services, the activation scope check and proposal narrowing, the safe-git module, the local-mount check and the root-placement rules (`src/adapters/host-claude/`, `src/adapters/exec/`, `src/hook/`, `src/domain/hook-decision.ts`, `src/domain/invocation-scope.ts`, `src/domain/policy-narrowing.ts`, `src/domain/secret-patterns.ts`, `src/app/budget.ts`, `src/app/invocation.ts`, `src/app/stages/activate.ts`, `src/adapters/git/safe-git.ts`, `src/adapters/fs/local-mount.ts`, `src/domain/root-rules.ts`).

A contained invocation is one headless Claude Code process that AVARICE starts, confines and judges. Nothing starts unless launch readiness and launch argument judgment pass, and each check that fails refuses; none falls back to a weaker mode. The remaining layers are generated, not re-verified at launch (see "Quirks to know"). Two things are not prevented, only detected: a file created at an unlisted location inside staging, and a moved staging HEAD. Both are caught after the run (see "Staging checks after the run").

The onboarding lifecycle that drives invocations is in [onboarding.md](onboarding.md), the stored contract and ledger schema in [data-model.md](data-model.md), CLI flags in [cli-reference.md](cli-reference.md) and environment variables in [config-reference.md](config-reference.md).

## Layers at a glance

| Layer | What it enforces | Enforced by | On failure |
|---|---|---|---|
| Launch readiness | Settings keys present, AVARICE hook blocking and readable, hook self-test denies an outside write, sandbox applies a profile, host version admitted | AVARICE, before every launch | No process starts; denied with `enforcement_failure:{reason}` |
| Launch argument judgment | Fixed permission mode, no bypass or widening flag, settings and cost cap present | AVARICE, before every launch | No process starts; denied with `enforcement_failure:launch-args:{reason}` |
| Environment allowlist | Only listed variable names reach the host and its children | AVARICE | A name not listed is absent; there is no failure path |
| Host permission rules | Read, edit, shell and web tool grants for one purpose | Claude Code, from generated settings | Anything not allowed is denied (`dontAsk`, no prompts) |
| Host sandbox (Seatbelt) | Shell and child-process writes, reads and network | Claude Code, from generated settings | Host refuses to run shell commands when the sandbox is unavailable |
| PreToolUse hook | Every tool call: read confinement, write set, command identity, subagent types, budgets | AVARICE hook process | Exit 2 blocks the call; settings also say block on failure |
| ConfigChange hook | No settings, hook or permission change during the run | AVARICE hook process | Always refuses |
| Budgets | Invocation, tool-call, subagent, wall-clock and cost limits | AVARICE ledger, hook, host cost cap, adapter timer | Reservation refused, call denied, or process group killed |
| Sandboxed executor | AVARICE's own subprocesses (GSD verbs): no network, declared writes only, named reads denied | AVARICE, Seatbelt | `unavailable`; the command is not run |
| Safe git | No repository hook, fsmonitor, filter, prompt or caller config override runs | AVARICE | Unsafe arguments refused before git runs |
| Staging checks | Staging diff inside the union of write sets; HEAD unmoved | AVARICE after the run | Detection: onboarding blocks, finding recorded |
| Root placement | Roots outside Claude config directories, not nested, data root on local storage | AVARICE at profile resolution | Profile refused; nothing is created |

## How a launch is assembled

One invocation produces five inputs in its own directory under the data root, then three checks, then the launch.

The directory is named by onboarding, purpose and invocation ID. The onboarding and invocation IDs must be plain names (letters, digits, underscore, hyphen; no leading dot or separator), or the adapter returns `invalid` before writing anything. Directories are created mode 0700 and files mode 0600, each written beside its target and renamed, so a reader never sees half a file. The inputs are:

- The generated settings file (permission rules, sandbox lists, hook entries).
- The hook policy file: the same scope in the form the hook reads, with every path canonicalized (symlinks resolved, on-disk case on a case-insensitive volume). A path that cannot be canonicalized fails the build.
- The agents file: one entry per agent the purpose names, built from GSD's agent markdown. An agent definition that sets a permission mode or hooks is refused, so an agent cannot step outside the generated settings. Only description, prompt, tools, disallowed tools and effort are passed on.
- The plugin directory: symlinks to the real location of each allowed skill, so nothing is copied and nothing else loads. The real skill location is added to the read roots.
- An MCP file with no servers. Together with strict MCP config, no MCP server loads.

The launch line is generated from these inputs and never composed from free text. It carries: the prompt; an empty setting-sources list (no user, project or local settings load, so the generated file is the only non-managed layer); the settings file; the plugin directory; the agents file; the named agent when the purpose runs an agent directly; permission mode `dontAsk`; permission prompts `none`; strict MCP config with the empty MCP file; the model; the cost cap as the host's budget flag; stream-json output with verbose; and the session ID. The exact command line is in [integrations.md](integrations.md).

### Session ID

The application layer generates a random UUID per invocation and records it in the `launch:{purpose}` step with status `started` before the request is returned, so a supervisor killed mid-run leaves the ID a resume needs. The adapter refuses (`invalid`) a session ID that is not a UUID. Reaping a stale host searches process command lines for the session ID, ends a whole process group when the matched process leads one (otherwise the process alone), sends SIGTERM, then SIGKILL after the grace period, and returns `unavailable` if a process survives SIGKILL.

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

The admitted host versions are a constant list: 2.1.312, 2.1.316 and 2.1.317. A version is meant to be added only after a live containment run on it shows no containment failure; the code does not check that, it checks membership. The version probe, the sandbox probe and the hook self-test run with a minimal environment (a fixed `PATH` plus `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR` and `CLAUDE_CONFIG_DIR` when set).

Launch argument judgment refuses:

- the `--bare` flag (it would skip hooks and settings);
- any flag starting `--dangerously` or `--allow-dangerously`;
- the widening flags `--add-dir`, `--allowedTools`, `--allowed-tools` and `--permission-prompt-tool`;
- an empty prompt or a prompt starting with a dash;
- a permission mode other than `dontAsk` (including the `=` form and a missing one), and permission prompts other than `none`;
- setting-sources other than the empty string, a missing settings file, or missing strict MCP config;
- a cost cap that is not a positive finite number.

Judgment is over flags, not prompt text: a prompt that mentions a banned flag passes.

A refused launch still settles its reservation: the invocation unit is spent, with zero cost and the recorded duration. A refusal blocks the onboarding with reason `enforcement_failure`.

The host adapter also has a startup readiness check behind its capability descriptor (hook script readable, sandbox probe, admitted version), evaluated once per adapter. The production composition replaces the adapter with a host that refuses every invocation when that check fails, recording the reason.

### Running the host

The host starts in its own process group with its working directory set to the purpose's working directory, the allowlisted environment and no stdin. The adapter enforces the wall clock itself: SIGTERM to the whole group at the limit, SIGKILL after a 10 second grace, and one more SIGKILL sweep of the group after the process exits so background subagent shells die with it. The caller also passes an abort signal with the same timeout. stderr is drained and dropped. Stdout is parsed as stream-json while it runs and kept up to 20 MiB (a truncation marker follows). The transcript is redacted for secrets before it is stored as an artifact; a transcript that cannot be stored is an error, not a silent gap.

The outcome kind comes from facts only (the host's final result, the exit, the staging HEAD before and after, the hook's recorded denials), never from model text. A moved staging HEAD classifies the invocation `failed` whatever else happened. No result event or a wall-clock kill is `inconclusive`. A hook denial with rule `budget_exhausted` classifies `budget_exhausted`; a denial for the concurrent-subagent limit counts only as an ordinary denial. Stage handling of each kind belongs to [onboarding.md](onboarding.md).

## Purposes and their scopes

Three purposes exist, each with its own write directory, extensions and shell policy. The scope is computed from the stored contract and the staging layout before any budget is reserved. A work root that is not a normalized absolute path (empty, relative, the filesystem root, or not normalized) is refused as `invalid` at that point, so nothing is reserved or started.

| Purpose | Working directory | Writable | Reads | Shell | Skill and agents | Subagents |
|---|---|---|---|---|---|---|
| map | staging | the codebase map directory under the planning directory | staging, the GSD core and agents directories, the allowed skill's real directory | Bash allowed, hook identity rules | the map skill; the mapper agent | contract totals |
| intel | staging | the intel directory under the planning directory | as map | as map, plus three intel-writing GSD verbs | no skill; the intel-updater agent runs directly | none |
| knowledge | the knowledge corpus directory inside staging | the extraction directory inside the corpus | the corpus only | none: Bash denied in settings and by the hook | none | none |

A write directory the contract does not authorize is not writable at all: the write roots list is empty and every write is denied. The write directory is created by AVARICE before launch.

### Generated settings, in effect

The settings carry these effects (names are the host's own):

- Allow: Read under staging (the corpus only for knowledge) and under each read root; Glob; Grep; Skill when a skill is linked; Agent when the subagent total is above zero; Edit under each write root; Bash (blanket) for the production strategy.
- Deny: Read of the user checkout and the data root; Edit of the data root; Read of the other denied roots, except any root that equals or contains staging (a permission deny has no re-allow and would deny every read of staging); Read of each secret glob under staging; WebFetch; WebSearch; NotebookEdit; Edit of the staging config file in the planning directory; Bash outright for knowledge; Bash for each denied command prefix.
- Sandbox filesystem: writes allowed only at the write roots; writes denied for every existing staging entry outside the write set (listed one by one), the staging git directory, the planning config file and the git paths of the staging workspace; reads denied for the user checkout, the data root, the credential directories (`.ssh`, `.aws`, `.config/gh` under home) and the work root; reads re-allowed for the user repository's git paths the workspace names and for the invocation's own staging path only (not the onboarding directory above it, not a sibling whose name shares a prefix).
- Sandbox network: no allowed domain, strict allowlist. The model API traffic is the host's own and sits outside the sandbox; a shell command has no network.
- Hooks: AVARICE's PreToolUse (matcher `.*`, 5 second timeout, block on failure), PostToolUse and PostToolUseFailure (same command, not blocking), ConfigChange (block on failure). GSD's secret read guard is appended as an extra PreToolUse entry (10 second timeout, not blocking) only when the Claude configuration directory has that script; no other user hook is kept.

Why every existing staging entry is listed in the sandbox write denies: the working directory is always writable to a sandboxed shell, and a deny on a path overrides an allow beneath it, so the only way to keep a shell out of the source tree is to deny each existing entry. A file created later at an unlisted location is not prevented; the activation scope check detects it.

Four Bash strategies exist: blanket Bash with hook identity, narrow per-command allow rules, hook-allow (no allow rule; the hook prints an explicit allow) and none (no shell). Production selects blanket for map and intel and none for knowledge; the narrow and hook-allow strategies are supported and tested but no production caller selects them.

## Environment scrubbing

The host's environment is built from nothing; a name is present only when listed. The host and everything it starts inherit it, and the sandbox passes it on unchanged. Present:

- The safe-git variables (see "Git safety").
- `HOME`, `LANG`, `TMPDIR`, `USER`, `LOGNAME` and `CLAUDE_CONFIG_DIR`, each only when the parent has a non-empty value (no default is invented).
- `PATH`: the GSD core `bin` directory first, then `/usr/bin`, `/bin`, `/opt/homebrew/bin`. The builder accepts extra trailing directories, but no caller names any, so graphify is not on the host `PATH`.
- Two switches that keep instruction files and auto memory out.
- A run marker naming the onboarding; a value inherited from the parent is ignored.

Proxy variables, TLS overrides, model-backend keys, cloud and SCM tokens, agent sockets and loader variables are never listed, so none arrives from the parent. The background-task switch is deliberately not set, because the full map starts its mappers in the background. The executor's own commands take their environment from the caller and inherit nothing; the GSD adapter builds it from the same git variables, the same passthrough names and a GSD `PATH`. The exact names are in [config-reference.md](config-reference.md).

## The PreToolUse hook

The hook is a separate process, started once per tool call by the host, outside the sandbox. It reads the invocation's policy file, decides, records, and answers. Any problem ends in exit 2, which the host treats as a block: an unreadable or malformed policy, malformed or oversize (above 1 MiB) input, input with no tool name or a missing required field, a missing ledger file (it never creates one, because an empty database has no budgets), a ledger with no row for the budget being charged, or any thrown error. A deny is not an error: it prints the PreToolUse deny JSON with reason `avarice: {rule}` and exits 0. An allow prints nothing and defers to the host's own permission rules, except under the hook-allow strategy, where an allow is printed for shell commands that pass identity.

The decision and its charge are one step. The pure rules decide first; for an allowed call, one transaction (immediate lock) checks the subagent concurrency limit, charges the budget with a conditional update and appends the `hook.decision` event. A call is therefore never charged without a row and never allowed without a charge, and parallel hook processes cannot overshoot a limit. A denied call charges nothing. Relative tool paths resolve against the `cwd` in the hook input when it is absolute, otherwise against staging. Every path is compared canonically: symlinks and `..` are resolved through the nearest existing parent, and a path that cannot be resolved is denied as `unresolvable-path`. A path is "under" a root when it equals the root or continues with a slash, so a sibling sharing a name prefix is outside.

### Tool decisions

| Tool | Decision | Charges |
|---|---|---|
| Edit, Write, MultiEdit, NotebookEdit | Allow when the target is under a write root (`write-set`); else `outside-write-set`; `unresolvable-path` if it cannot be resolved | toolCalls |
| Read | Read rules below (`read-set` on allow) | toolCalls |
| Grep, Glob | Read rules applied to the search path (the working directory when no path is given); for a Glob whose pattern is absolute, also to the literal directory prefix before the first wildcard | toolCalls |
| Bash | Command identity rules below (`shell-identity` on allow) | toolCalls |
| Agent, Task | Allow when the subagent type is in the policy's list (`subagent-type`); a call with no type counts as `general-purpose`, which no purpose lists; else deny `subagent-type` | subagentsTotal |
| WebFetch, WebSearch | Deny `network-tool` | none |
| Skill, TodoWrite, TaskOutput, BashOutput | Allow (`meta`); the host's rules decide which skill loads | toolCalls |
| Any other tool name | Deny `unknown-tool` | none |

The subagent types a policy lists are the names in the invocation's agents file plus a per-purpose extra list that is empty for every purpose. Subagent tool calls reach the same hook with an agent identifier, which is recorded, and draw on the same run budget.

### Read rules

One ordered rule set confines every read kind: the Read tool, search paths and shell operands.

1. If the policy confines reads (knowledge), a path outside the confinement root is `outside-read-set`, even inside staging.
2. A path under a denied root is `deny-read`, unless it is also under a re-allowed root.
3. A path not under staging, a read root or a re-allowed root is `outside-read-set`.
4. A path below staging that matches a secret glob is `deny-secret-read`. The glob is matched against the path relative to staging; the staging root itself is never matched; read roots and re-allowed roots are not glob-checked.

The denied roots are the user checkout, the data root, the three credential directories and the work root; the invocation's own staging path is re-allowed beneath the work root. The secret globs come from the contract.

### Command identity (Bash)

The hook admits a shell command only when it is a plain pipeline of admitted commands whose every operand passes the read rules. Everything else is denied. The rules, in the order applied:

1. Strategy none denies every call: `shell-disabled`.
2. An empty command or one over 16,384 characters is `shell-syntax`.
3. GSD preamble. When the policy carries a fingerprint (SHA-256 and byte length of the first line of the GSD shim preamble, taken at GSD inspection) and the command starts with bytes that match it, the rest must be empty or start with a newline (otherwise `shell-preamble-trailing`), and each remaining non-blank, non-comment line is judged separately. Without a verified preamble the whole command is one line.
4. Per line, the only admitted special forms are the GSD init file-fallback line (matched exactly, preamble only) and an assignment of the form `NAME=$(gsd_run ...)` holding exactly one GSD segment (preamble only; otherwise `shell-gsd-no-preamble`, or `shell-syntax` when the substitution holds anything else).
5. Lexing. Quoting and a single `|` between segments are the only syntax allowed. Outside quotes these refuse as `shell-syntax`: `;`, `&`, `<`, `>`, backtick, `$`, parentheses, backslash, newline, `||`, an empty pipeline segment, and a word starting with `~` or `#`. Inside double quotes `$`, backtick and backslash refuse; single quotes are literal; an unterminated quote refuses. Redirection, chaining, substitution and backgrounding are therefore all denied by syntax.
6. Per segment, a first word `gsd_run` needs the verified preamble (else `shell-gsd-no-preamble`), a verb from the policy's GSD list (longest match; else `shell-gsd-verb`), no unquoted glob character (`shell-syntax`), and then the argument rules below.
7. Otherwise a segment that starts with a denied prefix is `shell-denied-prefix`. A segment that matches no admitted read-only command is `shell-not-allowed`.
8. An unquoted `*`, `?`, `[` or `{` in an admitted command is `shell-syntax`: the shell would expand it into names the path check never sees.
9. `find` with any denied action is `shell-find-action`. `git` with `--output`, `--ext-diff` or `--textconv` (bare or with `=`) is `shell-git-option`.
10. Every operand and every option value is treated as a path candidate and given the read rules, so a value that is not a path (a search term starting with `/`) is still judged as a path. Option clusters are read per character: letters that take a value consume the rest of the cluster or the next word; a character in a cluster that is not an ASCII letter or digit and not consumed as a value is `shell-option-value`. A word after a bare double hyphen is an operand even when it looks like an option. A lone `-` is standard input and names no path. A short option that takes a value (for example `head -n`, `git log -n`, `git ls-files -x`) consumes its value as a path candidate.

The admitted read-only commands are eleven: `ls`, `cat`, `head`, `tail`, `wc`, `find`, `git ls-files`, `git log`, `git rev-parse`, `git status` and `git show`.

The denied prefixes are sixteen: `git push`, `git commit`, `git -c`, `git config`, `gh`, `claude`, `avarice`, `npm`, `npx`, `pnpm`, `yarn`, `curl`, `wget`, `pip`, `uv pip` and `make`. The host's own deny rules carry the same list.

The denied `find` actions are ten: `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-rm`, `-fprint`, `-fprint0`, `-fprintf` and `-fls`. The shell may run `find` as an implementation where `-rm` is an alias of `-delete`.

`grep` is not admitted, by name or through any wrapper. The shell tool may run it as an embedded or a system binary chosen per call, so the hook cannot model its options. Searching goes through the Grep tool, whose path the read rules judge.

GSD arguments. For a `gsd_run` verb, the words after the verb pass an option allow-list: `--raw` for every verb, and for `graphify query` also `--budget` with a value that does not start with a dash. Any other option, a missing option value, or a value that is itself an option is `shell-gsd-option`; this keeps GSD's own working-directory and project-directory redirection out. Every operand and option value is then read-checked. For `intel patch-meta`, whose operand GSD rewrites, each operand is also write-checked against the write roots.

The admitted GSD verbs are eleven for map: `runtime-identity`, `query init.map-codebase`, `query agent-skills`, `verify codebase-drift`, `state json`, `roadmap analyze`, `graphify status`, `graphify query`, `intel status`, `intel diff` and `intel query`. Intel adds three: `intel patch-meta`, `intel validate` and `intel snapshot`. Verbs that write (`config-set`, `stamp-codebase-map`, `init onboard`) are run by AVARICE outside any invocation and are not on the list: the probe and configuration before launch, the map stamp after the invocation ends and again during resume reconciliation. Knowledge has none.

### Subagent limits

For an allowed Agent call the hook first counts the invocation's subagents in flight from its own events: admissions minus completions that freed a slot. At the concurrency limit the call is denied `budget:subagentsConcurrent`, unless the total is also spent, in which case the charge reports `budget_exhausted` (the more fundamental limit is named). The count is scoped to the invocation, so a killed invocation leaves nothing behind for a later one. A foreground completion frees its slot once; a call started in the background never frees its slot, because its completion event reports the launch, not the end, so it holds the slot until the invocation ends. A subagent call that fails ends in the failure event and frees its slot the same way.

### Events the hook records

- `hook.decision`: level info for allow and warn for deny; carries tool, rule, onboarding and invocation IDs, the agent identifier when present, the charged budget name, and for subagent calls the tool-use ID and a background flag. Never a tool payload.
- `tool.completed` (post events, including failures, which add a failed flag): attributes the completed call. A file write records its staging-relative target (clipped to 256 characters with a digest when longer), or an outside-staging flag, or an unresolved-target flag. A subagent completion records whether it freed a slot.
- `config.change.denied`: written best effort on every ConfigChange, which is refused every time whether or not the event could be written.

Post-hook failures do not block anything: the call has already run, and the settings do not set block on failure for them. A completion that cannot be recorded only leaves a subagent slot held.

## Budgets and reservations

Five budgets live in the ledger, created from the contract when it is stored and surviving kills and resumes: invocations, toolCalls, subagentsTotal, wallClockMs and costUsd. The first four are exact. Cost carries the exactness the contract declares (estimated, because the host reports cost only at the end).

| Budget | Charged by | When |
|---|---|---|
| invocations | The application layer | Reserved before launch; moved to used when the invocation settles |
| toolCalls | The hook | One per allowed tool call, at decision time |
| subagentsTotal | The hook | One per allowed Agent call |
| wallClockMs | The application layer | After the invocation, from its measured duration |
| costUsd | The application layer | After the invocation, from the host's reported cost |

An invocation reservation, and each hook charge for tool calls and subagents, succeeds only when used plus reserved plus the amount stays within the limit. Settlement charges for wall clock and cost are applied unconditionally after the run, so those two totals can pass their limits; the reservation and the cost cap bound the overshoot. The run is shared by every invocation and every subagent, so parallel work draws from one balance.

Reservation. Before anything launches, the application layer grants an invocation only when wall clock, cost and an invocation unit are all left. The wall-clock allowance is the smaller of the purpose's share and what remains. The cost cap is the smaller of the contract's per-invocation cap and what remains of the run budget; it is passed to the host as its budget flag and bounds how far the run total can pass its plan. When any budget is spent the grant is refused with that budget named, nothing is launched or recorded, and the onboarding ends blocked with `budget_exhausted`.

Settlement. Nothing is refunded. An invocation always settles after it ran: one invocation unit, the measured duration, and the cost. A killed or interrupted invocation (a signal, the wall clock, a cancel that may have left the process running) is charged the larger of its reported cost and its full cost reservation, not zero, because a killed host prints no result and an orphaned host keeps working. For a settled outcome the `invocation.finished` event records both figures and the basis; when the host returns an error, the failed `launch:{purpose}` step records the charged amount. A reservation whose holder died without settling is converted to spent on the next reservation attempt, each orphan charged the cost reservation it was granted, and an `invocation.orphan-charged` warning is recorded.

## The sandboxed executor

AVARICE's own subprocesses (the GSD verbs it runs in staging, and the graphify commands) go through a local executor that runs every command as the system sandbox launcher with a generated Seatbelt profile. Production always uses it; only test entry points that already run inside a sandbox replace it. Argument lists are never shell strings, the environment is exactly what the caller gives, and the command leads its own process group.

The profile is built in this order, relying on later rules winning:

1. Start from allow-default; deny all network; deny all file writes.
2. Allow writes to the per-user temp areas (`/private/var/folders`, `/private/tmp`), `/dev/null`, `/dev/dtracehelper` and tty devices.
3. Deny writes below the command's working directory (it may itself lie under a temp area).
4. Allow writes below each declared write path (these win over step 3).
5. Deny reads below each deny-read path.

So the model is: everything is readable except the named paths, only declared paths and temp areas are writable, and the network is denied entirely, loopback included. Every path is resolved to its real location first, and a path containing a double quote, backslash, newline, carriage return or NUL is refused rather than escaped. For GSD verbs, the write path is the staging planning directory, an explicit list the caller names, or empty for a read verb; the read denies are the data root and the three credential directories (not the user checkout or the work root).

When the sandbox cannot be used, the result is `unavailable` and nothing is spawned; there is no unsandboxed fallback. The probe runs once per launcher path per process: a clean exit is cached, while a timeout, signal or spawn error is retried once with a longer timeout and, if still unclean, answers false for that call only. The launcher's own failures (profile did not compile, sandbox could not be applied) surface as `unavailable`. Commands end `passed`, `failed`, `timed_out` or `cancelled` (SIGTERM, then SIGKILL after 5 seconds; stragglers die with the group), or `spawn_error`. Output per stream is cut at the limit with a marker (5 MiB by default). The working directory must be absolute and an existing directory, and the timeout positive, or the call is `invalid`.

## Git safety

Every git subprocess AVARICE starts carries one environment: repository hooks disabled by pointing the hooks path at the null device, fsmonitor off, system config and system attributes not read, optional locks off (read-only calls do not refresh the user's index) and terminal prompts off. Nothing from the caller's environment reaches git except `PATH` (with a default), `HOME` and `LANG`. The contained host inherits the same variables, so GSD's own git calls carry the guard. The host environment does not carry filter blanking; that exists only on AVARICE's own calls.

Refused before git runs: any leading global option (the subcommand must come first, which also rules out `-c`, `-C`, `--git-dir` and `--exec-path`); `--config-env` anywhere; and, for `clone`, any option outside a short allowlist (`--local`, `--no-hardlinks`, `--no-checkout`, `--quiet`, `-q`). The clone check is an allowlist because git accepts abbreviations such as `--conf` for `--config`. Subcommand options such as `switch -c` stay allowed.

Filter neutralization. git runs a clean filter to compare a working-tree file with the same size as its index entry, so `git status` of a repository with a hostile filter would run code. On calls that compare or write working-tree files (status, diff, checkout, worktree add) AVARICE queries the repository's filter drivers with a configuration read, which runs nothing, and blanks the clean, smudge and process commands of every driver for that one call and sets required to false. A failed query yields no overrides and the real command reports its own error. A caller can also ignore the user's and machine's exclude files for one call, so only the repository's own rules decide what is ignored.

## Staging checks after the run

These detect what the sandbox and hook did not prevent; they do not prevent it.

- Staging HEAD. The head is read before and after the host runs. A moved HEAD classifies the invocation `failed`, and the map, intel and knowledge stages each record a `containment.finding`.
- Activation scope check. Immediately before the project record is built, the whole staging diff against the pinned revision (modified, added and deleted names, including ignored untracked files listed one by one) must lie inside the union of the write sets of every purpose that ran plus AVARICE's own. A modified or deleted path must be inside the write set and in a place where a tracked file may change; an added path must be inside the write set and must not be a tracked path outside those places (a deleted-and-recreated file). Any violation appends a `containment.finding` event (check `activation-scope`, a count, and up to a capped number of paths), and the onboarding blocks with reason `enforcement_failure`. The same judgment runs in validation before the index steps; activation repeats it afterwards so a write by an index step or a late invocation cannot reach an active record.

### Repository proposals narrow only

At activation, the repository's proposed paths and commands are checked against the profile policy, and a proposal can only narrow authority. The policy grants read of everything, write of nothing, and protects the AVARICE and CI directories. Protected additions are always accepted. Read entries are accepted when the policy already grants them. Write, generated and artifact entries are accepted only when covered by what the policy grants, which is nothing, so each is rejected as `widens`. Commands are accepted only as `inactive`; any other status is `widens`. An unknown key is `unknown`, the verification-by-change-type key is `unsupported`, and a malformed or oversize value is `invalid`. A glob entry is invalid when empty, over 256 characters, absolute, containing NUL or a backslash, or holding a `..` segment. The command list is capped at 50 entries and each argument list at 64 words of at most 1,024 characters. Proposal input is parsed, never executed or mutated. Every rejection becomes a finding on the record (field, a clipped copy of the value, reason). A proposal file over 64 KiB, unreadable or not valid JSON becomes a single finding and activation continues with nothing accepted. The record shape is in [data-model.md](data-model.md).

## Root placement and local mount

Profile resolution judges the data root and the work root before creating anything, each resolved through its nearest existing ancestor's real path so a symlinked root is judged by where it lands. Rules, reported in this order (data root first, then work root):

1. A root under `~/.claude*` (any first segment below home starting with `.claude`) is refused, because sandboxed runs cannot write there.
2. A root equal to or under the real Claude config directory is refused.
3. A root that would contain the home directory or the Claude config directory is refused.
4. The two roots may not be nested in either direction, and may not be the same directory.

Each refusal is `invalid` for the root's field; the `~/.claude*` and non-local-mount refusals also name the environment variable to change. Then the data root must sit on a mount that the `mount` command reports with the `local` flag (macOS; SQLite WAL is unsafe on network storage). On Linux output, which has no such flag, a mount is local unless its type is a known network type (NFS, CIFS, SMB, AFP, WebDAV, 9p, Ceph, GlusterFS, sshfs and similar). The mount whose mount point is the longest path-boundary prefix of the root decides. If the mount table cannot be read, no mount command exists or no entry contains the path, the result is `unavailable` and the profile is refused (fail closed); a non-local mount is `invalid`. Only after both checks are the directories created (mode 0700) and the config file written (mode 0600, only when absent). The check is a heuristic: a FUSE or synced-folder mount can still report `local`. The work root gets the placement rules but not the local-mount check.

## Secret redaction

The stored transcript is redacted before it is written: secret-shaped strings (private keys, tokens, cloud key IDs, authorization headers, credentials in URLs) are replaced by `[REDACTED:{kind}]`. Secret scanning of map documents and the knowledge corpus is described in [onboarding.md](onboarding.md) and [indexes-and-context.md](indexes-and-context.md).

## Quirks to know

- Preflight trusts the generator for the allow and deny lists and the filesystem lists; it verifies only nine settings keys and the hook entries, plus the hook self-test.
- The hook self-test proves one thing: a Write outside the write roots is denied. It does not exercise read rules, shell rules or budgets.
- A refused launch costs an invocation unit.
- A concurrency denial is not counted as a budget denial in the outcome; only `budget_exhausted` is.
- Read confinement checks the path a tool names, not the Grep pattern or file-type filters. Reads outside confinement through a pattern are stopped only by the sandbox and host deny rules for shell, and by the Read allow rules for file tools.
- The GSD secret read guard, when present, is non-blocking, so a crash in it does not stop a call.
- Shell reads under the sandbox can reach anything not in the sandbox read denies; the hook's allow-list (staging, read roots) is stricter than the sandbox's deny-list, which is why both exist.
- A hook with an unreadable policy blocks every call, including harmless ones.

## What is not covered here

Network access is denied to shell commands and to WebFetch and WebSearch. The model's own API traffic is the host's and is not confined by AVARICE. Whether the host honors each setting is the host's behavior; AVARICE verifies the admitted version and the hook self-test, not each setting's effect. Results of live runs against real host versions are runtime evidence and are not asserted here.
