---
gsd_state_version: "1.0"
milestone: v1.0
milestone_name: Contained Kernel
current_phase: 02
current_phase_name: Contained unattended run of one work item
status: executing
stopped_at: Phase 2 context gathered
last_updated: "2026-11-05T10:04:43.545Z"
last_activity: 2026-11-05
last_activity_desc: Phase 01 complete, transitioned to Phase 2
state_head: 82e32ef84ce0e429c2b3139eccfd36873338e88b
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 48
  completed_plans: 26
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-05)

**Core value:** Set a goal and the boundaries, leave the desk, and come back to a verified, reviewable change or a short list of genuine blocking decisions, with containment that does not depend on the model behaving.
**Current focus:** Phase 2 — Contained unattended run of one work item

## Current Position

Phase: 02 (Contained unattended run of one work item) — READY TO EXECUTE
Plan: Not started
Status: Ready to execute
Last activity: 2026-11-05 — Phase 01 complete, transitioned to Phase 2

Progress: [█░░░░░░░░░] 14%

## Performance Metrics

**Velocity:**
- Total plans completed: 26
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 26 | - | - |

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
| Phase 01 P13 | 25 min | 2 tasks | 18 files |
| Phase 01 P14 | 22 min | 2 tasks | 24 files |
| Phase 01 P15 | 25 min | 2 tasks | 29 files |
| Phase 01 P16 | 95 min | 3 tasks | 8 files |
| Phase 01 P17 | 60 min | 2 tasks | 28 files |
| Phase 01 P18 | 33 min | 2 tasks | 25 files |
| Phase 01 P20 | 314 min | 4 tasks | 13 files |
| Phase 01 P19 | about 6 hours across three resumes | 3 tasks | 22 files |
| Phase 01 P21 | 14 min | 2 tasks | 8 files |
| Phase 01 P22 | 7 min | 2 tasks | 6 files |
| Phase 01 P23 | 11 min | 2 tasks | 5 files |
| Phase 01 P24 | 15 min | 2 tasks | 8 files |
| Phase 01 P25 | 45 min | 2 tasks | 11 files |
| Phase 01 P26 | 10 min | 2 tasks | 5 files |

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
- [Phase 01]: 01-13: the Seatbelt profile protects the command's cwd after the temp-area allowance and re-allows only declared write paths; no sandbox means no run (unavailable), never unsandboxed
- [Phase 01]: 01-13: sandbox-exec cannot nest, so offline tests inject a test-only InheritedSandboxExecutor through test-cli (AVARICE_TEST_OUTER_SANDBOX); production composition always uses SandboxedExecutor
- [Phase 01]: 01-13: graphify runs code-only with --max-workers 1, cwd staging, only outDir (outside staging) writable; install copies three files into .planning/graphs and refuses symlinked targets
- [Phase 01]: Index steps are an ordered registry (INDEX_STEPS) whose stored results fold into the record (foldIndexResults), so intel and knowledge plans fill a step without editing the stage loop or activate.ts
- [Phase 01]: An absent index (graphify missing, extract failed, invalid graph, timeout, stale after install) is recorded in indexes.absent with its reason and never blocks activation; disabled steps are not listed
- [Phase 01]: Activation re-checks the whole staging diff against every write set and blocks with enforcement_failure after a containment.finding event; AVARICE_TRACKED_WRITABLE lets a committed .planning/graphs file be regenerated
- [Phase 01]: Counted fault points name#N tell apart the two commits of one checkpoint; planning_ready now names index:code-graph as its first action
- [Phase 01]: The classifier puts a moved staging HEAD first (failed, headMoved) ahead of all other rules; a result with no boolean is_error, a non-zero exit or a signal is failed, never success
- [Phase 01]: An inconclusive host ending goes to validation so the retry rule applies once; denied, failed and no_progress block with a decision and are never retried
- [Phase 01]: The caller chooses the invocation session ID and records it in the launch step before launch, so resume can reap a surviving host by --session-id; the adapter reads the GSD preamble fingerprint from the located gsd-core and the unavailable host is kept when it is missing
- [Phase 01]: runCli defaults AVARICE_CLAUDE_BIN to a missing binary so no test launches a real claude; env knobs never replace the sandbox probe or the hook self-test
- [Phase 01]: The T3 live containment run (plan 01-16) found 0 containment failures on Claude Code 2.1.316 (20 live cases) at 0.2635 of 5.80 USD; case 14 (real fast onboarding) is blocked by validation path-references, a validator tolerance decision left to the owner or 01-19
- [Phase 01]: Live T3 harness drives the real ClaudeHostAdapter on the request the real onboarding stages produce, with the hook removed from a settings copy for defense-in-depth and missing-hook cases
- [Phase 01]: The stream-json parser reads decision_reason_type from the real system/permission_denied event
- [Phase 01]: 01-17: intel prompt is 'focus: full; project root: .' (S0-D form); intel accepted only when intel validate and intel diff pass; context sources are stateless and take the staging path in the query; non-code graph nodes are fenced as untrusted data; intel gets at most half the context budget
- [Phase 01]: 01-18: the merge lowers an EXTRACTED document edge to INFERRED (never raises a tier); expectedFiles for the knowledge pass is staging-relative (.avarice-knowledge/graphify-out/graph.json); general-purpose subagent admitted for the knowledge purpose only
- [Phase 01]: 01-18: a rejected merged graph is replaced by the code-only graph from the code step's build directory; the record states the merged node and edge counts next to the merged digest
- [Phase 01]: 01-20: mutation probing runs in scratch clones of the scanned commit, so the working tree never holds a mutation
- [Phase 01]: 01-20: MF-02 (strictAllowlist not a required key), MF-03 (nested node text uncapped), MF-04 (hook read check blind to glob/brace expansion) stay open as todo tests for the owner
- [Phase 01]: 01-19: the empty .planning/codebase AVARICE creates made GSD ask Refresh/Update/Skip; the contract's existing-map answer is now always passed to the mapper (8cc18b6)
- [Phase 01]: 01-19: exit run stopped after the rehearsals (0.1656 of 24 USD spent); target run withheld until the owner decides the full-map stamp, path-references tolerance and retry budget
- [Phase 01]: 01-19: invocations budget derived per mode (full/fast/paths 6, skip/adopt 3) with invocationsDerivation; killed invocations stay charged; overrides only lower (6477c32)
- [Phase 01]: 01-19: knowledge validation's forbidden-source rule applies to planning documents for any node and to anything under .planning/phases for pass-added nodes, so a code node from a tracked script there no longer rejects the index (0d930f3)
- [Phase 01]: 01-19: exit run complete: ~/aa-phan-portfolio-v2 active (1010 code, 24 document nodes, graph and intel at 9f1cd8d), kill -9 and resume to the same ID and pin, checkout unchanged, AC-1 1 s; default store tightened to 0600
- [Phase 01]: 01-21: resume reaps every started launch:* row (map, intel, knowledge) by session ID in a prelude step before reconcileInvocation; a failing reap stops the resume with all rows still started — T-01-44/T-01-72: relaunching or reading staging beside a surviving detached host is unsafe
- [Phase 01]: 01-22: staging diff uses --ignored=traditional (not --ignored=matching) with --untracked-files=all so a hostile committed .gitignore cannot hide an out-of-set write; parseStatus reads ! records as untracked; write sets unchanged; preflight status stays without an ignored mode
- [Phase 01]: 01-23: reads are allow-list confined (staging, readRoots, allowRead) in the shared readRule; recursive grep inside staging is denied under the default secret globs
- [Phase 01]: 01-23: every attached option value and word after -- of a read command is a path candidate; stray cluster characters are shell-option-value
- [Phase 01]: 01-24: workRoot is optional in ScopeInput; denyRead gets it last and allowRead the own staging last; the staging-containing root filter lives in the settings renderer only
- [Phase 01]: 261104-jnc: ScopeInput.workRoot is now required (supersedes 01-24's optional workRoot)
- [Phase 01]: 261104-l3t: shell grep dropped from READ_ONLY_COMMANDS (denied shell-not-allowed in every spelling); searches go through the Grep tool; bfs `find -rm` denied
- [Phase 01]: 01-25: knowledge coverage is judged per manifest document on the merged graph; below half (KNOWLEDGE_LIMITS.documentShare 0.5) is validation-failed, otherwise the record states documentsExpected and dropped.unread
- [Phase 01]: 01-25: .chunks.json carries absolute readPath and writePath (corpus root = knowledge invocation cwd); AssembledExtraction.usedFiles removed so coverage is never derived from chunk shape
- [Phase 01]: Plan 01-26: the live gate checks zero unread documents (stricter than the stage's at-least-half admission share), and an absent documentsExpected or dropped.unread stays null so a pre-01-25 record fails

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

- [Phase 1, carried to Phase 2]: Target `~/aa-phan-portfolio-v2` has committed GSD planning (its Phase 5 is executing, so HEAD moves) but no `.planning/codebase/`, intel or graph; adoption of a stamped map is Phase 3. Untracked `.env` sits outside the staging worktree. Pin the onboarded revision.
- [Phase 1]: ADR-001 accepts Node 22.x and 24.x; the developer machine runs Node 26.x. Decide the support statement.
- [Init]: GSD skills and agents live under `~/.claude-edu` while `gsd-core` workflows and templates live under `~/.claude`. Validate "whatever `CLAUDE_CONFIG_DIR` names" against this split (host limitation 7, `doctor --extensions`).
- [Init]: Phase numbering starts at 1; GSD 1.17.0 does not support a phase 0 (verified 2026-11-01).
- [Phase 6]: Owns no requirement IDs; it extends FR-4, AUT-6 and OPS-6 (owned by Phases 2, 3, 4). Flip ownership if preferred.
- [Phase 4]: Largest phase (28 requirements); consider splitting at planning time.
- [Intel]: SYNTHESIS.md says 111 normative requirements; the correct count is 105 (149 entries in total).
- [Open owner decisions, README 3-9]: GitHub and manual briefs only (A-3, A-4); `routine` preset limits and push or draft-PR permission; notification destination and check-in times; Mac awake only (A-8); NAS model and OS before Phase 7 (A-5); default promotion mode; enterprise questionnaire (A-6).
- [Spec]: ADR-007's adversarial-mutation-test license is unreviewed; the `avarice-bridge` manifest shape is assumed and must be confirmed before Phase 5.
- [Phase 1, backlog 999.1]: A real `avarice onboard --mode fast` reaching `active` with completeness `partial` is unchecked live (UAT test 13, deferred)
- [Phase 1, backlog 999.2]: The local-mount refusal (`local` flag heuristic, A6) is unverified against a real smbfs or nfs mount (UAT test 10, deferred)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261104-jnc | Close P-3 grep -d/--directories recursion bypass and fix review warnings WR-01, WR-03, WR-04 | 2026-11-04 | 974d8b1 | [261104-jnc-close-p-3-grep-d-directories-recursion-b](./quick/261104-jnc-close-p-3-grep-d-directories-recursion-b/) |
| 261104-l3t | Resolve WR-02: drop grep from the shell read-only commands (shell grep denied by name; search via Grep tool) and deny bfs find -rm | 2026-11-04 | 07e6a34 | [261104-l3t-resolve-wr-02-establish-which-grep-the-c](./quick/261104-l3t-resolve-wr-02-establish-which-grep-the-c/) |
| 261104-nxh | Fix Phase 1 code review warnings WR-01 (runtime check that workRoot is a normalized absolute path) and WR-02 (npm test now exercises the missing-work-root guard) | 2026-11-04 | e50de6f | [261104-nxh-fix-phase-1-code-review-warnings-wr-01-a](./quick/261104-nxh-fix-phase-1-code-review-warnings-wr-01-a/) |
| 261105-2i2 | Fix phase 01 code-review findings WR-05..WR-08 (parseArgs prototype names, gsd_run argument checks, sandbox probe retry, exit-run spend guard) | 2026-11-05 | 4ac1127 | [261105-2i2-fix-phase-01-code-review-findings-wr-05-](./quick/261105-2i2-fix-phase-01-code-review-findings-wr-05-/) |

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Requirement | FR-23 review-only reconciliation (unscheduled, extension catalog entry 13) | Deferred | 2026-11-01 | v1.0 |

## Session Continuity

Last session: 2026-11-05T08:50:00Z
Stopped at: Phase 2 context gathered
Resume file: .planning/phases/02-contained-unattended-run-of-one-work-item/02-CONTEXT.md
