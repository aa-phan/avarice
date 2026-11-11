# Roadmap: AVARICE

## Overview

AVARICE is built in eight vertical slices; Phase N mirrors slice N−1 of `docs/implementation-plan.md` (Phases 1-8 = slices 0-7), because GSD 1.17.0 does not parse a phase 0. The first milestone (v1.0, Phases 1-3) builds the contained kernel: Phase 1 onboards one real repository under containment with GSD as the mapper, Phase 2 runs one work item unattended inside an OS sandbox with fail-closed hooks, and Phase 3 adds decisions, independent work around them and contract amendments. Containment is built in from the first slice and not deferred to a hardening phase. Phases 4 and 5 (v1.1) complete the PRD's MVP with profiles, retrieval, restricted mode, the portability proof, delivery to a draft PR, test-strength gates, the dashboard and data safety. Phases 6 to 8 (v2.0) are post-MVP and start only when a measured need exists. Implementation itself runs through GSD 1.17.0 on Claude Code.

## Milestones

- 🚧 **v1.0 Contained Kernel** - Phases 1-3 (slices 0-2; first milestone)
- 📋 **v1.1 MVP Completion** - Phases 4-5 (slices 3-4; completes the PRD's MVP)
- 📋 **v2.0 Post-MVP Extensions** - Phases 6-8 (slices 5-7; trigger-driven)

## Phases

**Phase Numbering:**
- Integer phases (1-8): Planned milestone work; phase N is slice N−1 of the implementation plan
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

**v1.0 Contained Kernel**

- [x] **Phase 1: Contained onboarding of one repository** - `avarice onboard` takes one existing repository to an active project record with GSD as the mapper, source read-only (completed 2026-11-05)
- [x] **Phase 2: Contained unattended run of one work item** - `avarice start` takes one work item to `ready_for_review` or `blocked_on_decision` inside enforced containment (completed 2026-11-08)
- [ ] **Phase 3: Decisions, independent work and amendments** - Runs continue independent work around an open decision, take a validated answer, resume the paused GSD session and finish

**v1.1 MVP Completion**

- [ ] **Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof** - Separate profiles, progressive retrieval with enforced caps, explicit degradation, proof that domain code is adapter-independent
- [ ] **Phase 5: Delivery, test strength, review feedback and data safety** - From `ready_for_review` to a pushed branch and draft PR, back to a new attempt on feedback, with no duplicate PRs

**v2.0 Post-MVP Extensions**

- [ ] **Phase 6: GSD capability bridge, phased work, plugin and push notifiers** - Gates inside GSD's loop, `/gsd-autonomous --only N` units, one-step install, notifications away from the desk
- [ ] **Phase 7: Personal infrastructure** - NAS artifacts, remote worker, coordination service, Vault adapter; each part starts only on a measured trigger
- [ ] **Phase 8: Cross-repository runs and project groups** - One unattended run spans several repositories of a project group and ends with one linked change request per repository

## Phase Details

### Phase 1: Contained onboarding of one repository

**Goal**: As a solo developer, I want to onboard one existing repository into AVARICE, so that later unattended runs start from an active project record with a code-and-document graph.
**Mode**: mvp
**Depends on**: Nothing (first phase). Pre-execution spikes closed 2026-11-01 (see STATE.md and `spikes/2026-11-01-pre-slice-0/README.md`)
**Requirements**: ONB-1, ONB-2, ONB-3, ONB-4, ONB-5, ONB-7, ONB-8, ONB-9, ONB-12, ONB-13, ONB-14, FR-20, SEC-5, NFR-2
**Partial coverage** (owned by the later phase): CON-2, CON-3, CON-5, CON-6, CON-13, NFR-1, NFR-3, NFR-5, NFR-6, NFR-9 (Phase 2, delivered here for the onboarding contract); ONB-6 (Phase 4; this phase delivers detection and refusal only)
**Success Criteria** (what must be TRUE):
  1. `~/aa-phan-portfolio-v2` reaches an active project record (promotion `none`) whose graph lists code nodes and document nodes, and whose graph and intel each record a build commit equal to the onboarded revision; the user's checkout is unchanged
  2. During mapping, a scripted source edit through Edit, Bash and Python is blocked, and so is a scripted edit of the policy file
  3. With the hook removed, the generated settings missing or the sandbox unavailable, onboarding stays `blocked` and never runs unrestricted
  4. Killing mapping part-way and running `avarice resume` reaches the same active record
  5. On a fresh Mac with Node present, install to first successful `avarice status` takes under 10 minutes with no admin rights (AC-1)

**Plans:** 26/26 plans complete (01-21 to 01-24 close the 01-VERIFICATION.md gaps)

Plans:
- [x] 01-25-PLAN.md
- [x] 01-26-PLAN.md

**Wave 1**
- [x] 01-01-PLAN.md — Toolchain gates (pinned dev deps, tsc, boundary lint) and pure domain contracts
- [x] 01-02-PLAN.md — Wave 0 live spikes S0-A..S0-G under an authorized spend cap

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-03-PLAN.md — Tracer: `bin/avarice status` on a migrated ledger; complete onboarding Ledger
- [x] 01-04-PLAN.md — Staging worktree with safe git, artifact store, fail-closed unavailable host

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-05-PLAN.md — Tracer: onboard with the fake host → active → status; fail-closed production path

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-06-PLAN.md — Resume, leases, kill-point suite, migration safety
- [x] 01-07-PLAN.md — `avarice init`, root rules, SQLite runtime gate, AC-1 timing, offline suite
- [x] 01-08-PLAN.md — Staging strategy decision, safe git hardening, preflight, ONB-6 detection and refusal, `repo add`
- [x] 01-09-PLAN.md — GSD 1.17 adapter: locate, identity, staging probe and configure, fast-map stamp, mapping mode
- [x] 01-10-PLAN.md — Full artifact validation, completeness labels, record builder, narrowing, snapshot
- [x] 01-11-PLAN.md — Bash strategy decision, invocation scope, Claude settings, env, launch argv, agents, plugin, launch preflight

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-12-PLAN.md — Fail-closed PreToolUse/PostToolUse/ConfigChange hook and persisted budgets
- [x] 01-13-PLAN.md — Sandboxed executor, sandboxed GSD verbs, graph tool adapter

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-14-PLAN.md — Index step registry, code-only graph step, final scope check
- [x] 01-15-PLAN.md — Contained Claude Code host adapter, outcome classifier, hook self-test, orphan reaping (spend-free SC3)

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 01-16-PLAN.md — Live containment suite T3 on a scratch repository
- [x] 01-17-PLAN.md — Intel index step and `avarice context` over gsd-intel and gsd-graph
- [x] 01-18-PLAN.md — Knowledge pass with AVARICE graph merge and document-node validation

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 01-20-PLAN.md — Mutation and adversarial testing of the containment, validation and ledger units before the exit run

**Wave 9** *(blocked on Wave 8 completion)*
- [x] 01-19-PLAN.md — Rehearsal and exit run on ~/aa-phan-portfolio-v2 with kill and resume, AC-1 recorded

**Gap closure, Wave 1** *(from 01-VERIFICATION.md gaps P-1 to P-3)*
- [x] 01-21-PLAN.md — Resume reaps every interrupted launch (map, intel, knowledge) by session ID; kill cases inside the intel and knowledge invocations (CR-01)
- [x] 01-22-PLAN.md — Staging diff lists files a hostile `.gitignore` hides; hostile-repository tests for validate and activate (CR-03)
- [x] 01-23-PLAN.md — Hook read allow-list, attached option values and operands after `--`, recursive-grep rule; every P-3 case as a unit test (CR-02)

**Gap closure, Wave 2** *(blocked on 01-23)*
- [x] 01-24-PLAN.md — Work root in hook and sandbox denyRead with the own staging re-allowed, production-path proof, CON-1 row in docs/containment.md (CR-02)

**Notes**: Technical goal: `avarice onboard --policy onboarding` takes one existing local Git repository (`~/aa-phan-portfolio-v2`) to an active project record, with GSD as the semantic mapper, GSD intel and graph indexes recorded, source read-only and writes confined to the staging worktree. Suits `/gsd-mvp-phase`. Kernel built here: package skeleton with import-boundary lint, ledger on `node:sqlite`, contract compiler with the `onboarding` preset, staging worktree, generated host settings and hook set, contained Claude Code host adapter, `GsdOnboarding` adapter for GSD 1.17.x, index stage and knowledge pass, `gsd-intel` and `gsd-graph` adapters. The target already has committed GSD planning but no codebase map, so this phase exercises detection and non-overwrite of existing planning state, not adoption of a stamped map (Phase 4). Excluded: remote workers, dashboard, `ingest-docs`, path-scoped and incremental refresh, promotion `copy` and `commit`, active command validation.

### Phase 2: Contained unattended run of one work item

**Goal**: `avarice start --brief b.md --policy routine` takes one work item to `ready_for_review` without prompts, or to `blocked_on_decision` with a decision record, inside enforced containment, surviving a kill at any point
**Depends on**: Phase 1 (an active project record for the target repository; a spike confirming the sandbox runtime can wrap AVARICE's own check commands)
**Requirements**: RC-1, RC-2, RC-3, RC-4, RC-5, CON-1, CON-2, CON-3, CON-5, CON-6, CON-7, CON-8, CON-9, CON-13, CON-14, CON-16, AUT-7, AUT-8, AUT-9, FR-1, FR-2, FR-4, FR-5, FR-6, FR-7, FR-11, FR-27, NFR-1, NFR-3, NFR-5, NFR-6, NFR-9, OPS-2, OPS-7, ONB-10
**Partial coverage** (owned by the later phase): AUT-2 (decision record only) and AUT-12 (states and cancellation for one item) in Phase 3; SEC-2 (scrubbed environment, no credentials in the run) in Phase 4; FR-3 (context packs from the four MVP adapters) in Phase 3. FR-4 here is Stage 1 only; the Stage 2 capability extends it in Phase 6
**Success Criteria** (what must be TRUE):
  1. Three R1 benchmark tasks (routine, no decisions expected) on a real repository, each started with `avarice start --brief <file> --policy routine`, reach `ready_for_review` with no human input after start
  2. Every `ready_for_review` run carries evidence naming the exact verified revision (commit and clean-tree flag), required checks passed, and each acceptance criterion mapped to deterministic evidence; `avarice status` shows run state, last checkpoint and evidence offline with no model
  3. A scripted out-of-scope write through Bash, Python and Edit fails on each path, and a broken hook or missing sandbox blocks the protected operation and moves the run to `blocked_on_decision` (reason `enforcement_failure`)
  4. Killing the supervisor and running `avarice resume` continues from the last checkpoint, and after a forced kill during verification `resume` identifies the interrupted attempt in 100% of fault-injection cases (AC-3)
  5. A crashed or timed-out invocation with no external side effect is discarded and retried once from the item's last checkpoint, without resetting or deleting changes the run did not make
  6. `avarice` with no arguments in a terminal opens the interactive shell (ADR-013): the user starts, watches and resumes the Phase 2 run from it, closing the shell leaves the supervisor running, and the same command outside a terminal or under `AVARICE_RUN` prints usage and exits 64
  7. `status`, `start`, `resume` and the shell render human-readable output in the one style of OPS-7, and every `--json` shape is unchanged
  8. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans:** 35/35 plans complete (19 waves; 02-24 and 02-25 close UAT gaps G-02-10 and G-02-9; 02-26 closes verification gap CR-01; 02-27 to 02-35 close owner UAT gaps G-02-H2 and G-02-H4)

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Spike S2-A: admit the installed Claude Code on a live containment run; Phase 2 spend ledger and 25 USD ceiling guard
- [x] 02-02-PLAN.md — Freeze Phase 1 `--json` shapes (D-19), shared OPS-7 renderers, restyle status, init, repo and dispatcher errors
- [x] 02-03-PLAN.md — Run lifecycle table, migration 0002, run ledger methods (runs, steps, leases, evidence, gates, items, decisions, check validations)
- [x] 02-04-PLAN.md — Routine run contract compiler: brief parser, conventions schema 1, lower-only budgets, static G0
- [x] 02-05-PLAN.md — Evidence statuses, D-12 baseline delta, acceptance mapping, test inventory, gates G2 and G4, structural pause
- [x] 02-06-PLAN.md — Loopback-only sandbox network, allowlisting egress proxy, spike S2-C (npm ci through it)
- [x] 02-07-PLAN.md — Run git adapters: clone, supervisor commit, snapshot and discard, fetch hand-off; conventions (D-16) and staleness (D-04) readers

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-08-PLAN.md — `run` invocation purpose: glob scope, hook rules, settings, environment, run GSD settings and unit prompt
- [x] 02-10-PLAN.md — `avarice start` to contract_ready: preflight refusals, atomic run creation, contract file, summary

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-09-PLAN.md — Spike S2-B: real `/gsd-quick --validate --text` under the run-purpose hook, evidence-backed configuration
- [x] 02-12-PLAN.md — Detached supervisor, run lease loop, `supervise`, `start --wait`, run budget and invocation bookkeeping

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 02-11-PLAN.md — Hook read-before-edit with digest precondition (CON-7) and loop limits (CON-14)
- [x] 02-13-PLAN.md — Vertical slice to ready_for_review with the fake host: unit, classification, G2, supervisor commit, checks, G4, hand-off

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 02-14-PLAN.md — Checks pipeline: dependency install via proxy (D-11), ONB-10 validation, baseline (D-12), test inventory, AUT-9
- [x] 02-15-PLAN.md — `status` run views with optional `runs` JSON key, `inbox`, `install-host` with the avarice-run skill

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 02-16-PLAN.md — CON-16 discard and retry once (S-42), loop and budget escalations, S-20 source checkout untouched

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 02-17-PLAN.md — `resume` for runs, reconcile prelude, S-3, AC-3 kill-point suite over every run checkpoint
- [x] 02-18-PLAN.md — Spike S2-D (limitation 8), containment matrix run rows with a matrix test, G4 and conventions doc amendments

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 02-19-PLAN.md — Interactive shell (FR-27, ADR-013): home view, actions, watch, command line, history
- [x] 02-20-PLAN.md — Live T3 run-purpose suite: S-12 end to end, CS-1..4, 6, 7, 10..14, S-3, S-13..15, S-20, S-41, S-42

**Wave 9** *(blocked on Wave 8 completion)*
- [x] 02-21-PLAN.md — Exit drafts (portfolio `.avarice/config.json`, three R1 briefs), no-spend dry run, owner checkpoints D-06, D-15, D-09

**Wave 10** *(blocked on Wave 9 completion)*
- [x] 02-22-PLAN.md — Exit: three R1 runs on ~/aa-phan-portfolio-v2, 3 of 3 ready_for_review with evidence (D-08)

**Wave 11** *(blocked on Wave 10 completion)*
- [x] 02-23-PLAN.md — Documentation pass: docs/system/ describes what Phase 2 built, grounded and fresh-eyes reviewed (success criterion 8)

**Wave 12** *(gap closure, blocked on Wave 11 completion)*
- [x] 02-24-PLAN.md — G-02-10: dedicated stale-fence discard test on the crash and resume paths, lease edges, the after-checkpoint window; fence the failed reconcile record

**Wave 13** *(gap closure, blocked on Wave 12 completion)*
- [x] 02-25-PLAN.md — G-02-9: the avarice-run skill in ten real attended sessions (status first, stop on a denial, routable question) under the D-15 ceiling

**Wave 14** *(gap closure, blocked on Wave 13 completion)*
- [x] 02-26-PLAN.md — CR-01: git object reads and content-printing git output refused by the hook (proven against real git), the sandbox residual named, docs/system updated and reviewed fresh

**Wave 15** *(gap closure G-02-H2, G-02-H4, blocked on Wave 14 completion)*
- [x] 02-27-PLAN.md — G-02-H2: git object names matched lexically as well as resolved (working-copy symlink bypass, real git); one git operand grammar with the option tables pinned; corrective reasons; integration-suite hygiene (scoped review CR-01, WR-01, WR-02, IN-01..IN-04)
- [x] 02-28-PLAN.md — Terminal text: onboard and resume lines through the shared control stripping; bidi and zero-width class with \u escapes (WR-01, IN-03)
- [x] 02-29-PLAN.md — Git adapters and git evidence: SHA-256 repositories refused at the first read, no Math.min spread, paths split on `/` only, anchored run-ref allowance (WR-06, WR-07, IN-04, IN-09)
- [x] 02-30-PLAN.md — Resume, lease and gated commit: a lost lease aborts the unit's host, an unreapable launch stops the resume, the gated commit's parent checked (IN-05, IN-06, IN-08)
- [x] 02-31-PLAN.md — Harness and evidence hygiene: home path redacted in recorders and four evidence files, cleanupAttended containment checks, narrowed attended allow list (WR-08, WR-09, IN-01)

**Wave 16** *(blocked on 02-27: docs/system/containment.md)*
- [x] 02-32-PLAN.md — Budget settlement: settlement and orphan charges in one ledger transaction; an invocation with no result charged its reservation (WR-04, WR-05)

**Wave 17** *(blocked on 02-29 and 02-32: integrations.md, containment.md)*
- [x] 02-33-PLAN.md — Credential locations: one extended list at all five sandbox and scope sites, check output redacted, proven on the real sandbox (WR-03)

**Wave 18** *(blocked on 02-33: containment.md, integrations.md)*
- [x] 02-34-PLAN.md — Egress: the install proxy refuses non-public resolved addresses and dials the vetted address; conventions refuse local-only registry hosts (WR-02)

**Wave 19** *(blocked on 02-27 to 02-34)*
- [x] 02-35-PLAN.md — Documentation pass and dispositions: docs/system current, README, coverage and findings updated, fresh reviews under the round budget, every finding of 02-REVIEW.md and 02-26-REVIEW.md recorded fixed, skipped or deferred

**Notes**: Suits `/gsd-mvp-phase`. Builds on the Phase 1 kernel: run worktree, contract compilation and G0, run-scoped GSD configuration, outcome classification, checks and test inventory, gates G2 and G4, `status`, `inbox`, `resume`, `install-host`. Resolves host limitation 8 (commits inside the sandbox). ONB-10 covers declared check commands only. Answering decisions from the shell arrives with `decide` in Phase 3. Excluded: several work items, answering decisions, amendments, presets other than `routine` and `onboarding`, push and PR delivery, Stage 2 capability.

### Phase 3: Decisions, independent work and amendments

**Goal**: Runs with several work items continue independent work around an open decision, take a validated answer, resume the paused GSD session and finish
**Depends on**: Phase 2
**Requirements**: AUT-1, AUT-2, AUT-3, AUT-4, AUT-5, AUT-6, AUT-10, AUT-12, AUT-16, RC-6, RC-7, RC-8, CON-15
**Partial coverage**: AUT-6 here is local notification only; push adapters extend it in Phase 6
**Success Criteria** (what must be TRUE):
  1. A blocking question on one item leaves an independent item completed with evidence, while dependent work is not implemented; a consequential question becomes a decision record and routine reversible choices proceed without prompts
  2. Silence (a passed deadline) and a failing notifier leave the decision open and visible in the local inbox
  3. A valid `avarice decide` answer resumes the paused GSD session through `claude -p --resume` and the run finishes; a stale answer (state digest or contract version no longer matches) is re-opened rather than applied
  4. `avarice contract amend` from an interactive terminal outside the run records a new contract version with authorizer, reason and diff, and invalidates evidence when acceptance criteria, writable scope, required checks or policy revision change
  5. Each work item carries a size and specification (derivations marked as derived) and gets its model from `modelBySize`; required checks run after every item, a newly failing check is charged to that item with bounded repair before a decision; subagents draw from the parent's budget and cannot exceed its authority
  6. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans:** 46/50 plans executed (22 waves, with 17 gap-closure plans)

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Phase 3 spend ledger (25 USD, lower-only) and admission of the installed Claude Code 2.1.319
- [x] 03-02-PLAN.md — Migration 0003; ledger answer, stale re-open and withdraw of decisions; per-item attempts
- [x] 03-04-PLAN.md — Pure scheduler: readiness, dependents, dispositions, continuable blocked rule; repair edge
- [x] 03-05-PLAN.md — Decision policy (classes, options, records), one state digest, D-15 response validation
- [x] 03-06-PLAN.md — Gates G1 and G3, the integrity gate map, the smallest reproducer
- [x] 03-07-PLAN.md — Notify policy: profile notify keys, destination subset, quiet hours, batching, backoff, banner text
- [x] 03-08-PLAN.md — Host resume launch line, reap by `--resume`, final-text question, stop-and-ask and resume prompts
- [x] 03-09-PLAN.md — RunWorkspace park and unpark of a paused item's delta

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-03-PLAN.md — Brief `items`, N-item compile with derived specs, scaled routine budgets, repair limit 1
- [x] 03-11-PLAN.md — Fake host per-item scripts, resume, missing session, subagents, plan text; items brief fixture
- [x] 03-12-PLAN.md — Ledger amendRunContract (append-only invalidation, decision resolution), notifications, cancel request
- [x] 03-13-PLAN.md — Spike S3-A: live pause, `--resume`, missing session and plan format on a scratch repository

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-10-PLAN.md — Amendment domain: next contract version, field diff, D-20 invalidation classes
- [x] 03-14-PLAN.md — Multi-item kernel tracer: one unit, gate and commit per item to ready_for_review
- [x] 03-16-PLAN.md — Notifier port, osascript adapter (argv only), profile config reader, banners with retry and quiet hours

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03-15-PLAN.md — `avarice contract amend` and the terminal identity rule (CS-11), shell command line
- [x] 03-17-PLAN.md — Spec derivation from the indexes at start, per-item summary (S-50), model per invocation (S-51)
- [x] 03-18-PLAN.md — Item-local decisions with park, S-17 offline, block-release-recheck, continuable pickup

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 03-19-PLAN.md — Bounded repair, regression charging (S-52), G3 and integrity (S-21), G1 in the item flow
- [x] 03-20-PLAN.md — `avarice decide` with the response validation suite, stale re-open and supervisor pickup
- [x] 03-21-PLAN.md — `status` and `inbox`: items, decisions, banner state, cancel request (optional JSON keys only)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 03-22-PLAN.md — `claude -p --resume` of an answered item with unpark, fallbacks, resume kill points
- [x] 03-23-PLAN.md — `avarice digest`, `avarice schedule install/remove` (user LaunchAgent)

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 03-24-PLAN.md — `avarice cancel` with and without a live supervisor, races and kill points
- [x] 03-25-PLAN.md — Interactive `decide` prompt, the chain into amend, the shell Decide action

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 03-26-PLAN.md — Offline gate: D-03 runs offline, S-18 on a simulated clock, the lost-wakeup race, kill-point coverage

**Wave 9** *(blocked on Wave 8 completion)*
- [x] 03-27-PLAN.md — Live scratch cases S-17, S-18, S-21, S-50, S-51, S-52, CS-5, CS-15

**Gap closure after the 03-27 halt** *(run with `/gsd-execute-phase 3 --gaps-only`; 03-27's SUMMARY stays halted, blocking 03-28 to 03-33, until 03-36 resumes it)*
- [x] 03-34-PLAN.md — Diagnose the small-unit failure from the evidence; the unit prompt, the run agents and the hook's refusals state the run's shell rules (offline)
- [x] 03-35-PLAN.md — Plan-group spend guard (10.00 USD for 03-27's resumed cases); three live haiku probes of 03-27's item A; owner decision checkpoint only if haiku fails
- [x] 03-36-PLAN.md — Re-run 03-27's live cases, cheap cases first and s17-s51 last (S-51 judged first), and resume 03-27's SUMMARY to complete when every case passes (halted at s21)
- [x] 03-37-PLAN.md — After the 03-36 halt: the harness performs the s21 tamper and cs5 asks plainly for its subagent write (owner decision); s21, cs5, s52 and s17-s51 live; complete 03-27 and 03-36 (halted at s21, not exercised twice)
- [x] 03-38-PLAN.md — After the 03-37 halt: one brief per remaining live case that states its direction (owner decision; S-17 keeps its owner choice) and a passing slug source for s21; s21, cs5, s52 and s17-s51 live on the pinned 2.1.319 host; complete 03-27, 03-36 and 03-37 (halted at s21: the judge asserted rules the built run cannot produce)
- [x] 03-39-PLAN.md — After the 03-38 halt: S-21 judged on the built behaviour from the kept 03-38 run (no spend) and one findings line on the scenario-versus-code difference (owner decision); cs5, s52 and s17-s51 live on the pinned host; complete 03-27, 03-36, 03-37 and 03-38

**Wave 10** *(blocked on Wave 9 completion)*
- [x] 03-28-PLAN.md — Exit briefs drafted and dry-run against the portfolio pin; owner checkpoint for briefs and spend (D-04)

**Wave 11** *(blocked on Wave 10 completion)*
- [x] 03-29-PLAN.md — Exit part 1: run 1 block and resume to ready_for_review; run 2 started and blocked (halted at Task 1: run 1 stopped on two pause decisions, item A parked; resumed by 03-42)
- [x] 03-40-PLAN.md — Gap closure after the 03-29 stop: each item's unit sees only its own part of the brief, and a numbered choice that belongs to another item does not pause a verified unit (fail closed); offline reproduction of run 1; docs/system

**Wave 12** *(gap closure, blocked on 03-40)*
- [x] 03-41-PLAN.md — Exit repeat prepared with no spend: superseded evidence on the record, dry run with the fixed code, the 5.62 USD authorization; the owner cancels the stopped run 1 and confirms

**Wave 13** *(gap closure, blocked on 03-41)*
- [x] 03-42-PLAN.md — Exit part 1 again (run 1 to ready_for_review, run 2 started and blocked) at 5.62 USD on the pinned host; resumes 03-29 (halted at Task 2: run 1's resume found no session under the owner's terminal environment, a fresh session failed gate G2; run 2 not started, 03-29 still halted; resumed by 03-45)
- [x] 03-43-PLAN.md — Gap closure after the 03-42 stop: a run records its host configuration directory at start and every later supervisor uses it; decide, resume and supervise refuse visibly when it cannot be honoured; the fallback's missing VERIFICATION diagnosed and the records the gates read named in the prompt; docs/system

**Wave 14** *(gap closure, blocked on 03-43)*
- [x] 03-44-PLAN.md — Exit repeat prepared with no spend: the evidence carries each run's recorded directory, dry run with the fixed code, the 5.27 USD authorization; the owner cancels the stopped run 1 and confirms

**Wave 15** *(gap closure, blocked on 03-44)*
- [x] 03-45-PLAN.md — Exit part 1 for the third time at 5.27 USD (run 1 to ready_for_review with the delegated session resumed, run 2 started and blocked); resumes 03-29 and 03-42 (halted at Task 2: B's delegated session resumed correctly, but gate G2 failed on a VERIFICATION.md without `---` fences; run 1 blocked on a new decision, run 2 not started, 03-29 and 03-42 still halted; resumed by 03-48)
- [x] 03-46-PLAN.md — Gap closure after the 03-45 stop: the records sentence states the fenced VERIFICATION shape, proven against the real parser and gate (parser unchanged); the exit tool's --finish records a second stop; docs/system

**Wave 16** *(gap closure, blocked on 03-46)*
- [x] 03-47-PLAN.md — Exit repeat prepared with no spend: dry run with the fixed code, the 4.95 USD authorization, the superseded evidence; the owner cancels the stopped run 1 in their own terminal window and confirms

**Wave 17** *(gap closure, blocked on 03-47)*
- [x] 03-48-PLAN.md — Exit part 1 for the fourth time at 4.95 USD (run 1 to ready_for_review with the delegated session resumed and B's G2 passing, run 2 started and blocked); resumes 03-29, 03-42 and 03-45 (halted at Task 2: B's delegated session resumed correctly and B passed G2, but item C parked on a pause because the e2e spec asserting the old fallback sentence is outside the brief's write paths; run 1 blocked on a new decision, run 2 not started, 03-29, 03-42 and 03-45 still halted; resumed by 03-50)
- [x] 03-49-PLAN.md — After the 03-48 stop (owner: finish run 1 in place): run 1's shape measured offline (the protected add-write, amend then answer, the answer that needs no amendment), the owner's ledger read, the relaxed finish judge, a dry-run write-set check of the three briefs, and the owner's choice at a blocking-human decision; no src change, no spend

**Wave 18** *(gap closure, blocked on 03-49)*
- [x] 03-50-PLAN.md — The owner finishes run 1 in place in their own terminal window (D-03 relaxed for run 1 only, recorded); run 1 to ready_for_review, run 2 started and blocked; resumes 03-29, 03-42, 03-45 and 03-48 (halted at Task 2 by the owner's stop decision of 2026-11-10/11: the owner answered C's decision, C's resumed unit finished inside the write set, but its verifier reported gaps_found because the protected tests/e2e/copy-email.spec.ts still fails and G2 parked C on a new acceptance decision; run 1 stays blocked until the owner cancels it, run 2 not started, 03-29, 03-42, 03-45 and 03-48 still halted; re-discuss the exit criteria with /gsd-discuss-phase 3)

**Wave 19** *(blocked on 03-50, 03-48, 03-45, 03-42 and 03-29)*
- [ ] 03-30-PLAN.md — Exit part 2: run 3 silence and notifier failure, run 2 amendment and stale answer, 3 of 3 verdict (reads 03-48's evidence and the 03-49 authorization)

**Wave 20** *(blocked on Wave 19 completion)*
- [ ] 03-31-PLAN.md — Documentation draft 1: the worklist; the decision subsystem document, runs, data model and processes with three diagrams, from the code

**Wave 21** *(blocked on Wave 20 completion)*
- [ ] 03-32-PLAN.md — Documentation draft 2: CLI reference, interactive shell, config reference, checks and evidence, containment, integrations, overview, from the code

**Wave 22** *(blocked on Wave 21 completion)*
- [ ] 03-33-PLAN.md — Documentation pass (last plan): diff compared with docs/system and gaps fixed, README tables, coverage and findings, fresh reviews of every new or changed document (success criterion 6)

**Notes**: Delivers the work-item scheduler with dependencies, authority-class matching, `decide` with identity, duplicate and state-digest checks, batching, local notifier and launchd digest scheduler, gates G1 and G3, integrity gates for overrides and PRUNE, and subagent concurrency reservation. Excluded: push notifiers, reply channels other than the terminal.

### Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof

**Goal**: Separate profiles, progressive retrieval with enforced caps, explicit degradation, and proof that domain code is adapter-independent
**Depends on**: Phase 2 and Phase 3
**Requirements**: ONB-6, ONB-11, ONB-15, FR-3, FR-8, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, FR-22, SEC-1, SEC-2, SEC-3, SEC-4, SEC-6, SEC-7, CON-4, CON-10, CON-11, CON-12, OPS-1, OPS-5, OPS-6, NFR-4
**Partial coverage**: ONB-6 (detection and refusal in Phase 1) and SEC-2 (scrubbed environment in Phase 2) are completed here. Extensions owned here: NFR-4 and CON-11 gain real remote adapters in Phase 7; OPS-6 gains Stage 2 gating in Phase 6; SEC-4 enterprise policy sources are not planned
**Success Criteria** (what must be TRUE):
  1. Profiles have separate configuration, credentials, caches, logs, indexes and stores with no automatic fallback: the isolation suite finds 0 cross-profile reads (AC-6) and the redaction suite leaves 0 secret patterns in events, evidence or artifacts (AC-5)
  2. Context retrieval is handle-first and capped: a pack built with the index adapters matches a full-repo baseline's task success at no more than 50% of its tokens (AC-8), and `status` stays under 300 ms at p95 with 1,000 runs (AC-2)
  3. A privileged action without a matching parameter-bound approval is denied, approving a plan does not approve its actions, and retrieved content grants no authority; a host without required enforcement runs only in explicit restricted mode; `doctor` reports enforcement level, versions and incompatibilities offline and fails with an actionable message
  4. Existing GSD artifacts are adopted, refreshed, migrated or raised as a decision and never silently overwritten; refresh chooses incremental, path-scoped or full remapping; 5 of 5 brownfield benchmark repositories reach an active profile with no source change and 0 containment failures (AC-14)
  5. The workflow suite runs unchanged against local and fake-remote adapters with 0 lines of domain-code change (AC-7); an unsupported capability returns a typed `Unsupported` error naming the reduced mode, and each integration has a manual equivalent
  6. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans**: TBD
**Notes**: The largest phase (28 requirements); consider splitting at planning time. Resolves host limitations 3 and 4. Includes the spike mapping graphify relations to per-edge read rules and the three-arm retrieval evaluation that decides the knowledge-pass default. Excluded: real remote adapters, enterprise policy delivery.

### Phase 5: Delivery, test strength, review feedback and data safety

**Goal**: From `ready_for_review` to a pushed branch and draft PR when the contract authorizes it, and back to a new attempt on review feedback, with no duplicate PRs
**Depends on**: Phase 4
**Requirements**: AUT-11, AUT-13, AUT-14, AUT-17, SEC-8, FR-9, FR-10, FR-25, FR-26, NFR-7, NFR-8, OPS-3, OPS-4
**Success Criteria** (what must be TRUE):
  1. When the contract authorizes it, AVARICE pushes the branch and opens a draft PR outside the contained invocation, an injected ambiguous timeout produces 0 duplicate PRs (AC-4), review and CI feedback become new evidence on a new attempt without overwriting earlier evidence, and every credential resolution is recorded as a value-free `credential.resolve` event
  2. With the mutation gate on, mechanical mutants on changed lines are killed or accepted as equivalent by the user before `ready_for_review`: at least 90% with 0 `NO-RUN` scored as survivors (AC-13); a `harden` item can change test paths only; on the benchmark subset (16 R1 and 8 R2 tasks) at least 70% reach `ready_for_review` with no phase-transition prompt and a defect rate no worse than attended runs (AC-9), with 0 hard-budget overruns (AC-12)
  3. A repository's architecture model is drafted deterministically from the code graph as a proposal that takes effect only after approval; the `architecture-model` check reports departures, and a new import outside declared dependencies or a public symbol outside the specification is a G2 finding that goes to repair, then to a decision
  4. `avarice dashboard` renders one self-contained, read-only, redacted HTML page with no server or listening port in under 2 seconds with 1,000 runs (AC-15)
  5. `backup`, `restore`, `export`, `import` and `uninstall` work as documented, a restore after a corrupted store completes in under 15 minutes (restore drill, T-7), and retention limits apply per profile
  6. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans**: TBD
**UI hint**: yes
**Notes**: Completes the PRD's MVP. Excluded: merge, release, deploy. AC-10 and AC-11 need the C1, C2 and X task classes and are measured with the full benchmark in Phase 5.

### Phase 6: GSD capability bridge, phased work, plugin and push notifiers

**Goal**: Gates inside GSD's loop; `/gsd-autonomous --only N` units; one-step install; notifications away from the desk
**Depends on**: Phase 5, and a confirmed reading of the capability schema in the installed GSD version
**Requirements**: None newly owned (all three requirements this slice touches are owned by earlier phases)
**Extends**: FR-4 (Stage 2 capability; owned by Phase 2), AUT-6 (push adapters; owned by Phase 3), OPS-6 (Stage 2 `engines.gsd` gating; owned by Phase 4)
**Success Criteria** (what must be TRUE):
  1. The `avarice-bridge` capability installs at project scope with explicit consent, its blocking gates (G1 at `plan:post`, G2 at `verify:post`, approval check at `ship:pre`) halt GSD on failure, `ship:pre` blocks when AVARICE is unavailable (exit 69), and the capability disables itself outside the pinned `engines.gsd` range
  2. A phased unit (`/gsd-autonomous --only N`) runs unattended only after the integration test of the plan-phase double-execute path passes
  3. A decision that needs the user sends a push notification (ntfy, Pushover or Telegram) to the configured destination, and a failed delivery leaves the decision pending and visible locally
  4. The full 40-task benchmark shows unnecessary escalations under 15% (AC-10) and 0 containment failures including the adversarial class (AC-11)
  5. The plugin installs AVARICE for attended use in one step
  6. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans**: TBD
**Notes**: Trigger-driven. Revisit trigger: if GSD changes the capability schema or adds a headless mode before this phase starts, re-run the GSD investigation and update ADR-006 first.

### Phase 7: Personal infrastructure

**Goal**: Move artifacts and execution off the laptop when a measured need exists, keeping the ledger local and domain code unchanged; parts 6a to 6d are independent except that 6c needs 6b
**Depends on**: Phase 5
**Requirements**: FR-24
**Extends**: NFR-4 (real remote adapters; owned by Phase 4), SEC-2 and SEC-8 (Vault adapter behind the same credential port; owned by Phases 4 and 5)
**Success Criteria** (what must be TRUE):
  1. (6a, trigger: disk pressure) `avarice artifacts migrate --to nas` copies blobs, verifies digests, switches the artifact store and deletes local copies only after verification (S-10 against MinIO or the NAS)
  2. (6b, trigger: runs that must continue while the Mac sleeps, or checks that cannot run on macOS) A remote worker runs checks and, after its own containment suite (CS-1 to CS-16) passes on the worker OS, contained agent invocations; S-11 passes over the home network including Wi-Fi loss; a host cannot be deactivated while an active project or run depends on it (FR-24)
  3. (6c, trigger: two machines advancing runs at once) Two workers advance runs against the coordination service under injected pauses and no run is claimed twice
  4. (6d, trigger: a second machine or local service needing the same secrets) A `vault:` reference resolves against a local or homelab Vault or OpenBao, sealed and unsealed (S-55), emitting the same value-free `credential.resolve` event
  5. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans**: TBD (one plan per part, each started only when its trigger is measured)
**Notes**: Each part may also run on `localhost` through the optional local-services deployment (ADR-010). Excluded: concurrent workers in 6b, multi-user access control, enterprise profiles, dynamic secrets, SMB and NFS mounts.

### Phase 8: Cross-repository runs and project groups

**Goal**: One unattended run spans several repositories of a project group and ends with one linked change request per repository
**Depends on**: Phase 5, and an active project record for each member repository
**Requirements**: AUT-15, FR-21
**Success Criteria** (what must be TRUE):
  1. A single unattended run spans two repositories of one project group, each with its own worktree, contract scope, gates and change request, and ends with one linked change request per repository
  2. The run reaches `ready_for_review` only when every repository's gates pass, and a repository without an active project record cannot join the run
  3. Group membership never widens any member's authority, and the containment suite passes with two worktrees in one run
  4. Members share references to standards and scaffolds through the standards context adapter
  5. `docs/system/` describes what this phase built: every new or changed command, flag, config key, table, event, integration and subsystem is documented against the code; `docs/system/README.md` (documents and proposal counterparts tables), `coverage.md` and `findings.md` are current; each new or changed document had a fresh-eyes review. The phase's last plan is this documentation pass

**Plans**: TBD
**Notes**: Starts when two repositories regularly need changes together, measured from the user's own runs. Excluded: coordinated merging, cross-profile groups.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5, then 6, 7 (part 6c after 6b) and 8 as their triggers fire (each depends on Phase 5)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Contained onboarding of one repository | v1.0 | 26/26 | Complete | 2026-11-05 |
| 2. Contained unattended run of one work item | v1.0 | 35/35 | Complete    | 2026-11-08 |
| 3. Decisions, independent work and amendments | v1.0 | 46/50 | In Progress | - |
| 4. Profiles, retrieval budgets, restricted mode and the portability proof | v1.1 | 0/TBD | Not started | - |
| 5. Delivery, test strength, review feedback and data safety | v1.1 | 0/TBD | Not started | - |
| 6. GSD capability bridge, phased work, plugin and push notifiers | v2.0 | 0/TBD | Not started | - |
| 7. Personal infrastructure | v2.0 | 0/TBD | Not started | - |
| 8. Cross-repository runs and project groups | v2.0 | 0/TBD | Not started | - |

## Backlog

### Phase 999.1: Follow-up — Phase 01 deferred UAT follow-up: Test 13 (BACKLOG)

**Goal:** Resolve the UAT checkpoint deferred during Phase 01 verification
**Source phase:** 01
**Deferred at:** 2026-11-04 during /gsd-verify-work 1 session completion
**Follow-ups:**
- [ ] Test 13: defer: re-check live on next onboarding (deferred 2026-11-04)

### Phase 999.2: Follow-up — Phase 01 deferred UAT follow-up: Test 10 (BACKLOG)

**Goal:** Resolve the UAT checkpoint deferred during Phase 01 verification
**Source phase:** 01
**Deferred at:** 2026-11-05 during /gsd-verify-work 01 session completion
**Follow-ups:**
- [ ] Test 10: defer test 10 and add it to the backlog (live check of the local-mount refusal against a real smbfs/nfs network mount; none was set up) (deferred 2026-11-05)

### Phase 999.3: Reorganize documentation around docs/system as the source of truth (BACKLOG)

**Goal:** When the project is complete, make the living documentation of the built system the main documentation tree and keep the specification as a historical record of proposals
**Trigger:** after the last planned phase is verified (milestone v2.0 complete), not before: until then the specification is the planning input for unbuilt phases
**Decided at:** 2026-11-05, after the Phase 01 documentation campaign
**Follow-ups:**
- [ ] Move the specification documents (requirements, architecture, design documents, implementation plan, reference-system comparisons) from `docs/` into `docs/proposals/`, keeping `docs/decisions/` ADRs as the decision record
- [ ] Promote `docs/system/` to be the main `docs/` tree, with its README as the documentation index
- [ ] Settle every open line in `docs/system/findings.md` (code changed, specification superseded, or accepted as a deliberate difference) and close the tree's outstanding reviews in `coverage.md`
- [ ] Update every cross-link, the README document map and source-of-truth section, `CLAUDE.md`'s documentation rule, and `docs/gsd-ingest-manifest.yaml` to the new paths
- [ ] Run a final regrounding of the tree against the code at the release commit

### Phase 999.4: Follow-up — Phase 02 deferred UAT follow-up: Test 4 (BACKLOG)

**Goal:** Resolve the UAT checkpoint deferred during Phase 02 verification
**Source phase:** 02
**Deferred at:** 2026-11-08 during /gsd-verify-work 02 session completion
**Follow-ups:**
- [ ] Test 4: 02-35-REVIEW WR-04 charge policy for a host that ends with no result event, and triage of IN-01..IN-06 (recorded deferred in 02-35-REVIEW-DISPOSITION.md) (deferred 2026-11-08)

### Phase 999.5: Follow-up — Phase 02 deferred UAT follow-up: Test 5 (BACKLOG)

**Goal:** Resolve the UAT checkpoint deferred during Phase 02 verification
**Source phase:** 02
**Deferred at:** 2026-11-08 during /gsd-verify-work 02 session completion
**Follow-ups:**
- [ ] Test 5: Open owner decisions: private-network registries unsupported; test:<text> substring acceptance (IN-07); home-path residue before public release; SIGTERM does not abort the unit (T-02-108); Read deny rule misses file-shaped credentials; live redirect-through-prefix-rule question (deferred 2026-11-08)
