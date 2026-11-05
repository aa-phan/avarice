---
phase: "1"
slug: "contained-onboarding-of-one-repository"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: true) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
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
| ONB-1 | Every transition committed before its effect; illegal transition rejected | T1+T2 | `node --test "test/unit/transitions.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-1 / NFR-6 | SIGKILL at each kill point; `resume` reaches the same active record | T2 | `node --test "test/fault/killpoints.test.ts"` | ✅ | ⚠️ flaky (validate-phase 2026-11-04: 20/20 alone, 12/12 kill-point cases failed once inside the full T1+T2 run at ~630% CPU on the normalized-record deepEqual, green on the full-suite rerun; 2026-11-05 full T1+T2 run green, 1328 pass 0 fail) |
| ONB-2 | Ledger and data root hold refs and digests only (S-27) | T2 | `node --test "test/integration/no-competing-index.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-3 | Executor cannot write source via `sed -i`, `python3 -c`, `node -e`, repo script, symlink | T2 | `node --test "test/containment/executor.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-3 | Edit/Write/Bash/Python source edits and policy-file edit blocked in a live mapping invocation (S-30) | T3 | `AVARICE_LIVE=1 node --test "test/containment/live-*.test.ts"` | ✅ | ✅ green (T3 live suite, 21 cases on claude 2.1.317 in plan 01-16; live case 19 in plan 01-19) |
| ONB-4 | No repo hook, fsmonitor, install, test or script runs during staging | T2 | `node --test "test/integration/no-repo-exec.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-5 | No commit on the staging branch or in the checkout; refs digest unchanged (S-32) | T2/T3 | `node --test "test/integration/no-repo-exec.test.ts"` (rev-parse and for-each-ref before/after) | ✅ | ✅ green (plan 01-19) |
| ONB-7 | Completeness `complete` for full, `partial` with scope for fast (S-33) | T2 | `node --test "test/integration/completeness.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-8 / CON-13 | Budgets persist across kill and resume; over-budget subagent and tool call denied (S-35) | T2 | `node --test "test/fault/budgets.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-9 | Record versions immutable; proposed paths only narrow; activation validated | T1 | `node --test "test/unit/record.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-12 / CON-3 | Missing settings, hook removed, sandbox unavailable, GSD out of range → `blocked`/`incompatible`, no launch (S-36) | T2 (+T3 hook removed) | `node --test "test/containment/failclosed.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-13 | Graph and intel recorded with build commit equal to staging HEAD; failed index leaves record without it (S-39, S-40) | T2 | `node --test "test/integration/index-stage.test.ts"` | ✅ | ✅ green (plan 01-19) |
| ONB-14 | Document nodes cite path and revision; edges INFERRED/AMBIGUOUS; no phase files in corpus; injected instruction stays data (S-45, S-46) | T2 + T3 | `node --test "test/integration/knowledge-pass.test.ts"` | ✅ | ✅ green (plan 01-19) |
| FR-20 | `avarice context <term>` returns graph and intel hits; EXTRACTED survives trimming longest | T2 | `node --test "test/integration/context.test.ts"` | ✅ | ✅ green (plan 01-19) |
| SEC-5 | No TLS-disabling construct in source or argv; env allowlist drops proxy/TLS vars | T1 | `node --test "test/unit/sec5.test.ts"` | ✅ | ✅ green (plan 01-19) |
| NFR-2 | `status`, `resume` planning and validation run offline | T2 | `node --test "test/integration/offline.test.ts"` | ✅ | ✅ green (plan 01-19) |
| NFR-3 | Boundary script rejects negative fixtures, passes `src/` | T1 | `node scripts/check-boundaries.ts && node --test "test/unit/boundaries.test.ts"` | ✅ | ✅ green (plan 01-19) |
| NFR-5 | `init` refuses a data root on a non-local mount | T1 | `node --test "test/unit/localfs.test.ts"` | ✅ | ✅ green (plan 01-19) |
| NFR-9 | Fixture DBs migrate forward; interrupted migration leaves the old schema | T2 | `node --test "test/fault/migrations.test.ts"` | ✅ | ✅ green (plan 01-19) |
| AC-1 | Clone to first `status` under 10 min, no admin | T4 | `scripts/ac1-timing.sh` (scratch `HOME`) | ✅ | ✅ green (1 s, plan 01-19) |
| Mutation (plan 01-20) | FC-1..FC-12 pinned: every fail-closed behavior in the Target Units table has a mutant that the suite kills (133 by tests that existed, 49 by tests this plan added or strengthened, 62 by the suite after Task 3; 4 equivalent with an argument; 1 non-FC survivor, B-87). Open findings MF-02, MF-03, MF-04 are todo tests | T1+T2 | `node --test "test/unit/**/*.test.ts" "test/integration/**/*.test.ts" "test/containment/executor.test.ts" "test/containment/failclosed.test.ts" "test/fault/**/*.test.ts" "test/mutation/**/*.test.ts"` | ✅ | ✅ green (980 pass, 0 fail, 3 todo on Node 22.22.3 and 26.9.0); validate-phase 2026-11-04 on Node 26.9.0: 1146 tests, 1146 pass on the rerun (first run 12 fail, all in killpoints, see ONB-1 / NFR-6 row) |
| ONB-1 (plan 01-21) | Resume reaps every started `launch:*` row (map, intel, knowledge) by exact session ID before reconciliation or any stage; a failed reap stops the resume before any row is marked; a decoy with another session ID survives | T2 | `node --test "test/fault/killpoints.test.ts" "test/integration/resume-reap.test.ts" "test/integration/claude-host.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-04, Node 26.9.0) |
| ONB-3 (plan 01-22) | Staging diff lists every ignored untracked file one per record under a hostile `.gitignore` of `*`; validation and activation block an ignored out-of-set write; preflight facts exclude ignored checkout files | T1+T2 | `node --test "test/integration/staging-adapters.test.ts" "test/integration/ignored-writes.test.ts" "test/unit/repo-facts.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-04, Node 26.9.0) |
| CON-1 / ONB-3 (plan 01-23) | Hook read allow-list: Shell, Read, Grep and Glob confined to staging, `readRoots` and `allowRead` (`outside-read-set`); option values, words after `--` and recursive greps judged; every VERIFICATION.md P-3 case denied with its rule | T1+T2 | `node --test "test/unit/hook-decision.test.ts" "test/integration/hook.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-04, Node 26.9.0) |
| CON-1 / ONB-3 (plan 01-24) | Work root appended to sandbox and hook `denyRead`, own staging re-allowed via `allowRead`; no `Read(...)` deny names a root containing staging; production-path policy denies every P-3 case; `docs/containment.md` CON-1 row present | T1+T2 | `node --test "test/integration/claude-host.test.ts" "test/unit/invocation-scope.test.ts" "test/unit/claude-settings.test.ts"` and `grep -c shell-recursive-read docs/containment.md` | ✅ | ✅ green (validate-phase 2026-11-04, Node 26.9.0; docs grep 1) |
| ONB-14 / ONB-13 (plan 01-25) | Knowledge pass accounts per document on the merged graph (below half is validation-failed, otherwise dropped/unread recorded per document); merge keeps code and document nodes | T1+T2 | `node --test "test/unit/knowledge-extraction.test.ts" "test/unit/knowledge-corpus.test.ts" "test/unit/graph-merge.test.ts" "test/integration/knowledge-pass.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-05, Node 26.9.0, full T1+T2 run) |
| ONB-14 (plan 01-26) | `assert-exit` fails a live record whose knowledge section leaves corpus documents unread or lacks per-document accounting | T1+T2 | `node --test "test/unit/checkout-digest.test.ts" "test/integration/claude-host.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-05, Node 26.9.0, full T1+T2 run) |
| CON-1 / ONB-3 / ONB-8 (quick 261105-2i2) | WR-05 null-prototype flag maps; WR-06 every `gsd_run` word after the verb checked against read and write sets; WR-07 sandbox probe retries a timeout once and caches only a clean exit; WR-08 exit-run refuses a non-finite or negative spend, expected cost or cap | T1 | `node --test "test/unit/cli-args.test.ts" "test/unit/hook-decision.test.ts" "test/mutation/fail-closed.test.ts" "test/unit/checkout-digest.test.ts"` | ✅ | ✅ green (validate-phase 2026-11-05, Node 26.9.0, full T1+T2 run) |
| Exit 1 | Active record on the target; code and document nodes; intel and graph build commit = onboarded revision; checkout unchanged | T4 | `scripts/exit-run.sh` | ✅ | ✅ green: target run `onb_01M6J4ATTTXW68YGE2P9V2QMH5` active, 1010 code and 24 document nodes, graph and intel at 9f1cd8d, checkout digests identical (plan 01-19; evidence `01-19-evidence-target.json`) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `package.json`, `tsconfig.json`, `scripts/check-boundaries.ts`, `.gitignore`; dev dependencies `typescript@7.0.2` and `@types/node@22` (after a human-verify checkpoint on `@types/node`)
- [x] `test/fixtures/`: repo with a `post-checkout` hook and `core.fsmonitor`; repo with committed `.planning/`; recorded stream-json results (success, `api_error`, `error_max_budget_usd`, hook block); stand-in `graph.json`; recorded `/graphify` skill output
- [x] `test/helpers/`: scratch-git builder, `sandbox-exec` runner with realpath handling, fake `AgentHost`, fault-injection env reader, offline wrapper
- [x] Live spikes S0-A to S0-G (`01-RESEARCH.md` § Wave 0 Gaps), each at most `--max-budget-usd 0.40`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Exit run on the real target repository | Exit criterion 1, 2 | Spends model budget on a real repository the owner is developing | Run `scripts/exit-run.sh` attended; confirm `status` shows the active record and the checkout byte-compares unchanged. Plan 01-19 result: met. Target evidence `01-19-evidence-target.json` (`~/.local/share/avarice/personal-local/exit-run/target-20261104T015614Z.json`), rehearsal evidence `01-19-evidence-rehearsal-6.json` (1 to 6 kept); kill -9 63 s into the map, interrupted seen after 177 s, resumed to active in 257 s, same ID and pin; reported cost 0.217 USD (charged 3.217 USD with the killed invocation at its full reservation) for the target, 0.493 USD (charged 3.493) for rehearsal 6 |
| Mapper still writes its documents when shell `grep -r` is denied and it falls back to the host Grep tool | CON-1 / ONB-3 (plan 01-23 D5) | Needs a live Claude Code mapping invocation (model budget) | Run a T3 live mapping case (`AVARICE_LIVE=1`) or the exit run; confirm `.planning/codebase/` documents are written and the hook log shows `shell-recursive-read` denials followed by Grep tool calls |
| Live sandbox honours `allowRead` of the own staging beneath the denied work root | CON-1 (plan 01-24 D5) | Seatbelt behaviour on the real host is only observable in a live invocation | Run a T3 live mapping case; confirm mapping reads inside staging succeed and a read of a sibling staging under the work root is denied |
| AC-1 install timing | AC-1 | Wall-clock on a fresh scratch `HOME` | Run `scripts/ac1-timing.sh`; record the elapsed time. Plan 01-19 result: AC-1 elapsed 1s (target 600s) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-04 (validate-phase audit; one load-sensitive flake recorded on the kill-point suite; re-audited after gap-closure plans 01-21..01-24, all automated rows green, two live-host behaviors manual-only; re-audited 2026-11-05 after plans 01-25, 01-26 and quick 261105-2i2, rows added, no gaps)

## Validation Audit 2026-11-04

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Flaky | 1 |

## Validation Audit 2026-11-04

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Rows added | 4 |
| Manual-only added | 2 |

## Validation Audit 2026-11-05

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Rows added | 3 |
