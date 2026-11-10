---
phase: 03-decisions-independent-work-and-amendments
plan: 45
subsystem: exit-benchmark
status: halted
tags: [exit-run, portfolio, d-03-stop, resume, host-config-dir, verification-frontmatter]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-43: the recorded host configuration directory; plan 03-44: the 5.27 USD authorization and the superseding evidence file"
provides:
  - "03-45-evidence-exit.json: run 1's start record and the halt block of the D-03 stop at the finish stage, with the diagnosis"
  - "proof that the resume now runs in the delegated session under the recorded directory (the 03-43 fix works)"
affects: [03-29, 03-42, 03-30, phase-3-exit]

actuals:
  tokens: 25000
  tasks: 1
  commits: 2
plan_head_before: 38bcfc03be1342c8461cedf81c44568f42b386e4
plan_head_after: ddde52dd2eb9762f9a0f9eb228c12c5c90f66c5d

key-files:
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-45-evidence-exit.json
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "The plan stops at Task 2 under D-03. Run 2 was not started, 03-29-SUMMARY.md and 03-42-SUMMARY.md are untouched (still status: halted), and nothing was answered, amended, cancelled, resumed or retried by Claude."
  - "The finish tool could not record the stop: it exits 2 whenever a decision is open, and the run holds a new open decision. The halt block in the evidence file and the 0.8064 USD ledger row were written by hand from the owner's ledger and the stored transcript."

requirements-completed: []

coverage:
  - id: D1
    description: "Run 1 starts on the real portfolio with its host configuration directory recorded and blocks only the owner-choice item on its own pause with item A committed"
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase3.sh --run test/benchmark/phase3/p3-run1-copy-fallback.md (Task 1, commit e96e2d9): problems [], stopOk true"
        status: pass
    human_judgment: false
  - id: D2
    description: "After the owner's answer, item B's own session resumes and run 1 reaches ready_for_review"
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase3.sh --finish run_01M7220WKE6WAP7N0FTPSH95RV (exit 2: a new decision is open); the run is blocked_on_decision on gate G2"
        status: fail
    human_judgment: true
    rationale: "Not achieved: the resume was the delegated session, but gate G2 failed on the resumed session's VERIFICATION.md (no frontmatter fences) and parked item B on a new decision. The owner decides how to proceed (D-03, D-05)"

duration: run 1 start 2026-11-10T06:23:43Z; owner answer 07:51:14Z; stop 07:53:18Z
completed: 2026-11-10
---

# Phase 3 Plan 45: Exit part 1, third attempt, run 1 Summary

**Run 1 stopped on item B's own pause with item A committed, and after the owner's answer the host resumed exactly the delegated session under the recorded directory, which is the fix of plan 03-43 working; but the resumed session wrote its VERIFICATION.md without frontmatter fences, gate G2 read that as gaps_found and parked B on a new decision, so the run is not ready_for_review and the plan halts under D-03.**

## Performance

- **Tasks:** 1 of 3 executed; Task 2 ran to its verification and failed; Task 3 (run 2, resume of 03-29 and 03-42) was not run.
- **Live spend in this plan:** 0.9443 USD (start 0.1379, finish 0.8064) of the 5.27 USD run cap. Phase 3 spend is now 10.1294 USD of 25 USD.
- **Host:** claude 2.1.319 at `/Users/aphan/.local/share/claude/versions/2.1.319`; `AVARICE_LIVE_ADMIT_CLAUDE_VERSION` never set; `CLAUDE_CONFIG_DIR` not set by Claude or in any owner command.
- **Recorded host configuration directory:** `/Users/aphan/.claude-edu` (source `CLAUDE_CONFIG_DIR`).

## What happened

### Task 1: the start (run `run_01M7220WKE6WAP7N0FTPSH95RV`)

The run started at 06:23 and stopped `blocked_on_decision` as expected: item A done with commit `1ed1aac4aa920eef42da0fee30e3da5c5d08b8c4` (haiku, session `9bb4e172-51c7-4906-9e3d-7a8b65e9f5ec`, one attempt; G0, G1 and G2 passed), item B blocked on one pause-origin decision `dec_01M722AMGKSDC2RPA5SZ1VE7N6` (numbered-choice, contract version 1, park attempt `att_01M722AEKVWNXPGNXZXEXVWGH3`, affected B and C), item C ready with no attempt, one notification, `hostConfigDir` recorded, checkout digest equal (`sha256:36b38e48...`), no ref added. Cost 0.1379 USD.

A's invocation was recorded with kind `denied` (18 Bash, 14 Read, 1 Grep, 1 Glob, 4 Agent, 3 Write, 4 Edit calls). The hook rows show two Bash denials by the run's shell policy, rules `shell-syntax` and `shell-not-allowed`, and the host reported zero permission denials, exit code 0, three turns. The plan does not treat a denied kind as a stop, and A's work was not affected: it committed and passed G0 to G2.

### Task 2: the owner's answer and `--finish`

The owner answered `dec_01M722AMGKSDC2RPA5SZ1VE7N6` at 07:51:14Z from their own terminal: option `2` (`Couldn’t copy the address. Opening your mail app to <address>.`), answered by `owner:aphan`, channel `terminal`. The supervisor the command started took item B up.

What held (the 03-43 fix):

| Check | Result |
| ----- | ------ |
| Resume attempt | `att_01M72715PHHMNVN22VQCWJ1PN8`, ordinal 3, reason `resume`, item B |
| Session requested and kept | `4006c6cb-a791-4b83-a8a3-5bfb2a1ab6e8`, equal to the session recorded when B was delegated; B's session is unchanged after the attempt |
| Host init events | five, all reporting `4006c6cb-a791-4b83-a8a3-5bfb2a1ab6e8`; the result event reports the same session |
| Fresh `answer` attempt for B | none |
| Cost | 0.8064 USD (121.7 s, 3 turns, 4 subagents) |
| Checkout | portfolio HEAD `9f63d9114c5d` unchanged, run branch not handed off |

What failed: the resumed session finished the quick workflow (copyFallback added to `src/lib/copy.ts`, the test `copyFallback names the address` added, 7 of 7 passing, typecheck and lint clean, `format:check` failing only on the untouched `index.html`) and wrote `.planning/quick/20261110-copy-fallback-names-address/VERIFICATION.md`. G1 passed for B. G2 failed: `GSD VERIFICATION status is gaps_found, not passed`. The supervisor parked B on a new decision `dec_01M7274XVDJAH8MC3XZ6M89DR4` (class acceptance, free-text answer, affected B and C), and the run is `blocked_on_decision` again with a second notification (two in all; the expected block yields one). Item C never ran.

`--finish` exited 2 without recording anything: the tool reads any open decision as "the owner has not answered yet".

## Diagnosis (D-03)

**The cause is the form of the VERIFICATION.md the resumed session wrote, not the resume.** Its Write began with the bare line `status: passed` and no `---` lines around it, and its text reports every check green. The gate parser (`readFrontmatter` in `src/domain/quick-record.ts`) reads only a `---` block, finds no status key and fails closed to `gaps_found`. The model-facing rule (`src/domain/run-shell-rules.ts`) says the file "starts with a frontmatter line 'status: passed'", which does not say that the line sits between `---` lines. Item A, in the same run under the same rule text, wrote the fences and passed G2, so the wording is ambiguous rather than always misread.

This is the failure class of plan 03-42's second stop (a VERIFICATION problem at G2) in a different form: there the file was missing after a fresh fallback, here it is present and correct in content but not in shape.

Open points for the owner or a fix plan, none attempted here:

1. Make the rule text unambiguous (state the `---` lines and show the file head), or make the parser accept a bare leading `status:` line. Either is a product change; the parser option loosens a fail-closed read, so the wording fix is the smaller one.
2. The finish tool cannot record a run that stopped on a second decision after the owner's answer; it should judge that stop instead of exiting 2, so the evidence file records it without hand edits.
3. D-03 counts this attempt from run 1; the owner's decision 2 of 2026-11-10 left no ceiling room for another repeat. Phase 3 is at 10.1294 of 25 USD.

## State left behind

- Run 1 (`run_01M7220WKE6WAP7N0FTPSH95RV`) is `blocked_on_decision` with the first decision answered and one open decision `dec_01M7274XVDJAH8MC3XZ6M89DR4`. Nobody answered it. The owner may cancel the run with `avarice cancel`; its branch was never fetched. The run holds 5.27 − 0.9443 USD of unused cap.
- Run 2 was not started. 03-29-SUMMARY.md and 03-42-SUMMARY.md are unchanged and still `status: halted`, so plan 03-30 stays blocked.
- The evidence file has run 1's start record plus a top-level `halt` block (the answer, the resume proof, the G2 stop, the cause, the spend). The ledger has the `-finish` row.

## Deviations from Plan

None in code. One note on process: the `halt` block and the `-finish` ledger row were written by hand because `--finish` refuses a run with an open decision; both come from the owner's ledger (`state.db` read only), the stored transcript `sha256:4074db99...` and the supervisor's events.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None. T-03-104 held (portfolio HEAD unchanged, run branch not handed off, no ref added). T-03-105 held (run total 0.9443 USD under the 5.27 USD cap; the guard ran before the start). T-03-106 held (the owner answered in their own terminal; Claude ran only `--run` and the refused `--finish`; the resume was the delegated session with no fresh attempt). T-03-107 held (03-29 and 03-42 untouched).

## Next Phase Readiness

Blocked. Run 1 did not reach ready_for_review, so 03-29 and 03-42 stay halted and plan 03-30 stays blocked. The owner decides whether to answer or cancel run 1's open decision, fix the VERIFICATION wording, and use the remaining Phase 3 headroom (14.87 USD).

## Self-Check: PASSED

Files exist: `.planning/phases/03-decisions-independent-work-and-amendments/03-45-evidence-exit.json`, `test/containment/live-spend-phase3.jsonl`. Commits `e96e2d9` and `ddde52d` are ancestors of HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10 (halted at Task 2)*
