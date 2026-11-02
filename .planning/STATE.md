---
gsd_state_version: "1.0"
milestone: v1.0
milestone_name: Contained Kernel
current_phase: 01
current_phase_name: Contained onboarding of one repository
status: executing
stopped_at: Completed 01-12-PLAN.md
last_updated: "2026-11-02T23:32:50.626Z"
last_activity: 2026-11-02
last_activity_desc: Phase 01 execution started
state_head: 0dc4667e033258d6a318967ceec835c964a6e789
progress:
  total_phases: 8
  completed_phases: 0
  total_plans: 20
  completed_plans: 12
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-01)

**Core value:** Set a goal and the boundaries, leave the desk, and come back to a verified, reviewable change or a short list of genuine blocking decisions, with containment that does not depend on the model behaving.
**Current focus:** Phase 01 — Contained onboarding of one repository

## Current Position

Phase: 01 (Contained onboarding of one repository) — EXECUTING
Plan: 13 of 20
Status: Ready to execute
Last activity: 2026-11-02 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 25 min | 3 tasks | 14 files |
| Phase 01 P02 | 84 min | 2 tasks | 68 files |
| Phase 01 P03 | 11 min | 2 tasks | 16 files |
| Phase 01 P04 | 15min | 2 tasks | 11 files |
| Phase 01 P05 | 12 min | 2 tasks | 16 files |
| Phase 01 P06 | 19 min | 3 tasks | 14 files |
| Phase 01 P07 | 9 min | 2 tasks | 19 files |
| Phase 01 P08 | 17 min | 3 tasks | 18 files |
| Phase 01 P09 | 91min | 2 tasks | 23 files |
| Phase 01 P10 | 41 min | 2 tasks | 19 files |
| Phase 01 P11 | 15min | 3 tasks | 17 files |
| Phase 01 P12 | 19 min | 2 tasks | 20 files |

## Accumulated Context

### Decisions

Full log in PROJECT.md Key Decisions. All 12 ADRs are Proposed; none is locked.

- [Init]: Phase N mirrors slice N−1 (Phases 1-8 = slices 0-7; renumbered 2026-11-01 because GSD 1.17.0 `roadmap.analyze` and `get-phase` ignore a phase 0); a shared requirement ID maps to the phase that completes its MVP scope (roadmapper decision, confirm)
- [Init]: Host baseline Claude Code + GSD 1.17.0; config dir is whatever `CLAUDE_CONFIG_DIR` names, default `~/.claude`, nothing hard-coded (decided 2026-11-01)
- [Init]: Slice 0 exit target is `~/aa-phan-portfolio-v2` (decided 2026-11-01)
- [Phase 01]: ID prefixes include the underscore (newId('onb_', ...)); ulid and newId take time and 10 random bytes as arguments
- [Phase 01]: Onboarding contract: per-purpose write maps, files.readExclude and files.secretGlobs separate from files.read, flat budget override keys, request and preflight validated as untrusted input
- [Phase 01]: completenessFor never claims complete without evidence; buildProjectRecord defaults grant no write paths, endpoints or credentials
- [Phase 01]: Vendor tool names kept out of the domain contract; execution.toolClasses only (SKELETON vendor-code placement)
- [Phase 01]: S0-A: Bash command identity is a PreToolUse hook concern (skills pre-approve Bash, hook allow and deny hold under dontAsk), not a permissions.allow concern
- [Phase 01]: S0-B: stage onboarding in a local clone; a linked worktree is safe only with generated denyWrite on the source .git and worktree gitdir (without it a contained run moved a source ref)
- [Phase 01]: S0-C/E: env allowlist gains USER and LOGNAME, PATH starts with gsd-core/bin, CLAUDE_CODE_DISABLE_AUTO_MEMORY=1; --setting-sources empty already excludes CLAUDE.md
- [Phase 01]: S0-D: intel runs as claude -p --agent gsd-intel-updater with the agent in --agents (no Agent tool)
- [Phase 01]: S0-F: default budgets wall clock map 8, intel 5, knowledge 6 min, toolCalls 300, costUsd perInvocation 1.00 perRun 3.00; AVARICE enforces its own wall clock (host holds -p 10 min on a stalled subagent)
- [Phase 01]: S0-G: knowledge pass needs graphify dir on PATH for that invocation; document edges return EXTRACTED and are re-tagged by AVARICE
- [Phase 01]: Ledger methods take nowMs from the caller and SqliteLedger takes an id function; the adapter reads no clock
- [Phase 01]: Blocked reason rides in the onboarding.transition event data (OnboardingRow.reason reads the latest); blocked requires a reason
- [Phase 01]: Checkpoint seq is continuous across the onboarding ID and its contract run ID
- [Phase 01]: acquireLease grants only a free lease in 01-03; expiry takeover is 01-06
- [Phase 01]: Command modules export run, readOnly and booleanFlags; status opens the store read-only after migrating
- [Phase 01]: Events limited to 1024-char strings and 8192 chars; stored bodies limited to 1 MiB (enforces no document text in the ledger)
- [Phase 01]: 01-04: prepare reuses a staging worktree whose HEAD contains the pin; pin, onboarding ID and work root validated before any side effect
- [Phase 01]: 01-04: S0-B recommends the local clone over the worktree (source .git ref writable); worktree kept behind STAGING_STRATEGY until 01-08 and the owner decide
- [Phase 01]: 01-05: contract-compiler refusals (promote other than none, over-preset budgets) block the onboarding at discovered with reason decision, exit 3, before any contract or staging exists
- [Phase 01]: 01-05: stages commit through StageContext (checkpoint/transition/activate) so generic kill points fire; a checkpoint names the action about to run and is committed before its side effect
- [Phase 01]: 01-05: validation retry = one attempt row per rejection, remap while attempts <= contract retry (1), then blocked(decision); planning_ready transition writes next action activate until 01-14 adds index steps
- [Phase 01]: 01-06: a lease is expired only when its expiry instant is strictly before now; renewal checks holder and fence, not expiry; resume on a stop state takes no lease
- [Phase 01]: 01-06: reconcile of an interrupted mapping goes mapping->paused->mapping (relaunch) or ->validating with invocation.reconciled when every required map file is present; a round has an invocation iff launch:map rows exceed validate rows
- [Phase 01]: 01-06: migrate backs up with VACUUM INTO to backups/ beside the store before the first pending migration (default derived from db.location, composition untouched), one transaction per migration, checksum mismatch refuses with 'store schema v{n} checksum mismatch: refusing to start'
- [Phase 01]: 01-07: resolveProfile returns Result, realpaths only for the checks and returns the configured paths; roots that equal or contain the home or Claude config directory are also refused
- [Phase 01]: 01-07: openDb runs the SQLite WAL-reset gate first (PortError unsupported gains detail) and creates the store file 0600; a command module may export usage() to refuse before the profile is resolved
- [Phase 01]: 01-07: local-mount check fails closed when the mount table cannot be read; the local flag is a heuristic (A6), unverified against a real network volume
- [Phase 01]: Staging strategy is clone (owner decision, plan 01-08 Task 1) on the S0-B evidence; STAGING_STRATEGY='clone', the worktree adapter stays behind the port
- [Phase 01]: runGit blanks repository filter drivers per call (neutralizeFilters), refuses global git options and -c/--config-env, sets GIT_CONFIG_NOSYSTEM and GIT_ATTR_NOSYSTEM: a same-size modified file made plain git status run a hostile clean filter
- [Phase 01]: Promotion other than none is refused in preflight (exit 64, nothing created), superseding 01-05's contract-stage block; an active record or an in-flight onboarding gives existing_state_conflict (exit 3); a discovered onboarding is continued, so onboard follows repo add
- [Phase 01]: Preflight reads existing state from git objects at the pin only (cat-file, ls-tree, log -S); map user-edited means a commit after the stamp-writing commit or uncommitted changes under .planning/; every existing-map class regenerates in isolation, adoption deferred
- [Phase 01]: 01-09: the mapping:plan step (not the contract) is the mapping mode in force; non-brownfield repositories skip mapping (mode skip, completeness none); an explicit GSD_HOME is judged alone and never replaced by another install
- [Phase 01]: 01-10: tracked files may change in staging only in .planning/config.json and inside an invoked agent write set (Refresh regenerates a committed map); coverage scope and completeness come from the validate step; commands from .avarice/config.json are recorded inactive; artifact kinds are map-document and map-snapshot with retention onboarding
- [Phase 01]: 01-11: Bash strategy blanket-bash-hook-identity (ONBOARDING_BASH_STRATEGY in invocation-scope.ts): blanket Bash allow, AVARICE PreToolUse hook is the command-identity control, sandbox confines effects
- [Phase 01]: 01-11: Launch is gated by assertLaunchArgsSafe (refuses bypass, non-dontAsk modes, missing settings/budget) and checkLaunchReady (settings keys, blocking hook and script, sandbox probe, claude 2.1.312/2.1.316); every refusal is enforcement_failure
- [Phase 01]: Hook decision lives in a pure domain function with an injected canon(); the hook entry is lean (node, decision, digest, events, canonical-path) and every error path is process.exit(2)
- [Phase 01]: An Agent call charges only subagentsTotal; a subagent's own tool calls charge toolCalls through the same hook
- [Phase 01]: Budget rows are created with the contract and only grow in used: createBudgets is INSERT OR IGNORE, a killed invocation's reservation is settled as spent, nothing is refunded or raised
- [Phase 01]: Hook events carry tool, rule, IDs and a staging-relative target only (long targets truncated plus digest); the ledger's 1024/8192 event limits stay unchanged

### Pending Todos

None yet.

### Pre-Build Spikes (closed 2026-11-01)

Results in `spikes/2026-11-01-pre-slice-0/README.md`; the spec was updated the same day.

1. **Containment limitations 1, 2, 5, 6** pass on Claude Code 2.1.316. **Limitation 7** fails as specified: `--setting-sources ""` drops every user skill and agent. Decision: the launch line adds a generated `--plugin-dir` (skills) and `--agents` file (GSD subagents), both verified.
2. **New:** the sandbox always allows shell writes under the working directory. Decision: `denyWrite` every existing out-of-scope worktree entry, and let the diff gate detect new entries. Worktrees and scratch must not live under `~/.claude*`.
3. **Knowledge pass:** scope with `.graphifyignore` (allowlist negation works); `graphify extract --out` keeps the tree clean; `merge-graphs` keeps confidence tiers but namespaces node IDs and drops `built_at_commit`. Decision: AVARICE merges code and document graphs itself in one ID space.
4. **SQLite:** Node 22.13.0 bundles SQLite 3.47.2 without the WAL-reset fix. Decision: minimum Node 22.22.3 (SQLite 3.51.3) or 24.15.0.

Later spikes: sandbox runtime wrapping AVARICE's own checks and host limitation 8 (Phase 2); host limitations 3 and 4 and the graphify relation-to-read-rule mapping (Phase 4).

### Blockers/Concerns

- [Phase 1]: Target `~/aa-phan-portfolio-v2` has committed GSD planning (its Phase 5 is executing, so HEAD moves) but no `.planning/codebase/`, intel or graph; adoption of a stamped map is Phase 3. Untracked `.env` sits outside the staging worktree. Pin the onboarded revision.
- [Phase 1]: ADR-001 accepts Node 22.x and 24.x; the developer machine runs Node 26.x. Decide the support statement.
- [Init]: GSD skills and agents live under `~/.claude-edu` while `gsd-core` workflows and templates live under `~/.claude`. Validate "whatever `CLAUDE_CONFIG_DIR` names" against this split (host limitation 7, `doctor --extensions`).
- [Init]: Phase numbering starts at 1; GSD 1.17.0 does not support a phase 0 (verified 2026-11-01).
- [Phase 6]: Owns no requirement IDs; it extends FR-4, AUT-6 and OPS-6 (owned by Phases 2, 3, 4). Flip ownership if preferred.
- [Phase 4]: Largest phase (28 requirements); consider splitting at planning time.
- [Intel]: SYNTHESIS.md says 111 normative requirements; the correct count is 105 (149 entries in total).
- [Init]: No `.planning/config.json` yet (granularity, phase ID convention, workflow toggles).
- [Open owner decisions, README 3-9]: GitHub and manual briefs only (A-3, A-4); `routine` preset limits and push or draft-PR permission; notification destination and check-in times; Mac awake only (A-8); NAS model and OS before Phase 7 (A-5); default promotion mode; enterprise questionnaire (A-6).
- [Spec]: ADR-007's adversarial-mutation-test license is unreviewed; the `avarice-bridge` manifest shape is assumed and must be confirmed before Phase 5.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirement | FR-23 review-only reconciliation (unscheduled, extension catalog entry 13) | Deferred | 2026-11-01 | v1.0 |

## Session Continuity

Last session: 2026-11-02T23:32:46.213Z
Stopped at: Completed 01-12-PLAN.md
Resume file: None
