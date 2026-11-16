---
phase: 03-decisions-independent-work-and-amendments
plan: 46
subsystem: exit-benchmark
status: complete
tags: [records-sentence, verification-frontmatter, exit-finish, second-stop, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-43: the records sentence; plan 03-45: the measurement that a bare status line reads as gaps_found and the finish stage that could not record a second stop"
provides:
  - "RUN_RECORDS_SENTENCE states the fenced VERIFICATION shape, proven against the real parser and gate G2, with the parser untouched"
  - "the exit tool's --finish judges and records a run that stopped again on another decision after the owner's answer"
affects: [03-47, 03-48, 03-30, 03-31, 03-32, 03-33, phase-3-exit]

actuals:
  tokens: 40000
  tasks: 2
  commits: 4
plan_head_before: 22af6c456ca304c1ee4adac7c8dfb002642e2ddb
plan_head_after: dc24c6fe69be02d0ddedbbdd8a57b6f3eb4bb0c6

key-files:
  created:
    - test/unit/records-shape.test.ts
  modified:
    - src/domain/run-shell-rules.ts
    - test/unit/run-gsd-config.test.ts
    - docs/system/runs.md
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "Only the VERIFICATION clause of the records sentence changed (owner decision 1 of 2026-11-10). src/domain/quick-record.ts and src/domain/gates.ts are unchanged since f3ac20c (git diff empty); the parser stays fail-closed."
  - "--finish keeps exit 2 with nothing written only while a decision that paused the run at the start stage is still open. The pause decision IDs come from the start-stage record, and a finish that records a second stop stores them as pauseDecisionIds so a later finish reads the same ones."

requirements-completed: []

coverage:
  - id: D1
    description: "The records sentence names the fenced VERIFICATION opening; a record built from the sentence's own lines passes the real parser and G2, a bare first line fails closed"
    verification:
      - kind: test
        ref: "test/unit/records-shape.test.ts (4 cases) and test/unit/run-gsd-config.test.ts (shape clause, snapshot difference)"
        status: pass
    human_judgment: false
  - id: D2
    description: "--finish exits 2 with nothing written while the pause decision is open, and records a second stop with exit 1"
    verification:
      - kind: test
        ref: "test/unit/exit-evidence.test.ts: 'a second stop after the owner answered' (6 cases) and '--finish against the ledger of a run that is blocked_on_decision' (2 cases, a real S-17 ledger)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A resumed unit that follows the new sentence writes a VERIFICATION that G2 accepts"
    verification: []
    human_judgment: true
    rationale: "Whether a model follows the sentence is measured only by the exit repeat (plans 03-47, 03-48, 03-30); this plan proves the gate side offline"

duration: about 1 h
completed: 2026-11-10
---

# Phase 3 Plan 46: Fenced VERIFICATION shape and --finish recording a second stop Summary

**The unit prompt now says the VERIFICATION.md begins with exactly three lines (`---`, the status line, `---`), proven against the real parser and G2 with the parser left fail-closed, and the exit tool's --finish judges and records a run that stopped again on another decision instead of exiting 2 with nothing written.**

## The new sentence

The VERIFICATION clause of the records sentence (the rest of the sentence is unchanged):

> The VERIFICATION.md begins with exactly three lines: '---', then 'status: passed', 'status: gaps_found' or 'status: human_needed' as the verifier's findings say, then '---'. A file that does not begin that way counts as gaps_found. A task with no VERIFICATION.md fails the run's gate.

The comment above the constant records the 03-45 measurement.

## Task 1 (tracer): the records sentence

- RED (`51a6d9e`): `records-shape.test.ts` builds a record from the three lines it extracts from the sentence and reads it with `parseQuickVerification` and `evaluateG2`. Run against the old sentence, 5 target cases failed: the shape names, the passed and gaps_found records (the extraction found no clause), the shape clause and the single-item snapshot difference. The bare-line case passed already and stays as the fail-closed pin. Semantic assessment: the failures are the planned assertions (the clause and the sentence-derived record), not load or syntax faults.
- GREEN (`52f669c`): the clause reworded, `SINGLE_ITEM_PROMPT` updated on purpose. A first run after the reword showed my own extraction regex tripping on the apostrophe in "verifier's"; the regex was narrowed to the three line forms before the commit, so no committed state was red for that reason.
- Verification: records-shape, run-gsd-config, quick-record, gates and the prompt-and-policy invariant: 139 of 139 pass. `git diff f3ac20c -- src/domain/quick-record.ts src/domain/gates.ts` is empty. The snapshot differs from the old one only in the records sentence (asserted by removing the sentence from both). `docs/system/runs.md` describes the fenced block and the gaps_found reading, with no plan, file or constant name in prose.

## Task 2: --finish and a second stop

- RED (`55f5781`): six unit cases and two cases against the ledger of a real S-17 run blocked on a decision. The second-stop case exited 2 with "decision ... is still open: the owner has not answered it yet" and wrote nothing. Three pure readers were committed as scaffolds that read nothing, so the file loaded and the failures were assertions.
- GREEN (`dc24c6f`): `pauseDecisionIdsOf`, `openPauseDecisionOf` and `secondStopOf` added; `judgeFinish` names a second stop (`the run stopped again on decision <id> (<class>, origin <origin>) after the owner's answer`); the early exit checks only the pause decisions. The entry now holds `answeredDecision`, `newDecision`, `stop` and `pauseDecisionIds` beside the resume facts; the spend line is appended as for any finish.
- Verification: exit-evidence and exit-drafts: 84 of 84 pass. The ledger cases run the real `evidence --stage finish` command with `AVARICE_PHASE3_LEDGER` pointed at a temporary file: the unanswered case exits 2 with the evidence file byte-identical and no ledger file; the second-stop case exits 1, keeps the other run and the extra top-level key untouched, and writes the stop. The ledger of that test run holds no answered decision, so `answeredDecision` is null there; the answered side is proven by the unit cases on `secondStopOf` and `judgeFinish`.

Overall: `npm run typecheck` and `npm run check:boundaries` clean; `node --test test/unit/ test/integration/run-prompt-policy.test.ts`: 1973 of 1973 pass. No live model call, no spend, no portfolio or profile contact.

## Deviations from Plan

None in scope. Two notes:

- The plan's Task 1 GREEN example sentence ended the status list with "anything else counts as gaps_found" inside the same sentence; the committed text uses two sentences so the shape test can extract the clause up to its first full stop.
- `docs/system` has no document on the exit tooling, so Task 2 needed no documentation change.

## Known Stubs

None.

## Threat Flags

None. T-03-108 held (parser and gate unchanged, the fail-closed case is pinned by a test). T-03-109 held (a second stop is written by the tool itself; the early exit remains only for an unanswered pause decision).

## Documentation surfaces (for plans 03-31 to 03-33)

- `docs/system/runs.md`, "Launch." paragraph: the VERIFICATION opens with a fenced block of exactly three lines, and the prompt says anything else counts as `gaps_found`. Updated in this plan.
- `docs/system/runs.md`, the records paragraph: the `status:` line counts only inside a block fenced by `---` lines at the start of the record; a bare first line or a status line in the body reads as `gaps_found` and gate G2 fails it. Updated in this plan.
- The exit tooling (`--finish`, the evidence entry keys `answeredDecision`, `newDecision`, `stop`, `pauseDecisionIds`) is test tooling and has no `docs/system` document; the phase documentation plan decides whether it needs one.
- `docs/system/coverage.md` and `findings.md`: no count changed here; nothing added.

## Next Phase Readiness

The cause of the third attempt's G2 stop is fixed on the prompt side and the exit tool records every stop. The exit repeat (plans 03-47, 03-48, 03-30) can follow. Requirements AUT-3 and AUT-5 are not marked complete (`requirements.ready-ids` reports 0 of 2 ready).

## Self-Check: PASSED

Files exist: `test/unit/records-shape.test.ts`, `src/domain/run-shell-rules.ts`, `scripts/exit-run-phase3-tools.ts`, `docs/system/runs.md`. Commits `51a6d9e`, `52f669c`, `55f5781`, `dc24c6f` are ancestors of HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10*
