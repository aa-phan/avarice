---
phase: 03-decisions-independent-work-and-amendments
plan: 43
subsystem: run-supervisor
status: complete
tags: [host-config-dir, claude-config-dir, resume, decide, verification-record, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-42's diagnosis (D-03): the resume found no session under the owner's terminal environment, and the fresh fallback stopped on a G2 decision"
provides:
  - "a run records its host configuration directory at start (run step host:config-dir) and every supervisor of the run is launched with it"
  - "decide and resume refuse (exit 3) before any write when the recorded directory is missing or unreadable; supervise refuses (exit 70) on a differing directory"
  - "RUN_RECORDS_SENTENCE: the unit prompt names the records the run's gates read, and who writes them"
affects: [03-44, 03-45, 03-30, 03-31, 03-32, 03-33]

actuals:
  tokens: 17000
  tasks: 3
  commits: 6
plan_head_before: a63c5fee38cb60ab0cf631fe121ad97b6435bde2
plan_head_after: 2f9d1865c6bc05c30f9f782a44406499d40a9f34

key-files:
  created:
    - src/cli/host-config-dir.ts
    - test/integration/run-host-config-dir.test.ts
  modified:
    - src/cli/commands/start.ts
    - src/cli/commands/decide.ts
    - src/cli/commands/resume.ts
    - src/cli/commands/supervise.ts
    - src/cli/spawn-supervisor.ts
    - src/cli/composition.ts
    - src/domain/run-shell-rules.ts
    - src/app/run-gsd-config.ts
    - test/helpers/fake-run-host.ts
    - test/unit/run-gsd-config.test.ts
    - test/integration/run-prompt-policy.test.ts
    - docs/system/runs.md
    - docs/system/cli-reference.md
    - docs/system/data-model.md

key-decisions:
  - "Storage: one run step named host:config-dir with result { claudeConfigDir, source }, recorded through the existing ledger port. No column, no migration."
  - "The VERIFICATION diagnosis was confirmed in part and corrected in part: the record is written by the unit itself from the verifier's text, not by the verifier, because the host refuses a subagent a report file (observed on the executor's SUMMARY)."

requirements-completed: []

coverage:
  - id: D1
    description: "A run records its host configuration directory at start and a run answered from another environment resumes the session it paused in, with no fresh attempt"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/run-host-config-dir.test.ts#a run started under directory A and answered from directory B resumes the session it paused in"
        status: pass
      - kind: integration
        ref: "test/integration/run-host-config-dir.test.ts#control: a run with no recorded directory answered from directory B reproduces the repeated exit"
        status: pass
    human_judgment: false
  - id: D2
    description: "decide and resume refuse before any write when the recorded directory is missing or unreadable; supervise refuses a differing directory; runs without the step are never refused"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/integration/run-host-config-dir.test.ts#decide refuses, before it writes anything, when the directory the run recorded cannot be honoured"
        status: pass
      - kind: integration
        ref: "test/integration/run-host-config-dir.test.ts#supervise refuses a directory other than the recorded one"
        status: pass
      - kind: integration
        ref: "test/integration/run-host-config-dir.test.ts#resume refuses before it spawns or writes a step"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unit prompt names the records the gates read (PLAN, SUMMARY, VERIFICATION with a status line) and who writes them"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#names the records the gates read in the quick task directory, and who writes them"
        status: pass
      - kind: integration
        ref: "test/integration/run-prompt-policy.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether the unit now leaves a VERIFICATION record in a live run"
    verification: []
    human_judgment: true
    rationale: "The prompt change is offline-tested for presence and placement only; whether a model follows it is measured by the live repeat (plans 03-44, 03-45, 03-30)"

duration: one session, offline
completed: 2026-11-10
---

# Phase 3 Plan 43: The run's host configuration directory and the records sentence Summary

**A run now records the host configuration directory it was started under and every supervisor of it, whichever terminal answers or resumes, uses that directory, so a paused session is found again; decide, resume and supervise refuse visibly when the directory cannot be honoured; and the unit prompt names the VERIFICATION record the gates read and who writes it.**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Task 2, Task 3). All offline: no live model call, no spend, no AVARICE_LIVE run.
- **Commits:** 6 (three RED, three GREEN), measured from the ledger base `a63c5fee38cb60ab0cf631fe121ad97b6435bde2`.
- **Files modified:** 19 including three RED evidence records.

## Storage choice

One run step `host:config-dir`, status completed, result `{ claudeConfigDir, source }` (`CLAUDE_CONFIG_DIR` or `default`), recorded by `avarice start` through the ledger port after the run row exists and before the first supervisor is spawned. The directory is `CLAUDE_CONFIG_DIR` when set and not empty, else `<HOME>/.claude`, made absolute and resolved to its real path when it exists. No column and no migration: the run step table already keys facts by run and step. A failure to record is exit 70 before any spawn.

How it is honoured: `supervisorEnv(deps, runId)` sets `CLAUDE_CONFIG_DIR` to the recorded directory for every supervisor `start`, `decide` and `resume` spawn. `supervise` compares its own effective directory with the recorded one and refuses with exit 70 (no lease, nothing written) on a difference. A run with no step, and a run whose start and answer share one environment, behave as before.

Refusals, all before any write: `decide` (open decision of the run, one-line and prompt paths) and `resume` (only a run it would hand to a supervisor; a run it only reports is not refused) exit 3 with `avarice <command>: not applied: the run's host configuration directory <dir>, recorded when it started, is missing|not a directory|unreadable; restore it, or run this from an environment where it exists`.

## Diagnosis of the fallback's missing VERIFICATION (Task 3)

Sources: the kept transcripts of the fresh session `9ea84e6b-56e8-4514-a727-a4d4da28984e` under `~/.claude/projects/<run clone>/` and its `subagents/` directory (read only), and `src/domain/quick-record.ts`, `src/domain/gates.ts`.

| Fact | Source | Result |
| ---- | ------ | ------ |
| Four subagent types ran | each `agent-*.meta.json` `agentType` | gsd-planner, gsd-plan-checker, gsd-executor, gsd-verifier. Confirmed |
| The unit's prompt to the verifier | main transcript, the Agent call after the SUMMARY write | "Return findings as text; do not write files, and run no git commands that change the repo." Confirmed |
| The verifier's tool calls and final text | `agent-a1635a3c135614188.jsonl` | Bash, Read and Grep only, no Write of any file; final text "PASS. No gaps found for AC3." Confirmed |
| The quick directory the unit chose | the planner's and executor's Write paths | `.planning/quick/20261109-copy-fallback-names-address/`; the plan's name is right for the unit's own directory |
| What was written there | Write calls and results in all five transcripts | PLAN.md (the planner, succeeded) and SUMMARY.md. No VERIFICATION file was written by anyone. Confirmed |
| Who wrote SUMMARY.md | `agent-a2b0479dde61a50ce.jsonl`, events 90 to 93 | **New fact, not in the plan.** The executor's Write of SUMMARY.md was refused by the host: "Subagents should return findings as text, not write report files." The unit then wrote SUMMARY.md itself ("I'll write the SUMMARY myself, since the executor couldn't") |
| On disk now | `<run clone>/.planning/quick/` | Only `261019-rgm-adopt-awwwards-quality-bar-and-qa-loop-i/` (PLAN and SUMMARY, no VERIFICATION). That is the owner's earlier quick task already in the repository, which the planner listed and read as its format example. The unit's own directory is gone because the attempt was discarded. So the on-disk name `261019-rgm-*` is the example, not the task |
| How G2 reads the record | `quickRecordKind` in `src/domain/quick-record.ts`; `src/app/run-stages/item.ts` classify; `src/domain/gates.ts` | A changed path whose name ends in `VERIFICATION.md` is the verification record. None changed, so the status was missing and G2 failed with "GSD VERIFICATION status is missing, not passed". Confirmed |

**Verdict.** The immediate cause is the unit's own instruction to its verifier (do not write files), so no VERIFICATION file existed. That the unit followed that instruction rather than writing the file itself is a product gap: the prompt tells the unit to skip the quick workflow's init step, which is what names the record files, and never says which records the gates read. The transcripts add a second, host-level fact: a subagent's Write of a report-like file is refused (observed for SUMMARY.md; the refusal of a VERIFICATION write by the verifier is the same rule but was not itself observed, because the verifier was never asked to write one). The plan's reading, that the verifier writes the VERIFICATION file, would therefore have been refused by the host. The transcripts do not contradict the plan's diagnosis (the gap is the one it names), so no other defect was substituted; the fix was adjusted to the evidence: RUN_RECORDS_SENTENCE tells the unit to have the executor and verifier return their findings as text and to write SUMMARY.md and VERIFICATION.md itself, with a frontmatter `status:` of passed, gaps_found or human_needed.

A second contributor is likely but is inference: the example directory the planner read held only PLAN and SUMMARY, which is the shape the unit then produced.

## Task Commits

1. **Task 1 (tracer)** RED `03c3a44`, GREEN `1d0c567`. The cross-environment case failed first (a fresh `answer` attempt ran, the 03-42 shape); the control, which deletes the step to model a run started before the fix, reproduced the missing session and passes before and after, pinning the cause. RED evidence `03-43-red1.json` returned `RED_EVIDENCE_OK`.
2. **Task 2** RED `865fb34`, GREEN `f4f8209`. RED evidence `03-43-red2.json` returned `RED_EVIDENCE_OK` (target: supervise exits 3 instead of 70).
3. **Task 3** RED `88183e7`, GREEN `2f9d186`. RED evidence `03-43-red3.json` returned `RED_EVIDENCE_OK` (target: the sentence names the records; the stub was empty).

**Plan metadata:** the commit of this summary (docs: complete plan).

## Accomplishments

- Cross-environment offline proof: a run started under directory A and answered with `decide` under directory B resumes the delegated session under A, with no fresh attempt, and reaches `ready_for_review`. The fake host keeps sessions per configuration directory, as the real host does.
- Refusals tested before any write: decision row, events and steps byte-identical, no supervisor, no lease.
- Single-environment runs and runs with no step are unchanged: the existing resume, independent-work, attribution, decide and cancel suites pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's design] The records sentence says the unit, not the verifier, writes the VERIFICATION file**
- **Found during:** Task 3 (transcript diagnosis)
- **Issue:** The plan's behavior line says the verifier writes the VERIFICATION file. The host refused the executor a SUMMARY write ("Subagents should return findings as text, not write report files"), so a verifier told to write one would likely be refused too.
- **Fix:** the sentence says the unit writes SUMMARY.md and VERIFICATION.md itself from the subagents' returned text.
- **Files modified:** `src/domain/run-shell-rules.ts`
- **Commit:** `2f9d186`

**2. [Rule 3 - Blocking] RED needed a stub module and an existing fixture changed**
- A load failure is not RED, so the RED commits carry stubs (`src/cli/host-config-dir.ts`, an empty `RUN_RECORDS_SENTENCE`), and the fake host's per-directory store was added in the first RED commit so the cross-environment case failed on its assertion rather than passing trivially. The byte-for-byte single-item prompt fixture in `test/unit/run-gsd-config.test.ts` and the placement cases changed on purpose: the plan puts the sentence in every unit prompt.

**3. [Rule 3 - Blocking] The fake host's per-directory store is opt-in**
- It is switched on by `sessionsPerConfigDir` so that a test running the host in-process never writes under the real home. Every test of this plan uses temporary directories.

**4. Plan text differences, not behavior changes**
- `resume` checks the directory after `resumeRun` decides a supervisor would be spawned (the plan said before the lease check). `resumeRun` is read-only and takes no lease, and a run it only reports is never refused, so nothing is written or spawned on a refusal.
- `data-model.md` listed 17 run step names. The code writes six more: `host:config-dir` (this plan) and five that earlier Phase 3 plans added without updating the list (`supervisor:decide`, `item:base`, `park`, `repair:reproducer`, `resume:fallback`). I added all six, so the list has 23 names, rather than state a count I knew was wrong. The five others are named but not described in `runs.md`.

**Total deviations:** 1 correction to the plan's design (Rule 1), 3 mechanical (Rule 3). **Impact:** the contract of the plan holds. The one real difference is who writes the VERIFICATION record, which follows the evidence.

## Documentation surfaces (for plans 03-31 to 03-33)

- `docs/system/runs.md`: "The detached supervisor" (the recorded directory and the supervise refusal), "Launch." (the records sentence, who writes SUMMARY and VERIFICATION, the status line), "Resume and reconcile" (the directory check, the refusals, why a resume now finds the session).
- `docs/system/cli-reference.md`: `start` (records `host:config-dir`, exit 70 when it cannot), `supervise` (exit 70 on a differing directory), `resume` run path (exit 3 refusal). **There is no `decide` section in cli-reference.md** although `decide` is built; the decide refusal (exit 3, `avarice decide: not applied: the run's host configuration directory <dir>, recorded when it started, is missing|not a directory|unreadable; ...`, open decisions only, before the prompt and before any write) is written in `runs.md` only. Plan 03-33 needs a `decide` section.
- `docs/system/data-model.md`: the run step names (23, adding `host:config-dir`).
- History entry for plan 03-33: a run records its host configuration directory at start and every later supervisor uses it; decide, resume and supervise refuse when it cannot be honoured; the unit prompt names the records the gates read (plan 03-43).
- Not done here: no `docs/system/coverage.md` count or `findings.md` line changed; no new document, so the README tables are unchanged. The prose was written to the technical-writing rules but not reviewed by a fresh prose reviewer; that is plan 03-33's.

## Issues Encountered

- The root-pin script could not be run through the shell tool in this session (the tool refused it as too complex), so the check was made by hand before the first write and before each commit: `git rev-parse --show-toplevel` equals the worktree root.
- The plan commit ledger file under the git directory could not be written with the file tool (it is outside the worktree path), so the base `a63c5fee...` is recorded here from `git rev-parse HEAD` taken before the first commit; `commits: 6` is `git rev-list --count a63c5fe..HEAD` before this summary commit.

## Authentication Gates

None.

## Known Stubs

None. The RED stubs were replaced in the GREEN commits.

## Threat Flags

None new. T-03-97 held (cross-environment case, supervise refusal), T-03-98 held (refusals compare ledger rows before and after), T-03-99 accepted (the path is the owner's own), T-03-100 held (the transcripts and the clone were only read; nothing was written under `~/.claude`, `~/.claude-edu` or the work root), T-03-SC held (no installs).

## Next Phase Readiness

The product defect of the repeated exit is fixed offline and the prompt gap is closed. Whether a live model now leaves a VERIFICATION record is for the repeat (03-44, 03-45, 03-30). A run 1 that already exists keeps no recorded directory and is not helped by this change.

## Verification

- Whole suite (`node --test`): 3634 tests, 3563 pass, 0 fail, 71 skipped (skips pre-existing, none added here). Unit suite alone: 1949 pass.
- `npm run typecheck` and `node scripts/check-boundaries.ts` clean.
- Plan docs check (runs.md names the configuration directory and the VERIFICATION record, data-model.md lists `host:config-dir`, neither names a plan, the file or a function in prose): exit 0.

## Self-Check: PASSED

Files exist: `src/cli/host-config-dir.ts`, `test/integration/run-host-config-dir.test.ts`, and the three RED evidence records `03-43-red1.json`, `03-43-red2.json`, `03-43-red3.json` in the phase directory. Commits `03c3a44`, `1d0c567`, `865fb34`, `f4f8209`, `88183e7` and `2f9d186` are ancestors of HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10*
