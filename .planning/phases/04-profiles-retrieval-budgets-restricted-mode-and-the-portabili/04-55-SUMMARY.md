---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 55
subsystem: security
tags: [retrieval, whole-file-reads, budgets, hook, fail-closed, wr-11, con-10, con-11]
requires:
  - phase: 04-49
    provides: the Grep and Glob normalization in hook-decision.ts that this plan extends for Read
  - phase: 04-51
    provides: the attended-hook changes to pre-tool-use.ts that this plan builds on
provides:
  - "every allowed Read of a run with a retrieval block charges retrieval.fullReads (one file) and retrieval.fullReadBytes (the bytes of the lines it asks for) in the transaction that charges toolCalls"
  - "FULL_READS_SPENT_RULE (budget:retrieval.fullReads) and FULL_READ_BYTES_SPENT_RULE (budget:retrieval.fullReadBytes), with reasons that tell the run to work from what it read or read fewer lines"
  - "Read offset and limit carried on the normalized call when each is a positive whole number"
  - "chargeRows with an amount per row, all rows checked in order before any is charged"
affects: [04-52, 04-53, 04-54]
actuals:
  tokens: 9000
  tasks: 2
  commits: 4
plan_head_before: 03a8f1732e03e3b5a117eb031cf03a24820247cc
plan_head_after: cefb2e2eff4432df8785f3296d3ad5d488a32055
tech-stack:
  added: []
  patterns:
    - "a cap the contract states is charged by the thing that enforces it, in the same transaction as the call, so a row that exists is a row that is spent"
    - "a measurement the hook makes before the ledger opens is bounded (stop past the cap, give up after 64 MiB) so it cannot stall the hook"
key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-55-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-55-red-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/hook/pre-tool-use.ts
    - src/app/retrieval-guard.ts
    - test/integration/hook-retrieval.test.ts
    - test/unit/hook-decision.test.ts
key-decisions:
  - "WR-11 is fixed here at D-09's start values (20 files, 256 KiB per run); RETRIEVAL_CAPS is unchanged (git diff against 792536d is empty)"
  - "The hook charges the caps; beginRead keeps its tests and gets no caller, and the guard's header now names the hook as what charges a run's Read calls"
  - "A Read is charged the bytes of the lines it asks for (offset for limit lines, default the first 2000), never more than the file holds; a path that is not a regular file is one file and 0 bytes"
  - "Rows are checked in the order toolCalls, retrieval.fullReads, retrieval.fullReadBytes, so a denial names the first without room"
requirements-completed: [CON-10, CON-11]
coverage:
  - id: D1
    description: "In a run whose hook policy has a retrieval block, twenty Reads of a 10-byte file are allowed and the 21st is denied with budget:retrieval.fullReads; the rows end at fullReads 20, fullReadBytes 200 and toolCalls 20, and the allowed Read's decision event names toolCalls with alsoCharged fullReads and fullReadBytes"
    requirement: CON-11
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#tracer: a run Read is charged to the whole-file rows and the 21st is refused (WR-11, CON-10, CON-11, D-09)"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#a file read under a run retrieval policy charges the whole-file rows (WR-11, CON-10, CON-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Reads totalling exactly 262144 bytes are allowed and the next Read of a 1-byte file is denied with budget:retrieval.fullReadBytes with the row unchanged; in a fresh run a Read of 262145 bytes is denied and one of 262144 allowed; a refused Read charges nothing"
    requirement: CON-10
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#the byte cap at and one past its limit (WR-11, D-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "offset 11 and limit 5 of 100 lines of 10 bytes charges 50 bytes; neither offset nor limit charges the first 2000 lines of a 3000-line file; a missing path, a directory and a 0-byte file are one file and 0 bytes; an offset or limit that is not a positive whole number is ignored; a range not resolved within 64 MiB of scanning is refused"
    requirement: CON-10
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#a Read is charged the bytes of the lines it asks for (WR-11)"
        status: pass
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#a Read of a path with no bytes to count (WR-11 empty edge)"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#keeps an offset and a limit that are positive whole numbers on the normalized Read and drops any other value"
        status: pass
    human_judgment: false
  - id: D4
    description: "A policy with a retrieval block whose ledger lacks retrieval.fullReads, or lacks retrieval.fullReadBytes, exits 2 and charges nothing; a policy without a retrieval block charges neither row; a file that cannot be opened to be measured exits 2"
    requirement: CON-11
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#the ledger must hold the whole-file rows of a run with retrieval limits (WR-11, fail closed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Six hook processes reading at once against retrieval.fullReads 10 are allowed exactly 10 reads over 10 iterations; the row's used equals the reads allowed, the byte row equals ten bytes per read, and a refused Read charges no tool call"
    requirement: CON-11
    verification:
      - kind: integration
        ref: "test/integration/hook-retrieval.test.ts#parallel subagents share one exact counter (S-16, CS-16, T-04-80)"
        status: pass
    human_judgment: false
duration: 9min
completed: 2026-11-22
status: complete
---

# Phase 4 Plan 55: A run's Reads are bounded by the whole-file caps its contract states Summary

**The hook now charges every Read of a run to `retrieval.fullReads` (one file) and `retrieval.fullReadBytes` (the bytes of the lines it asks for) in the transaction that charges `toolCalls`, so the 21st file and the byte one past 262144 are refused and the two rows, which were created and never spent, bound what a run reads (WR-11).**

## Performance

- **Duration:** about 9 min from the recorded start (recorded after the first reads)
- **Started:** 2026-11-22T23:03:38Z
- **Completed:** 2026-11-22T23:13Z
- **Tasks:** 2 (one tracer, one auto), each with a committed failing test first
- **Files:** 5 changed in the task commits (3 source, 2 test), plus 2 RED records

## Accomplishments

- **Tracer.** `decideToolCall` returns `alsoCharges: ['retrieval.fullReads', 'retrieval.fullReadBytes']` for a file-read when the policy has a retrieval block, and nothing otherwise. `chargeRows` takes an amount per row (one by default), checks `used + reserved + amount <= limit_value` for every row in the order given before it charges any, and still throws for a missing row. `spentDecision` maps the two rows to `budget:retrieval.fullReads` and `budget:retrieval.fullReadBytes`. Through the hook entry, twenty Reads of a 10-byte file are allowed, the 21st is denied, and the rows end at 20, 200 and 20 tool calls. The tracer feedback gate ran in the default mode: the `<verify>` (both test files and typecheck) passed end to end, so the plan expanded.
- **Line-range measurement.** `measureRead` runs before the ledger opens, as the edit state does. It resolves the canonical path; a path that cannot be resolved, is missing, is not a regular file or is empty is 0 bytes. Otherwise it reads the file in 64 KiB chunks and counts the bytes of the lines from `offset` (default 1) for `limit` lines (default `HOST_READ_DEFAULT_LINES`, 2000), the newline of each included. It stops at the end of the range or the file, returns the cap plus one as soon as the count passes `RETRIEVAL_CAPS.fullReadBytes`, and returns the cap plus one after `MAX_READ_SCAN_BYTES` (64 MiB) scanned without resolving the range, so an offset deep into a large file is refused rather than stalling the hook (T-04-144). Any other error while measuring a regular file (an unreadable one) exits 2. `normalizeToolCall` carries `offset` and `limit` only when each is a positive whole number.
- **Header.** `src/app/retrieval-guard.ts` now says the hook charges a run's Read calls; `beginRead` and its tests are unchanged.
- **Caps unchanged.** `git diff 792536d..HEAD -- src/domain/retrieval-rules.ts` is empty; the byte-cap tests pin 262144 and 262145.

## TDD record

| Task | RED commit | RED evidence (`RED_EVIDENCE_OK`) | GREEN commit |
|---|---|---|---|
| 1 | `9eace81` | `04-55-red-task1.json`: the 21st Read of a run was allowed because the hook charged `toolCalls` only; the allowed event had no `alsoCharged`; the unit case had no `alsoCharges` | `a65c2c7` |
| 2 | `99f5e2a` | `04-55-red-task2.json`: the target (offset 11, limit 5 of 100 lines of 10 bytes) was charged the whole 1000 bytes instead of 50; the default-range, range-past-end and 64 MiB cases, the unreadable-file case and the unit normalization case failed with it | `cefb2e2` |

No REFACTOR commits. Each record's `semanticAssessment` states that the target ran through the real hook entry and failed on its own assertion for the planned reason, not on a load, syntax or fixture fault. The record's command covers both test files (the targets are in the integration file); the failing counts were exactly the new cases (3 and 6). In task 2 the at-limit byte cases, the missing-row cases, the empty-edge cases and the race case passed on first run, because the tracer's whole-file size measure already satisfies them; they are pinned regression cases and the RED targets are the line-range cases.

## Verification

- Plan verification, `node --test` on `hook-retrieval`, `hook-decision`, `hook`, `hook-read-digest`, `run-loops`, `retrieval-caps` and `retrieval-race`: 314 of 314 pass. Also `hook-privileged`, `fail-closed`, `eval-retrieval` and `retrieval-rules`: 174 of 174 pass.
- `npm run typecheck` clean; `npm run check:boundaries` ok (132 files). The full suite was not run (over an hour here), as instructed.
- Acceptance greps: `FULL_READS_SPENT_RULE` 2 matches in the hook; `HOST_READ_DEFAULT_LINES` 3 and `MAX_READ_SCAN_BYTES` 3; `git diff --quiet 792536d..HEAD -- src/domain/retrieval-rules.ts` exits 0; both RED records have exit code 1 and classify as `RED_EVIDENCE_OK`; at-limit and one-past cases exist for both rows (20 and 21 reads; 262144 and 262145 bytes).

## Deviations from Plan

None - plan executed exactly as written.

## Documentation surfaces (for plan 04-53)

- **How a run's Read is counted.** Every Read the hook allows in a run whose hook policy has a retrieval block charges, in the transaction that charges `toolCalls`: one unit of `retrieval.fullReads`, and the bytes it can return to `retrieval.fullReadBytes`. A Read counts as one whole-file read whatever range it asks for. Its bytes are those of the lines it asks for: from `offset` (default the first line) for `limit` lines (default 2000, the host Read tool's default), the newline of each included, never more than the file holds. An `offset` or `limit` that is not a positive whole number is ignored. Lines the host truncates for display are counted in full. A path that is missing, a directory or an empty file is one file and 0 bytes. The measure stops once the count passes the byte cap and refuses a range it cannot resolve within 64 MiB of scanning; a regular file that cannot be opened to be measured exits 2.
- **The two rules and their reasons.** `budget:retrieval.fullReads`: "the run has read all the whole files its contract allows; work from what was read or report what is missing". `budget:retrieval.fullReadBytes`: "this read would pass the bytes of whole-file reads the contract allows; read fewer lines with offset and limit, or report what is missing". Rows are checked in the order `toolCalls`, `retrieval.fullReads`, `retrieval.fullReadBytes`; the denial names the first without room (`budget_exhausted` for `toolCalls`). At the D-09 values the 20th Read is allowed and the 21st denied; Reads totalling 262144 bytes are allowed and the next of a non-empty file denied; a single Read of 262145 bytes is denied whatever is left.
- **A refused Read charges nothing.** `toolCalls`, `retrieval.fullReads` and `retrieval.fullReadBytes` keep their values (all rows are checked before any is charged, inside the ledger's write lock). Nothing is refunded afterwards.
- **Who is not charged.** Onboarding invocations, and runs on a contract compiled before the retrieval caps existed, have no retrieval block in their hook policy and are charged for neither row, as for searches. Only the run purpose is charged.
- **Fail closed.** A policy with a retrieval block whose ledger lacks `retrieval.fullReads` or `retrieval.fullReadBytes` exits 2 (stderr `the ledger has no <row> budget for run <id>`), as for `retrieval.searches`.
- **The retrieval rows are now spent.** The contract, the budget rows, `doctor` and the guard header present `retrieval.fullReads` and `retrieval.fullReadBytes` as per-run caps; the hook now charges them, so the rows that were created and never spent bound what a run reads. The cap values are unchanged (D-09: tune only on evaluation evidence). `beginRead` in the retrieval guard is still unused outside tests; no AVARICE code reads whole files for a run.
- **Accepted limit (T-04-145).** A file that grows between the hook's measurement and the host's read is charged its size at decision time.
- **Line for plan 04-54.** `docs/system/findings.md:283` (`src/app/retrieval-guard.ts:88`, `beginRead` has no caller and the hook charges a Read to `toolCalls` only) can close on commits `a65c2c7` and `cefb2e2`: the hook charges both rows, and the guard header was corrected.
- **Commits to cite (plan 04-52).** `a65c2c7` (charge and the two rules), `cefb2e2` (line-range measurement, scan bound, normalization, guard header), all naming WR-11.
- **docs/system.** Not edited by this plan, as with plans 04-40, 04-48 and 04-51: the phase's documentation plan (04-53) writes the matching `docs/system/` content from the code and the surfaces above.

## Known Stubs

None.

## Threat Flags

None. T-04-143 and T-04-144 are mitigated and tested; T-04-145 is accepted as planned. No new endpoint, auth path or schema.

## Issues Encountered

None. The sandbox refused compound shell commands that name git or run `sed -i` in place; the edits were made with the file tools and small scripts kept outside the repository.

## Self-Check: PASSED

- `src/domain/hook-decision.ts`, `src/hook/pre-tool-use.ts`, `src/app/retrieval-guard.ts`, `test/integration/hook-retrieval.test.ts`, `test/unit/hook-decision.test.ts`, `04-55-red-task1.json` and `04-55-red-task2.json` exist.
- Commits `9eace81`, `a65c2c7`, `99f5e2a` and `cefb2e2` are ancestors of HEAD; the plan has 4 task commits measured from the ledger (`03a8f17..cefb2e2`).
