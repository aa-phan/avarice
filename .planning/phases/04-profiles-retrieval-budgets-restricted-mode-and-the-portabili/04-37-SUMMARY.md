---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 37
subsystem: documentation
tags: [docs-system, policy, approvals, profiles, credentials, redaction, doctor, portability, adr-015, d-08]
requires:
  - phase: 04
    provides: plans 04-01 to 04-36, the code each documented surface comes from
provides:
  - "docs/system/policy-and-approvals.md, profiles-and-credentials.md, doctor.md and portability.md, written from the code"
  - "docs/system/diagrams/approve-privileged-action.puml"
  - "docs/decisions/ADR-015-knowledge-pass-default.md: AC-8 failed on its token bound and D-08 keeps the knowledge pass on"
  - "a 150-row worklist: 66 rows drafted here, 60 todo for plan 04-38, 24 for plan 04-39 (8 already logged)"
  - "the four documents listed in README.md and coverage.md as drafted; twelve lines in findings.md"
affects: [04-38, 04-39]
actuals:
  tokens: 31000
  tasks: 3
  commits: 4
plan_head_before: 5d3ce45f0d2e2eb1087aa07d70ea71b96bfd416e
plan_head_after: caad6ceb13f5e950a3fb78c07747cf494c2a740d
tech-stack:
  added: []
  patterns: ["a subsystem document names its modules once in the opening and keeps paths, function names and delivery history out of the prose", "a worklist row carries an owner plan and a status of todo, drafted, deferred or logged"]
key-files:
  created:
    - docs/system/policy-and-approvals.md
    - docs/system/profiles-and-credentials.md
    - docs/system/doctor.md
    - docs/system/portability.md
    - docs/system/diagrams/approve-privileged-action.puml
    - docs/decisions/ADR-015-knowledge-pass-default.md
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-37-doc-worklist.md
  modified:
    - docs/system/README.md
    - docs/system/coverage.md
    - docs/system/findings.md
key-decisions:
  - "ADR-015 applies the D-08 rule as written: C ties B on success and costs fewer run tokens, so the knowledge pass stays on; AC-8 is recorded as failed (B 94.4 and C 88.5 percent of A's tokens against a 50 percent bound)"
  - "The four documents are marked drafted in coverage.md and carry the drafted mark under their titles; none is marked reviewed"
requirements-completed: [SEC-1, SEC-2, SEC-3, SEC-4, SEC-6, SEC-7, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-19, OPS-1, OPS-6, NFR-4]
coverage:
  - id: D1
    description: "A worklist compares the phase's diff with docs/system and lists every changed surface with its target document and owner"
    verification:
      - kind: other
        ref: "grep -c '| todo |\\|| drafted |' on the worklist: 126 rows with a status; 150 rows in all (24 are deferred or logged)"
        status: pass
    human_judgment: true
    rationale: "Whether the rows cover every surface is the fresh review's call; the rows were built from the 36 summaries and a 150-file diff stat"
  - id: D2
    description: "Four subsystem documents and one diagram written from the code, with no plan ID, phase number or threat ID in their prose"
    verification:
      - kind: other
        ref: "grep -nE '04-[0-9]{2}|Phase [0-9]|T-04-' over the four documents and the diagram prints nothing; every action, enforcement row, profile key and doctor area is in its document"
        status: pass
    human_judgment: true
    rationale: "Prose quality and claim accuracy are reviewed by a fresh prose reviewer in plan 04-39"
  - id: D3
    description: "ADR-015 records the D-08 outcome from the measured evaluation"
    requirement: FR-22
    verification:
      - kind: other
        ref: "grep -n '^## ' docs/decisions/ADR-015-knowledge-pass-default.md prints Context, Decision, Consequences, Alternatives considered, References"
        status: pass
    human_judgment: true
    rationale: "The owner reads the negative consequences and decides whether a rule that counts setup cost should supersede it"
duration: 90 min
completed: 2026-11-20
status: complete
---

# Phase 4 Plan 37: The four new subsystem documents and ADR-015 Summary

**Policy and approvals, profiles with credentials and redaction, doctor and portability are documented from the code with an approval flow diagram, and ADR-015 records that AC-8 failed its 50 percent token bound while D-08 keeps the knowledge pass on.**

## Performance

- **Duration:** about 90 min (an estimate; the start time was not captured)
- **Completed:** 2026-11-20T08:32Z
- **Tasks:** 3
- **Files modified:** 10 (7 created, 3 edited)

## Accomplishments

- **Worklist:** 150 rows from the `Documentation surfaces` of plans 04-01 to 04-36 and the diff stat (150 files, 12,147 insertions against `9836e22`). Each row has a kind, a code anchor, a target document, an owner plan and a status. 66 are drafted here, 60 are `todo` for plan 04-38, 24 belong to plan 04-39 (8 of them already logged in `findings.md`).
- **policy-and-approvals.md:** the 22 classed actions, the four ranked sources and their evaluation order, approvals from request to expiry and revocation, the gate order, the seven privileged shell forms and the parameters each binds, the hook in a run and in an attended session, no replay after an interruption, the 18-row enforcement map in table order, the manual equivalents and the quirks.
- **profiles-and-credentials.md:** names and classes, the selection precedence and bindings, enterprise remote claims, the config file with all 14 keys (two are read by nothing), roots and moved-root denial with its residual, store scoping, credential references and providers, the audit event, redaction at every boundary and transcript retention.
- **doctor.md:** what it reads, the four flags and exit codes, every report section, the findings of all 11 areas with level, host admission and enforcement, and the derived record incompatibility with the matching start refusal.
- **portability.md:** the descriptors of 12 ports, the 12 step requirements and the unsupported refusal, extension names, the two fake-remote adapters and the seeded fault source, the contract suite (11 and 10 cases), the workflow proof and what it does not show.
- **approve-privileged-action.puml:** request, owner approval, revoke and retry, for a run and for an attended session.
- **ADR-015:** the measured per-arm success and tokens, the 20 to 9 to 6 task-set reduction by three owner rulings, the decision and four negative consequences with an owner each.
- **Findings:** twelve lines in `findings.md` (below).

## Task Commits

1. **Task 1: worklist, the approvals half of the policy document, the diagram** - `429b78f` (docs)
2. **Task 2: the rest of the policy document, profiles and credentials** - `85b13f0` (docs)
3. **Task 3: doctor, portability, ADR-015** - `88b8f42` (docs)
4. **Listing: README, coverage, findings** - `caad6ce` (docs)

**Plan metadata:** the close-out commit that holds this summary, `STATE.md` and `ROADMAP.md`.

The tracer (task 1) carried one surface, `avarice approve`, from the code through the worklist into the new document and the diagram before the other documents began.

## Files Created/Modified

- `docs/system/policy-and-approvals.md`, `profiles-and-credentials.md`, `doctor.md`, `portability.md` - the four subsystem documents, each marked drafted under its title
- `docs/system/diagrams/approve-privileged-action.puml` - the approval flow
- `docs/decisions/ADR-015-knowledge-pass-default.md` - the D-08 decision record
- `docs/system/README.md` - four rows in the documents table; the counterpart rows for portability, enterprise adaptation, ADR-005 and ADR-009, and the two new documents added to the operations proposal's row
- `docs/system/coverage.md` - the four documents as `drafted`; denominators and documented counts untouched (plan 04-39 recounts)
- `docs/system/findings.md` - twelve lines
- `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-37-doc-worklist.md` - the worklist and its hand-off

## Decisions Made

- The D-08 outcome follows the rule as written. The negative consequence that the rule ignores setup cost (C's onboarding averaged 0.83 USD against 0.12 USD for B) is recorded at full strength with the owner named, not answered.
- The four documents are named after the built subsystems because no single proposal's scope matches (CLAUDE.md). The evaluation harness has no document: the plan lists four, and the worklist and `findings.md` carry it.
- The listing in `README.md` and `coverage.md` and the findings lines are in this plan, because CLAUDE.md requires a new document to be listed when it is written. Plan 04-39 reviews them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Listing and findings added to this plan**
- **Found during:** Task 3
- **Issue:** the plan's file list names neither `README.md`, `coverage.md` nor `findings.md`, but CLAUDE.md requires every new document to be listed in both tables and in the ledger, and the orchestrator asked for the three finding lines of the evaluation.
- **Fix:** listed the four documents as `drafted`, added the proposal counterpart rows, and logged twelve finding lines, nine from grounding the four documents and three from the evaluation.
- **Files modified:** docs/system/README.md, docs/system/coverage.md, docs/system/findings.md
- **Committed in:** caad6ce

**2. [Rule 1 - Bug] Claims corrected against the code while writing**
- **Found during:** Tasks 1 to 3
- **Issue:** several summary statements did not hold at HEAD: the `limits` section does not stop composition (it falls back to the defaults), the `adapters` section stops every command, policy is evaluated only by the gate whose one caller is promotion, the planning-initialization requirement is never checked, and no adapter declares `paged`.
- **Fix:** each document states the behavior the code has, and the first of these is a finding line.
- **Committed in:** 85b13f0, 88b8f42

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug in the source material)
**Impact on plan:** none on scope; the fresh review in plan 04-39 should check the corrected claims first.

## Decisions needing owner review

- **Policy is not consulted by the hook.** An organization rule that denies a privileged action does not stop an approved push in an attended session, and a run never consumes an approval. `findings.md` has the lines with `file:line`; the owner decides whether the proposal or the code moves.
- **ADR-015's rule ignores setup cost.** The default stays on although the knowledge pass's onboarding cost is about seven times the code-only one and bought no measured success. The owner decides whether a later rule should count setup.

## Issues Encountered

- `plantuml` is not installed here, so the diagram source was checked by reading and not rendered. The repository has no render step (listed under Outstanding in `coverage.md`).
- Several path anchors in the first worklist draft were wrong (a live-spend module that does not exist, a line number in `main.ts` and `result.ts`); a check that every cited file exists found them and they were corrected before the commit that kept the worklist.

## Known Stubs

None.

## Threat Flags

None. The plan adds documents and a decision record; no endpoint, auth path or file access.

## Self-Check: PASSED

- Created files exist: the four documents, the diagram, ADR-015 and the worklist were read back after writing.
- Commits `429b78f`, `85b13f0`, `88b8f42` and `caad6ce` are ancestors of HEAD.
- `grep -nE "04-[0-9]{2}|Phase [0-9]|T-04-"` over the four documents and the diagram prints nothing; no em dash, en dash or spaced double hyphen in any file written.
- Every key of the action table, the enforcement map, the profile config key set and the doctor areas appears in its document.
- `node --test test/unit/footprint.test.ts` passes (32 of 32).
