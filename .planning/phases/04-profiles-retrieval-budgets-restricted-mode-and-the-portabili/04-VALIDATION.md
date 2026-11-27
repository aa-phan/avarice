---
phase: "04"
slug: "profiles-retrieval-budgets-restricted-mode-and-the-portabili"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-16"
audited: "2026-11-25"
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
| FR-12, FR-13 | Single-use, bound, expiring approvals; plan approval ≠ action approval | unit + integration + fault | `node --test test/integration/approvals.test.ts test/fault/approval-consume.test.ts test/unit/privileged-commands.test.ts test/integration/install-host.test.ts` (bash/zsh oracle in privileged-commands) | ✅ | ✅ green |
| FR-12 | Hook denies privileged shell forms | integration | `node --test test/integration/hook-privileged.test.ts` | ✅ | ✅ green |
| FR-14 | Retrieved content grants no authority | unit + integration | `node --test test/unit/policy-precedence.test.ts test/integration/untrusted-authority.test.ts test/integration/context-adapters.test.ts test/integration/run-spec-derivation.test.ts` | ✅ | ✅ green |
| FR-15 | Privileged step never replayed on resume | fault | `node --test test/fault/privileged-no-replay.test.ts` | ✅ | ✅ green |
| FR-16 | Typed `unsupported` naming reduced mode | unit | `node --test test/unit/capability-requirements.test.ts` | ✅ | ✅ green |
| FR-17, FR-18 | Namespaced extensions; verbatim provider IDs | unit | `node --test test/unit/extensions-namespace.test.ts` | ✅ | ✅ green |
| FR-19 | Manual equivalents offline with provenance | integration | `node --test test/integration/manual-equivalents.test.ts` | ✅ | ✅ green |
| FR-22 | Per-edge rules; handle-first under budget | unit + integration | `node --test test/unit/edge-rules.test.ts test/integration/context-handle-first.test.ts test/integration/context-adapters.test.ts test/integration/run-spec-derivation.test.ts` | ✅ | ✅ green |
| SEC-1 | 0 cross-profile reads (AC-6); WR-17: a permission refusal denies the other profile's whole root, other read errors exit 70 | unit + integration + fault | `node --test test/integration/profile-isolation.test.ts test/integration/run-sandbox-other-profiles.test.ts test/unit/profile-registry.test.ts test/unit/profile-config.test.ts test/integration/profile-selection.test.ts test/fault/bindings-race.test.ts` | ✅ | ✅ green |
| SEC-2 | Credential references; value-free resolve events | unit + integration | `node --test test/unit/credential-ref.test.ts test/integration/credential-broker.test.ts` | ✅ | ✅ green |
| SEC-3 | 0 secret patterns (AC-5) | unit + integration | `node --test test/unit/redactor.test.ts test/integration/redaction-suite.test.ts` | ✅ | ✅ green |
| SEC-4 | Policy precedence; lower ranks only restrict | unit | `node --test test/unit/policy-precedence.test.ts` | ✅ | ✅ green |
| SEC-6 | Enforcement map names enforcer + bypass limit | unit | `node --test test/unit/enforcement-map.test.ts` | ✅ | ✅ green |
| SEC-7 | No employer-specific footprint | unit | `node --test test/unit/footprint.test.ts` | ✅ | ✅ green |
| CON-4 | Explicit restricted mode | integration | `node --test test/integration/restricted-mode.test.ts` | ✅ | ✅ green |
| CON-10, CON-11 | Retrieval caps; broadDiscovery gating; exact counters | unit + integration + fault | `node --test test/unit/retrieval-rules.test.ts test/integration/retrieval-caps.test.ts test/fault/retrieval-race.test.ts test/integration/hook-retrieval.test.ts test/unit/hook-decision.test.ts` | ✅ | ✅ green |
| CON-12 | Cache scope invalidation | integration | `node --test test/integration/cache-scope.test.ts` | ✅ | ✅ green |
| OPS-1 | `doctor` offline, <2 s, `--json`, no secrets | integration | `node --test test/integration/doctor.test.ts` | ✅ | ✅ green |
| OPS-5 | Configurable bounds degrade as defined | unit + integration | `node --test test/unit/resource-bounds.test.ts test/integration/resource-degradation.test.ts` | ✅ | ✅ green |
| OPS-6 | Version incompatibility reported, records marked | unit + integration | `node --test test/unit/host-admission.test.ts test/integration/doctor-versions.test.ts` | ✅ | ✅ green (doctor-versions.test.ts:79 failed once under parallel load with `host-unavailable`; 13/13 on re-run alone) |
| NFR-4 | Contract + workflow suites on local and fake-remote (AC-7) | contract + integration | `node --test test/contract/*.test.ts test/integration/portability-proof.test.ts` | ✅ | ✅ green |
| OPS-5 | Knowledge-pass cost cap fails closed | unit + integration | `node --test test/unit/knowledge-cost-cap.test.ts test/integration/knowledge-cost-cap.test.ts` | ✅ | ✅ green |
| ONB-11 | Scoped refresh recovery path fails closed (WR-10) | integration | `node --test test/integration/refresh-scoped.test.ts` | ✅ | ✅ green |
| CON-4 | Restricted patch scope; host outputs as findings (WR-12, WR-13) | integration | `node --test test/integration/restricted-mode.test.ts test/integration/restricted-onboarding.test.ts` | ✅ | ✅ green |
| ONB-6 | Strict promotion paths (WR-22) | integration | `node --test test/integration/promotion.test.ts` | ✅ | ✅ green |
| FR-15 | Privileged step not replayed on recovery (WR-08, WR-09) | fault | `node --test test/fault/privileged-no-replay.test.ts` | ✅ | ✅ green |
| OPS-1 | `doctor` reports the attended hook install (WR-25) | integration | `node --test test/integration/doctor.test.ts test/integration/install-host.test.ts` | ✅ | ✅ green |
| AC-2 | `status` p95 < 300 ms at 1,000 runs; constant query count | benchmark + integration | `node scripts/status-bench.ts` and `node --test test/integration/status-queries.test.ts` | ✅ | ⚠️ flaky: statement-count test green; bench p95 406 and 459 ms on a loaded machine (load avg 7-11, empty floor ~200 ms vs 135 ms recorded); recorded quiet-machine p95 192 and 212 ms |
| AC-8 | Index arm ≥ baseline success at ≤ 95% of baseline tokens, inclusive (ADR-016 supersedes the 50% bound of ADR-015) | unit + live benchmark | `node --test test/unit/eval-retrieval.test.ts`; live: `AVARICE_LIVE=1 node scripts/eval-retrieval.ts` | ✅ | ✅ green: recorded 04-36 runs re-judge PASS via arm B at 94.4% (arm C 88.5%), `test/benchmark/phase4/eval-verdict-adr016.json`; live re-run manual-only |
| AC-14 | 5/5 brownfield repos reach active profile | live benchmark | `bash scripts/exit-run-phase4.sh` | ✅ | manual-only: live run recorded in 04-37, 5/5 active, passed |

**Gap-closure plans and regression fixes (audited 2026-11-23):**

| Plan / commit | Task(s) | Behavior | Automated Command | Status |
|---------------|---------|----------|-------------------|--------|
| 04-40 | T1-T3 | Attended gate fails closed on an unreadable line | `node --test test/unit/hook-decision.test.ts test/unit/privileged-commands.test.ts test/integration/hook-privileged.test.ts test/integration/hook.test.ts test/integration/resource-degradation.test.ts test/mutation/fail-closed.test.ts` | ✅ green |
| 04-41 | T1-T3 | Hostile repository cannot stall the planning adapter or reach a pack unfenced | `node --test test/integration/context-adapters.test.ts test/integration/context.test.ts test/integration/untrusted-authority.test.ts test/unit/gsd-planning-headings.test.ts test/unit/json-shapes.test.ts` | ✅ green |
| 04-42 | T1-T3 | Recovery-path fail-open closures (WR-07 to WR-10) | `node --test test/fault/approval-consume.test.ts test/fault/privileged-no-replay.test.ts test/fault/run-reconcile.test.ts test/integration/refresh-scoped.test.ts test/integration/promotion.test.ts test/integration/resume-reap.test.ts` | ✅ green |
| 04-43 | T1-T3 | Profile isolation and credential gaps | `node --test test/unit/profile-registry.test.ts test/integration/profile-selection.test.ts test/fault/bindings-race.test.ts test/unit/credential-ref.test.ts test/integration/credential-broker.test.ts` | ✅ green |
| 04-44 | T1-T3 | Restricted patch scope, host outputs as findings, strict promotion paths | `node --test test/integration/restricted-mode.test.ts test/integration/restricted-onboarding.test.ts test/integration/promotion.test.ts test/unit/port-descriptors.test.ts` | ✅ green |
| 04-45 | T1-T3 | Attended hook install and approval naming | `node --test test/integration/install-host.test.ts test/integration/approvals.test.ts test/integration/doctor.test.ts test/unit/shell.test.ts` | ✅ green |
| 04-46 | T1-T3 | Live harness spend guards | `node --test test/unit/eval-retrieval.test.ts test/unit/exit-run-phase4-tools.test.ts test/unit/live-spend-ceiling.test.ts` | ✅ green |
| 04-47 | T1-T3 | Strengthened security oracles | `node --test test/fault/approval-consume.test.ts test/fault/retrieval-race.test.ts test/integration/artifact-redaction.test.ts test/integration/run-sandbox-other-profiles.test.ts test/unit/credential-ref.test.ts` | ✅ green |
| 04-48 | T1-T2 | One approval authorizes one privileged action per shell line | `node --test test/unit/privileged-commands.test.ts test/unit/hook-decision.test.ts test/fault/approval-consume.test.ts test/integration/hook-privileged.test.ts` | ✅ green |
| 04-49 | T1-T2 | Knowledge cost cap and hook retrieval cap fail closed | `node --test test/unit/knowledge-cost-cap.test.ts test/integration/knowledge-cost-cap.test.ts test/integration/hook-retrieval.test.ts test/integration/knowledge-pass.test.ts` | ✅ green |
| 04-50 | T1 | AC-8 token bound decision (ADR-016) | manual-only (owner decision) | ✅ recorded |
| 04-50 | T2 | Recorded runs re-judged under ADR-016 | `node --test test/unit/eval-retrieval.test.ts` | ✅ green |
| 04-50 | T3, T4 | Documentation alignment | not applicable | — |
| 04-51 | T1-T3 | Approval authorizes the command the owner saw, nothing that redirects it | `node --test test/unit/privileged-commands.test.ts test/unit/approval.test.ts test/unit/action-class.test.ts test/integration/approvals.test.ts test/integration/hook-privileged.test.ts test/mutation/fail-closed.test.ts` | ✅ green |
| 04-52, 04-53 | all | Review records and documentation | not applicable (docs only) | — |
| 04-54 | T1 | Documentation ledgers; proposal docs unchanged | `node --test test/unit/footprint.test.ts` | ✅ green (see note) |
| 04-54 | T2 | Fresh prose reviews | manual-only (reviewer judgment) | ✅ recorded |
| 04-55 | T1-T2 | Run Reads bounded by whole-file caps | `node --test test/integration/hook-retrieval.test.ts test/unit/hook-decision.test.ts` | ✅ green |
| 3dccf9d | — | Planning-heading timing child kept out of the default run | `node --test test/unit/gsd-planning-headings.test.ts` | ✅ green |
| a53637b | — | Item specs derived from untrusted code nodes (WR-18) | `node --test test/integration/context-adapters.test.ts test/integration/run-spec-derivation.test.ts` | ✅ green |
| d01ff88 + 96a0718 | — | Permission refusal denies the other profile's whole root (WR-17, AC-6) | `node --test test/unit/profile-config.test.ts test/unit/profile-registry.test.ts test/integration/profile-selection.test.ts` | ✅ green |

**Second gap closure, plans 04-56 to 04-69 (audited 2026-11-25):** all 29 test files below run together on Node 26.9.0: 1054 tests, 0 fail; `npm run typecheck` and `npm run check:boundaries` clean.

| Plan | Task(s) | Behavior | Automated Command | Status |
|------|---------|----------|-------------------|--------|
| 04-56 | T1-T3 | Approval shows every bound value whole; unshowable values refused as `privileged:unapprovable` (GCR-01) | `node --test test/unit/approval.test.ts test/integration/hook-privileged.test.ts test/integration/approvals.test.ts test/fault/privileged-no-replay.test.ts test/integration/untrusted-authority.test.ts` | ✅ green |
| 04-57 | T1-T3 | gh persistent flags, same-line git alias, here-document scanned once (GWR-01, GWR-03, GIN-01) | `node --test test/unit/privileged-commands.test.ts` | ✅ green |
| 04-58 | T1-T2 | Out-of-scope file paths excluded literally from the restricted patch (GWR-04) | `node --test test/integration/run-workspace.test.ts test/integration/restricted-mode.test.ts test/integration/restricted-onboarding.test.ts` | ✅ green |
| 04-59 | T1-T3 | Stale bindings lock takeover, corrupt profile config denied whole, overlapped race shown (GWR-05, GWR-06, GWR-07) | `node --test test/unit/profile-bindings-lock.test.ts test/fault/bindings-race.test.ts test/unit/profile-registry.test.ts test/integration/run-sandbox-other-profiles.test.ts test/integration/profile-isolation.test.ts` | ✅ green |
| 04-60 | T1-T2 | Brace-group glob refusal says what is true; reused pack items carry current trust marks (GIN-03, GIN-05) | `node --test test/unit/hook-decision.test.ts test/integration/hook-retrieval.test.ts test/integration/cache-scope.test.ts test/integration/context.test.ts test/integration/context-handle-first.test.ts test/unit/json-shapes.test.ts test/integration/run-spec-derivation.test.ts` | ✅ green |
| 04-61 | T1-T3 | Per-run brief coverage in the AC-8 judgement; no spend charged for a step that never started a host (G-04-3, GIN-04) | `node --test test/unit/eval-retrieval.test.ts test/unit/live-spend-ceiling.test.ts test/unit/exit-run-phase4-tools.test.ts` | ✅ green |
| 04-62 | T1-T2 | Brace expansion and command-position globs seen or refused; residuals documented (GWR-02) | `node --test test/unit/privileged-commands.test.ts test/unit/enforcement-map.test.ts test/integration/hook-privileged.test.ts test/unit/hook-decision.test.ts` | ✅ green |
| 04-63 | T1-T2 | Wrappers and launchers (`find -exec`, `su -c`, `watch`, `parallel`, `doas`, `trap`, here-string) followed (GIN-02) | `node --test test/unit/privileged-commands.test.ts test/unit/enforcement-map.test.ts test/integration/hook-privileged.test.ts test/unit/hook-decision.test.ts` | ✅ green |
| 04-64 | T1 | Coverage record for the 18 recorded AC-8 runs loads against the pinned digests | plan's `loadCoverage` check; pinned inputs unchanged since ed9e123 | ✅ green |
| 04-64 | T2 | Owner re-approval of the amended success rule | manual-only (owner decision, recorded in `eval-success-amendment.json`) | ✅ recorded |
| 04-65 | T1-T2 | Re-judged verdict equals harness output (`eval-verdict-adr017.json`); ADR-017 accepted | `node --test test/unit/eval-retrieval.test.ts` | ✅ green |
| 04-66 | T1-T3 | Suite green on the Node floor 22.22.3 and on 26.9.0 (G-04-4) | node-legs check over `04-66-node-legs.json` (5722 tests, 0 fail, both legs) | ✅ green |
| 04-67, 04-68, 04-69 | all | Documentation pass and fresh prose reviews | not applicable (docs only); reviews manual-only | — |
| 04-70 | T1, T3 | Round-3 WARNINGs and WR-01 fixed; review statuses set only from a PASS verdict and matching digests | plan's grep, sentence-sweep, `git diff --quiet` and digest checks; `npm test` 5722 tests, 0 fail | ✅ green |
| 04-70 | T2 | Scoped round-4 prose reviews, groups A and B | manual-only (reviewer judgment; both PASS, 0 BLOCKER, 0 WARNING) | ✅ recorded |

Note (04-54 T1): the literal check `git diff --quiet 792536d..HEAD -- <five proposal docs>` exits 1 because commit 843c839 (plan 04-50, ADR-016, an owner decision) changed one line of `docs/operations-and-testing.md`. This is an accepted deviation recorded in `04-54-SUMMARY.md`, not a gap.

Suggestion (not a gap): add a unit test asserting every `test/helpers/*-child.ts` is inert under `node --test`, hardening the class of regression fixed in 3dccf9d.

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
| AC-8 live retrieval re-run | AC-8 / FR-22 | Owner-gated live spend; the verdict logic (ADR-016, ≤ 95% of baseline tokens inclusive) is automated in `test/unit/eval-retrieval.test.ts` and the recorded runs re-judge PASS (arm B 94.4%, arm C 88.5%) | Owner approves the spend, then `AVARICE_LIVE=1 node scripts/eval-retrieval.ts` |
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

**Approval:** validated 2026-11-25 (gap-closure audit after plan 04-70, docs only; 0 gaps; no tests generated). Also 2026-11-25: gap-closure audit after plans 04-56 to 04-69; 0 gaps; no tests generated. Earlier: validated 2026-11-23 after plans 04-40 to 04-55; 0 gaps.

Audit notes (2026-11-22): two mapped files do not exist and are covered elsewhere. FR-14 is covered by `test/unit/policy-precedence.test.ts` ("the evaluator accepts only the four declared sources"); FR-18 by `test/unit/extensions-namespace.test.ts`, `test/integration/run-resume-refs.test.ts` and `test/integration/manual-equivalents.test.ts`. All 42 mapped offline test files plus `test/contract/*.test.ts` were run together: one failure (`test/integration/doctor-versions.test.ts:79`, a load flake, green alone), which joins the known-flake list.

## Validation Audit 2026-11-22

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
