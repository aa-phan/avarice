---
phase: 01-contained-onboarding-of-one-repository
verified: 2026-11-04T08:00:00Z
status: gaps_found
score: 5/8 must-haves verified
covered_files:
  - .planning/phases/01-contained-onboarding-of-one-repository/01-01-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-01-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-02-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-02-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-03-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-03-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-04-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-04-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-05-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-05-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-06-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-06-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-07-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-07-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-08-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-08-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-09-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-09-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-10-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-10-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-11-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-11-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-12-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-12-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-13-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-13-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-14-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-14-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-15-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-15-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-16-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-16-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-17-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-17-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-18-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-18-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-19-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-19-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-20-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-20-SUMMARY.md
  - src/adapters/git/staging-base.ts
  - src/app/resume.ts
  - src/app/stages/index-stage.ts
  - src/app/stages/index-steps.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - test/fault/killpoints.test.ts
covered_digest: "v3:sha256:3178f7259680db8f6f9815b632a116c58b6e9bf5ecd3d90567f38c9f7a39a3a0"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "On resume of an onboarding interrupted mid-invocation, any process still carrying that invocation's --session-id is terminated before reconciliation (plan 01-15 truth; T-01-44 'relaunching beside a survivor is not an option')"
    status: partial
    reason: "Only the map invocation is reaped. reconcileInvocation handles only step launch:map and returns early unless state is mapping or paused; intel and knowledge invocations run in planning_ready, so a host started by index:intel or index:knowledge and orphaned by a supervisor SIGKILL is never reaped, and the resumed indexStage launches a second host beside it. launch:intel and launch:knowledge stay 'started' forever. The kill-point suite never kills inside an intel or knowledge invocation (the fake host answers unsupported for both)."
    artifacts:
      - path: "src/app/resume.ts"
        issue: "const LAUNCH = 'launch:map' (line 17); reapInterrupted is called only from reconcileInvocation, which returns at `if (row.state !== 'paused')` (line ~49)"
      - path: "src/app/stages/index-intel.ts"
        issue: "prepareInvocation records launch:intel as started; nothing on resume consumes it"
      - path: "src/app/stages/index-knowledge.ts"
        issue: "same for launch:knowledge"
    missing:
      - "Generalize the resume prelude to every launch:* step still 'started' (reap by session ID, then mark interrupted)"
      - "A fake-host kill case inside the intel invocation (and the knowledge invocation) in test/fault/killpoints.test.ts"
  - truth: "Before activation AVARICE re-checks the whole staging diff against every agent and AVARICE write set, so a write outside them by any invocation or index step fails activation (plan 01-14 truth; ONB-3 detection backstop for entries 'created later at unlisted locations')"
    status: partial
    reason: "StagingBase.changes() combines `git diff --name-status <pin>` with `git status --porcelain=v2 --untracked-files=all` and never passes --ignored. Reproduced in /tmp: a repo whose committed .gitignore is `*` plus a new untracked evil.txt gives an empty status and an empty diff, and `! evil.txt` only with --ignored=matching. The repository (hostile input) controls its own .gitignore, so the scope-of-writes validation check, the extraMapFiles `added` list and the activation scopeCheck cannot see any untracked ignored path. Modified and deleted tracked files are still detected, and the primary controls (hook, per-entry sandbox denyWrite) still prevent writes to existing entries, so this is a detection-layer hole, not a demonstrated write."
    artifacts:
      - path: "src/adapters/git/staging-base.ts"
        issue: "line ~109-129: status call lacks --ignored=matching"
      - path: "src/adapters/git/repo-facts.ts"
        issue: "parseStatus ignores '!' records"
    missing:
      - "Add --ignored=matching to the status call and treat '!' records as untracked in parseStatus, keeping AVARICE_WRITE_SET outputs admitted"
      - "A hostile-repo test (.gitignore `*`, out-of-set write) for validate and activate"
  - truth: "Shell read confinement matches docs/containment.md (denyRead includes '//<other profile roots>'; secret reads denied)"
    status: partial
    reason: "Reproduced by running the real decideToolCall: `cat <sibling staging>/secret.txt`, `cat ~/.netrc`, `grep -r token <home>`, `grep -r PASSWORD .` (recursion reaches **/.env and **/*.pem in staging) and `grep -f/home/u/.ssh/id_rsa README.md` are all ALLOWED (rule shell-identity); only the case a test would think of (`cat ~/.ssh/id_rsa`) and a literal staging `.env` are denied. denyRead in computeInvocationScope is the fixed list [repo, dataRoot, ~/.ssh, ~/.aws, ~/.config/gh]; workRoot (sibling onboardings) is not added although the doc lists it. Live case 09 only exercised the listed targets. Not a letter violation of ONB-3 (writes) but contradicts the documented containment spec and lets a prompt-injected mapper put other credential stores into the transcript."
    artifacts:
      - path: "src/domain/hook-decision.ts"
        issue: "readRule/checkSegment: non-recursive deny list; attached option values (-fPATH, --file=PATH) never checked; recursion flags unchecked"
      - path: "src/domain/invocation-scope.ts"
        issue: "line ~234: denyRead omits workRoot and other credential stores"
    missing:
      - "Allow-list shell reads (staging, policy readRoots, gsd-core dirs); reject recursive reads that can escape; check attached option values"
      - "Add workRoot to hook and sandbox denyRead per docs/containment.md:78, or amend the doc to state the limit"
      - "Add the reproduced cases to test/unit/hook-decision.test.ts"
deferred: []
behavior_unverified_items: []
coincidental_reliance_items:
  - truth: "Killing mapping part-way and running `avarice resume` reaches the same active record (ROADMAP SC4)"
    reason: undeclared-precondition
    harden: "test/fault/killpoints.test.ts needs real graphify and real GSD installed and never skips without them (WR-03d); assert the reference record has indexes.graph, empty findings and absent == [intel, knowledge] so a degraded reference cannot pass vacuously, and drop the blanket catch in snapshotWithoutTimestamp"
---

# Phase 1: Contained onboarding of one repository Verification Report

**Phase Goal:** As a solo developer, I want to onboard one existing repository into AVARICE, so that later unattended runs start from an active project record with a code-and-document graph.
**Verified:** 2026-11-04T08:00:00Z
**Status:** gaps_found
**Re-verification:** No, initial verification
**Mode:** mvp (goal passes the user-story format; the [outcome] clause, "an active project record with a code-and-document graph", is observably true)

## Verdict in one paragraph

The deliverable the goal names exists and works: a real repository (`~/aa-phan-portfolio-v2`) sits behind an `active` project record with 1010 code nodes and 24 document nodes, and graph and intel both record the onboarded revision. All five ROADMAP success criteria are VERIFIED by evidence I re-checked, not by SUMMARY claims. The status is nevertheless `gaps_found`, because three open critical review findings (CR-01, CR-02, CR-03) are each reproduced against the real code, and each contradicts a stated plan truth or the written containment spec on the very layer this phase is meant to build in from the first slice. None of the three invalidates a ROADMAP success criterion as worded, and each is a narrow fix. The caller can plan a gap-closure round or accept the three explicitly with an owner decision.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `~/aa-phan-portfolio-v2` reaches an active project record (promotion `none`) whose graph lists code and document nodes, graph and intel each record a build commit equal to the onboarded revision, and the checkout is unchanged | VERIFIED | Ran `node bin/avarice.ts status --json` against the real profile: project `proj_01M6J4ATTQV9SQX67ATV0SB9EW`, onboarding `onb_01M6J4ATTTXW68YGE2P9V2QMH5` state `active`, record v1, onboardedRevision `git:9f1cd8d5...`, `indexes.graph.builtAtCommit` and `indexes.intel.refreshedAtCommit` both `git:9f1cd8d5...`, nodes code 1010 / document 24 / concept 114 / rationale 25, mapping full (complete, fresh). `01-19-evidence-target.json` records `promotion: none`. Target HEAD is still `9f1cd8d` and its only status entry is the untracked `.env`. Independent check beyond the shipped digest (which uses `--exclude-standard` and so cannot see ignored files): `find` over the whole target tree including ignored files and `.git` found nothing newer than the run start (19:56:14 CST 2026-11-03) apart from `.git` itself, whose mtime my own `git status` touched. |
| SC2 | During mapping a scripted source edit through Edit, Bash and Python is blocked, and so is a scripted edit of the policy file | VERIFIED | Live T3 log `test/containment/live-run-2026-11-03-claude-2.1.317.jsonl` (22 records) and `LIVE-CASES.md`: cases 01 (Edit), 02 (Write), 03 (shell redirect), 04 (python3), 05 (node), 06a (stand-in policy.json by Edit, sh and python) all PASS with source and policy digests unchanged; 06b and 17 prove the sandbox layer alone with the hook removed (`Operation not permitted`). I did not re-run the live cases (they spend model budget). T2 `test/containment/executor.test.ts` passed in my run. Primary prevention rests on the hook plus a per-entry sandbox denyWrite, which CR-03 does not weaken. |
| SC3 | With the hook removed, the generated settings missing or the sandbox unavailable, onboarding stays `blocked` and never runs unrestricted | VERIFIED | `test/containment/failclosed.test.ts` passed in my run. Live 12a/12b/12c refuse with `enforcement_failure:hook-script-unreadable`, `settings-missing` and `sandbox-unavailable`, host never started, cost 0; live 11 shows every tool call blocked by the host when the hook script is missing. |
| SC4 | Killing mapping part-way and running `avarice resume` reaches the same active record | VERIFIED (coincidental-reliance; load-sensitive flake, see Warnings) | Behavioral evidence, not presence: `test/fault/killpoints.test.ts` passed 20/20 when I ran it alone (53 s, Node 26.9.0). Live: `01-19-evidence-target.json` records kill -9 (exit 137) 63 s into the real map, `resume` exit 0, final state `active`, same onboarding ID and pin. Caveat: the validation run recorded 12 of 12 kill-point cases failing once at about 630% CPU on the normalized-record deepEqual, green on the rerun. I could not reproduce it, and the cause is unproven (review WR-01..03 hypothesize a transient code-graph failure frozen into `indexes.absent`). Kill points inside the intel and knowledge invocations are not covered (see gap 1). |
| SC5 | On a fresh Mac with Node present, install to first successful `avarice status` takes under 10 minutes with no admin rights (AC-1) | VERIFIED | Re-ran `scripts/ac1-timing.sh`: `AC-1 elapsed 1s (target 600s)`, `bin/avarice status` printed "No projects registered." from a scratch HOME. Not a literal fresh Mac, but the script clones the repository into a scratch HOME with no installs, and the runtime has no dependencies. |
| P-1 | On resume of an onboarding interrupted mid-invocation, any process still carrying that invocation's `--session-id` is terminated before reconciliation (plan 01-15; T-01-44) | FAILED (partial) | Holds for the map invocation (`resume.ts` `reapInterrupted`, `claude-host.test.ts` reap test). False for the intel and knowledge invocations added later by plans 01-17 and 01-18: `const LAUNCH = 'launch:map'` is the only step reconciled, and `reconcileInvocation` returns at `if (row.state !== 'paused') return ok(undefined)` for `planning_ready`. `grep launch: src` confirms `launch:intel` and `launch:knowledge` have no consumer. Reproduced by code reading, not by a live double-host run. |
| P-2 | Before activation the whole staging diff against every write set is re-checked, so a write outside them by any invocation or index step fails activation (plan 01-14) | FAILED (partial) | Reproduced the mechanism in `/tmp/vf3`: with `.gitignore` = `*`, `git status --porcelain=v2 -z --untracked-files=all` and `git diff --name-status HEAD` are empty for a new file; only `--ignored=matching` shows `! evil.txt`. `staging-base.ts` `changes()` uses the first form. Tracked modifications and deletions are still caught. |
| P-3 | Shell read confinement matches `docs/containment.md` (other profile roots denied) | FAILED (partial) | Ran the real `decideToolCall` with a policy built from `READ_ONLY_COMMANDS`, `GSD_READ_VERBS` and the scope's denyRead shape. Allowed: `cat /work/onb-2/staging/secret.txt`, `cat /home/u/.netrc`, `grep -r token /home/u`, `grep -r PASSWORD .`, `grep -f/home/u/.ssh/id_rsa README.md`. Denied: `cat /home/u/.ssh/id_rsa`, `cat <staging>/.env`. |

**Score:** 5/8 truths verified (the five ROADMAP success criteria; P-1 to P-3 are plan-level or spec-level truths that are partially false). 0 present-but-behavior-unverified.

### Deferred Items

None. I checked Phases 2 to 8 in `ROADMAP.md`: Phase 2 owns run-worktree write prevention (CON-2 for runs) and Phase 4 owns scrubbed environment and credentials (SEC-2), neither names onboarding-invocation sibling-staging read confinement, intel and knowledge host reaping, or ignored-file detection in the staging diff. No match clear enough to defer.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bin/avarice.ts` (+ `bin/avarice`) | CLI entry: onboard, resume, status, context, hook | VERIFIED | `status` ran against the real profile and a scratch HOME. Two identical copies (IN-01, info). |
| `src/domain/onboarding-lifecycle.ts`, `project-record.ts`, `onboarding-contract.ts` | Pure contracts | VERIFIED | `transitions.test.ts` (196 ordered pairs), `record.test.ts` pass. |
| `src/adapters/sqlite/ledger.ts` | Persisted ledger | VERIFIED | Real ledger answers `status`; lease and migration tests pass. |
| `src/adapters/git/staging-base.ts` | Staging diff and facts | ORPHANED-in-part | Works for tracked and non-ignored paths; blind to ignored paths (P-2). |
| `src/domain/hook-decision.ts`, `src/hook/pre-tool-use.ts` | Hook decision | VERIFIED for writes, STUB-in-part for reads | Write confinement and fail-closed behavior verified (`hook.test.ts` passes); read confinement is deny-list only (P-3). |
| `src/adapters/host-claude/*` | Contained Claude host, preflight, reap | VERIFIED for map | Reap only reachable for `launch:map` (P-1). |
| `src/app/stages/*`, `src/app/resume.ts` | Stage pipeline and resume | VERIFIED for map and index steps' stored results | `index-stage.ts` skips completed steps; transient failures stored as `completed` (WR-02). |
| `src/app/context.ts`, `src/adapters/context/*` | `avarice context` (FR-20) | VERIFIED | `context.test.ts` passes (EXTRACTED survives trimming longest; stale marking). |
| `scripts/ac1-timing.sh`, `scripts/exit-run.sh` | AC-1 and exit run | VERIFIED | AC-1 re-run 1 s. `exit-run.sh` spend guard fails open on a non-numeric value (WR-08, warning). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `runOnboarding` | `reconcileInvocation` prelude | `resumeOnboarding` | PARTIAL | Wired, but the prelude consumes only `launch:map` (P-1). |
| `prepareInvocation` | `host.reap` | `launch:{purpose}` step with session ID | PARTIAL | Recorded for all three purposes, consumed for one. |
| `indexStage` | `StagingBase.changes` -> `validate`/`activate scopeCheck` | diff against pin | PARTIAL | Wired; `changes()` omits ignored files (P-2). |
| `computeInvocationScope` | `buildHookPolicy` -> `decideToolCall` | `denyRead` | WIRED | Policy carries the fixed 5-entry list; `workRoot` absent (P-3). |
| `finalize/activate` | `project_records` insert + record fence | `insertRecordAndActivate` | WIRED | Real record exists; insert-only versions tested. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `avarice status` | record, indexes, nodes | `project_records.body_json` in the real SQLite ledger | Yes (1010 code, 24 document nodes read from the live ledger) | FLOWING |
| `avarice context` | graph and intel hits | GSD `intel query` and `graphify query` against staging indexes | Yes (integration test with real GSD and graphify) | FLOWING |
| Project record `indexes.graph` | counts, digest, builtAtCommit | merged `graph.json` validated in staging | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type check and boundary lint | `npx tsc -p .` ; `node scripts/check-boundaries.ts` | exit 0 ; `ok (53 file(s))` | PASS |
| Fail-closed, no-repo-exec, index stage, completeness, knowledge pass, context, offline, SEC-5, record, transitions | `node --test` over those 10 files | 155 pass, 0 fail | PASS |
| No competing index, budgets, checkout unchanged, executor, hook, intel step | `node --test` over those 6 files | 108 pass, 0 fail | PASS |
| Kill and resume at every kill point | `node --test test/fault/killpoints.test.ts` | 20/20 pass (alone, Node 26.9.0) | PASS |
| Active record on the real target | `node bin/avarice.ts status [--json]` | state active, graph and intel at `9f1cd8d` | PASS |
| AC-1 | `bash scripts/ac1-timing.sh` | 1 s | PASS |
| Hostile `.gitignore` blinds the diff | git status/diff in `/tmp/vf3` | empty; only `--ignored` shows the file | FAIL (confirms CR-03) |
| Hook read confinement | real `decideToolCall` probe | 5 escape cases allowed | FAIL (confirms CR-02) |

I did not run the full workspace suite (validation already ran it twice); I ran 16 named files plus the kill-point file once each.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and the phase declares none. SKIPPED (no probes declared).

### Requirements Coverage

All 14 phase requirement IDs appear in at least one PLAN `requirements:` field and are `[x]` / Complete in REQUIREMENTS.md. No orphans: REQUIREMENTS.md maps no further ID to Phase 1. ONB-6, claimed by plan 01-08, is owned by Phase 4 (this phase delivers detection and refusal only, per the traceability note). Extra IDs in plans (CON-2/3/5/6/13, NFR-1/3/5/6/9) match ROADMAP "Partial coverage".

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| ONB-1 | 01-01, 03, 05, 06, 19, 20 | Persisted, resumable lifecycle; transition recorded before its side effect | SATISFIED, with warning | Transition table and fence tests pass; kill and resume proven live and at 20 kill points. Warning: intel and knowledge hosts are not reaped on resume (CR-01), and one load-induced flake in the kill-point suite. |
| ONB-2 | 01-03, 05, 09, 10 | GSD owns semantic onboarding; AVARICE stores refs only | SATISFIED | `no-competing-index.test.ts` passes; record holds paths and digests. |
| ONB-3 | 01-02, 04, 08, 11, 12, 13, 15, 16, 19, 20 | Source and config read-only on every exposed mutation path; artifacts only in staging | SATISFIED for prevention, gap in detection | SC2 live evidence, `executor.test.ts`, checkout untouched. Detection backstop blind to gitignored untracked files (CR-03). |
| ONB-4 | 01-02, 04, 08, 11, 13, 16 | No repo command execution, no scripts, no services | SATISFIED | `no-repo-exec.test.ts` passes (hooks, fsmonitor neutralized via safe git). |
| ONB-5 | 01-08, 09, 16, 19 | No commit of generated artifacts | SATISFIED | `no-repo-exec.test.ts` refs digests; live case 08 (`update-ref`, `branch -f`, `commit` denied); target refs digest unchanged. |
| ONB-7 | 01-09, 10 | Accepted artifacts carry revision, scope, mode, completeness; fast map labeled partial | SATISFIED | `completeness.test.ts` passes; record shows `mapping.completeness`, `mode`, `scope`. |
| ONB-8 | 01-02, 12, 15, 20 | Onboarding contract with budgets that persist across retries and restarts | SATISFIED | `budgets.test.ts` passes. Stale-lease writers lack a fence (WR-04, warning). |
| ONB-9 | 01-01, 05, 10, 20 | Versioned project profile; instructions cannot grant permissions; activation validates | SATISFIED | `record.test.ts` (insert-only, narrowing only) passes; promotion `none`. |
| ONB-12 | 01-04, 05, 09, 10, 11, 15, 16, 20 | Missing enforcement, incompatible GSD, malformed artifacts block, never unrestricted | SATISFIED | `failclosed.test.ts`; live 11, 12a to 12c. |
| ONB-13 | 01-14, 17, 19 | Index stage builds intel and graph in staging with build commit; failed index never blocks activation | SATISFIED | Real record has both at the onboarded revision; `index-stage.test.ts` passes. A transient failure is frozen as permanently absent (WR-02). |
| ONB-14 | 01-02, 18, 19 | Knowledge pass adds document nodes citing path and revision, one contained invocation, text is data | SATISFIED | 24 document nodes in the real record; `knowledge-pass.test.ts`; live case 19 (knowledge hook allowed set is Read and one Write only). Real-skill output seen in the live rehearsal. |
| FR-20 | 01-17, 18 | Context queries a fresh index first; INFERRED ranks below EXTRACTED | SATISFIED | `context.test.ts` passes. |
| SEC-5 | 01-11, 20 | No TLS disabling, no alternate egress | SATISFIED | `sec5.test.ts` static scan over `src/` passes; env allowlist test; live case 10 (curl denied). |
| NFR-2 | 01-03, 05, 06, 07, 13, 17 | Local orchestration works offline | SATISFIED | `offline.test.ts` passes; `status` ran with no model. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (src, bin, scripts, test) | - | TBD / FIXME / XXX / TODO / HACK | none | Grep found zero debt markers. |
| `src/adapters/git/staging-base.ts` | 109-129 | status without `--ignored` | BLOCKER (gap P-2) | Detection backstop is blind to ignored paths. |
| `src/app/resume.ts` | 17, 49 | reconcile hard-wired to `launch:map` | BLOCKER (gap P-1) | Orphaned intel and knowledge hosts survive resume. |
| `src/domain/hook-decision.ts` | 195-233 | deny-list, non-recursive read confinement | BLOCKER (gap P-3) | Sibling staging, `~/.netrc`, recursive reads allowed. |
| `test/fault/killpoints.test.ts` | 66-71, 166 | `catch { return null }`; no healthy-reference assertion | WARNING | The suite can pass or fail vacuously (WR-03). |
| `src/app/stages/index-stage.ts` | 55-90 | transient outcomes stored `completed` | WARNING | A slow call freezes `absent` for the life of the record (WR-02). |
| `src/adapters/exec/sandboxed-executor.ts` | 20, 35-43 | 5 s probe cached forever as negative | WARNING | Fails closed but nondeterministically (WR-07). |
| `src/cli/args.ts` | 24-26 | plain-object flags | WARNING | `--__proto__=x` crashes with exit 1 (WR-05). |
| `scripts/exit-run.sh` | ~96-101 | NaN-comparison spend guard | WARNING | Fails open on a non-numeric value (WR-08). |

### Weighing the review findings against the must-haves

| Finding | Confirmed by me | Must-have affected | Classification |
|---------|-----------------|--------------------|----------------|
| CR-01 intel and knowledge hosts never reaped | Code read of `resume.ts`, `invocation.ts`, `grep launch:`; not run live | ONB-1 resumability, plan truth P-1, T-01-44 | BLOCKER (gap). SC4's wording ("killing mapping") is still met. |
| CR-02 read confinement is a non-recursive deny list | Reproduced with the real `decideToolCall` (5 cases) | `docs/containment.md:78` and CON-1's "known bypasses" duty; not ONB-3 (writes) | BLOCKER (gap) for a containment-first phase; it is also the cleanest example of the doc claiming more than the code. Owner could instead amend the doc and accept the limit. |
| CR-03 diff gate cannot see ignored files | Reproduced the git behavior and read `changes()` | ONB-3 detection backstop, plan truth P-2 | BLOCKER (gap), narrow: prevention holds, tracked changes still detected. |
| WR-01, WR-02, WR-03 kill-point flake | WR-02 and WR-03 confirmed by code; the flake itself not reproduced (20/20 alone) | ONB-1 and SC4 ("same record") under load; ONB-13 | WARNING, UNCERTAIN cause. Not counted as FAILED because SC4 has passing behavioral evidence and a plausible but unproven mechanism. A human decision is requested: treat the flake as a test-hardening task (WR-03) and a retry policy decision (WR-02). |
| WR-04 to WR-08, IN-01 to IN-05 | Read, not individually reproduced except where noted | ONB-8, NFR-6, hygiene | WARNING / info, no must-have falsified. |

01-SECURITY.md reports 94/94 threats closed at grep depth. That does not contradict the gaps: the register has no threat for sibling-staging reads, intel and knowledge reaping or ignored-file detection, so "all registered threats closed" and "these three defects exist" are both true.

### Human Verification Required

None needed to set the status; the three gaps are code-observable. Decisions requested from the owner:

1. **CR-02 disposition.** Fix the hook (allow-list, workRoot in denyRead) or amend `docs/containment.md:78` and the SECURITY register to state the read limit. A prompt-injected mapper currently can read `~/.netrc`, `~/.npmrc` and sibling onboardings' staging trees and the content reaches the model transcript.
2. **Kill-point flake.** Whether to harden `killpoints.test.ts` per WR-03 and to retry transient index failures per WR-02 before Phase 2 builds on the resume path.

### Gaps Summary

Three gaps, all in the containment and recovery hardening of otherwise working onboarding, grouped by root cause:

- **Late-added stages did not inherit earlier controls.** Plans 01-17 and 01-18 added the intel and knowledge invocations after 01-15 wrote map-only reaping and after the diff gate was written, and neither control was extended (P-1). The fix is generic reconciliation over `launch:*` plus a kill case inside those invocations.
- **A detection gate trusts a git view the hostile repository controls** (P-2). One flag and one parser case.
- **Read confinement is shallower than its documentation** (P-3). Needs an allow-list or an honest doc.

No ROADMAP success criterion fails, no requirement is unmet by its letter, there are no stubs or debt markers, and the live target onboarding is real. The status is `gaps_found` rather than `passed` because three verified, open critical defects sit on the containment layer this phase exists to establish, and a green verdict would hide them from Phase 2, which builds directly on this kernel. If the owner prefers to accept them, record each as an override with a reason (they are not intentional deviations, so I did not suggest one) or defer by adding them to a Phase 2 plan.

---

_Verified: 2026-11-04T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
