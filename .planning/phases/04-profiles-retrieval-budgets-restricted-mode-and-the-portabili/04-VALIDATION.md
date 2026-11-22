---
phase: "04"
slug: "profiles-retrieval-budgets-restricted-mode-and-the-portabili"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-16"
audited: "2026-11-22"
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node v26.9.0 dev, minimum 22.22.3), TypeScript by type stripping; no test dependency |
| **Config file** | none — tiers are directories: `test/unit`, `test/integration`, `test/fault`, `test/mutation`, `test/containment` (live only with `AVARICE_LIVE=1`), `test/benchmark` |
| **Quick run command** | `node --test test/unit/<file>.test.ts` plus `npm run check:boundaries` and `npm run typecheck` |
| **Full suite command** | `npm test`; two-Node matrix `AVARICE_NODE22=/path/to/node-v22.22.3/bin/node bash scripts/test-matrix.sh` |
| **Estimated runtime** | unit tier ~68 s; integration + fault + mutation ~852 s |

Known flakes (treat a first failure as a flake, re-run once): `run-status.test.ts:98` (midnight rollover), `run-independent-work.test.ts:298` (load-dependent row count).

---

## Sampling Rate

- **After every task commit:** touched test files + `npm run check:boundaries` + `npm run typecheck`
- **After every plan wave:** `node --test "test/unit/**/*.test.ts"` and the integration, fault and mutation tiers; snapshots unchanged (`AVARICE_SNAPSHOT_WRITE` unset)
- **Before `/gsd-verify-work`:** `npm test` on both Node versions, offline exit suites (isolation, redaction, AC-2, portability) green before any live case, then T3 live cases, AC-14 and AC-8 runs, then the documentation plan and fresh reviews
- **Max feedback latency:** ~90 seconds per task (unit + gates)

---

## Per-Task Verification Map

Filled in by the planner and executor per plan; requirement-level map:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| ONB-6 | Adopt stamped map; regenerate unknown/user-edited in isolation; never overwrite | unit + integration | `node --test test/unit/preflight.test.ts test/integration/onboard-adopt.test.ts` | ✅ | ✅ green |
| ONB-6 | Promotion copy/commit behind action gate | integration | `node --test test/integration/promotion.test.ts` | ✅ | ✅ green |
| ONB-11 | Incremental / path-scoped / full refresh choice | unit + integration | `node --test test/unit/refresh-plan.test.ts test/integration/refresh-scoped.test.ts` | ✅ | ✅ green |
| ONB-11 | Changed-path graph merge equals full rebuild | integration | `node --test test/integration/graph-incremental.test.ts` | ✅ | ✅ green |
| ONB-15 | Only changed documents re-extracted | integration | `node --test test/integration/knowledge-refresh.test.ts` | ✅ | ✅ green |
| FR-3 | Pack item provenance, budget-bounded | integration | `node --test test/integration/context.test.ts` | ✅ | ✅ green |
| FR-8 | Resume refreshes or marks refs stale | integration | `node --test test/integration/run-resume-refs.test.ts` | ✅ | ✅ green |
| FR-12 | Action classification; bound approvals | unit | `node --test test/unit/action-class.test.ts test/unit/approval.test.ts` | ✅ | ✅ green |
| FR-12, FR-13 | Single-use, bound, expiring approvals; plan approval ≠ action approval | integration + fault | `node --test test/integration/approvals.test.ts test/fault/approval-consume.test.ts` | ✅ | ✅ green |
| FR-12 | Hook denies privileged shell forms | integration | `node --test test/integration/hook-privileged.test.ts` | ✅ | ✅ green |
| FR-14 | Retrieved content grants no authority | unit + integration | `node --test test/unit/policy-precedence.test.ts test/integration/untrusted-authority.test.ts` | ✅ | ✅ green |
| FR-15 | Privileged step never replayed on resume | fault | `node --test test/fault/privileged-no-replay.test.ts` | ✅ | ✅ green |
| FR-16 | Typed `unsupported` naming reduced mode | unit | `node --test test/unit/capability-requirements.test.ts` | ✅ | ✅ green |
| FR-17, FR-18 | Namespaced extensions; verbatim provider IDs | unit | `node --test test/unit/extensions-namespace.test.ts` | ✅ | ✅ green |
| FR-19 | Manual equivalents offline with provenance | integration | `node --test test/integration/manual-equivalents.test.ts` | ✅ | ✅ green |
| FR-22 | Per-edge rules; handle-first under budget | unit + integration | `node --test test/unit/edge-rules.test.ts test/integration/context-handle-first.test.ts` | ✅ | ✅ green |
| SEC-1 | 0 cross-profile reads (AC-6) | integration | `node --test test/integration/profile-isolation.test.ts test/integration/run-sandbox-other-profiles.test.ts` | ✅ | ✅ green |
| SEC-2 | Credential references; value-free resolve events | unit + integration | `node --test test/unit/credential-ref.test.ts test/integration/credential-broker.test.ts` | ✅ | ✅ green |
| SEC-3 | 0 secret patterns (AC-5) | unit + integration | `node --test test/unit/redactor.test.ts test/integration/redaction-suite.test.ts` | ✅ | ✅ green |
| SEC-4 | Policy precedence; lower ranks only restrict | unit | `node --test test/unit/policy-precedence.test.ts` | ✅ | ✅ green |
| SEC-6 | Enforcement map names enforcer + bypass limit | unit | `node --test test/unit/enforcement-map.test.ts` | ✅ | ✅ green |
| SEC-7 | No employer-specific footprint | unit | `node --test test/unit/footprint.test.ts` | ✅ | ✅ green |
| CON-4 | Explicit restricted mode | integration | `node --test test/integration/restricted-mode.test.ts` | ✅ | ✅ green |
| CON-10, CON-11 | Retrieval caps; broadDiscovery gating; exact counters | unit + integration + fault | `node --test test/unit/retrieval-rules.test.ts test/integration/retrieval-caps.test.ts test/fault/retrieval-race.test.ts` | ✅ | ✅ green |
| CON-12 | Cache scope invalidation | integration | `node --test test/integration/cache-scope.test.ts` | ✅ | ✅ green |
| OPS-1 | `doctor` offline, <2 s, `--json`, no secrets | integration | `node --test test/integration/doctor.test.ts` | ✅ | ✅ green |
| OPS-5 | Configurable bounds degrade as defined | unit + integration | `node --test test/unit/resource-bounds.test.ts test/integration/resource-degradation.test.ts` | ✅ | ✅ green |
| OPS-6 | Version incompatibility reported, records marked | unit + integration | `node --test test/unit/host-admission.test.ts test/integration/doctor-versions.test.ts` | ✅ | ✅ green (doctor-versions.test.ts:79 failed once under parallel load with `host-unavailable`; 13/13 on re-run alone) |
| NFR-4 | Contract + workflow suites on local and fake-remote (AC-7) | contract + integration | `node --test test/contract/*.test.ts test/integration/portability-proof.test.ts` | ✅ | ✅ green |
| AC-2 | `status` p95 < 300 ms at 1,000 runs; constant query count | benchmark + integration | `node scripts/status-bench.ts` and `node --test test/integration/status-queries.test.ts` | ✅ | ⚠️ flaky: statement-count test green; bench p95 406 and 459 ms on a loaded machine (load avg 7-11, empty floor ~200 ms vs 135 ms recorded); recorded quiet-machine p95 192 and 212 ms |
| AC-8 | Index arm ≥ baseline success at ≤ 50% tokens | live benchmark | `AVARICE_LIVE=1 node scripts/eval-retrieval.ts` | ✅ | manual-only: live run recorded in 04-36 fails the 50% token bound (ADR-015) |
| AC-14 | 5/5 brownfield repos reach active profile | live benchmark | `bash scripts/exit-run-phase4.sh` | ✅ | manual-only: live run recorded in 04-37, 5/5 active, passed |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `scripts/status-bench.ts` and `test/integration/status-queries.test.ts` — seed 1,000 runs, p50/p95, constant statement count
- [x] `test/containment/live-spend-phase4.jsonl` guard in `test/helpers/live-harness.ts` (`CURRENT_SPEND_PHASE` = 4) + unit test beside `live-spend-ceiling.test.ts`
- [x] `test/fixtures/org-acme/` fixture organization package and a stamped-complete GSD map fixture
- [x] `test/helpers/fake-remote-executor.ts`, `fake-remote-artifact-store.ts`, seeded fault source, `test/contract/` shared suite
- [x] `scripts/eval-retrieval.ts`, `scripts/exit-run-phase4.sh`, `test/benchmark/phase4/`
- [x] Spike records under `spikes/phase-4-wave-0/` (edge relations, node-ID stability, host probes)
- [x] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| AC-8 retrieval evaluation spend approval | AC-8 / FR-22 | Owner-gated live spend | Run the 3-task cost pilot, owner approves the spend, then `AVARICE_LIVE=1 node scripts/eval-retrieval.ts` |
| AC-14 brownfield benchmark repositories | ONB-6 / AC-14 | Owner chooses repositories; live spend | Owner approves repository list; `bash scripts/exit-run-phase4.sh` |
| Fresh-eyes review of `docs/system/` documents | SC6 | Reviewer agent judgment | `technical-writer:prose-reviewer` per new or changed document |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 90s (met for unit + gates; the integration tier runs longer)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-22 (report-only audit; no tests generated)

Audit notes (2026-11-22): two mapped files do not exist and are covered elsewhere. FR-14 is covered by `test/unit/policy-precedence.test.ts` ("the evaluator accepts only the four declared sources"); FR-18 by `test/unit/extensions-namespace.test.ts`, `test/integration/run-resume-refs.test.ts` and `test/integration/manual-equivalents.test.ts`. All 42 mapped offline test files plus `test/contract/*.test.ts` were run together: one failure (`test/integration/doctor-versions.test.ts:79`, a load flake, green alone), which joins the known-flake list.

## Validation Audit 2026-11-22

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
