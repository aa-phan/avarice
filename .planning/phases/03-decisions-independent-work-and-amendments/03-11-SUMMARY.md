---
phase: 03-decisions-independent-work-and-amendments
plan: 11
subsystem: test-infrastructure
tags: [fake-run-host, per-item, resume, missing-session, subagents, items-brief, offline-tests]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "InvocationRequest.resumeSessionId and the `Work item <ID>:` line of runUnitPrompt and runResumePrompt (plan 03-08); the brief `items:` syntax (plan 03-03)"
provides:
  - "FakeRunOptions.perItem, .resume, .missingSession, .subagents, .planText and selectFakeOptions(base, request, perItemCallIndex)"
  - "FakeRunHost records sessionId and resumeSessionId beside the prompt, and reports the session it ran under"
  - "ITEMS_BRIEF, ITEMS_BRIEF_ITEMS, ITEMS_BRIEF_ACCEPTANCE, itemsBriefText and writeItemsBrief in the run fixtures"
affects: [03-14 to 03-26 offline integration tests of several items, pauses, resumes, G1 and CON-15]

actuals:
  tokens: 8500
  tasks: 2
  commits: 3

plan_head_before: 8a27c7be4783a5cf1c7c146126cafdec009deffe
plan_head_after: af16bf5994f1ecc24748547654cc0a2f5ad93546

tech-stack:
  added: []
  patterns:
    - "One fake host script selects its behaviour from the prompt: item line for per-item options, resumeSessionId for resume options, fresh-call counter per item for perAttempt"
    - "Selecting keys (perItem, resume, perAttempt) are stripped from every merged layer, so the options a unit plays are flat data"
    - "Test options stay JSON-serializable because they travel to the supervisor as AVARICE_FAKE_HOST"

key-files:
  created:
    - test/unit/fake-run-host.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-11-red-evidence-task1.json
  modified:
    - test/helpers/fake-run-host.ts
    - test/helpers/run-fixtures.ts

key-decisions:
  - "The item line is matched as a line start or the start of the quoted task text, so a `Work item Z:` phrase inside a brief title never selects an item"
  - "perAttempt counts fresh calls per item (a resumed call is not counted), so the fresh-unit fallback after a missing session is that item's next attempt"
  - "A resumed call plays base + perItem.<ID>.resume, falling back to base resume; it never replays the item options that paused it"
  - "missingSession affects only a resumed call, so it sits in a resume entry and a fresh call of the same host ignores it"
  - "The fake outcome's sessionId is resumeSessionId, else the request's sessionId, else fake-run-session-N: the same precedence as the real adapter"

requirements-completed: [AUT-3, AUT-5, CON-15]

coverage:
  - id: D1
    description: "One fake host script selects per-item options from the `Work item <ID>:` line and resume options when the request carries resumeSessionId; a prompt with no item line plays Phase 2's base + perAttempt unchanged"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/fake-run-host.test.ts#selectFakeOptions: one host script, several items (plan 03-11)"
        status: pass
      - kind: integration
        ref: "test/integration/run-outcomes.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/run-supervisor.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "A resumed invocation records its prompt, resumeSessionId and the session it ran under, per item through the item's own recordTo, so a test can assert the answer reached the right session"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/fake-run-host.test.ts#FakeRunHost records a resumed invocation (D-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "missingSession ends a resumed call as the real CLI ends for an unknown session (exit 1, no result event, kind failed, nothing written)"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/fake-run-host.test.ts#FakeRunHost: a missing session (D-08)"
        status: pass
    human_judgment: false
  - id: D4
    description: "subagents: n makes n Agent calls through the real hook, each charged to subagentsTotal; planText leaves the quick PLAN.md byte for byte (archived as a quick record)"
    requirement: "CON-15"
    verification:
      - kind: unit
        ref: "test/unit/fake-run-host.test.ts#subagents and planText through the real hook (G1, CON-15)"
        status: pass
    human_judgment: false
  - id: D5
    description: "ITEMS_BRIEF (A and B independent, C depends on B, one check:test criterion each, write set src and test) and writeItemsBrief write the items JSON in the syntax parseBrief reads, and the text parses back to the same items"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/fake-run-host.test.ts#the items brief fixture"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-09
status: complete
---

# Phase 3 Plan 11: Fake run host for items, pauses and resumes Summary

**The fake run host now plays one script for several work items: it selects options from the `Work item <ID>:` line, plays resume options for a call that carries `resumeSessionId`, ends a resumed call as an unknown session when asked, makes real-hook Agent calls and leaves a given quick PLAN.md, and the fixtures write a brief with items in the syntax plan 03-03 parses.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-11-09T03:20Z
- **Tasks:** 2 (one tracer with RED then GREEN commits, one auto)
- **Commits:** 3 (RED test, tracer GREEN, Task 2)
- **Files:** 2 helpers modified, 1 unit test and 1 RED evidence file created

## Accomplishments

- `selectFakeOptions(base, request, perItemCallIndex)` merges base, then `perItem.<ID>`, then `perItem.<ID>.perAttempt[n]` for a fresh call, and base then `perItem.<ID>.resume` (else `resume`) for a resumed one. The result carries none of the selecting keys. A prompt with no item line plays base + `perAttempt[n]` exactly as Phase 2 did.
- `FakeRunHost.invoke` counts fresh calls per item, selects through `selectFakeOptions` at its top, and reports the session it ran under: `resumeSessionId`, else the request's `sessionId`, else `fake-run-session-N`. The `recordTo` file now also holds `sessionId` and `resumeSessionId`. An item's own `recordTo` (in its `perItem` or `resume` entry) gives one record file per item.
- `missingSession` makes a resumed call return before it touches the clone: kind `failed`, exit 1, `resultSeen: false`, no edits, HEAD unchanged.
- `subagents: n` makes n `Agent` calls through the real hook before the edits, each with a `tool_use_id` and a PostToolUse (so each is charged to `subagentsTotal` and none holds a slot), and reports the admitted count as `details.subagentsSpawned`. `callHook` takes the top-level hook fields for this.
- `planText` writes the quick `PLAN.md` through the hook's Write path, also when the unit writes no SUMMARY (a unit that planned and then stopped to ask).
- `ITEMS_BRIEF`, `itemsBriefText` and `writeItemsBrief(dir, items, acceptance, extra?)` render the `items:` JSON across continuation lines indented by two spaces; `ITEMS_BRIEF_ITEMS` and `ITEMS_BRIEF_ACCEPTANCE` are exported for tests that change one item.
- `test/unit/fake-run-host.test.ts` has 19 tests: nine on pure selection, four on the record (including the per-item `recordTo`, and fresh-call counting per item), two on `missingSession`, one on JSON round trip of the new options, two on the items brief, and one in-process run that proves the hook charged two Agent calls to `subagentsTotal` and the unit's plan text was archived byte for byte.

## Task Commits

1. Task 1 RED: `a85da80` test(03-11): add failing tests for per-item selection and a recorded resumed invocation
2. Task 1 GREEN: `a798ccf` feat(03-11): select fake run host options per work item and for a resumed session
3. Task 2: `af16bf5` feat(03-11): fake host missing session, subagent calls and a written plan, and the items brief fixture

## RED evidence

`03-11-red-evidence-task1.json` (command, exit 1, full TAP output, target test, expected, actual, semantic assessment) classifies as `RED_EVIDENCE_OK` (`target_test_failed`). All 13 tests failed on assertions: `fake.selectFakeOptions is not a function` for the nine selection tests, and missing `sessionId`, `resumeSessionId` or per-item record for the four host tests. The test imports the host module as a namespace so the file loaded and no failure was a load fault.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The fake outcome names the session the way the real adapter does**
- **Found during:** Task 1
- **Issue:** The plan asks the record to hold "the session it ran under", and a test must assert the owner's answer reached the right session. The fake's outcome always reported `fake-run-session-N`, so a resumed outcome could not name the resumed session, and a supervisor that stores the outcome's session ID would resume the wrong name.
- **Fix:** The session is `resumeSessionId ?? sessionId ?? fake-run-session-N` (the real adapter's precedence), used for the record and for both outcome returns. No test depended on the old `fake-run-session-N` text.
- **Files modified:** test/helpers/fake-run-host.ts
- **Verification:** run-outcomes, run-supervisor, run-resume, run-status and check-validation suites pass (92 tests)
- **Commit:** a798ccf

**2. [Rule 3 - Blocking] The RED record needed the full classifier fields**
- **Found during:** Task 1
- **Issue:** The simple `{command, exitCode, output}` record is classified `INVALID_RED (invalid_record)` by the current classifier.
- **Fix:** The record also carries targetTest, targetFile, expected, actual and semanticAssessment.
- **Commit:** a85da80

**3. [Scope note] One test in the unit file runs a real in-process run**
- The plan's unit test list names cases that need no supervisor. `subagents` is charged by the real hook against a ledger, so one test uses `runInProcess` (about 6 s) to prove it. It is the only way to test the hook path offline before plans 03-14 onward.

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking), 1 scope note. **Impact:** none on the plan's contracts; the fake's session naming now matches production.

## Documentation

No `docs/system/` change: this plan changes only test helpers and a unit test, no built behavior, command, flag, config key, table, event or exit code. The documentation plan of the phase covers the fake host's role if it needs one.

## Known Stubs

None.

## Threat Flags

None. The fake host and its environment seam stay under `test/`; production composition does not import them (T-03-18, accepted, boundaries and footprint suites pass). No packages installed (T-03-SC).

## Self-Check: PASSED

- test/helpers/fake-run-host.ts, test/helpers/run-fixtures.ts, test/unit/fake-run-host.test.ts and 03-11-red-evidence-task1.json exist
- Commits a85da80, a798ccf and af16bf5 are on the branch
- `node --test test/unit/fake-run-host.test.ts test/integration/run-outcomes.test.ts test/integration/run-supervisor.test.ts test/unit/boundaries.test.ts test/unit/footprint.test.ts`: 80 pass, 0 fail; `npx tsc -p .` prints no errors
- Acceptance greps: `missingSession|subagents?:|planText` prints 6 lines in the fake host; `export function writeItemsBrief` prints one line in the run fixtures
