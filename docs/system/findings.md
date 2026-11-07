# Findings

This note lists suspected defects and code-versus-specification contradictions found while grounding the `docs/system/` tree against the code. It is working material for the owner: each line names `file:line` and the observation, nothing is triaged, and nothing was fixed. Where the intent is undecidable from the code, the line says so and the owner classifies it.

A line marked "spec contradiction" means a proposal-era document in `docs/` states something the code does not do. The proposal stands as written; the line records the difference.

## From cli-reference

- `src/cli/main.ts:35`: `avarice` with no command exits 64 with usage; docs/extensions.md:174 says no arguments opens an interactive shell on a terminal (spec not implemented) (no longer holds at 72a86b1: a terminal with `AVARICE_RUN` unset opens the shell at `src/cli/main.ts:55`; the exit 64 remains for every other case) (the usage exit path is now at `src/cli/main.ts:62` to `:65`; `docs/extensions.md:174` has moved, the shell entry is at `docs/extensions.md:191` to `:196`)
- `src/cli/commands/onboard.ts:12`: exit code 3 is used throughout (also repo.ts:12, resume.ts:10, context.ts:11); docs/extensions.md:35 lists 0, 1, 2, 64, 69, 70 and no 3 (spec contradiction) (holds in part at 72a86b1: `docs/extensions.md:54` now explains exit 3 for the run commands, the exit-code summary at `docs/extensions.md:35` still lacks it) (the other cited lines are now `src/cli/commands/repo.ts:13` and `src/cli/commands/resume.ts:20`)
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

- `src/adapters/host-claude/env.ts:15`: comment says AVARICE_RUN marks a contained run for commands and the hook, but nothing in src or bin reads it; only tests check it (no longer holds at 72a86b1 for commands: `src/cli/main.ts:58`, `src/cli/shell/shell.ts:532` and `src/cli/commands/install-host.ts:25` read it; the hook still does not) (the comment is now at `src/adapters/host-claude/env.ts:16`)
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
- `src/adapters/sqlite/ledger.ts:409`: the carrier `runs` row is inserted with state 'onboarding' and never updated; its lease columns are unused (moved to `src/adapters/sqlite/ledger.ts:484` at 72a86b1; holds for the onboarding carrier row only, the lease columns of `runs` are now used by run leases)
- `src/adapters/sqlite/ledger.ts:437`: the step recorder upserts on (onboarding, step, attempt), overwriting the prior row's status and result
- `src/adapters/sqlite/ledger.ts:635`: the artifact index row is INSERT OR IGNORE in a separate transaction from the blob put; first kind and run per digest wins, and a crash between leaves a blob with no row
- `src/adapters/sqlite/migrations/0001-initial.ts:5`: header says the schema is copied verbatim from docs/contracts-and-state.md, but it adds projects, onboarding_steps and the immutability triggers; six spec tables have no writer (no longer holds at 72a86b1 as stated: only `task_refs` and `approvals` have no writer now) (the header now sits at `src/adapters/sqlite/migrations/0001-initial.ts:2` to `:3`)
- `docs/contracts-and-state.md:832`: the spec retention table (for example 30 days after run close) has no implementation; retention is the constant label 'onboarding' and nothing deletes (spec contradiction)
- `src/adapters/sqlite/migrations/0001-initial.ts:23`: checkpoints.item_id and gsd_state_digest have no writer (half stale at 72a86b1: `checkpoints.item_id` is written for runs, `gsd_state_digest` still has no writer) (now `src/adapters/sqlite/migrations/0001-initial.ts:27`)

## From integrations

- `src/cli/composition.ts:23`: `findGraphifyBinary` is imported but unused in this file
- `src/adapters/host-claude/env.ts:19`: the `extraPath` option (graphify directory for the knowledge pass) is never passed by any caller, so the knowledge pass runs without graphify on PATH (dormant; intent unknown)
- `src/adapters/gsd/locate.ts:60`: gsd-core discovery runs `gsd-tools.cjs runtime-identity` with spawnSync, unsandboxed, on every non-read-only command, while every other gsd-tools verb is sandboxed (intent unknown)
- `src/adapters/graph/graphify.ts:131`: the graphify version is recorded but never compared with 0.9.x; the descriptor hard-codes '0.9'
- `src/adapters/host-claude/launch-preflight.ts:122`: the version and sandbox probes use a fixed PATH; a `claude` launcher that needs an interpreter elsewhere (a version-managed node) would read as host-unavailable (not verified)
- `src/adapters/host-claude/claude-host.ts:372`: reaping matches `pgrep -f -- "--session-id <uuid>"` against every process on the machine, not only AVARICE-started hosts (now at `src/adapters/host-claude/claude-host.ts:378`, repeated under From integrations (run slice))
- `src/adapters/host-claude/claude-host.ts:333`: transcript redaction runs after the 20 MiB cap, so a secret split by the truncation boundary is not matched (not verified)
- `src/adapters/host-claude/launch-preflight.ts:1`: the startup descriptor is cached once per adapter while launches re-probe, so the descriptor can read `enforced` while a later launch is refused (for example after a claude upgrade within one process)
- `docs/existing-tooling-assessment.md:76`: proposes `gh pr create` and "gh CLI covers MVP needs"; code never invokes gh and denies it to the host (spec contradiction)
- `docs/existing-tooling-assessment.md:24`: records Claude Code 2.1.312 and 2.1.316 only; code also admits 2.1.317 (at 72a86b1 the code also admits 2.1.318)

## From containment

- `docs/containment.md:29`: spec places per-run files at `<data root>/runs/<run>/`; code writes `onboard/{onb}/{purpose}-{inv}/` (src/adapters/host-claude/claude-host.ts:152)
- `docs/containment.md:28`: spec launch line omits `--verbose` and the optional `--agent`; code emits both (src/adapters/host-claude/launch-args.ts:36)
- `docs/containment.md:60`: spec allows `npm test`, `git add`, `git commit` and a worktree-scoped Edit; code allows Read, Edit on one write root, Glob, Grep and blanket Bash gated by the hook, and denies `git commit` and `npm` (src/adapters/host-claude/settings.ts:84)
- `docs/containment.md:81`: spec network allows registry.npmjs.org; code lists no domain and preflight refuses a non-empty list (src/adapters/host-claude/launch-preflight.ts:58)
- `docs/containment.md:84`: spec hook command is `avarice hook pre-tool-use --run <run>`; code runs node with the hook entry, `--event` and `--policy` (src/adapters/host-claude/settings.ts:157)
- `docs/containment.md:94`: spec carries four GSD hooks; code carries only the GSD secret read guard, when present (src/adapters/host-claude/settings.ts:165)
- `docs/containment.md:96`: spec env allowlist includes repository-declared toolchain variables; code has fixed names only (src/adapters/host-claude/env.ts:26)
- `docs/containment.md:122` (now at `docs/containment.md:133`): spec executor is @anthropic-ai/sandbox-runtime with contract network endpoints and invocation env; code uses /usr/bin/sandbox-exec, all network denied, caller env (src/adapters/exec/seatbelt-profile.ts:44)
- `docs/containment.md:134`: spec says an unadmitted host version gives restricted mode via doctor; code refuses the launch (src/adapters/host-claude/launch-preflight.ts:136); no restricted mode or `--restricted` flag exists
- `docs/containment.md:151`: spec file-edit safeguards (read-before-edit digest, unexpected_change, create and delete globs) are not implemented; the write decision is path-in-write-root only (src/domain/hook-decision.ts:526) (no longer holds at 72a86b1 for the run purpose: `src/domain/hook-decision.ts:646`; it still holds for the onboarding purposes) (the file-edit safeguards row is now at `docs/containment.md:116`)
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

## From runs

- `src/app/run-start.ts:175`: `start` refuses with ten distinct codes, not only the six preflight codes: `gsd-not-admitted` (175), `no-project` (187), `no-active-record` (192) and `conventions-invalid` (210, 231) sit beside the six in `src/domain/run-preflight.ts:9`. Intent unknown (the six may be meant as the preflight rules only).
- `src/domain/run-contract.ts:116`: the compiled contract says `pushBranch: false`, `draftPr: false` and has no `remote`; `docs/contracts-and-state.md:192` has `pushBranch: true`, `draftPr: true`, `remote: origin`. Spec contradiction (delivery beyond a local branch is not built).
- `src/domain/run-contract.ts:459`: the contract `workspace` holds projectId, baseRevision, conventionsRevision and branch, with no `worktree` key; `docs/contracts-and-state.md:146` shows `worktree`. The run uses a clone (`src/adapters/git/run-workspace.ts:3`). Spec contradiction.
- `src/app/run-stages/prepare.ts:387`: the move from `contract_ready` to `blocked_on_decision` (host not enforced, or a repeated static G0 failure) calls the transition directly and opens no decision record, so `inbox` lists nothing for it; every other block goes through `src/app/run-stages/blocked.ts:38`. Intent unknown.
- `src/app/run-stages/prepare.ts:88`: `docs/contracts-and-state.md:566` and `:600` say `contract_ready` to `running` creates a worktree and reserves budgets; the code makes a clone here, creates the budget rows at start (`src/app/run-start.ts:252`) and reserves per invocation (`src/app/budget.ts:125`). Spec contradiction.
- `src/adapters/git/run-workspace.ts:242`: `docs/contracts-and-state.md:631` discards by resetting the worktree to the item's last checkpoint commit or `baseRevision`; the code restores a snapshot tree taken before the launch, path by path, with no reset. Spec contradiction.
- `src/domain/run-lifecycle.ts:10`: five run states (`waiting_external`, `awaiting_review`, `failed`, `cancelled`, `closed`) and four blocked reasons (`unauthenticated`, `ref_changed`, `ref_deleted`, `access_revoked`, lines 27 to 30) are never entered or recorded. Intent unknown (later features may drive them).
- `src/domain/run-lifecycle.ts:132`: the run step status `reconciled` is in the table and accepted by the ledger (`src/adapters/sqlite/ledger.ts:940`) but no run code writes it; only onboarding resume does (`src/app/resume.ts:125`). Intent unknown.
- `src/app/run-resume.ts:47`: no command answers a decision, and `resumeRun` reports a `blocked_on_decision` run as stopped; the edges out of `blocked_on_decision` and the item edge `blocked_on_decision` to `ready` (`src/domain/run-lifecycle.ts:152`) are never driven, so a blocked run is final. Intent unknown.
- `src/app/run-stages/item.ts:203`: `detectPause` is called without `stateNeedsHuman`, so the `state-needs-human` pause signal (`src/domain/outcome.ts:113`) can never fire in a run. Intent unknown.
- `src/domain/run-contract.ts:505`: `expectedDecisions` is parsed (`src/domain/brief.ts:189`) and stored in the contract; nothing reads it. Intent unknown.
- `src/app/run-stages/item.ts:626`: the discard step of a crashed unit is keyed by `history.value.length`, while the resume discards (`item.ts:371`, `item.ts:395`) key it by the attempt's ordinal; the two differ once an attempt that never launched is left out of the history. Intent unknown.
- `src/app/run-stages/item.ts:848`: a path that G2 passed but that is neither in scope nor an artifact stops the supervisor with an internal error (the run stays `running`, the item `gated`) rather than a block. Intent unknown.
- `src/app/run-stages/finish.ts:244`: every failed G4, whichever rule failed (including `acceptance-mapped` and `decisions-closed`), opens a `repeated_failure` decision, although no retry follows. Intent unknown.
- `src/domain/conventions.ts:243`: the run's conventions reader accepts only `schema`, `checks`, `paths` (`write`, `protected`, `artifacts`), `testInventory`, `dependencies` and `agentCommands` and refuses every other key; `docs/system/config-reference.md:159` to `:162` and `:169` list `paths.read`, `paths.generated`, `commands` and `verificationByChangeType` for the onboarding reader of the same file. One file cannot satisfy both unless it stays within the common keys. Intent unknown.
- `src/domain/run-contract.ts:107`: the stored text `repairAttemptsReason` ("no repair work items exist in this phase") is delivery narrative inside every contract file. Intent unknown.
- `src/app/run-stages/item.ts:70`: the internal error text for a run with another number of work items names a delivery phase; the same phase wording sits in the discard basis (`src/app/run-stages/discard.ts:19`), which is stored in every discard step. Intent unknown.

## From checks-and-evidence

- `src/app/check-validation.ts:90`: the validation run passes the read deny list and no read re-allowance (compare `src/app/checks.ts:205`), so under the default roots the check's own clone may be unreadable; intent unknown, not run.
- `src/domain/run-contract.ts:345`: G0 only requires a `check:` reference to name a declared check, while `src/app/checks.ts:90` runs only required or target checks, so a criterion verified by an optional non-target check can never be satisfied and fails G4 `acceptance-mapped` after the commit; intent unknown.
- `src/app/checks.ts:364`: install scripts are switched off only by the `npm_config_ignore_scripts` environment variable; the install argv (`src/domain/conventions.ts:316`) is not screened and is absent from the refused-word check at `src/domain/run-contract.ts:423`; intent unknown.
- `src/app/checks.ts:155`: the comment lists (name, argv, timeout, env, writes) as the verdict key, but the digest at `src/app/checks.ts:158` covers the whole declaration including `required`; comment contradicts behavior.
- `src/app/check-validation.ts:50`: network detection matches error text in the check's output, so a check that prints `ECONNREFUSED` or `getaddrinfo` is rejected as `network`; intent unknown.
- `src/app/checks.ts:217`: check stdout and stderr are stored in the artifact with no redaction; intent unknown.
- `src/app/run-stages/finish.ts:180`: final-proof check rows take the revision measured before the checks ran, while the G4 revision is measured after (line 122); a check that dirties the tree fails `revision-clean` and its rows drop out of the acceptance mapping; intent unknown.
- `src/domain/test-inventory.ts:67`: the comparison ignores the measurement status, so a failed list command after the unit (empty ID list, `src/app/checks.ts:448` only fills IDs on pass) reads as every base test removed; intent unknown.
- `src/app/checks.ts:233`: pre-existing is judged by status only, so a check failing for a new reason is still flagged pre-existing; intent unknown.
- `src/domain/gates.ts:73`: rule `outcome-progressed` cannot fire in a run, because only progressed units reach G2 (`src/app/run-stages/item.ts:555`); likely defensive, intent unknown.

## From cli-reference (run slice)

- `src/cli/commands/context.ts:50`: the "onboard a repository first" hint prints `avarice onboard <repo>`, which omits the required `--policy onboarding` and would itself be a usage error.
- `src/adapters/host-claude/avarice-run-skill.ts:37`: the skill tells sessions not to run `avarice contract amend` and `avarice budget`; neither is in COMMANDS (`src/cli/main.ts:12`); intent unknown (forward reference or stale).
- `src/cli/commands/install-host.ts:35`: the config directory reads `process.env` for `CLAUDE_CONFIG_DIR`, while the usage check at `install-host.ts:25` uses the environment passed to `main`; the two can differ when `main` is given an environment; intent unknown.
- `src/app/run-status.ts:143`: a run with no lease holder (a just-started `contract_ready` run before its supervisor takes the lease) is presented as interrupted and `paused`, with a resume hint; intent unknown.
- `src/cli/main.ts:94`: `createDeps` and the usage check (`src/cli/main.ts:88`) are outside the try block that maps exceptions to exit 70; a throw there is not handled by dispatch; intent unknown.
- `docs/extensions.md:35`: spec contradiction: the proposal's exit-code summary lists 0, 1, 2, 64, 69, 70; the CLI returns only 0, 3, 64 and 70 (`src/cli/main.ts:13`).
- `docs/extensions.md:60`: spec contradiction: the proposal's `resume <runId>` row has no `--wait` flag; the code declares it (`src/cli/commands/resume.ts:26`) and adds exit 70 for a failed reconcile.

## From config-reference (run slice)

- `src/domain/run-contract.ts:115`: `noProgressInvocations: 2` is written into every contract and read by no code (search over src finds no other use); the proposal's preset table counts it as an escalation limit. Spec contradiction.
- `src/domain/policy-narrowing.ts:109`: the onboarding proposal reader refuses every key it does not know, including `schema`, `checks`, `testInventory`, `dependencies` and `agentCommands`, which the run reader requires or accepts (`src/domain/conventions.ts:243`); a valid run conventions file therefore always yields onboarding findings. Intent unknown.
- `src/app/checks.ts:120`: sandboxed supervisor commands deny the data root and the default parent directories only; a work root or config home placed by environment variable is not denied by name, though the agent scope denies the work root. Intent unknown.
- `src/app/run-stages/item.ts:819`: a changed artifact file over 2 MiB makes the read return an error and the classification step returns it, so the stage ends in an error rather than a recorded verdict. Intent unknown.
- `src/app/checks.ts:200`: a check's own `env` is overridden by the sandbox values (`CI`, `LANG`), which the parser's reserved list (`src/domain/conventions.ts:46`) does not refuse, so the override is silent. Intent unknown.

## From containment (run slice)

- `src/adapters/git/run-workspace.ts:197`: the clone's described entries come from `ls-tree HEAD`, so existing untracked entries (installed dependencies) get no sandbox write denial, and writes into git-ignored paths are outside the G2 tree comparison. Intent unknown.
- `src/domain/hook-decision.ts:259`: the hook admits a write matching any of write, create or artifact globs, so a modification of a tracked file matching only a create glob passes at call time; `src/domain/gates.ts:91` refuses it afterwards. Intent unknown.
- `src/domain/invocation-scope.ts:477`: a protected glob with no static prefix (leading wildcard) adds no sandbox write denial; only the hook and the gates hold it inside a write root. Intent unknown.
- `src/app/invocation.ts:404`: a run's invocation request carries the run ID in `onboardingId`, so hook events (`src/adapters/host-claude/hook-policy.ts:44`) name the run in the onboarding field. Likely deliberate; intent unknown.
- `src/domain/hook-decision.ts:646`: read-before-edit is implemented for the run purpose; `docs/system/findings.md:91` (read-before-edit "not implemented") no longer holds for runs, and still holds for the onboarding purposes. Spec contradiction partly resolved; owner to decide which side moves.
- `src/adapters/exec/seatbelt-profile.ts:84`: the executor now allows one loopback port in front of a registry-allowlisting proxy; `docs/system/findings.md:89` ("all network denied") is stale. The executor is still `/usr/bin/sandbox-exec`, not the proposal's sandbox-runtime (`docs/containment.md:133`). Spec contradiction.

## From data-model (run slice)

- `src/adapters/sqlite/ledger.ts:484`: the carrier `runs` row is inserted with state 'onboarding' and never updated; its lease columns are unused (replaces the finding at old line 409)
- `src/adapters/sqlite/ledger.ts:1183`: a decision is inserted with state 'open' and no code updates a decision, so the answer columns and the states answered, stale and withdrawn are unreachable (intent unknown; no command answers a decision)
- `src/adapters/sqlite/ledger.ts:1029`: the evidence insert binds ext_ref to a NULL literal, so the column is never set (intent unknown)
- `src/adapters/sqlite/migrations/0001-initial.ts:17`: task_refs has no writer or reader; the earlier finding that six spec tables lack a writer (old line 5) is now two tables
- `src/adapters/sqlite/migrations/0001-initial.ts:76`: approvals has no writer or reader
- `src/adapters/sqlite/migrations/0001-initial.ts:30`: checkpoints.gsd_state_digest has no writer; item_id is now written for runs (`src/adapters/sqlite/ledger.ts:468`), so the earlier finding at old line 23 is half stale
- `src/adapters/sqlite/ledger.ts:746`: createRun has no production caller (createRunWithContract calls insertRun directly); only `test/integration/run-ledger.test.ts` calls it
- `src/adapters/sqlite/ledger.ts:903`: storeRunContract has no production caller (only a test); runs store contract version 1 only
- `src/adapters/sqlite/ledger.ts:1105`: upsertWorkItem has no production caller; the type 'harden' it accepts (line 1116) is written by nothing
- `src/adapters/sqlite/ledger.ts:1257`: listHookReads has no production caller (only a test)
- `src/adapters/host-claude/claude-host.ts:153`: a run's invocation directory is under `run/`, while its contract file is under `runs/` (`src/app/run-start.ts:145`); intent unknown
- `src/hook/pre-tool-use.ts:134`: the hook counts events by invocation_id, which has no index (only events_run and evidence_attempt exist), so each decision scans the log
- `src/adapters/sqlite/migrations/0002-run.ts:30`: check_validations has no immutability trigger although evidence and gate_results have one; code never updates it (intent unknown)

## From integrations (run slice)

- `src/cli/composition.ts:27`: `findGraphifyBinary` is imported but unused in this file
- `src/adapters/graph/graphify.ts:95`: the descriptor hard-codes version '0.9'; the version printed by graphify is recorded but never compared with 0.9.x
- `src/adapters/host-claude/launch-preflight.ts:111`: the version and sandbox probes use a fixed PATH; a `claude` launcher that needs an interpreter elsewhere (a version-managed node) would read as host-unavailable (not verified)
- `src/adapters/host-claude/claude-host.ts:378`: reaping matches `pgrep -f -- "--session-id <uuid>"` against every process on the machine, not only AVARICE-started hosts
- `src/adapters/host-claude/claude-host.ts:239`: transcript redaction runs after the 20 MiB cap was applied while reading, so a secret split by the truncation boundary is not matched (not verified)
- `src/adapters/host-claude/claude-host.ts:100`: the startup descriptor is cached once per adapter while every launch re-probes, so the descriptor can read `enforced` while a later launch is refused
- `docs/existing-tooling-assessment.md:193`: proposes the `gh` CLI as covering MVP needs, and line 103 lists `gh pr create`; code never spawns gh and denies it to the host (spec contradiction)
- `src/adapters/exec/sandboxed-executor.ts:129`: the executor descriptor says `offline: true` although a command may be given loopback ports (intent unknown)
- `src/cli/spawn-supervisor.ts:47`: the detached supervisor inherits the whole parent environment, unlike the host and every sandboxed command (intent unknown)
- `src/adapters/git/run-workspace.ts:412`: the hand-off fetch writes the objects of the run branch into the user's repository, while the port header says it creates exactly one ref and nothing else (intent unknown)
- `src/adapters/git/run-source.ts:39`: the conventions walk is capped at the newest 500 first-parent commits above the pin, so an older conventions-only commit is skipped in favor of the pin's file (intent unknown)
- `src/adapters/exec/allowlist-proxy.ts:95`: the proxy connects to the allowlisted name without checking the address it resolves to (intent unknown)

## From interactive-shell

- `src/cli/shell/shell.ts:532`: the shell's own AVARICE_RUN refusal cannot be reached from the command line, because the only caller (`src/cli/main.ts:58`) has already refused; inside a run the user sees the generic "no command given" usage, not this message. Intent unknown (defence in depth or an unreachable message).
- `src/cli/composition.ts:164`: the read-only open used by every shell view falls back to a writable open with migration when the ledger is missing or migrations are pending (line 166), so the shell can create the profile directories and ledger and migrate it by showing the home view. Intent unknown.
- `src/cli/shell/actions.ts:117`: the menu Start action (and Resume at line 221) runs a command line that is never recorded in history, while the same line typed in the command line is recorded (line 69). Intent unknown.

## From overview

- `src/cli/spawn-supervisor.ts:3`: the comment says the application layer may not start processes; the import lint (`scripts/check-boundaries.ts:10`) enforces no such rule for it, only the absence of adapters and cli imports. Intent unknown (convention only, or a rule meant for the lint).
- `scripts/check-boundaries.ts:340`: the default lint run covers domain, ports and app only; adapters, cli and the hook entry are not linted, and the hook imports adapters (`src/hook/pre-tool-use.ts:18`). Intent unknown.

## From processes

- `src/app/run-stages/item.ts:314`: a supervisor killed after delegating the item and before its snapshot step is reconciled to ready without reading the clone HEAD (`item.ts:321`), so the moved-HEAD breach check that follows (`item.ts:352`) is skipped for that case. Intent unknown.
- `src/app/run-stages/item.ts:611`: any host error other than a timeout stops the retry, but only an unavailable or denied host error is reported as an enforcement failure (`item.ts:639`); another host error (for example internal) ends as a repeated-failure decision. Intent unknown.

## Proposal documents edited before the documentation rule

- `docs/containment.md:7`: edited on this branch by commits 304e551, 6ae2f04, 265b57a, 3fb6ae4, 6011f19, 059cd3d, 7fe273c before the documentation rule reached it; the owner decides whether these edits stay or are reverted
- `docs/contracts-and-state.md:193`: edited on this branch by commits 6ae2f04, 3fb6ae4, 57aaa4e before the documentation rule reached it; the owner decides whether these edits stay or are reverted
- `docs/extensions.md:43`: edited on this branch by commits 304e551, d6bd6f6, bc2294d, 3fb6ae4 before the documentation rule reached it; the owner decides whether these edits stay or are reverted
- `docs/decisions/ADR-006-unattended-delegation.md:56`: edited on this branch by commit 3fb6ae4 (a dated implementation note; the status is still Proposed) before the documentation rule reached it; the owner decides whether these edits stay or are reverted
- `docs/implementation-plan.md:27`: edited on this branch by commit 304e551 (the admitted host version) before the documentation rule reached it; the owner decides whether these edits stay or are reverted

## Known load-sensitive tests

- `test/mutation/fail-closed.test.ts:260`: the FC-10 case and the WR-07 probe cases (lines 299, 309, 320) fail under full-suite load and pass when their file runs alone (intent unknown)
- `test/integration/claude-host.test.ts:704`: "follows SIGTERM with SIGKILL after the grace when the host ignores SIGTERM" fails under full-suite load and passes when its file runs alone (intent unknown)
- `test/fault/killpoints.test.ts:272`: the checkout digest comparison differed once under full-suite load and passes when its file runs alone (intent unknown)

## Proposal drift

Differences between a proposal document and the code that still hold at the pass's code state. The proposal stands as written.

- `docs/containment.md:3`: the status line says the onboarding of one existing repository is built and says nothing about runs, although runs are built
- `docs/containment.md:115`: the matrix row "Pre-existing user changes survive" describes a dedicated worktree on a new branch; runs work in a local clone
- `docs/containment.md:110`: the matrix rows "Only contract endpoints reachable" (110), "No privileged external effects" (111) and "Retrieval scope and cost" (114) name no test file, so the matrix test passes them vacuously
- `docs/containment.md:59`: the "Generated host settings" example JSON carries `<worktree>` placeholders, a git-hooks `denyWrite` entry and git rules; the generated settings name the realpath of the clone and the supervisor commits
- `docs/contracts-and-state.md:158`: the example contract lists `git add` and `git commit` in `execution.commands`; the compiler refuses commands that start with git (`src/domain/run-contract.ts`)
- `docs/contracts-and-state.md:146`: the example contract has `workspace.worktree`; the compiled contract carries no worktree key and the run uses a clone
- `docs/contracts-and-state.md:279`: the interface sketch declares `worktree: RelPath`; no such field exists in the compiled contract
- `docs/extensions.md:71`: the PreToolUse row says the hook denies Agent calls whose definition sets `permissionMode`; the code refuses to build the agents file instead (`src/adapters/gsd/agent-frontmatter.ts:20`), and denies `run_in_background` only for the run purpose (`src/domain/hook-decision.ts`)
- `docs/extensions.md:215`: the skill section's test row names a prompt evaluation of attended sessions; no harness for it was found in the repository (intent unknown)
