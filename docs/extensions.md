# Extensions

> Status: proposal. Nothing described in this document is built yet; present tense describes the proposed design.

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) needs these custom extensions for the MVP. The CLI and library include the supervisor and the Claude Code host adapter. A fail-closed hook set (PreToolUse, PostToolUse, ConfigChange) arrives through each run's generated settings. Run-scoped GSD configuration is set through `gsd_run config-set`. The other MVP entries are the mutation gate, `harden` work items, `avarice onboard` with its GSD adapter and the index context adapters. `avarice dashboard`, the architecture model check, one skill and a local notifier complete them; the [catalog](#extension-catalog) lists each. A thin Claude Code plugin packages the attended pieces later. A GSD capability with blocking gates follows in Stage 2. Everything else reuses GSD, the host and existing tools ([existing-tooling-assessment.md](existing-tooling-assessment.md#reuse-and-gap-matrix)). All shared logic lives in the library; hooks, skills, the plugin and the capability are thin wrappers that call the CLI.

## Placement criteria

| Form | Use it for | Never use it for | AVARICE uses it for |
|---|---|---|---|
| CLI and library | Deterministic behavior usable without a model or UI | Reasoning guidance | All state, policy, verification, context assembly |
| Skill | Reusable reasoning guidance and workflow instructions | Security or correctness guarantees; a model can ignore a skill | Teaching the agent how to read a context pack and the contract summary, and how to phrase a question so the supervisor can route it |
| Hook | Deterministic lifecycle automation and enforcement the host supports | Anything that needs the model's judgment; the only containment for code the agent executes | Fail-closed PreToolUse checks (paths, read-before-edit, budgets, privileged actions, subagent modes); PostToolUse accounting; ConfigChange blocking |
| Sandbox and resource controls | OS-level confinement of executed code; credential and network scoping | Expressing task intent | Per-run Seatbelt or bubblewrap configuration generated from the contract |
| MCP server | Typed tools for hosts that benefit from protocol interoperability | Internal calls between AVARICE modules | Later, only if a non-Claude host needs typed tools |
| Plugin | Packaging for one agent host | Business logic | Bundling skill, hooks and the `bin/` shim for Claude Code |
| GSD capability | Steps and gates inside GSD's loop at supported points | Replacing a GSD step | Stage 2: attach context, record evidence, gate `ship` |
| Adapter | Translating a port to one provider, including capability and failure semantics | Workflow decisions | Manual, local, `gh`, later tracker and NAS adapters |

### Hook coverage and bypass limits

Hooks run only inside the host that registered them. A PreToolUse hook in Claude Code sees Claude Code's tool calls; it does not see commands typed in a separate terminal, run by another agent host, or hidden inside a script the agent executes. Claude Code honors exit code 2 and a `permissionDecision: "deny"` result from PreToolUse; PostToolUse cannot block (https://code.claude.com/docs/en/hooks, retrieved 2026-10-29). A user can remove the hook or set `disableAllHooks`, unless an organization uses managed settings. External enforcement (branch protection, required reviews, CI gates) is therefore the authoritative control for every privileged effect on shared systems; the AVARICE hook catches agent mistakes and injected instructions earlier.

## Extension catalog

Ordered by priority. "MVP" means required for the first usable release.

### 1. `avarice` CLI and library (MVP)

| Field | Value |
|---|---|
| Purpose | All deterministic behavior: runs, context packs, verification, policy, diagnostics |
| Trigger | User commands; called by every other extension |
| Inputs | Profile configuration, repository `.avarice/config.json`, brief files, `gsd_run` output, git state |
| Outputs | Ledger records, artifacts, JSON on `--json`, human text otherwise; exit codes 0 success, 1 domain failure, 2 policy denial, 64 usage, 69 unavailable, 70 internal (aligned with GSD's registry) |
| Dependencies | Node 22.22.3 or newer, git; optional `gsd_run`, `gh` |
| Permissions | User's own files; profile data root; subprocesses it is configured to run |
| Failure behavior | Typed errors per [contracts-and-state.md](contracts-and-state.md#results-and-errors); never reports success for skipped work |
| Tests | Contract, workflow, crash, migration, isolation suites ([operations-and-testing.md](operations-and-testing.md#test-strategy)) |

#### Human-readable output

These rules are the target format for human-readable text from every command and from the interactive shell (entry 2j), which renders through the same functions ([ADR-013](decisions/ADR-013-interactive-shell.md) decision 6); OPS-7 makes the style a requirement. `onboard` and `resume` meet the result-line rule today. `init`, `repo`, `status` and some error lines of the dispatcher in `src/cli/main.ts` depart from the table and do not yet meet OPS-7. The rules bind the text format only; `--json` output is the stable interface for scripts, and its shape never depends on them.

| Element | Rule |
|---|---|
| Result line | The first line on standard output states the outcome: the ID it applies to and the state reached, with the reason where one exists, as `onboard` prints `onboarding <id>: blocked (enforcement_failure)`. Details follow it. |
| Tables | Columns are aligned, a header row names each column, and rows are cut to the terminal width with `…`. IDs, states and paths that are the subject of the row are never cut. |
| States | A state is printed as the ledger's own word (`active`, `blocked`, `ready_for_review`), followed by its reason in parentheses where one exists. Colour, when present, repeats what the word already says. |
| Errors | Errors go to standard error. An error that a command or its usage check reports starts with `avarice <command>: `, and a subcommand may follow the command (`avarice repo add: `). An error raised before a command is chosen, such as an unknown command, starts with `avarice: `. A usage error follows with the usage text; any other error follows with one line naming the command that resolves or inspects the problem, when one exists. |
| Numbers | Money is in USD with two decimals, durations use the largest whole unit (`3 min 10 s`), and times are local with a relative form (`14:02, 3 min ago`). |
| Colour and escapes | Colour and cursor escapes are printed only when standard output is a terminal, `NO_COLOR` is unset and `TERM` is not `dumb`. |

### 2. Run hook set: `avarice hook pre-tool-use | post-tool-use | config-change` (MVP)

| Field | Value |
|---|---|
| Purpose | Enforce the contract on every tool call the host makes, including subagent and MCP calls |
| Trigger | PreToolUse and PostToolUse with matcher `.*`; ConfigChange. Registered in the run's generated settings with `timeout: 5` and `onFailure: "block"` ([containment.md](containment.md#generated-host-settings)) |
| Inputs | Hook JSON on stdin (tool name and input, session ID, `agent_id`, `agent_type`, cwd); the run's compiled contract and budget rows |
| PreToolUse checks | Canonical-path check against contract globs for file tools; read-before-edit and digest precondition; budget reservation (tool calls, subagents); privileged-action classification and approval match; deny `run_in_background` until the containment suite confirms hook coverage for it; deny Agent calls whose agent definition sets `permissionMode` |
| PostToolUse | Records the call, charges reservations, records read digests; never blocks (the host cannot block PostToolUse) |
| ConfigChange | Blocks user, project and local settings changes during a run |
| Outputs | Allow (exit 0), or deny with exit 2 and a reason naming the contract rule |
| Permissions | Reads contract and ledger; writes only budget, read-digest and event rows |
| Failure behavior | Any internal error exits 2. Host-side crash or timeout is blocked by `onFailure: "block"` (the hooks documentation states it requires Claude Code 2.1.295 or later); `doctor` refuses unattended runs on hosts below the required version in [version compatibility](#version-compatibility) |
| Tests | Containment suite ([operations-and-testing.md](operations-and-testing.md#containment-suite)); 60 or more command forms; concurrent reservation race; hook killed mid-call |

The same PreToolUse entry point serves attended sessions when installed in the user's settings, where it enforces privileged-action approvals only. Classification patterns live in code. The hook is one layer: the OS sandbox contains code the agent executes (CON-5).

### 2a. Supervisor and Claude Code host adapter (MVP)

| Field | Value |
|---|---|
| Purpose | Start contained headless invocations, classify outcomes, route GSD pauses, schedule work items ([ADR-006](decisions/ADR-006-unattended-delegation.md)) |
| Trigger | `avarice start`, `resume`, `decide` |
| Inputs | Contract, ledger, stream-json from the host, `state.json`, `WAITING.json`, VERIFICATION and SUMMARY files |
| Outputs | Invocation outcomes, decision records, gate results, notifications |
| Dependencies | Claude Code at the required version in [version compatibility](#version-compatibility); GSD 1.17.x |
| Failure behavior | Refuses to launch when enforcement is not `enforced` (falls back to restricted mode); an unclassifiable ending becomes `inconclusive` and escalates |
| Tests | Baseline unattended workflow with a fake host that replays recorded stream-json for progressed, paused, denied, crashed and budget-exhausted endings |

### 2b. Run-scoped GSD configuration (MVP)

Set in the run's worktree with `gsd_run config-set` before the first invocation: `workflow.text_mode=true`, `gates.execute_next_plan=false`, `gates.confirm_transition=false`, `workflow.windows_enforce=true`, `audit.enabled=true`; `workflow.auto_advance=true` only for `/gsd-autonomous` units. These are configuration of supported keys. The user's main checkout keeps its own configuration.

### 2c. Notifier adapters and digest scheduler (MVP: local; later: push)

`local` (inbox, `status`, macOS notification) ships with the MVP. `ntfy`, `pushover` and `telegram` follow. `avarice schedule install` writes a user-level launchd agent (macOS) or systemd timer (Linux) that runs `avarice digest` at the profile's check-in times; `avarice schedule remove` deletes it.

### 2d. Mutation gate: mechanical mutants and Node probe (MVP)

| Field | Value |
|---|---|
| Purpose | Measure test strength on changed lines with mutants no model chose ([ADR-007](decisions/ADR-007-mutation-gate.md)) |
| Trigger | Gate G4 when the contract's `verification.mutation.enabled` is true; also `avarice mutate` for attended use |
| Inputs | Diff from `baseRevision` to the verified revision; the contract's operators, caps and suite |
| Outputs | `mutants.toml` compatible with the plugin's `mutation-probe`; one `mutation` evidence row with the verdict matrix as an artifact |
| Dependencies | Node only. Uses `mutation-probe` instead when it is installed and admitted by `doctor` |
| Permissions | Runs in a disposable clone inside the check sandbox ([containment.md](containment.md#checks-and-probes-run-sandboxed)) |
| Failure behavior | Red baseline, failed restore or unreadable configuration: no verdicts, G4 blocked. `NO-RUN` is `inconclusive`, never a survivor |
| Tests | Conformance fixtures replaying the documented verdict cases (zero-match target, crashed suite, red baseline, restore failure); operator unit tests; equivalence-decision flow |

### 2e. `harden` work items using the `adversarial-mutation-test` skill (MVP)

| Field | Value |
|---|---|
| Purpose | Kill surviving mutants and look for real bugs on the run's changed code, reusing the installed skill unchanged |
| Trigger | A `harden` work item: added by the `hardening` preset, by the repair path for survivors, or written in the brief |
| Inputs | Surviving mutants, the changed files, the acceptance criteria |
| Outputs | New or strengthened tests; skill-proposed mutants and adversarial findings as `model-review` evidence |
| Dependencies | `adversarial-mutation-test` plugin (0.35.0 tested); the plugin's skills load in contained runs only if unresolved host limitation 7 in [containment.md](containment.md#unresolved-host-limitations) confirms skills survive `--setting-sources ""` |
| Permissions | Derived contract: test paths writable, all other paths read-only; Workflow tool excluded, so the skill uses its narrowed serial scope |
| Failure behavior | Survivors after the repair budget become a `repeated_failure` decision; a non-test change fails G2 |
| Tests | S-24; a scripted item that tries to edit source code to kill a mutant is denied |

### 2f. `avarice onboard` and the `GsdOnboarding` adapter (MVP)

| Field | Value |
|---|---|
| Purpose | Bring an existing repository under AVARICE with GSD as the semantic mapper ([repository-onboarding.md](repository-onboarding.md), [ADR-008](decisions/ADR-008-repository-onboarding.md)) |
| Trigger | `avarice onboard [--profile <p>] [--policy onboarding] [--brief <file>]`; refresh on drift |
| Inputs | Repository root, profile, preflight, optional brief and documents |
| Outputs | Staging worktree, validated GSD artifacts with provenance, the index stage (code graph, intel and the knowledge pass with document nodes), project record with index build commits, optional promotion |
| Dependencies | GSD 1.17.x (`init onboard`, `map-codebase`, `stamp-codebase-map`, `verify codebase-drift`, `ingest-docs`, `intel`, `graphify`); graphify 0.9.53; the contained host adapter (entry 2a) |
| Permissions | Onboarding preset: source read-only; the agent write set and the AVARICE write set from the [onboarding contract](repository-onboarding.md#onboarding-contract); no network; read-only commands |
| Failure behavior | Enforcement failure, incompatible GSD or malformed artifacts: `blocked` or `incompatible`, never unrestricted mapping |
| Tests | Onboarding scenarios S-26 to S-40, S-45, S-46; adapter fixture suite per admitted GSD version |

### 2g. Index context adapters `gsd-intel` and `gsd-graph` (MVP)

| Field | Value |
|---|---|
| Purpose | Answer context queries from GSD's structured indexes before reading whole files or document sections (FR-20): code nodes, document nodes from the knowledge pass, and intel entries (ONB-13, ONB-14) |
| Trigger | Context pack assembly; `avarice context` in attended sessions |
| Inputs | Query terms from the brief and work items; remaining token budget; index freshness from the project record |
| Outputs | `ContextItem`s with a confidence tier per graph edge and a freshness label ([contracts-and-state.md](contracts-and-state.md#contextsource)) |
| Dependencies | GSD 1.17.x `intel` and `graphify` verbs; graphify 0.9.53 for builds only |
| Permissions | Read-only on `.planning/intel/` and `.planning/graphs/`; runs outside the contained invocation |
| Failure behavior | Missing index: the adapter reports `unavailable` and the assembler falls back to `git-files`. Stale index: items marked `stale` and cited paths confirmed |
| Tests | S-41 and S-47 (S-39, S-40, S-45 and S-46 build the indexes and belong to entry 2f); the three-arm AC-8 evaluation in slice 3 |

### 2h. `avarice dashboard` (MVP)

| Field | Value |
|---|---|
| Purpose | One read-only overview page for the profile: runs and states, work items, open decisions, gates and evidence, budgets and spend, onboarding records and index freshness, recent events (FR-26, [ADR-011](decisions/ADR-011-static-dashboard.md)) |
| Trigger | `avarice dashboard`, or `avarice dashboard --watch` to regenerate on ledger changes while the command runs |
| Inputs | The profile's ledger and artifact metadata |
| Outputs | One self-contained HTML file under the profile's data root, mode `0600`, opened in the default browser |
| Dependencies | `observe` module; no server, no listening port, no network, no external assets |
| Permissions | Read-only on the ledger; the page cannot answer decisions or change state |
| Failure behavior | A ledger read failure renders an error page that names the failing query; nothing is written to the ledger |
| Tests | S-56, S-57; render-time test for AC-15; redaction suite on the rendered file |

### 2i. Architecture model and `architecture-model` check (MVP)

| Field | Value |
|---|---|
| Purpose | Hold code to a repository-owned, approved architecture model, as 3dmk's Magi does (FR-25, [ADR-012](decisions/ADR-012-architecture-model.md)) |
| Trigger | `avarice architecture draft` writes a proposal in the onboarding staging worktree; the check runs at G4 when the repository declares it, and new cross-component imports are G2 findings (AUT-17) |
| Inputs | The code graph at the verified revision; `.avarice/architecture.json` |
| Outputs | A draft model for the user to approve; findings for components without code, code outside every component, undeclared cross-component imports and missing contract symbols |
| Dependencies | The code graph from the index stage (entry 2f); the symbol diff from AUT-17 |
| Permissions | Read-only; `.avarice/**` is protected in every contract, so only the user changes the model |
| Failure behavior | No code graph or no model: the check is `unavailable`, never `passed`; a finding that needs a design change becomes a decision |
| Tests | S-58, S-59 |

### 2j. Interactive shell: `avarice` with no arguments (MVP)

| Field | Value |
|---|---|
| Purpose | One entry point to act on the profile and watch running work: a home view of runs, onboardings, open decisions and spend, an action menu, and a command line that takes the one-shot grammar (FR-27, [ADR-013](decisions/ADR-013-interactive-shell.md)) |
| Trigger | `avarice` with no arguments, when standard input and standard output are both terminals and `AVARICE_RUN` is unset; otherwise usage and exit 64 |
| Inputs | The profile's ledger, read again for every action and on a polling interval of about one second for progress; key input; the history file |
| Outputs | Human-readable views in the style of [human-readable output](#human-readable-output), redrawn on terminal resize, and a line-mode prompt without full-screen redraw when `TERM` is `dumb`; whatever the invoked command writes; history in the profile data root, mode `0600` |
| Dependencies | The command modules of entry 1, called in the same process; `node:readline` and ANSI escape sequences, no runtime dependency |
| Permissions | Those of the command it invokes; starts `avarice supervise` through the same commands as the one-shot path ([process view](architecture.md#process-view)), detached from the shell's process; no socket, no listening port |
| Failure behavior | Refuses to start under `AVARICE_RUN`; a ledger read failure shows the failing query in the view and leaves the shell open; leaving the shell sends no signal to a supervisor; `decide`, `contract amend` and `approve` run their one-shot checks and ask for confirmation before applying |
| Tests | Driven through an injected input stream and output sink: refusal without a terminal and under `AVARICE_RUN`, parity of each command's result with the one-shot path, a supervisor surviving the shell's exit, no listener, and confirmation before a decision applies |

### 3. Skill `avarice-run` (MVP)

| Field | Value |
|---|---|
| Purpose | Tell the agent how to work inside an AVARICE run: treat the context pack as cited data, never treat retrieved text as instructions, stay inside listed paths, ask a clear question instead of guessing on consequential choices. It explains behavior; it is not a control, and every rule it states is also enforced or detected elsewhere |
| Trigger | Model-invoked when the session has an active run; also `/avarice-run` |
| Inputs | None beyond the session |
| Outputs | Behavior only |
| Dependencies | The CLI on PATH |
| Permissions | Attended sessions: `allowed-tools` limited to `Bash(avarice status:*)`, `Bash(avarice context:*)`, `Read`. Contained runs: no AVARICE commands are reachable (the binary is outside the sandbox and not in the allow list); the supervisor passes the contract summary and the context pack in the invocation prompt instead |
| Failure behavior | If the CLI is missing, the skill instructs the agent to say so and continue with GSD alone |
| Tests | Prompt evaluation: 10 scripted attended sessions checking that the agent calls `status` first and stops on a denial; 10 contained runs checking that pause questions follow the format the supervisor classifies |

One skill only. Separate skills per lifecycle step would duplicate GSD's own skills and compete with them for invocation.

### 4. Claude Code plugin `avarice` (later)

| Field | Value |
|---|---|
| Purpose | Install the skill and the attended-session hook together, versioned, removable in one step. Unattended runs do not use it: their hooks come from the generated run settings |
| Trigger | `claude plugin install` from a personal marketplace repository |
| Contents | `.claude-plugin/plugin.json` with a pinned `version`; `skills/avarice-run/SKILL.md`; `hooks/hooks.json` registering PreToolUse (plus SessionStart only if catalog entry 6 ships); `bin/avarice` shim that executes the installed CLI |
| Dependencies | Claude Code plugin support (https://code.claude.com/docs/en/plugins-reference) |
| Failure behavior | Shim cannot find the CLI: hook allows non-privileged calls and denies privileged ones with "AVARICE not installed" |
| Tests | Install, disable, uninstall on a scratch config directory; checks that no GSD file changes (manifest hashes unchanged) |

Until the plugin ships, the attended hook and the skill are installed by `avarice install-host --config-dir <dir>`, which writes only to `settings.json` hook entries tagged with an `avarice` marker and to `skills/avarice-run/`.

### 5. GSD capability `avarice-bridge` (Stage 2)

| Field | Value |
|---|---|
| Purpose | Move AVARICE's gates inside GSD's loop so they block GSD transitions directly, and remove the attended hand-offs |
| Trigger | The loop points declared in the manifest sketch below, which is the single list of points and gates |
| Inputs | GSD-provided phase and plan identifiers; AVARICE run ID read from `.avarice/active-run` in the worktree |
| Outputs | Contributions (contract summary, context pack), steps (evidence, PR reference) and blocking gates (G1, G2, approval), at the points in the manifest sketch. A contribution also tells the orchestrator to call `gsd_run state signal-waiting` before asking a question, which gives the supervisor a structured pause signal; the supervisor still classifies endings without it |
| Dependencies | GSD capability schema `'1'`, `engines.gsd` pinned to `>=1.17.0 <1.18.0` |
| Permissions | Disclosed executable surfaces (a command module); installed with explicit consent at project scope |
| Failure behavior | `onError: skip` for steps (GSD continues, AVARICE records the gap); the `ship:pre` gate exits 69 when AVARICE is unavailable, which GSD routes through `onError` (configured `halt`) |
| Tests | GSD integration suite against 1.17.0 in a scratch project; `loop render-hooks` output checked for every point the manifest declares |

Manifest sketch, based on the 1.17.0 validator source (`bin/lib/capability-validator.cjs`). The reference documentation it cites is not shipped, so this is a version-pinned bridge:

```json
{
  "id": "avarice-bridge",
  "role": "feature",
  "title": "Avarice run bridge",
  "description": "Attaches avarice context packs and records verification evidence",
  "tier": "standard",
  "version": "0.1.0",
  "engines": { "gsd": ">=1.17.0 <1.18.0" },
  "commands": [{ "family": "avarice", "module": "bridge.cjs", "router": "route" }],
  "contributions": [
    { "point": "discuss:pre", "ref": { "command": "avarice contract-summary" } },
    { "point": "plan:pre",    "ref": { "command": "avarice context-attach" } }
  ],
  "steps": [
    { "point": "verify:post", "ref": { "command": "avarice evidence" },       "consumes": ["verification"], "onError": "skip" },
    { "point": "ship:post",   "ref": { "command": "avarice pr-recorded" },    "onError": "skip" }
  ],
  "gates": [
    { "point": "plan:post",   "blocking": true, "check": { "query": "avarice gate g1" }, "onError": "halt" },
    { "point": "verify:post", "blocking": true, "check": { "query": "avarice gate g2" }, "onError": "halt" },
    { "point": "ship:pre",    "blocking": true, "check": { "query": "avarice approval-present" }, "onError": "halt" }
  ]
}
```

The validator source read for this sketch defines steps and gates in detail; the exact shape of `contributions` entries is assumed and must be confirmed against the installed GSD before slice 5. GSD documents that gate `check` values are not covered by consent disclosure (`references/loop-hook-dispatch.md:90-102`). The gate runs a command family the same capability declares, so it stays inside the disclosed surface.

### 6. SessionStart hook (later)

Prints a one-line run summary for the current repository. It cannot block and adds an estimated 100 ms (unmeasured) to session start; it ships only if the skill alone fails the evaluation in catalog entry 3.

### 7. `avarice mcp` stdio server (later)

Read-only tools (`status`, `context_pack`, `evidence`) for hosts without Bash-level integration. It is built only when a concrete second host needs it. It wraps the same application services and adds no logic.

### 8. Provider adapters (onboarding)

Tracker, documentation, CI and audit-sink adapters per environment. Each lives in a separate package (`@avarice/adapter-<provider>`), implements a port, publishes a descriptor, and passes the shared contract suite. Employer-specific adapters live in the employer's repository (SEC-7).

### 9. Context addressing in `avarice context` (later)

| Field | Value |
|---|---|
| Purpose | Let a prompt name a target and receive a budgeted, cited excerpt without searching, as 3dmk's `repo://` and `seele://` shorthand does ([reference-system-comparison.md](reference-system-comparison.md#g-3-prompt-addressing)) |
| Trigger | `avarice context repo:<name>`, `avarice context doc:<path>#<anchor>`, or a reference in a brief |
| Inputs | Project records, the index adapters, the remaining budget |
| Outputs | Resolved path, revision and excerpt with a citation; contained runs receive the same references already resolved in the context pack |
| Dependencies | Entry 2g; the `avarice-run` skill (entry 3) teaches the syntax in attended sessions |
| Permissions | Read-only; resolution never crosses profiles |
| Failure behavior | An unknown name returns `not_found` with close matches; it never falls back to a repository-wide search |
| Tests | Resolution suite over fixture records; cross-profile refusal |

### 10. Dependency audit check (later)

| Field | Value |
|---|---|
| Purpose | Check dependency versions already present or changed in a lockfile against an advisory source, as 3dmk's Nexus and OSV checks do ([reference-system-comparison.md](reference-system-comparison.md#g-5-package-boundary-and-vulnerability-checks)) |
| Trigger | A check of type `dependency-audit` in the repository's verification rules, run at gate G4 |
| Inputs | Lockfiles at the verified revision; the declared registry or mirror |
| Outputs | Findings by package, version and advisory ID as evidence; a contract sets which severities fail G4 |
| Dependencies | The repository's own audit tool (`npm audit`, `pip-audit`, `cargo audit`) |
| Permissions | Runs sandboxed like any check; network limited to the declared registry, mirror or advisory endpoint |
| Failure behavior | Unreachable advisory source: evidence `inconclusive`, never `passed` |
| Tests | Fixture lockfile with a known advisory; network-denial case in the containment suite |

### 11. Browser check (later)

| Field | Value |
|---|---|
| Purpose | Verify a web surface in a real browser, as 3dmk's Fetch does ([reference-system-comparison.md](reference-system-comparison.md#g-6-browser-verification)) |
| Trigger | A check of type `browser` for repositories with a web surface |
| Inputs | A start command for a local server, routes, viewport sizes, expected text or selectors |
| Outputs | Screenshots and console logs as artifacts; pass or fail per route as evidence. GSD's `gsd-dom-verifier` can add review, recorded as `model-review` evidence |
| Dependencies | Playwright installed by the repository |
| Permissions | Sandboxed; network limited to localhost; the server process is killed with the check |
| Failure behavior | Server fails to start or a browser is missing: `inconclusive` |
| Tests | Fixture site with a console error; a localhost-only network case in the containment suite |

### 12. Standards context adapter (later)

| Field | Value |
|---|---|
| Purpose | Reuse standards and scaffolds across repositories, as 3dmk's Seele language governance does ([reference-system-comparison.md](reference-system-comparison.md#g-7-standards-and-scaffolds-across-repositories)) |
| Trigger | Context assembly when a contract or project group names standards |
| Inputs | A user-chosen directory of standards and scaffolds, set per profile or per project group (FR-21) |
| Outputs | Cited excerpts of the named standards; scaffold files offered as read-only references |
| Dependencies | `ContextSource` port |
| Permissions | Read-only; a standard can narrow a contract, never widen it; repository conventions in GSD's map stay authoritative for their repository |
| Failure behavior | A missing standard is reported in the pack's omissions; compilation continues |
| Tests | S-44; conflict case where a standard and a repository convention disagree |

### 13. `avarice reconcile --review` (later)

| Field | Value |
|---|---|
| Purpose | Find drift between the codebase map, the knowledge-pass documents and the code, as 3dmk's reconciliation jobs do, without editing anything (FR-23; [comparison](reference-system-comparison.md#g-10-design-to-code-reconciliation)) |
| Trigger | `avarice reconcile <project> --review`, or a slice 3 refresh that reports drift |
| Inputs | The active project record, the code graph, the documents listed in `knowledge.documents` |
| Outputs | A findings report in which every finding cites a file and line, a document section or a graph node; a decision for each document the user must correct |
| Dependencies | GSD's `gsd-doc-verifier` agent, run as one contained invocation; the code graph from the index stage |
| Permissions | Onboarding preset: everything read-only except the report artifact |
| Failure behavior | A verifier crash or an unreadable graph ends the run `inconclusive`; nothing is edited |
| Tests | A fixture repository with a documented endpoint removed from the code; a second run with no changes reports nothing |

### 14. Release hygiene checks (later)

| Field | Value |
|---|---|
| Purpose | Two release rules from 3dmk that any repository can declare ([deep dive](reference-system-deep-dive.md#publishing-and-infrastructure-release)) |
| Trigger | Check types `build-from-tag` and `forward-only-migrations` in the repository's verification rules, run at gate G4 |
| Inputs | `build-from-tag`: the repository's declared release script. `forward-only-migrations`: the migration directory and the base revision |
| Outputs | Evidence. `build-from-tag` fails when the release script reads the working tree instead of a tag archive. `forward-only-migrations` fails when an applied migration file is changed or deleted, or a new one renames or drops a column or table |
| Dependencies | None beyond git; the migration directory and SQL dialect are declared per repository |
| Permissions | Sandboxed like any check; read-only |
| Failure behavior | An undeclared migration directory or release script makes the check `unavailable`, never `passed` |
| Tests | Fixture repositories for each failure case |

### Rejected extensions

| Extension | Reason |
|---|---|
| PostToolUse hook that records evidence from agent-run test commands | PostToolUse cannot block, and the agent chooses what it runs; evidence must come from AVARICE running the declared checks |
| Unattended runs with `discuss --auto`, assumptions `--auto`, or a bot answering prompts with the first option | Turns consequential decisions into guesses (AUT-1) |
| Claude Code `auto` permission mode as the containment for unattended runs | The documentation states it "does not guarantee safety"; containment comes from `dontAsk`, the sandbox and the hook |
| Whole-repository hardening campaigns inside unattended runs | The skill's fan-out through the Workflow tool spends far beyond a run budget and needs fresh clones; campaigns stay attended, using the skill directly |
| Scoring test strength from the skill's own report | The score would be model-reported by the context that chose the mutants (AUT-7) |
| Edit and Write hooks as the only file-scope control | Bash, interpreters and subagents can perform the same mutation; the sandbox is required (CON-2) |
| One skill per lifecycle step | Duplicates GSD skills and splits invocation |
| Wrapper around `/gsd-*` commands | Recursive orchestration (ADR-002) |
| Enabling the GSD MCP server for Claude Code | Experimental in 1.17.0 and exposes raw state writes |

## Version compatibility

| Component | Supported range | Checked by | On mismatch |
|---|---|---|---|
| Node | 22.22.3 or newer (or 24.15.0 or newer) | `doctor`, CLI startup | Refuse to start, print the found version |
| GSD | 1.17.x tested; Stage 1 needs only `state.json` contract `1.x` | `doctor` reads `gsd-core/VERSION` and `state.json` `contract` | Stage 1: warn if minor differs, refuse if contract major differs. Stage 2: capability disabled by `engines.gsd` |
| Claude Code | Admitted for unattended runs: 2.1.312, 2.1.316 and 2.1.317. `--setting-sources`, `--permission-prompts`, `--max-budget-usd` and `--restricted` were checked with `claude --help` on 2.1.312 and 2.1.316 (2026-10-29 and 2026-11-01), and the repository owner admitted 2.1.316 on 2026-11-01. 2.1.317 was admitted on 2026-11-03 after the live T3 containment suite ran on it with 0 containment failures ([LIVE-CASES.md](../test/containment/LIVE-CASES.md)); its `--help` was not re-read. `onFailure: "block"` is documented from 2.1.295. On every admitted version, unattended runs start only after the containment suite has passed on it | `doctor` runs `claude --version` and validates generated settings keys | Unadmitted version: unattended runs refused, restricted mode only |
| Store schema | Equal to the binary's schema version, or older with migrations available | CLI startup | Older: migrate with backup first. Newer: refuse ("written by a newer AVARICE") |
| `gh` | 2.x | adapter descriptor | `ChangeRequests` reports `unavailable` |

### Upgrades and rollback

- AVARICE upgrades: install the new version beside the old one; on first run it takes a `VACUUM INTO` backup and applies migrations. Rollback means reinstalling the previous version and restoring the backup; migrations are forward-only.
- Plugin rollback: reinstall the pinned previous version; the plugin carries no state.
- Capability rollback: `gsd_run capability disable avarice-bridge`, then reinstall the previous version. Runs continue in Stage 1 mode.
- GSD upgrades: AVARICE never runs `/gsd-update`. After the user upgrades, `doctor` re-checks the version and disables Stage 2 if the range no longer matches.

### Host differences

Claude Code is the tested host. GSD supports 16 runtimes, and AVARICE's CLI works under any host that can run shell commands. The hook set, sandbox generation and host adapter are Claude Code specific. `doctor` reports the enforcement level per host as `enforced` (sandbox, `dontAsk` and fail-closed hooks all verified), `restricted` (only restricted mode available) or `none`. Unattended runs start only on `enforced` hosts; other hosts get restricted mode, never instructions alone (CON-4).

### Diagnosing conflicts and duplicates

`avarice doctor --extensions` reports:

- Which Claude config directory is active (`CLAUDE_CONFIG_DIR`) and whether another config directory also registers AVARICE hooks. On the inventoried Mac, `~/.claude-edu` and `~/.claude` share hooks and skills but have different settings.
- Duplicate registrations: the plugin hook and a manual `install-host` entry both present.
- Skills named `avarice-*` from more than one source, using the host precedence (enterprise, personal, project; plugin skills are namespaced).
- Instruction conflicts: `CLAUDE.md` or skill text that mentions `git push` or PR creation without approval, found with a fixed pattern list and reported as a warning only.
- GSD file integrity: hashes of GSD files AVARICE depends on compared with `gsd-file-manifest.json`, to confirm AVARICE changed nothing.
