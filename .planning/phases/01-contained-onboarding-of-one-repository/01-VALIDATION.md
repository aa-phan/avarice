---
phase: "1"
slug: "contained-onboarding-of-one-repository"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-01"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` on Node 22.22.3+ (also run on the dev Node 26.9.0) |
| **Config file** | none — Wave 0 adds `package.json` scripts, `tsconfig.json`, `scripts/check-boundaries.ts` |
| **Quick run command** | `node --test "test/unit/**/*.test.ts" && node scripts/check-boundaries.ts && npx tsc -p .` |
| **Full suite command** | `node --test` (T1 + T2) on Node 22.22.3 and the dev Node |
| **Estimated runtime** | ~60 seconds for T1 + T2 (T3 live cases about $0.10 each, gated by `AVARICE_LIVE=1`) |

Tiers: T1 unit (free) · T2 integration with no model: real SQLite, git, GSD, graphify, fake `AgentHost`, `sandbox-exec` (free) · T3 live `claude -p --model haiku --max-budget-usd 0.40` on a scratch repo (`AVARICE_LIVE=1`) · T4 exit run on `~/aa-phan-portfolio-v2` and the AC-1 timing run.

Never pass a bare directory to `node --test` (fails on 22.x); use quoted globs.

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite on Node 22.22.3 and the dev Node
- **Before `/gsd-verify-work`:** Full suite green, T3 suite green once, T4 exit run and AC-1 run recorded
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; this map is keyed by requirement and is filled in per task during planning and execution.

| Requirement | Behavior | Tier | Automated Command | File Exists | Status |
|-------------|----------|------|-------------------|-------------|--------|
| ONB-1 | Every transition committed before its effect; illegal transition rejected | T1+T2 | `node --test "test/unit/transitions.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-1 / NFR-6 | SIGKILL at each kill point; `resume` reaches the same active record | T2 | `node --test "test/fault/killpoints.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-2 | Ledger and data root hold refs and digests only (S-27) | T2 | `node --test "test/integration/no-competing-index.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-3 | Executor cannot write source via `sed -i`, `python3 -c`, `node -e`, repo script, symlink | T2 | `node --test "test/containment/executor.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-3 | Edit/Write/Bash/Python source edits and policy-file edit blocked in a live mapping invocation (S-30) | T3 | `AVARICE_LIVE=1 node --test "test/containment/live-*.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-4 | No repo hook, fsmonitor, install, test or script runs during staging | T2 | `node --test "test/integration/no-repo-exec.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-5 | No commit on the staging branch or in the checkout; refs digest unchanged (S-32) | T2/T3 | `node --test "test/integration/no-repo-exec.test.ts"` (rev-parse and for-each-ref before/after) | ❌ W0 | ⬜ pending |
| ONB-7 | Completeness `complete` for full, `partial` with scope for fast (S-33) | T2 | `node --test "test/integration/completeness.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-8 / CON-13 | Budgets persist across kill and resume; over-budget subagent and tool call denied (S-35) | T2 | `node --test "test/fault/budgets.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-9 | Record versions immutable; proposed paths only narrow; activation validated | T1 | `node --test "test/unit/record.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-12 / CON-3 | Missing settings, hook removed, sandbox unavailable, GSD out of range → `blocked`/`incompatible`, no launch (S-36) | T2 (+T3 hook removed) | `node --test "test/containment/failclosed.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-13 | Graph and intel recorded with build commit equal to staging HEAD; failed index leaves record without it (S-39, S-40) | T2 | `node --test "test/integration/index-stage.test.ts"` | ❌ W0 | ⬜ pending |
| ONB-14 | Document nodes cite path and revision; edges INFERRED/AMBIGUOUS; no phase files in corpus; injected instruction stays data (S-45, S-46) | T2 + T3 | `node --test "test/integration/knowledge-pass.test.ts"` | ❌ W0 | ⬜ pending |
| FR-20 | `avarice context <term>` returns graph and intel hits; EXTRACTED survives trimming longest | T2 | `node --test "test/integration/context.test.ts"` | ❌ W0 | ⬜ pending |
| SEC-5 | No TLS-disabling construct in source or argv; env allowlist drops proxy/TLS vars | T1 | `node --test "test/unit/sec5.test.ts"` | ❌ W0 | ⬜ pending |
| NFR-2 | `status`, `resume` planning and validation run offline | T2 | `node --test "test/integration/offline.test.ts"` | ❌ W0 | ⬜ pending |
| NFR-3 | Boundary script rejects negative fixtures, passes `src/` | T1 | `node scripts/check-boundaries.ts && node --test "test/unit/boundaries.test.ts"` | ❌ W0 | ⬜ pending |
| NFR-5 | `init` refuses a data root on a non-local mount | T1 | `node --test "test/unit/localfs.test.ts"` | ❌ W0 | ⬜ pending |
| NFR-9 | Fixture DBs migrate forward; interrupted migration leaves the old schema | T2 | `node --test "test/fault/migrations.test.ts"` | ❌ W0 | ⬜ pending |
| AC-1 | Clone to first `status` under 10 min, no admin | T4 | `scripts/ac1-timing.sh` (scratch `HOME`) | ✅ | ✅ green (1 s, plan 01-19) |
| Mutation (plan 01-20) | FC-1..FC-12 pinned: every fail-closed behavior in the Target Units table has a mutant that the suite kills (133 by tests that existed, 49 by tests this plan added or strengthened, 62 by the suite after Task 3; 4 equivalent with an argument; 1 non-FC survivor, B-87). Open findings MF-02, MF-03, MF-04 are todo tests | T1+T2 | `node --test "test/unit/**/*.test.ts" "test/integration/**/*.test.ts" "test/containment/executor.test.ts" "test/containment/failclosed.test.ts" "test/fault/**/*.test.ts" "test/mutation/**/*.test.ts"` | ✅ | ✅ green (980 pass, 0 fail, 3 todo on Node 22.22.3 and 26.9.0) |
| Exit 1 | Active record on the target; code and document nodes; intel and graph build commit = onboarded revision; checkout unchanged | T4 | `scripts/exit-run.sh` | ✅ | ❌ red: three rehearsals did not reach active (see 01-19-SUMMARY.md and deferred items 9 to 12); target run not started |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json`, `tsconfig.json`, `scripts/check-boundaries.ts`, `.gitignore`; dev dependencies `typescript@7.0.2` and `@types/node@22` (after a human-verify checkpoint on `@types/node`)
- [ ] `test/fixtures/`: repo with a `post-checkout` hook and `core.fsmonitor`; repo with committed `.planning/`; recorded stream-json results (success, `api_error`, `error_max_budget_usd`, hook block); stand-in `graph.json`; recorded `/graphify` skill output
- [ ] `test/helpers/`: scratch-git builder, `sandbox-exec` runner with realpath handling, fake `AgentHost`, fault-injection env reader, offline wrapper
- [ ] Live spikes S0-A to S0-G (`01-RESEARCH.md` § Wave 0 Gaps), each at most `--max-budget-usd 0.40`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Exit run on the real target repository | Exit criterion 1, 2 | Spends model budget on a real repository the owner is developing | Run `scripts/exit-run.sh` attended; confirm `status` shows the active record and the checkout byte-compares unchanged. Plan 01-19 result: not met. Rehearsal evidence `01-19-evidence-rehearsal-1.json` to `-3.json`; checkout unchanged in all three; total spend 0.1656 USD of 24 USD; target run not started |
| AC-1 install timing | AC-1 | Wall-clock on a fresh scratch `HOME` | Run `scripts/ac1-timing.sh`; record the elapsed time. Plan 01-19 result: AC-1 elapsed 1s (target 600s) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
