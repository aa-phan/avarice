---
phase: "02"
slug: "contained-unattended-run-of-one-work-item"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-05"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `02-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict`, Node >=22.22.3 (dev 26.9.0) |
| **Config file** | none (`package.json` scripts, `tsconfig.json`, `scripts/check-boundaries.ts`) |
| **Quick run command** | `node --test "test/unit/**/*.test.ts" && node scripts/check-boundaries.ts && npx tsc -p .` |
| **Full suite command** | `node --test` on the dev Node, plus `AVARICE_NODE22=<node 22.22.3> bash scripts/test-matrix.sh` |
| **Live tier** | `AVARICE_LIVE=1 node --test test/containment/live-run.test.ts` (skipped unless set; spend recorded in `test/containment/LIVE-CASES.md` against the 25 USD ceiling) |
| **Estimated runtime** | ~60–120 seconds (full suite) |

Never pass a bare directory to `node --test`; use quoted globs. Tiers as Phase 1: T1 unit, T2 integration (fake host, real SQLite/git/sandbox), T3 live scratch repo, T4 exit runs on the portfolio.

---

## Sampling Rate

- **After every task commit:** Run the quick run command plus the task's own test file(s)
- **After every plan wave:** Run the full suite on Node 22.22.3 and the dev Node
- **Before `/gsd-verify-work`:** Full suite green, live T3 run-purpose suite green once on the admitted host version, three portfolio runs recorded, AC-3 at 100%
- **Max feedback latency:** 120 seconds
- **Known flake:** `test/fault/killpoints.test.ts` under full-suite CPU load; keep run kill-point suites serial with generous waits

---

## Per-Task Verification Map

To be filled from the PLAN.md files once planning completes. Requirement → test mapping lives in `02-RESEARCH.md` § Phase Requirements -> Test Map.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/fake-agent-host.ts` — run-mode options (in-scope writes, SUMMARY, pause question, `killAfterFiles`, crash, timeout, commit attempt, outcome kinds) through the real hook entry
- [ ] `test/helpers/run-fixtures.ts` — scratch repo with `package.json` scripts, `.planning/ROADMAP.md`, `.avarice/config.json`, a base-failing check
- [ ] `test/helpers/fault-run.ts` — `RUN_KILL_POINTS` catalog and run-aware resume helper
- [ ] Snapshots of Phase 1 `--json` output (before any renderer change)
- [ ] `test/fixtures/db/schema-v1.sqlite` migrate-to-v2 expectations
- [ ] Live spikes (counted in the 25 USD): S2-A claude 2.1.318 admission; S2-B `/gsd-quick --validate --text` under a run-purpose hook, commits denied; S2-C `npm ci` through the allowlist proxy; S2-D in-sandbox commit (host limitation 8)
- [ ] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Three R1 portfolio tasks reach `ready_for_review` | SC1, S-12, S-41 | T4 exit run on a real repository, costs money, owner checkpoint | `scripts/exit-run-phase2.sh` after owner approval |
| Interactive shell in a real terminal | FR-27, SC6 | Needs a real TTY | Run `avarice` with no args, start/watch/resume, close shell, confirm supervisor alive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
