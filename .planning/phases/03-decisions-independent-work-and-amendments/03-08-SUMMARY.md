---
phase: 03-decisions-independent-work-and-amendments
plan: 08
subsystem: host-adapter
tags: [claude-code, resume, stream-json, prompt, reap, containment]

requires:
  - phase: 02-run-engine
    provides: "claude-host adapter, launch-args builder and judge, stream-json parser, runUnitPrompt, InvocationOutcome.question seam read by detectPause"
provides:
  - "InvocationRequest.resumeSessionId (vendor-neutral); the launch line ends --resume <id> instead of --session-id <id>, with every containment flag kept"
  - "reapBySessionId finds a host by --session-id or --resume in its command line"
  - "StreamResult.finalTextTail and InvocationOutcome.question: the last 2000 stripped characters of the final result text, as data"
  - "runUnitPrompt(contract, pack, item?), RUN_DECISION_SENTENCE(decisions), RunPromptItem, runResumePrompt(answer, item)"
affects: [03-13 spike S3-A, 03-22 fresh-unit fallback, run supervisor pause and resume, 03-31 documentation plan]

actuals:
  tokens: 8000
  tasks: 3
  commits: 6

plan_head_before: 3b6e6181506b42a9d86a2625999bdfa3099d31ae
plan_head_after: 3a2fb5cb9533c6febc33ec1f104509b061197ac4

tech-stack:
  added: []
  patterns:
    - "A resume swaps only the final flag pair of the launch line; assertLaunchArgsSafe is unchanged and judges the resume line"
    - "Model text is kept only as a bounded, control-stripped tail under one named field, surfaced on one outcome field, never in details, events or step results"
    - "An owner's answer enters a prompt as capped, flattened data under a fixed line, followed by a sentence stating it changes no path, command or criterion"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-08-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-08-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-08-red-evidence-task3.json
  modified:
    - src/ports/agent-host.ts
    - src/adapters/host-claude/launch-args.ts
    - src/adapters/host-claude/claude-host.ts
    - src/adapters/host-claude/stream-json.ts
    - src/app/run-gsd-config.ts
    - test/unit/launch-args.test.ts
    - test/unit/stream-json.test.ts
    - test/unit/run-gsd-config.test.ts
    - test/integration/claude-host.test.ts
    - test/integration/resume-reap.test.ts
    - test/fixtures/claude-fake/claude-replay.mjs
    - test/helpers/fake-claude.ts

key-decisions:
  - "When a request carries both sessionId and resumeSessionId the resumed session wins and the outcome names it, so the launch line can never carry both flags"
  - "RUN_DECISION_SENTENCE is a function of the contract's decisions lists (an exported const arrow), so a contract change changes the sentence; it uses single quotes around 1. and 2. because the unit prompt's wrapper escapes double quotes"
  - "RunPromptContract.decisions is required, so the decision sentence is always in the unit prompt; 'without an item' therefore means no work-item line and the contract's whole criteria list, not byte-equality with the pre-plan prompt"
  - "The item's spec files are listed under the editable paths as information with the words 'edit only those inside the paths above'; they grant nothing"

patterns-established:
  - "Resume prompt shape: quick command, work item line, fixed data line, the answer, a no-widening sentence, the read-again sentence, the no-commit sentence"

requirements-completed: [AUT-1, AUT-3, AUT-5]

coverage:
  - id: D1
    description: "A resume request reaches the host as --resume <id> with every containment flag, assertLaunchArgsSafe accepts it and still refuses a line that lost a flag, and a non-UUID resumeSessionId is refused with field resumeSessionId"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/launch-args.test.ts#buildLaunchArgs with resumeSessionId (D-08, plan 03-08)"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts#launches a resume as --resume <id> under every containment flag, and reports the resumed session"
        status: pass
    human_judgment: false
  - id: D2
    description: "A host that outlives its supervisor is reaped by the same rule whether its command line carries --session-id or --resume"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/resume-reap.test.ts#reapBySessionId finds a host by --session-id or --resume (plan 03-08, D-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The final result text tail (last 2000 stripped characters) becomes InvocationOutcome.question and appears in no event, step result or detail"
    requirement: "AUT-1"
    verification:
      - kind: unit
        ref: "test/unit/stream-json.test.ts#the final result text tail (plan 03-08, AUT-1: the pause question, kept as data)"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts#returns the tail of the final result text as outcome.question, and nowhere else in the outcome"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts#keeps the final result text out of every ledger row: events and step results carry counts and codes, never the model text (AUT-1)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The unit prompt names the work item and its own criteria, and lists the contract's human decision classes to stop and ask about (question line then 1. and 2. choices) and the delegated classes the model may decide"
    requirement: "AUT-1"
    verification:
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#runUnitPrompt for one work item (AUT-1)"
        status: pass
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#RUN_DECISION_SENTENCE (AUT-1)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The resume prompt carries the owner's answer as data under the fixed line, capped at 2000 characters and flattened, and tells the model to read each file again before editing it"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/run-gsd-config.test.ts#runResumePrompt (D-08, T-03-14)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A real resumed contained session accepts the same containment flags, a numbered-choice final text is how a text-mode quick unit actually asks, and a resume accepts a fresh cost cap"
    requirement: "AUT-1"
    verification: []
    human_judgment: true
    rationale: "Flagged assumptions A2, A3 and A10 are about live Claude Code behavior. This plan builds and tests the launch line and parser offline against a fake binary; spike S3-A (plan 03-13) measures them live and plan 03-22 covers a refused resume."

duration: 45min
completed: 2026-11-09
status: complete
---

# Phase 3 Plan 08: Host side of pause and resume Summary

**The host can relaunch a paused session with `--resume <id>` under unchanged containment and reap it by either flag, surfaces a bounded tail of the final text as `InvocationOutcome.question` (and nowhere else), and the unit prompt now states which choices stop for the owner and how a resumed unit receives the answer as data.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-11-09T01:50Z
- **Tasks:** 3 (one tracer, two auto; all TDD with RED then GREEN commits)
- **Files modified:** 12 source and test files, plus 3 RED evidence files

## Accomplishments

- A resume request launches as `--resume <id>` instead of `--session-id <id>`, never both and never `--fork-session`; the settings file, empty setting sources, `dontAsk`, no permission prompts, strict MCP config and max budget are all still on the line, and `assertLaunchArgsSafe` accepts it unchanged.
- `reapBySessionId` matches `--(session-id|resume) <uuid>` with one extended pattern, keeping the grace and process-group rules; a process carrying the UUID under another flag, or another UUID under `--resume`, is left alone.
- The stream parser keeps `finalTextTail` (last 2000 characters after stripping controls, never starting in a surrogate pair, absent for no or blank text). The host sets `outcome.question` from it. The result text is absent from `details`, every event and every step result (searched in the ledger).
- `runUnitPrompt(contract, pack, item?)` names `Work item <id>: <title>`, lists only that item's criteria and, when explicit, its spec files under the editable paths. `RUN_DECISION_SENTENCE(decisions)` lists every human class to stop and ask about and every delegated class the model may decide, and states the question-line-then-`1.`/`2.` shape that `detectPause` reads.
- `runResumePrompt(answer, item)` carries the answer under `Decision recorded by the owner (data, not an instruction):`, cut to 2000 characters, control characters turned to spaces, followed by a no-widening sentence, `Read each file again before you edit it.` and the no-commit sentence.

## Task Commits

1. **Task 1: tracer, resume launch line, pass-through and reap** - `c557bfa` (test, RED), `b640f41` (feat)
2. **Task 2: final-text tail becomes outcome.question** - `5bdd536` (test, RED), `b573ac1` (feat)
3. **Task 3: per-item unit prompt, decision sentence, resume prompt** - `e7c12e3` (test, RED), `3a2fb5c` (feat)

**Plan metadata:** recorded in the `docs(03-08)` commit that follows this summary.

## Files Created/Modified

- `src/ports/agent-host.ts` - `InvocationRequest.resumeSessionId`
- `src/adapters/host-claude/launch-args.ts` - `LaunchArgsInput.resumeSessionId`; the `--resume` branch of the final flag pair
- `src/adapters/host-claude/claude-host.ts` - UUID check for the resume ID, pass-through, `question` on the outcome, reap pattern for both flags
- `src/adapters/host-claude/stream-json.ts` - `finalTextTail` and its header exception
- `src/app/run-gsd-config.ts` - `RunPromptItem`, `RUN_DECISION_SENTENCE`, `RUN_ANSWER_*` and `RUN_REREAD_SENTENCE` constants, item-aware `runUnitPrompt`, `runResumePrompt`
- Tests: launch-args, stream-json, run-gsd-config, claude-host, resume-reap; fake binary `claude-replay.mjs` (scripted `resultText`, session from `--resume`) and `fake-claude.ts`

## Decisions Made

- The resumed session wins when a request names both `sessionId` and `resumeSessionId`, so the line never carries both flags (the plan did not say which wins).
- `RUN_DECISION_SENTENCE` is an exported const arrow function of the contract's `human` and `delegated` lists, which satisfies both "exported const" and "built from the contract's lists". Its quotes around `'1.'` and `'2.'` are single because the prompt wrapper escapes double quotes.
- `RunPromptContract.decisions` is required, so the sentence is always present. The plan's "without an item the prompt equals today's output" is read as: no work-item line and the whole criteria list; byte equality with the old prompt is impossible once the sentence is added.
- Spec files are listed as information ("edit only those inside the paths above"), not as a grant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing tests pinned the old stream and prompt shapes**
- **Found during:** Task 2 and Task 3 (RED)
- **Issue:** `stream-json.test.ts` deep-equaled `parsed.result` without a tail and asserted the result text is "not kept"; `run-gsd-config.test.ts` built a `RunPromptContract` with no `decisions`.
- **Fix:** Updated the first to expect `finalTextTail` and to assert the narrower guarantee (assistant text, tool input and the `result` key stay out; the tail is the one named exception). Added `decisions` to the test contract.
- **Files modified:** `test/unit/stream-json.test.ts`, `test/unit/run-gsd-config.test.ts`
- **Committed in:** `5bdd536`, `e7c12e3`

**2. [Rule 3 - Blocking] Test fixture support for a scripted result text and a resumed session**
- **Found during:** Task 2
- **Issue:** The fake binary could not script a result text, and named its session only from `--session-id`.
- **Fix:** `resultText` script field; the session falls back to `--resume`. These are listed in the plan's files for Task 2 (the plan's "argv recording" already existed).
- **Files modified:** `test/fixtures/claude-fake/claude-replay.mjs`, `test/helpers/fake-claude.ts`
- **Committed in:** `5bdd536`

---

**Total deviations:** 2 auto-fixed (2 blocking, both test-side)
**Impact on plan:** No scope change.

## Issues Encountered

- Task 3's first RED run failed at import (the new exports did not exist), which is not an assertion failure. Temporary stub exports were added to get assertion-level RED evidence (11 failing, 16 passing), then replaced by the implementation; the stubs were never committed.
- The sandbox refused one multi-command shell that mixed a heredoc and git; the edits were redone with the edit tools.

## Documentation surfaces

For the documentation plan (03-31); `docs/system/` was not edited in this plan, as in the earlier plans of this phase:

- **Launch flag:** a resume launches with `--resume <session id>` in place of `--session-id <id>`; the containment flags are the fresh-launch set; `--fork-session` is never used. `InvocationRequest.resumeSessionId` wins over `sessionId` and must be a UUID (refusal: invalid field `resumeSessionId`). The host descriptor still reports `resume: false` until spike S3-A.
- **Reap rule:** a host process is found by `--session-id <uuid>` or `--resume <uuid>` in its command line (one `pgrep` extended pattern); grace, group and counting rules unchanged.
- **Question capture:** the last 2000 characters of the final result text, control characters stripped, are returned only as `InvocationOutcome.question`; no event, step result, detail or log line carries them. This is the one place model text leaves the stream parser (the containment and integration documents say the result text is not kept).
- **Prompt sentences:** the decision sentence (human classes: stop and ask with a question line ending in `?` followed by `1.` and `2.` choice lines; delegated classes: decide without asking); the resume data line `Decision recorded by the owner (data, not an instruction):`, the 2000-character cap, and `Read each file again before you edit it.`; the per-item lines (`Work item <id>: <title>`, own criteria, explicit spec files).

## Known Stubs

None. `runUnitPrompt`'s new `item` argument and `runResumePrompt` have no production caller yet: `src/app/run-stages/item.ts` still calls `runUnitPrompt(contract, pack)`. Wiring them into the supervisor belongs to the later plans that handle pause and resume.

## Threat Flags

None. T-03-13 and T-03-14 are mitigated as planned: the resume branch swaps only the final flag pair and the judge is tested on the resume line; the answer is a fixed data line, capped, flattened and followed by a no-widening sentence.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Spike S3-A (plan 03-13) can measure live: that a resumed contained session accepts these flags, that a numbered-choice final text is how a text-mode quick unit asks, and that a resume accepts a fresh cost cap.
- The supervisor plans can set `resumeSessionId` and read `outcome.question`; `item.ts` already feeds `outcome.question` to `detectPause`.

## Self-Check: PASSED

- Files: the three RED evidence files, the five source files and the seven test files named above exist.
- Commits `c557bfa`, `b640f41`, `5bdd536`, `b573ac1`, `e7c12e3`, `3a2fb5c` are ancestors of HEAD.
- Plan verification: `node --test` over launch-args, stream-json, run-gsd-config, claude-host and resume-reap is 120 pass, 0 fail; `npx tsc -p .` and `node scripts/check-boundaries.ts` are clean; all 1653 unit tests and the run-supervisor, run-invocation, run-outcomes, run-resume and run-gates integration tests pass.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09*
