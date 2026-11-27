---
phase: 03-decisions-independent-work-and-amendments
review: 03-REVIEW.md
review_status: issues_found
findings: 13
open: 13
recorded: 2026-11-15
---

# Phase 3 code review disposition

One row per finding in 03-REVIEW.md. Every finding starts `open`, the default. The owner moves a row to `fixed`, `deferred` or `rejected`, with a reason. The review is advisory and blocks nothing.

| ID | Severity | Location | Finding | Disposition |
|----|----------|----------|---------|-------------|
| WR-01 | warning | src/adapters/proc/ancestry.ts:23,72 | The supervisor signature matches any text in a process command line, so an owner answer that contains `supervise run_<id>` is refused as coming from inside a run | open |
| WR-02 | warning | src/cli/identity.ts, src/adapters/proc/ancestry.ts | The owner-identity check rests on the ancestor chain, `AVARICE_RUN` and a TTY. A re-parented run descendant could pass it (not proven) | open |
| WR-03 | warning | src/app/run-stages/item.ts:1339-1341, src/app/run-stages/repair.ts:239-240 | Retry and repair counts restart only after an attempt with reason `answer`. The usual answer path records `resume`, so an answered `repeated_failure` gets no repair | open |
| WR-04 | warning | src/app/run-stages/blocked.ts:287-318 | `completeItemBlock` reuses a decision only while it is open. A supervisor that dies between opening the decision and blocking the item, with the owner answering in between, leads to a duplicate decision | open |
| WR-05 | warning | src/hook/hook-decision.ts:138-145 | A relative Glob pattern with `..` segments, or a brace pattern with an absolute alternative, gets no pattern-root check | open |
| WR-06 | warning | src/adapters/sqlite/ledger.ts:1008, src/app/run-stages/item.ts:187-200 | The unit is shown the `amended:vN` sentinel as "the owner's answer" | open |
| WR-07 | warning | src/app/run-stages/item.ts:947-996 | A resumed attempt unparks the delta before the invocation budget is granted, so a budget refusal leaves the delta applied in the clone | open |
| IN-01 | info | src/app/run-stages/item.ts | Unused import `ReproducerSet` and unused `contract` variable | open |
| IN-02 | info | src/adapters/sqlite/ledger.ts:127 | Missing space in `=[` | open |
| IN-03 | info | acceptance-file open | A FIFO could block the open | open |
| IN-04 | info | CLI commands | Run and decision ID patterns differ between commands | open |
| IN-05 | info | CLI argument parsing | An answer value that starts with `--` is read as a flag | open |
| IN-06 | info | src/adapters/sqlite/ledger.ts, `amendRunContract` | The body's `contractVersion` is not cross-checked against the version written | open |
