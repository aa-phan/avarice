# AVARICE

## What This Is

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) is a local-first TypeScript CLI that supplies a contained, auditable run envelope around GSD 1.17.0 and Claude Code. Given a brief and a policy preset, it compiles a run contract, runs GSD units headless inside an OS sandbox with fail-closed hooks and shared budgets, turns consequential questions into decision records, and checks the result with evidence bound to the exact revision. GSD keeps planning and execution inside each unit. It is built for one developer (aa-phan) with Claude as the implementer, personal profile first and enterprise-adaptable later. Status: the 26-document specification package was ingested on 2026-11-01; Phase 1 (contained onboarding of one repository) completed on 2026-11-05, Phase 2 (contained unattended run of one work item) completed on 2026-11-08, and Phase 3 (decisions, independent work and amendments) is next.

## Core Value

Set a goal and the operating boundaries, leave the desk, and come back to a verified, reviewable change or to a short list of genuine blocking decisions, with containment and evidence that do not depend on the model behaving.

## Requirements

Full text, scope labels and traceability: `.planning/REQUIREMENTS.md`. IDs are the PRD's own (`docs/requirements.md`). 105 normative requirements exist; 104 are mapped to phases and 1 (FR-23) is deferred.

### Validated

- ✓ Contained onboarding of one existing repository to an active project record with GSD as the mapper, source read-only, GSD intel and graph indexes recorded (ONB-1/2/3/4/5/7/8/9/12/13/14, FR-20, SEC-5, NFR-2) — Phase 1 (verified 2026-11-04: `~/aa-phan-portfolio-v2` active with 1010 code and 24 document nodes; UAT complete 2026-11-05, 160 of 163 passed, the knowledge-pass gap G-01-154 closed by plans 01-25 and 01-26, tests 10 and 13 deferred to backlog 999.2 and 999.1)
- ✓ A contained, unattended run of one work item from a brief and the `routine` preset to `ready_for_review` or `blocked_on_decision`, surviving a kill (RC-1..5, CON-1/2/3/5/6/7/8/9/13/14/16, AUT-7..9, FR-1/2/4/5/6/7/11/27, NFR-1/3/5/6/9, OPS-2/7, ONB-10) — Phase 2 (35 plans; re-verified 2026-11-08 after gap-closure round 02-27..02-35, 8/8 success criteria; gaps G-02-H2 and G-02-H4 closed; security 122 threats, 0 open; UAT complete 2026-11-08, tests 4 and 5 deferred to backlog 999.4 and 999.5)

### Active

Milestone v1.0 Contained Kernel (Phases 1-3, first milestone, slices 0-2):

- [ ] Decision records, independent work around an open decision, validated answers, contract amendments, local notification (Phase 3: AUT-1..6/10/12/16, RC-6..8, CON-15)

Milestone v1.1 MVP Completion (Phases 4-5, planned; completes the PRD's MVP):

- [ ] Profiles, handle-first retrieval with caps, restricted mode, privileged-action approvals, `doctor`, existing-GSD adoption and refresh, portability proof (Phase 4)
- [ ] Delivery to a draft PR, review feedback attempts, mutation gate, architecture-model check, static dashboard, backup and uninstall (Phase 5)

Milestone v2.0 Post-MVP Extensions (Phases 6-8, planned, trigger-driven):

- [ ] GSD capability bridge, phased work, plugin, push notifiers (Phase 6); personal infrastructure and host records (Phase 7, FR-24); cross-repository runs and project groups (Phase 8, AUT-15, FR-21)

### Out of Scope

- Replacing GSD planning, phase execution or verification (NG-1) — AVARICE supplies services around GSD (ADR-002)
- A general plugin marketplace, distributed scheduler or universal provider abstraction (NG-2) — complexity with no measured need
- A dashboard that needs a server or listening port in the MVP (NG-3) — the static dashboard (FR-26) is in scope
- Exactly-once execution across external systems (NG-4) — at-most-once initiation plus reconciliation by key
- Defending against a user who controls the whole machine (NG-5) — local controls guard against agent mistakes and injected instructions
- Zero human intervention or guaranteed correctness of unattended results (NG-6) — runs end in a reviewable change or explicit decisions
- An exact hard cost cap where the host reports usage late (NG-7) — conservative request, context and tool-call limits instead
- Merging, publishing or deploying unattended (NG-8) — unless contract and organizational policy separately authorize
- Replacing or bypassing enterprise identity, tracking, SCM, CI, secrets, security or release processes (NG-9)
- Cloning the 3dmk reference system's service layout (NG-10) — design inspiration only
- Tracker, SCM other than GitHub, audit sink, policy-file delivery, managed hook packaging, enterprise credential provider — not planned; decided when an employer environment is known (A-6)
- Windows and WSL support — planned, untested; Linux and macOS x86-64 also untested (macOS 15 arm64 is the MVP target)

## Context

- **Source set:** 26 documents ingested 2026-11-01 (1 PRD, 12 ADR, 9 SPEC, 4 DOC), all status proposal. Precedence PRD > ADR > SPEC > DOC. Conflict report: 0 blockers, 1 warning (the document cross-reference graph is one cycle of navigational links; accepted by the user), 9 info. Detail: `.planning/INGEST-CONFLICTS.md`; intel: `.planning/intel/`.
- **Host baseline (decided 2026-11-01):** Claude Code is the primary host and GSD 1.17.0 the baseline; GSD updates are taken deliberately. Installed: Claude Code 2.1.316 (admitted versions: 2.1.312 and 2.1.316). Attended use targets whichever directory `CLAUDE_CONFIG_DIR` names, default `~/.claude`; nothing is hard-coded. The developer's active directory is `~/.claude-edu`. Unattended runs load neither directory's settings.
- **Slice 0 exit-criterion target:** `~/aa-phan-portfolio-v2`, an existing repository with committed GSD planning (its own milestone v2, Phase 5 of 6 executing) and no codebase map, intel or graph. It exercises detection and non-overwrite of existing planning state (ONB-6, detection and refusal). Adoption of an existing stamped map is a Phase 4 deliverable and this target cannot exercise it unless a map exists first.
- **Success metric:** acceptance criteria AC-1..AC-15 (PRD). The first milestone verifies AC-1 and AC-3 directly and reports containment failures (AC-11) from its containment suites; the rest are measured in Phases 4-6 (mapping in REQUIREMENTS.md).
- **Pre-build spikes closed 2026-11-01** (`spikes/2026-11-01-pre-slice-0/README.md`): launch line gains `--plugin-dir` and `--agents`; out-of-scope worktree entries get `denyWrite`; the knowledge pass uses an AVARICE graph merge instead of `merge-graphs`; minimum Node raised to 22.22.3.
- **Open owner decisions (README items 3-9):** GitHub and manual briefs as the only personal SCM and task source (A-3, A-4); `routine` preset default limits and whether it may push and open a draft PR; notification destination and check-in times; unattended only while the Mac is awake (A-8); NAS model and OS before slice 6 (A-5); default promotion mode (`none`, `copy`, `commit`); enterprise questionnaire (A-6).
- **Maintenance cost (estimate):** re-run the GSD integration suite on GSD upgrades and the containment suite on every Claude Code upgrade; re-run all suites on Node majors. The containment suite is likely the largest recurring cost.
- **Reference systems:** the 3dmk comparison documents are design inspiration and not a requirements source.

## Constraints

- **Tech stack:** TypeScript restricted to erasable syntax on Node >= 22.22.3 (or >= 24.15.0), `node:sqlite`, no native dependencies, bundled JavaScript build for distribution — Node is already required by GSD (ADR-001, proposed). The floor may rise after the SQLite WAL spike.
- **Host compatibility:** Claude Code unattended runs only on admitted versions after the containment suite passes on that version; otherwise restricted mode only. GSD 1.17.x only; AVARICE never runs `/gsd-update`.
- **Platform:** macOS 15 arm64 is the MVP target; install is user-space with no admin rights.
- **Baseline footprint:** no daemon, container runtime, server, NAS or cloud account on one Mac (NFR-1); an optional localhost local-services deployment is allowed outside the baseline (ADR-010).
- **Security:** required enforcement fails closed; privileged actions are denied by default and need parameter-bound approvals; the run holds no credentials; `env:` is not a credential provider; profiles never fall back to each other.
- **Architecture:** `domain` and `ports` import no adapters or `node:` modules other than `node:crypto`, enforced by lint (NFR-3); AVARICE never writes `.planning/` directly, never retries inside a GSD unit, never calls a model API.
- **Operating envelope:** unattended runs only while the Mac is awake and on power (A-8); the endpoint is `ready_for_review`; no merge, release or deploy.
- **Performance targets (unmeasured proposals):** status p95 < 300 ms at 1,000 runs, doctor < 2 s, hook decision p95 < 150 ms, dashboard < 2 s at 1,000 runs, install to first `status` < 10 minutes (T-1..T-9).
- **Dependencies:** `graphify` 0.9.53 optional (ADR-008); `gh` 2.x; `@anthropic-ai/sandbox-runtime` unverified for wrapping AVARICE's own checks (Phase 2 spike); the adversarial-mutation-test plugin's DecentraLicense is unreviewed, so no plugin code is copied (ADR-007).

## Key Decisions

No decision is locked: all 12 ADRs are Proposed. Treat them as proposals by aa-phan until accepted. ADR-006 supersedes ADR-002 in part (unattended runs only); ADR-010 amends ADR-003 and ADR-004; ADR-011 narrows NG-3; ADR-012 amends ONB-2.

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ADR-001 TypeScript on Node with built-in SQLite (Node 22.22.3+) | No native dependencies; Node already required by GSD; `doctor` checks bundled SQLite against the WAL-reset fix | Proposed |
| ADR-002 AVARICE supplies services to GSD and never orchestrates the loop | GSD owns plan to ship; two integration stages (files and observation, then a GSD capability) | Proposed (partly superseded by ADR-006) |
| ADR-003 One local SQLite database per profile, artifact bytes in a content-addressed store | Atomic reservations without a server; `VACUUM INTO` backups; network mounts refused | Proposed (amended by ADR-010) |
| ADR-004 Modular monolith, ports only at realistic migration boundaries | Policy is not a port; MCP is not an internal transport | Proposed (amended by ADR-010) |
| ADR-005 Deny-by-default privileged actions, parameter-bound approvals, hard profile separation | Limits damage from injected instructions; PreToolUse hook at the host | Proposed |
| ADR-006 Unattended runs delegate bounded GSD units through contained headless invocations and route every GSD pause | Supervisor classifies outcomes deterministically; answers only from validated decisions or authorized defaults | Proposed |
| ADR-007 Mutation gate with mechanical mutants; reuse the adversarial-mutation-test skill; Node probe | Measures test strength model-free; no plugin code copied | Proposed |
| ADR-008 GSD maps and plans; AVARICE onboards in a contained staging worktree and records provenance | Keeps semantic content in GSD; promotion only by explicit step; `/gsd-ingest-docs`, never `/gsd-new-project --auto` | Proposed |
| ADR-009 Credential broker port over existing stores | No secrets server; `delegated:`, `keychain:`, `cmd:` references; every resolution an event | Proposed |
| ADR-010 Serverless baseline with optional local-services deployment | Baseline needs no daemon; services only for a measured need | Proposed |
| ADR-011 Static read-only dashboard in the MVP | One self-contained HTML file, no server or port | Proposed |
| ADR-012 Repository-owned machine-checkable architecture model | Deterministic draft from the code graph; agent cannot change the model | Proposed |
| Claude Code primary host, GSD 1.17.0 baseline (A-1, A-2) | Owner confirmation | Decided 2026-11-01 |
| Config directory is whatever `CLAUDE_CONFIG_DIR` names, default `~/.claude`; nothing hard-coded | Developer's active directory is `~/.claude-edu` | Decided 2026-11-01 |
| Slice 0 exit target is `~/aa-phan-portfolio-v2` | Real brownfield repository with existing GSD planning | Decided 2026-11-01 |
| Phase N mirrors slice N−1 of the implementation plan (Phases 1-8 = slices 0-7; GSD 1.17.0 does not support a phase 0) | Owner's slice structure and exit criteria are the phase input | Decided 2026-11-01 |
| A requirement ID shared across phases maps to the phase that completes its MVP scope; earlier phases record partial coverage | Keeps one owner per requirement; post-MVP phases extend, never take over | Roadmapper, 2026-11-01 (confirm) |
| Ingest warning: the document cross-reference cycle is treated as hyperlinks, not circular definitions | Documents were read independently; no synthesis loop | Accepted by user |
| Onboarding stages in a local clone, not a linked worktree (S0-B) | A contained run moved a source ref through a linked worktree without generated `denyWrite` on the source `.git` | Phase 1, 2026-11 |
| Shell `grep` is not an admitted read command; contained agents search through the host Grep tool, whose path the hook judges | Modelling grep options failed twice (P-3); the verdict must not depend on which grep binary the Bash tool runs | Phase 1 quick task 261104-l3t, 2026-11-04 |
| Knowledge coverage is judged per manifest document on the merged graph; below half the documents covered is validation-failed, and the record states documentsExpected and dropped.unread | A live run lost most documents while reporting dropped 0 (UAT G-01-154); chunk shape is not evidence of coverage | Phase 1 plan 01-25, 2026-11-05 |
| The knowledge agent gets absolute readPath and writePath as data and uses them verbatim; the live exit gate requires zero unread documents | The model composing paths dropped the .avarice-knowledge/ segment in 2 of 4 live runs | Phase 1 plans 01-25 and 01-26, 2026-11-05 |
| The hook also matches the path part of a git object name (`<rev>:<path>`, `:<path>`, `:N:<path>`) lexically against the secret globs; `git show <rev>:.env` is denied even when that revision stores a symlink there (deliberate over-deny) | Git reads object names from the tree or index, not the working copy, so a working-copy symlink hid a secret from history (G-02-H2) | Phase 2 plan 02-27, 2026-11-08 |
| One shared credential deny list (12 home-relative locations) feeds all five sandbox deny sites; check output is redacted before storage; no allow-list inversion | The sandboxes denied only `~/.ssh`, `~/.aws` and `~/.config/gh`; node and npm need too many system paths for an allow list | Phase 2 plan 02-33, 2026-11-08 |
| Registry hosts that can only mean a local target are refused in the conventions, and the install proxy resolves each host, refuses any non-public address and dials the vetted address; private-network registries are unsupported | The proxy dialled loopback, private and metadata hosts named in conventions (R-WR-02); dialling the vetted address also closes DNS rebinding | Phase 2 plan 02-34, 2026-11-08 (owner confirmation deferred to backlog 999.5) |
| Budget settlement and orphan conversion each write in one ledger transaction; an invocation that ends with no result event is charged at least its reservation | Separate writes lost cost on a kill between them (R-WR-05); a crash with no result was charged 0 (R-WR-04); the zero-spend fast-failure case is deferred to backlog 999.4 | Phase 2 plan 02-32, 2026-11-08 |
| A supervisor that loses its run lease aborts the unit's host; an operator SIGTERM does not (accepted threat T-02-108) | A lost lease left the unit running and spending until the new holder reaped it (R-IN-06); a SIGTERM abort needs its own design | Phase 2 plan 02-30, 2026-11-08 |

---
*Last updated: 2026-11-08 after Phase 2 transition*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check: still the right priority?
3. Audit Out of Scope: reasons still valid?
4. Update Context with current state
