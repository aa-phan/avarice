# Existing tooling assessment

> Status: the inventory records observed facts; the reuse decisions are proposals.

GSD 1.17.0 already owns the development loop from discussion to PR creation. AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) is therefore a service layer around GSD and does not orchestrate the steps inside it. The gaps GSD leaves fall into two groups. For any run: intake from task references, cited and freshness-tracked context, a run ledger that spans GSD sessions, evidence bound to an exact revision, profile isolation and authorization for privileged actions. For unattended runs: a headless driver, decision routing, budgets, enforced file scope and test-integrity gates. Claude Code supplies the enforcement layers (sandbox, permission modes, hooks), but several fail open by default and must be configured to fail closed. [ADR-002](decisions/ADR-002-gsd-integration-mode.md) and [ADR-006](decisions/ADR-006-unattended-delegation.md) record the integration decisions.

The inventory was taken read-only on 2026-10-29 on the target Mac (macOS 15.5, build 24F74, arm64). Tool behavior is perishable; every claim below is dated by that observation. No credentials, environment values or personal data were read.

## How to read this

| Label | Meaning |
|---|---|
| **Observed** | Read from an installed file or command output on 2026-10-29. Evidence path given. Paths under `gsd-core/` are relative to `~/.claude/gsd-core/`. |
| **Sourced** | Taken from official documentation at the cited URL, retrieved 2026-10-29. |
| **Inferred** | Concluded from observed facts. Treat as a hypothesis until tested. |
| **Unverified** | Not inspected. |

## Environment inventory

### Agent host and configuration

| Item | Version or state | Evidence | Label |
|---|---|---|---|
| Claude Code | 2.1.312 on 2026-10-29; 2.1.316 on 2026-11-01 | `claude --version` | Observed |
| Active config dir | `CLAUDE_CONFIG_DIR=/Users/aphan/.claude-edu`; `agents/`, `hooks/`, `skills/`, `CLAUDE.md` are symlinks into `~/.claude` | `ls -la ~/.claude-edu` | Observed |
| Second config dir | `~/.claude` holds the GSD install and a separate settings file with a different hook set | `ls -la ~/.claude` | Observed |
| Permission mode | `permissions.defaultMode: "auto"` in both settings files; 4 `permissions.allow` rules in `~/.claude-edu/settings.json` | `jq '.permissions.allow\|length'` (values not read) | Observed |
| Managed policy | `policy-limits.json` and `remote-settings.json` (empty object) exist with signature sidecars. No file-based `managed-settings.json` under `/Library/Application Support/ClaudeCode/`. MDM profile not checked. | file listing | Observed; meaning of the two files Inferred |

Two config directories that share hooks and skills but differ in settings are a duplicate-installation risk. `avarice doctor` reports which config directory is active and which hook set applies ([extensions.md](extensions.md#diagnosing-conflicts-and-duplicates)).

### GSD

| Item | Value | Evidence | Label |
|---|---|---|---|
| Version | 1.17.0 | `gsd-core/VERSION`; `gsd-file-manifest.json` (`manifestVersion: 2`, `runtime: "claude"`, `scope: "global"`) | Observed |
| Install profile | `full` | `~/.claude/.gsd-profile` | Observed |
| Owned files | 791 in `gsd-core/`, 72 skills, 41 hooks, 35 agents, 24 scripts, each with a SHA-256 in the manifest | `gsd-file-manifest.json` | Observed |
| Installer migrations | 12 migration modules shipped in `bin/lib/installer-migrations/` (several runtime-specific); 5 applied here, latest `2026-07-28-retire-config-root-commonjs-marker` | `gsd-install-state.json`, directory listing | Observed |
| Runtime | Node CommonJS; `bin/gsd_run` wraps `node gsd-tools.cjs` | `gsd-core/bin/gsd_run` | Observed |
| Supported hosts | claude, opencode, kilo, codex, copilot, antigravity, cursor, windsurf, augment, trae, qwen, hermes, kimi, kimi-code, codebuddy, cline | `bin/shared/runtime-aliases.manifest.json` | Observed |

### Hooks

GSD registers these hooks in `~/.claude-edu/settings.json`. Every script carries the header `gsd-hook-version: 1.17.0`. They fire on AVARICE's own tool calls inside Claude Code as well (Inferred from global registration).

| Event | Hook | Effect |
|---|---|---|
| SessionStart | `gsd-check-update.js`, `gsd-session-state.sh`, `gsd-update-banner.js` | Update check; injects the head of `STATE.md` |
| PreToolUse | `gsd-worktree-path-guard.js` | Blocks absolute paths outside the worktree |
| PreToolUse | `gsd-write-guard.js` | Blocks a whole-file write that shrinks a curated `.planning/` file |
| PreToolUse | `gsd-validate-commit.sh` | Blocks commits not in Conventional Commits form (exit 2) |
| PreToolUse | `gsd-secret-read-guard.js` | Blocks reads of `.env*` and `.secrets` |
| PreToolUse | `gsd-prompt-guard.js`, `gsd-read-guard.js`, `gsd-workflow-guard.js`, `gsd-agent-isolation-guard.js` | Advisory or isolation guards |
| PostToolUse | `gsd-context-monitor.js`, `gsd-read-injection-scanner.js`, `gsd-graphify-update.sh`, `gsd-phase-boundary.sh` | Context warnings, injection scanning, graph rebuild, boundary reminders |
| FileChanged | `gsd-config-reload.js` | Hot-reloads `.planning/config.json` |

The user also runs a personal usage watcher on UserPromptSubmit and StopFailure (`~/bin/claude_usage_watcher.py`). AVARICE does not touch it.

### Plugins, skills and MCP

| Item | State | Evidence | Label |
|---|---|---|---|
| Enabled plugins (active config) | `technical-writer` 1.8.4, `adversarial-mutation-test` 0.35.0, `frontend-design` 1.1.1 | `plugins/installed_plugins.json` | Observed |
| Disabled plugins | `github@claude-plugins-official` (would add an HTTP MCP server at `api.githubcopilot.com/mcp/`), `diagram-design` | `enabledPlugins` | Observed |
| Skills | 101 entries in `~/.claude/skills`: 72 `gsd-*`, about 27 design and UX, `graphify`; 23 switched off through `skillOverrides`, including `gsd-mempalace-*` | directory listing, settings keys | Observed |
| Local MCP servers | None configured at user, local or project scope | `.claude.json`, `settings.json` | Observed |
| claude.ai connectors | Claude Docs and Google Sheets connected; about 17 others need authentication | `.claude.json`, `mcp-needs-auth-cache.json` | Observed |

### Local toolchain

| Tool | Version | Note |
|---|---|---|
| Node | v26.9.0 | `node:sqlite` works without a warning and reports SQLite 3.53.4 |
| git | 2.39.5 (Apple Git-154) | |
| gh | 2.100.0 | Auth state not inspected |
| sqlite3 CLI | 3.43.2 | Older than the WAL-reset fix listed at https://www.sqlite.org/wal.html; AVARICE must not depend on it |
| uv | 0.12.7 | Python 3.12.13 and 3.14.6 via Homebrew; `/usr/bin/python3` is 3.9.6 |
| bun | 1.4.4 | |
| graphify | 0.9.53 | Knowledge-graph CLI, also called by a GSD PostToolUse hook |
| docker | CLI 29.9.2 | Daemon not running; NFR-1 needs no daemon |
| ripgrep | none on PATH | `rg` resolves to a shell function that calls the Claude Code binary. AVARICE uses `git grep` instead. |
| go, rustc, codex, opencode, gemini | not installed | |

## GSD lifecycle ownership

All rows are Observed in GSD 1.17.0 unless marked.

| Lifecycle step | GSD owner | Evidence |
|---|---|---|
| Discussion and requirements | `discuss-phase` workflow, `CONTEXT.md` | `workflows/discuss-phase.md` |
| Planning | `plan-phase` workflow; `gsd-phase-researcher`, `gsd-planner`, `gsd-plan-checker` agents; output `XX-YY-PLAN.md` | `workflows/plan-phase.md:1-7` |
| Task decomposition and dependencies | Plans with waves; `plan-dependency-graph.cjs`; a halted SUMMARY blocks dependants | `references/artifact-types.md:46-52` |
| Execution | `execute-phase` (waves of `gsd-executor` subagents, optional worktrees), `quick`, `fast` | `workflows/execute-phase.md`, `quick.md`, `fast.md` |
| In-plan checkpoints | `checkpoint:human-verify`, `checkpoint:decision`, `checkpoint:human-action`; `blocking-human` never auto-approves | `references/checkpoints.md:5-20` |
| Pause and resume | `pause-work` writes `.planning/HANDOFF.json` (`version: "1.0"`) and `.continue-here.md`; `resume-project` reads them | `workflows/pause-work.md:35-100` |
| Phase status | `NOT_STARTED → PLANNED → IN_PROGRESS → EXECUTED → NEEDS_REVIEW → COMPLETE` | `bin/lib/phase-status.cjs:56-63` |
| Project state writes | `state *` and `phase *` CLI verbs, under `.planning/.lock` | `bin/lib/state-transition.cjs:879-901` |
| Goal verification | `gsd-verifier`; `VERIFICATION.md` status closed to `passed`, `gaps_found`, `human_needed` | `gsd-tools.cjs:5217-5228` |
| Gates | `GateVerdict {outcome, block, payload}`; evidence states `found`, `none`, `unreadable` (unreadable never passes) | `bin/lib/gate-verdict.cjs`, `gate-evidence.cjs` |
| Context resets | Heuristic self-assessment and `gsd-context-monitor.js`; "no programmatic context-percentage API exists" | `references/execute-phase-context-guard.md` |
| Agent delegation | 35 agent definitions (64 files including `.compact.md` variants), model resolved per agent type | `ls gsd-core/agents`, `resolve-model` |
| PR creation | `ship` pushes, runs `gh pr create`, polls `gh pr view`; no merge | `workflows/ship.md:195-525` |
| PR branch hygiene | `pr-branch` filters `.planning/` paths | `workflows/pr-branch.md:1-18` |

### Supported integration surfaces

GSD code marks these surfaces as public. AVARICE depends only on them.

| Surface | Stability statement | Use in AVARICE |
|---|---|---|
| `.planning/state.json`, contract `1.0.0` | "PUBLIC SURFACE", best-effort publisher at 11 boundary commands (`bin/lib/state-contract.cjs:3-8, 83`) | Read on every checkpoint and resume |
| `gsd_run planning inspect`, schema v1 | "frozen EXTERNAL contract" (`bin/lib/planning-inspect.cjs:24`) | Read-only snapshot for evidence |
| Exit-code registry | ADR-3889: 2 HOOK_DENY, 64 USAGE, 66 NO_INPUT, 69 UNAVAILABLE, 70 INTERNAL, 80 DEGRADED (`bin/shared/exit-codes.json`) | Call with `--exit-contract=v2 --json-errors`; v1 exits 0 on payload errors |
| Capabilities (`capability.json`, schema `'1'`) | Validated, consent-gated extension format (`bin/lib/capability-validator.cjs:22`); manifest reference docs are not shipped in the install | Stage 2 integration (slice 5) |
| Loop hook points | 12 names generated in `bin/lib/loop-host-contract.cjs:7` | A subset, listed in the capability manifest sketch in [extensions.md](extensions.md#5-gsd-capability-avarice-bridge-stage-2) |
| Host-integration SDK | "It IS the contract… everything else in gsd-core is internal" (`bin/lib/host-integration-sdk.cjs:4-6`) | Not needed; AVARICE is not a new host |
| Async-job manifest | Status enum labelled a stability contract (`bin/lib/external-job.cjs:22-31`) | Later: remote worker deferral |

These surfaces are present but explicitly incomplete, so AVARICE does not depend on them. The first is the GSD MCP server (`bin/lib/mcp-server.cjs`, "packaging is slice 3b", registered only for OpenCode). The others are the host-mode hook bus (emit throws until bound), the imperative adapter ("deferred"), federated config ("provably-empty no-op channel"), and the `execute:pre` point (declared but no `render-hooks` call was found, Inferred).

### Upgrade behavior relevant to placement

`/gsd-update` clean-installs `commands/gsd/` and `gsd-core/` and replaces `agents/gsd-*` (`workflows/update.md:268-282`). Modified shipped files are backed up and re-applied by a three-way merge. AVARICE therefore places nothing inside GSD trees, uses no `gsd-` prefix for its own skills or capability IDs (the loader rejects `gsd-`, `gsd-core-` and `anthropic-` prefixes), and writes `.planning/` only through `gsd_run` verbs.

## Autonomy and enforcement surfaces

Inspected on 2026-10-29 for unattended runs and containment. GSD rows are Observed in GSD 1.17.0; Claude Code rows are Sourced from https://code.claude.com/docs/en/ (pages named per row) and checked against `claude --help` of 2.1.312 where marked.

### GSD autonomy surfaces

| Surface | Behavior | Evidence |
|---|---|---|
| `mode` (`interactive` default, `yolo`) | Controls only confirmation branches (plan start, transitions, milestone scope); does not affect checkpoints | `bin/lib/config.cjs:842`; `workflows/transition.md` |
| `gates.execute_next_plan`, `gates.confirm_transition`, `gates.confirm_milestone_scope` | Turn individual routine confirmations off (default `true`) | `workflows/execute-plan.md:80`, `transition.md:145` |
| Auto mode (`workflow.auto_advance` or runtime `_auto_chain_active`) | Auto-approves `human-verify`; auto-selects a `checkpoint:decision` only with `auto_select`, else escalates; `human-action` always stops | `bin/lib/check-auto-mode.cjs:21-31`; `references/checkpoints.md:11-23` |
| `gate="blocking-human"` | Never auto-approved in any mode | `references/checkpoints.md:12-23` |
| `/gsd-autonomous` | Runs discuss, plan, execute, review, verify per phase; "pauses only for explicit user decisions"; calls plan and execute without `--auto` | `workflows/autonomous.md:5, 384, 413` |
| `discuss-phase --auto` | Picks the recommended or first option without asking | `workflows/discuss-phase/modes/auto.md` |
| `workflow.text_mode` | Replaces AskUserQuestion with plain-text numbered lists | `workflows/quick.md:50` |
| `state signal-waiting` | Writes `.planning/WAITING.json`; no workflow calls it | `bin/lib/state.cjs:5218-5262`; grep found no callers |
| Verification overrides | `accepted_by` is a free string no code checks; overrides turn FAIL into `PASSED (override)` | `references/verification-overrides.md` |
| Node repair | Budget 2 per task; PRUNE skips a task autonomously | `workflows/node-repair.md:26, 63-90` |
| Declared scope (`files_modified`) | Checked at merge, advisory: "does not block the merge"; undeclared deletions block | `workflows/execute-phase/steps/executor-isolation-dispatch.md:337-373` |
| `agent_tools.*` | Adds tool grants at install time; cannot narrow | `bin/lib/install-profiles.cjs:992-1015` |
| Budgets | None for tokens, cost or tool calls; `workflow.subagent_timeout` 300,000 ms | `bin/shared/config-defaults.manifest.json` |
| Notifications | None built in | grep over `workflows/`, `bin/lib/` |
| Headless mode | None; GSD assumes someone answers prompts | `workflows/`, `commands/gsd/autonomous.md` allowed-tools include AskUserQuestion |

### Claude Code 2.1.312 and 2.1.316

The rows below were read on 2.1.312. On 2.1.316 the headless and restriction flags they cite were re-checked with `claude --help` on 2026-11-01 and are unchanged.

| Surface | Behavior relied on | Source |
|---|---|---|
| Bash sandbox | Seatbelt on macOS, bubblewrap on Linux and WSL 2; children inherit; filesystem `allowWrite`, `denyWrite`, `denyRead`; network `allowedDomains` with `strictAllowlist`; `failIfUnavailable`; `allowUnsandboxedCommands: false` disables the unsandboxed retry | sandboxing |
| Not sandboxed | Read, Edit, Write, WebFetch, WebSearch (permission rules only); hooks, local MCP servers, status line run with full user access | sandboxing |
| Sandbox default on failure | Runs unsandboxed unless `failIfUnavailable: true` | sandboxing |
| Permission rules | Deny, then ask, then allow; Bash rules match command text and "aren't a security boundary around the program"; Read and Edit rules cover recognized Bash file commands only | permissions |
| `dontAsk` mode | Denies anything not pre-allowed, and protected-path writes | permission-modes |
| Protected paths | `.git`, `.claude`, `.vscode`, shell startup files, `.mcp.json`, files passed to `--settings`; root `CLAUDE.md` is not protected | permission-modes |
| Hooks | PreToolUse fires for subagent and MCP tool calls; default fail-open (non-2 exit, crash or timeout lets the call proceed); `onFailure: "block"` opt-in from 2.1.295; default timeout 600 s | hooks |
| ConfigChange hook | Can block user, project and local settings changes, not policy settings | hooks |
| Subagents | Inherit permission rules and sandbox; under a `default` or `dontAsk` parent a subagent can set `acceptEdits` or `auto`; nesting depth 3 and concurrency 20 by default | sub-agents |
| Headless | `-p` with `--settings`, `--permission-mode`, `--permission-prompts none`, `--max-budget-usd`, `--strict-mcp-config`, `--resume`, `--session-id`, `--output-format stream-json`; `--restricted` removes code-running tools and confines file tools; `--bare` skips settings and plugin hooks; no `--max-turns` | `claude --help` (2.1.312) |
| Usage visibility | `total_cost_usd` (client-side estimate) in the final `result`; `permission_denials` in stream-json | headless |
| Scheduling | Session cron and `/loop` stop when the session closes; desktop scheduled tasks need the machine on; cloud routines run remotely with a fresh clone | scheduled-tasks |

Unverified host behaviors that affect containment strength are listed in [containment.md](containment.md#unresolved-host-limitations).

## Reuse and gap matrix

Maintenance cost is an estimate of ongoing effort: Low (rarely touched), Medium (touched on upstream upgrades), High (tracks a moving interface).

| Capability | Existing owner | Evidence | Missing behavior | Proposed extension | Cost | Decision |
|---|---|---|---|---|---|---|
| Planning, decomposition, execution | GSD | lifecycle table | none | none | none | **Reuse** |
| In-plan human checkpoints | GSD `checkpoints.md` | lifecycle table | none | none | none | **Reuse** |
| Goal verification verdict | GSD verifier | `VERIFICATION.md` status | Verdict is model-assessed; not bound to a revision digest | AVARICE records deterministic check evidence beside it; never overrides the verdict | Low | **Extend** (evidence only) |
| PR creation | GSD `ship` | `ship.md:371` | Ambiguous-timeout reconciliation; approval binding | `ship:pre` gate and post-hoc reconciliation by branch | Medium | **Wrap** at `ship:pre` and `ship:post` |
| Session pause and resume | GSD `pause-work`, `resume-project` | `HANDOFF.json` | Nothing spans GSD sessions, external refs, or side effects with unknown outcome | Run ledger with checkpoints that reference GSD state | Medium | **Build** (narrow) |
| Task intake from tracker | none | | Typed references, freshness, manual path | `TaskSource` port; manual adapter only in MVP | Low | **Build** |
| Context retrieval | GSD `map-codebase`, `intel`; graphify 0.9.53 through `/gsd-graphify` | `.planning/codebase/`, `.planning/intel/`, `.planning/graphs/` | Citation, revision and freshness per item; budget; both indexes off by default | Context assembler; index stage in onboarding; `gsd-intel` and `gsd-graph` adapters | Medium | **Wrap** sources and indexes, **build** assembler |
| Commit hygiene | `gsd-validate-commit.sh` | hook table | none | none | none | **Reuse** |
| Secret-read blocking | `gsd-secret-read-guard.js` | hook table | Output redaction before persistence | Redactor in AVARICE's event pipeline | Low | **Reuse** guard, **build** redactor |
| Prompt-injection scanning | `gsd-read-injection-scanner.js`, `untrusted-input-boundary.md` | hook table | Authority separation for retrieved content | Policy engine ignores content-borne instructions by construction | Low | **Reuse** plus **build** |
| Privileged-action approval | Claude Code permissions (`deny`, then `ask`, then `allow`) | https://code.claude.com/docs/en/permissions | Approval bound to run, action and parameters; recorded reference | PreToolUse hook plus approval records | Medium | **Extend** |
| Profile isolation | none | | Separate stores per profile | Profile resolver; per-profile data roots | Low | **Build** |
| Run diagnostics | GSD `health`, `validate health` | CLI | Cross-tool view without the model | `avarice doctor` | Low | **Build** |
| Audit log | GSD `.planning/.gsd-trace.jsonl` (opt-in) | `bin/lib/observability/` | Correlation across runs, evidence and external refs | Event log in the run store | Low | **Build** |
| GSD MCP server | GSD (experimental) | `mcp-server.cjs` | Not packaged for Claude | none | High | **Reject** for now |
| Memory across projects | MemPalace skills (disabled; no binary) | `skillOverrides` | | none | | **Defer** |
| GitHub MCP | `github` plugin (disabled) | plugin cache | | `gh` CLI covers MVP needs | | **Defer** |
| Remote execution | GSD async-job manifest | `external-job.cjs` | Worker identity, authentication | `CommandExecutor` port with remote adapter | High | **Defer** to a later slice |
| Unattended progression | GSD auto mode, `gates.*`, `text_mode`, `/gsd-quick`, `/gsd-autonomous` | autonomy table | No headless mode; prompts need an answerer; `discuss --auto` guesses | Supervisor plus outcome classification and decision routing ([ADR-006](decisions/ADR-006-unattended-delegation.md)) | Medium | **Configure** GSD, **build** supervisor |
| Checkpoint semantics | GSD checkpoint types and `blocking-human` | `checkpoints.md` | none | Used as structural decision signals | Low | **Reuse** |
| Containment of shell and children | Claude Code sandbox | sandboxing docs | Off by default; fails open without `failIfUnavailable` | Generated per-run sandbox settings | Medium | **Configure** |
| Tool-call policy | Claude Code permissions, hooks | permissions, hooks docs | Hooks fail open by default; Bash rules are text matches | Fail-closed AVARICE hook with `onFailure: "block"` plus `dontAsk` | Medium | **Configure** and **extend** |
| Executor file scope | GSD `files_modified` (advisory) | `executor-isolation-dispatch.md:373` | Not enforced | Sandbox, hook and gate G2 | Medium | **Build** |
| Semantic onboarding (codebase map, docs, planning) | GSD `onboard`, `map-codebase`, `scan`, `ingest-docs` | [repository-onboarding.md](repository-onboarding.md#verified-gsd-onboarding-surfaces) | Mapper unrestricted (Bash, Write); `.planning/` fixed to the checkout; no scope or completeness record; `init onboard` can rewrite `config.json`; `new-project --auto` chains into `discuss --auto` | Contained staging worktree, provenance in the project record, `ingest-docs` for planning | Medium | **Reuse** GSD, **wrap** with containment and provenance |
| Map freshness | GSD `stamp-codebase-map`, `verify codebase-drift` | `bin/lib/gate-codebase-drift.cjs` | Committed history only; fast maps never stamped | AVARICE stamps fast maps and chooses refresh mode | Low | **Reuse** |
| Test strength (mutation) | `adversarial-mutation-test` 0.35.0: skill plus Rust `mutation-probe` | plugin cache; [ADR-007](decisions/ADR-007-mutation-gate.md) | Probe needs nix or Cargo, absent here; no diff-scoped mechanical mutant set; skill scoring is model-reported | Reuse the skill for `harden` items; Node probe compatible with `mutants.toml`; mechanical generator | Medium | **Reuse** skill, **build** probe and generator |
| Architecture boundaries | GSD `ARCHITECTURE.md` (prose) | [repository-onboarding.md](repository-onboarding.md#verified-gsd-onboarding-surfaces) | No machine-checkable model; nothing compares boundaries with code | Repository-owned `.avarice/architecture.json`, drafted from the code graph, plus the `architecture-model` check ([ADR-012](decisions/ADR-012-architecture-model.md)) | Medium | **Build** |
| Overview of runs, decisions and budgets | `avarice status`, GSD `/gsd-progress` | [operations-and-testing.md](operations-and-testing.md#observability) | No single overview page | Static, read-only HTML dashboard ([ADR-011](decisions/ADR-011-static-dashboard.md)) | Low | **Build** |
| Test and verification integrity | GSD honest verifier, TDD RED evidence | `honest-verifier.md`, `gate-tdd-red-evidence.cjs` | Overrides unauthenticated; no deleted-test detection; PRUNE silent | Gates G2 and G4 | Medium | **Extend** |
| Budgets | none in GSD; host `--max-budget-usd` | `claude --help` | Tool-call, retrieval, invocation and run budgets | Budget ledger with atomic reservation | Low | **Build** plus **configure** host cap |
| Notifications | none | | Decision delivery, digests | `Notifier` port; local fallback | Low | **Build** |

## Open questions about tooling

These block nothing in the MVP; each has a provisional answer.

1. Which config directory should AVARICE target: `~/.claude-edu` (active) or `~/.claude`? Decided 2026-11-01: the one in `CLAUDE_CONFIG_DIR` (default `~/.claude`), with no directory hard-coded in the MVP, and `doctor` warning when hooks differ.
2. Does the capability manifest format in GSD 1.17.0 match the unshipped reference docs it cites (`docs/reference/capability-manifest.md`)? Provisional: treat the validator source as the contract, pin `engines.gsd` to `>=1.17.0 <1.18.0`, and keep the manual handoff ([ADR-002](decisions/ADR-002-gsd-integration-mode.md)).
3. Should the disabled `github` plugin be enabled? Provisional: no; `gh` is sufficient and keeps one credential path.
