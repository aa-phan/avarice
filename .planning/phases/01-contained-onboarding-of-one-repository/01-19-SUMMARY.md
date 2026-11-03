---
phase: 01-contained-onboarding-of-one-repository
plan: 19
subsystem: exit-run
tags: [exit-run, kill-resume, checkout-digest, live-run, blocker]
requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: onboarding stages, hook, contained host, intel and knowledge steps (01-07, 01-16, 01-17, 01-18, 01-20)
provides:
  - scripts/exit-run.sh with a spend-free dry run, rehearsal, target run, kill -9 during the map invocation and resume
  - scripts/checkout-digest.ts, scripts/assert-exit.ts, scripts/exit-run-tools.ts
  - three live rehearsal runs with evidence (none reached active), the AC-1 measurement (1 s), and three product findings that block SC1 and SC4 on the target
affects: [phase 1 verification, deferred-items.md 9 to 12]
status: blocked
actuals:
  tokens: 19000
  tasks: 2
  commits: 5
plan_head_before: c35f3dcf6904b96986e68a17cbabf0f72ecb541e
plan_head_after: 2c5d1e61419242b6ffd7df66f123e5ffacd9806f
tech-stack:
  added: []
  patterns: [evidence JSON assembled from a run directory, read-only ledger tooling for live runs]
key-files:
  created: [scripts/checkout-digest.ts, scripts/assert-exit.ts, scripts/exit-run-tools.ts, scripts/exit-run.sh, test/unit/checkout-digest.test.ts, 01-19-evidence-rehearsal-1.json, 01-19-evidence-rehearsal-2.json, 01-19-evidence-rehearsal-3.json]
  modified: [src/app/stages/workspace.ts, test/integration/gsd-configure.test.ts]
key-decisions:
  - "Plan 01-19 stops after the third rehearsal: the target run was not started because the full map cannot pass validation on this repository (stamp and path-references) and the retry does not fit the subagent budget; each needs an owner decision"
  - "The only code change is the existing-map answer (plainly a bug); no validation limit, budget or policy was changed"
---

# Phase 1 Plan 19: Exit run Summary

**Exit-run tooling is done and proven; the live rehearsal found and fixed one bug, then stopped at three owner decisions (full-map stamp, path-references on the real map, subagent budget for a retry). No onboarding reached `active`; the target run and the real-repository SC1 and SC4 evidence are blocked, not met.**

## Task 1: tooling (done, TDD)

RED `4a7b7fa` (22 of 26 tests failing on assertions, evidence `01-19-red-evidence-task1.json` verified), GREEN `ef2c983`. `node --test test/unit/checkout-digest.test.ts`: 26 pass. `exit-run.sh --dry-run --target ~/aa-phan-portfolio-v2` and `--dry-run --rehearsal` print "dry run ok" and create nothing (no ledger, no profile directory; the test asserts it). The dry run checks Node, an admitted claude, gsd-core 1.17.x, graphify, roots, the ledger, the target's `git status` (only `?? .env`) and the staging strategy (`clone`). Extra file beyond the plan list: `scripts/exit-run-tools.ts` (read-only ledger facts, claude pick, evidence assembly).

Machine note: the default `claude` on PATH is now 2.1.317, which `ADMITTED_CLAUDE_VERSIONS` does not list (2.1.312, 2.1.316). The script picks the admitted 2.1.316 binary under `~/.local/share/claude/versions` and never widens the list. A plain `avarice onboard` with PATH claude 2.1.317 will be refused.

## Task 2: decision (resolved by the human through the orchestrator)

Selection `rehearsal-then-target`, total cap 24 USD (two onboardings at the contract's 12 USD per-run cap), decided by the user on 2026-11-03. The user confirmed they will not commit to `~/aa-phan-portfolio-v2` while the run is in progress. Recorded in each evidence JSON under `authorization`.

## Task 3: live runs (blocked)

| Run | Evidence | Outcome | Cost (ledger) |
|---|---|---|---|
| Rehearsal 1 | `01-19-evidence-rehearsal-1.json` | `blocked (decision)`: map ended `denied` at 20 s | 0.0084 USD |
| Rehearsal 2 | `01-19-evidence-rehearsal-2.json` | same, reproduced | 0.0086 USD |
| (fix `8cc18b6`) | | | |
| Rehearsal 3 | `01-19-evidence-rehearsal-3.json` | kill and resume worked; `blocked (budget_exhausted)` after a rejected validation | 0.1486 USD |
| Target | not run | | 0 |

**Spend: 0.1656 USD of the 24 USD cap** (per run well under the 12 USD per-run cap). Nothing was spent before the authorization.

### Bug fixed (named, narrow): existing-map question

Rehearsals 1 and 2: AVARICE creates an empty `.planning/codebase` before the mapper starts (`prepareInvocation`, `ensureDir`). GSD's map workflow reads an existing directory as an existing map (`codebase_dir_exists`) and asks Refresh, Update or Skip; the headless haiku mapper asked and ended without a file, classified `denied`, blocked, never retried. The prompt carried the contract answer only when the repository held a map. Proven without a model first (a fake claude saw the empty directory at launch). Fix: pass the contract's existing-map answer always (`src/app/stages/workspace.ts`), tests `0a8f61c` (RED, evidence `01-19-red-evidence-task3-fix.json`) and `8cc18b6` (GREEN). Live result: the mapper then ran four subagents and wrote all seven documents. Full suite on Node 22.22.3: 1036 pass, 0 fail, 21 skipped (one earlier run had 7 failures from `/sbin/mount ETIMEDOUT` and hung children while the machine was loaded; re-run at concurrency 2 was green); `tsc` and `check-boundaries` green.

### Blockers found by rehearsal 3 (not fixed, owner decisions)

1. **A full map is never stamped, so `stamp` validation fails.** The mapper's closing `stamp-codebase-map` call is denied by the hook (known from S0-F), AVARICE stamps only fast maps (`gsd:stamp`), and `stamp` requires `last_mapped_commit` equal to the staging HEAD: all seven files "no stamp". Options: AVARICE stamps a full map as it does a fast one, or the hook admits that one GSD verb.
2. **`path-references` on the real full map: 32 of 306 named paths dangling (10.5%, limit 5%)**: `archivo/wdth.css`, `dist/resume.pdf`, `dist`, `dist/index.html`, `.env` and 27 more. Mostly gitignored build output (`dist`) and untracked names. Same class as deferred item 1; limit not changed.
3. **The retry cannot fit the subagent budget.** `subagentsTotal` is 7; a full map uses 4 (the first host used 4, the retry got 3 and the 4th and 5th Agent calls were denied `budget_exhausted`), so after one rejected validation the second map ends `budget_exhausted` (blocked). Related to deferred item 6.

The target run was not started: it would hit the same two validation failures on the real repository and leave a blocked onboarding in the default profile, which is the phase deliverable.

### Kill and resume (SC4) evidence, rehearsal 3

`kill -9` of the AVARICE process 63 s after `launch:map` started (state `mapping`, exit 137). `status --json` showed `interrupted` (state `mapping`, next `launch:map`, resume command `avarice resume onb_01M6HKCFD338P8CPPCCZZWW0S4`) 177 s after the kill (the 180 s lease). `resume` returned the same onboarding ID and pin (`1e2a239f...`) and reconciled the interrupted invocation; it ran 179 s and ended blocked as above, not active. So SC4 is shown up to resume and reconcile, not to `active`. One host process (`--session-id c393d109-...`) survived the kill and finished the map by itself during the wait; resume's reap found none (0), and no process carrying the session or the onboarding directory remained after the resume. Note: the surviving host kept charging the subagent budget after AVARICE died.

### Checks that held

- Rehearsal clone digests (head, branch, status, files, refs, worktrees) identical before and after in all three runs; the source repository `~/aa-phan-portfolio-v2` identical too (no push or commit, clone strategy writes nothing).
- Stored contract and generated settings and hook-policy digests unchanged between map start and end (rehearsal 3).
- The injected ADR (S-46 live): the knowledge pass was never reached, so `avarice context` could not print the injected node; S-46 live is **not shown** (T2 tests only).
- Target checkout before any run and now: HEAD `9f1cd8d`, branch `gsd/phase-02-deployed-themed-skeleton`, status `?? .env`, 363 tracked files, digests identical (`statusDigest 63ae0454...`, `filesDigest 833ee38a...`, `refsDigest f1b676af...`). The target run's before and after comparison is therefore not recorded; only the pre-run and post-rehearsal reads match.
- AC-1: `scripts/ac1-timing.sh`: **AC-1 elapsed 1s (target 600s)**, no admin rights.

### Newly enforced rules, live (rehearsal 3, two map invocations)

- Unquoted glob or brace in a read command: 6 of the 37 denied Bash calls carried glob characters (`ls .github/*`, `--include=*.ts`, `find ... | sort`), all denied by `shell-syntax`; the mapper recovered with Read and quoted commands. Works as designed.
- `subagentsConcurrent`: never denied (at most 4 in flight, limit 4). Not exercised to the limit. The `subagentsTotal` limit did fire (2 `budget_exhausted` denies).
- 2 KiB document-node cap counting nested text: not exercised (knowledge pass not reached).
- Hook decisions: 291 (allow read-set 166, shell-identity 38, subagent-type 7, write-set 18; deny shell-syntax 44, shell-not-allowed 16, budget_exhausted 2).

### Default profile

`~/.local/share/avarice/personal-local/state.db` is still mode 0644 (created before the 0600 fix); AVARICE does not tighten an existing store (`openDb` sets 0600 only on creation, and `init` warns about directories only). It was not touched by any run (the rehearsals used temp roots; only read-only opens). `~/.config/avarice` is empty. Suggest `chmod 600` by the owner or a tightening step in `init`.

## Deviations from Plan

- [Rule 1 - Bug] existing-map answer (above), commits `0a8f61c`, `8cc18b6`.
- [Rule 1 - Bug] `exit-run.sh` waited 420 s for an interruption on an onboarding already blocked; fixed in `2c5d1e6`.
- [Rule 3] extra file `scripts/exit-run-tools.ts`; claude pick of an admitted version (see Task 1 note).
- Task 3 is not complete: no `active` record, no target run, `scripts/assert-exit.ts` not run green. 01-VALIDATION.md "Exit 1" stays not green; AC-1 updated.

## Known Stubs

None.

## Threat Flags

None new. T-01-56 to T-01-59: checkout unchanged, `.env` never printed (digest hashes bytes), cap not approached, injected ADR never reached the model's context via the knowledge pass.

## Self-Check: PASSED

Commits `4a7b7fa`, `ef2c983`, `0a8f61c`, `8cc18b6`, `2c5d1e6` exist; scripts, tests and the three evidence files exist.
