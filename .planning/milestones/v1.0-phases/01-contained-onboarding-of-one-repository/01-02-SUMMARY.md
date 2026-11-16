---
phase: 01-contained-onboarding-of-one-repository
plan: 02
subsystem: infra
tags: [spikes, claude-code, containment, sandbox, gsd, graphify, wave-0]
status: complete

requires: []
provides:
  - "spikes/slice-0-wave-0/results.json: verdicts, costs, evidence and recommendations for S0-A to S0-G, consumed by plans 01-08, 01-11, 01-15, 01-17, 01-18, 01-19"
  - "Reusable spike harness: env-allowlist launcher with a spend ledger gate, scratch repository builder, host-settings generator, logging and deciding PreToolUse hook, ground-truth probes"
  - "Measured default onboarding budgets (fast map 0.04 USD and 147 s, full map 0.13 USD and 171 s on the 363-file target, haiku)"
affects: [01-08, 01-11, 01-15, 01-17, 01-18, 01-19]

actuals:
  tokens: 83400
  tasks: 2
  commits: 1
plan_head_before: 0867a20b705c6ae07006fb6f8f208442b4fa0a4f
plan_head_after: 64c68162c1bfcaaa116215df1ce75be79e5994bc

tech-stack:
  added: []
  patterns:
    - "Ground truth from files, git state and tool output, never from the model's report; digests committed, transcripts kept under SPIKE_ROOT"
    - "Spend gate: every run needs --max-budget-usd, and ledger spend plus the run cap must stay within the authorized total"
    - "Hook identity control: PreToolUse allow by first-line match, deny by default; both honored under dontAsk"

key-files:
  created:
    - spikes/slice-0-wave-0/README.md
    - spikes/slice-0-wave-0/results.json
    - spikes/slice-0-wave-0/harness.sh
    - spikes/slice-0-wave-0/run-all.sh
    - spikes/slice-0-wave-0/make-scratch.sh
    - spikes/slice-0-wave-0/common.sh
    - spikes/slice-0-wave-0/gen-settings.mjs
    - spikes/slice-0-wave-0/gen-cases.mjs
    - spikes/slice-0-wave-0/hook-log.mjs
    - spikes/slice-0-wave-0/truth.mjs
    - spikes/slice-0-wave-0/summarize.mjs
    - spikes/slice-0-wave-0/assemble-results.mjs
    - spikes/slice-0-wave-0/check-results.mjs
    - spikes/slice-0-wave-0/cases/ (27 case files)
    - spikes/slice-0-wave-0/evidence/ (27 digests plus ledger.jsonl)
  modified: []

key-decisions:
  - "Bash command identity is a PreToolUse hook concern, not a permissions.allow concern: skills pre-approve Bash (allowed-tools), the preamble is a 2.5 KB compound line, and hook allow and deny both hold under dontAsk (S0-A)"
  - "Stage onboarding in a local clone; a linked worktree is safe only with generated denyWrite entries on the source .git and the worktree gitdir, because without them a contained run moved a source branch ref (S0-B)"
  - "Env allowlist gains USER and LOGNAME (login fails under env -i without USER) and PATH starts with <gsd-core>/bin; CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 is needed, --setting-sources empty already excludes CLAUDE.md (S0-C, S0-E)"
  - "Intel runs as claude -p --agent gsd-intel-updater with the agent in --agents (no Agent tool, subagent budget 0) (S0-D)"
  - "Default budgets from S0-F: wall clock map 8, intel 5, knowledge 6 minutes; toolCalls 300; costUsd perInvocation 1.00, perRun 3.00; AVARICE enforces its own wall clock because a stalled background subagent holds -p for the 10 minute host ceiling"
  - "Knowledge pass needs the graphify binary directory on PATH for that invocation; document edges come back EXTRACTED and AVARICE re-tags them, stamps _origin and built_at_commit"

patterns-established:
  - "Spike evidence = per-case digest JSON (counts, first lines, short excerpts) plus a ledger, with transcripts outside the repository"

requirements-completed: [ONB-3, ONB-4, ONB-8, ONB-14]

coverage:
  - id: D1
    description: "Spike harness and scripts: refuses a run without --max-budget-usd or past the authorized total, builds scratch repositories outside ~/.claude*, never touches the user repository"
    requirement: ONB-4
    verification:
      - kind: other
        ref: "grep -c max-budget-usd spikes/slice-0-wave-0/harness.sh (6); grep -rn .claude-edu/jobs spikes/slice-0-wave-0/*.sh (0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "results.json holds S0-A to S0-G with verdicts, cost, evidence and recommendations; the S0-B staging table and the S0-A preamble fingerprint are recorded"
    requirement: ONB-3
    verification:
      - kind: other
        ref: "node spikes/slice-0-wave-0/check-results.mjs spikes/slice-0-wave-0/results.json"
        status: pass
    human_judgment: true
    rationale: "Verdicts and recommendations are interpretation of the ground-truth digests; later plans should review them before adopting a design"
  - id: D3
    description: "Total recorded spend 0.4135 USD against the authorized cap of 4.30 USD"
    requirement: ONB-8
    verification:
      - kind: other
        ref: "check-results.mjs totalCostUsd <= authorization.capUsd; evidence/ledger.jsonl"
        status: pass
    human_judgment: false
  - id: D4
    description: "The user's checkout of ~/aa-phan-portfolio-v2 is unchanged (git status porcelain, for-each-ref digest, HEAD)"
    requirement: ONB-14
    verification:
      - kind: other
        ref: "git -C ~/aa-phan-portfolio-v2 status --porcelain (only '?? .env'); for-each-ref sha256 and HEAD equal the pre-plan baseline"
        status: pass
    human_judgment: false

duration: 84 min
completed: 2026-11-02
---

# Phase 1 Plan 02: Wave 0 live spikes Summary

**Seven live spikes on the Claude Code, GSD and graphify seams, run under a 4.30 USD authorization for 0.41 USD, with ground-truth verdicts that settle the Bash strategy, the staging strategy, the intel seam, the env allowlist, the default budgets and the knowledge-pass flags.**

## Performance

- **Duration:** 84 min (2026-11-02 17:41Z to 19:05Z), dominated by harness building and two wait periods on S0-F
- **Tasks:** 2 (Task 1 was a blocking-human spend decision, resolved by the user as `approve-all` before this run; Task 2 built the harness and ran the spikes)
- **Files:** 68 created under `spikes/slice-0-wave-0/`
- **Spend:** 0.4135 USD of the 4.30 USD cap (47 recorded runs, all `haiku`; 0.0217 USD is the precondition and env-bisect runs)

## Accomplishments

- **Authorization (Task 1, resolved):** option `approve-all`, cap 4.30 USD, decided by the user on 2026-11-02, written as `authorization` in `results.json`.
- **S0-A finding:** all four Bash strategies completed the fast map because the skill's `allowed-tools` pre-approves Bash; without the skill the same commands, including the verbatim preamble, are denied (A5). A hook allow is honored under `dontAsk` (A8) and a hook deny overrides the skill (A7). Preamble first line: 2,573 characters, SHA-256 `c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b`, stored verbatim in `results.json`.
- **S0-B finding:** from a linked worktree with no extra `denyWrite`, the contained run moved the source repository's `refs/heads/main` (B1). With `denyWrite` on the source `.git` and the worktree gitdir (B2), or in a local clone (B3), no source ref, HEAD or config byte changed. `denyRead` on the checkout root with `allowRead` of `.git` blocks `.env` while `git log` works (B4).
- **S0-C pass:** `PATH` with `<gsd-core>/bin` first resolves the preamble and `gsd_run runtime-identity --raw`; the control fails with `gsd-tools.cjs not found`. Login under `env -i` needs `USER`.
- **S0-D pass:** `--agent gsd-intel-updater` resolves an agent supplied only through `--agents`; five valid intel files in 31 s for 0.009 USD. The Agent-tool form also works and `-p` waits for the background agent.
- **S0-E finding:** `--setting-sources ""` already excludes repository and user `CLAUDE.md` (control E4 shows the probe can detect a load); auto memory needs `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Plugin skills load namespaced, agents under bare names.
- **S0-F finding:** on a scratch clone of the 363-file target, fast map 0.0405 USD in 147 s and full map 0.1304 USD in 171 s (4 subagents, 82 tool calls). A first fast-map attempt stalled in the mapper subagent until the host's 10-minute background ceiling and wrote nothing.
- **S0-G finding:** the knowledge pass runs only with the graphify directory on `PATH` and Read of the skill files; output lands in `<cwd>/graphify-out`; 16 of 21 document edges came back `EXTRACTED`, nodes carry no `_origin`, and `built_at_commit` is absent.

## Task Commits

1. **Task 1: Authorize model spend** - no commit; checkpoint resolved by the user before dispatch and recorded in `results.json`.
2. **Task 2: Build the spike harness, run S0-A to S0-G, record verdicts** - `64c6816` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Login failed under the rebuilt environment**
- **Found during:** Task 2 precondition check
- **Issue:** `claude -p` under `env -i` with the planned allowlist answered "Not logged in"; bisecting showed the host needs `USER` for its credential lookup.
- **Fix:** harness env now includes `USER` and `LOGNAME`; recorded as an S0-C finding for the generated-environment design.
- **Files modified:** spikes/slice-0-wave-0/harness.sh
- **Commit:** 64c6816

**2. [Rule 2 - Missing critical] Extra control cases**
- **Found during:** S0-A and S0-E analysis
- **Issue:** A1 to A4 all passed without ever exercising the permission layer, and E2 alone could not show whether a CLAUDE.md load would be detected.
- **Fix:** added controls A5 to A8 (no-skill denial, hook deny, hook deny under the skill, hook allow), E1b/E2b/E4 (direct probe and a positive control), B-case extras (`git config`, a Node read of `.env`, source writes from the clone) and G2/G3 (graphify on PATH, skill Read allowed). Total extra spend about 0.1 USD, still inside the per-spike allocations in aggregate and far inside the total cap.
- **Files modified:** spikes/slice-0-wave-0/gen-cases.mjs, run-all.sh
- **Commit:** 64c6816

**3. [Rule 1 - Bug] Harness script defects found while running**
- **Found during:** Task 2
- **Issue:** unquoted local ordering under `set -u`, a bash 3.2 heredoc parse error, a zsh-versus-bash word-splitting slip in an ad hoc check, and a missing `</dev/null` stdin redirect.
- **Fix:** corrected in the committed scripts.
- **Files modified:** run-all.sh, harness.sh
- **Commit:** 64c6816

**4. [Rule 1 - Bug] Stalled first S0-F run**
- **Found during:** S0-F
- **Issue:** the first fast-map attempt hung until the host's 10-minute background ceiling and wrote no map.
- **Fix:** one retry, which passed; the stall is kept as evidence (`evidence/F1-attempt1.json`) and as a budget finding.
- **Commit:** 64c6816

**Total deviations:** 4 auto-fixed (1 blocking, 1 missing-control, 2 bugs). **Impact:** none on scope; spend stayed at 0.41 USD of the 4.30 USD cap. Per-spike allocations (0.40 USD each) were not exceeded except S0-F fast map plus retry, which together stayed under the 1.90 USD allocated to S0-F.

## Authentication Gates

None. The login precondition passed once `USER` was in the environment (no human action needed).

## Issues Encountered

- The host writes its own session transcripts for the scratch runs under `~/.claude-edu/projects/-Users-aphan--local-share-avarice-spikes-wave-0-*`; these are host-managed, outside the repository, and not committed.
- ROADMAP.md numbers its progress table from 0, so `roadmap update-plan-progress 01` addresses the wrong row; corrected by hand (see state updates).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model: all model-directed writes stayed inside `SPIKE_ROOT` scratch directories (T-01-05), every run carried a budget cap and the ledger gate (T-01-06), and committed evidence holds digests only, with the scratch `.env` value fake (T-01-07). No package was installed (T-01-SC).

## Next Phase Readiness

Plans 01-08 (staging strategy), 01-11 (allow-list, env, budgets), 01-15 (intel seam, T3 suite), 01-17 and 01-18 (knowledge pass) can read their decisions from `spikes/slice-0-wave-0/results.json`. Open item for the owner: confirm the recommendation to stage in a clone rather than a worktree.

## Self-Check: PASSED

- Created files exist (`results.json`, `README.md`, `harness.sh`, `run-all.sh`, `make-scratch.sh`, `gen-settings.mjs`, `hook-log.mjs`, `check-results.mjs`): FOUND.
- Task commit `64c6816` is an ancestor of HEAD: FOUND.
- `node spikes/slice-0-wave-0/check-results.mjs spikes/slice-0-wave-0/results.json` exits 0: PASS.
- Acceptance criteria: all seven spike keys present, `max-budget-usd` count 6 in `harness.sh`, no `.claude-edu/jobs` in the scripts, target repository `git status --porcelain` shows only `?? .env`, README table has a "Design impact" column: PASS.
