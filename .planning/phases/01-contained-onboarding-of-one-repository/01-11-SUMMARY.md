---
phase: 01-contained-onboarding-of-one-repository
plan: 11
subsystem: containment
tags: [claude-code, sandbox, settings, env, launch-args, preflight, gsd-agents, skills-plugin, sec-5, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-02 spike results (S0-A preamble and Bash semantics, S0-B git paths and denyRead/allowRead, S0-C USER/LOGNAME/PATH, S0-D intel via --agent, S0-E env switches and plugin/agents shapes); 01-05 stage loop and contract; 01-08 clone staging (describe().gitPaths, repoReadAllow); 01-09 GSD_ENV_PASSTHROUGH and the safe-git environment"
provides:
  - "src/domain/invocation-scope.ts: computeInvocationScope, InvocationScope, INVOCATION_PURPOSES, ONBOARDING_BASH_STRATEGY (blanket-bash-hook-identity), READ_ONLY_COMMANDS, FIND_DENIED_ACTIONS, GSD_READ_VERBS (by purpose), DENIED_COMMAND_PREFIXES, WorkspaceShape"
  - "src/adapters/host-claude/settings.ts: renderClaudeSettings, avariceHookCommand, gsdSecretReadGuardHook, canonicalPath"
  - "src/adapters/host-claude/env.ts: buildInvocationEnv (allowlist only)"
  - "src/adapters/host-claude/launch-args.ts: buildLaunchArgs, assertLaunchArgsSafe"
  - "src/adapters/host-claude/launch-preflight.ts: checkLaunchReady, ADMITTED_CLAUDE_VERSIONS (2.1.312, 2.1.316)"
  - "src/adapters/gsd/agent-frontmatter.ts parseAgentFile, agents-json.ts buildAgentsJson (+ PLAIN_NAME), plugin-dir.ts buildPluginDir, PURPOSE_EXTENSIONS, PLUGIN_NAME"
affects: [01-12, 01-15, 01-17, 01-18, 01-19, 01-20]

actuals:
  tokens: 26500
  tasks: 3
  commits: 4
plan_head_before: fc4e228817c5d4b4d212c62e2816f0e3d3257eb4
plan_head_after: 2768a53a2c321a78252b66df04bd26b571ab8381

tech-stack:
  added: []
  patterns:
    - "Scope is computed in the domain from strings only; the host adapter renders it. The same InvocationScope feeds the Claude settings now and the hook policy in 01-12"
    - "denyWrite lists every existing out-of-scope staging entry, every other .planning entry, .planning/config.json and every git path, sorted and de-duplicated, because cwd is always writable (S0-B)"
    - "Every settings path is realpath'd (or resolved through its nearest existing parent) and written with the `//` absolute prefix"
    - "Launch inputs are generated, then judged: buildLaunchArgs is a plain builder, assertLaunchArgsSafe parses flags (not prompt text) and refuses"
    - "Preflight order is settings keys, then the blocking hook and its script, then the sandbox probe, then the host version; the first failure names the reason and nothing later runs"

key-files:
  created:
    - src/domain/invocation-scope.ts
    - src/adapters/host-claude/settings.ts
    - src/adapters/host-claude/env.ts
    - src/adapters/host-claude/launch-args.ts
    - src/adapters/host-claude/launch-preflight.ts
    - src/adapters/gsd/agent-frontmatter.ts
    - src/adapters/gsd/agents-json.ts
    - src/adapters/gsd/plugin-dir.ts
    - test/unit/invocation-scope.test.ts
    - test/unit/claude-settings.test.ts
    - test/unit/launch-args.test.ts
    - test/unit/invocation-env.test.ts
    - test/unit/sec5.test.ts
    - test/unit/agent-frontmatter.test.ts
    - test/containment/failclosed.test.ts
    - .planning/phases/01-contained-onboarding-of-one-repository/01-11-red-evidence-task2.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-11-red-evidence-task3.json
  modified: []

key-decisions:
  - "Bash strategy (Task 1, resolved by the owner before dispatch): blanket-bash-hook-identity. Settings allow plain `Bash`; the AVARICE PreToolUse hook is the command-identity control; the sandbox confines effects. Stored as ONBOARDING_BASH_STRATEGY in invocation-scope.ts and named in the Task 2 commit message"
  - "The strategy lives in invocation-scope.ts and on every scope (scope.commands.strategy), not in ONBOARDING_PRESET: the preset feeds policyRevision, and onboarding-contract.ts is outside this plan's files"
  - "Rules and sandbox lists use the absolute `//` form for the credential directories too (not `~/`), because the scope carries absolute paths"
  - "GSD verbs that write (config-set, stamp-codebase-map, init onboard, query commit) are in no purpose's read-verb list; intel alone gets patch-meta, validate and snapshot"
  - "Agent tool is allowed only when the scope's subagent budget is above zero (so never for intel); Skill is allowed only when skills are named; both come from the data, not from the purpose name"
  - "assertLaunchArgsSafe returns Result<void> with rule `launch_args:{reason}`; checkLaunchReady returns `enforcement_failure:{reason}` with enforcer avarice"
  - "The hook command is rendered in the command-plus-args form with process.execPath; GSD's secret read guard is added as an extra PreToolUse entry only when the file exists in the config directory"

patterns-established:
  - "A contract that does not authorize a purpose's directory yields writeRoots [] (nothing writable), never a default"
  - "Read-only probes run with a minimal environment (PATH, HOME, USER, LOGNAME, LANG, TMPDIR, CLAUDE_CONFIG_DIR), never the parent's"

requirements-completed: []

coverage:
  - id: D1
    description: "Per purpose, the scope allows writes only to .planning/codebase, .planning/intel or .avarice-knowledge, denies every other existing top-level entry, every other .planning entry, .planning/config.json and every git path, and denies reads of the checkout, data root, ~/.ssh, ~/.aws and ~/.config/gh"
    requirement: CON-2
    verification:
      - kind: unit
        ref: "test/unit/invocation-scope.test.ts (21 tests) and test/unit/claude-settings.test.ts#renderClaudeSettings snapshots (map, intel, knowledge)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Generated settings always carry defaultMode dontAsk, disableBypassPermissionsMode disable, sandbox enabled and failIfUnavailable, allowUnsandboxedCommands false, autoAllowBashIfSandboxed false, excludedCommands [], allowedDomains [] and a PreToolUse hook with onFailure block; the Bash rules follow the selected strategy"
    requirement: CON-3
    verification:
      - kind: unit
        ref: "test/unit/claude-settings.test.ts#renderClaudeSettings invariants; #renderClaudeSettings Bash strategies"
        status: pass
    human_judgment: false
  - id: D3
    description: "The launch argv carries every required flag and assertLaunchArgsSafe refuses --bare, --dangerously flags, any permission mode but dontAsk, a missing or non-positive budget, missing settings, setting sources that are not empty, and widening flags"
    requirement: CON-3
    verification:
      - kind: unit
        ref: "test/unit/launch-args.test.ts (16 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The invocation environment is an allowlist: proxies, TLS overrides, model-backend keys and tokens in the parent never reach the child; PATH starts with the gsd-core bin; the S0-E switches are set; background tasks are never disabled; src/ contains no TLS-disabling or proxy construct"
    requirement: SEC-5
    verification:
      - kind: unit
        ref: "test/unit/invocation-env.test.ts (10 tests); test/unit/sec5.test.ts (3 tests, with positive controls)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Launch preflight refuses (no host binary run when an earlier layer fails) for a missing or invalid settings file, a missing required key, a removed or non-blocking hook, an unreadable hook script, a failing sandbox probe, an unavailable or hanging claude, an unreadable version and a version that is not admitted (2.1.400); it passes with everything present"
    requirement: ONB-12
    verification:
      - kind: unit
        ref: "test/containment/failclosed.test.ts (22 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Agent definitions that set permissionMode or hooks never reach the --agents file; the file is 0600 and holds only named agents; the plugin directory holds only the named skills as symlinks to their realpaths and drops stale links"
    requirement: CON-6
    verification:
      - kind: unit
        ref: "test/unit/agent-frontmatter.test.ts (23 tests)"
        status: pass
    human_judgment: false

duration: 15 min
completed: 2026-11-02
---

# Phase 01 Plan 11: Invocation scope, host settings, env, argv and preflight Summary

**Everything a contained invocation is launched with is now generated from the onboarding contract and the Wave 0 findings: a vendor-neutral per-purpose scope, the Claude Code settings (blanket Bash with the hook as the identity control, as the owner chose), an allowlisted environment, a launch argv that refuses bypass forms, a 0600 agents file and a symlinked skills plugin, and a preflight that blocks every launch when settings, hook, sandbox or host version is wrong.**

## Performance

- **Duration:** about 15 min (start time was not captured at execution start; measured from the previous plan's last commit at 16:56 local to this plan's last task commit at 17:11)
- **Completed:** 2026-11-02
- **Tasks:** 3 of 3 (Task 1 checkpoint resolved before dispatch; Tasks 2 and 3 TDD, RED then GREEN each)
- **Files created:** 15 source and test files plus 2 RED evidence records; none modified
- **Tests:** 111 new (467 to 578), `npx tsc -p .` and `node scripts/check-boundaries.ts` green (35 files)

## Accomplishments

- **Scope (domain, pure):** `computeInvocationScope` for `map`, `intel` and `knowledge`: write roots from the contract's own globs (a contract that does not authorize the directory yields none), `denyWrite` of every out-of-scope existing entry plus `.git`, `.planning/config.json` and every git path, `denyRead` of the checkout, data root, `~/.ssh`, `~/.aws`, `~/.config/gh`, `allowRead` from the staging strategy, secret globs, read roots, command lists and subagent limits (intel gets zero, S0-D).
- **Settings:** `renderClaudeSettings` emits the containment.md shape. Rules are realpath'd and `//`-prefixed; Edit is allowed only under the write root; Bash follows the strategy (blanket, narrow per command and verb, or none) and the denied prefixes always deny; `allowedDomains` is `[]` regardless of the scope; PreToolUse (matcher `.*`, timeout 5, `onFailure` block), PostToolUse (timeout 5) and ConfigChange (`onFailure` block) use the command-plus-args form with `--event pre|post|config-change --policy {file}`; GSD's secret read guard is appended when present.
- **Env and argv:** `buildInvocationEnv` starts from the safe-git variables and adds only HOME, LANG, TMPDIR, USER, LOGNAME, CLAUDE_CONFIG_DIR (when set), `PATH` led by the gsd-core bin, `AVARICE_RUN`, and the two S0-E switches. `buildLaunchArgs` builds the minimal launch line; `assertLaunchArgsSafe` parses flags (so a prompt that mentions `--bare` is fine and a prompt that starts with a dash is refused) and refuses bypass, mode, budget, settings and widening flags.
- **Agents and skills:** `parseAgentFile` reads the GSD frontmatter subset (scalars, comma and `- item` lists, block scalars, commented `# hooks:` ignored) and rejects `permissionMode` and `hooks`; `buildAgentsJson` writes a 0600 file by temp-and-rename and writes nothing when any name fails; `buildPluginDir` resolves every skill before creating anything, writes `{"name":"avarice-run-skills","version":"0.0.0"}` and replaces earlier links. `PURPOSE_EXTENSIONS` encodes map, intel (no skill) and knowledge (graphify).
- **Preflight:** `checkLaunchReady` in the fixed order settings keys, hook, sandbox probe, host version. A hanging `claude --version` is killed at the timeout; the passing case and each refusal are tested against fake binaries written at run time.

## Task Commits

1. **Task 1: Bash permission strategy** - no commit; `checkpoint:decision` (blocking-human) resolved by the owner through the orchestrator as `blanket-bash-hook-identity` before this dispatch.
2. **Task 2** (TDD): RED `a957c09` test(01-11) (66 tests, 14 pass on arrival, 52 fail; `RED_EVIDENCE_OK`, record `01-11-red-evidence-task2.json`); GREEN `adb5b06` feat(01-11), commit message names the strategy (66 of 66; full suite 533).
3. **Task 3** (TDD): RED `91ad00b` test(01-11) (`RED_EVIDENCE_OK` for `test/containment/failclosed.test.ts`, 22 tests, 19 fail; record `01-11-red-evidence-task3.json`); GREEN `2768a53` feat(01-11) (45 of 45; full suite 578).

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN in order for both tasks, no REFACTOR commit. RED used stub modules (empty scope, `{}` settings, empty env, empty argv, an ok-always assert, not-implemented parsers and builders, an ok-always preflight), so failures are assertions on planned behaviour; a few settings and env tests failed with a TypeError on the empty stub object, but the target tests named in the records fail on assertions. Tests green on arrival are guards (the SEC-5 scan of `src/` and its positive controls, the contract-does-not-authorize case, purity) or pass vacuously against empty or permissive stubs.

**RED-evidence note for Task 3:** the classifier called the combined TAP of `test/unit/agent-frontmatter.test.ts` plus `test/containment/failclosed.test.ts` malformed (`invalid_record`, "Non-TAP data in report"; I did not find the cause in the TAP text), and I had already committed when I read that verdict. I rewrote the record to the fail-closed file alone (`RED_EVIDENCE_OK`, target "when the sandbox probe exits non-zero") and amended the RED commit, so no GREEN code existed before a valid verdict. The agent-frontmatter RED (23 of 23 failing on assertions) is documented in the record's semantic assessment but not classifier-validated.

Mutation checks, each restored from a copy afterwards, all killed by the tests: Task 2: `failIfUnavailable` false, `allowUnsandboxedCommands` true, domains taken from the scope, bypass flag check off, permission-mode check off, budget `<= 0` to `< 0`, S0-E switches dropped, a proxy variable passed through, other top-level entries not denied, other `.planning` entries not denied, contract authorization ignored, Agent always allowed, `onFailure` not block. Task 3: `permissionMode` and `hooks` refusals removed, agents file mode 0644, name validation off, stale-link removal off, symlink to the unresolved path, non-blocking hook accepted, sandbox probe ignored, version admission off, hook script check off, domain-list key check off, missing hook accepted.

## Decisions Made

See `key-decisions` in the frontmatter. For later plans:

- **01-12 (hook):** the hook entry path `src/hook/pre-tool-use.ts` does not exist yet; `avariceHookCommand(entry)` only names it. Preflight requires `--event pre` and `--event config-change` hooks with `onFailure: "block"` and a readable script, so the 01-12 entry must be what these args point at. `scope.commands` (strategy, readOnly, gsdReadVerbs, deniedPrefixes, `preambleSha256`) and `FIND_DENIED_ACTIONS` are the data for the identity rules.
- **01-15 (host adapter):** call order is `writeInvocationFiles` (settings, agents, plugin from `PURPOSE_EXTENSIONS[purpose]`), `checkLaunchReady`, `buildLaunchArgs`, `assertLaunchArgsSafe`, `buildInvocationEnv` (pass `extraPath` only for knowledge). `--agents` and `--settings` take file paths, as the generated files are.
- **Settings are plain objects:** `renderClaudeSettings` returns data; the caller writes it as JSON with mode 0600.

## Deviations from Plan

### Auto-fixed Issues

None needed fixing during GREEN; all tests passed on the first implementation run.

### Design choices and plan adjustments

- **Strategy recorded outside the preset.** The plan says the choice is "recorded in the onboarding preset"; `ONBOARDING_PRESET` feeds `policyRevision` and `src/domain/onboarding-contract.ts` is not in this plan's files, so the strategy is `ONBOARDING_BASH_STRATEGY` in `invocation-scope.ts` (as the acceptance criteria require) and is carried on every scope.
- **`renderClaudeSettings` signature.** The plan's key link shows `(scope, hook, bashStrategy)` and its action shows `(scope, { hook, gsdHooks, skillsAllowed })`; I followed the action and added `policyFile` to the options. The strategy comes from `scope.commands.strategy`.
- **Absolute `//` form for the credential directories** in permission rules and sandbox lists (the plan's deny list shows `~/.ssh/**`), because the scope holds absolute paths and the form is unambiguous.
- **Scope has extra fields** (`stagingPath`, `repoPath`, `dataRoot`, `denyReadGlobs`) and a locally declared `WorkspaceShape`, so the domain imports no port.
- **[Rule 2 - Missing critical] Secret-glob read denies.** The contract removes `secretGlobs` from the read scope; the settings now emit `Read(//{staging}/{glob})` deny rules for them so a committed `.env` or key in staging cannot be read by the model.
- **`GSD_READ_VERBS` is a record by purpose** and `FIND_DENIED_ACTIONS` is exported, so the hook has one source for both.
- **`--tools` is not in the widening refusals** (the plan does not list it and 01-RESEARCH suggests using it to restrict tools); `--add-dir`, `--allowedTools`, `--allowed-tools` and `--permission-prompt-tool` are.
- **Preflight is stricter than the plan's list:** it also requires `disableBypassPermissionsMode`, `autoAllowBashIfSandboxed` false, `excludedCommands` empty, an empty `allowedDomains`, and the ConfigChange hook; and it takes an optional `timeoutMs` (default 10 s).

**Total deviations:** 0 bug fixes, 1 Rule 2 addition, 7 design or interface choices. **Impact on plan:** none on scope; every acceptance criterion holds (`grep -c "ONBOARDING_BASH_STRATEGY = '"` 1, `failIfUnavailable` 1, `allowUnsandboxedCommands` 1, `permissionMode` 1, `avarice-run-skills` 2, `2.1.316` 1).

## Issues Encountered

- A zsh word-splitting slip made my first mutation-check helper run nothing (unquoted `$T`); it printed empty results rather than failures, which I noticed and reran with the files spelled out.
- No requirement was marked complete: `requirements.ready-ids` reports all eight IDs blocked because later plans (01-12, 01-15, 01-19, 01-20) share them; ONB-3, ONB-4 and ONB-12 were already complete.

## Authentication Gates

None.

## Known Stubs

None in the files this plan created. One seam owned by a later plan: `avariceHookCommand` points at `src/hook/pre-tool-use.ts`, which plan 01-12 creates; until then no caller builds a real settings file (01-15 wires `checkLaunchReady` and the writers).

## Threat Flags

None new. T-01-25 (scope and settings) mitigated by per-purpose snapshots and the `denyWrite` tests; T-01-26 (launch elevation) by `assertLaunchArgsSafe`; T-01-27 (environment) by the allowlist tests and the SEC-5 scan; T-01-28 (agent elevation) by the frontmatter rejection and a no-file-written test; T-01-29 (Bash identity) by the owner-selected strategy, with the hook rules left to 01-12; T-01-30 (preflight) by the fail-closed suite; T-01-SC: no packages installed.

Risks the offline tests cannot settle, for the live T3 suite (01-19):

1. The hook `command` plus `args` form is taken from the hooks documentation; no live run has used it.
2. GSD's `gsd-secret-read-guard.js` documents that Claude Code 2.1.259 and later prompt for any compound `cd DIR && cat file` when any `Read()` deny rule exists (issue #4221), and under `dontAsk` a prompt is a denial. The required `Read()` denies (checkout, data root, credential directories, secret globs) could therefore deny compound Bash commands even with a blanket `Bash` allow. S0-B ran single commands with Read denies and passed; a compound-command check belongs in the live suite.
3. Copying GSD's guard into the generated settings is untested (research A10); it is added without `onFailure: block` so a crash cannot brick a run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-12 can build the hook against `InvocationScope` and `ONBOARDING_BASH_STRATEGY`; 01-15 can generate invocation files and gate launch on `checkLaunchReady` and `assertLaunchArgsSafe`.
- `npm test` (578), `npx tsc -p .` and `node scripts/check-boundaries.ts` (35 files) are green. No model call was made and nothing under `~/.claude*` or the user's profile was touched.

## Self-Check: PASSED

- Created files present on disk: src/domain/invocation-scope.ts, src/adapters/host-claude/{settings,env,launch-args,launch-preflight}.ts, src/adapters/gsd/{agent-frontmatter,agents-json,plugin-dir}.ts, test/unit/{invocation-scope,claude-settings,launch-args,invocation-env,sec5,agent-frontmatter}.test.ts, test/containment/failclosed.test.ts, and the two red-evidence records.
- Commits a957c09, adb5b06, 91ad00b and 2768a53 are ancestors of HEAD; `git rev-list --count fc4e228..HEAD` = 4.
- Plan verification re-run: the seven test files 111 of 111; `node scripts/check-boundaries.ts` ok; `npx tsc -p .` exit 0; `npm test` 578 of 578.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
