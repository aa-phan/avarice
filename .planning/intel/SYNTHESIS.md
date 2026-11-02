# Synthesis summary (entry point for gsd-roadmapper)

Mode: new. Generated from 26 classified documents in /Users/aphan/avarice/.planning/intel/classifications. Project: AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment), a Node/TypeScript CLI that supplies a contained, auditable run envelope around GSD 1.17.0 and Claude Code. Every source document is status "proposal"; nothing is built.

## Document counts by type
- PRD: 1 (docs/requirements.md, precedence 1)
- ADR: 12 (docs/decisions/ADR-001 to ADR-012, precedence 2, all Proposed, none locked)
- SPEC: 9 (architecture, containment, autonomy-and-decisions, repository-onboarding, contracts-and-state at precedence 3; extensions, deployment-and-portability, enterprise-adaptation, operations-and-testing at precedence 4)
- DOC: 4 (implementation-plan, existing-tooling-assessment, reference-system-comparison, reference-system-deep-dive; precedence 5)
- UNKNOWN: 0

## Decisions (decisions.md)
12 decisions, 0 locked, 12 proposed. All by aa-phan.
- ADR-001 TypeScript on Node.js with built-in SQLite (Node 22.13+)
- ADR-002 AVARICE supplies services to GSD, never orchestrates the loop (partially superseded by ADR-006 for unattended runs)
- ADR-003 One local SQLite database per profile, artifacts in a separate store (amended by ADR-010)
- ADR-004 Modular monolith, ports only at realistic migration boundaries (amended by ADR-010)
- ADR-005 Deny-by-default privileged actions, parameter-bound approvals, hard profile separation
- ADR-006 Unattended runs delegate bounded GSD units through contained headless invocations
- ADR-007 Mutation gate; reuse adversarial-mutation-test skill; Node probe
- ADR-008 GSD maps and plans; AVARICE onboards in a contained staging worktree
- ADR-009 Credential broker port over existing stores (no secrets server, no `env:` references)
- ADR-010 Serverless baseline; optional local-services deployment
- ADR-011 Static read-only dashboard in the MVP
- ADR-012 Repository-owned machine-checkable architecture model
Sources: /Users/aphan/avarice/docs/decisions/*.md

## Requirements (requirements.md)
149 entries from the single PRD (no variants, no competing acceptance): REQ-UC-1..9 (9 use cases), REQ-NG-1..10 (10 non-goals), REQ-FR-1..26, REQ-RC-1..8, REQ-CON-1..16, REQ-AUT-1..17, REQ-ONB-1..15, REQ-NFR-1..9, REQ-SEC-1..8, REQ-OPS-1..6 (111 normative requirements), REQ-AC-1..15 (15 measurable acceptance criteria with targets), REQ-A-1..10 (10 provisional assumptions; A-1 and A-2 confirmed 2026-11-01). Scope labels in the source: MVP, Contract, Later, Onboarding, Assumption. Per-requirement acceptance criteria are not stated in the source except via the AC table.

## Constraints (constraints.md)
46 entries from the SPECs: api-contract 6 (Result/PortError, capability descriptors, twelve ports, ContextSource, bridge manifest, backup/uninstall commands), schema 6 (source-of-truth ownership, onboarding contract and promotion, run contract and presets, evidence schema, mutation evidence, configuration), nfr 9 (retrieval caps, budgets, unattended scope, autonomy metrics and benchmark, version compatibility, offline matrix, enterprise compatibility, operation budgets, baseline targets T-1..T-9), protocol 25 (modules, dependency direction, process view, trust boundaries, enforcement matrix, launch and settings, sandboxed checks, fail-closed, file-edit safeguards, subagent rules, host limitations, decision matrix, operational states, onboarding lifecycle, validation, mapping modes, state machine, gates, test protection, extension catalog, rejected extensions, topology, policy model, observability, test strategy). Some entries point to source sections not reproduced in full (persisted entities, per-port signatures, questionnaire, acceptance scenarios S-1..S-59).

## Context topics (context.md)
Implementation plan overview, slices 0 to 7 (slice structure, requirements, deliverables, dependencies, verification, exclusions and exit criteria preserved), GSD-compatible phases 0 to 2 verbatim, maintenance cost, README decisions already taken, and summaries of the three reference/assessment DOCs (13 topics).

## First milestone for the roadmapper: phases 0 to 2
Use the slice-to-phase mapping in context.md ("GSD-compatible planning input"). Phase 0 (contained onboarding of one repository, 25 requirement IDs; exit: one brownfield repository, here ~/aa-phan-portfolio-v2, reaches an active record with code-and-document graph and intel at the onboarded revision; scripted source and policy edits blocked; kill-then-resume reaches the same record), Phase 1 (contained unattended run of one work item, 36 IDs; exit: three R1 benchmark tasks reach ready_for_review with no human input and out-of-scope writes fail on Edit, Bash and Python), Phase 2 (decisions, independent work and amendments, 13 IDs). Dependency chain 0 -> 1 -> 2; slice 3 (profiles, retrieval budgets, restricted mode, portability proof) and slice 4 (delivery, mutation gate, dashboard, architecture model, backup; completes the MVP) follow. Partially-scoped requirement IDs overlap between phases (CON-2/3/5/6/13 and NFR-1/3/5/6/9 in 0 and 1; AUT-2 and AUT-12 in 1 and 2); the roadmapper must decide attribution. Slices 5 to 7 are post-MVP and trigger-driven.

## Open items carried from the sources (not conflicts)
- README "Remaining decisions" 3 to 9 are still open: GitHub and manual briefs as the only personal SCM and task source (A-3, A-4); `routine` preset default limits and whether it may push and open a draft PR; notification destination and check-in times; unattended only while Mac awake (A-8); NAS model and OS (before slice 6); default promotion mode (`none`, `copy`, `commit`); enterprise questionnaire.
- Containment unresolved host limitations 1 to 8 (assigned to slices 0, 1, 3 in the implementation plan) and several spikes (sandbox runtime wrapping AVARICE's own checks; graphify output location and `merge-graphs` confidence tiers; relation-to-read-rule mapping).
- Stage 2 `avarice-bridge` manifest: the shape of `contributions` entries is assumed and must be confirmed against installed GSD before slice 5.
- ADR-007: the adversarial-mutation-test plugin's DecentraLicense has not been reviewed.

## Conflicts
0 blockers, 1 warning (cross-reference graph forms one cycle across 25 documents; treated as hyperlinks, needs user acknowledgement), 9 info (auto-resolved supersession and amendment relationships, no locked decisions, precedence note, coverage limits, phase overlap). Competing variants: 0. Detail: /Users/aphan/avarice/.planning/INGEST-CONFLICTS.md

## Files
- /Users/aphan/avarice/.planning/intel/decisions.md
- /Users/aphan/avarice/.planning/intel/requirements.md
- /Users/aphan/avarice/.planning/intel/constraints.md
- /Users/aphan/avarice/.planning/intel/context.md
- /Users/aphan/avarice/.planning/INGEST-CONFLICTS.md
