---
gsd_state_version: "1.0"
milestone: v1.0
milestone_name: Contained Kernel
current_phase: 02
current_phase_name: Contained unattended run of one work item
status: executing
stopped_at: Completed 02-16-PLAN.md
last_updated: "2026-11-06T06:52:21.166Z"
last_activity: 2026-11-05
last_activity_desc: Phase 02 execution started
state_head: a929842ff54c283b3bb45cfdcaaf8951848944ae
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 48
  completed_plans: 42
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-05)

**Core value:** Set a goal and the boundaries, leave the desk, and come back to a verified, reviewable change or a short list of genuine blocking decisions, with containment that does not depend on the model behaving.
**Current focus:** Phase 02 — Contained unattended run of one work item

## Current Position

Phase: 02 (Contained unattended run of one work item) — EXECUTING
Plan: 17 of 22
Status: Ready to execute
Last activity: 2026-11-05 — Phase 02 execution started

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
| Phase 02 P01 | 55 min | 2 tasks | 13 files |
| Phase 02 P02 | 18 min | 2 tasks | 21 files |
| Phase 02 P03 | 19 min | 3 tasks | 14 files |
| Phase 02 P04 | 30 min | 3 tasks | 9 files |
| Phase 02 P05 | 25 min | 3 tasks | 11 files |
| Phase 02 P06 | 8 min | 3 tasks | 12 files |
| Phase 02 P07 | 45 min | 3 tasks | 14 files |
| Phase 02 P08 | 25 min | 3 tasks | 21 files |
| Phase 02 P10 | 17 min | 2 tasks | 20 files |
| Phase 02 P09 | 85 min | 2 tasks | 13 files |
| Phase 02 P12 | 25 min | 3 tasks | 19 files |
| Phase 02 P11 | 23 min | 2 tasks | 17 files |
| Phase 02 P13 | 38 min | 3 tasks | 23 files |
| Phase 02 P14 | 85 min | 3 tasks | 21 files |
| Phase 02 P15 | 19 min | 3 tasks | 20 files |
| Phase 02 P16 | 29 min | 2 tasks | 10 files |

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
- [Phase 02]: 02-01: Phase 2 live spend is one ledger (test/containment/live-spend-phase2.jsonl) with a 25 USD ceiling that AVARICE_PHASE2_CEILING_USD can only lower; fitsCap also requires fitsPhase2Ceiling and a corrupt ledger throws — D-15 as a mechanical guard; 0.2122 USD spent after plan 02-01
- [Phase 02]: 02-01: Claude Code 2.1.318 admitted on 22 live T3 tests with 0 containment failures (0.1596 USD); the case 19 knowledge-pass denial is a /var vs /private/var path-form refusal by the host, deferred, and Phase 2 run purposes must give the model symlink-resolved paths — CON-3: admit only on a recorded live run on that exact version
- [Phase 02]: 02-02: the status table is PROJECT, REPOSITORY, ACTIVITY, STATE, NEXT with the onboarding ID, resume line and record line below it; an interrupted onboarding shows ACTIVITY interrupted and a plain ledger word in STATE; NEXT is cut last, subject columns never
- [Phase 02]: 02-02: Phase 1 --json shapes are frozen by normalized snapshots committed before the renderer change (AVARICE_SNAPSHOT_WRITE=1 regenerates); every renderer string passes stripControl; composition failures are prefixed by the dispatcher, not hand-built
- [Phase 02]: 02-03: migration 0002 also carries insert-only triggers for evidence and gate_results (T-02-06); the run lifecycle and work item tables are pure tables in src/domain/run-lifecycle.ts and a Phase 1 carrier row (state onboarding) is invisible to every run method — The plan marks T-02-06 mitigate, and a schema trigger keeps the property for every later writer, as events already have
- [Phase 02]: 02-03: transitionRun writes state, checkpoint (seq max+1 per run) and a run.transition event in one transaction under the version and fence guard; work item blocked_on_decision may return to ready; entering delegated counts one attempt — Phase 3 decide needs a way to release a blocked item, and the discard-and-retry shows as two attempts
- [Phase 02]: 02-04: the routine contract compiler only narrows: a brief glob must sit inside a conventions write glob and off protected paths, budgets only lower (budget.<name>), check and agent commands starting with git, avarice, claude, gh, curl, wget, ssh, scp or sudo are refused, and G0 static failures are reported together under field g0 — RC-5 is enforced at the one place every later stage trusts; subagentsTotal 10 and invocations 3 carry recorded derivations (one CON-16 retry of a full quick unit fits), and policyRevision is digestOf(ROUTINE_PRESET)
- [Phase 02]: 02-05: G2 judges protected globs before write, create and artifact globs; a head failure is pre-existing only when the base failure was measured; pauseSignal is a structural fact and detectPause reads the numbered-choice text shape only as a last resort — AUT-9 and AUT-7: gates fail closed, model text can block but never pass or satisfy acceptance
- [Phase 02]: 02-06: S2-C confirmed A1 (npm 11.19.1 honours npm_config_https_proxy for CONNECT): a supervisor step gets one loopback port via CommandSpec.allowLoopbackPorts and an in-repo node:http/node:net allowlist proxy admits only registry.npmjs.org:443; the footprint test exempts exactly that one file and holds it to loopback-only, built-ins-only rules — D-11 needs no *:443 widening and no offline-cache fallback; plan 02-14 builds the install step on this
- [Phase 02]: 02-07: fetchIntoSource is create-only and fsck-checked with gc.auto and maintenance.auto off, commit uses literal pathspecs and add-then-commit-only-paths, and discard restores from a snapshot tree (user pre-run edits kept) unlinking added paths without following symlinks, so the source checkout is byte-identical and a crashed attempt is undone exactly to its checkpoint — D-02, D-03 and CON-16: the only write to the user's repository is one new refs/heads/avarice/run_* ref; discard names only paths from a tree difference and never uses reset, clean or checkout; conventions (D-16) and staleness (D-04) are read from git objects and no working-tree file
- [Phase 02]: 02-08: the run purpose's scratch directory is a scope field beside writeRoots, a missing ancestor listing is refused, and a contract command is matched before the denied prefixes only after the scope dropped every prefix that must stay denied — CON-2 and RC-5: writeRoots holds exactly the clone roots (empty for an empty write set), computeRunScope throws rather than leave a directory above a write root unlisted, protected globs (plus .git and GSD config) win over write globs, npm and npx leave the denied prefixes only for a contract-listed form, and git, avarice, claude and curl stay denied for every purpose
- [Phase 02]: 02-08: everything handed to the model for a run is in realpath form and runUnitPrompt cuts only the context pack to fit 32 KiB, refusing a brief that does not fit — 02-01 carried finding: the host refuses writes addressed through /var when the rules name /private/var, so TMPDIR, the npm cache, the host cwd and every rule path are canonical; cutting an acceptance criterion would let a run pass against a shorter brief than the owner wrote
- [Phase 02]: 02-10: start exits 3 for a preflight refusal and 64 for an invalid brief, budget override, G0 failure or missing flag; every rule is judged from repository objects before any write, in the order revision, descent, commits, age, conventions, planning (25 commits and 14 days outside .avarice/ and .planning/) — D-04, D-16 and RC-1: a refusal or an invalid request creates no row and no file, and an uncommitted edit of .avarice/config.json cannot change a contract
- [Phase 02]: 02-10: createRunWithContract stores the run with its base revision and branch, contract version 1 with five budget rows, the work items and their events in one transaction; the 0600 contract file in the data root is written after it by temp, fsync and rename — RC-1 and T-02-33: a killed start leaves nothing or a whole run, and a run without its file is rewritten from the ledger by the supervisor (plan 02-12)
- [Phase 02]: 02-09: A2 confirmed on round 2 of the live S2-B spike (planner, plan-checker, executor and verifier ran, verifier passed, HEAD unmoved, no write outside the write set, 0.8996 USD, 4 subagents); the model drove the unit with Read and its own agent prompts and issued no gsd_run verb, so the admitted verbs query config-get, loop render-hooks and init.quick --validate are pinned by unit tests only — a unit is judged from the quick directory, the VERIFICATION status line, the clone diff and HEAD, never the host outcome kind (both rounds ended denied on improvised shell lines); git.quick_branch_template removed from RUN_GSD_SETTINGS
- [Phase 02]: 02-12: start spawns a detached avarice supervise <runId> (own process group, stdio ignored, cwd the data root, unref'd); the supervisor takes the run lease, rewrites a missing contract file and runs the checkpointed stage for the committed state through the one faultPoint; verify-enforcement records G0 and blocks with enforcement_failure unless the host reports enforced, before any invocation; run invocations reserve and settle through the onboarding reservation and settle code, charging killed and orphaned ones — D-18, CON-3, CON-13 and FR-2: closing the shell leaves the supervisor running, a second supervisor is refused on a live lease, a dead one is reported as interrupted only when its PID is gone and its lease has lapsed, and the footprint test allows exactly one detached spawn (src/cli/spawn-supervisor.ts)
- [Phase 02]: 02-11: read-before-edit (SHA-256 recorded at PostToolUse in hook_reads, rules edit-without-read and file-changed-since-read) and loop limits (3 consecutive denials, 25 searches with no read: continue false plus a loop.limit event, search limit ROUTINE_PRESET.escalation.consecutiveSearches) are policy-gated denials set only by computeRunScope, so the onboarding purposes' hook decisions are unchanged — CON-7, CON-14 and NFR-5: stale edits fail, a stuck agent stops itself, every error path exits 2; the count is read by event seq inside the deny's own transaction; hook p95 about 94 ms with read recording on
- [Phase 02]: 02-13: a unit is judged from the clone, the quick records and measured facts, never the host outcome kind; G2 runs the required checks only when every other rule passes and stops a failing check before the commit, G4 re-proves them at the clean commit, and every other ending is one decision with a reason through blockRun - AUT-7 and FR-6: the run reaches ready_for_review only after a passed G4 row for exactly the handed-off commit, the GSD records and config.json are archived then restored or removed so the clone is clean, and a hand-off conflict leaves the user ref alone
- [Phase 02]: 02-13: start refuses with exit 3 and creates nothing when no admitted GSD is found; gate.result and decision.opened events carry the attempt ID; an item found delegated when the running stage starts is an error left to resume (02-16, 02-17) - RC-1 and OPS-2
- [Phase 02]: 02-14: a declared check is repository code, validated in a scratch clone (undeclared writes, network by proxy or error text) and cached per project, pin and that one check's spec before it can be evidence; the baseline is measured at the pin and the unit is judged against it, a failure at base and head is a preExisting flag on a failed row; the install is the only network step, through a registry-only proxy; the test inventory is measured by AVARICE after the invocation, and G2 holds the checks delta so a failing target stops at G2 - ONB-10, AUT-8, AUT-9, CON-8, D-11, D-12
- [Phase 02]: 02-15: status gains one optional runs key (last key of a project entry) built from ledger rows only; lastCheckpoint skips the closing none checkpoint; a resumable run with no live lease is shown paused (verification interrupted or supervisor interrupted) with its open attempt and step; inbox prints each issue on its own width-cut line; install-host refuses under AVARICE_RUN before the profile resolves and refuses symlinks and files without the marker line - FR-11, OPS-7, D-19, CS-11, RC-5, CON-6 — The Phase 1 JSON stays byte-identical (four snapshots unchanged); a refusal writes nothing
- [Phase 02]: 02-16: a crashed or wall-clock-killed unit with no moved HEAD is discarded to its snapshot and retried once; a second failure is a repeated_failure decision naming both attempts; a spent invocations budget blocks before the discard — CON-16 and FR-4: one retry, no competing loop, budgets charged stay charged
- [Phase 02]: 02-16: routeOutcome order is moved HEAD, spent budget, hook loop limit, then paused, denied, no_progress, discard-and-retry — A spent budget denies every later call, so the budget is the cause when a long unit also reaches three denials

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

Last session: 2026-11-06T06:52:21.007Z
Stopped at: Completed 02-16-PLAN.md
Resume file: None
