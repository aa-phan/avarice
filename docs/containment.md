# Containment

> Status: proposal. Nothing described in this document is built yet; present tense describes the proposed design.

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) limits a run's impact radius with four layers that fail independently. An OS sandbox surrounds every shell command, host permission rules and a fail-closed PreToolUse hook check every tool call, scoped credentials and network allowlists guard resource boundaries, and budgets live inside AVARICE's own adapters. Post-run diffs and checks detect what slipped through; they are labeled as detection. Requirements CON-1 to CON-16 and RC-5 are owned by [requirements.md](requirements.md#containment); the run contract that supplies every limit is defined in [contracts-and-state.md](contracts-and-state.md#run-contract).

Host facts in this document were read from the official Claude Code documentation and from `claude --help` of Claude Code 2.1.312 on 2026-10-29, with the flags re-checked on 2.1.316 on 2026-11-01. The live T3 containment suite ran on 2.1.316 (2026-11-02) and 2.1.317 (2026-11-03) with 0 containment failures; 2.1.317 was admitted on that run, without re-reading its `claude --help`. Host behavior is perishable; `avarice doctor` re-checks the version, and the containment suite re-tests each claim on every host upgrade.

## Trust assumptions

| Party | Trusted for | Not trusted for |
|---|---|---|
| The user at an interactive terminal | Authoring and amending contracts, answering decisions | n/a (local controls do not defend against the machine owner) |
| Organization (enterprise profile) | Managed settings, policy files, credential issuance | n/a |
| The agent host process (Claude Code) | Enforcing its documented permissions, sandbox and hooks | Correct behavior on undocumented paths; any path marked unverified below |
| The model, subagents and every process the run starts | Nothing | Following instructions, reporting its own compliance, classifying its own risk |
| Retrieved content and tool output | Nothing | Instructions, authority, policy |
| macOS Seatbelt or Linux bubblewrap | Filesystem and network confinement of sandboxed processes | Processes outside the sandbox (hooks, MCP servers, the host itself) |

An administrator or the machine owner can disable every local control. The enterprise profile relies on managed settings and on external platforms (branch protection, scoped tokens, database roles) for controls that must hold against the user.

## How a run is launched

An unattended run is one or more headless host invocations started by AVARICE. AVARICE generates a per-run settings file from the contract and launches the host with flags that make every unanticipated prompt a denial. The generated file lives in the profile data root, outside every path the run can write.

```text
# Proposal: launch line built by the avarice host adapter (Claude Code 2.1.312, 2.1.316 and 2.1.317)
claude -p "<GSD command for this phase>" \
  --setting-sources "" --settings <data root>/runs/<run>/host-settings.json \
  --plugin-dir <data root>/runs/<run>/plugin --agents <data root>/runs/<run>/agents.json \
  --permission-mode dontAsk --permission-prompts none \
  --strict-mcp-config --mcp-config <data root>/runs/<run>/mcp.json \
  --max-budget-usd <contract cost budget for this invocation> \
  --output-format stream-json --session-id <uuid recorded in the ledger>
```

| Flag | Effect relied on | Source |
|---|---|---|
| `--setting-sources ""` | Loads none of the user, project or local settings files, so a user's broad allow rules (4 in `~/.claude-edu/settings.json`, per the [inventory](existing-tooling-assessment.md#agent-host-and-configuration)) and a repository's `.claude/settings.json` cannot widen the run; managed settings still apply | `claude --help` (2.1.312); empty list accepted on 2.1.316, and it also drops every user skill and agent, including GSD and graphify ([spikes](../spikes/2026-11-01-pre-slice-0/README.md)) |
| `--plugin-dir <run plugin>` | Restores the skills the contract allows (GSD's map skill for the map purpose; none for the intel and knowledge purposes, since the graphify skill is no longer loaded): AVARICE generates a plugin whose `skills/` symlinks each allowed skill directory. Skills appear as `avarice-run-skills:<name>`, and the bare `/gsd-…` name still resolves | Verified 2026-11-01 on 2.1.316 |
| `--agents <file>` | Restores the subagents GSD spawns by bare name (`gsd-planner`, `gsd-executor`, …): AVARICE converts each allowed `~/.claude/agents/<name>.md` to the `--agents` JSON shape. Plugin agents are namespaced and GSD's `Agent(subagent_type: "gsd-executor")` would not find them | Verified 2026-11-01 on 2.1.316 |
| `--settings <file>` | Supplies the run's only non-managed settings layer; Claude Code treats the passed file as a protected path | `claude --help`; https://code.claude.com/docs/en/permission-modes |
| `--permission-mode dontAsk` | Anything not pre-allowed is denied; protected-path writes are denied | https://code.claude.com/docs/en/permission-modes |
| `--permission-prompts none` | Removes AskUserQuestion, denies anything that would prompt, tells the model not to retry | `claude --help`; https://code.claude.com/docs/en/headless |
| `--strict-mcp-config` | Only MCP servers listed by the contract load | `claude --help` |
| `--max-budget-usd` | Host stops the invocation at a client-side cost estimate | `claude --help` (works only with `--print`) |
| `--output-format stream-json` | Per-call events and a final `result` with `total_cost_usd` and `permission_denials` | https://code.claude.com/docs/en/headless |

AVARICE never passes `--bare` (it skips settings and plugin hooks), `bypassPermissions`, `--dangerously-skip-permissions`, or `auto` mode for unattended runs. The host adapter refuses to build a launch line containing them, and the containment suite asserts the refusal.

### Generated host settings

```json
{
  "permissions": {
    "defaultMode": "dontAsk",
    "disableBypassPermissionsMode": "disable",
    "allow": [
      "Read(//<worktree>/**)", "Edit(//<worktree>/src/auth/**)", "Edit(//<worktree>/test/auth/**)",
      "Bash(npm test:*)", "Bash(npm run lint:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git add:*)", "Bash(git commit:*)"
    ],
    "deny": [
      "Edit(//<worktree>/.avarice/**)", "Edit(//<worktree>/.planning/config.json)",
      "Read(~/.ssh/**)", "Read(~/.config/gh/**)", "Read(//<data root>/**)",
      "Bash(git push:*)", "Bash(gh:*)", "Bash(claude:*)", "WebSearch"
    ]
  },
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "autoAllowBashIfSandboxed": false,
    "excludedCommands": [],
    "filesystem": {
      "allowWrite": ["//<worktree>/src/auth", "//<worktree>/test/auth", "//<worktree>/coverage", "//<worktree>/.cache",
                     "//<git dir for this worktree>", "//<data root>/runs/<run>/scratch"],
      "denyWrite": ["//<worktree>/.avarice", "//<worktree>/.git/hooks", "//<worktree>/.planning/config.json"],
      "denyRead": ["~/.ssh", "~/.aws", "~/.config/gh", "//<data root>", "//<work root>", "//<other profile roots>"],
      "allowRead": ["//<worktree>"]
    },
    "network": { "allowedDomains": ["registry.npmjs.org"], "strictAllowlist": true }
  },
  "hooks": {
    "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "avarice hook pre-tool-use --run <run>", "timeout": 5, "onFailure": "block" }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "avarice hook post-tool-use --run <run>", "timeout": 5 }] }],
    "PostToolUseFailure": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "avarice hook post-tool-use --run <run>", "timeout": 5 }] }],
    "ConfigChange": [{ "hooks": [{ "type": "command", "command": "avarice hook config-change --run <run>", "timeout": 5, "onFailure": "block" }] }]
  }
}
```

The settings are generated per invocation from the contract of the work item being run, so a `harden` item gets a narrower file set than an `implement` item. `allowWrite` and the `Edit` allow rules list exactly the directories in the item's `files.write`, `files.create` and `files.artifacts` globs. Seatbelt always lets sandboxed commands write under the invocation's working directory, whatever `allowWrite` says, and a `denyWrite` on the worktree root overrides every `allowWrite` beneath it. AVARICE therefore adds a `denyWrite` entry for every existing worktree entry outside the writable set, so `config/` and its siblings stay read-only to shell commands; a new file or directory created at an unlisted location is caught by the diff gate, not prevented. Worktrees, the data root and run scratch directories never live under a Claude config directory (`~/.claude*`), where every sandboxed write fails. Limits on individual files inside an allowed directory (a protected fixture under `test/auth/`, for example) rely on the hook and the diff gate. Commits need the worktree's git metadata to be writable: the per-worktree git directory, the object store and the run branch ref. That access is listed explicitly, and whether Seatbelt honors it given that Claude Code treats `.git` as a protected path is unresolved item 8 below. The JSON is a proposal. Key names follow https://code.claude.com/docs/en/sandboxing and https://code.claude.com/docs/en/settings as read on 2026-10-29; the containment suite validates them against the installed version before a release. `//` marks an absolute path in permission rules. The data root is the profile directory holding the ledger and budgets ([deployment-and-portability.md](deployment-and-portability.md#local-baseline)). The model API domain is absent from `allowedDomains`, so a nested `claude` started from a sandboxed shell cannot reach a model even if the `Bash(claude:*)` deny rule is evaded. The work root holding every staging copy (`<work root>/<onboarding>/staging`) is denied and the invocation's own staging re-allowed by `allowRead`, so a shell command that evades the hook still cannot read another onboarding; no `Read(...)` permission deny names a root that contains the staging, because a permission deny has no re-allow and would deny every Read of the invocation's own staging. `computeInvocationScope` refuses, with a `TypeError` naming the field, a work root that is not a normalized absolute path below `/`: an empty root or `/` would deny every read, including the GSD and skill read roots, and a relative or non-normalized root would match no canonical path, so the work-root deny would not apply (review WR-01).

Because user settings are not loaded, the generated file also carries the GSD hooks the run should keep: `gsd-validate-commit.sh`, `gsd-secret-read-guard.js`, `gsd-worktree-path-guard.js` and `gsd-write-guard.js`. They are copied by path from the user's settings at compile time and recorded in the contract.

The process environment is rebuilt from an allowlist (`PATH`, `HOME`, `LANG`, `TMPDIR`, toolchain variables the repository declares). The sandbox inherits the environment unchanged, so AVARICE removes tokens and cloud credentials before launch (https://code.claude.com/docs/en/sandboxing).

The scope differs by purpose (`src/domain/invocation-scope.ts`). The map purpose loads GSD's map skill and mapper agent, runs shell commands through the hook's identity rules and writes `.planning/codebase`. The intel purpose runs GSD's intel-updater agent directly and writes `.planning/intel`; the snapshot of those files is taken by AVARICE afterwards, since the hook admits neither a bare `gsd_run` nor a retyped preamble. The knowledge purpose (plan 01-19 decision B) has **no shell at all**: the generated settings carry no `Bash` allow rule and deny `Bash`, the hook policy has command strategy `none` and denies every shell call (`shell-disabled`), no skill is loaded and no subagent type is admitted. Reads are confined to the corpus (`Read` allow rule for `<staging>/.avarice-knowledge/**` only, hook rule `outside-read-set` for anything else, and the GSD and skill directories are not readable) and the one write root is `<staging>/.avarice-knowledge/.extraction`. The prompt carries no repository text, so a hostile document or file name reaches the model only as data read through `Read`.

## Enforcement coverage matrix

Labels: **P** prevention, **D** detection, **R** recovery. Strength: **enforced** (a deterministic control outside the model blocks it on the listed paths), **partial** (some exposed paths are not covered), **detect-only**.

| Restriction | Mechanism | Covered paths | Limitations | Bypass and failure tests |
|---|---|---|---|---|
| Writes only inside contract writable paths | P: sandbox `filesystem.allowWrite` for Bash and all child processes; P: `Edit(...)` allow and deny rules for Edit, Write and NotebookEdit; P: AVARICE PreToolUse hook re-checks canonical paths for file tools; D: post-run diff against contract paths | Edit, Write, NotebookEdit, Bash, interpreters started from Bash (`python -c`, `node -e`), build scripts, subagent tool calls (subagents inherit rules and sandbox per https://code.claude.com/docs/en/sub-agents) | Hooks and local MCP servers run outside the sandbox with full user access. Sandbox `denyWrite` covers individual files for shell commands, but the Edit tool is not sandboxed, so file-level limits for file tools rely on the rules, the hook and the diff. The working directory is always writable to shell commands; existing out-of-scope entries are denied one by one, and new entries at unlisted locations are detected by the diff | Write outside scope through Edit, Write, `sed -i`, `tee`, `>` redirect, `python -c open().write`, `node -e fs.writeFileSync`, a `test` script that writes `~/x`, a symlink inside the worktree pointing out, a subagent; each must be denied. **Strength: enforced outside the worktree and for existing worktree entries; detect-only for new entries at unlisted worktree locations** |
| No reads of secrets, other profiles or the AVARICE store (CON-1) | P: sandbox `filesystem.denyRead` (repository, data root, credential directories, work root) with `allowRead` of the invocation's own staging; P: `Read(...)` allow rules for staging and the read roots under `dontAsk`, and deny rules for secret globs; P: hook allow-list (staging, read roots, re-allowed roots) for Read, Grep, Glob and every shell operand, attached option value and word after `--`, and every word after a `gsd_run` read verb, with the rules `deny-read`, `deny-secret-read`, `outside-read-set` and `shell-option-value`; P: shell `grep` is not an admitted command and is denied `shell-not-allowed` | Read tool, Grep and Glob tools, Bash and children, recognized Bash file commands (operands, attached option values such as `-O<path>` and `--name=PATH`, words after `--`), subagents. Shell `grep` in any spelling or binary (`grep`, `/usr/bin/grep`, a quoted `"grep"`, `egrep`, `fgrep`, `rg`, `ugrep`, `git grep`, and `grep` inside a pipeline) is denied `shell-not-allowed` before any option is parsed, so the verdict does not depend on which binary the contained shell would run (review WR-02; this supersedes the recursion rules of quick task 261104-jnc). Searches go through the Grep tool, whose path the hook judges with the same allow-list | Known bypasses that remain: committed secret-glob files read through git objects (`git show <rev>:<path>`, `git log -p`); files the host Grep tool reaches while recursing inside staging rely on the host applying the secret-glob `Read` deny rules (best effort); the sandbox does not apply the secret globs to a command that evades the hook; MCP servers read with full access. Observed in the Claude Code Bash tool (version recorded in the quick task 261104-l3t SUMMARY): `grep` is a shell function that runs the ugrep embedded in the claude binary, or `/usr/bin/grep` (BSD 2.6.0) when the arguments include ugrep's filter, pager, config or archive options, and `find` is a shell function that runs the embedded bfs. Whether a contained invocation's shell carries the same functions is not established; the hook's verdict on `grep` does not depend on it. Read and Grep tools are not sandboxed and rely on rules plus the hook | `test/unit/hook-decision.test.ts` (every case VERIFICATION.md P-3 reproduced: a sibling onboarding's staging file, `~/.netrc`, `grep -r token ~`, `grep -r PASSWORD .` and `grep -f~/.ssh/id_rsa README.md` denied `shell-not-allowed`, `cat ~/.ssh/id_rsa`, `cat .env`; every shell `grep` form, including the nine `-d`/`--directories` spellings of P-3 and the ugrep-only `-5` and directory-operand forms, denied `shell-not-allowed` under the production policy), `test/integration/hook.test.ts` (the real hook entry), `test/integration/claude-host.test.ts` (the production policy written by the real adapter and the decision on it), `test/unit/claude-settings.test.ts` and `test/unit/invocation-scope.test.ts` (work root denied, own staging re-allowed; no grep-family entry in the read-only commands). **Strength: enforced for paths a tool call or command names, with the listed bypasses** |
| Only contract commands run | P: `permissions.allow` list with `dontAsk` (anything else denied); P: hook classification; containment of effects by the sandbox. A `gsd_run` read verb is admitted only after the fingerprinted GSD preamble. Every word after the verb gets the read check. Any option other than `--raw` (and `--budget` for `graphify query`) is denied `shell-gsd-option`, so GSD's `--cwd`, `--project-dir`, `--ws` and `--pick` cannot redirect it. The operand of `intel patch-meta` must also be inside the write set (review WR-06) | Bash tool | Bash rules match command text; `bash -c`, absolute binary paths and wrappers can evade text rules (https://code.claude.com/docs/en/permissions). The sandbox contains what an evading command can do. The Bash tool's shell functions may substitute the embedded bfs for `find` and the embedded ugrep or BSD grep for `grep` (observed in the host Bash tool, not established for contained invocations); `grep` is not admitted, and `find` is refused bfs's `-rm` along with the other find actions | Evasion forms (`/usr/bin/env git push`, `bash -c "..."`, `git -C . push`); each must be denied by rule or, if it runs, fail on sandbox network or filesystem limits; `find . -rm`, `gsd_run intel query ../../x`, `gsd_run graphify query t --cwd /` (`test/unit/hook-decision.test.ts`). **Strength: partial (command identity), enforced (effects)** |
| Only contract endpoints reachable | P: sandbox `network.allowedDomains` with `strictAllowlist`; P: `WebFetch(domain:...)` rules; P: `--strict-mcp-config` | Bash and children, WebFetch, MCP server set | The proxy checks hostnames only, with no TLS inspection; MCP servers and hooks reach the network directly; the host's own model traffic is outside the sandbox | `curl` to a non-allowed host, DNS-over-HTTPS attempt, WebFetch to a non-allowed domain, an unlisted MCP server. **Strength: enforced for Bash and WebFetch; MCP servers enforced only by which servers load** |
| No privileged external effects (push, PR, tracker write) | P: no credential in the run (env scrubbed, `denyRead` on credential stores, network allowlist excludes SCM APIs); P: deny rules; P: hook | All agent-reachable paths | An allowed MCP server that holds its own credential can act; contracts list MCP tools individually | `git push` with and without rule evasion; `gh api`; HTTPS push by URL. **Strength: enforced** while no credential and no SCM domain is reachable |
| Run cannot change its policy, hooks, settings or budgets | P: generated settings, policy and ledger live in the data root (`denyRead` and outside `allowWrite`); P: `--settings` file is a protected path; P: ConfigChange hook blocks settings changes; P: `.claude/` is a protected directory under `dontAsk` | Every agent-reachable path | ConfigChange cannot block managed policy changes (not needed: the run cannot write them). Root `CLAUDE.md` is not a protected path; the contract's `denyWrite` lists it when instructions files are out of scope | Edit `.claude/settings.json`, write the run settings file, `sqlite3` on the ledger, write `CLAUDE.md`, call `avarice contract amend` from Bash (refused: `avarice` is not in the run's allow list, so `dontAsk` denies it, and the amend command itself refuses without a TTY or when the `AVARICE_RUN` marker is set). **Strength: enforced** |
| Budget limits | P: AVARICE reserves budget before each tool call in the PreToolUse hook and before each invocation; P: `--max-budget-usd` per invocation; D: post-call accounting | All tool calls, all invocations, all subagents (hook fires with `agent_id`) | Model token cost is known only after an invocation ends, so cost is enforced per invocation with a conservative cap, not per token | Exhaust tool-call budget mid-run; parallel subagents racing for the last reservation; restart mid-run. **Strength: enforced for counts, estimated for cost** |
| Retrieval scope and cost | P: AVARICE context adapters enforce filters, caps and budgets | AVARICE context packs and `avarice context` commands | Agent-side Read and Grep inside the worktree are bounded only by tool-call budgets and file-tool scope | Broad search without authorization, oversized response, expensive query, repeated pagination. **Strength: enforced in adapters** |
| Pre-existing user changes survive | P: run executes in a dedicated worktree on a new branch; P: recovery never runs `reset`, `clean` or `checkout --` on the user's checkout; R: worktree removed only when clean or archived | All | A run configured to use the main checkout (not allowed unattended) | Seed uncommitted changes in the main checkout, fail the run, recover; byte-compare. **Strength: enforced** |
| Stale edits rejected | P: hook requires a prior Read of the file in this session and compares the current digest with the digest at that Read | Edit, Write | Bash writes bypass the read-before-edit check; the sandbox still confines where they land | Edit a file changed by another process after the agent read it. **Strength: enforced for file tools, not for Bash** |
| Tests and acceptance criteria not weakened | D and P at the gate: protected test paths need a contract amendment to change; evidence compares test inventory before and after ([contracts-and-state.md](contracts-and-state.md#phase-gates)) | All | A test can be weakened without deletion (assertions loosened); on changed lines the mutation gate measures it when enabled ([ADR-007](decisions/ADR-007-mutation-gate.md)); elsewhere detection relies on test inventory, acceptance mapping and review | Delete a failing test, add `skip`, edit an acceptance criterion in the brief, set `continue-on-error`, loosen an assertion on a changed line. **Strength: enforced for deletion, skip markers and protected files; measured (detection) for assertion weakening on changed lines; detect-only elsewhere** |

## Checks and probes run sandboxed

Required checks, test-inventory listing and the mutation probe execute repository code that the agent may have changed. AVARICE therefore runs them under the same OS sandbox configuration as the contained invocation, never with the user's full access:

- The local `CommandExecutor` wraps every check in a sandbox built from the contract. Writes are limited to the check's working copy and the declared artifact paths. Reads of credential stores, the data root and other profiles are denied, and network is limited to the contract's endpoints. The proposed mechanism is the same sandbox runtime Claude Code builds on (`@anthropic-ai/sandbox-runtime`, per https://code.claude.com/docs/en/sandboxing), driving Seatbelt on macOS and bubblewrap on Linux. Using it from AVARICE directly is unverified and is a slice 1 spike.
- When the sandbox cannot start, the check is not run and its evidence is `unavailable`; gate G4 cannot pass (CON-3).
- The environment is scrubbed exactly as for the invocation.
- The mutation probe works in a disposable clone of the run worktree at the verified revision. It verifies byte-exact restore after each mutant and deletes the clone afterwards. It never mutates the run worktree or the user's checkout.

## Fail-closed behavior

| Failure | Behavior |
|---|---|
| Sandbox cannot start | `failIfUnavailable: true` makes the host refuse to run Bash; the run enters `blocked_on_decision` with reason `enforcement_failure` |
| AVARICE hook crashes, times out or cannot read policy | `onFailure: "block"` (documented from Claude Code 2.1.295) blocks the tool call; the hook's own error path exits 2 |
| Generated settings missing or invalid | The host adapter refuses to launch; no invocation starts |
| Host version not admitted ([version compatibility](extensions.md#version-compatibility)), or a required key unrecognized | `doctor` reports enforcement `restricted`; runs start only in restricted mode |
| Budget ledger unreadable | All reservations fail; tool calls are denied |

Claude Code hooks fail open by default: a non-2 exit or a timeout lets the call proceed (https://code.claude.com/docs/en/hooks). AVARICE therefore depends on `onFailure: "block"` and checks the host version before every launch.

### Restricted mode

When required enforcement is unavailable (an unsupported host, Windows native without a sandbox, an enterprise that forbids the sandbox), AVARICE runs analysis and planning only:

```text
claude -p "<planning prompt>" --restricted --settings <run settings> --permission-mode dontAsk --permission-prompts none
```

`--restricted` removes the code-running tools and WebFetch, ignores user, project and local settings, and confines file tools to the working directories (`claude --help`, 2.1.312 and 2.1.316). File tools are pointed at a disposable copy of the repository. The run can produce a plan, a patch file and a decision list, never a commit in the user's repository. `status` labels such runs `restricted`.

## File-edit safeguards

- **Inspect before editing.** The PreToolUse hook denies Edit or Write on an existing file that the session has not read, and records the digest at read time.
- **Precondition.** At Edit time the hook compares the file's current digest with the recorded one; a mismatch denies the edit with "file changed since read".
- **New files.** Creation is allowed only under contract `create` globs. Deletion (by `rm`, `git rm` or Write of empty content) is allowed only under `delete` globs; elsewhere it is denied by the hook and detected by the diff.
- **Canonical paths.** The hook resolves `realpath` of the target and of every parent before comparing with contract globs; `..` segments and symlinks that resolve outside writable paths are denied.
- **Generated outputs.** The contract declares artifact locations (`dist/`, `coverage/`, a scratch directory). They are writable but excluded from the reviewable diff and from acceptance evidence.
- **Commands that change more than their target.** Formatters, code generators and package managers are allowed only when the contract lists them with the paths they may touch. The post-run diff flags files outside those paths as `unexpected_change`, which blocks the `ready_for_review` gate.
- **Scope expansion.** When a legitimate change needs a path outside scope, the agent cannot write it. The run records a decision of class `scope_expansion` ([autonomy-and-decisions.md](autonomy-and-decisions.md#decision-matrix)) and continues independent work.

## Retrieval and resource safeguards

Context retrieval is progressive and every step has its own cap:

| Step | Default cap (illustrative) | Needs authorization |
|---|---|---|
| Index and metadata (file lists, GSD intel entries, graph nodes and edges, ticket fields) | 2,000 entries, 64 KiB; graph queries pass the remaining budget as `--budget` | No |
| Scoped search (`git grep` in contract read paths) | 200 hits, 10 s | No |
| Bounded snippets | 40 lines each, 30 snippets | No |
| Full file reads | 20 files, 256 KiB total | Per-file reason recorded |
| Broad discovery (whole repository, whole corpus) | 1 per run | Contract flag `broadDiscovery: true` |

Remote retrieval adapters (tracker, documentation, databases) must apply project or tenant filters, field selection and a page size cap. They must also enforce a maximum page count (default 5, never automatic unbounded paging), returned-byte limits, a server-side query timeout and cancellation. Backend cost is bounded separately: database adapters run with a statement timeout and a read-only role, and refuse queries without an indexed filter on the declared scope. A result limit alone does not bound backend work.

Caches store source version, retrieval time, profile and access scope. A cached item is not reused after its source returns `denied` or `unauthenticated`, after the access scope changes, or in another profile (CON-12).

## Budgets and usage visibility

| Budget | Unit | Reservation point | Exactness |
|---|---|---|---|
| Wall-clock time | Seconds per run and per invocation | Invocation start; AVARICE kills the invocation with SIGTERM at the limit (the host exits 143 and kills its Bash tree, per https://code.claude.com/docs/en/headless) | Exact while the machine is awake |
| Tool calls | Count per run | PreToolUse hook reserves 1 before each call | Exact |
| Host invocations | Count per run | Before launch | Exact |
| Model cost | USD per invocation and per run (a killed or interrupted invocation is charged its cost reservation, not 0; see [Repository onboarding](repository-onboarding.md#onboarding-contract)) | `--max-budget-usd` per invocation; run total accumulated from each `result.total_cost_usd` | Client-side estimate reported at the end of an invocation; the run total can exceed the plan by at most one invocation's cap |
| Retrieval | Queries, bytes, pages | AVARICE adapters | Exact for AVARICE adapters |
| Repair attempts | Count per failing check | Gate evaluation | Exact |
| Subagents | Concurrent and total | PreToolUse on the Agent tool: the total is charged, the concurrent limit is checked against the in-flight count the hook keeps (see [Subagents, background work and remote tools](#subagents-background-work-and-remote-tools)) | Exact for count; AVARICE enforces both limits, and the host's own caps (nesting depth 3, concurrency 20 by default) sit above them |
| Artifacts | Bytes | `ArtifactStore.put` | Exact |
| Mutation probe | Mutants, minutes per pass, seconds per mutant | Before each probe pass, from `verification.mutation` | Exact |

Reservations are single atomic statements in the run's ledger ([budget accounting](contracts-and-state.md#budget-accounting)), so parallel subagents and retries draw from one shared balance and survive restarts (CON-13). Neither the agent nor its subagents can raise a limit (RC-5); only `avarice contract amend` from an interactive terminal outside the run can.

## Subagents, background work and remote tools

- **Inheritance.** Subagents inherit the session's permission rules and sandbox. Under a `dontAsk` parent a subagent's frontmatter can request `acceptEdits` or `auto`, so the generated settings deny any agent definition that sets `permissionMode`, and the hook denies Agent calls naming such agents. The run is effectively capped at the parent's authority (CON-15).
- **Budget.** Every subagent tool call passes the same PreToolUse hook with `agent_id`, so it draws from the parent run's balance.
- **Concurrency.** AVARICE's hook enforces the contract's `subagentsConcurrent`, not the host (whose cap of 20 sits far above it). An Agent call is denied with rule `budget:subagentsConcurrent` when the invocation already has that many subagents in flight; when the total is also spent the call is denied as `budget_exhausted` instead. In flight means the Agent calls the hook admitted in this invocation minus the completions it recorded, counted from the invocation's own events inside the same `BEGIN IMMEDIATE` transaction that charges the total and appends the `hook.decision` row, so racing calls admit exactly the limit. A completion arrives as `PostToolUse` (the call returned) or `PostToolUseFailure` (the call failed); both run the hook with `--event post`, the generated settings register both, and the launch preflight refuses a settings file missing either (`enforcement_failure:post-hook-missing`, `enforcement_failure:post-failure-hook-missing`). A completion frees a slot once per `tool_use_id`; a repeat, or an ID the hook never admitted, frees nothing. The count is scoped to the invocation ID, so an invocation that was killed leaves nothing a later invocation would count. A completion that never arrives (the hook crashed, the host did not call it) keeps its slot held for the rest of that invocation, which makes the limit stricter, never looser.
- **Background subagents.** An Agent call with `run_in_background: true` is allowed (the full map starts its four mappers that way) and counts against both limits. Its `PostToolUse` reports that the call was launched, not that the subagent ended, so the hook never frees that slot: a background subagent holds its slot until the invocation ends. With the onboarding preset (4 concurrent, 4 in the full map) the four mappers fit; a fifth subagent while they are held is denied.
- **Background Bash.** Commands run with `run_in_background` are inside the same sandbox as any Bash call, and PreToolUse fires for them with `run_in_background: true` in the tool input (verified on 2.1.316, [spikes](../spikes/2026-11-01-pre-slice-0/README.md)). The containment suite re-tests it on every host upgrade.
- **Remote side effects in progress.** When AVARICE stops an invocation, a request already accepted by a remote service (an MCP tool call, an API write) may still complete. AVARICE records such calls as `sideEffect: unknown` and reconciles them before any retry; it never claims to have stopped them.

## Unresolved host limitations

These must pass in the containment suite before a profile can claim the "enforced" strength for the affected rows. Items 1, 2, 5, 6 and 7 were resolved on Claude Code 2.1.316 by the [pre-slice-0 spikes](../spikes/2026-11-01-pre-slice-0/README.md) on 2026-11-01; the containment suite keeps their tests and re-runs them on every host upgrade.

1. Resolved: PreToolUse fires in `-p` with `dontAsk` for foreground and background Bash, file tools, Agent and subagent calls (with `agent_id`), and `onFailure: "block"` blocks the call when the hook crashes or times out.
2. Resolved: AskUserQuestion is absent from the tool list in `-p` both with and without `--permission-prompts none`; AVARICE still passes the flag.
3. Whether hook input includes token or cost fields (would allow finer budget enforcement).
4. Exact semantics of `allowManagedPermissionRulesOnly` for enterprise profiles.
5. Resolved: on Seatbelt, a `denyWrite` entry for an individual file blocks shell and interpreter writes to that file inside an allowed directory. Found alongside: the working directory is always writable to shell commands (see [generated host settings](#generated-host-settings)).
6. Resolved: with `excludedCommands: []` and `allowUnsandboxedCommands: false`, `dangerouslyDisableSandbox` is ignored, `git` runs sandboxed, and non-allowlisted network fails at the proxy.
7. Resolved with a design change: `--setting-sources ""` is accepted and loads no user, project or local settings, but it also drops every user skill and agent. The launch line adds a generated `--plugin-dir` for skills and a generated `--agents` file for GSD's subagents (see the flag table). The earlier fallback, `--setting-sources project`, loads no user skills either and is withdrawn.
8. Whether git commits from inside the sandbox succeed with `allowWrite` limited to the worktree's git directory, object store and run branch ref, given that `.git` is a Claude Code protected path. If they do not, the fallback is that the agent stages changes and the supervisor commits outside the invocation after gate G2.
