---
phase: "02"
slug: "contained-unattended-run-of-one-work-item"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-05"
validated: "2026-11-08"
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
| **Estimated runtime** | Quick unit suite ~12 s; full suite measured 389.5 s (~6.5 min, 2398 tests) on the dev Node at the 2026-11-07 audit, above the original ~60–120 s estimate |

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

Built from the 35 PLAN.md and SUMMARY.md files (rows 02-26..02-35 added at the 2026-11-08 audit). Threat refs are per plan. "Recorded" rows need `AVARICE_LIVE=1` (or `AVARICE_NET=1`) and skip offline; their status is the recorded evidence in `test/containment/LIVE-CASES.md` and the phase evidence files. Three test files named in the `02-RESEARCH.md` test map were never created; their behavior is covered elsewhere: `run-selfamend` by `hook-decision.test.ts` plus live CS cases, `checks-writes` by `check-validation.test.ts`, `run-handoff` by `run-workspace.test.ts`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | CON-1, CON-3 | T-02-01..02 | Spend ceiling guard; lower-only admit override | unit + live | `node --test "test/unit/live-spend-ceiling.test.ts" "test/unit/live-admission-override.test.ts"` | ✅ | ✅ green |
| 02-01-T2 | 01 | 1 | CON-1, CON-3 | T-02-01..02 | Unrecorded host version stays refused | unit/integ | `node --test "test/unit/launch-args.test.ts" "test/unit/live-admission-override.test.ts" "test/integration/claude-host.test.ts"` | ✅ | ✅ green |
| 02-02-T1 | 02 | 1 | OPS-7, FR-11 | T-02-03..04 | Phase 1 `--json` snapshot frozen | unit | `node --test "test/unit/json-shapes.test.ts" "test/unit/render.test.ts"` | ✅ | ✅ green |
| 02-02-T2 | 02 | 1 | OPS-7 | T-02-03..04 | Error style; JSON unchanged | unit/integ | `node --test "test/unit/render.test.ts" "test/unit/cli-args.test.ts" "test/integration/init.test.ts" "test/fault/killpoints.test.ts"` | ✅ | ✅ green |
| 02-03-T1 | 03 | 1 | FR-2, NFR-9 | T-02-05..07 | Migration 0002 forward-only, checksummed | unit/fault/integ | `node --test "test/unit/run-lifecycle.test.ts" "test/fault/migrations.test.ts" "test/integration/run-ledger.test.ts"` | ✅ | ✅ green |
| 02-03-T2 | 03 | 1 | FR-7, CON-13 | T-02-05..07 | Run leases, budgets persisted | integ/fault | `node --test "test/integration/run-ledger.test.ts" "test/integration/lease.test.ts" "test/fault/budgets.test.ts"` | ✅ | ✅ green |
| 02-03-T3 | 03 | 1 | AUT-8, OPS-2, NFR-5/6 | T-02-05..07 | Evidence/gates/decisions rows | integ | `node --test "test/integration/run-ledger.test.ts" "test/unit/run-lifecycle.test.ts" "test/fault/migrations.test.ts"` | ✅ | ✅ green |
| 02-04-T1 | 04 | 1 | RC-1, RC-2 | T-02-08..11 | Brief + conventions to digested contract | unit | `node --test "test/unit/run-contract.test.ts"` | ✅ | ✅ green |
| 02-04-T2 | 04 | 1 | RC-1, NFR-3 | T-02-08..11 | Brief/conventions as untrusted input | unit | `node --test "test/unit/brief.test.ts" "test/unit/conventions.test.ts" "test/unit/run-contract.test.ts"` | ✅ | ✅ green |
| 02-04-T3 | 04 | 1 | RC-5, AUT-7, FR-1 | T-02-08..11 | Lower-only budgets; G0 static refusals | unit | `node --test "test/unit/run-contract.test.ts" "test/unit/domain-contracts.test.ts"` | ✅ | ✅ green |
| 02-05-T1 | 05 | 1 | FR-5, AUT-7 | T-02-12..14 | Base/head delta to G4 | unit | `node --test "test/unit/evidence.test.ts" "test/unit/gates.test.ts"` | ✅ | ✅ green |
| 02-05-T2 | 05 | 1 | AUT-9 | T-02-12..14 | Inventory comparison, G2 | unit | `node --test "test/unit/test-inventory.test.ts" "test/unit/gates.test.ts"` | ✅ | ✅ green |
| 02-05-T3 | 05 | 1 | AUT-8, FR-6 | T-02-12..14 | Structural `paused` outcome | unit | `node --test "test/unit/outcome.test.ts" "test/unit/evidence.test.ts"` | ✅ | ✅ green |
| 02-06-T1 | 06 | 1 | CON-5, CON-2 | T-02-15..17 | Sandbox reaches one loopback port only | containment | `node --test "test/containment/executor.test.ts" "test/containment/failclosed.test.ts"` | ✅ | ✅ green |
| 02-06-T2 | 06 | 1 | NFR-1, ONB-10 | T-02-15..17 | CONNECT proxy allowlist | integ | `node --test "test/integration/allowlist-proxy.test.ts" "test/unit/footprint.test.ts"` | ✅ | ✅ green |
| 02-06-T3 | 06 | 1 | ONB-10 | T-02-15..17 | `npm ci` through the proxy (S2-C) | containment (net) | `AVARICE_NET=1 node --test "test/containment/npm-ci-proxy.test.ts"` | ✅ | ✅ green (net part skips offline) |
| 02-07-T1 | 07 | 1 | CON-9, FR-6 | T-02-18..21 | Hand-off ref only; checkout untouched | integ | `node --test "test/integration/run-workspace.test.ts" "test/unit/checkout-digest.test.ts" "test/integration/checkout-unchanged.test.ts"` | ✅ | ✅ green |
| 02-07-T2 | 07 | 1 | CON-16, CON-9 | T-02-18..21 | Discard only what the run changed | integ | `node --test "test/integration/run-workspace.test.ts"` | ✅ | ✅ green |
| 02-07-T3 | 07 | 1 | RC-2, CON-8 | T-02-18..21 | Conventions from descendant of pin; staleness | integ | `node --test "test/integration/run-source.test.ts" "test/integration/run-workspace.test.ts"` | ✅ | ✅ green |
| 02-08-T1 | 08 | 2 | CON-2, CON-8 | T-02-22..26 | Out-of-scope/protected Edit denied by the real hook | unit/integ | `node --test "test/unit/run-scope.test.ts" "test/integration/hook.test.ts" "test/unit/hook-decision.test.ts"` | ✅ | ✅ green |
| 02-08-T2 | 08 | 2 | CON-5, RC-4, RC-5 | T-02-22..26 | Argv-exact commands; `avarice`/commit denied | unit/integ | `node --test "test/unit/hook-decision.test.ts" "test/unit/run-scope.test.ts" "test/integration/hook.test.ts"` | ✅ | ✅ green |
| 02-08-T3 | 08 | 2 | CON-1, CON-3, CON-6 | T-02-22..26 | Settings/env; enforcement config unwritable | unit/integ | `node --test "test/unit/claude-settings.test.ts" "test/unit/invocation-env.test.ts" "test/integration/claude-host.test.ts" "test/unit/sec5.test.ts"` | ✅ | ✅ green |
| 02-09-T1 | 09 | 3 | FR-4, CON-2 | T-02-27..29 | Real GSD quick unit under the run hook (S2-B) | live | `AVARICE_LIVE=1 node --test "test/containment/spike-gsd-quick.test.ts"` | ✅ | ✅ green (recorded) |
| 02-09-T2 | 09 | 3 | FR-4, RC-4 | T-02-27..29 | Admitted forms pinned | unit/integ | `node --test "test/unit/hook-decision.test.ts" "test/unit/agent-frontmatter.test.ts" "test/integration/hook.test.ts"` | ✅ | ✅ green |
| 02-10-T1 | 10 | 2 | RC-2, RC-3, FR-1 | T-02-30..33 | start to contract_ready, no confirmation | integ | `node --test "test/integration/run-start.test.ts" "test/unit/json-shapes.test.ts"` | ✅ | ✅ green |
| 02-10-T2 | 10 | 2 | RC-5, AUT-7 | T-02-30..33 | Every refusal before anything is created | unit/integ | `node --test "test/unit/run-preflight.test.ts" "test/integration/run-start.test.ts" "test/integration/run-source.test.ts"` | ✅ | ✅ green |
| 02-11-T1 | 11 | 4 | CON-7 | T-02-34..37 | Edit with no read, or after a change, denied | unit/integ | `node --test "test/unit/hook-decision.test.ts" "test/integration/hook-read-digest.test.ts"` | ✅ | ✅ green |
| 02-11-T2 | 11 | 4 | CON-14, CON-13 | T-02-34..37 | Denial/search loop limits escalate | integ | `node --test "test/integration/run-loops.test.ts" "test/integration/hook.test.ts"` | ✅ | ✅ green |
| 02-12-T1 | 12 | 3 | FR-2, CON-3 | T-02-38..40 | No enforced host: enforcement_failure | integ | `node --test "test/integration/run-supervisor.test.ts" "test/integration/run-start.test.ts"` | ✅ | ✅ green |
| 02-12-T2 | 12 | 3 | CON-13 | T-02-38..40 | Run-aware budget reservation | integ/fault | `node --test "test/integration/run-invocation.test.ts" "test/fault/budgets.test.ts"` | ✅ | ✅ green |
| 02-12-T3 | 12 | 3 | FR-7, NFR-6 | T-02-38..40 | One supervisor per run; dead one reported | integ | `node --test "test/integration/run-supervisor.test.ts" "test/integration/lease.test.ts"` | ✅ | ✅ green |
| 02-13-T1 | 13 | 4 | FR-1/2/4/5/6, RC-4 | T-02-41..44 | Brief to ready_for_review, no prompts | integ | `node --test "test/integration/run-baseline-workflow.test.ts"` | ✅ | ✅ green |
| 02-13-T2 | 13 | 4 | AUT-7, CON-2 | T-02-41..44 | G2/G4 fail: blocked_on_decision | integ | `node --test "test/integration/run-baseline-workflow.test.ts"` | ✅ | ✅ green |
| 02-13-T3 | 13 | 4 | OPS-2, FR-4 | T-02-41..44 | Correlation IDs; GSD presence refusal | integ | `node --test "test/integration/run-events.test.ts" "test/integration/context.test.ts"` | ✅ | ✅ green |
| 02-14-T1 | 14 | 5 | ONB-10, AUT-8 | T-02-45..48 | Check validated; pre-existing failure recorded | integ | `node --test "test/integration/check-validation.test.ts" "test/integration/run-baseline-workflow.test.ts"` | ✅ | ✅ green |
| 02-14-T2 | 14 | 5 | ONB-10, CON-8, FR-5 | T-02-45..48 | Declared outputs; deps through the proxy | integ | `node --test "test/integration/check-validation.test.ts" "test/integration/run-deps.test.ts" "test/integration/allowlist-proxy.test.ts"` | ✅ | ✅ green |
| 02-14-T3 | 14 | 5 | AUT-9, AUT-8 | T-02-45..48 | Deleted/skipped test fails G2 | integ | `node --test "test/integration/run-gates.test.ts"` | ✅ | ✅ green |
| 02-15-T1 | 15 | 5 | FR-11 | T-02-49..52 | status offline; JSON unchanged | integ | `node --test "test/integration/run-status.test.ts" "test/integration/offline.test.ts"` | ✅ | ✅ green |
| 02-15-T2 | 15 | 5 | FR-11, OPS-7 | T-02-49..52 | Interrupted/blocked in status; inbox | integ/unit | `node --test "test/integration/run-status.test.ts" "test/unit/render.test.ts"` | ✅ | ✅ green |
| 02-15-T3 | 15 | 5 | RC-5, CON-6 | T-02-49..52 | avarice-run skill; CS-11 refusals | integ | `node --test "test/integration/install-host.test.ts"` | ✅ | ✅ green |
| 02-16-T1 | 16 | 6 | CON-16 | T-02-53..55 | Crash: discard to snapshot, retry once | fault | `node --test "test/fault/run-discard-retry.test.ts"` | ✅ | ✅ green |
| 02-16-T2 | 16 | 6 | CON-9, CON-14, CON-3 | T-02-53..55 | Checkout untouched through failure/recovery | integ | `node --test "test/integration/run-outcomes.test.ts" "test/integration/run-source-untouched.test.ts"` | ✅ | ✅ green |
| 02-17-T1 | 17 | 7 | FR-7, NFR-6 | T-02-56..58 | Kill in verification: paused, resume | integ | `node --test "test/integration/run-resume.test.ts" "test/integration/resume-reap.test.ts"` | ✅ | ✅ green |
| 02-17-T2 | 17 | 7 | CON-16, FR-7 | T-02-56..58 | Reconcile unit/commit/hand-off; reap host | integ/fault | `node --test "test/integration/run-resume.test.ts" "test/fault/run-discard-retry.test.ts"` | ✅ | ✅ green |
| 02-17-T3 | 17 | 7 | NFR-6, CON-13, FR-2 | T-02-56..58 | AC-3 every kill point; budgets across resume | fault | `node --test "test/fault/run-killpoints.test.ts" "test/fault/run-budgets.test.ts"` | ✅ | ✅ green |
| 02-18-T1 | 18 | 7 | CON-1, CON-5 | T-02-59..60 | In-sandbox commit minimal set (S2-D) | containment/unit | `node --test "test/containment/sandbox-commit.test.ts" "test/unit/containment-matrix.test.ts"` | ✅ | ✅ green |
| 02-18-T2 | 18 | 7 | CON-1, CON-6 | T-02-59..60 | Containment matrix rows match docs | unit | `node --test "test/unit/containment-matrix.test.ts"` | ✅ | ✅ green |
| 02-19-T1 | 19 | 8 | FR-27 | T-02-61..64 | Non-TTY or AVARICE_RUN exits 64 | unit | `node --test "test/unit/shell.test.ts" "test/unit/cli-args.test.ts"` | ✅ | ✅ green |
| 02-19-T2 | 19 | 8 | FR-27 | T-02-61..64 | Supervisor outlives shell | unit/integ | `node --test "test/unit/shell.test.ts" "test/integration/shell-supervisor.test.ts"` | ✅ | ✅ green |
| 02-19-T3 | 19 | 8 | FR-27, NFR-1, OPS-7 | T-02-61..64 | Real pty check; history in data root | integ | `node --test "test/integration/shell-tty.test.ts" "test/unit/footprint.test.ts"` | ✅ | ✅ green |
| 02-20-T1 | 20 | 8 | FR-4, RC-4, CON-16 | T-02-65..67 | Live e2e run with kill and resume | live | `AVARICE_LIVE=1 node --test --test-name-pattern="e2e" "test/containment/live-run.test.ts"` | ✅ | ✅ green (recorded) |
| 02-20-T2 | 20 | 8 | CON-2, CON-6, RC-5 | T-02-65..67 | CS-1..4/6/7/10/11, S-13/15 | live | `AVARICE_LIVE=1 node --test "test/containment/live-run.test.ts"` | ✅ | ✅ green (recorded) |
| 02-20-T3 | 20 | 8 | CON-3, CON-1 | T-02-65..67 | CS-12..14, S-14, S-42 fail-closed | live + unit | `node --test "test/unit/containment-matrix.test.ts"` | ✅ | ✅ green |
| 02-21-T1 | 21 | 9 | RC-2, FR-1 | T-02-68..70 | Exit drafts vs pin, dry run | unit | `node --test "test/unit/exit-drafts.test.ts"` | ✅ | ✅ green |
| 02-21-T2 | 21 | 9 | RC-3 | T-02-68..70 | Owner approval before spend | manual checkpoint | `node -e` check of `02-21-exit-authorization.json` | ✅ | ✅ green (recorded) |
| 02-21-T3 | 21 | 9 | ONB-10, CON-8 | T-02-68..70 | Conventions commit verified read-only | manual checkpoint | `node scripts/exit-run-phase2-tools.ts preflight` | ✅ | ✅ green (recorded) |
| 02-22-T1 | 22 | 10 | FR-1, RC-2..4 | T-02-71..73 | Portfolio run to ready_for_review | T4 live | `bash scripts/exit-run-phase2.sh --run` | ✅ | ✅ green (recorded) |
| 02-22-T2 | 22 | 10 | FR-5/6, AUT-7/8, CON-9 | T-02-71..73 | 3/3 clean, 0 AskUserQuestion, digests equal | evidence check | `node -e` check of `02-22-evidence-exit.json` | ✅ | ✅ green |
| 02-23-T1..T5 | 23 | 11 | (docs) | T-02-74..79 | docs/system pass; scope guard | grep/git checks | worklist, README and coverage checks in the plan | ✅ | ✅ green |
| 02-24-T1 | 24 | 12 | CON-16, FR-7 | T-02-80..82 | Stale-fence discard refused | fault | `node --test "test/fault/run-discard-stale-fence.test.ts"` | ✅ | ✅ green |
| 02-24-T2 | 24 | 12 | CON-16, FR-7 | T-02-80..82 | Resume path and lease edges | fault/integ | `node --test "test/fault/run-discard-stale-fence.test.ts" "test/integration/run-resume.test.ts" "test/fault/run-killpoints.test.ts"` | ✅ | ✅ green |
| 02-24-T3 | 24 | 12 | CON-16 | T-02-80..82 | After-checkpoint window; convergence | fault | `node --test "test/fault/run-discard-stale-fence.test.ts" "test/fault/run-discard-retry.test.ts"` | ✅ | ✅ green |
| 02-25-T1 | 25 | 13 | RC-5 | T-02-83..87 | Attended verdict functions; owner config unchanged | unit + live | `node --test "test/unit/live-attended-verdicts.test.ts" "test/containment/live-attended-skill.test.ts"` | ✅ | ✅ green |
| 02-25-T2 | 25 | 13 | RC-5 | T-02-83..87 | Stop-on-denial and routable-question verdicts | unit + live | `node --test "test/unit/live-attended-verdicts.test.ts"` | ✅ | ✅ green |
| 02-25-T3 | 25 | 13 | RC-5 | T-02-83..87 | LIVE-CASES record and spend total | grep/evidence | grep in `test/containment/LIVE-CASES.md` plus spend-total check | ✅ | ✅ green |
| 02-26-T1 | 26 | 14 | RC-5, CON-1 | T-02-88..93 | `git show HEAD:.env` and `:.env` denied deny-secret-read through the real hook; real git prints the secret | integ/unit | `node --test "test/integration/hook-git-secret-reads.test.ts" "test/unit/hook-decision.test.ts"` | ✅ | ✅ green |
| 02-26-T2 | 26 | 14 | RC-5, CON-1 | T-02-88..93 | git show operands, git log and git status option allow-lists; real-git corpus | unit/integ/mutation | `node --test "test/unit/hook-decision.test.ts" "test/integration/hook-git-secret-reads.test.ts" "test/integration/hook.test.ts" "test/mutation/fail-closed.test.ts"` | ✅ | ✅ green |
| 02-26-T3 | 26 | 14 | (docs) | T-02-88..93 | docs/system git rules, rule count, findings | grep/git checks | checks in the plan | ✅ | ✅ green |
| 02-27-T1 | 27 | 15 | CON-1, RC-5 | T-02-94..98 | Git object name judged lexically: `git show HEAD~1:.env` denied when `.env` is a live or dangling symlink, or under a symlinked parent (G-02-H2) | integ/unit | `node --test "test/integration/hook-git-secret-reads.test.ts" "test/unit/normalized-root.test.ts"` | ✅ | ✅ green |
| 02-27-T2 | 27 | 15 | CON-1, CON-14 | T-02-91, T-02-94..98 | One shared git operand walker for the object check (operand grammar and table pins), `commandWords`, corrective reasons (S-WR-02, S-IN-02/03) | unit/mutation | `node --test "test/unit/hook-decision.test.ts" "test/mutation/fail-closed.test.ts"` | ✅ | ✅ green |
| 02-27-T3 | 27 | 15 | CON-1 | T-02-94..98 | Integration-suite hygiene; docs/system git object rules | integ | `node --test "test/integration/hook.test.ts" "test/integration/hook-git-secret-reads.test.ts"` | ✅ | ✅ green |
| 02-28-T1 | 28 | 15 | OPS-7 | T-02-03, T-02-99..100 | Terminal-text stripping: an ESC sequence in a resume ID or onboard path never reaches the terminal through the real CLI (R-WR-01) | integ/unit | `node --test "test/integration/cli-terminal-text.test.ts" "test/unit/render.test.ts"` | ✅ | ✅ green |
| 02-28-T2 | 28 | 15 | OPS-7 | T-02-99..100 | Full invisible-format class (bidi, zero-width) stripped (R-IN-03) | unit/mutation | `node --test "test/unit/render.test.ts" "test/mutation/fail-closed.test.ts"` | ✅ | ✅ green |
| 02-29-T1 | 29 | 15 | RC-2, CON-2 | T-02-101..104 | A SHA-256 repository refused at the first commit read, object format named (R-WR-06) | integ | `node --test "test/integration/run-source.test.ts" "test/integration/run-start.test.ts"` | ✅ | ✅ green |
| 02-29-T2 | 29 | 15 | RC-2, CON-16 | T-02-101..104 | `oldestCommitTime` with no spread (R-WR-07); confined paths split on `/` only (R-IN-04) | integ | `node --test "test/integration/run-source.test.ts" "test/integration/run-workspace.test.ts"` | ✅ | ✅ green |
| 02-29-T3 | 29 | 15 | CON-16 | T-02-104 | Anchored run-ref pattern in the checkout digest: nested ref under the run prefix not hidden (R-IN-09) | unit/integ | `node --test "test/unit/checkout-digest.test.ts" "test/integration/run-source-untouched.test.ts"` | ✅ | ✅ green |
| 02-30-T1 | 30 | 15 | FR-7, CON-13 | T-02-105..108 | Lease lost during the unit aborts the host end to end (R-IN-06) | fault | `node --test "test/fault/run-lease-loss.test.ts"` | ✅ | ✅ green |
| 02-30-T2 | 30 | 15 | FR-7 | T-02-56..57, T-02-105..108 | Unreapable launch stops resume with an error (R-IN-05); gated commit must have the snapshot as parent (R-IN-08) | integ/fault | `node --test "test/integration/run-resume.test.ts" "test/integration/resume-reap.test.ts" "test/fault/run-discard-retry.test.ts" "test/fault/run-discard-stale-fence.test.ts"` | ✅ | ✅ green |
| 02-30-T3 | 30 | 15 | (docs) | T-02-105..108 | runs.md lease loss, unreapable launches, gated-commit parent | grep/git checks | checks in the plan | ✅ | ✅ green |
| 02-31-T1 | 31 | 15 | CON-1 | T-02-109..111 | Recorder lines land on disk with the home path as `~` (R-IN-01) | unit | `node --test "test/unit/live-harness-hygiene.test.ts"` | ✅ | ✅ green |
| 02-31-T2 | 31 | 15 | CON-1 | T-02-109..111 | `cleanupAttended` containment checks: throws and deletes nothing outside its own dirs (R-WR-09); narrowed attended allow list (R-WR-08) | unit | `node --test "test/unit/live-harness-hygiene.test.ts" "test/unit/live-attended-verdicts.test.ts"` | ✅ | ✅ green |
| 02-31-T3 | 31 | 15 | CON-1 | T-02-109..111 | Home path rewritten in the four evidence files | grep | grep for the home path in the evidence files | ✅ | ✅ green |
| 02-32-T1 | 32 | 16 | CON-13, CON-16 | T-02-112..113 | Settlement in one transaction: a cost-write failure leaves settlement and orphan conversion uncharged as a whole (R-WR-05) | fault/mutation | `node --test "test/fault/budgets.test.ts" "test/mutation/fail-closed.test.ts"` | ✅ | ✅ green |
| 02-32-T2 | 32 | 16 | CON-13 | T-02-112..113 | An invocation with no result is charged its reservation (R-WR-04) | fault/integ | `node --test "test/fault/budgets.test.ts" "test/fault/run-discard-retry.test.ts" "test/fault/run-budgets.test.ts" "test/integration/claude-host.test.ts"` | ✅ | ✅ green |
| 02-32-T3 | 32 | 16 | (docs) | T-02-112..113 | docs/system settlement and no-result charge | grep/git checks | checks in the plan | ✅ | ✅ green |
| 02-33-T1 | 33 | 17 | RC-5, CON-5, CON-1 | T-02-114..116 | Check command cannot read any credential location; npm still runs; check output stored redacted (R-WR-03) | integ | `node --test "test/integration/check-validation.test.ts"` | ✅ | ✅ green |
| 02-33-T2 | 33 | 17 | CON-1, RC-5 | T-02-114..116 | Onboarding and run scopes use the shared credential list (host sandbox and hook) | unit/integ | `node --test "test/unit/claude-settings.test.ts" "test/unit/invocation-scope.test.ts" "test/unit/run-scope.test.ts" "test/unit/hook-decision.test.ts" "test/integration/hook.test.ts" "test/integration/claude-host.test.ts"` | ✅ | ✅ green |
| 02-33-T3 | 33 | 17 | CON-1 | T-02-114..116 | Graphify and GSD tool sandboxes use the shared list | integ | `node --test "test/integration/run-sandbox-other-profiles.test.ts" "test/integration/graphify-tool.test.ts" "test/integration/gsd-adapter.test.ts"` | ✅ | ✅ green |
| 02-34-T1 | 34 | 18 | CON-5, CON-1 | T-02-117..119 | Proxy address vetting: an allowlisted host resolving to loopback is refused; connects only to vetted addresses (R-WR-02) | integ/unit | `node --test "test/integration/allowlist-proxy.test.ts" "test/unit/footprint.test.ts"` | ✅ | ✅ green |
| 02-34-T2 | 34 | 18 | RC-5, CON-5 | T-02-117..119 | Conventions refuse local-only registry hosts | unit/integ | `node --test "test/unit/conventions.test.ts" "test/integration/run-deps.test.ts"` | ✅ | ✅ green |
| 02-34-T3 | 34 | 18 | (docs) | T-02-117..119 | docs/system proxy address check and registry host rules | grep/git checks | checks in the plan | ✅ | ✅ green |
| 02-35-T1..T3 | 35 | 19 | (docs) | T-02-120..121 | Round's docs/system pass, dispositions, fresh reviews | grep/git checks | worklist, README and coverage checks in the plan | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `test/helpers/fake-agent-host.ts` — run-mode options (in-scope writes, SUMMARY, pause question, `killAfterFiles`, crash, timeout, commit attempt, outcome kinds) through the real hook entry
- [x] `test/helpers/run-fixtures.ts` — scratch repo with `package.json` scripts, `.planning/ROADMAP.md`, `.avarice/config.json`, a base-failing check
- [x] `test/helpers/fault-run.ts` — `RUN_KILL_POINTS` catalog and run-aware resume helper
- [x] Snapshots of Phase 1 `--json` output (before any renderer change) — `test/fixtures/json-shapes/`
- [x] `test/fixtures/db/schema-v1.sqlite` migrate-to-v2 expectations — `test/fault/migrations.test.ts`
- [x] Live spikes (counted in the 25 USD): S2-A admission (`live-run-phase2-admission.jsonl`, LIVE-CASES); S2-B (LIVE-CASES "Spike S2-B"); S2-C (`test/containment/npm-ci-proxy.test.ts`, net part gated on `AVARICE_NET=1`); S2-D (`test/containment/sandbox-commit.test.ts`, green offline)
- [x] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Three R1 portfolio tasks reach `ready_for_review` | FR-1, RC-2..4, AUT-7/8, CON-9 (SC1, S-12, S-41) | T4 exit run on a real repository, costs money, owner checkpoint | `scripts/exit-run-phase2.sh` after owner approval. Evidence: `02-22-evidence-exit.json` (3/3 `ready_for_review`, clean, 0 AskUserQuestion, digests equal) |
| Live T3 run-purpose containment cases (CS-1..4, 6, 7, 10..14, S-13..15, S-42, reap) | CON-2/3/5/6/16, RC-5 | Real host, spends budget | `AVARICE_LIVE=1 node --test "test/containment/live-run.test.ts"`. Evidence: LIVE-CASES "Run purpose (plan 02-20)", 19/19 PASS; UAT 11, 12, 15 |
| Host admission on the installed claude version | CON-1, CON-3 | Real host, spends budget | `AVARICE_LIVE=1 node --test "test/containment/live-onboarding.test.ts"`. Evidence: `live-run-phase2-admission.jsonl`, UAT 18 |
| GSD quick unit under the run hook (S2-B) | FR-4 | Real host and model | `AVARICE_LIVE=1 node --test "test/containment/spike-gsd-quick.test.ts"`. Evidence: LIVE-CASES "Spike S2-B", UAT 4 |
| avarice-run skill effect in attended sessions | RC-5 (UAT G-02-9) | Real model behavior, spends budget | `AVARICE_LIVE=1 node --test "test/containment/live-attended-skill.test.ts"`. Evidence: LIVE-CASES "Attended sessions". Recorded verdicts are mixed: status-first FAIL (1/4), stop-on-denial PASS (3/3, two sessions never loaded the skill), routable question FAIL (0/3). Measurement exists; the behavioral result is for the owner/verifier to accept or defer |
| Interactive shell in a real terminal | FR-27, SC6 | Needs a person at a real TTY | Run `avarice` with no args, start/watch/resume, close shell, confirm supervisor alive. Evidence: `02-UAT.md` test 14 pass; pty covered by `test/integration/shell-tty.test.ts` |
| Owner approval and conventions commit before spend | RC-3, ONB-10 | Owner decision | Evidence: `02-21-exit-authorization.json`, UAT 16 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (no MISSING references)
- [x] No watch-mode flags
- [x] Feedback latency < 120s — per-task quick command (unit ~12 s + boundaries + tsc); the full suite is ~6.5 min and runs per wave, not per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-07. Offline suite: 2398 tests, 2343 pass, 0 fail, 55 skipped (live-gated); `tsc` and `check-boundaries` clean. Node 22.22.3 matrix not re-run at this audit.

**Re-validated 2026-11-08** after the gap-closure round 02-26..02-35. Every behavior of the round maps to an existing automated test: git object-name lexical check, shared operand walker and `commandWords` (02-26/27); terminal-text stripping and the invisible-format class (02-28); SHA-256 refusal, `oldestCommitTime`, slash-only split, anchored run-ref (02-29); lease-loss abort, unreapable-launch resume error, gated-commit parent (02-30); home redaction, `cleanupAttended` containment, narrowed allow list (02-31); one-transaction settlement, no-result charge (02-32); shared credential list, redacted check output (02-33); proxy address vetting, local-only registry hosts refused (02-34). No new tests were needed. Full offline suite at HEAD: 2629 tests, 2574 pass, 0 fail, 55 skipped (live-gated); the round's test files were re-run green at this audit. Wider home-path residue in `.planning` and spike evidence stays deferred to the owner per the 02-31 SUMMARY (not a test gap).

## Validation Audit 2026-11-07

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
