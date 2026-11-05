# Findings

This note lists suspected defects and code-versus-specification contradictions found while grounding the `docs/system/` tree against the code. It is working material for the owner: each line names `file:line` and the observation, nothing is triaged, and nothing was fixed. Where the intent is undecidable from the code, the line says so and the owner classifies it.

A line marked "spec contradiction" means a proposal-era document in `docs/` states something the code does not do. The proposal stands as written; the line records the difference.

## From cli-reference

- `src/cli/main.ts:35`: `avarice` with no command exits 64 with usage; docs/extensions.md:174 says no arguments opens an interactive shell on a terminal (spec not implemented)
- `src/cli/commands/onboard.ts:12`: exit code 3 is used throughout (also repo.ts:12, resume.ts:10, context.ts:11); docs/extensions.md:35 lists 0, 1, 2, 64, 69, 70 and no 3 (spec contradiction)
- `src/cli/commands/init.ts:15`: user-facing error string carries delivery narrative ("only personal-local in Phase 1")
- `src/cli/commands/onboard.ts:30`: onboard and resume (resume.ts:19) validate arguments after profile creation, unlike init/repo/context; a usage error can leave a created profile (intent unknown)
- `src/cli/commands/onboard.ts:1`: onboard declares no boolean flags, so `--json` or any bare flag swallows the next word (intent unknown)
- `src/cli/args.ts:36`: unknown flags are accepted silently on every command; a typo in an optional flag is ignored (intent unknown)
- `src/app/stages/register.ts:42`: continuing a `discovered` onboarding from `repo add` silently drops the later `onboard`'s mode and budget overrides
- `src/app/stages/contract.ts:63`: a bad budget name or a raise from `onboard --budget` surfaces as blocked/decision exit 3 after registration, not as usage error 64
- `src/app/onboarding-service.ts:145`: no stage handles `planning`, yet status.ts:50 marks it interrupted and resumable; nothing transitions into `planning`; resume would exit 3 with no progress
- `src/cli/commands/status.ts:1`: status has no usage check; extra positionals are ignored (intent unknown)
- `src/cli/main.ts:1`: code comments cite threat IDs, phases and plan numbers (delivery narrative in comments; not a runtime defect)

## From config-reference

- `src/adapters/host-claude/env.ts:15`: comment says AVARICE_RUN marks a contained run for commands and the hook, but nothing in src or bin reads it; only tests check it
- `src/adapters/fs/profile-paths.ts:90`: profile config.json (schema, profile, dataRoot, workRoot) is written once and never read; it can go stale against the roots in use
- `src/adapters/fs/profile-paths.ts:62`: the profile config file is created by every command that resolves the profile, while init.ts:2 describes it as the init path
- `src/app/onboarding-service.ts:32`: AVARICE_FAULT SIGKILL injection is read on the production path with no build-time gate
- `src/app/onboarding-service.ts:43`: an invalid AVARICE_LEASE_TTL_MS silently falls back to the default
- `package.json:7`: engines node >=22.22.3 is not enforced at runtime; only the SQLite gate (src/adapters/sqlite/db.ts:97) acts
- `src/adapters/gsd/locate.ts:16`: the admitted GSD version regex is duplicated in gsd-onboarding.ts:42 beside GSD_ADMITTED_RANGE in src/ports/gsd-onboarding.ts:11 (three places to change)
- `src/domain/policy-narrowing.ts:22`: the profile policy grants no write paths, so every paths.write/generated/artifacts proposal is refused; the keys are accepted by the schema but can never take effect (intent unknown)

## From indexes-and-context

- `src/app/stages/index-intel.ts:66`: `budget_exhausted` is the only absent reason with an underscore (also index-intel.ts:90, index-knowledge.ts:160); all others are hyphenated (intent unknown)
- `src/adapters/context/gsd-intel.ts:84`: intel handles never set `untrusted`, so model-written intel excerpts print unfenced while non-code graph nodes are fenced (gsd-graph.ts:120) (intent unknown)
- `src/cli/commands/context.ts:64`: `--json` output skips the control-character stripping and fencing of the text form; consumers must honor the per-item `untrusted` flag
- `src/app/invocation.ts:32`: comment says the knowledge pass lowers the subagent total (one per 20 documents), but index-knowledge.ts:160 passes none and the contract knowledge allowance is 0 (onboarding-contract.ts:171): stale comment or dead option
- `src/domain/knowledge-validation.ts:101`: only edges touching a document-typed pass node must be INFERRED or AMBIGUOUS; an EXTRACTED edge between a pass concept or code node and a code node passes (docs/repository-onboarding.md:135 speaks of "document edges")
- `src/app/stages/index-knowledge.ts:200`: documentsExpected counts manifest entries only; documents dropped at selection or copy are in neither documentsExpected nor dropped.unread, so the record understates what the repository held
- `src/app/stages/index-code-graph.ts:62`: docs/repository-onboarding.md:34 names `graphify update .` for the graph build; code uses `graphify extract --code-only` and never `update` (spec contradiction)

## From onboarding

- `src/domain/onboarding-contract.ts:394`: preflight.excludedDirectories is read by the compiler but nothing in src produces it (intent unknown)
- `src/domain/onboarding-contract.ts:128`: files.delete is always empty; docs/repository-onboarding.md:151 says delete includes `.planning/codebase/**` when the existing-map answer is Refresh (spec contradiction)
- `src/domain/preflight.ts:50`: spec adopts a complete stamped map with drift pass (docs/repository-onboarding.md:272) and classifies via `verify codebase-drift` (line 285); code regenerates every class and classifies from git history (spec contradiction)
- `src/domain/mapping.ts:56`: mapping modes `adopt` and `paths` block with scope_unavailable (src/app/stages/workspace.ts), contradicting the decision table in docs/repository-onboarding.md
- `src/domain/onboarding-lifecycle.ts:13`: states `planning`, `stale`, `deactivated` have edges but no code enters them; edges out of blocked, incompatible and deactivated are never driven
- `src/app/stages/map.ts:107`: the `paused` outcome branch is dead: the outcome classifier (src/domain/outcome.ts) never returns `paused`
- `src/app/stages/contract.ts:58`: the compile-refusal block for promotion is unreachable from normal start paths because preflight (src/domain/preflight.ts:101) refuses first
- `src/domain/project-record.ts:198`: completeness comes from the mode alone (no file evidence passed), so an adopted map would be labeled by mode (unreachable while adopt is blocked)
- `src/app/stages/activate.ts:209`: the record version increments from a previous active record, but preflight refuses a project with an active record, so versions above 1 cannot occur

## From data-model

- `src/cli/composition.ts:145`: a read-only command migrates (with a VACUUM INTO backup) when migrations are pending, so it can write (intent unknown)
- `src/adapters/sqlite/events.ts:63`: the row hash omits level, attempt_id and invocation_id, and no code verifies prev_hash or row_hash: the chain is write-only
- `src/adapters/sqlite/ledger.ts:170`: the blocked reason is recovered by scanning events with json_extract; the schema has no index, so cost grows with the log
- `src/adapters/sqlite/ledger.ts:503`: supersession sets superseded_at only; superseded records keep state 'active' (intent unknown)
- `src/adapters/sqlite/ledger.ts:409`: the carrier `runs` row is inserted with state 'onboarding' and never updated; its lease columns are unused
- `src/adapters/sqlite/ledger.ts:437`: the step recorder upserts on (onboarding, step, attempt), overwriting the prior row's status and result
- `src/adapters/sqlite/ledger.ts:635`: the artifact index row is INSERT OR IGNORE in a separate transaction from the blob put; first kind and run per digest wins, and a crash between leaves a blob with no row
- `src/adapters/sqlite/migrations/0001-initial.ts:5`: header says the schema is copied verbatim from docs/contracts-and-state.md, but it adds projects, onboarding_steps and the immutability triggers; six spec tables have no writer
- `docs/contracts-and-state.md:832`: the spec retention table (for example 30 days after run close) has no implementation; retention is the constant label 'onboarding' and nothing deletes (spec contradiction)
- `src/adapters/sqlite/migrations/0001-initial.ts:23`: checkpoints.item_id and gsd_state_digest have no writer

## From integrations

- `src/cli/composition.ts:23`: `findGraphifyBinary` is imported but unused in this file
- `src/adapters/host-claude/env.ts:19`: the `extraPath` option (graphify directory for the knowledge pass) is never passed by any caller, so the knowledge pass runs without graphify on PATH (dormant; intent unknown)
- `src/adapters/gsd/locate.ts:60`: gsd-core discovery runs `gsd-tools.cjs runtime-identity` with spawnSync, unsandboxed, on every non-read-only command, while every other gsd-tools verb is sandboxed (intent unknown)
- `src/adapters/graph/graphify.ts:131`: the graphify version is recorded but never compared with 0.9.x; the descriptor hard-codes '0.9'
- `src/adapters/host-claude/launch-preflight.ts:122`: the version and sandbox probes use a fixed PATH; a `claude` launcher that needs an interpreter elsewhere (a version-managed node) would read as host-unavailable (not verified)
- `src/adapters/host-claude/claude-host.ts:372`: reaping matches `pgrep -f -- "--session-id <uuid>"` against every process on the machine, not only AVARICE-started hosts
- `src/adapters/host-claude/claude-host.ts:333`: transcript redaction runs after the 20 MiB cap, so a secret split by the truncation boundary is not matched (not verified)
- `src/adapters/host-claude/launch-preflight.ts:1`: the startup descriptor is cached once per adapter while launches re-probe, so the descriptor can read `enforced` while a later launch is refused (for example after a claude upgrade within one process)
- `docs/existing-tooling-assessment.md:76`: proposes `gh pr create` and "gh CLI covers MVP needs"; code never invokes gh and denies it to the host (spec contradiction)
- `docs/existing-tooling-assessment.md:24`: records Claude Code 2.1.312 and 2.1.316 only; code also admits 2.1.317

## From containment

- `docs/containment.md:29`: spec places per-run files at `<data root>/runs/<run>/`; code writes `onboard/{onb}/{purpose}-{inv}/` (src/adapters/host-claude/claude-host.ts:152)
- `docs/containment.md:28`: spec launch line omits `--verbose` and the optional `--agent`; code emits both (src/adapters/host-claude/launch-args.ts:36)
- `docs/containment.md:60`: spec allows `npm test`, `git add`, `git commit` and a worktree-scoped Edit; code allows Read, Edit on one write root, Glob, Grep and blanket Bash gated by the hook, and denies `git commit` and `npm` (src/adapters/host-claude/settings.ts:84)
- `docs/containment.md:81`: spec network allows registry.npmjs.org; code lists no domain and preflight refuses a non-empty list (src/adapters/host-claude/launch-preflight.ts:58)
- `docs/containment.md:84`: spec hook command is `avarice hook pre-tool-use --run <run>`; code runs node with the hook entry, `--event` and `--policy` (src/adapters/host-claude/settings.ts:157)
- `docs/containment.md:94`: spec carries four GSD hooks; code carries only the GSD secret read guard, when present (src/adapters/host-claude/settings.ts:165)
- `docs/containment.md:96`: spec env allowlist includes repository-declared toolchain variables; code has fixed names only (src/adapters/host-claude/env.ts:26)
- `docs/containment.md:122`: spec executor is @anthropic-ai/sandbox-runtime with contract network endpoints and invocation env; code uses /usr/bin/sandbox-exec, all network denied, caller env (src/adapters/exec/seatbelt-profile.ts:44)
- `docs/containment.md:134`: spec says an unadmitted host version gives restricted mode via doctor; code refuses the launch (src/adapters/host-claude/launch-preflight.ts:136); no restricted mode or `--restricted` flag exists
- `docs/containment.md:151`: spec file-edit safeguards (read-before-edit digest, unexpected_change, create and delete globs) are not implemented; the write decision is path-in-write-root only (src/domain/hook-decision.ts:526)
- `docs/containment.md:193`: spec denies agent definitions with permissionMode in settings and the hook; code refuses to build the agents file instead (src/adapters/gsd/agent-frontmatter.ts:20)
- `src/adapters/host-claude/launch-preflight.ts:233`: preflight does not validate the allow and deny lists or the sandbox filesystem lists, only nine keys and hook entries (intent unknown)
- `src/app/stages/map.ts:62`: only the map stage turns an `enforcement_failure` denial into a blocked onboarding; intel and knowledge (index-intel.ts:64, index-knowledge.ts:158) not checked for the same handling
- `src/adapters/sqlite/ledger.ts:620`: only rule `budget_exhausted` counts as a budget denial; `budget:subagentsConcurrent` classifies as a plain denial (intent unknown)
- `src/domain/hook-decision.ts:392`: Skill, TodoWrite, TaskOutput and BashOutput are allowed with no check on the skill name; only the host allow rule gates it (intent unknown)
- `src/app/invocation.ts:158`: an `enforcement_failure` refusal spends an invocation unit although nothing ran (intent unknown)
- `src/adapters/host-claude/settings.ts:113`: the extra GSD secret-read-guard hook entry is not blocking, so a crash in it lets calls proceed (intent unknown)
- `src/adapters/fs/profile-paths.ts:77`: the local-mount check covers the data root only, not the work root that holds staging (intent unknown)
- `src/domain/hook-decision.ts:512`: secret globs apply only below staging; paths under read roots or re-allowed roots skip the glob check (intent unknown)

## From code comments (all grounders)

- `src (many files)`: code comments and one user-facing string carry delivery narrative (phase numbers, plan IDs, threat IDs); not a runtime defect

## From from review

- `src/app/stages/shared.ts:123`: blocked reasons `existing_state_conflict` and `adapter_incompatible` exist in the type but no stage records them; a move to `incompatible` carries no reason, though the CLI prints reasons in parentheses
- `src/hook/pre-tool-use.ts:24`: the hook opens the ledger with a bare connection (4 s busy wait): no SQLite version gate, ownership or mode check, WAL switch or foreign-key pragma, unlike every other opener (src/adapters/sqlite/db.ts:160)

## From the end-to-end trace

- `src/app/resume.ts:109`: reconciliation treats "more launches than validations" as an invocation in flight. After an interrupted launch and a relaunch the counts stay offset by one, so a kill at the start of a later retry round may count the previous round's files as this round's and skip the retry launch (sequence to confirm: interrupted launch, relaunch, rejected validation, kill before the next launch row).
- `src/app/stages/map.ts:62`: a refusing host returns an unsupported error, not the `enforcement_failure` denial the stage turns into a block, so the run exits 70, the onboarding stays in mapping and an invocation unit is spent each time. Reachable on resume in an environment that lost claude or the sandbox, because the enforcement check runs only in the workspace stage (intent unknown).
- `src/app/resume.ts:29`: with no reap capability on the host, the reap is skipped silently and reconciliation reads and stamps staging while a surviving host from an earlier run may still write; the skip is not reported (intent unknown).
- `src/app/budget.ts:74`: an orphaned reservation is charged invocations and cost only; its wall-clock time is never charged, so a killed invocation can run its full wall-clock share without reducing the wall-clock budget (intent unknown).
- `src/adapters/host-claude/env.ts:17`: the `extraPath` option and its comment (graphify directory for the knowledge pass) have no production caller; dead parameter with a misleading comment.
