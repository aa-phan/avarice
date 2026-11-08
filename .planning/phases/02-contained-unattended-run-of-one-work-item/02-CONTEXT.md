# Phase 2: Contained unattended run of one work item - Context

**Gathered:** 2026-11-04
**Status:** Ready for planning

<domain>
## Phase Boundary

`avarice start --brief b.md --policy routine` takes one work item on an onboarded repository to `ready_for_review` with no human input after start, or to `blocked_on_decision` with a decision record. The run happens inside enforced containment (OS sandbox, fail-closed hooks, budgets) and survives a kill at any point. The phase also delivers `status`, `inbox` and `resume` for a run, `install-host` for the `avarice-run` skill, active validation of the repository's declared check commands (ONB-10, declared checks only), gates G2 and G4 with revision-bound evidence, and the interactive shell of ADR-013 (FR-27) in the OPS-7 output style.

Excluded (from ROADMAP.md and slice 1): several work items, answering decisions and resuming paused GSD sessions (Phase 3 `decide`), contract amendments, presets other than `routine` and `onboarding`, push and PR delivery, Stage 2 capability, notifications beyond the local inbox, retrieval adapters beyond `git-files`, `gsd-planning`, `gsd-intel` and `gsd-graph`.

</domain>

<decisions>
## Implementation Decisions

### Run workspace and hand-off
- **D-01:** A run works in a **local clone** under the work root, on branch `avarice/run_<id>`. This is the same strategy as onboarding staging (`STAGING_STRATEGY='clone'`, S0-B). The source repository's `.git` is never inside the sandbox's write set. The spec's "run worktree" wording means this clone.
- **D-02:** On `ready_for_review` (after G4), the **supervisor fetches `avarice/run_<id>` from the clone into the source repository as a local branch**. It never checks the branch out and never touches the user's working tree or index. This is AVARICE's first write to a source repository. It is limited to creating that one `refs/heads/avarice/run_*` ref, runs outside any invocation, and is recorded as a ledger step. `status` names the branch and the commit. — **Reversibility:** reversible — deleting the fetched branch undoes it.
- **D-03:** **The supervisor commits, not the agent.** The contained GSD unit edits files only. Its own commits are skipped or denied, and the model never writes git metadata. After G2 passes, AVARICE commits the run's changes outside the invocation (the fallback that host limitation 8 in `docs/containment.md` names, adopted as the primary design). A short spike still records whether in-sandbox commits work with `allowWrite` limited to the clone's git dir, objects and run ref, so limitation 8 can be marked resolved in `docs/containment.md`. Its result does not change the design.
- **D-04:** `baseRevision` is the **active project record's pin** (currently `9f1cd8d` for the portfolio), so the graph and intel match the code. `start` refuses when the brief names a different revision, or when the source has moved past the pin by more than a staleness threshold. The refusal message asks for a re-onboard (adoption and refresh arrive in Phase 4).

### Benchmark target and tasks (exit criterion)
- **D-05:** The three R1 exit tasks run against **`~/aa-phan-portfolio-v2`**, which is already active at `9f1cd8d` with graph and intel. No new onboarding is part of the exit work.
- **D-06:** **Claude drafts** three tasks during planning, one per R1 example class (bug fix with failing test, small refactor, docs plus code change). Each has a brief, acceptance criteria and a pre-run label of 0 expected decisions. **The owner approves or swaps them at a checkpoint** before any live spend on the portfolio.
- **D-07:** The exit follows **Phase 1's pattern**: offline fake-host and kill-point suites first (AC-3 and CON-16 fault injection), then the live containment cases (CS-1 to CS-4, CS-6, CS-7, CS-10 to CS-14, scenarios S-3, S-12 to S-15, S-20, S-41, S-42) on a generated scratch repository, then the three portfolio runs behind an owner checkpoint.
- **D-08:** Pass bar: **3 of 3, one `avarice start` per task.** The run's own CON-16 discard-and-retry is allowed. Any task ending `blocked_on_decision` or failed is an exit failure: diagnose, fix, then re-run all three.

### Required checks
- **D-09:** The portfolio's checks are declared in a **committed `.avarice/config.json` in the portfolio repository**, the spec's repository-conventions source. The owner commits it (Claude drafts the content in the plan; this is an owner action in another repository). The ONB-10 stage validates each declared check in a sandboxed scratch clone (unexpected writes or network fail validation) before it becomes active. — **Reversibility:** reversible — a file in the portfolio repo.
- **D-10:** Every step of the portfolio's `npm run verify` is declared as **its own required check**: `typecheck`, `lint`, `format:check`, `test`, `check:case`, `check:colors`, `check:contrast`, `build`, `check:meta`, `check:budget`, `check:no-phone`, `check:images`. Evidence then records each check as passed, failed, skipped, unavailable or inconclusive (AUT-8) and maps acceptance criteria to them. `test:e2e` (Playwright) is **optional**, not required.
- **D-11:** Dependencies: before the first invocation, **the supervisor runs `npm ci --ignore-scripts`** in the clone from `package-lock.json`, sandboxed, with network limited to the npm registry, recorded as a step, with the lockfile digest in the evidence. The agent's invocations never get network. Containment docs must list this registry allowance as a supervisor-step exception.
- **D-12:** **Baseline and delta.** The required checks run once at `baseRevision` and the results are recorded. G4 passes when no check that passed at base now fails, and when the check(s) the brief targets pass. A check already failing at base is reported as pre-existing and does not block the run, unless the brief is about it. AUT-9 still holds: the run may not disable, delete or weaken a check to pass.

### Routine preset budgets and spend
- **D-13:** `routine` preset per-run caps: **wall clock 60 min, cost 2.00 USD per invocation and 5.00 USD per run, tool calls 400, invocations 3** (room for the one CON-16 retry). As in Phase 1, `--budget` overrides can only lower them, and killed or orphaned invocations stay charged.
- **D-14:** Model: a Phase 2 work item defaults to **size `medium`, which maps to Sonnet** through `modelBySize`. A brief may set `model` to override. Per-item sizing rules (RC-7/RC-8) stay in Phase 3.
- **D-15:** **The total live-model spend ceiling for Phase 2 is 25 USD**, covering development live cases, containment rehearsals and the three exit runs (about 8 USD for cases and rehearsals, about 17 USD for the exit). Execution stops and asks the owner before exceeding it, and the cumulative spend is recorded as in `test/containment/LIVE-CASES.md`.

### Resolved at plan-phase (owner answers to RESEARCH.md open questions, 2026-11-05)
- **D-16:** **Conventions come from a descendant commit of the pin.** `start` reads `.avarice/**` from git objects at a descendant commit of `baseRevision` whose diff against the pin touches only `.avarice/**`. If no such commit exists, or the diff touches anything else, `start` refuses. This resolves the D-04/D-09 conflict. The code under work is still the pin tree.
- **D-17:** **GSD quick-task artifacts stay off the review branch.** `.planning/quick/**` and `.planning/STATE.md` changes made by the GSD unit in the clone are archived as run artifacts in the AVARICE store and excluded from the supervisor's commit pathspec. The `avarice/run_<id>` branch holds only the code change.
- **D-18:** **`avarice start` detaches by default.** It returns once the detached supervisor is spawned and the run is recorded. `--wait` blocks until a terminal or blocked state, using `onboard`'s exit codes: 0 for `ready_for_review`, 3 for not ready. Tests and the exit script use `--wait`. Closing the shell leaves the supervisor running (SC 6).
- **D-19:** **`status --json` may gain one optional `runs` key.** Every existing Phase 1 key stays byte-identical, and a snapshot of the Phase 1 output is taken before any renderer change. This is how SC 7's "every `--json` shape is unchanged" is read.

### Claude's Discretion
- The staleness threshold for D-04 (commit count or age) and the exact refusal wording.
- The fetched branch name in the source repo (the default is the same `avarice/run_<id>`) and when the clone is cleaned up after hand-off.
- How the GSD unit's own commits are suppressed (run-scoped GSD config such as `commit_docs` off, or a hook denial of `git commit`), as long as D-03 holds.
- Draft content of the portfolio's `.avarice/config.json` and of the three R1 briefs (subject to D-06 approval).
- Shell (FR-27) internals within ADR-013's decisions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` § Phase 2 — goal, requirement list, success criteria 1 to 7, partial-coverage notes
- `.planning/REQUIREMENTS.md` — full text of RC-1..5, CON-1/2/3/5/6/7/8/9/13/14/16, AUT-7/8/9, FR-1/2/4/5/6/7/11/27, NFR-1/3/5/6/9, OPS-2/7, ONB-10
- `docs/implementation-plan.md` § Slice 1 — deliverables, verification list, exclusions, exit criterion
- `docs/requirements.md` — PRD (precedence PRD > ADR > SPEC > DOC)

### Containment
- `docs/containment.md` — generated host settings, run hook set, the diff gate, unresolved host limitation 8 (resolved by D-03 plus spike)
- `spikes/2026-11-01-pre-slice-0/README.md` — limitations 1, 2, 5, 6 and 7 evidence, the working-directory-always-writable finding
- `spikes/slice-0-wave-0/` — S0-A to S0-G evidence (S0-B clone over worktree, S0-F budgets)

### Contract, state, autonomy
- `docs/contracts-and-state.md` — run contract shape, preset table (`routine`), `modelBySize`, outcome table incl. CON-16 discard-and-retry row, ports
- `docs/autonomy-and-decisions.md` — run lifecycle, decision record, benchmark workload (R1 class definition)
- `docs/operations-and-testing.md` — containment cases CS-*, scenarios S-*, AC-3, kill-point suite
- `docs/decisions/ADR-006-unattended-delegation.md` — bounded GSD units, routed pauses, deterministic outcome classification
- `docs/decisions/ADR-002-gsd-integration-mode.md` — AVARICE supplies services, GSD owns the loop (partly superseded by ADR-006)
- `docs/decisions/ADR-003-local-persistence.md`, `docs/decisions/ADR-004-modular-monolith-and-ports.md` — ledger and layering
- `docs/decisions/ADR-005-policy-approvals-and-profiles.md` — deny-by-default privileged actions

### CLI, shell, output
- `docs/decisions/ADR-013-interactive-shell.md` — shell decisions 1 to 7 (FR-27)
- `docs/extensions.md` § 1 — CLI command and exit-code table, the OPS-7 output style

### Phase 1 carry-over
- `.planning/phases/01-contained-onboarding-of-one-repository/SKELETON.md` — layering and vendor-code placement
- `.planning/phases/01-contained-onboarding-of-one-repository/deferred-items.md` — open items (7, 8; stream-json last-result note)
- `.planning/STATE.md` § Decisions — Phase 1 kernel decisions (ledger, budgets, hook, sandbox, resume, reap)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/adapters/git/staging-clone.ts`, `staging-strategy.ts`, `safe-git.ts`: the clone workspace and hardened `runGit` (filter drivers blanked, no `-c`). The run clone (D-01), supervisor commits (D-03) and fetch into the source (D-02) all build on them.
- `src/adapters/host-claude/*` (`claude-host.ts`, `settings.ts`, `launch-args.ts`, `launch-preflight.ts`, `env.ts`, `stream-json.ts`, `hook-policy.ts`): the contained headless launch with `assertLaunchArgsSafe`, `checkLaunchReady` and the admitted Claude versions. The run needs a `/gsd-quick --validate --text` purpose added.
- `src/hook/pre-tool-use.ts` + `src/domain/hook-decision.ts`, `invocation-scope.ts`: the fail-closed hook and per-purpose scopes. Add a run purpose with the read-before-edit, Agent `permissionMode` and background-Bash denials.
- `src/adapters/exec/sandboxed-executor.ts`, `seatbelt-profile.ts`: the sandboxed runner for AVARICE's own commands. Reuse it for ONB-10 check validation, checks at base and head, and `npm ci` (this is the spike "sandbox runtime wraps AVARICE's own check commands").
- `src/app/budget.ts`, `src/app/invocation.ts`, `src/app/resume.ts`: reservations, orphan charge, reap by session ID, lease takeover. Generalize them from onboarding to run.
- `src/domain/outcome.ts`: the deterministic outcome classifier. Extend it for the run outcomes.
- `src/domain/onboarding-contract.ts`: the preset and budget-override pattern (lower-only limits, derivations). The `routine` preset follows it.
- `src/app/stages/*`: the checkpointed stage loop (`StageContext` checkpoint, transition, activate), so generic kill points fire.

### Established Patterns
- A checkpoint names the action about to run and is committed before its side effect. Counted fault points `name#N`.
- Ledger methods take `nowMs` from the caller. IDs come from `newId('<prefix>_', ...)`. The event size limits are 1024 and 8192.
- Command modules export `run`, `readOnly` and `booleanFlags`. `usage()` refuses before the profile resolves. `--json` shapes are frozen.
- No runtime dependencies (`test/unit/footprint.test.ts`). Import-boundary lint between domain, app, adapters and cli.
- Red-then-green evidence files per task (`*-red-evidence*.json`). Live cases are gated by `AVARICE_LIVE=1` with spend recorded.

### Integration Points
- `src/cli/main.ts` `COMMANDS` allowlist: add `start`, `inbox`, `install-host`, and the no-argument shell branch (ADR-013).
- `src/ports/staging-workspace.ts`, `agent-host.ts`, `command-executor.ts`, `ledger.ts`: the run uses these ports. A new run lifecycle sits beside `onboarding-lifecycle.ts`.
- SQLite migrations in `src/adapters/sqlite/migrations`: run, work-item, check-result and evidence tables (backup before migrating is already in place).

</code_context>

<specifics>
## Specific Ideas

- R1 task classes to draft (D-06): a bug fix with a failing test, a small refactor, and a docs plus code change, all on the portfolio at `9f1cd8d`.
- The portfolio's check list is the 12 steps of its `npm run verify` script as it stands at the pin. `test:e2e` stays optional.
- Spend accounting follows Phase 1's `test/containment/LIVE-CASES.md` style (per case and cumulative against the 25 USD ceiling).

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within phase scope. Open items carried from STATE.md that this discussion did not settle: the Node 26.x support statement (ADR-001 names 22.x and 24.x), and validating `CLAUDE_CONFIG_DIR` against the `~/.claude-edu` / `~/.claude` split (host limitation 7, `doctor --extensions` in Phase 4).

</deferred>

---

*Phase: 02-contained-unattended-run-of-one-work-item*
*Context gathered: 2026-11-04*
