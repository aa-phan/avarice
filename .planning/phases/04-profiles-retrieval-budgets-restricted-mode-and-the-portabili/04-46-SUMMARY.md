---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 46
subsystem: testing
tags: [spend-guard, live-harness, authorization, ledger, shell, node-test]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: the AC-8 evaluation harness (04-31, 04-36), the AC-14 exit tools (04-35) and the Phase 4 spend ledger (D-03)
provides:
  - "eval-retrieval.ts --authorize and --authorization: the owner's recorded spend authorization, required by --live together with AVARICE_LIVE=1"
  - "pure spend-amount functions (stepSpendUsd, runOneSpendUsd, finishedCosts) that record at least the cap when a step's cost cannot be known"
  - "exit-run-phase4.sh refuses an unknown --only id and --ruling-ref without --only (exit 2)"
  - "tool headers that state the authorization record is a procedural guard and the ledger ceiling the mechanical one"
affects: [04-50, 04-53]

actuals:
  tokens: 12400
  tasks: 3
  commits: 6
plan_head_before: 32bbf1374f4962babf7df3c234c9c87eafa49fca
plan_head_after: b5fb7bcb3a6e6b44386a88648ad611c7480df5c5

tech-stack:
  added: []
  patterns:
    - "spend amounts as pure functions of (costs or read error, exit status, cap), tested without a model"
    - "owner authorization record read by --live: list digest, task ids, arms, cap covering the projection, confirmation under 24 hours old, terminal true"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-46-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-46-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-46-red-task3.json
  modified:
    - scripts/eval-retrieval.ts
    - scripts/exit-run-phase4-tools.ts
    - scripts/exit-run-phase4.sh
    - test/unit/eval-retrieval.test.ts
    - test/unit/exit-run-phase4-tools.test.ts

key-decisions:
  - "The evaluation's authorization record is checked after the plan is built and before the ceiling: AVARICE_LIVE and the --authorization flag are checked right after option parsing, the record's content once the list digest, task ids, arms and projection are known, always before any clone, onboarding or ledger write"
  - "An empty plan (--merge with every pair recorded) needs no record: nothing can spend"
  - "run-one records max(cap, reported sum) rather than the bare cap when the spend is unknown, so a reported sum above the cap is never under-recorded"
  - "--authorize returns 3 (refusal) without a terminal and 1 on any answer but the typed word, in line with the harness's exit codes"

patterns-established:
  - "Live harness spend guards: opt-in env var, owner-recorded authorization bound to the exact run, ledger ceiling as the mechanical backstop"

requirements-completed: [FR-3, FR-22, ONB-6]

coverage:
  - id: D1
    description: "eval-retrieval --live refuses (exit 3, ledger and scratch untouched) without AVARICE_LIVE=1, without --authorization, and for a record of another list, tasks or arms, a cap under the projection, a confirmation over 24 hours old, a non-terminal or unconfirmed record"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#--live needs the owner's recorded spend authorization (plan 04-46, WR-33, T-04-125)"
        status: pass
    human_judgment: false
  - id: D2
    description: "--authorize refuses without an interactive terminal on stdin and stdout, records nothing on any answer but the typed word, and writes a record that then passes the live gate"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#--authorize records the list digest, task ids, arms, cap, time and terminal on the typed word only"
        status: pass
    human_judgment: true
    rationale: "The real interactive terminal prompt is exercised only through an injected io; the owner must run --authorize in their own terminal once before plan 04-50"
  - id: D3
    description: "spendStep and run-one record every step at no less than it may have cost: timeout, early exit, ledger read error, unreadable root, unconfirmed host, assumed costs; costChargedUsd summed where present"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#the evaluation records every model step at no less than it may have cost (plan 04-46, WR-30, T-04-126)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-run-phase4-tools.test.ts#run-one records spend at no less than the onboarding may have cost (plan 04-46, WR-31, T-04-126)"
        status: pass
    human_judgment: false
  - id: D4
    description: "exit-run-phase4.sh --run refuses an --only id off the approved list and --ruling-ref without --only (exit 2, run-one never called)"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/exit-run-phase4-tools.test.ts#the AC-14 runner refuses an unknown retry target and a ruling that names no repository (plan 04-46, WR-35, T-04-128)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both tool headers state the authorization record is a procedural guard that an agent running as the owner could write, and that the spend ledger's ceiling is the mechanical guard"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/exit-run-phase4-tools.test.ts#the headers state what the authorization record guards (plan 04-46, WR-34, T-04-127)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 46: Live harness spend guards Summary

**The evaluation's `--live` mode now needs AVARICE_LIVE=1 and the owner's recorded, current authorization, both harnesses record every uncertain step at no less than its cap, and the AC-14 runner refuses a mistyped retry.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-11-22T21:51:46Z
- **Completed:** 2026-11-22T22:02:08Z
- **Tasks:** 3
- **Files modified:** 8 (5 source and test files, 3 RED evidence records)

## Accomplishments

- WR-33 / T-04-125: `node scripts/eval-retrieval.ts --live` exits 3 before any clone, onboarding or ledger write unless AVARICE_LIVE=1 is set and `--authorization` names a record whose list digest, task ids and arms equal the run's, whose cap covers the projection and whose `ownerConfirmedAt` is at most 24 hours old (a confirmation more than five minutes ahead of the clock is refused too). `--authorize` shows the projection, asks for the typed word `authorize`, and writes the record; it refuses (exit 3) without a terminal on both stdin and stdout.
- WR-30, WR-31 / T-04-126: `stepSpendUsd` (evaluation) and `runOneSpendUsd` (AC-14) make the recorded amount a pure function. A timeout, an exit with no `invocation.finished` event, a failed ledger read, an unreadable profile root, an unconfirmed host with a non-zero exit, or assumed costs record at least the cap; `spendStep` records the cap and then rethrows a ledger read error; `finishedCosts` sums `costChargedUsd` with `costUsd` as the fallback.
- WR-35 / T-04-128: `exit-run-phase4.sh --run --only <id off the list>` exits 2 naming the id and calls run-one zero times (whole-line fixed-string match); `--ruling-ref` without `--only` exits 2 through the usage text; an empty `--only` value is a usage error.
- WR-34 / T-04-127: both tool headers state the authorization record is a procedural guard that an agent running as the owner could write, and that the Phase 4 spend ledger's ceiling is the mechanical guard.

## Task Commits

1. **Task 1 (tracer): the evaluation's live mode needs the owner's recorded authorization (WR-33)**
   - RED `7bea550` (test), GREEN `7ea998b` (feat)
2. **Task 2: both harnesses record spend conservatively (WR-30, WR-31)**
   - RED `e54ae05` (test), GREEN `cdafbee` (fix)
3. **Task 3: unknown retry target refused, headers state the guard (WR-35, WR-34)**
   - RED `a285de4` (test), GREEN `b5fb7bc` (fix)

**Plan metadata:** the docs commit that follows this summary.

## TDD Gate Compliance

Every task has a `test(04-46)` commit before its `feat`/`fix(04-46)` commit; there are no REFACTOR commits.

- **RED, task 1:** target "refuses without AVARICE_LIVE=1, even with a matching current record" failed `64 !== 3` (the script did not know `--authorization`; the AVARICE_LIVE-without-record case ran an ungated live plan to the 120 s test timeout). `check tdd-red-evidence` returned RED_EVIDENCE_OK. Semantic assessment: the child ran with the planned argv and environment and failed on the exit-status assertion for the missing gate.
- **RED, task 2:** target "records the cap for a step the timeout killed after one finished invocation" failed `[] !== [0.4]` on the recorded ledger amounts (`spendStep` was not exported and not floored at the cap). RED_EVIDENCE_OK. Semantic assessment: the temporary state.db and ledger were built as planned; the sibling cases fail on the missing `stepSpendUsd`, `runOneSpendUsd` and `finishedCosts`.
- **RED, task 3:** target "exits 2 naming an id that is not on the approved list, and calls run-one zero times" failed `0 !== 2` (the loop skipped every id and exited 0). RED_EVIDENCE_OK. Semantic assessment: the real runner ran under a stub node, the stub's log proves run-one was not called, and the positive control (`--only r2` runs run-one once) passed.

The tracer feedback gate for task 1 re-ran its verification (`node --test test/unit/eval-retrieval.test.ts` 53 of 53, `npm run typecheck`) and passed before task 2 started.

## Files Created/Modified

- `scripts/eval-retrieval.ts` - `--authorize`, `--authorization`, AVARICE_LIVE gate, `evalAuthorizationProblems`, `stepSpendUsd`, exported `spendStep`, header
- `scripts/exit-run-phase4-tools.ts` - `finishedCosts`, `runOneSpendUsd`, run-one spend recording, header
- `scripts/exit-run-phase4.sh` - `--only` and `--ruling-ref` validation, header note
- `test/unit/eval-retrieval.test.ts` - authorization gate, `--authorize` and spend-amount cases; existing live cases now carry AVARICE_LIVE=1 and a record
- `test/unit/exit-run-phase4-tools.test.ts` - run-one amount cases, runner argument cases, header cases
- `.planning/phases/04-.../04-46-red-task{1,2,3}.json` - RED evidence records

## Decisions Made

- The authorization's content is checked after the plan is built (it needs the list digest, task ids, arms and projection) and before the ceiling check; AVARICE_LIVE and the `--authorization` flag are checked immediately after option parsing. Nothing is cloned, onboarded or written before either check.
- A live `--merge` with nothing left to run needs no record, since it cannot spend.
- `run-one` records `max(cap, reported)` instead of the bare cap for an unknown spend, so a reported sum above the cap is not under-recorded.
- `--authorize` imports `authorizeRefusal` and `realAuthorizeIo` from the AC-14 tool so the refusal wording and terminal check are shared; no scripts import from `src` in the other direction.

## Deviations from Plan

None - plan executed exactly as written. The three existing `--live` unit cases (ceiling refusal, `--merge` refusal, nothing-to-run) were updated to supply AVARICE_LIVE=1 and a matching record so they still reach the refusal they assert, as the plan's behavior list requires.

**Total deviations:** 0
**Impact on plan:** none.

## Issues Encountered

- The `root-pin.sh` guard could not run as a script in this session (the sandbox refuses a script that runs git inside a shell construct). Its check was performed directly: `git rev-parse --show-toplevel` equalled the pinned root `/Users/aphan/avarice/.claude/worktrees/phase-04` before every write batch and commit.
- In the RED run of task 1 the AVARICE_LIVE-without-record case ran an ungated live plan against a nonexistent host binary until the test timeout; this only showed the missing gate and spent nothing (temporary ledger, nonexistent host).

## Documentation surfaces (for plan 04-53)

- `scripts/eval-retrieval.ts` new mode `--authorize` and flag `--authorization <file>`; refusal with exit 3 and no record unless stdin and stdout are interactive terminals; the record fields (`listSha256`, `taskIds`, `arms`, `capUsd`, `runCapUsd`, `ownerConfirmedAt`, `terminal`); `--live` exit 3 refusals (AVARICE_LIVE not 1, no `--authorization`, a record of another list, task ids or arms, a cap under the projection, older than 24 hours or ahead of the clock by over five minutes, a non-terminal or unconfirmed record); exit 1 when the owner types anything but `authorize`.
- Spend recording rules of both harnesses (cap floor for timeout, early exit, failed ledger read, unreadable root, unconfirmed host; `costChargedUsd` preferred over `costUsd`).
- `scripts/exit-run-phase4.sh`: `--only` must name an approved id (exit 2), `--ruling-ref` needs `--only` (exit 2).
- The authorization record is a procedural guard (T-04-127 accepted); the ledger ceiling is the mechanical guard.

## Command forms for plan 04-50

The owner authorizes once in their own terminal, with the same selection flags as the live run (task ids, arms and `--cap-usd` decide the digest, ids, arms and projection the record must equal):

```
node scripts/eval-retrieval.ts --authorize --authorization <record.json> [--task-ids T01,T07 | --tasks <n>] [--arms A,B,C] [--cap-usd <n>] [--merge --out <results.json>]
```

The live run, within 24 hours of that confirmation:

```
AVARICE_LIVE=1 node scripts/eval-retrieval.ts --live --authorization <record.json> --out <results.json> [same selection flags] [--merge]
```

With `--merge`, the record's task ids are those of the pairs still to run, so authorize with the same `--merge --out` flags.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None - no new network endpoint, auth path or file access beyond the authorization record file the plan's threat model (T-04-125, T-04-127) already covers.

## Next Phase Readiness

- Plan 04-50 branch (b) can run the AC-8 evaluation behind the new gate once the owner runs `--authorize`.
- No blockers.

## Self-Check: PASSED

- Created files exist: the three `04-46-red-task*.json` records and the modified scripts and tests are present.
- Commits 7bea550, 7ea998b, e54ae05, cdafbee, a285de4 and b5fb7bc are ancestors of HEAD.
- Verification: `node --test test/unit/eval-retrieval.test.ts test/unit/exit-run-phase4-tools.test.ts test/unit/live-spend-ceiling.test.ts` 138 of 138 pass; `npm run typecheck` and `npm run check:boundaries` clean; no live call made.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
