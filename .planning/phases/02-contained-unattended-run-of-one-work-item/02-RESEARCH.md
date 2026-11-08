# Phase 2: Contained unattended run of one work item - Research

**Researched:** 2026-11-05
**Domain:** Local TypeScript CLI (Node, zero runtime deps) that supervises contained headless Claude Code and GSD invocations, runs the repository's checks in an OS sandbox, and gates a run to `ready_for_review`
**Confidence:** MEDIUM overall. HIGH for what the Phase 1 kernel provides and for the sandbox and portfolio probes run this session. MEDIUM-LOW for how the real `/gsd-quick --validate` unit behaves under the AVARICE hook (no live run exists yet); that is the largest risk and gets a Wave 0 spike.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** A run works in a **local clone** under the work root, on branch `avarice/run_<id>`. This is the same strategy as onboarding staging (`STAGING_STRATEGY='clone'`, S0-B). The source repository's `.git` is never inside the sandbox's write set. The spec's "run worktree" wording means this clone.
- **D-02:** On `ready_for_review` (after G4), the **supervisor fetches `avarice/run_<id>` from the clone into the source repository as a local branch**. It never checks the branch out and never touches the user's working tree or index. This is AVARICE's first write to a source repository. It is limited to creating that one `refs/heads/avarice/run_*` ref, runs outside any invocation, and is recorded as a ledger step. `status` names the branch and the commit. — **Reversibility:** reversible — deleting the fetched branch undoes it.
- **D-03:** **The supervisor commits, not the agent.** The contained GSD unit edits files only. Its own commits are skipped or denied, and the model never writes git metadata. After G2 passes, AVARICE commits the run's changes outside the invocation (the fallback that host limitation 8 in `docs/containment.md` names, adopted as the primary design). A short spike still records whether in-sandbox commits work with `allowWrite` limited to the clone's git dir, objects and run ref, so limitation 8 can be marked resolved in `docs/containment.md`. Its result does not change the design.
- **D-04:** `baseRevision` is the **active project record's pin** (currently `9f1cd8d` for the portfolio), so the graph and intel match the code. `start` refuses when the brief names a different revision, or when the source has moved past the pin by more than a staleness threshold. The refusal message asks for a re-onboard (adoption and refresh arrive in Phase 4).
- **D-05:** The three R1 exit tasks run against **`~/aa-phan-portfolio-v2`**, which is already active at `9f1cd8d` with graph and intel. No new onboarding is part of the exit work.
- **D-06:** **Claude drafts** three tasks during planning, one per R1 example class (bug fix with failing test, small refactor, docs plus code change). Each has a brief, acceptance criteria and a pre-run label of 0 expected decisions. **The owner approves or swaps them at a checkpoint** before any live spend on the portfolio.
- **D-07:** The exit follows **Phase 1's pattern**: offline fake-host and kill-point suites first (AC-3 and CON-16 fault injection), then the live containment cases (CS-1 to CS-4, CS-6, CS-7, CS-10 to CS-14, scenarios S-3, S-12 to S-15, S-20, S-41, S-42) on a generated scratch repository, then the three portfolio runs behind an owner checkpoint.
- **D-08:** Pass bar: **3 of 3, one `avarice start` per task.** The run's own CON-16 discard-and-retry is allowed. Any task ending `blocked_on_decision` or failed is an exit failure: diagnose, fix, then re-run all three.
- **D-09:** The portfolio's checks are declared in a **committed `.avarice/config.json` in the portfolio repository**, the spec's repository-conventions source. The owner commits it (Claude drafts the content in the plan; this is an owner action in another repository). The ONB-10 stage validates each declared check in a sandboxed scratch clone (unexpected writes or network fail validation) before it becomes active. — **Reversibility:** reversible — a file in the portfolio repo.
- **D-10:** Every step of the portfolio's `npm run verify` is declared as **its own required check**: `typecheck`, `lint`, `format:check`, `test`, `check:case`, `check:colors`, `check:contrast`, `build`, `check:meta`, `check:budget`, `check:no-phone`, `check:images`. Evidence then records each check as passed, failed, skipped, unavailable or inconclusive (AUT-8) and maps acceptance criteria to them. `test:e2e` (Playwright) is **optional**, not required.
- **D-11:** Dependencies: before the first invocation, **the supervisor runs `npm ci --ignore-scripts`** in the clone from `package-lock.json`, sandboxed, with network limited to the npm registry, recorded as a step, with the lockfile digest in the evidence. The agent's invocations never get network. Containment docs must list this registry allowance as a supervisor-step exception.
- **D-12:** **Baseline and delta.** The required checks run once at `baseRevision` and the results are recorded. G4 passes when no check that passed at base now fails, and when the check(s) the brief targets pass. A check already failing at base is reported as pre-existing and does not block the run, unless the brief is about it. AUT-9 still holds: the run may not disable, delete or weaken a check to pass.
- **D-13:** `routine` preset per-run caps: **wall clock 60 min, cost 2.00 USD per invocation and 5.00 USD per run, tool calls 400, invocations 3** (room for the one CON-16 retry). As in Phase 1, `--budget` overrides can only lower them, and killed or orphaned invocations stay charged.
- **D-14:** Model: a Phase 2 work item defaults to **size `medium`, which maps to Sonnet** through `modelBySize`. A brief may set `model` to override. Per-item sizing rules (RC-7/RC-8) stay in Phase 3.
- **D-15:** **The total live-model spend ceiling for Phase 2 is 25 USD**, covering development live cases, containment rehearsals and the three exit runs (about 8 USD for cases and rehearsals, about 17 USD for the exit). Execution stops and asks the owner before exceeding it, and the cumulative spend is recorded as in `test/containment/LIVE-CASES.md`.

### Claude's Discretion
- The staleness threshold for D-04 (commit count or age) and the exact refusal wording.
- The fetched branch name in the source repo (the default is the same `avarice/run_<id>`) and when the clone is cleaned up after hand-off.
- How the GSD unit's own commits are suppressed (run-scoped GSD config such as `commit_docs` off, or a hook denial of `git commit`), as long as D-03 holds.
- Draft content of the portfolio's `.avarice/config.json` and of the three R1 briefs (subject to D-06 approval).
- Shell (FR-27) internals within ADR-013's decisions.

### Deferred Ideas (OUT OF SCOPE)
None. The discussion stayed within phase scope. Open items carried from STATE.md that this discussion did not settle: the Node 26.x support statement (ADR-001 names 22.x and 24.x), and validating `CLAUDE_CONFIG_DIR` against the `~/.claude-edu` / `~/.claude` split (host limitation 7, `doctor --extensions` in Phase 4).

Excluded from the phase (ROADMAP and slice 1): several work items, answering decisions and resuming paused GSD sessions (Phase 3 `decide`), contract amendments, presets other than `routine` and `onboarding`, push and PR delivery, Stage 2 capability, notifications beyond the local inbox, retrieval adapters beyond `git-files`, `gsd-planning`, `gsd-intel` and `gsd-graph`.
</user_constraints>

<phase_requirements>
## Phase Requirements

REQUIREMENTS.md already marks CON-1, CON-2, CON-3, CON-5, CON-6, CON-13, NFR-1, NFR-3, NFR-5, NFR-6 and NFR-9 `Complete` from Phase 1 (onboarding scope). Phase 2 must keep them true for the run purpose (regression and re-proof under the run contract), not rebuild them. The rest are `Pending`. [VERIFIED: .planning/REQUIREMENTS.md traceability table]

| ID | Description | Research Support |
|----|-------------|------------------|
| RC-1 | Durable versioned run contract with all listed fields | Run contract compiler (new `src/domain/run-contract.ts`) following the `onboarding-contract.ts` pattern; stored via the existing `contracts` table (immutable trigger) |
| RC-2 | Contract from preset + repository conventions + brief | `routine` preset constant; `.avarice/config.json` read from git objects; brief parser. See Pitfall 6 on pin vs conventions |
| RC-3 | No extra confirmation | `start` prints a summary and proceeds; no prompt path exists |
| RC-4 | No prompts inside the contract | Run-scoped GSD config, `--permission-prompts none`, G-state machine (AUT-7) |
| RC-5 | Run cannot expand scope/budget/credentials | Lower-only `--budget`, contract outside the clone, `avarice` in denied prefixes, `AVARICE_RUN` marker; no amend command exists (holds by absence) |
| CON-1/2/3/5/6/13 | Enforcement points, write prevention, fail-closed, no pattern-only containment, no self-modification, budgets | Reuse Phase 1 kernel; new run `InvocationPurpose`, scope and hook policy; CS-1..4, 6, 7, 10..14 live cases |
| CON-7 | Read-before-edit plus digest precondition; user changes preserved | **Not implemented in the hook today** (grep of `src/` finds no read-digest code). New hook state and migration 0002; D-01 clone preserves user changes by construction |
| CON-8 | Canonical paths; declared build/test output locations | Hook canonicalization exists; add per-check `writes` artifact paths (probe below shows they are required) |
| CON-9 | Recovery never resets/deletes what run did not make | CON-16 discard limited to paths the run created; clone is the run's own; S-20 byte-compare of source checkout |
| CON-14 | Loop limits end in checkpoint and escalation | Hook consecutive-denial counter with `continue:false`; `noProgressInvocations`; repair attempts |
| CON-16 | Discard and retry once for crashed/timed-out invocation without outside effect | Supervisor reset to last item checkpoint commit inside the clone only; `invocations: 3` budget |
| AUT-7/8/9 | Machine-checkable transitions; evidence statuses; no weakening | Gates G0, G2, G4, test inventory, protected paths, evidence table |
| FR-1/2 | Start from manual brief; explicit run state machine, persisted before side effect | `start --brief`; run state machine subset; checkpoint-before-effect pattern |
| FR-4 | Delegate planning/implementation to GSD (Stage 1) | `/gsd-quick --validate --text` unit; no AVARICE planner |
| FR-5/6 | Deterministic checks; evidence names exact revision | Sandboxed check runner; `revision` = commit + clean flag |
| FR-7 | Checkpoint per transition; resume from checkpoints/git/GSD state | Generalize `resume.ts` to runs |
| FR-11 | Read-only offline `status` with run state, checkpoint, evidence | Extend `getStatus` additively (see Pitfall 12) |
| FR-27 | Interactive shell on bare `avarice` in a terminal | `src/cli/shell/` per ADR-013; Node built-ins only |
| NFR-1/3/5/6/9 | No infra deps; import boundary; local SQLite; consistent after kill; forward-only migrations | Migration 0002; `check-boundaries`; `footprint.test.ts` |
| OPS-2 | Events carry correlation IDs | `runId`, `attemptId`, `invocationId` on every run event via `appendEvent` |
| OPS-7 | One human-readable style | Shared render functions in `src/cli/render/`; `status`, `onboard`, `resume`, `init`, `repo` brought to the table in `docs/extensions.md` |
| ONB-10 | Declared check commands stay inactive until sandboxed active validation | New validation stage, declared checks only; `npm ci` first |
</phase_requirements>

## Summary

Phase 2 reuses the whole Phase 1 kernel (ledger, contract compiler pattern, clone workspace, generated Claude settings, fail-closed hook, sandboxed executor, budgets, resume/reap, kill-point harness) and adds one new lifecycle: a **run**. The Phase 1 code is deeply keyed on `onboardingId` (ledger port, `prepareInvocation`, `StageContext`, `resume.ts`, `InvocationPurpose = 'map'|'intel'|'knowledge'`). The `runs`, `work_items`, `evidence`, `gate_results`, `decisions`, `attempts`, `checkpoints` and `budgets` tables already exist in migration 0001 but only the onboarding carrier rows, `attempts`, `checkpoints` and `budgets` are written today. So the plan needs a migration 0002 (hook read-digest table, run steps, possibly `runs` columns) and a new run service beside `onboarding-service.ts`, not a rewrite.

Six findings change the plan and are not in the spec or CONTEXT.md: (1) the installed Claude Code is **2.1.318**, which is not in `ADMITTED_CLAUDE_VERSIONS`, so every launch is refused until a live containment re-run admits it. (2) `/gsd-quick` is shell-heavy (`git checkout -b`/`git fetch origin` branching, `worktree.reap-orphans`, `dispatch-isolation`, `quick-tasks-append`, `query commit`) and its executor is told to `git commit` each task; the current hook admits only read-only commands plus a short GSD verb list, so the run purpose needs its own command identity rules and run-scoped GSD config (`workflow.use_worktrees`, `git.branching_strategy`, `commit_docs`) beyond the five keys ADR-006 lists. How the real executor behaves when `git commit` is denied is unobserved and is the top Wave 0 spike. (3) **Seatbelt cannot filter by hostname** (verified: `host must be * or localhost in network address`), so D-11's "network limited to the npm registry" needs a local allowlisting proxy; `@anthropic-ai/sandbox-runtime` has four runtime dependencies and is flagged `SUS`, so it is not adoptable under NFR-1. (4) On the portfolio at the pin, `format:check` **already fails** (`index.html`), `build` needs `VITE_SITE_ORIGIN` (an untracked `.env` value the clone lacks), and `tsc`, `vitest` and `vite-imagetools` write under `node_modules`; all three are verified below and make D-12 and a per-check `env` and `writes` schema necessary. (5) CON-7 read-before-edit is **not built**. (6) The pin tree has no `.avarice/config.json`, and D-09 has the owner commit it after the pin, which collides with D-04.

**Primary recommendation:** Build the run as a second lifecycle on the same kernel (new `run-contract`, `run-lifecycle`, `run-service`, run `InvocationPurpose`, migration 0002), spend the first wave on three cheap live spikes (claude 2.1.318 admission, `/gsd-quick` under a run-purpose hook with commits denied, `npm ci` through an allowlisting proxy), and keep every other piece pure-domain and testable with the fake host.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Contract compile (preset + conventions + brief), G0 | `domain` (pure) | `app` (reads git objects via port) | Pure function with injected clock and IDs, like `compileOnboardingContract` |
| Run lifecycle, transitions, checkpoints, leases | `app` + `ledger` adapter | `domain` (transition table) | Transition and checkpoint in one SQLite transaction (FR-2) |
| Supervisor process (`avarice supervise <run>`) | `cli`/`app` | OS process | Detached, outlives shell; the only process that advances a run |
| Contained GSD unit | `adapters/host-claude` | `hook`, OS sandbox | Vendor names stay out of domain (SKELETON vendor-code rule) |
| Command identity and read/write rules for run purpose | `domain` (hook-decision) | `adapters/host-claude` (settings render) | Pure decision with injected `canon()` |
| Checks, baseline, `npm ci`, ONB-10 validation | `adapters/exec` (SandboxedExecutor) | `app` stages | Sandbox is the control; app orders the steps |
| Allowlisting CONNECT proxy for `npm ci` | `adapters/exec` | — | Seatbelt cannot name hosts; node built-ins only |
| Commit, fetch-into-source hand-off | `adapters/git` (`safe-git`) | `app` | Supervisor-only, outside any invocation (D-02, D-03) |
| Gates G2, G4, evidence, AC mapping | `domain` | `app` | Deterministic; no model text is evidence (FR-6) |
| Outcome classification (+ pause detection) | `domain/outcome.ts` | `adapters/host-claude` (facts) | Classifier stays pure |
| `status`, `inbox`, `resume`, `start`, shell | `cli` | `app` read models | Shell calls the same command modules in-process (ADR-013 3) |
| `install-host` (`avarice-run` skill) | `cli` + `adapters/fs` | — | Writes a skill into the user's Claude config; refuses under `AVARICE_RUN` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node `node:sqlite`, `node:child_process`, `node:net`, `node:http`, `node:readline`, `node:test` | Node >=22.22.3; dev 26.9.0 [VERIFIED: `node --version` and package.json `engines`] | Everything: ledger, processes, proxy, shell, tests | NFR-1 and `test/unit/footprint.test.ts` forbid runtime dependencies |
| TypeScript | 7.0.2 (dev, pinned) [VERIFIED: package.json] | `tsc -p .` check only; Node type stripping runs the source | ADR-001 |
| Claude Code (host) | installed **2.1.318**; admitted `['2.1.312', '2.1.316', '2.1.317']` [VERIFIED: `claude --version` output "2.1.318 (Claude Code)"; src/adapters/host-claude/launch-preflight.ts:20 `export const ADMITTED_CLAUDE_VERSIONS: readonly string[] = ['2.1.312', '2.1.316', '2.1.317'];`] | Contained headless invocation | Phase 1 adapter |
| GSD (`@opengsd/gsd-core`) | 1.17.0 [VERIFIED: `~/.claude/gsd-core/VERSION` printed `1.17.0`] | `/gsd-quick --validate --text` unit | ADR-006 |
| git | system `/usr/bin/git` | clone, commit, fetch | `safe-git.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `SandboxedExecutor` + `buildSeatbeltProfile` | in repo | Runs checks, baseline, ONB-10 validation | Every AVARICE-run command; extend with an optional `allowLoopbackPort` for the proxy |
| Existing `runGit` / `SAFE_GIT_ENV` | in repo | Clone, add, commit, fetch | Extend `RunGitOptions` with commit identity and `commit.gpgsign=false` extra config |
| Existing `ClaudeHostAdapter`, `renderClaudeSettings`, `computeInvocationScope`, hook | in repo | Contained launch | Add the run purpose; do not fork them |
| Existing kill-point harness (`test/helpers/fault-run.ts`, `AVARICE_FAULT`) | in repo | AC-3, NFR-6 fault injection | New catalog `RUN_KILL_POINTS` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-repo allowlisting CONNECT proxy | `@anthropic-ai/sandbox-runtime` 0.0.81 | Four runtime deps (`zod`, `commander`, `node-forge`, `@pondwader/socks5-server`) [VERIFIED: `npm view`]; seam verdict `SUS` (`too-new`); breaks NFR-1. Not adopted |
| Allowlisting proxy | Coarse Seatbelt `(allow network-outbound (remote ip "*:443"))` | Any HTTPS host reachable during `npm ci`; fails the "registry only" intent of D-11. Only as an owner-approved fallback |
| Allowlisting proxy | Prefetched offline npm cache + `npm ci --offline` | No network at all, but needs a cache populated by some network step anyway |

**Installation:** none. No package is added (`footprint.test.ts` must stay green).

**Version verification:** `claude --version` -> `2.1.318 (Claude Code)`; `node --version` -> `v26.9.0`; `npm --version` -> `11.19.1`; GSD `VERSION` -> `1.17.0`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@anthropic-ai/sandbox-runtime` | npm | latest published 2026-10-20 | about 799k/wk | github.com/anthropics/sandbox-runtime | SUS (`too-new`) | Evaluated and **not adopted** (NFR-1: four runtime deps). No install |

**Packages removed due to SLOP verdict:** none
**Packages flagged SUS:** `@anthropic-ai/sandbox-runtime` (research alternative only; no task installs it)

No new package is recommended for this phase. The portfolio's own `npm ci --ignore-scripts` installs the portfolio's lockfile inside the run clone, not AVARICE's dependencies.

## Architecture Patterns

### System Architecture Diagram

```text
avarice start --brief b.md --policy routine        (one-shot CLI or shell action)
        |
        v
 [preflight] active project record? brief valid? pin vs source HEAD (staleness)? host admitted?  --refuse--> exit 64 / 3
        |
        v
 [compile] preset(routine) + .avarice/config.json (git object) + brief  --> run contract v1, G0
        |                                                              (stored in ledger + data root, never in clone)
        v
 create run_id, budgets, lease  ----------------------------->  spawn detached `avarice supervise <run>`  (start returns, prints summary)
                                                                          |
   supervisor loop (lease + fence, checkpoint BEFORE each effect) <------+
        |
        +--> workspace:   git clone --local --no-hardlinks @ pin, branch avarice/run_<id>
        +--> configure:   gsd_run config-set (text_mode, use_worktrees=false, branching off, commit_docs=false, ...)
        +--> deps:        npm ci --ignore-scripts  [SandboxedExecutor + loopback proxy allowlist registry.npmjs.org]
        +--> baseline:    each required check at base  --> evidence rows (passed/failed => pre-existing)
        +--> test inventory at base
        +--> item delegated:  reserve invocation budget -> launch:run step(started, sessionId) -> `claude -p /gsd-quick --validate --text "<task>"`
        |         inside: sandbox + dontAsk + PreToolUse hook (paths, read-before-edit, budgets, no git writes, no network)
        |         outcome facts: stream-json result, exit, hook events, clone HEAD (must NOT move), tree changes
        |         --> classify: progressed | paused(question) | denied | failed | budget_exhausted | no_progress | inconclusive
        +--> crashed/timed out with no outside effect --> CON-16: discard inside clone to last item checkpoint, retry once
        +--> G2: scope conformance (diff vs write/create/artifact globs), inventory, no overrides/skips, checks (delta vs base)
        +--> supervisor commits (pathspec = in-scope files only; .planning/quick artifacts archived, not committed)  [checkpoint: item done @ commit]
        +--> verifying: all required checks at final clean revision --> evidence; AC -> evidence mapping
        +--> G4 pass --> hand-off: git fetch clone avarice/run_<id> -> source refs/heads/avarice/run_<id>   [ledger step, idempotent]
        v
   ready_for_review (evidence names commit + clean flag)      OR   blocked_on_decision(reason: decision|enforcement_failure|budget_exhausted)
                                                                   OR failed / paused(on next command after a kill)
 status / inbox / resume read the ledger offline; resume reaps the surviving host by session ID, then continues from the last checkpoint
```

### Recommended Project Structure
```
src/
  domain/
    run-contract.ts        # routine preset, brief parse, compile, G0, lower-only budget overrides
    run-lifecycle.ts       # run states + TRANSITIONS + next-action catalog (same shape as onboarding-lifecycle.ts)
    gates.ts               # G2, G4 as pure functions over evidence + diff facts
    evidence.ts            # evidence statuses, AC mapping, baseline-delta rule (D-12)
    test-inventory.ts      # skip/focus markers, removed IDs
    run-outcome.ts or outcome.ts (extended)  # pause detection from structural signals
    shell-view.ts          # pure view models for FR-27
  app/
    run-service.ts         # startRun, runSupervisor (lease loop), mirrors onboarding-service.ts
    run-resume.ts          # reap, reconcile interrupted launch/verify, CON-16
    run-stages/            # workspace, configure, deps, baseline, delegate, gate-g2, commit, verify-g4, handoff
    checks.ts              # run required checks via CommandExecutor; ONB-10 validation stage
    run-status.ts          # read model for status/inbox (additive to getStatus)
  adapters/
    exec/allowlist-proxy.ts  # node:http CONNECT proxy, hostname allowlist, loopback only
    exec/seatbelt-profile.ts # + loopback-port allowance
    git/run-workspace.ts     # clone (reuses staging-clone), commit, fetch-into-source
    host-claude/...          # run purpose in scope/settings/policy
    sqlite/migrations/0002-run.ts
  hook/pre-tool-use.ts       # + read digest recording (post), read-before-edit (pre), denial counter
  cli/commands/{start,supervise,inbox,install-host}.ts ; resume.ts, status.ts extended
  cli/shell/                 # ADR-013
  cli/render/                # OPS-7 shared renderers
test/{unit,integration,fault,containment}/...   # see Validation Architecture
```

### Pattern 1: Checkpoint names the action, committed before the side effect
**What:** every stage commits a checkpoint with `next_action` before it acts, then a transition after; generic `faultPoint('after-transition:' + to)` and `faultPoint('after-checkpoint:' + nextAction)` fire in the stage context, so no stage carries fault code. [VERIFIED: src/app/onboarding-service.ts `makeContext`, `faultPoint`]
**When to use:** all run stages. Add `RUN_KILL_POINTS` (after-transition per run state, after-checkpoint per action, `mid-invocation`, `mid-verify`, `mid-commit`, `mid-handoff`, counted `name#N` forms) so the AC-3 suite covers "every transition".

### Pattern 2: Session ID chosen by the caller and recorded before launch
`prepareInvocation` records step `launch:{purpose}` (`started`, with `invocationId` and `sessionId`) before the host runs; resume reaps by `--session-id` before touching the clone. Reuse for purpose `run`; the "interrupted attempt" that AC-3 must identify is the `started` launch row or a `verify:*` step with no completion. [VERIFIED: src/app/invocation.ts, src/app/resume.ts]

### Pattern 3: Budget rows created with the contract, only growing in `used`
`createBudgets` is INSERT OR IGNORE; a killed invocation is charged its reservation; an orphan reservation is charged on the next `reserveInvocation`. Generalize `budgetRowsOf` and `reserveInvocation` from `OnboardingContract` to a `BudgetedContract` shape (`invocations`, `toolCalls`, `subagentsTotal`, `wallClockMs`, `costUsd`). Per-purpose wall-clock shares become one `run` share. [VERIFIED: src/app/budget.ts]

### Pattern 4: Supervisor commits through a hardened `runGit`
`runGit` refuses global options, `-c` and `--config-env`; filters blanked; `core.hooksPath=/dev/null`. The commit needs author identity and `commit.gpgsign=false` (the user's `~/.gitconfig` is visible because `HOME` is passed): extend `RunGitOptions` with an `extraConfig` allowlist (identity, `commit.gpgsign`, `transfer.fsckObjects`) rather than letting callers pass `-c`. [VERIFIED: src/adapters/git/safe-git.ts]

### Pattern 5: Hand-off by fetch, idempotent
`git fetch <clone path> refs/heads/avarice/run_<id>:refs/heads/avarice/run_<id>` with cwd = source repo, no `+` (a differing existing ref is a conflict; an equal one is success), `transfer.fsckObjects=true`, `--no-tags`, hooks off. Checkpoint `handoff:fetch` first. Never a checkout. S-20 and a refs-digest test prove the user's index, HEAD and working tree are byte-identical (extend `scripts/checkout-digest.ts`).

### Anti-Patterns to Avoid
- **Forking the onboarding code per purpose.** Generalize `prepareInvocation`, `reserveInvocation`, `resume` by a purpose and a "run identity" interface; do not copy them.
- **Letting the agent commit, branch or fetch.** `git commit`, `git push`, `git config`, `avarice`, `npm`, `npx` are already in `DENIED_COMMAND_PREFIXES`; the run scope must not remove `git commit`. Run-scoped config makes GSD not try.
- **Treating the GSD verifier or SUMMARY text as completion evidence** (FR-6, AUT-7). Record it as `independence: model-review` only.
- **A second plan/retry loop in AVARICE** (FR-4). The only retry is CON-16, once.
- **Changing existing `--json` shapes** (Pitfall 12).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sandbox | A new containment mechanism | `SandboxedExecutor` + Seatbelt profile (verified working on the portfolio, see Probes) | Phase 1 mutation-tested it (FC-1..12) |
| Git safety | Raw `spawn('git')` | `runGit` + `SAFE_GIT_ENV` | A same-size file made plain `git status` run a hostile clean filter |
| Run IDs, digests, events | New helpers | `newId`, `digestOf`, `appendEvent` (1024/8192 limits) | Existing invariants and hash chain |
| Lease/fence/resume | New locking | `acquireLease`/`renewLease`/`releaseLease` generalized to `runs` columns (`lease_*` already exist) | Same semantics, tested |
| Kill points | Ad hoc kills | `faultPoint` and `fault-run.ts` catalog | AC-3 is judged on it |
| Arg parsing, command modules | Commander-style | `src/cli/args.ts` + `COMMANDS` allowlist + `export run/readOnly/booleanFlags/usage` | No runtime deps |
| TUI | `ink`/`blessed` | `node:readline`, raw mode, ANSI (ADR-013 6) | Footprint test |
| Hostname-filtered network for a sandboxed child | A Seatbelt hostname rule | Loopback-only Seatbelt + an in-repo CONNECT allowlist proxy | Seatbelt rejects hostnames (probe) |
| Test inventory | Parsing source with regexes alone | Runner list mode where declared (`vitest list`), plus a skip/focus marker scan over changed test files | Contracts doc "Protecting tests" |

**Key insight:** every control the spec asks for already has a Phase 1 implementation for the onboarding purpose. The risk in this phase is not missing machinery; it is that a real `/gsd-quick` run exercises command shapes (npm, git, branching, quick-task bookkeeping) that the onboarding-tuned hook and scope were built to deny.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted. One migration-like item: migration 0002 must be forward-only, checksummed, and tested against `test/fixtures/db/schema-v1.sqlite` (NFR-9); `migrate` already backs up with `VACUUM INTO` first. [VERIFIED: STATE.md decision 01-06]

## Common Pitfalls

### Pitfall 1: The installed Claude Code is not admitted
**What goes wrong:** `checkLaunchReady` refuses with `host-version-not-admitted:2.1.318`; every run ends `blocked_on_decision (enforcement_failure)`.
**Why:** `claude --version` reports 2.1.318; the admitted list stops at 2.1.317. Phase 1 admitted 2.1.317 by re-running the live T3 suite (21 cases, 0 containment failures, 0.1214 USD) with a harness-only override. [VERIFIED: deferred-items.md "claude 2.1.317 admission"]
**How to avoid:** Wave 0 task: run the existing live suite on 2.1.318 under `AVARICE_LIVE=1` (about 0.12 USD), then admit. Count it in the 25 USD ledger.
**Warning signs:** `status` shows `enforcement_failure` at the first launch.

### Pitfall 2: `/gsd-quick` needs a ROADMAP, branches, worktrees, and tries to commit
**What goes wrong:** The workflow errors if no ROADMAP.md exists ("Quick mode requires an active project with ROADMAP.md") [VERIFIED: ~/.claude/gsd-core/workflows/quick.md Step 2]. If `branch_name` is set it runs `git fetch origin` and `git checkout -b` (network, ref writes). If `workflow.use_worktrees` is not `"false"` it runs `worktree.reap-orphans` and may use harness-worktree isolation (`git worktree add`, writes into `.git`). The executor is told to "Commit each task atomically", and Step 8 runs `gsd_run query commit`.
**Why:** ADR-006's configuration list (`text_mode`, `gates.execute_next_plan`, `gates.confirm_transition`, `windows_enforce`, `audit.enabled`) predates reading these steps.
**How to avoid (prescriptive):** run-scoped `config-set`, applied by AVARICE before the first invocation and recorded as step `gsd:configure`: `workflow.text_mode=true`, `gates.execute_next_plan=false`, `gates.confirm_transition=false`, `audit.enabled=true`, `workflow.use_worktrees=false`, `commit_docs=false`, `git.branching_strategy=none` (verify the accepted value) and an empty `git.quick_branch_template`. All of these keys except `workflow.windows_enforce` exist in the GSD schema manifest [VERIFIED: grep of `~/.claude/gsd-core/bin/shared/config-schema.manifest.json` found `workflow.use_worktrees`, `commit_docs`, `git.branching_strategy`, `git.quick_branch_template`, `workflow.text_mode`, `audit.enabled`, `gates.execute_next_plan`, `workflow.plan_check`, `workflow.verifier`]; `workflow.windows_enforce` was **not** found there, so `config-set` may refuse it: test before listing it. Non-GSD repositories have no ROADMAP: refuse `start` with a clear message in Phase 2 (planning initialization is Phase 4).
**Warning signs:** a denied `git checkout`, `git fetch`, `git worktree` or `git commit` in the hook events.

### Pitfall 3: Hook command identity was built for onboarding
**What goes wrong:** The current hook admits `READ_ONLY_COMMANDS` plus GSD read verbs after the preamble, and refuses `;`, `&`, `<`, `>`, `$`, backtick, `(`, `)` outside quotes. The `/gsd-quick` orchestrator emits `INIT=$(gsd_run query init.quick ...)`, `QUICK_DIR=...`, conditionals, `gsd_run query commit`, `gsd_run quick-tasks-append`, `gsd_run query dispatch-isolation`. Phase 1 already hit this twice: intel's `gsd_run intel validate`/snapshot and the graphify skill's shell steps were all denied and had to be moved into AVARICE. [VERIFIED: deferred-items.md items 13, 14; src/domain/hook-decision.ts lexer comment]
**How to avoid:** Wave 0 live spike: run `/gsd-quick --validate --text "<trivial task>"` on a generated scratch repository (about 1 to 2 USD, Sonnet) with the run-purpose scope and record every hook deny. Then decide, per denied shape, between (a) admitting a GSD verb in `GSD_READ_VERBS.run` with its operand rules, (b) moving the step into AVARICE (as done for intel snapshot), (c) config that removes the step. Expected candidates: `query init.quick`, `config-get`, `agent-skills`, `dispatch-isolation`, `quick-tasks-append` (writes STATE.md), `query commit` (denied by design; returns a skip with `commit_docs=false`). The verb list must carry the GSD source line that justifies each, as the existing comments require.
**Also:** contract commands (`npm run typecheck`, `npm test`, `node --test`) the agent may run need a **run** command strategy: the hook admits only argv-exact entries from `execution.commands` (no `;`, `&&`, redirections), the sandbox contains the effects, and `npm`/`npx` leave `DENIED_COMMAND_PREFIXES` for the run purpose only when the contract lists them. `DENIED_COMMAND_PREFIXES` currently contains `'npm'`, `'npx'`, `'make'`, `'git commit'` [VERIFIED: src/domain/invocation-scope.ts].

### Pitfall 4: What does the real executor do when `git commit` is denied? (unobserved)
**What goes wrong:** the executor's task commit protocol uses raw `git add` then `git commit` [VERIFIED: gsd-executor.md lines 521 to 562 via grep]. A hook deny may make it retry, loop (CON-14 then fires), report the task failed, or write a SUMMARY claiming done. `commit_docs=false` only covers `gsd_run query commit` (docs), not the executor's code commits (agent file: `{committed: false, skipped: true, reason: 'skipped_commit_docs_false'}` is for the SDK commit verb).
**How to avoid:** the spike in Pitfall 3 must observe this. Candidate mitigations, cheapest first: (1) task text from the contract says "Edit files only. The supervisor commits. Do not run git add or git commit." (2) append an AVARICE addendum to the generated `--agents` JSON for `gsd-executor` (the adapter already rewrites agent files, e.g. strips `permissionMode`; see `src/adapters/gsd/agent-frontmatter.ts` and `agents-json.ts`) (3) hook returns a deny message that names the rule and the instruction. The classifier rule "clone HEAD moved => failed" then remains the backstop for D-03.
**Warning signs:** `permission_denials` for `git commit`, `no_progress` outcomes, SUMMARY without file changes.

### Pitfall 5: Quick-task bookkeeping writes inside the repository
`/gsd-quick` creates `.planning/quick/<id>-<slug>/{PLAN,SUMMARY,VERIFICATION}.md` and edits `.planning/STATE.md` (a "Quick Tasks Completed" row and "Last activity"). The portfolio's `.planning/` is a live GSD project (its Phase 5 is executing), so committing STATE.md edits to the review branch will conflict with the owner's work. **Recommendation:** make `.planning/quick/**` and `.planning/STATE.md` contract `artifacts` globs (writable, excluded from the reviewable diff, from the supervisor's commit pathspec, and from G2 scope conformance), and store the quick directory's files as run artifacts (`kind: gsd-quick-record`, `independence: model-review`). Confirm with the owner (Open Question 3). G2's scope check must be written against `files.write ∪ files.create ∪ files.artifacts`.

### Pitfall 6: `.avarice/config.json` is not in the pin tree (D-04 vs D-09)
The active record pins `9f1cd8d`; the portfolio's HEAD equals the pin today and has no `.avarice/` directory [VERIFIED: `git rev-list --count 9f1cd8d..HEAD` printed `0`; `git ls-tree 9f1cd8d --name-only` lists no `.avarice`]. When the owner commits the config, HEAD moves one commit past the pin, and a clone at the pin does not contain the file. **Recommendation:** read the conventions from the source's git objects (never the working tree) at a recorded `conventionsRevision`, accepted when it equals the pin or is a descendant of the pin whose `git diff --name-only pin..rev` lists only `.avarice/**`; the compiled contract (outside the clone) carries the checks, so the clone needs no copy. Define the D-04 staleness count as commits past the pin touching paths other than `.avarice/**`. [ASSUMED] pending owner confirmation (Open Question 1).

### Pitfall 7: Seatbelt cannot name hosts, so D-11 needs a proxy
**Verified this session:** a profile with `(allow network-outbound (remote ip "localhost:18081"))` let `curl` reach port 18081 (`ok18081`, exit 0) and refused port 18082 (curl exit 7); a profile naming `registry.npmjs.org:443` failed to compile: `sandbox-exec: host must be * or localhost in network address`.
**How to avoid:** a Node `http.Server` with a `'connect'` handler that accepts only `registry.npmjs.org:443`, bound to 127.0.0.1 on an ephemeral port; Seatbelt allows outbound only to that loopback port; `npm ci --ignore-scripts --https-proxy=... --proxy=...`. I could not run this end to end (my probe write was blocked by the auto-mode classifier, and I did not work around it), so the npm-through-proxy step is `[ASSUMED]` and is Wave 0 spike S2-C. Verify at the same time that npm 11 honours the proxy for CONNECT and that the lockfile's tarball URLs all resolve to `registry.npmjs.org` (a lockfile `resolved` host outside the allowlist fails closed, which is correct and should be a clear `unavailable` evidence).
**Also:** the proxy runs in the supervisor process only for the `npm ci` step; log each CONNECT target to a ledger event (host only, no URL path).

### Pitfall 8: The portfolio's checks need declared env and writable paths (verified)
Run under `SandboxedExecutor` against a scratch clone at 9f1cd8d with `npm ci --ignore-scripts` (1.5 s wall, `node_modules` 265 MB):
| Check | Result under sandbox | Cause |
|---|---|---|
| `typecheck` | EPERM until `node_modules/.tmp` writable, then passed (2.5 s) | `tsc -b` writes `node_modules/.tmp/*.tsbuildinfo` |
| `lint` | passed (0.5 s) | |
| `format:check` | **failed at base**: `[warn] index.html` | Genuine: `npx prettier --check index.html` fails unsandboxed in the same clone |
| `test` | EPERM on `node_modules/.vite-temp`, then `node_modules/.cache/imagetools`, then `node_modules/.vitest-cache`; passed (15 s) once those paths existed or were writable | vite, vite-imagetools, vitest caches |
| `check:case`, `check:colors`, `check:contrast`, `check:images` | passed | |
| `build` | failed: `VITE_SITE_ORIGIN is empty: set it in .env`; **passed** (3.2 s) with the variable in the check env | `.env` is untracked and not in the clone |
| `check:meta`, `check:budget`, `check:no-phone` | need `VITE_SITE_ORIGIN` and `dist/`; passed after the build | |
**Consequences for the plan:** (a) `.avarice/config.json` checks need per-check `env` (non-secret, committed) and a `writes` or shared `artifacts` list; the doc shape (`name`, `argv`, `timeoutSec`, `required`) is too small, so add optional `env` and `writes` and version the schema field. (b) Declare artifacts `["dist/**", "coverage/**", "node_modules/.tmp/**", "node_modules/.cache/**", "node_modules/.vite*/**", "node_modules/.vitest*/**"]`, or all of `node_modules/**`. (c) Redirect `HOME`, `TMPDIR`, `npm_config_cache` into a run scratch directory. (d) `format:check` failing at base is the first real exercise of D-12. (e) The checks never need network. (f) Full verify is about 30 s in the sandbox, so baseline plus final is cheap.

### Pitfall 9: D-12 contradicts G4 as written in `docs/contracts-and-state.md`
The G4 row says "Every required check `passed` on one clean revision". D-12 (a locked user decision) says pre-existing failures do not block. Implement D-12, record such checks as `failed` with a `preExisting: true` flag in `environment_json` or a new column (not a new status, to keep the evidence status set verbatim: `passed`, `failed`, `skipped`, `unavailable`, `inconclusive`, `stale`), map no acceptance criterion to a check that fails at base, and amend the G4 row and AUT-8 note in the docs in the same plan. Brief-targeted checks must pass; a brief that targets a base-failing check needs it to flip to `passed`.

### Pitfall 10: CON-7 read-before-edit is not implemented
The hook has no read digest state (grep for `read-before`, `changed since read`, `readDigest` in `src/` finds nothing). Claude Code's own Edit requires a prior Read, but AVARICE's control must not depend on it. **Design:** migration 0002 adds `hook_reads(invocation_id, agent_id, path, digest, seq)` (or reuses events with a digest field, but a table makes the pre-check one indexed read). PostToolUse for `Read`, `Edit`, `Write` records the digest of the file as the hook reads it from disk after the call (hooks run outside the sandbox; no need for `tool_response` fields, which I could not confirm). PreToolUse for `Edit`/`Write` on an existing file denies `edit-without-read` or `file-changed-since-read`; creation under `files.create` globs needs no prior read. Per-subagent keying via `agent_id`. A Bash write between a Read and an Edit gives a false "changed since read": the deny message must say "read the file again", and the denial counts toward CON-14. Bash writes remain outside this control by design (containment matrix).

### Pitfall 11: Classifier needs run facts and a pause signal
`classifyOutcome` rule 5 returns `progressed` only when `expectedFilesPresent`; a run unit has no fixed expected file list. Define for the run: expected = a SUMMARY file under the quick directory exists **and** the in-scope tree differs from the checkpoint commit (facts measured by AVARICE, never read from model text). `paused` is not derived anywhere today ("Phase 1 does no heuristic question detection"). For AUT-2 (decision record only) a unit that ends with no progress and a question must become `blocked_on_decision (decision)`: use structural signals first (`WAITING.json`, STATE.md `needs_human`, VERIFICATION status, final result ends in a numbered-choice prompt under text mode), and treat anything unclassifiable as consequential per the decision matrix, never auto-answered. The decision row uses the existing `decisions` table (class `acceptance` or `scope_expansion`; `urgency: blocking`).

### Pitfall 12: `--json` shapes are frozen (SC 7)
`getStatus` returns `ProjectStatus[]` and `status --json` prints exactly that. Add run data **additively**: an optional `runs` array on a project entry, present only when the project has runs, so a store with no runs prints byte-identical JSON to Phase 1. Add a frozen-shape test that snapshots the Phase 1 `--json` output of `status`, `onboard`, `resume` (including keys and key order) before restyling human text. Human text for `init`, `repo`, `status` and dispatcher errors does not yet meet OPS-7 [CITED: docs/extensions.md "Human-readable output"].

### Pitfall 13: Host and OS details that bite
- **Commit signing and identity:** the user's global git config can enable `commit.gpgsign` (prompt or hang with `GIT_TERMINAL_PROMPT=0`) or lack an identity. Supply identity and `commit.gpgsign=false` through allowlisted extra config.
- **Seatbelt cwd rule:** the executor protects the command's working directory and re-allows only declared paths, so a check that writes anywhere else in the clone fails with EPERM (seen above).
- **PATH:** `buildInvocationEnv` fixes PATH to the gsd-core bin plus `/usr/bin:/bin:/opt/homebrew/bin` [VERIFIED: src/adapters/host-claude/env.ts]; node and npm are at `/opt/homebrew/bin` here [VERIFIED: `which node npm`], so contained `npm` works, but a machine with node elsewhere would not. Probe at preflight.
- **`AVARICE_RUN` marker** is currently the onboarding ID; for runs set it to the run ID. The shell and `install-host` must refuse when it is set (FR-27, CS-11).
- **Supervisor detachment:** `spawn(process.execPath, [bin, 'supervise', runId], { detached: true, stdio: 'ignore' }).unref()` with its own process group; the lease TTL (default 180 s) and renew timer are the liveness signal `status` uses. A killed supervisor leaves a surviving host; `resume` reaps by session ID first (existing behavior to generalize).
- **Hook concurrency:** subagents (planner, checker, executor, verifier) call the hook concurrently; the read-digest writes must be inside the same `BEGIN IMMEDIATE` pattern as budget charges.
- **Subagent budget:** the quick validate flow spawns planner, up to two plan-checker iterations, executor, verifier (and code review only in `--full`). The preset needs `subagentsTotal` (suggest 8, derived and recorded like `subagentsDerivation`) and `subagentsConcurrent` 2; D-13 does not state them. Add the `gsd-planner`, `gsd-plan-checker`, `gsd-executor`, `gsd-verifier` agents to the run purpose's extensions (the `--agents` file) and the `gsd-quick` skill to the plugin dir. [VERIFIED: quick.md `<available_agent_types>`]

## Code Examples

### Seatbelt loopback-only network (verified this session)
```text
(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:18081"))
# allowed port: curl exit 0, body ok18081; other loopback port: curl exit 7
# (remote ip "registry.npmjs.org:443") -> sandbox-exec: host must be * or localhost in network address
```
Extend `SeatbeltInput` in `src/adapters/exec/seatbelt-profile.ts` with `allowLoopbackPorts: readonly number[]` (validated integers) and emit that line after `(deny network*)`.

### Existing check call shape to reuse (from the probe, `CommandSpec` fields verified in src/ports/command-executor.ts)
```typescript
const r = await executor.run({
  argv: ['npm', 'run', 'typecheck'],          // no shell string
  cwd: clonePath,
  env: { PATH, HOME: `${scratch}/home`, TMPDIR: `${scratch}/tmp`, npm_config_cache: `${scratch}/npm-cache`, CI: '1', VITE_SITE_ORIGIN },
  timeoutMs: 600_000,
  invocationId,
  writePaths: [scratch, `${clone}/node_modules/.tmp`, `${clone}/node_modules/.cache`, `${clone}/dist`],
  denyReadPaths: [`${home}/.ssh`, `${home}/.aws`, dataRoot],
});
// CommandResult.status: 'passed' | 'failed' | 'timed_out' | 'cancelled' | 'spawn_error'  -> evidence status mapping:
// passed->passed, failed->failed, timed_out->inconclusive, cancelled->inconclusive, spawn_error or unavailable error->unavailable
```

### Fault-injection spelling (existing)
`AVARICE_FAULT=after-checkpoint:launch:run#2 avarice start ...` SIGKILLs at the second time that checkpoint is committed. [VERIFIED: src/app/onboarding-service.ts `faultPoint`]

### Hook stop for loops (CON-14)
```json
{ "continue": false, "stopReason": "AVARICE: 3 consecutive denials; the run is stopped for escalation" }
```
`continue: false` stops Claude entirely and takes precedence over decision fields [CITED: https://code.claude.com/docs/en/hooks]. To deny one call use `hookSpecificOutput.permissionDecision: "deny"` with `permissionDecisionReason`. Record a `loop.limit` event and have the supervisor classify the ending as `denied` with the escalation reason.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `git worktree` staging | local clone (`STAGING_STRATEGY='clone'`) | Phase 1, 01-08 | Source `.git` outside the sandbox (D-01) |
| Agent commits (containment.md original) | Supervisor commits (D-03) | Phase 2 discussion | Host limitation 8 not on the critical path |
| Hook admits fixed read-only set | Per-purpose command identity incl. contract commands | Phase 2 | Needed for `npm` checks run by the agent |
| `sandbox-runtime` for AVARICE checks (docs proposal) | In-repo Seatbelt executor + loopback proxy | Phase 1 built the executor | The spike question is answered for checks (works); only `npm ci` network remains |

**Deprecated/outdated:** `docs/contracts-and-state.md` G4 row ("every required check passed") against D-12; the `.avarice/config.json` example (no `env`, no `writes`); ADR-006's five-key GSD config list; the doc statement that `sandbox-exec` is deprecated by Apple remains (kept behind the port).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | npm 11 honours `--https-proxy` with CONNECT through a loopback proxy and every lockfile `resolved` URL is on `registry.npmjs.org` | Pitfall 7 | `npm ci` cannot run sandboxed; fall back to coarse `*:443` (owner decision) or offline cache |
| A2 | `/gsd-quick --validate --text` completes under a run-purpose hook once the listed GSD config is set and a few verbs are admitted | Pitfalls 2 to 4 | Largest schedule risk; may need AVARICE-run steps or an agent addendum; budget 2 spike rounds |
| A3 | Conventions may be read from `HEAD` when `pin..HEAD` touches only `.avarice/**` | Pitfall 6 | Owner may prefer re-onboard or a pin bump; changes `start` preflight |
| A4 | `.planning/quick/**` and `.planning/STATE.md` should be artifacts, archived and excluded from the commit | Pitfall 5 | Reviewer loses GSD's own record on the branch; alternative is a second docs commit |
| A5 | `git.branching_strategy=none` is an accepted value and `workflow.windows_enforce` may not be a valid key | Pitfall 2 | `config-set` refusal during `configure` |
| A6 | Hook can read the file digest itself at PostToolUse (no `tool_response` fields needed) | Pitfall 10 | Race window between tool and hook read; low |
| A7 | Suggested `subagentsTotal` 8 and `subagentsConcurrent` 2 for `routine` | Pitfall 13 | A validate flow with two checker iterations may need more; budget_exhausted at the exit |
| A8 | Real-world sandboxed `vitest` pool and `vite build` need no network or sockets beyond what was exercised | Pitfall 8 | Verified for portfolio checks above; other repos untested |
| A9 | Three R1 tasks at Sonnet fit 5 USD per run | D-13/D-15 | No cost data for `/gsd-quick --validate` yet; the spike measures it |
| A10 | `status --json` additive `runs` field satisfies "every `--json` shape is unchanged" | Pitfall 12 | Owner may read the criterion as "no new keys at all" |

## Open Questions

1. **Conventions revision vs pin (D-04/D-09).** What we know: the pin tree has no `.avarice/config.json`; the owner commits it later. Unclear: whether the owner accepts reading it from a descendant commit that changes only `.avarice/**`. Recommendation: Pitfall 6 rule; ask at the first checkpoint.
2. **Staleness threshold (discretion).** Recommend: commits past the pin touching paths outside `.avarice/**` and `.planning/**`, refuse above 25 or above 14 days (configurable in profile config, lower-only like budgets). The portfolio is actively developed, so a zero threshold would refuse during the exit.
3. **Quick-task artifacts on the branch.** Archive and exclude (recommended) or second docs commit? Affects what the reviewer sees and STATE.md conflicts.
4. **`avarice start` blocking behaviour.** Does `start` return after spawning the detached supervisor (needed for SC 6: "closing the shell leaves the supervisor running"), with `--wait` for tests and the exit script? Recommend yes; exit code of `--wait` follows `onboard`: 0 ready, 3 not ready.
5. **Node 26.x support statement** (carried): the phase runs on 26.9.0; `scripts/test-matrix.sh` also needs a 22.22.3 binary.
6. **ONB-10 granularity.** Declared checks only. Which verdicts: `active`, `rejected(unexpected-write)`, `rejected(network)`, `unavailable`? Recommend recording per-check validation as ledger steps and refusing `start` when a required check is not `active`. A check whose base run fails (format:check) is still `active` (it ran and wrote only declared paths).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | yes | v26.9.0 (min 22.22.3) | none |
| npm | `npm ci`, portfolio checks | yes | 11.19.1 at /opt/homebrew/bin | none |
| git | clone, commit, fetch | yes | /usr/bin/git | none |
| `sandbox-exec` (Seatbelt) | checks, `npm ci` | yes (probe: `enforcement: enforced`) | macOS 24.5.0 | none; no sandbox means unavailable, never unsandboxed |
| Claude Code | live runs | yes, **not admitted** | 2.1.318 | re-run live T3 and admit (Pitfall 1) |
| GSD gsd-core | quick unit, config | yes | 1.17.0 | none |
| npm registry network | `npm ci` only | yes (reachable during research) | n/a | offline cache |
| Portfolio `~/aa-phan-portfolio-v2` | exit runs | yes, HEAD = pin 9f1cd8d, clean except untracked `.env` | | none |
| Playwright browsers | `test:e2e` | not needed (optional check) | | skip |

**Missing dependencies with no fallback:** none. **Blocking until done:** claude 2.1.318 admission.

## Probes Run This Session (evidence)

All on this machine, 2026-11-05, against a throwaway clone `/tmp/res-portfolio/clone` at `9f1cd8d` (the owner's checkout was only read with `git -C ... log/rev-list/ls-tree/show`):
1. Seatbelt loopback-port allow and hostname rejection (Pitfall 7 block above).
2. `npm ci --ignore-scripts` on the portfolio lockfile succeeded; `node_modules` 265 MB.
3. Per-check results under the real `SandboxedExecutor` (table in Pitfall 8).
4. `npm view @anthropic-ai/sandbox-runtime`: version 0.0.81, deps `zod`, `commander`, `node-forge`, `@pondwader/socks5-server`; legitimacy seam: `SUS` (`too-new`).
5. Not run: npm through the proxy end to end (write blocked by the auto-mode classifier; not retried).
Cleanup note for the executor of the plan: `/tmp/res-portfolio` and `/tmp/res-sbx` are scratch and safe to delete.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict`, Node >=22.22.3 (also dev 26.9.0) [VERIFIED: package.json scripts, 01-VALIDATION.md] |
| Config file | none (`package.json` scripts, `tsconfig.json`, `scripts/check-boundaries.ts`) |
| Quick run command | `node --test "test/unit/**/*.test.ts" && node scripts/check-boundaries.ts && npx tsc -p .` |
| Full suite command | `node --test` (T1 + T2; about 60 s in Phase 1, expect longer) on Node 22.22.3 and the dev Node: `AVARICE_NODE22=<node 22.22.3> bash scripts/test-matrix.sh` |
| Live tier | `AVARICE_LIVE=1 node --test test/containment/live-run.test.ts` (new; skipped unless set); spend recorded in `test/containment/LIVE-CASES.md` against the 25 USD ceiling |

Never pass a bare directory to `node --test`; use quoted globs. Tiers as Phase 1: T1 unit, T2 integration with fake host and real SQLite/git/sandbox, T3 live scratch repo, T4 exit runs on the portfolio.

### Phase Requirements -> Test Map
| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RC-1, RC-2, RC-3 | Contract has every RC-1 field; compiled from preset + conventions + brief; no confirmation path; G0 | unit | `node --test "test/unit/run-contract.test.ts"` | Wave 0 |
| RC-5 | Overrides lower only; run cannot raise budgets; `avarice` denied in run | unit + integration | `node --test "test/unit/run-contract.test.ts" "test/integration/run-selfamend.test.ts"` | Wave 0 |
| CON-1/2/3/5/6/13 (regression for `run` purpose) | scope, settings, hook policy per purpose | unit | `node --test "test/unit/invocation-scope.test.ts" "test/unit/claude-settings.test.ts" "test/unit/hook-decision.test.ts"` | extend existing |
| CON-7 | edit-without-read and changed-since-read denied; new file allowed under create; per-agent keys | unit + integration | `node --test "test/unit/hook-decision.test.ts" "test/integration/hook-read-digest.test.ts"` | Wave 0 |
| CON-8 | symlink and `..` out of scope denied; check outputs only at declared paths | integration | `node --test "test/containment/executor.test.ts" "test/integration/checks-writes.test.ts"` | extend + Wave 0 |
| CON-9, S-20 | source checkout byte-identical (HEAD, index, tree, refs except the one new ref) through fail, cancel, recover | integration | `node --test "test/integration/run-source-untouched.test.ts"` | Wave 0 |
| CON-14 | consecutive denials end the invocation and escalate; no-progress limit | unit + integration | `node --test "test/unit/hook-decision.test.ts" "test/integration/run-loops.test.ts"` | Wave 0 |
| CON-16, S-42 | crash with two written files: clone returns to last item checkpoint commit, one retry within budget, user file preserved or reset refused | fault | `node --test "test/fault/run-discard-retry.test.ts"` | Wave 0 |
| AUT-7/8/9, FR-5/6 | gates G2/G4 pure rules; evidence names commit + clean flag; AC mapping; D-12 delta; deleted test, `.skip`, check-config change, new override fail G2 | unit + integration | `node --test "test/unit/gates.test.ts" "test/unit/evidence.test.ts" "test/integration/run-gates.test.ts"` | Wave 0 |
| FR-1, FR-2, FR-4, RC-4, SC1 (offline) | brief to `ready_for_review` with fake host, no prompts, no AskUserQuestion in transcript (S-12) | integration | `node --test "test/integration/run-baseline-workflow.test.ts"` | Wave 0 |
| FR-7, NFR-6, AC-3, SC4 | kill at every run kill point; `resume` identifies the interrupted attempt in 100% of cases; S-3 verification interrupted shows paused | fault | `node --test "test/fault/run-killpoints.test.ts"` | Wave 0 |
| CON-13, NFR-6 | budgets persist across kill and resume; killed invocation charged | fault | `node --test "test/fault/budgets.test.ts" "test/fault/run-budgets.test.ts"` | extend + Wave 0 |
| NFR-9 | migration 0002 forward-only, checksummed, interrupted leaves old schema | fault | `node --test "test/fault/migrations.test.ts"` | extend (fixture v1 -> v2) |
| NFR-1/3/5 | no runtime deps, import boundary, local store | unit | `node --test "test/unit/footprint.test.ts" "test/unit/boundaries.test.ts" "test/unit/localfs.test.ts" && node scripts/check-boundaries.ts` | exists |
| OPS-2 | every run event has `runId` (+ `attemptId`/`invocationId` where applicable) | integration | `node --test "test/integration/run-events.test.ts"` | Wave 0 |
| FR-11, SC2 | `status` offline shows run state, last checkpoint, evidence, branch and commit; no model | integration | `node --test "test/integration/offline.test.ts" "test/integration/run-status.test.ts"` | extend + Wave 0 |
| OPS-7, SC7 | text styles per table; Phase 1 `--json` byte-identical | unit | `node --test "test/unit/render.test.ts" "test/unit/json-shapes.test.ts"` | Wave 0 (snapshot Phase 1 output first) |
| FR-27, SC6 | no-arg + both TTY + no `AVARICE_RUN` opens shell; otherwise usage exit 64; actions call command modules; leaving shell leaves supervisor; refuse under `AVARICE_RUN` | unit (injected streams) + integration | `node --test "test/unit/shell.test.ts" "test/integration/shell-supervisor.test.ts" "test/unit/cli-args.test.ts"` | Wave 0 |
| ONB-10 | each declared check validated in a sandboxed scratch clone; unexpected write or network fails validation; inactive until validated | integration | `node --test "test/integration/check-validation.test.ts"` | Wave 0 |
| D-11 | proxy allows only registry host; non-allowed CONNECT refused; Seatbelt loopback rule; `npm ci` recorded with lockfile digest | integration | `node --test "test/integration/allowlist-proxy.test.ts" "test/containment/executor.test.ts"` | Wave 0 |
| D-02/D-03 | commit pathspec excludes artifacts; fetch creates only `refs/heads/avarice/run_*`; idempotent re-run; equal-ref success, different-ref conflict | integration | `node --test "test/integration/run-handoff.test.ts" "test/integration/checkout-unchanged.test.ts"` | Wave 0 + extend |
| CS-1..4, 6, 7, 10..14; S-13, S-14, S-15 (SC3) | live scripted out-of-scope writes through Edit, Bash, Python fail; broken hook or missing sandbox -> `blocked_on_decision (enforcement_failure)`; no self-amendment | live T3 | `AVARICE_LIVE=1 node --test test/containment/live-run.test.ts` | Wave 0 |
| S-12, S-41, SC1 | three portfolio tasks `ready_for_review` with no human input | T4 | `scripts/exit-run-phase2.sh` (new, modelled on `scripts/exit-run.sh`; owner checkpoint first) | Wave 0 |
| `install-host` | writes `avarice-run` skill; refuses under `AVARICE_RUN`; idempotent; never under `~/.claude*` for data roots | integration | `node --test "test/integration/install-host.test.ts"` | Wave 0 |

### Sampling Rate
- **Per task commit:** the quick run command plus the task's own file(s)
- **Per wave merge:** full suite on Node 22.22.3 and the dev Node
- **Phase gate:** full suite green, the live T3 run-purpose suite green once on the admitted host version, three portfolio runs recorded, AC-3 100%, before `/gsd-verify-work`
- Known flake from Phase 1: `test/fault/killpoints.test.ts` failed once under full-suite CPU load and was green alone and on rerun; keep the run kill-point suite resilient the same way (serial, generous waits) [VERIFIED: 01-VALIDATION.md row ONB-1/NFR-6].

### Wave 0 Gaps
- [ ] `test/helpers/fake-agent-host.ts`: run-mode options (write in-scope files, write a SUMMARY, emit a pause question, `killAfterFiles`, crash, timeout, commit attempt, outcome kinds) driven through the real hook entry
- [ ] `test/helpers/run-fixtures.ts`: scratch repo with `package.json` scripts, `.planning/ROADMAP.md`, `.avarice/config.json`, a base-failing check; reuse `scratch-repo.ts`
- [ ] `test/helpers/fault-run.ts`: `RUN_KILL_POINTS` catalog and run-aware resume helper
- [ ] Snapshots of Phase 1 `--json` output (before any renderer change)
- [ ] `test/fixtures/db/schema-v1.sqlite` migrate-to-v2 expectations
- [ ] Spikes (live, counted in the 25 USD): S2-A claude 2.1.318 admission (about 0.12 USD); S2-B `/gsd-quick --validate --text` under a run-purpose hook on a scratch repo, commits denied (about 1 to 2 USD, repeat once); S2-C `npm ci` through the proxy (free); S2-D in-sandbox commit with `allowWrite` on the clone git dir, objects and run ref (limitation 8; about 0.1 USD or scripted without a model)
- [ ] Framework install: none

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (the file holds only `workflow._auto_chain_active`), so it is enabled. [VERIFIED: .planning/config.json]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (local single-user; GitHub auth is Phase 5) | n/a |
| V3 Session Management | no | n/a; lease and fence guard process concurrency |
| V4 Access Control | yes | Contract scope, hook allow-lists, sandbox `denyRead`/`denyWrite`, `AVARICE_RUN` refusal for shell, `install-host`, any future amend |
| V5 Input Validation | yes | Brief, `.avarice/config.json`, CLI flags and `--budget` treated as untrusted; validated in the compiler (as `onboarding-contract.ts`); path candidates judged by the hook |
| V6 Cryptography | no new use | SHA-256 digests via `node:crypto` only; never hand-roll |
| V7 Logging | yes | Hash-chained append-only `events`; IDs, counts, digests only; transcripts redacted before storage |
| V12 Files and resources | yes | Canonical-path checks, symlink refusal, `0600/0700`, atomic temp+rename |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection in the brief or repository text drives out-of-scope action | Tampering, Elevation | Brief and repo text are data in the prompt; write scope enforced by sandbox + hook, not by instructions (CS-1..4); adversarial brief case in live suite |
| Agent edits the check scripts, `package.json`, vitest/oxlint configs to pass a gate (AUT-9) | Tampering | Protected globs in the contract (portfolio draft: `package.json`, `package-lock.json`, `scripts/**`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `.oxlintignore`, `prettier.config.mjs`, `.prettierignore`, `.github/**`, `.avarice/**`), enforced by sandbox `denyWrite`, hook, and G2 diff; checks run from the contract, not from files the agent controls |
| Hostile repository content executes during supervisor steps (`npm ci` scripts, git hooks, filters) | Elevation | `--ignore-scripts`, `SAFE_GIT_ENV`, filter blanking, sandbox with loopback-only network; lockfile digest recorded |
| Exfiltration over the network during `npm ci` | Information disclosure | Proxy allowlist of one host; agent invocations get no network; env scrubbed (no tokens); `denyRead` on `~/.ssh`, `~/.aws`, data root |
| Fetch of hostile objects into the user's repository | Tampering | `transfer.fsckObjects=true`; only `refs/heads/avarice/run_*` ref created; hooks disabled; never a checkout; ref-collision refusal |
| Settings/hook/ledger tampering by the run | Tampering | Generated files in the data root (`denyRead`, outside write roots); ConfigChange hook; protected `--settings` path |
| Stale or duplicated supervisor advances a run | Tampering | Lease with fence token on every transition; takeover only after expiry |
| Hook fail-open | Elevation | `onFailure: "block"`, exit 2 on every internal error, launch refused without hook or sandbox (CS-12, CS-13) |
| Untrusted GSD output/transcript content shown in the shell | Spoofing | Strip control sequences from any model-derived string before rendering in the shell and in `status` text |
| `install-host` writes into a user config directory | Tampering | Refuse under `AVARICE_RUN`, refuse symlinked targets (as `graphify` install), idempotent, content digest recorded |

## Sources

### Primary (HIGH confidence)
- Repository source and docs read this session: `src/**` (ports, app, adapters, hook, cli, domain files cited above), `docs/containment.md`, `docs/contracts-and-state.md`, `docs/implementation-plan.md`, `docs/autonomy-and-decisions.md`, `docs/operations-and-testing.md`, `docs/extensions.md`, `docs/decisions/ADR-006` and `ADR-013`, `.planning/phases/01-*/{SKELETON,deferred-items,01-VALIDATION}.md`, `.planning/{REQUIREMENTS,STATE}.md`, `02-CONTEXT.md`
- `~/.claude/gsd-core/workflows/quick.md` and `~/.claude/gsd-core/bin/shared/config-schema.manifest.json` (GSD 1.17.0)
- Local probes (Seatbelt, sandboxed checks on the portfolio clone, `npm view`, legitimacy seam)

### Secondary (MEDIUM confidence)
- https://code.claude.com/docs/en/hooks (fetched; first 100,000 of about 286,000 characters read: `continue`/`stopReason`, `onFailure`, PreToolUse input fields)

### Tertiary (LOW confidence)
- None used as authority. PostToolUse `tool_response` field shapes were not read (design avoids needing them).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependency; versions probed)
- Architecture: MEDIUM-HIGH (extends a proven kernel; ledger generalization is the main design work)
- Pitfalls: MEDIUM (items 1, 7, 8, 9, 10 verified; items 2 to 4 are source reading, not observation of a live GSD run)

**Research date:** 2026-11-05
**Valid until:** 2026-11-12 for host-version facts (Claude Code ships often); 30 days for the rest
