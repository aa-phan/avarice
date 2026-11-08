---
phase: "03"
slug: "decisions-independent-work-and-amendments"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-08"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node 26.9.0), TypeScript via type stripping |
| **Config file** | none — `package.json` scripts `test`, `test:unit`, `check:boundaries`, `typecheck` |
| **Quick run command** | `node --test test/unit/<file>.test.ts` plus `npm run typecheck` |
| **Full suite command** | `node --test` (rerun a known load-sensitive failure alone before treating it as real) |
| **Estimated runtime** | ~13 seconds unit suite; full suite longer |

---

## Sampling Rate

- **After every task commit:** Run the one or two test files the task touches, plus `npm run typecheck`
- **After every plan wave:** Run `node --test "test/unit/**/*.test.ts"`, `node scripts/check-boundaries.ts`, `npm run typecheck`, then the new integration files
- **Before `/gsd-verify-work`:** Full suite must be green; live suites only after the owner's spend checkpoint
- **Max feedback latency:** 30 seconds per task

---

## Per-Task Verification Map

Task IDs are filled by the planner. Requirement-level map (from 03-RESEARCH.md § Validation Architecture):

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| AUT-1 | Structural signal → class and authority; unclassifiable pause → `human` | unit | `node --test test/unit/decision-policy.test.ts` | ❌ W0 | ⬜ pending |
| AUT-2 | Options from numbered list, transitive affected items, recommendation | unit + integration | `node --test test/unit/decision-policy.test.ts test/integration/run-decisions.test.ts` | ❌ W0 | ⬜ pending |
| AUT-3 | Independent item done with evidence while dependent blocked; park/unpark | integration | `node --test test/integration/run-independent-work.test.ts test/integration/run-park.test.ts` | ❌ W0 | ⬜ pending |
| AUT-4 | Silence and failing notifier leave decision open and visible | integration | `node --test test/integration/run-silence.test.ts` | ❌ W0 | ⬜ pending |
| AUT-5 | Response validation suite; lost-wakeup race | unit + integration + fault | `node --test test/unit/response-validation.test.ts test/integration/decide.test.ts test/fault/decide-race.test.ts` | ❌ W0 | ⬜ pending |
| AUT-6 | argv-only banner, retry/backoff, quiet hours; LaunchAgent plist | unit + integration | `node --test test/unit/notify-policy.test.ts test/integration/notifier.test.ts test/integration/schedule.test.ts` | ❌ W0 | ⬜ pending |
| AUT-10 | Integrity gates fail on each tamper; repair then `repeated_failure` | unit + integration | `node --test test/unit/gates.test.ts test/integration/run-repair.test.ts` | partial | ⬜ pending |
| AUT-12 | Cancel at each state; withdrawn decisions | integration + fault | `node --test test/integration/run-cancel.test.ts test/fault/run-killpoints.test.ts` | partial | ⬜ pending |
| AUT-16 | Newly failing check charged to the breaking item | integration | `node --test test/integration/run-regression.test.ts` | ❌ W0 | ⬜ pending |
| RC-6 | Amend versioning and per-type invalidation | unit + integration | `node --test test/unit/amendment.test.ts test/integration/contract-amend.test.ts` | ❌ W0 | ⬜ pending |
| RC-7 | Size and spec derivation marked `derived` | unit | `node --test test/unit/brief.test.ts test/unit/run-contract.test.ts` | ✅ extend | ⬜ pending |
| RC-8 | `modelBySize` selects `--model` per item | integration | `node --test test/integration/run-models.test.ts` | ❌ W0 | ⬜ pending |
| CON-15 | Subagents share parent budget, cannot exceed authority | integration + live | `node --test test/integration/hook.test.ts test/unit/agent-frontmatter.test.ts` | partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/live-harness.ts` — per-phase spend ledger (Phase 3, 25 USD ceiling, lower-only override)
- [ ] `test/helpers/fake-run-host.ts` — per-item scripts, pause with `question`, resume, missing session, subagent counts
- [ ] Spike S3-A (live, small cap) — pause, `--resume` under the contained line, plan format
- [ ] Migration 0003 + `test/fault/migrations.test.ts` upgrade case
- [ ] Host admission of the installed `claude` version (or pin)
- [ ] New test files from the map above; `test/unit/footprint.test.ts` updated
- [ ] Brief drafts for the three portfolio exit runs; owner checkpoint before live spend

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Three portfolio exit runs (SC1–SC4) | AUT-3, AUT-5, RC-6 | Live model spend, owner-gated | `AVARICE_LIVE=1 AVARICE_PHASE3_PLAN=<id> node --test test/containment/live-run-phase3.test.ts` after owner checkpoint |
| docs/system currency and prose review (SC6) | all | Fresh-eyes review by `technical-writer:prose-reviewer` | Documentation plan; counts re-run per `coverage.md` |
| Notification banner visible on screen | AUT-6 | macOS UI | Run `avarice digest` and observe banner |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
