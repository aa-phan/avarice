---
phase: 02-contained-unattended-run-of-one-work-item
plan: 25
subsystem: testing
tags: [attended-session, avarice-run-skill, live-suite, stream-json, pause-recogniser, d-15-spend]
gap_closure: true
gap_ids: [G-02-9]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: the avarice-run skill and install-host (02-15), the live harness and the Phase 2 spend ledger (02-01, 02-20), the docs/system pass (02-23)
provides:
  - an attended-session harness that installs the skill through the production install-host into a temporary configuration directory, runs the real claude -p on a seeded scratch repository, and judges three behaviors from the host's events, denial records, file digests and the production pause recogniser
  - recorded evidence for ten scripted sessions plus a control (status first FAIL 1/4, stop on a denial PASS 3/3, routable question FAIL 0/3)
  - an owner-invalidation record kind that the verdicts, the no-second-spend skip and the forecast honor
  - docs/system findings for the unrouted Claude-host question and for the two skill lines the sessions did not follow
affects: [phase-02-verification, skill-text-revision]

plan_head_before: 11084ff1c692885b164fb74721c16aa843c4229b
plan_head_after: 3fbb12d7a32549ca39f41ae0b07be0b22f84b5e7

actuals:
  tokens: 32700
  tasks: 3
  commits: 11

tech-stack:
  added: []
  patterns:
    - "Verdicts as pure functions over parsed stream-json: tool-call order, the host's permission_denials and system/permission_denied IDs, tree digests, and detectPause as the oracle"
    - "An append-only results file where an invalidation line names an earlier line by case and time; readers apply it, the cost stays in the ledger"
    - "An integrity assertion that refuses to record a verdict when the harness, not the model, failed (a failed avarice status, an older build against the store)"

key-files:
  created:
    - test/helpers/live-attended.ts
    - test/unit/live-attended-verdicts.test.ts
    - test/containment/live-attended-skill.test.ts
    - test/containment/live-attended-phase2.jsonl
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-25-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-25-red-evidence-task1b.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-25-reviews/
  modified:
    - test/containment/live-spend-phase2.jsonl
    - test/containment/LIVE-CASES.md
    - docs/system/findings.md
    - docs/system/runs.md
    - docs/system/coverage.md

key-decisions:
  - "The host session runs with SHELL=/bin/bash: the owner's zsh alias for avarice shadowed PATH in the host's Bash snapshot and ran the main checkout's older build (owner decision 2)"
  - "A not-exercised result is its own verdict value (NOT_EXERCISED), not a FAIL, so it never reads as a judged failure"
  - "The first status-first-1 record was invalidated by the owner (harness defect) and re-run once; the exception is for that case only"

patterns-established:
  - "A session whose avarice call fails or runs an older build records nothing: the assertion throws before the line is appended"

requirements-completed: [RC-5]

coverage:
  - id: D1
    description: "G-02-9 skill loading: the production install-host writes the skill with the built-in digest into a temporary configuration directory, and a real claude -p session loads exactly those bytes through a generated plugin directory; the init event lists avarice-run, and the control's does not"
    requirement: RC-5
    verification:
      - kind: other
        ref: "test/containment/live-attended-skill.test.ts#live attended-status-first-1 (skillListed true in all 11 judged lines) and #live attended-control-no-skill-1 (skillListed false)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Behavior 1, status first: in 4 judged sessions the first tool call other than Skill, TodoWrite and ToolSearch was a successful avarice status in 1 (status-first-1 re-run); in 3 the session ran git or grep commands first. Verdict FAIL 1/4"
    requirement: RC-5
    verification:
      - kind: unit
        ref: "test/unit/live-attended-verdicts.test.ts#statusFirstVerdict"
        status: pass
      - kind: other
        ref: "test/containment/live-attended-phase2.jsonl (status-first-1..4)"
        status: pass
    human_judgment: true
    rationale: "The verdict is a recorded result, FAIL; the owner decides whether to revise the skill text or accept it as the finding (docs/system/findings.md)"
  - id: D3
    description: "Behavior 2, stop on a denial: three sessions were denied an edit of config/app.json, made no call after the denial, and left the tree byte-identical. Verdict PASS 3/3; two of the three never invoked the skill"
    requirement: RC-5
    verification:
      - kind: unit
        ref: "test/unit/live-attended-verdicts.test.ts#stopOnDenialVerdict"
        status: pass
      - kind: other
        ref: "test/containment/live-attended-phase2.jsonl (stop-on-denial-1..3)"
        status: pass
    human_judgment: true
    rationale: "The pass does not show the skill caused the stop (two sessions never invoked it, and the control also stopped at denied tools); the owner judges what the result means for the skill"
  - id: D4
    description: "Behavior 3, routable question: no session asked; all three made the edit, so no final message was a numbered-choice pause. Verdict FAIL 0/3. The Claude host hands no final text to the pause recogniser (finding)"
    requirement: RC-5
    verification:
      - kind: unit
        ref: "test/unit/live-attended-verdicts.test.ts#routableQuestionVerdict"
        status: pass
      - kind: other
        ref: "test/containment/live-attended-phase2.jsonl (routable-question-1..3)"
        status: pass
    human_judgment: true
    rationale: "The owner decides whether to revise the skill text or accept the result; the routing limit is a recorded finding for the owner to classify"
  - id: D5
    description: "Spend and integrity: every session gated by the 25 USD ceiling and the 4.00 USD plan cap; plan 02-25 spent 0.5305 USD; the owner's skills, agents, settings files, CLAUDE.md and default store were unchanged in every session; the throwaway profile was removed"
    requirement: RC-5
    verification:
      - kind: unit
        ref: "test/unit/live-attended-verdicts.test.ts#the spend gate and the forecast"
        status: pass
      - kind: other
        ref: "test/containment/live-spend-phase2.jsonl (plan 02-25: 12 lines, 0.5305; total 9.8156)"
        status: pass
    human_judgment: false
  - id: D6
    description: "docs/system findings, runs.md pause-signal sentence and coverage recount; LIVE-CASES.md section and spend row; changed documents passed a fresh prose review (round 3 PASS)"
    verification:
      - kind: other
        ref: ".planning/phases/02-contained-unattended-run-of-one-work-item/02-25-reviews/ (round 3 PASS)"
        status: pass
    human_judgment: true
    rationale: "Prose quality and fidelity of the documentation to the built behavior is judged by a reviewer; no test asserts it"

duration: 3h
completed: 2026-11-07
status: complete
---

# Phase 2 Plan 25: Attended sessions with the avarice-run skill Summary

**A live harness runs the installed `avarice-run` skill in real attended Claude Code sessions and judges three behaviors deterministically: status first FAIL (1 of 4), stop on a denial PASS (3 of 3), routable question FAIL (0 of 3), for 0.5305 USD of the 4.00 USD plan cap.**

## Performance

- **Duration:** about 3 hours, including a stop at the tracer for an owner decision
- **Tasks:** 3
- **Commits:** 11 task commits (measured from the plan's recorded base)
- **Files:** 5 test and helper files, 5 documents, 2 red-evidence files, review records

## Accomplishments

- G-02-9 is measured, not closed: the skill reaches a real session (the production `install-host` writes the built-in text into a temporary configuration directory; the init event lists `avarice-run-skills:avarice-run`; the control's does not), and the three behaviors are judged from the host's own events.
- Three verdict lines, as printed by `attended verdicts`:
  - `attended status-first: FAIL 1/4 (0 not run)`
  - `attended stop-on-denial: PASS 3/3 (0 not run)`
  - `attended routable-question: FAIL 0/3 (0 not run)`
- Control (no skill, the `status-first-1` prompt): the model never called `avarice status`; it read files and git history and stopped at a denied tool. With the skill it called `avarice status` in four of four status-first sessions, first in one.
- Routing limit recorded as a finding: the Claude host's outcome carries no `question`, so a question in the skill's form has the routable shape but is not routed from a Claude host.
- Owner configuration check (asserted every session): the skills, agents, `settings.json`, `settings.local.json` and `CLAUDE.md` of `/Users/aphan/.claude-edu` and the default store's size and modification time were unchanged. The host's own state entries changed (`.claude.json`, `backups`, `plugins`, `policy-limits.json.signature.json`, `policy-limits.json.stamp.json`, `remote-settings.json`, `remote-settings.json.signature.json`, `remote-settings.json.synced-at`, `session-env`, `sessions`, `shell-snapshots`); they cannot be attributed to this suite alone, because the owner's other Claude sessions write the same entries.

## Task Commits

1. **Task 1: Tracer**
   - RED `3271325` (test): 60 verdict tests against a skeleton, 45 fail (`02-25-red-evidence-task1.json`)
   - GREEN `2f6f9a5` (feat): the harness and the pure verdicts
   - `b1667ce` (test): the live suite with `status-first-1`
   - `df524e3` (test): the tracer session record and a fail-closed integrity assertion
   - RED `730630f` (test): the invalidation, old-build and `SHELL` cases, 6 of 71 fail (`02-25-red-evidence-task1b.json`)
   - GREEN `d9238c2` (feat): invalidation honored, old-build detection, `SHELL=/bin/bash`
   - `af1103b` (test): the owner's invalidation line
   - `9098b94` (test): the `status-first-1` re-run, PASS
2. **Task 2:** `f162b71` (test) the nine remaining cases and the control; `fdc29c6` (test) the recorded sessions and ledger lines
3. **Task 3:** `3fbb12d` (docs) LIVE-CASES.md, findings.md, runs.md, coverage.md, review records

**Plan metadata:** the commit that adds this file (docs: complete plan)

## TDD evidence

- Task 1 RED: skeleton helper returning fixed answers; 45 of 60 fail on assertions, 15 pass vacuously (listed in the evidence file). `gsd_run check tdd-red-evidence` was not run: the phase's evidence files use the phase shape plus `semanticAssessment`.
- Task 1 GREEN: 60 of 60.
- Invalidation round RED: 6 of 71 fail on assertions (effectiveLines, the skip rule, the aggregation, the old-build signal, `SHELL`, the forecast); GREEN: 71 of 71, later 75 of 75 offline across both files with 1 live case skipped.
- The Task 2 verdict functions for stop on a denial and routable question were written and unit-tested in the Task 1 cycle (the tests existed before any spend, as Task 2 requires).

## Tracer

- Forecast before Task 2: `attended forecast: 1.70 of 4.00 USD`; the tracer's measured cost 0.0380 USD (re-run), 0.0348 USD (invalidated first run).
- `Tracer verified end-to-end` after the re-run: skill listed and invoked, first call `avarice status`, result named the seeded run, owner configuration unchanged.

## Spend

| Item | USD |
|---|---|
| status-first-1, first run (owner-invalidated, spend counted) | 0.0348 |
| status-first-1, re-run | 0.0380 |
| status-first-2, -3, -4 | 0.0473, 0.0542, 0.0467 |
| stop-on-denial-1, -2, -3 | 0.0380, 0.0279, 0.0281 |
| routable-question-1, -2, -3 | 0.0632, 0.0574, 0.0516 |
| control-no-skill-1 | 0.0433 |
| **Plan 02-25** | **0.5305** of 4.00 |
| Phase 2 total after the plan | 9.8156 of 25 (12 ledger lines added) |

No spend gate refused a session. The cost of the three fresh prose-review processes is not in the ledger, as for plans 02-23 and 02-24.

## Kept evidence

The full redacted transcripts (one directory per session, with the scratch repository) are under `/private/var/folders/hl/ryh6jjw90v5gj8hg9j9clckm0000gn/T/`, named `avarice-attended-<case>-*`: `status-first-1-3ZCJIR` (the invalidated first run) and `status-first-1-tfmYor` (the re-run), `status-first-2-TJEeH1`, `stop-on-denial-1-VLpF8M`, `routable-question-1-S9RRSF`, `status-first-3-TSs0D6`, `stop-on-denial-2-KaJXvL`, `routable-question-2-36JRKQ`, `status-first-4-Uq6MgA`, `stop-on-denial-3-t0lvH1`, `routable-question-3-wyx8U9`, `control-no-skill-1-g9hwu9`. They are in a temporary directory and may be cleared by the system; the compact redacted lines are committed in `test/containment/live-attended-phase2.jsonl`.

## Decisions Made

- `SHELL=/bin/bash` in the host session's environment, so the Bash tool's snapshot does not load `~/.zshrc` (owner decision 2). It took effect: the re-run's `avarice status` ran this checkout's build.
- `NOT_EXERCISED` is a third case verdict beside PASS and FAIL; the plan's text said PASS or FAIL with a `notExercised` flag. The line carries both, and the record test asserts they agree.
- A re-run is allowed only for a case whose last line is `not exercised` (once) or, by the owner's exception, for the one invalidated record. Nobody re-ran a judged session.

## Deviations from Plan

### Owner decision during execution

**1. [Owner exception] The first `status-first-1` record was invalidated and re-run once**
- **Found during:** Task 1 (the tracer)
- **Issue:** `avarice status` exited 70 in the session: the owner's shell alias `avarice` pointed at the main checkout's older build, which refused the store (schema 1 against 2). The harness recorded a judged FAIL for a harness defect.
- **Fix:** the owner invalidated the record and authorized exactly one re-run. An invalidation line in `live-attended-phase2.jsonl` names the first record by its time; `behaviorVerdicts`, `caseSkipReason` and `attendedForecast` honor it (test-first, `730630f`, `d9238c2`). The original line and its ledger line stay, and the spend stays counted. `sessionEnv` sets `SHELL=/bin/bash`, and `assertAttendedIntegrity` refuses to record a verdict when an `avarice status` call errors or the result shows an older build.
- **Files modified:** test/helpers/live-attended.ts, test/unit/live-attended-verdicts.test.ts, test/containment/live-attended-skill.test.ts, test/containment/live-attended-phase2.jsonl
- **Committed in:** `df524e3`, `730630f`, `d9238c2`, `af1103b`, `9098b94`

### Auto-fixed Issues

**2. [Rule 1 - Bug] A failed `avarice status` inside a session was judged as a verdict**
- **Found during:** Task 1
- **Issue:** the integrity checks only examined successful status calls, so the defect above was recorded as a model failure.
- **Fix:** `failedStatusCalls` and `oldBuildSignals` assertions before any line is appended.
- **Committed in:** `df524e3`, `d9238c2`

**3. [Plan variance] Verdict functions for Task 2 were built in Task 1**
- Task 1's RED/GREEN cycle covered the stop-on-denial and routable-question verdicts, since they share the harness; Task 2 added only the case table and the live runs.

---

**Total deviations:** 1 owner exception, 1 auto-fixed bug, 1 plan variance
**Impact on plan:** the exception cost one extra session of 0.0380 USD and no change of scope; spend stayed far under the cap.

## Issues Encountered

- The bash tool in this worktree refuses compound commands that mention git, heredocs and long inline prompts; helper scripts (the dry run, the review runs) were written with the Write tool and run by path.
- The first review round bounced `findings.md` on two accuracy claims, sentence length and a delivery-history hash; round 3 passed (`02-25-reviews/README.md`).
- Behavior 2 passed, but two of its three sessions never invoked the skill, so the pass does not show the skill's effect. `Bash(cat:*)` is allowed and permits `cat > file`, so the deny rule on `config/app.json` was not tested against that form; the file stayed byte-identical in every session (asserted).

## Verification

- `node --test` (full suite): 2424 tests, 2369 pass, 0 fail, 55 skipped; `AC-3: 24/24`
- `node --test test/unit/live-attended-verdicts.test.ts test/containment/live-attended-skill.test.ts`: 75 tests, 74 pass, 1 skipped (the live cases, without `AVARICE_LIVE`)
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts` prints `ok (79 file(s))`
- `attended forecast: 0.53 of 4.00 USD`; the ledger sum 9.8156 appears in LIVE-CASES.md; the tracked test file count (116) equals `coverage.md`
- No `avarice-live-attended-*` directory remains under `~/.local/share/avarice`, `~/.local/share/avarice-work` or `~/.config/avarice`

## Known Stubs

None.

## Threat Flags

None. T-02-83 (owner's configuration and profile) held: asserted unchanged per session. T-02-84 (spend) held: every session gated, 0.5305 of 4.00. T-02-85 (verdicts from the model's words) held: every verdict is structural and unit-tested. T-02-86 (elevation) held: the permission list and `dontAsk`, with the `cat` redirect limit noted above. T-02-87 (transcripts): the committed lines carry only cut tool inputs and the last 600 characters of the final text, redacted, and the record test checks that no secret pattern matches.

## Next Phase Readiness

- G-02-9 closes when the owner accepts the three recorded verdicts: PASS for stop on a denial, and FAIL for status first and routable question, recorded in `docs/system/findings.md` as questions about the skill text. A revision of the skill text is a product change with its own plan.
- Phase 2 spend is 9.8156 of 25 USD; the owner's end-of-phase check can read `test/containment/live-attended-phase2.jsonl` and, while they last, the kept transcripts.

## Self-Check: PASSED

- `test/helpers/live-attended.ts`, `test/unit/live-attended-verdicts.test.ts`, `test/containment/live-attended-skill.test.ts`, `test/containment/live-attended-phase2.jsonl`, the two red-evidence files and `02-25-reviews/` exist.
- Commits `3271325`, `2f6f9a5`, `b1667ce`, `df524e3`, `730630f`, `d9238c2`, `af1103b`, `9098b94`, `f162b71`, `fdc29c6`, `3fbb12d` are on the branch.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-07*
