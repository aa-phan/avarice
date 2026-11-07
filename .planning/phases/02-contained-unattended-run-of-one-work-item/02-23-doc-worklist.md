# Worklist for the Phase 2 documentation pass (plan 02-23)

Plan base: 72a86b16744dd24e1cd04457c9534eb478c92f93
Diff base: e725db6

This file is the one input every later task and agent of plan 02-23 reads. It is working material for the agents and the executor. It is not a `docs/system/` document, so plan IDs, decision IDs and file paths appear freely here and never in the documents. Everything below was checked at the plan base. A grounder re-reads the code itself; the notes are leads, not evidence.

## Dispatch list

dispatch: readme docs/system/README.md minor update
dispatch: overview docs/system/overview.md ground update
dispatch: cli-reference docs/system/cli-reference.md ground update
dispatch: config-reference docs/system/config-reference.md ground update
dispatch: onboarding docs/system/onboarding.md minor update
dispatch: containment docs/system/containment.md ground update
dispatch: indexes-and-context docs/system/indexes-and-context.md unchanged none
dispatch: data-model docs/system/data-model.md ground update
dispatch: integrations docs/system/integrations.md ground update
dispatch: processes docs/system/processes.md ground update
dispatch: history docs/system/history.md ground update
dispatch: findings docs/system/findings.md notes update
dispatch: unknowns docs/system/unknowns.md notes update
dispatch: coverage docs/system/coverage.md ledger update
dispatch: runs docs/system/runs.md ground new
dispatch: checks-and-evidence docs/system/checks-and-evidence.md ground new
dispatch: interactive-shell docs/system/interactive-shell.md ground new

tracer: runs

Locked lines: runs, checks-and-evidence and interactive-shell are `ground new`. interactive-shell is named after the interactive-shell ADR it implements (ADR-013, scope matches: the shell). runs and checks-and-evidence are named after the built subsystem, because no proposal's scope matches (the run proposal is split across contracts-and-state.md, containment.md and extensions.md). No further `ground new` line: every other new source file belongs to a locked document (the render functions belong to cli-reference and interactive-shell; the proxy and the clone adapters belong to containment, integrations and runs).

Classification of the two open documents, from the hunks:
- onboarding is `minor update`. The diff touches no onboarding stage, but three shared modules changed under it: `src/adapters/git/staging-base.ts` and `staging-clone.ts` (the staging helpers became shared module-level functions, 176 and 167 changed lines), `src/app/budget.ts` and `src/app/invocation.ts` (one reservation core and one settle core now serve both owners), and `src/domain/outcome.ts` (the classifier gained a `paused` kind driven by a structural signal the onboarding stages never pass). The executor re-reads the claims named in `## Packet: onboarding`, edits only a claim the code falsifies, and records "no change needed" in the review ledger when none is.
- indexes-and-context is `unchanged`. None of `src/app/stages/index-*.ts`, `src/adapters/context/`, `src/adapters/graph/`, `src/cli/commands/context.ts` or `src/app/context.ts` is in the diff (`git diff --name-only e725db6..HEAD -- src` lists none of them). The shared budget and invocation modules it reserves through changed only by extraction (checked in the onboarding packet). Its two `AVARICE_*` mentions stay true.

## Code surface

`git diff --name-status e725db6..HEAD -- src bin` lists 79 files (45 added, 34 modified); `bin/` has no change. Packets are named by their dispatch stem. A file with no documentable change is under `## No documentable change`.

| File | A/M | Behavior added or changed | Packets |
|---|---|---|---|
| src/adapters/exec/allowlist-proxy.ts | A | In-process HTTP CONNECT proxy on loopback that admits only the allowlisted registry host and port and records every attempt | containment, integrations, config-reference, checks-and-evidence |
| src/adapters/exec/sandboxed-executor.ts | M | Passes `allowReadPaths` to the Seatbelt profile builder | containment, integrations |
| src/adapters/exec/seatbelt-profile.ts | M | Loopback-port allow lines after the network deny, re-allowed read subtrees under a denied parent, metadata of the directories above a re-allowed path | containment, integrations |
| src/adapters/git/run-source.ts | A | Reads conventions and the staleness of the pin from repository objects without touching the working tree | runs, integrations |
| src/adapters/git/run-workspace.ts | A | The run's local clone: prepare at the pin, snapshot, restore, supervisor commit with trailers, hand-off fetch into the source repository, discard | runs, integrations, containment, config-reference, checks-and-evidence |
| src/adapters/git/safe-git.ts | M | `runGit` options (identity, fsck, indexFile, literalPathspecs), option allowlists for fetch and commit, no forced refspec | containment, integrations, config-reference |
| src/adapters/git/staging-base.ts | M | Staging helpers made shared module-level functions (`readConfinedFile`, `ensureConfinedDir`, `checkRelative`) | onboarding, integrations |
| src/adapters/git/staging-clone.ts | M | `prepareClone` extracted as a shared helper | onboarding, integrations |
| src/adapters/gsd/agents-json.ts | M | Appends the no-commit addendum to the `gsd-executor` agent only | runs, containment, config-reference |
| src/adapters/host-claude/avarice-run-skill.ts | A | The `avarice-run` skill text and its digest | cli-reference, integrations, config-reference |
| src/adapters/host-claude/claude-host.ts | M | Owner-aware invocation: run owner, `run/<runId>/` directory, realpath cwd, `resultSeen` and `isError` in the result | containment, integrations, runs |
| src/adapters/host-claude/env.ts | M | Run environment: `AVARICE_RUN` marker, scratch `TMPDIR`, npm cache, update notifier off | config-reference, containment |
| src/adapters/host-claude/hook-policy.ts | M | Writes the run purpose's policy fields (globs, agent commands, denied tools, background shell, read-before-edit, loop limits) | containment |
| src/adapters/host-claude/invocation-files.ts | M | Comment-only: names the run's invocation directory (no documentable change; see `## No documentable change`) | none |
| src/adapters/host-claude/launch-preflight.ts | M | Admits host version 2.1.318 | containment, integrations |
| src/adapters/host-claude/settings.ts | M | File-level Edit rules, scratch rules, denied tools, `allowWrite` for files and scratch | containment |
| src/adapters/host-claude/skill-install.ts | A | `installSkill`: writes the skill file under the Claude configuration directory with symlink and marker refusals | cli-reference, integrations |
| src/adapters/sqlite/ledger.ts | M | 29 run methods: runs, leases with fence, steps, evidence, gate results, work items, decisions, check validations, hook reads, loop limit lookup, run events | data-model, runs, interactive-shell |
| src/adapters/sqlite/migrations/0002-run.ts | A | Schema version 2: four `runs` columns, three tables, two indexes, four insert-only triggers | data-model |
| src/app/budget.ts | M | Run reservations over one shared core; orphan charge for a killed invocation | runs, containment, config-reference, onboarding |
| src/app/check-validation.ts | A | Active validation of each declared check with cached verdicts | checks-and-evidence, config-reference |
| src/app/checks.ts | A | Dependency install under the proxy, baseline, required checks, test inventory, cached verdicts | checks-and-evidence, config-reference, data-model, containment |
| src/app/deps.ts | M | Three optional run ports on `AppDeps` | overview, integrations |
| src/app/invocation.ts | M | `prepareRunInvocation` and `completeRunInvocation` over one shared settle core | runs, containment, onboarding |
| src/app/onboarding-service.ts | M | `leaseTtlMs` exported and shared with the run supervisor | config-reference, onboarding |
| src/app/run-gsd-config.ts | A | The seven GSD settings applied to a run, the run prompt and its size cap | runs, config-reference, containment |
| src/app/run-resume.ts | A | Resume prelude: reap, spend orphaned reservations, reconcile by state | runs, processes |
| src/app/run-service.ts | A | The supervisor: lease loop, renewal, stage registry, no-progress guard | runs, config-reference, processes |
| src/app/run-stages/blocked.ts | A | The one place a run that cannot finish opens its decision and moves to `blocked_on_decision` | runs, data-model |
| src/app/run-stages/discard.ts | A | Snapshot-bounded discard of an attempt and return of the item to `ready` | runs, processes |
| src/app/run-stages/finish.ts | A | The `verifying` stage: final checks, gate G4, hand-off fetch | runs, checks-and-evidence, data-model, processes |
| src/app/run-stages/item.ts | A | The `running` stage: context pack, invocation, classification, gate G2, supervisor commit, outcome routing, retry | runs, checks-and-evidence, processes |
| src/app/run-stages/prepare.ts | A | The `contract_ready` stage: prepare workspace, verify enforcement (G0), configure GSD, install dependencies, validate checks, baseline | runs, checks-and-evidence, containment, processes |
| src/app/run-stages/stage.ts | A | The stage context: checkpoint, transition, note, fence, kill points | runs |
| src/app/run-start.ts | A | `startRun`: the start refusals, contract compile, one-transaction store | runs, cli-reference, data-model, processes |
| src/app/run-status.ts | A | The read model of runs and the inbox | cli-reference, runs |
| src/app/status.ts | M | Optional `runs` key on a project entry of `status --json` | cli-reference |
| src/cli/args.ts | M | Shared `--budget` parser, `usage(args, env)` signature | cli-reference |
| src/cli/commands/inbox.ts | A | `avarice inbox [--json]` | cli-reference |
| src/cli/commands/init.ts | M | Result line and `initialized`/`already initialized` wording, control characters stripped | cli-reference |
| src/cli/commands/install-host.ts | A | `avarice install-host [--config-dir]` with refusal inside a run | cli-reference, config-reference |
| src/cli/commands/onboard.ts | M | Uses the shared budget parser | cli-reference |
| src/cli/commands/repo.ts | M | Result lines, control-character stripping, resolving-command line | cli-reference |
| src/cli/commands/resume.ts | M | Run IDs resume through a detached supervisor; `onb_` IDs keep the onboarding path; `--wait` | cli-reference, runs |
| src/cli/commands/start.ts | A | `avarice start`: brief, policy, project, budget overrides, `--wait` | cli-reference, runs |
| src/cli/commands/status.ts | M | Renders through the shared status view, sized to the terminal | cli-reference |
| src/cli/commands/supervise.ts | A | `avarice supervise <runId>` | cli-reference, runs |
| src/cli/composition.ts | M | Migration 0002 registered, run ports composed, proxy override for tests | overview, integrations, config-reference, data-model, cli-reference |
| src/cli/main.ts | M | Ten commands, bare `avarice` opens the shell on a terminal unless `AVARICE_RUN` is set | cli-reference, interactive-shell, overview, config-reference |
| src/cli/render/run-view.ts | A | `renderRuns`, `renderRunDetails`, `renderInbox`, `runStateWord` | cli-reference, interactive-shell |
| src/cli/render/status-view.ts | A | `renderStatus` moved out of the app layer and extended with runs | cli-reference, interactive-shell |
| src/cli/render/style.ts | A | Result lines, error lines, state words, colour rules (`NO_COLOR`, `TERM`), control-character stripping | cli-reference, interactive-shell, config-reference |
| src/cli/render/table.ts | A | Terminal-width table renderer | cli-reference, interactive-shell |
| src/cli/shell/actions.ts | A | The shell's actions over the existing commands | interactive-shell |
| src/cli/shell/history.ts | A | `{dataRoot}/shell-history`, mode 0600, capped at 1000 lines | interactive-shell, data-model, config-reference |
| src/cli/shell/home-view.ts | A | Home and watch views | interactive-shell |
| src/cli/shell/line-editor.ts | A | Line editor with command completion | interactive-shell |
| src/cli/shell/shell.ts | A | The session engine over raw keys or whole lines; refuses inside a run | interactive-shell, config-reference |
| src/cli/spawn-supervisor.ts | A | The detached supervisor spawn, wait, liveness check | runs, cli-reference, config-reference |
| src/domain/brief.ts | A | Brief file format: frontmatter and five sections, digest | runs |
| src/domain/conventions.ts | A | `.avarice/config.json` schema 1, reserved check env, refused agent command words | runs, config-reference, checks-and-evidence |
| src/domain/evidence.ts | A | Evidence statuses, baseline delta, acceptance mapping | checks-and-evidence |
| src/domain/gates.ts | A | Gates G2 and G4 rules and verdicts | checks-and-evidence, runs, containment |
| src/domain/hook-decision.ts | M | Read-before-edit, loop limits, protected-path, agent-command, background-shell, no-human-prompts rules | containment |
| src/domain/ids.ts | M | ID prefixes `ev_` and `dec_` | data-model |
| src/domain/invocation-scope.ts | M | `computeRunScope`: the run purpose's write, read and command scope | containment, runs |
| src/domain/outcome.ts | M | A structural `paused` kind and `detectPause` | runs, onboarding |
| src/domain/quick-record.ts | A | Parses the GSD quick record's verification status | runs |
| src/domain/run-contract.ts | A | Routine preset, policy and budget names, contract compile, static G0 | runs, config-reference |
| src/domain/run-lifecycle.ts | A | The run state machine and work item states as one table | runs, data-model |
| src/domain/run-preflight.ts | A | Staleness limits and the six start refusal codes | runs, config-reference |
| src/domain/test-inventory.ts | A | Skip and focus marker scan, inventory comparison | checks-and-evidence |
| src/hook/pre-tool-use.ts | M | Records read digests at PostToolUse, enforces read-before-edit and loop limits, `continue: false`, `loop.limit` event | containment, data-model |
| src/ports/agent-host.ts | M | `run` purpose, `ownerKind`/`ownerId`, `resultSeen`, `isError` | integrations |
| src/ports/command-executor.ts | M | `allowReadPaths` and `allowLoopbackPorts` on `CommandSpec` | integrations, containment |
| src/ports/egress-proxy.ts | A | The `EgressProxy` port | integrations |
| src/ports/ledger.ts | M | The run methods of the `Ledger` port | data-model, integrations |
| src/ports/run-source.ts | A | The `RunSource` port | integrations |
| src/ports/run-workspace.ts | A | The `RunWorkspace` port | integrations |

The processes packet owns the three traced flows and cites the files of the flow it traces; it reads the same files the runs packet owns.

## No documentable change

code: src/adapters/host-claude/invocation-files.ts
Comment-only: the header comment gained one line naming the run's invocation directory (`{dataRoot}/run/{runId}/run-{inv}/`), which the host adapter chooses; the module writes into the directory it is given. The directory itself is documented through `claude-host.ts` in the data-model and containment packets.

## Packet: runs

- target: docs/system/runs.md, change new; kind: descriptive (process), with one contract surface, the brief file format
- skills: technical-writing, documenting-legacy-codebases, documenting-contracts (for the brief format only)
- shape: onboarding.md is the nearest sibling. Name the run modules once in the opening paragraph. Quirks section last.
- code:

code: src/adapters/git/run-source.ts
code: src/adapters/git/run-workspace.ts
code: src/adapters/gsd/agents-json.ts
code: src/adapters/host-claude/claude-host.ts
code: src/adapters/sqlite/ledger.ts
code: src/app/budget.ts
code: src/app/invocation.ts
code: src/app/run-gsd-config.ts
code: src/app/run-resume.ts
code: src/app/run-service.ts
code: src/app/run-stages/blocked.ts
code: src/app/run-stages/discard.ts
code: src/app/run-stages/finish.ts
code: src/app/run-stages/item.ts
code: src/app/run-stages/prepare.ts
code: src/app/run-stages/stage.ts
code: src/app/run-start.ts
code: src/app/run-status.ts
code: src/cli/commands/resume.ts
code: src/cli/commands/start.ts
code: src/cli/commands/supervise.ts
code: src/cli/spawn-supervisor.ts
code: src/domain/brief.ts
code: src/domain/conventions.ts
code: src/domain/gates.ts
code: src/domain/invocation-scope.ts
code: src/domain/outcome.ts
code: src/domain/quick-record.ts
code: src/domain/run-contract.ts
code: src/domain/run-lifecycle.ts
code: src/domain/run-preflight.ts

- owns (one fact, one home): the run lifecycle and its states; `start` and its six refusals; the contract compile, the brief file format and static gate G0; the conventions the contract reads (what they mean for the run; the key list belongs to config-reference); the detached supervisor and the lease; the stages in order (prepare, running, verifying); discard and the one retry; the supervisor's own commit and its trailers; the hand-off fetch; escalation to a decision and its classes; resume and reconcile; the outcome kinds as the run reads them (the verdict comes from the clone and the quick records, not from the host outcome kind).
- summary notes (agents only; the document carries no plan IDs):
  - 02-03: the run state machine is one pure table; 11 states, 37 transitions; blocked reasons decision, enforcement_failure, budget_exhausted, unauthenticated, ref_changed, ref_deleted, access_revoked; step statuses started, completed, failed, interrupted, reconciled, skipped; work item states ready, delegated, implemented, gated, done, blocked_on_decision.
  - 02-04: brief = Markdown with frontmatter and five sections, validated, digested. Conventions schema 1 from `.avarice/config.json` at a descendant commit. Routine preset and policy; the contract version 1 carries every RC-1 field and a digest; budget overrides may only lower.
  - 02-07: the run clone is a local clone (not a worktree); the hand-off is a fetch into the source repository that creates one run branch ref; no forced refspec; the user's checkout is never written (a test pins the checkout digest).
  - 02-08: the run prompt (`runUnitPrompt`) has a size cap; AVARICE_EXECUTOR_ADDENDUM goes to gsd-executor only; the supervisor commits, never the model.
  - 02-09 (spike S2-B, A2 confirmed): the model drives the quick unit by reading quick.md and spawning subagents itself; the host outcome kind is `denied` in most rounds because the model improvises compound shell lines, so the unit is judged from `.planning/quick/`, the VERIFICATION `status:` line, the clone diff and HEAD.
  - 02-10: `start` refuses with six codes before it creates anything (staleness limits 25 commits or 14 days from the pin; the pin is the base revision); the contract, budget rows, work items and events are stored in one transaction; the run is stored in `contract_ready`. Exit 3 and nothing created when no admitted GSD is found, before the brief is compiled.
  - 02-11: the read-before-edit and loop-limit rules belong to the containment packet; the run side is the supervisor reading the invocation's `loop.limit` event and escalating as repeated_failure.
  - 02-12: a detached `avarice supervise <runId>` started by `start` (own process group, stdio ignored, cwd the data root, unref'd); lease renewed every TTL/3, released in `finally`; no-progress guard fails with an internal error; `waitForRun` calls a non-stop run interrupted only when the PID is dead and the lease is not live; stage registry per state, action registry per stage; stage actions are skipped when their run step is completed; G0 dynamic half is `verify-enforcement`.
  - 02-13: running stage: context-pack, launch, classify, gate G2, commit; verifying stage: final checks, gate G4, hand-off fetch. A unit's verdict comes from the clone and quick records (an unreadable VERIFICATION status is `gaps_found`; a host result with no details, no result event or no boolean `is_error` is never success). G2 stops a failing required check before the commit; G4 is the independent final proof at the clean commit. Every artifact path is restored to HEAD or removed after the unit. The revision of a clean run is `git:<sha>`.
  - 02-15: the run read model and `inbox`; a run is interrupted when its state is resumable (contract_ready, running, verifying, paused) and no lease is live, presented as `paused (verification interrupted)` or `paused (supervisor interrupted)`; the `runs` key of `status --json` (the CLI shape belongs to cli-reference).
  - 02-16: a crashed or wall-clock-killed unit with no moved HEAD is discarded and retried once (the second and last attempt); a second failure is a `decision` / repeated_failure decision naming both attempt IDs; a spent invocations budget blocks (permission class) before the discard; a unit stopped by a loop limit is escalated, never gated or committed; the discard step records `sideEffect: none`.
  - 02-17: resume prelude (reap, spend orphaned reservations, reconcile by state); an interrupted invocation is read as inconclusive, discarded and retried once; the supervisor's commit is recognised by its Avarice-Run and Avarice-Attempt trailers; a foreign commit blocks; the mid-handoff kill point sits between fetch and record so resume repeats the idempotent fetch; an attempt with no launch step ran nothing and does not use the retry; a prelude failure is a failed `resume:reconcile` step and `resume --wait` exits 70.
  - 02-19/02-20/02-22: the live suite and the exit run show that a whole run reaches `ready_for_review`; evidence files are not to be quoted.
  - D-01 clone; D-02 hand-off fetch; D-03 supervisor commits; D-04 base pin and staleness refusal; D-16 conventions read from a descendant commit; D-17 quick-task artifacts kept off the review branch; D-18 `start` detaches, `--wait` blocks. State the behavior, never the ID.
- claims to recheck: none in an existing document (the document is new). Check these existing claims elsewhere that this document will own: onboarding.md "Resume, reconcile and reaping" covers onboarding only; do not repeat it, link to it. Existing seam to settle: onboarding.md:115 says the worktree adapter is dormant; a run uses a clone adapter, not the worktree one (check that the clone adapters are not the same module as the onboarding staging clone).
- proposal counterparts (for code-versus-proposal findings and the README counterparts table): docs/contracts-and-state.md "Run state machine" (worktree, pushBranch, example contract), "Run contract", "The routine preset in Phase 2"; docs/containment.md run-purpose matrix rows; docs/extensions.md section 2b and the Phase 2 command table; docs/autonomy-and-decisions.md (decision record only, partly); docs/decisions/ADR-006-unattended-delegation.md (proposed; the implementation note).
- denominators it reports: run lifecycle states and transitions 11 and 37 (command: `node --input-type=module -e` importing `src/domain/run-lifecycle.ts`, `RUN_STATES.length`, `RUN_TRANSITIONS.length`); blocked reasons 7; step statuses 6; work item states 6.
- cross-links: onboarding.md (resume, lease, stage loop, budgets), containment.md (scope, hook, executor, git safety), checks-and-evidence.md (install, baseline, checks, gates G2 and G4), data-model.md (tables, events), cli-reference.md (start, supervise, resume, status, inbox), config-reference.md (presets, constants, conventions keys), integrations.md (run ports), processes.md (the three flows).
- must not cover: the install, validation, baseline, required checks, inventory, evidence statuses and the gate rules (checks-and-evidence owns them; runs says where in the stage order they run and what a failure does to the run); table columns and event payloads (data-model); flags and exit codes beyond a pointer (cli-reference); the hook rule list and the Seatbelt profile (containment); the shell (interactive-shell).

## Packet: checks-and-evidence

- target: docs/system/checks-and-evidence.md, change new; kind: descriptive
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/adapters/exec/allowlist-proxy.ts
code: src/adapters/git/run-workspace.ts
code: src/app/check-validation.ts
code: src/app/checks.ts
code: src/app/run-stages/finish.ts
code: src/app/run-stages/item.ts
code: src/app/run-stages/prepare.ts
code: src/domain/conventions.ts
code: src/domain/evidence.ts
code: src/domain/gates.ts
code: src/domain/test-inventory.ts

- owns: the dependency install (supervisor step, registry-only network through the proxy, install scripts off); validation of each declared check (verdicts, cache key, `unavailable` never cached); the baseline and its first attempt; required checks and their phases (base, item, final) and the `preExisting` flag; the test inventory and its skip and focus markers; evidence statuses, revisions and the acceptance mapping; gates G2 (rules, staged evaluation) and G4 (rules); the baseline delta; the check output as an artifact.
- summary notes:
  - 02-05: `EVIDENCE_STATUSES`, `evidenceStatusOf`, `revisionOf`, `baselineDelta` (D-12), `mapAcceptance`; `SKIP_FOCUS_MARKERS`, `scanMarkers`, `compareInventories`; `G2_RULES`, `G4_RULES`, `evaluateG2`, `evaluateG4`.
  - 02-06: A1 confirmed: `npm ci` works through the loopback CONNECT proxy under the Seatbelt profile (the proxy itself belongs to containment; this document says what the install step records: lockfile digest, exit, duration, the proxy's attempts by host).
  - 02-13: `runRequiredChecks` runs sandboxed checks, one evidence row each, output stored as a `check-output` artifact; G2 stops a failing required check before the commit; a checks-delta-only G2 failure is class repeated_failure with the failing evidence IDs; scope, acceptance and deletion failures are enforcement_failure with a `containment.finding` naming the paths.
  - 02-14: `validateChecks` (ONB-10); verdicts cached per project, pin, check name and the digest of that one check's spec; `unavailable` never cached; the baseline opens the run's first attempt and the unit adopts it while it has not started; G2 evaluates in stages (other rules, then inventory, then required checks) so the repository's list command and checks run only for a unit that passes everything before; if the proxy cannot start during validation the check runs with no network and detection narrows to the sandbox's error text; a check that targets a failing-at-pin check stops at G2 `checks-delta` (target-not-passed); evidence kinds `test-inventory` and `diff`; event `check.validated`.
  - 02-21: the test inventory command may write the cache paths the declared checks name (Rule 1 fix from the dry run).
  - D-11 supervisor dependency install with registry-only network; D-12 baseline and delta.
- claims to recheck: containment.md says the dependency install is "a supervisor step, not an invocation"; make sure this document and containment.md agree on which carries the proxy detail (containment owns the proxy, this document owns the step).
- proposal counterparts: docs/contracts-and-state.md (gates G0 to G4, evidence, "Run state machine"); docs/requirements.md ONB-10, AUT-8; docs/operations-and-testing.md (partly).
- denominators it reports: evidence statuses (count from `EVIDENCE_STATUSES.length`, import `src/domain/evidence.ts`); G2 rules and G4 rules (`G2_RULES.length`, `G4_RULES.length`, import `src/domain/gates.ts`); skip and focus markers (`SKIP_FOCUS_MARKERS.length`, import `src/domain/test-inventory.ts`). Each as `N of M` with that command.
- cross-links: runs.md (stage order, what a failure does), containment.md (executor, proxy), data-model.md (evidence, gate_results, check_validations, artifacts), config-reference.md (conventions keys).
- must not cover: the run lifecycle and the stage order (runs); the Seatbelt profile and the proxy internals (containment); the conventions file key list (config-reference; say what the checks section means for validation only).

## Packet: interactive-shell

- target: docs/system/interactive-shell.md, change new; kind: descriptive (named after the interactive-shell ADR it implements)
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/adapters/sqlite/ledger.ts
code: src/cli/main.ts
code: src/cli/render/run-view.ts
code: src/cli/render/status-view.ts
code: src/cli/render/style.ts
code: src/cli/render/table.ts
code: src/cli/shell/actions.ts
code: src/cli/shell/history.ts
code: src/cli/shell/home-view.ts
code: src/cli/shell/line-editor.ts
code: src/cli/shell/shell.ts

- owns: when the shell opens (bare `avarice`, both streams terminals, `AVARICE_RUN` unset; otherwise the usage text and exit 64), what it shows (home and watch views), its actions over the existing commands, line editing and completion, command history (file, mode, cap), the refusal inside a run, how it reads run events (`listRunEvents`, read-only), and that it renders through the same functions as the one-shot commands.
- summary notes:
  - 02-19: `runShell` is the session engine over raw keys or whole lines; `renderHome`, `renderWatch`; `LineEditor` with `completeCommand`; `loadHistory`, `appendHistory`; `SHELL_ACTIONS`; the shell module loads only on the no-argument path so no one-shot command pays for it; `{dataRoot}/shell-history`: 0600, one entry per command-line run, capped at 1000 lines; `Ledger.listRunEvents(runId, limit)` returns the latest events of a run read-only, oldest first.
  - 02-02: the OPS-7 renderers (`resultLine`, `stateWord`, `errorLine`, `usd`, `duration`, `localTime`, `colourEnabled`, `stripControl`, `renderTable`, `terminalWidth`, `renderStatus`); colour only on a terminal with `NO_COLOR` unset and `TERM` not `dumb`.
- claims to recheck: cli-reference.md has a dispatch row "`avarice` with no words ... exit 64" and findings.md has `src/cli/main.ts:35` ("no-argument shell not implemented"). The code now opens the shell on a terminal (`src/cli/main.ts:55`); the exit-64 path remains for non-terminals and inside a run. Confirm both and put the exact conditions in this document.
- proposal counterparts: docs/decisions/ADR-013-interactive-shell.md (decision text; requirement FR-27); docs/extensions.md entry 2j and the "Human-readable output" rules; docs/requirements.md OPS-7.
- denominators it reports: shell actions (`SHELL_ACTIONS.length`, import `src/cli/shell/actions.ts`); history cap 1000 lines (constant in `src/cli/shell/history.ts`).
- cross-links: cli-reference.md (the commands the actions run, output forms), runs.md (what the watch view shows), config-reference.md (`AVARICE_RUN`, `NO_COLOR`, `TERM`, history file), data-model.md (files on disk).
- must not cover: the command flags and exit codes (cli-reference); the run lifecycle (runs).

## Packet: cli-reference

- target: docs/system/cli-reference.md, change update; kind: reference (exhaustive)
- skills: technical-writing, documenting-legacy-codebases, documenting-contracts
- code:

code: src/adapters/host-claude/avarice-run-skill.ts
code: src/adapters/host-claude/skill-install.ts
code: src/app/run-start.ts
code: src/app/run-status.ts
code: src/app/status.ts
code: src/cli/args.ts
code: src/cli/commands/inbox.ts
code: src/cli/commands/init.ts
code: src/cli/commands/install-host.ts
code: src/cli/commands/onboard.ts
code: src/cli/commands/repo.ts
code: src/cli/commands/resume.ts
code: src/cli/commands/start.ts
code: src/cli/commands/status.ts
code: src/cli/commands/supervise.ts
code: src/cli/composition.ts
code: src/cli/main.ts
code: src/cli/render/run-view.ts
code: src/cli/render/status-view.ts
code: src/cli/render/style.ts
code: src/cli/render/table.ts
code: src/cli/spawn-supervisor.ts

- owns: every command line, flag, exit code and output form. The command list is now ten: init, repo, onboard, start, supervise, status, inbox, resume, context, install-host, plus bare `avarice`. Both output forms of each command (text and `--json`), including the optional `runs` key of `status --json`, the `inbox --json` shape and the `start --wait` result lines.
- summary notes:
  - 02-02: Phase 1 `--json` shapes are pinned by committed snapshots; init, repo, status and the dispatcher's errors print in the OPS-7 style (result line, error line, state words, control characters stripped).
  - 02-10: `avarice start --brief <file> --policy routine [--project <id>] [--budget name=value]... [--wait]`; the six refusal codes and their exit 3; usage errors 64.
  - 02-12: `start` returns after the detached spawn; `--wait` blocks and exits 0 at `ready_for_review` and 3 otherwise; a missing or relative entry refuses the spawn (exit 70 with the run stored in `contract_ready`); `avarice supervise <runId>` (started by `start`, or by hand).
  - 02-15: `avarice inbox [--json]`; `avarice install-host [--config-dir]` (flag over `CLAUDE_CONFIG_DIR` over `~/.claude`; refuses a symlink anywhere below the configuration directory, a SKILL.md without the marker line, and refuses inside a run); `status` prints runs of every project, interrupted first then blocked; `status --json` carries one optional `runs` array as the last key of a project entry and a project with no run has no `runs` key (D-19).
  - 02-17: `avarice resume <run_id> [--wait]`; `onb_` IDs keep the Phase 1 path; `resume --wait` turns a prelude failure into exit 70.
  - 02-19: no-argument dispatch opens the shell on a terminal (interactive-shell owns the detail; this document states the dispatch conditions and exit 64 for the rest).
- claims to recheck (quote and verify against the code):
  - line 3: "six commands" (now ten).
  - line 22 dispatch table row: "`avarice` with no words | `avarice: no command given` plus usage text on stderr | 64" (a terminal now opens the shell unless `AVARICE_RUN` is set; `src/cli/main.ts:55-62`).
  - line 9: "Only `status` and `context` have a `--json` form" (`inbox` also; check every command's `booleanFlags`).
  - line 10: "Only `onboard` and `resume` take a lease and run stages" (the supervisor takes the run lease; `supervise` and run `resume` too).
  - line 11: "The CLI code opens no network connection" (the detached supervisor starts an in-process proxy for the install step; check what the CLI layer itself opens).
  - line 41: "Only `status` and `context` declare `--json` as boolean. On the other commands `--json` is an unknown flag".
  - line 60 exit-code table: the "Used by" column (3 is now used by start, supervise, resume for runs; 75 is not a CLI exit).
  - Section "Order of checks and profile side effects" and the Quirks section: recheck each against the new commands.
  - Seams from the runs grounder (copied in by Task 3): none recorded yet.
- proposal counterparts: docs/requirements.md (FR commands, OPS-7); docs/extensions.md section 1 and the Phase 2 command table (`docs/extensions.md:56`, exit-code summary `docs/extensions.md:35`, which still lacks exit 3); docs/decisions/ADR-013-interactive-shell.md.
- denominators it reports: CLI commands 10 of 10 (`grep -n "COMMANDS =" src/cli/main.ts`); every flag; every exit code (0, 1?, 3, 64, 70; derive from the code, not from this line); both output forms.
- cross-links: runs.md (what each run command does to a run), interactive-shell.md, config-reference.md, onboarding.md.
- must not cover: the run lifecycle and stages (runs); the shell's keys and views (interactive-shell); constants and environment variables beyond a pointer (config-reference).

## Packet: config-reference

- target: docs/system/config-reference.md, change update; kind: reference (exhaustive)
- skills: technical-writing, documenting-legacy-codebases, documenting-contracts
- code:

code: src/adapters/exec/allowlist-proxy.ts
code: src/adapters/git/run-workspace.ts
code: src/adapters/git/safe-git.ts
code: src/adapters/gsd/agents-json.ts
code: src/adapters/host-claude/avarice-run-skill.ts
code: src/adapters/host-claude/env.ts
code: src/app/budget.ts
code: src/app/check-validation.ts
code: src/app/checks.ts
code: src/app/onboarding-service.ts
code: src/app/run-gsd-config.ts
code: src/app/run-service.ts
code: src/cli/commands/install-host.ts
code: src/cli/composition.ts
code: src/cli/main.ts
code: src/cli/render/style.ts
code: src/cli/shell/history.ts
code: src/cli/shell/shell.ts
code: src/cli/spawn-supervisor.ts
code: src/domain/conventions.ts
code: src/domain/run-contract.ts
code: src/domain/run-preflight.ts

- owns: every environment variable the code reads or sets (including the run environment and the proxy variables the install step sets), every `.avarice/config.json` schema 1 key (the repository conventions file: checks, environment, agent commands, and whatever else `parseConventions` accepts), every built-in run limit (the routine preset's budgets and policy, loop limits, escalation values, staleness limits, brief size cap, run prompt cap, proxy and timeout constants, lease constants, history cap), dead knobs marked dead.
- summary notes:
  - 02-04: `ROUTINE_PRESET`, `ROUTINE_POLICY`, `BUDGET_OVERRIDE_NAMES`, `RESERVED_CHECK_ENV`, `REFUSED_AGENT_COMMAND_WORDS`, `RESERVED_ENV_PREFIXES` (`DYLD_`, `LD_`, `npm_config_`).
  - 02-08: run environment `AVARICE_RUN`, `TMPDIR`, `npm_config_cache` in realpath form; `RUN_GSD_SETTINGS` reduced to seven pairs (02-09); `RUN_PROMPT_MAX_BYTES`.
  - 02-10: `STALENESS_LIMITS` 25 commits and 14 days; `BRIEF_MAX_BYTES`.
  - 02-11: `ROUTINE_PRESET.escalation.consecutiveSearches` = 25; `consecutiveDenials` 3 (check).
  - 02-12: lease renewal every TTL/3; `AVARICE_LEASE_TTL_MS` is now shared with the run supervisor (`leaseTtlMs`); `NODE_TEST_CONTEXT` is removed from the supervisor's environment.
  - 02-07: `AVARICE_COMMIT_IDENTITY` is a constant (name AVARICE, email avarice@localhost.invalid), not an environment variable. The same holds for `AVARICE_EXECUTOR_ADDENDUM` and `AVARICE_RUN_SKILL`.
  - 02-02/02-19: `NO_COLOR` and `TERM` are read (style.ts, shell.ts).
  - 02-15: `CLAUDE_CONFIG_DIR` read by install-host.
  - D-13 routine budgets; D-14 the default model size.
- claims to recheck:
  - line 7: "AVARICE reads 8 `AVARICE_*` variables and sets 1 (`AVARICE_RUN`) ... It reads 8 other variables" (names at plan base: 15 `AVARICE_*` names, 8 read as before plus `AVARICE_RUN` read at `src/cli/main.ts:58`, `src/cli/shell/shell.ts:532`, `src/cli/commands/install-host.ts:25` and set at `src/adapters/host-claude/env.ts:44`, plus 6 constants; other variables read now include `NO_COLOR` and `TERM`).
  - line 37: "`AVARICE_RUN` is only set; nothing in the shipped source reads it back" (false now).
  - line 47: the claude host environment row.
  - section "Command-line flags that configure a run" (onboarding flags only; `start` has `--brief`, `--policy`, `--project`, `--budget`, `--wait`).
  - section "Built-in constants": the budgets cover the onboarding preset only; add the routine preset.
  - section "Profile config file": confirm unchanged (`src/adapters/fs/profile-paths.ts` is not in the diff).
- proposal counterparts: docs/contracts-and-state.md "The `routine` preset in Phase 2" (`docs/contracts-and-state.md:198`) and its preset table (not re-read against the code; the pass does that); docs/requirements.md (config requirements, partly).
- denominators it reports: `AVARICE_*` names 15 (8 read, 1 read and set, 6 constants; `git grep -ohE "AVARICE_[A-Z0-9_]+" -- src bin | sort -u`, classified by reading each site); other variables read (the 8 of the ledger plus `NO_COLOR` and `TERM`, to be confirmed; the command is `git grep -nE "process[.]env|env[[]" -- src bin` plus the passthrough lists in the GSD, graphify and host adapters; a plain `env\[` pattern is refused by this harness' secret read guard, so use that form); profile config keys 4 (dead, unchanged); budgets in the routine preset.
- cross-links: cli-reference.md, runs.md (what the limits do), containment.md (the environment scrub), checks-and-evidence.md.
- must not cover: what a command does (cli-reference); lifecycle (runs).

## Packet: containment

- target: docs/system/containment.md, change update; kind: descriptive
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/adapters/exec/allowlist-proxy.ts
code: src/adapters/exec/sandboxed-executor.ts
code: src/adapters/exec/seatbelt-profile.ts
code: src/adapters/git/run-workspace.ts
code: src/adapters/git/safe-git.ts
code: src/adapters/gsd/agents-json.ts
code: src/adapters/host-claude/claude-host.ts
code: src/adapters/host-claude/env.ts
code: src/adapters/host-claude/hook-policy.ts
code: src/adapters/host-claude/launch-preflight.ts
code: src/adapters/host-claude/settings.ts
code: src/app/budget.ts
code: src/app/checks.ts
code: src/app/invocation.ts
code: src/app/run-gsd-config.ts
code: src/app/run-stages/prepare.ts
code: src/domain/gates.ts
code: src/domain/hook-decision.ts
code: src/domain/invocation-scope.ts
code: src/hook/pre-tool-use.ts
code: src/ports/command-executor.ts

- owns: scope, generated settings, environment, hook rules, the executor, the proxy, git safety. For runs: the run purpose's write, read and command scope (globs, protected paths, command identity); generated run settings (file-level Edit rules, scratch rules, denied tools, `allowWrite`); the run environment; the hook's read-before-edit digest rule and loop limits (`continue: false`, `loop.limit` event); rules `protected-path`, `agent-command`, `no-human-prompts`, `background-shell`, `edit-without-read`, `file-changed-since-read`, `ineffective-search`; the sandboxed executor's loopback-only ports and the allowlisting proxy; the supervisor-step registry exception (the one place a process gets network access); the rule that every run sandbox denies the default AVARICE parents (data, config, work) and re-allows the run's clone and scratch (02-20); git safety for the supervisor commit and the hand-off (option allowlists, no forced refspec, literal pathspecs, fixed commit identity, `--no-verify`, `--no-gpg-sign`); detect-only limits (G2 detects a new shell-written entry at an unlisted clone location; the run's hook and settings are generated but the hook's launch-time re-verification is the preflight's job); the admitted host versions now four (2.1.312, 2.1.316, 2.1.317, 2.1.318).
- summary notes:
  - 02-06: `CommandSpec.allowLoopbackPorts` yields one allow line per validated loopback port after `(deny network*)`; the proxy is node:http and node:net only, binds loopback, admits one registry host and port and answers 403 for any other and records the attempt; it runs in AVARICE's own process outside the sandbox; DNS for the registry name is trusted; the footprint test exempts exactly one source file.
  - 02-07: run git adapters; option allowlists for fetch and commit; no forced refspec.
  - 02-08: `computeRunScope`; run purpose hook rules; no human prompts (`AskUserQuestion` denied by host and hook); no background shell; `blanket-bash-hook-identity` command strategy (a contract command that chains, redirects, substitutes or starts with git, avarice, claude, gh, curl, wget, ssh, scp or sudo is dropped); the run's invocation environment carries no proxy variable.
  - 02-09 (spike S2-B): the host outcome is `denied` in most rounds because of improvised compound lines (5 to 7 denials per unit).
  - 02-11: read-before-edit (rules edit-without-read and file-changed-since-read; digests written by the hook into `hook_reads` at PostToolUse inside `BEGIN IMMEDIATE`); loop limits (3 consecutive denials, 25 consecutive searches); the hook answers `continue: false` with a stop reason.
  - 02-18 (spike S2-D): the measured minimal write set under a clone's `.git` for an in-sandbox commit; D-03 unchanged (the supervisor commits).
  - 02-20: live run-purpose suite; the other-profile-root limit (roots placed outside the default parents are not covered); `prepareRunInvocation` creates the host's `TMPDIR` and npm cache; `defaultAvariceParents`, `allowReadPaths` on `CommandSpec` and in the Seatbelt profile.
  - 02-21: the Seatbelt profile gives back the metadata of the directories above a re-allowed path.
- claims to recheck:
  - "the sandboxed executor denies all network" (now: all network except the loopback ports a supervisor step names).
  - the purposes list (a fourth purpose, `run`, exists) and the read rules ("no read-before-edit"; now present for the run purpose).
  - the git safety section (the supervisor commit and the hand-off).
  - `docs/system/findings.md` line for `docs/containment.md:151` (read-before-edit "not implemented"): now implemented for runs at `src/domain/hook-decision.ts:626`.
  - findings line for `docs/containment.md:122` (spec executor): still true; the executor is `/usr/bin/sandbox-exec`; the network rule changed.
  - launch checks: admitted versions list; the "refuses an unadmitted host" wording.
- proposal counterparts: docs/containment.md (matrix rows, "Generated host settings" example, run-purpose rows); docs/extensions.md section 2 "PreToolUse checks" (`docs/extensions.md:71`).
- denominators it reports: hook rules (allow and deny): the ledger's 5 allow and 21 deny at the old pin cannot be reproduced by any command it names; the packet's grounder must define a command that lists every rule id of the decision module and the hook entry, count at HEAD, and say so in its coverage file; read-only commands, denied prefixes, denied find actions, GSD verbs (11, 16, 10, 14 at the old pin; recount); required settings keys 9; admitted host versions 4; budgets (onboarding 5; add the run budgets).
- cross-links: runs.md (the supervisor's use of these controls), checks-and-evidence.md (the install step), config-reference.md (environment), integrations.md, data-model.md (`hook_reads`, events).
- must not cover: the stage order and lifecycle (runs); the checks pipeline (checks-and-evidence); table layouts (data-model).

## Packet: data-model

- target: docs/system/data-model.md, change update; kind: reference with descriptive parts
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/adapters/sqlite/ledger.ts
code: src/adapters/sqlite/migrations/0002-run.ts
code: src/app/checks.ts
code: src/app/run-stages/blocked.ts
code: src/app/run-stages/finish.ts
code: src/app/run-start.ts
code: src/cli/composition.ts
code: src/cli/shell/history.ts
code: src/domain/ids.ts
code: src/domain/run-lifecycle.ts
code: src/hook/pre-tool-use.ts
code: src/ports/ledger.ts

- owns: migrations (now two; 0002 adds columns `reason`, `workspace_path`, `branch`, `base_revision` to `runs`, tables `run_steps`, `hook_reads`, `check_validations`, indexes `evidence_attempt` and `events_run`, insert-only triggers on `evidence` and `gate_results`); every table (23 at the plan base) and which have a writer; every event kind (26 at the plan base); the artifact kinds (add `gsd-quick-record`, `check-output`, `test-inventory`); files on disk (the run's invocation directory `{dataRoot}/run/{runId}/run-{inv}/`, the contract file `contract-v<n>.json`, `{dataRoot}/shell-history`); ID prefixes (`ev_`, `dec_` added); the run ledger methods in gist; the run lease and fence.
- summary notes:
  - 02-03: migration 0002 forward-only, checksummed, VACUUM INTO backup before it applies to a store with history; 29 run methods on the Ledger port; runs, leases with fence, checkpoints, contracts with budgets, steps, attempts, evidence, gate results, work items, decisions, check validations, hook reads.
  - 02-10: `Ledger.createRunWithContract` stores run, contract version 1, budget rows, work items and events in one transaction.
  - 02-11: `hook_reads` is written by the hook with its own SQL; event `loop.limit`; `Ledger.findLoopLimit` (02-16).
  - 02-13: events `check.finished`, `handoff.fetched`, `containment.finding` for runs; run steps `context:pack`, `snapshot`, `classify`, `commit`, `handoff:fetch`, `gsd:inspect`, `gsd:configure`; gate rows G0, G2, G4.
  - 02-14: evidence kinds `test-inventory` and `diff`; the `preExisting` environment flag; event `check.validated`; run steps `deps:install`, `checks:validate`, `baseline`.
  - 02-12: run steps `supervisor:spawn` and `workspace:prepare`; 02-17: `supervisor:resume`, `resume:reconcile`; events `invocation.reconciled`, `invocation.orphan-charged`, `verification.interrupted`.
- claims to recheck:
  - "one migration" and the schema version.
  - "Run-shaped tables used by onboarding" (the run tables now have run writers).
  - the "Tables with no writer" list: at the plan base, by `INSERT` search, only `task_refs` and `approvals` have no writer (evidence, gate_results, decisions and work_items now do).
  - "12 event kinds": the broad `type: '<prefix>.<name>'` literal search finds 26 event kinds at the plan base (28 literals; `command` and `implement` are not events). Check for events whose type is computed, not a literal.
  - findings lines `src/adapters/sqlite/ledger.ts:409` (carrier row) and `src/adapters/sqlite/migrations/0001-initial.ts:5` (six tables with no writer).
  - the Quirks section.
- proposal counterparts: docs/contracts-and-state.md "Persisted entities" (`docs/contracts-and-state.md:738`), "Run state machine", "Decision records", "Budget accounting".
- denominators it reports: tables 23 (`git grep "CREATE TABLE" -- src`, 20 + 3), 21 with a writer and 2 without; event kinds 26; artifact kinds (recount); schema migrations 2; run lifecycle states and transitions 11 and 37.
- cross-links: runs.md, checks-and-evidence.md, containment.md (hook), interactive-shell.md.
- must not cover: lifecycle behavior (runs); evidence semantics (checks-and-evidence).

## Packet: integrations

- target: docs/system/integrations.md, change update; kind: reference with descriptive parts
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/adapters/exec/allowlist-proxy.ts
code: src/adapters/exec/sandboxed-executor.ts
code: src/adapters/exec/seatbelt-profile.ts
code: src/adapters/git/run-source.ts
code: src/adapters/git/run-workspace.ts
code: src/adapters/git/safe-git.ts
code: src/adapters/git/staging-base.ts
code: src/adapters/git/staging-clone.ts
code: src/adapters/host-claude/avarice-run-skill.ts
code: src/adapters/host-claude/claude-host.ts
code: src/adapters/host-claude/launch-preflight.ts
code: src/adapters/host-claude/skill-install.ts
code: src/app/deps.ts
code: src/cli/composition.ts
code: src/ports/agent-host.ts
code: src/ports/command-executor.ts
code: src/ports/egress-proxy.ts
code: src/ports/ledger.ts
code: src/ports/run-source.ts
code: src/ports/run-workspace.ts

- owns: every port, adapter and external system the run touches, with direction and failure behavior: the three new ports (`EgressProxy`, `RunSource`, `RunWorkspace`) and their adapters, the executor port's new fields, the agent host port's run owner fields, the git section (run clone, supervisor commit, fetch into the source repository), the package registry (reached only through the allowlist proxy during the install step), the Claude configuration directory (written by install-host), the detached supervisor (a child of the CLI), the admitted host versions.
- summary notes: 02-06 (proxy, loopback allow), 02-07 (run adapters, option allowlists, `scripts/checkout-digest.ts` allows run refs), 02-08 (owner-aware host), 02-10 (`AppDeps.runSource`, `runWorkspace`, `egress`, composed in `createDeps`), 02-15 (install-host writes `<claude config dir>/skills/avarice-run/SKILL.md`; adapter config row `host-skill:avarice-run`).
- claims to recheck: "8 ports" (the plan base lists 11 port files plus one shared descriptor, `ls src/ports`); the external systems list ("10 (9 used, `gh` proven unused)"; add the registry traffic through the proxy and the Claude configuration directory; spawn sites at the plan base: sandbox-exec, git, claude, gsd-tools, graphify, pgrep, ps, mount, plus a detached self-spawn of node for the supervisor); the git section (the hand-off creates one run branch ref in the source repository, so "never writes the user's repository" no longer holds); `gh` still unused (`git grep -nE "'gh'" -- src` to confirm); findings `src/cli/composition.ts:23` (`findGraphifyBinary` unused) re-check.
- proposal counterparts: docs/existing-tooling-assessment.md (`:76` gh, `:24` host versions); docs/architecture.md (ports, partly).
- denominators it reports: ports 11 plus one shared descriptor (`ls src/ports`); external systems (recount with `git grep -nE "spawn|execFile|execSync" -- src bin`, classified by reading each site).
- cross-links: runs.md, containment.md, checks-and-evidence.md, config-reference.md.
- must not cover: control semantics (containment); lifecycle (runs).

## Packet: overview

- target: docs/system/overview.md, change update; kind: descriptive
- skills: technical-writing, documenting-legacy-codebases
- code:

code: src/app/deps.ts
code: src/cli/composition.ts
code: src/cli/main.ts

- owns: the system boundary and the import map: from `node scripts/check-boundaries.ts` (79 files, ok, at the plan base) and the composition root. The unattended run as a second slice beside onboarding.
- summary notes: 02-12 (the supervisor's spawn lives in `src/cli` and is held to its own rules by the footprint test), 02-06 (one source file may use node:http and node:net), 02-10 (the three run ports composed in `createDeps`).
- claims to recheck (quote each): line 7 "onboards one existing git repository to an active project record ... and never contacts a n[etwork service itself]"; line 13 the boundary table row "The `avarice` CLI and its six commands"; "The user's own repository is not written" (the hand-off fetch now creates one run branch ref in the source repository); the layer table and the import rule counts (run `node scripts/check-boundaries.ts`; read the lint's own rules for the new exemptions).
- proposal counterparts: docs/architecture.md; docs/decisions/ADR-004-modular-monolith-and-ports.md.
- denominators it reports: import-boundary lint passes (79 files); ports 11 plus one shared descriptor.
- cross-links: every leaf document, in the "Where to read next" section (add runs.md, checks-and-evidence.md, interactive-shell.md).
- must not cover: mechanisms (the leaf documents).

## Packet: processes

- target: docs/system/processes.md, change update; kind: process
- skills: technical-writing, documenting-legacy-codebases, diagramming-processes
- code:

code: src/app/run-resume.ts
code: src/app/run-service.ts
code: src/app/run-stages/discard.ts
code: src/app/run-stages/finish.ts
code: src/app/run-stages/item.ts
code: src/app/run-stages/prepare.ts
code: src/app/run-start.ts
code: src/cli/spawn-supervisor.ts

- owns: three new traced flows, each end to end through the code (CLI, services, ports, ledger writes, files), with its PlantUML source and one diagram index row each: (1) a start that reaches ready for review, `docs/system/diagrams/run-to-ready.puml`; (2) a kill during the item invocation, then resume, `docs/system/diagrams/run-resume-after-kill.puml`; (3) a crashed invocation discarded and retried once, `docs/system/diagrams/run-discard-retry.puml`. The two existing flows (onboard, kill-then-resume) stay; recheck them against the changed shared modules.
- summary notes: use the runs packet's notes (02-12, 02-13, 02-16, 02-17). The runs document is landed in the tree before this grounder starts; link to it as the leaf. Kill points: 24 run kill points (`RUN_KILL_POINTS` in `test/helpers/fault-run.ts`); the mid-handoff point sits between fetch and record.
- claims to recheck: the "Things to look out for at the hand-offs" section and the diagram index (two rows now; five after); the existing diagrams are "not rendered" (coverage.md "Outstanding"; no render step exists).
- proposal counterparts: docs/operations-and-testing.md (partly).
- denominators it reports: flows traced 5 (2 existing, 3 new); diagram sources 5.
- cross-links: runs.md, checks-and-evidence.md, containment.md, data-model.md.
- must not cover: mechanisms beyond the trace (the leaf documents own them; a flow step points to the leaf).

## Packet: history

- target: docs/system/history.md, change update; kind: historical
- skills: technical-writing, documenting-legacy-codebases
- code: none (the document is written from `git log --format='%h %ad %s' --date=short e725db6..HEAD`; 112 commits, 71 dated 2026-11-05 and 41 dated 2026-11-06 at the plan base)
- owns: dated entries for the run slice, citing commit hashes; no phase numbers, plan IDs, decision IDs or spike IDs in the prose. The existing entries stay.
- summary notes: the commits fall into: run kernel (migration, lifecycle, contract compiler, gates and evidence); containment for runs (loopback profile and proxy, run scope, read-before-edit, loop limits); the supervisor, stages, discard, resume; the status, inbox and install-host surfaces and the shell; the containment matrix and its documents; the live suite; the exit run.
- claims to recheck: the Summary section; the last entry "2026-11-05: review fixes and phase close".
- proposal counterparts: none.
- denominators it reports: commits in range 112 (`git log --oneline e725db6..HEAD | wc -l`; the range grows by this pass's own commits; the document names its end commit).
- cross-links: runs.md and the other new documents.
- must not cover: behavior (the leaf documents).

## Packet: readme

- target: docs/system/README.md, change update (executor edits; no grounder); kind: index
- code: none
- owns: the opening sentence (the tree covers the unattended run as well as onboarding), the documents table (add runs.md, checks-and-evidence.md, interactive-shell.md; update the processes row to say five flows), the proposal counterparts table.
- claims to recheck: line 3 "the onboarding of one existing repository to an active project record"; counterparts table rows: autonomy-and-decisions.md ("none yet", runs.md covers its decision record partly), extensions.md ("none yet"; cli-reference.md, interactive-shell.md and runs.md cover part), contracts-and-state.md (add runs.md, checks-and-evidence.md), containment.md (unchanged target), requirements.md, operations-and-testing.md. Decision ADR-013 maps to interactive-shell.md; ADR-006 maps to runs.md (the proposal is still Proposed).
- cross-links: every document.

## Packet: onboarding

- target: docs/system/onboarding.md, change update (executor edits from code evidence; a reviewer reads it afterwards); kind: descriptive
- code:

code: src/adapters/git/staging-base.ts
code: src/adapters/git/staging-clone.ts
code: src/app/budget.ts
code: src/app/invocation.ts
code: src/app/onboarding-service.ts
code: src/domain/outcome.ts

- claims to recheck: line 43 "`paused` is entered only by the resume prelude ... the outcome classifier never produces it" (the classifier now returns `paused` only when a caller passes `pauseSignal`; no onboarding stage does, so the claim holds in substance but its wording must say so; `src/app/stages/map.ts:107` still has the branch); line 111 and 115 (staging is a local clone; the worktree adapter is dormant; confirm after the staging helpers became shared); the budget and invocation sections (`src/app/budget.ts` and `invocation.ts` were extracted into shared cores; confirm no behavior change); "Resume, reconcile and reaping" (line 207) is onboarding only (the run resume lives in runs.md; add a one-line pointer if the section implies it covers every owner).
- cross-links: runs.md (the run resume and the shared budget core).

## Built decisions

Each decision with built behavior maps to the packet that states the behavior. The documents state the behavior and never the decision ID.

| Decision | Behavior | Packet |
|---|---|---|
| D-01 | A run works in a local clone of the source repository, not a worktree | runs (workspace), integrations (git), containment (what the run may write) |
| D-02 | The hand-off is a fetch into the source repository that creates one run branch ref; the user's checkout is untouched | runs, integrations, overview (the boundary claim) |
| D-03 | The supervisor commits after the gates pass; the model never runs `git add` or `git commit`; the commit carries Avarice-Run and Avarice-Attempt trailers | runs, containment (git safety) |
| D-04 | The base revision is the onboarded pin; `start` refuses a stale pin (25 commits or 14 days) and other cases with six codes | runs, config-reference (limits) |
| D-11 | The supervisor installs dependencies with `npm ci --ignore-scripts` through the allowlist proxy, registry host only | checks-and-evidence, containment (the exception), integrations |
| D-12 | Baseline and delta: a check that failed at the pin is `preExisting`; G2 holds the delta, G4 is the independent final proof | checks-and-evidence |
| D-13 | Routine preset budgets (invocations, cost, wall clock, subagents, tool calls) which a brief may only lower | config-reference, runs |
| D-14 | The default model size of a work item | config-reference (the preset and brief fields), runs |
| D-16 | Conventions are read from a descendant commit of the pin, not the working tree | runs, config-reference (the file) |
| D-17 | Quick-task artifacts are restored or removed so the review branch holds only the work | runs |
| D-18 | `start` detaches the supervisor; `--wait` blocks until a stop state | runs, cli-reference |
| D-19 | `status --json` gains one optional `runs` key, always last, absent when a project has no run | cli-reference, runs |

D-05 to D-10 and D-15 concern the exit target, its checks and the spend ceiling; they leave no system behavior to document. D-15's ceiling guard exists only in test and script code (`scripts/exit-run-phase2-tools.ts`, exit 75 there), which is outside `src` and `bin`.

## Findings candidates

Each item of "Inputs collected for this pass" was re-checked at the plan base. Format: candidate, `file:line`, verdict.

Doc drift from the containment-matrix plan. The proposal documents are not edited; each item that holds becomes one findings line.

1. `docs/containment.md:3`: the status line says the onboarding of one existing repository is built and says nothing about runs. Holds.
2. `docs/containment.md:115`: the row "Pre-existing user changes survive" says "a dedicated worktree on a new branch"; runs use a local clone (`src/adapters/git/run-workspace.ts`). Holds.
3. `docs/containment.md:110`, `:111` and `:114`: the rows "Only contract endpoints reachable", "No privileged external effects" and "Retrieval scope and cost" name no `test/...` file, so `test/unit/containment-matrix.test.ts` passes them vacuously. Holds in part: the other three of the six listed by the matrix plan (`:112` Run cannot change its policy, `:113` Budget limits, `:115` Pre-existing user changes survive) now name a test file (a later plan edited them). Row `:115` still describes a worktree (item 2).
4. `docs/containment.md:59` to `:80`: the "Generated host settings" example JSON has `Read(//<worktree>/**)` and `Edit(//<worktree>/...)` placeholders, a `denyWrite` entry for `.git/hooks`, and a git allow rule; the generated settings name realpath clone paths and the supervisor commits (`src/adapters/host-claude/settings.ts`). Holds.
5. `docs/contracts-and-state.md:158`: the example contract lists `git add` and `git commit` in `execution.commands`; the compiler refuses commands that start with git (`src/domain/run-contract.ts`). Holds. Also `docs/contracts-and-state.md:146` (`worktree`), `:192` (`delivery.pushBranch: true`; Phase 2 never pushes) and `:279` (`worktree: RelPath`).
6. `docs/contracts-and-state.md:198` (the routine preset) and `:738` (persisted entities): not re-read at the plan base. The config-reference and data-model grounders compare them with `ROUTINE_PRESET` and migrations 0001 and 0002 and write one findings line per difference.
7. `docs/extensions.md:35`: the exit-code summary lists 0, 1, 2, 64, 69, 70 and no 3, while `docs/extensions.md:54` explains exit 3 for the Phase 2 commands and `src/cli/commands/onboard.ts:12` has used it since Phase 1. Holds in part (the table in section 1 still lacks 3).
8. `docs/extensions.md:71`: the PreToolUse checks row says the hook denies Agent calls whose agent definition sets `permissionMode`; the code refuses to build the agents file instead (`src/adapters/gsd/agent-frontmatter.ts:20`), and denies `run_in_background` through the `background-shell` rule (run purpose only, `src/domain/hook-decision.ts`). Holds in part (the background rule is built for runs; the permissionMode check is not in the hook).
9. `docs/extensions.md:204` (skill `avarice-run`): its text matches the skill the code writes in substance (`src/adapters/host-claude/avarice-run-skill.ts`); the section's "Tests" row (prompt evaluation of 10 attended sessions) names an evaluation for which no harness was found (`git grep -il "prompt evaluation" -- src test scripts` finds nothing). Intent unknown.

Load-sensitive tests (pass when their file runs alone):
10. `test/mutation/fail-closed.test.ts:260` (FC-10) and `:299`, `:309`, `:320` (the WR-07 probe cases): fail under full-suite load.
11. `test/integration/claude-host.test.ts:704`: "follows SIGTERM with SIGKILL after the grace when the host ignores SIGTERM", timing-sensitive under load.
12. `test/fault/killpoints.test.ts:272`: checkout digest differences under load (seen once, in the plan that built the run views).

Proposal documents under `docs/` edited by this branch before the documentation rule reached it (commits oldest first, from `git log --format=%h --reverse e725db6..HEAD -- <file>`). One findings line each, for the owner to decide whether the edits stay:
13. `docs/containment.md`: 304e551, 6ae2f04, 265b57a, 3fb6ae4, 6011f19, 059cd3d, 7fe273c.
14. `docs/contracts-and-state.md`: 6ae2f04, 3fb6ae4, 57aaa4e.
15. `docs/extensions.md`: 304e551, d6bd6f6, bc2294d, 3fb6ae4.
16. `docs/decisions/ADR-006-unattended-delegation.md`: 3fb6ae4 (status still Proposed; a dated implementation note at `:56`; an accepted ADR is never rewritten, a proposed one may be, which is the owner's call).
17. `docs/implementation-plan.md`: 304e551 (the admitted host version; the orchestrator's note named four documents, the diff shows this fifth).
`git diff --name-only e725db6..HEAD -- docs | grep -v '^docs/system/'` lists exactly these five.

Existing findings.md lines re-checked (annotate in place when the verdict is "no longer holds"; never delete):
18. `src/cli/main.ts:35` (no-argument shell not implemented): no longer holds. The shell opens at `src/cli/main.ts:55` to `:62` on a terminal with `AVARICE_RUN` unset; the exit-64 path remains for the rest.
19. `src/adapters/host-claude/env.ts:15` ("`AVARICE_RUN` read by nothing"): holds in part. Commands read it (`src/cli/main.ts:58`, `src/cli/shell/shell.ts:532`, `src/cli/commands/install-host.ts:25`); the hook does not, though the comment at `src/adapters/host-claude/env.ts:16` still says "commands and the hook".
20. `docs/containment.md:151` (read-before-edit not implemented): no longer holds for the run purpose (`src/domain/hook-decision.ts:626`, `src/hook/pre-tool-use.ts`). It remains unimplemented for the onboarding purposes.
21. `src/adapters/sqlite/ledger.ts:409` (carrier `runs` row never updated, lease columns unused): the carrier insert moved to `src/adapters/sqlite/ledger.ts:484` and still sets state `onboarding` with no later update; the lease columns of `runs` are now used by run leases (`src/adapters/sqlite/ledger.ts:226`). Holds for the onboarding carrier row only.
22. `src/adapters/sqlite/migrations/0001-initial.ts:5` (six spec tables have no writer): no longer holds as stated. By `INSERT` search two have no writer now, `task_refs` and `approvals`; evidence, gate_results, decisions and work_items are written by the run.
23. `docs/containment.md:122` (spec executor is the sandbox-runtime package): holds; the executor is `/usr/bin/sandbox-exec` and now permits named loopback ports (`src/adapters/exec/seatbelt-profile.ts`).
24. `src/cli/commands/onboard.ts:12` (exit 3 absent from the extensions.md table): holds in part; see item 7.

New candidates seen while mapping (each needs a code re-read by its owner before a line is written):
25. `src/domain/hook-decision.ts` and `src/hook/pre-tool-use.ts`: the hook does not read `AVARICE_RUN`; the run purpose is selected by the policy file the settings name. Confirm no code path depends on the marker.
26. `docs/system/coverage.md`: the hook-rule count (5 allow, 21 deny) names no command that reproduces it. Method issue for the containment grounder and Task 7.
27. The onboarding map stage's `paused` branch (`src/app/stages/map.ts:107`) is still unreachable: no onboarding caller passes `pauseSignal` to `classifyOutcome` (`src/domain/outcome.ts`). The existing findings line holds.

## Denominators at plan base

Counted at HEAD `72a86b1` on 2026-11-06, one command each. The commands are those of coverage.md's denominators table, with the widenings the plan asks for. Task 7 recounts at the pass's final code state (the code does not change in this plan, so the counts should be equal).

| Surface | Count at the plan base | Command |
|---|---|---|
| CLI commands | 10 (`init`, `repo`, `onboard`, `start`, `supervise`, `status`, `inbox`, `resume`, `context`, `install-host`), plus bare `avarice` | `grep -n "COMMANDS =" src/cli/main.ts` |
| Hook entry points | 1 | `git ls-files src/hook` |
| `AVARICE_*` names | 15: 8 read (`AVARICE_CLAUDE_BIN`, `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_FAULT`, `AVARICE_GRAPHIFY_BIN`, `AVARICE_HOOK_ENTRY`, `AVARICE_LEASE_TTL_MS`, `AVARICE_WORK_ROOT`), 1 read and set (`AVARICE_RUN`), 6 constants (`AVARICE_COMMIT_IDENTITY`, `AVARICE_EXECUTOR_ADDENDUM`, `AVARICE_RUN_SKILL`, `AVARICE_SECRET_PATTERNS`, `AVARICE_TRACKED_WRITABLE`, `AVARICE_WRITE_SET`) | `git grep -ohE "AVARICE_[A-Z0-9_]+" -- src bin \| sort -u`, classified by reading each site |
| Other environment variables read | 10 expected: the 8 of the old ledger (`HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`) plus `NO_COLOR` and `TERM` (to be confirmed by the config-reference grounder, including the passthrough lists) | `git grep -nE "process[.]env\|env[[]" -- src bin`, plus the passthrough lists in the GSD, graphify and host adapters (the pattern `env\[` is refused by this harness' secret read guard) |
| Profile config keys | 4, all dead (file unchanged) | the single write site in `src/adapters/fs/profile-paths.ts` |
| SQLite tables | 23 (21 with a writer, 2 without: `task_refs`, `approvals`) | `git grep "CREATE TABLE" -- src` (20 in migration 0001, 3 in 0002); writers by `git grep -ohE "INSERT( OR [A-Z]+)? INTO [a-z_]+" -- src` |
| Event kinds | 26 | `git grep -hoE "type: '[a-z.-]+'" -- src \| sort -u` gives 28 literals; `command` (`src/adapters/host-claude/settings.ts:57`) and `implement` (`src/app/run-start.ts:253`) are not events. The old narrow prefix pattern finds 13 now. Every new prefix (`attempt`, `check`, `decision`, `evidence`, `gate`, `handoff`, `loop`, `run`, `verification`) is an event kind: each appears as the `type` of an `appendEvent` or `insertEvent` input. Events with a computed type, if any, are not counted by this command. |
| Schema migrations | 2 | `ls src/adapters/sqlite/migrations` |
| Onboarding lifecycle states and transitions | 14 and 29 (unchanged) | import `src/domain/onboarding-lifecycle.ts`: `ONBOARDING_STATES.length`, `TRANSITIONS.length` |
| Run lifecycle states and transitions | 11 and 37 | `node --input-type=module -e` importing `src/domain/run-lifecycle.ts`: `RUN_STATES.length`, `RUN_TRANSITIONS.length` |
| Run blocked reasons | 7 | same import, `RUN_BLOCKED_REASONS.length` |
| Run step statuses | 6 | same import, `RUN_STEP_STATUSES.length` |
| Work item states | 6 | same import, `WORK_ITEM_STATES.length` |
| Ports | 11 (plus one shared descriptor type, `src/ports/capability.ts`) | `ls src/ports` (12 files) |
| External systems | recount needed (10 at the old pin, 9 used); candidates added by the run: the package registry through the allowlist proxy, the Claude configuration directory, the detached supervisor | spawn sites: `git grep -nE "spawn\|execFile\|execSync" -- src bin` |
| Index steps | 3 (unchanged; no index file in the diff) | the index step registry, `src/app/stages/index-steps.ts` |
| Hook rules (allow and deny) | not reproducible: the old ledger's 5 allow and 21 deny name no exact command. Distinct rule ids found by `grep -ohE "(return \|deny\(\|rule: \|rule = )'[a-z]+(-[a-z]+)*'" src/domain/hook-decision.ts \| sort -u` are 25 at HEAD (23 at the base `e725db6`), and the three new rule constants `edit-without-read`, `file-changed-since-read`, `ineffective-search` are exported at `src/domain/hook-decision.ts:626` to `:628`. Task 7 defines the command and recounts. | see left |
| Source lines | 26,150 | `git ls-files src \| xargs wc -l` (one `total` line) |
| Test files | 113 | `git ls-files test \| grep -c '\.test\.ts$'` |
| Import-boundary lint | passes (79 files) | `node scripts/check-boundaries.ts` |

## Review ledger

| Document | Report | Verdict | Fixes applied | Answers | Status |
|---|---|---|---|---|---|
