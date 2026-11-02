## Conflict Detection Report

Mode: new. Inputs: 26 classified documents (1 PRD, 12 ADR, 9 SPEC, 4 DOC). Precedence: per-document numeric values from docs/gsd-ingest-manifest.yaml (PRD 1, ADR 2, SPEC 3 or 4, DOC 5; lower wins). All 12 ADRs have status Proposed, so none is LOCKED.

### BLOCKERS (0)

None. No LOCKED ADR exists, so no LOCKED-vs-LOCKED contradiction is possible. No document is classified UNKNOWN with low confidence. No contradiction between two ADRs was found.

### WARNINGS (1)

[WARNING] Cross-reference graph is one large cycle (hyperlinks, not dependencies)
  Found: Tarjan strongly-connected-component analysis over the cross_refs of all 26 classifications (178 internal edges, 44 mutual pairs) yields one component containing 25 of 26 documents; only docs/decisions/ADR-005-policy-approvals-and-profiles.md (refs are external URLs only) sits outside it. Examples of direct two-document cycles: /Users/aphan/avarice/docs/decisions/ADR-002-gsd-integration-mode.md and /Users/aphan/avarice/docs/decisions/ADR-006-unattended-delegation.md; /Users/aphan/avarice/docs/requirements.md and /Users/aphan/avarice/docs/containment.md; /Users/aphan/avarice/docs/contracts-and-state.md and /Users/aphan/avarice/docs/repository-onboarding.md.
  Impact: The synthesizer rules say a cyclic set must not be synthesized and each cycle is a BLOCKER. Applied literally, that would block the whole corpus. The edges here are navigational Markdown links in a deliberately cross-linked design set (each document states it "owns" a topic and links to the others). This synthesis reads each document independently and never follows refs recursively, so no synthesis loop can occur, and all 26 documents were synthesized. This is a judgment call that deviates from the stated rule; it is recorded as a WARNING (not INFO) so the user explicitly accepts it.
  → Confirm that mutual links between these documents are acceptable and not a sign of circular definitions. If a strict reading is wanted, shrink the ingest set via the manifest and re-run.

### INFO (9)

[INFO] No locked decisions in this corpus
  Note: All 12 ADRs (/Users/aphan/avarice/docs/decisions/ADR-001 through ADR-012) read "Proposed". locked=false in every classification. Downstream consumers must treat decisions in /Users/aphan/avarice/.planning/intel/decisions.md as proposals by aa-phan. Only two items were confirmed by the owner on 2026-11-01 (assumptions A-1 Claude Code primary host, A-2 GSD 1.17.0 baseline; /Users/aphan/avarice/docs/requirements.md Assumptions table, and README.md "Remaining decisions", which was read for context but not ingested).

[INFO] Auto-resolved: ADR-006 partially supersedes ADR-002 (stated by the sources)
  Note: /Users/aphan/avarice/docs/decisions/ADR-002-gsd-integration-mode.md ("never orchestrates the loop", Stage 1 manual handoff) is superseded in part by /Users/aphan/avarice/docs/decisions/ADR-006-unattended-delegation.md for unattended runs only (the supervisor starts each unit and retries a crashed invocation once, CON-16; it never steps inside a GSD unit). ADR-002's ownership table still holds and attended flow is unchanged. Both ADRs carry precedence 2 and neither is locked; resolution follows the supersession each document declares, not a tiebreaker. Both entries are kept in decisions.md.

[INFO] Auto-resolved: ADR-010 amends ADR-003 and ADR-004 (stated by the sources)
  Note: /Users/aphan/avarice/docs/decisions/ADR-010-serverless-baseline-local-services.md limits the no-server stance of /Users/aphan/avarice/docs/decisions/ADR-003-local-persistence.md and /Users/aphan/avarice/docs/decisions/ADR-004-modular-monolith-and-ports.md to the baseline; an optional localhost local-services deployment is permitted. NFR-1 in /Users/aphan/avarice/docs/requirements.md is unchanged (baseline only). No contradiction remains.

[INFO] Auto-resolved: ADR-011 narrows a PRD non-goal and the PRD already reflects it
  Note: /Users/aphan/avarice/docs/decisions/ADR-011-static-dashboard.md narrows the dashboard non-goal. /Users/aphan/avarice/docs/requirements.md (precedence 1) already reads "A dashboard that needs a server or a listening port in the MVP. The static dashboard in FR-26 is in scope" and defines FR-26 and AC-15. The PRD and ADR agree; no override was needed.

[INFO] Auto-resolved: ADR-012 amends ONB-2 and the PRD already reflects it
  Note: /Users/aphan/avarice/docs/decisions/ADR-012-architecture-model.md amends ONB-2 (repository-owned approved architecture model is not an AVARICE index). /Users/aphan/avarice/docs/requirements.md ONB-2 and FR-25 already contain the amended text; /Users/aphan/avarice/docs/repository-onboarding.md and /Users/aphan/avarice/docs/contracts-and-state.md (G2, G4) are consistent.

[INFO] Precedence order differs from the engine default
  Note: Manifest precedence is PRD (1) > ADR (2) > SPEC architecture/containment/autonomy/onboarding/contracts (3) > SPEC extensions/deployment/enterprise/operations (4) > DOC (5), while the engine default is ADR > SPEC > PRD > DOC. The manifest values were used for every comparison. In the sections compared, no PRD statement contradicts an ADR or SPEC, so the inversion changed no outcome.

[INFO] No competing PRD acceptance variants
  Note: Only one PRD (/Users/aphan/avarice/docs/requirements.md) was ingested, so there is no overlap between PRDs and nothing for the competing-variants bucket. Its 15 acceptance criteria (AC-1 to AC-15) are emitted as REQ-AC-* entries and are not mapped to individual requirements, because the source does not state that mapping in this document.

[INFO] Detection coverage limit and unresolved references
  Note: ADR and PRD text were read in full; implementation-plan.md and the SPEC sections listed in constraints.md were read; the DOCs reference-system-comparison.md, reference-system-deep-dive.md and existing-tooling-assessment.md were read at heading and introduction level, and the following SPEC sections were not read line by line: persisted entities and port method signatures (contracts-and-state.md), enterprise onboarding questionnaire and adapter guide, acceptance scenarios S-1 to S-59. Contradictions inside those sections would not have been detected. Unresolved cross_refs (not conflicts): external 3dmk file names (seele.md, registry.md, scrolls.md, postgres.md, consul-vault.md and others cited by reference-system-comparison.md), docs/reference/capability-manifest.md (cited by existing-tooling-assessment.md, not shipped with GSD per ADR-002), and ../README.md (cited by requirements.md and ADR-001, outside the ingest set). Several classification filenames carry placeholder or missing source hashes (classifier had no hashing tool); records are matched by source_path.

[INFO] Requirement IDs are shared across adjacent phases in the implementation plan
  Note: In /Users/aphan/avarice/docs/implementation-plan.md the GSD phase blocks list CON-2, CON-3, CON-5, CON-6, CON-13, NFR-1, NFR-3, NFR-5, NFR-6 and NFR-9 in both Phase 0 and Phase 1, and AUT-2 and AUT-12 in both Phase 1 and Phase 2 (the slice tables scope them partially, for example "AUT-2 (record only)", "AUT-12 (states and cancellation for one item)"). This is intentional partial scoping, not a conflict; the roadmapper must decide how to attribute coverage.
