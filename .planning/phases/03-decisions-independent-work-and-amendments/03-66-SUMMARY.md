---
phase: 03-decisions-independent-work-and-amendments
plan: 66
subsystem: exit-tools-stop-loss
tags: [stop-loss, reset, epoch, owner-confirmation, offline, no-spend, d-29, d-36, d-37, d-38, d-39, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-53's classify propose/confirm pattern and stop-loss, plan 03-65's parity report, the offline scenarios R (03-61) and E (03-64), and D-36 to D-39 of 03-CONTEXT.md
provides:
  - "stopLossEpochOf(evidence, role): the per-run stop-loss epoch, begun only by a valid owner-confirmed reset in the evidence file's `resets` list"
  - "startRefusal counts a run's failed attempts from that epoch; the new exit-75 text names the reset"
  - "judgeResetProposal(input) and ResetProposalInput: D-37's three proofs judged before a proposal is written"
  - "`reset --propose --by claude` and `reset --confirm --by owner` in scripts/exit-run-phase3-tools.ts"
affects: [03-67, 03-68, 03-31, 03-32, 03-33]

actuals:
  tokens: 15200
  tasks: 3
  commits: 6
plan_head_before: ca8ed8ddfd6ff8d864c2cf0bcc3c697ad2e61d81
plan_head_after: 6fc46e0e0647216dde0c0ac33e3ef97bd38cd6f4

tech-stack:
  added: []
  patterns: ["a propose/confirm pair for a gate the owner alone lifts (classify, now reset), the proof files hashed at the proposal and again at the confirmation", "two epochs kept apart by name: the pass-validity epoch (epochOf, D-26) and the per-run stop-loss epoch (stopLossEpochOf, D-36)"]

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-66-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-66-red-task2.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "A reset is a top-level `resets` list in the evidence file, not a field of one entry, because one reset covers several attempts; every writer keeps unknown top-level keys and the invariant cases pin it"
  - "The stop-loss epoch is per run and separate from D-26's epoch: it bounds only the two-failure count, and a reset changes neither epochOf nor exitVerdict"
  - "`reset --confirm` acts on the run's latest reset only when that has no `confirmed` record, so an older unconfirmed proposal can never be confirmed behind a later confirmed one"
  - "Only a product defect resets: the run's latest failed attempt in its epoch must carry the owner's confirmed product-defect class, and a red proof cited by an earlier confirmed reset is refused, so a repeat of the same failure still counts"

requirements-completed: [AUT-1, AUT-3, AUT-12]

coverage:
  - id: D1
    description: "startRefusal counts a run's failed attempts only from its latest valid owner-confirmed reset: refused with the unchanged D-29 text without a reset, admitted after a reset, refused on the second failure in the new epoch with the per-epoch text, the boundary at the reset time, per run, latest reset wins, hand-edited resets count as none"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: the stop-loss counts within the run's epoch, and an owner-confirmed reset begins a new one (plan 03-66; D-29, D-36 to D-39)"
        status: pass
    human_judgment: false
  - id: D2
    description: "authorize exits 75 for a run with two failed attempts, still after `reset --propose`, and no longer after `reset --confirm --by owner`: the next rule (the D-34 ledger read) answers with exit 2"
    requirement: AUT-12
    verification:
      - kind: integration
        ref: "test/unit/exit-evidence.test.ts#exits 75 for two failed attempts, still after the proposal, and no longer after the owner confirms it: the next rule answers"
        status: pass
    human_judgment: false
  - id: D3
    description: "A reset is proposed only with D-37's offline proofs and refused (exit 2, evidence file byte-identical) for each missing or failed proof, a latest failed attempt that is not an owner-confirmed product defect, a red proof an earlier reset cites, or an open attempt; the confirmation refuses any --by but owner, an empty --ref, no pending proposal and a proof file changed since the proposal"
    requirement: AUT-1
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: a reset is proposed only with D-37's three proofs, after a product-defect ruling, and never twice on one reproduction (plan 03-66; D-36, D-37)"
        status: pass
      - kind: integration
        ref: "test/unit/exit-evidence.test.ts#refuses, exit 2 and the evidence file byte-identical (D-27, D-36, D-37)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A reset changes neither epochOf nor exitVerdict, and evidenceFileBody, withClassification, verdict and supplement keep the `resets` list"
    requirement: AUT-3
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: a reset changes neither D-26's epoch nor the verdict, and every writer keeps the resets list (plan 03-66; D-26, D-38)"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-11-12
status: complete
---

# Phase 3 Plan 66: Per-epoch Stop-loss and the Owner-confirmed Reset Summary

**The exit tools now count a run's failed attempts only within its own epoch, and only a recorded reset that Claude proposed with D-37's three proofs and the owner confirmed (`reset --propose --by claude`, `reset --confirm --by owner`) begins a new one; with no reset every plan 03-53 stop-loss behaviour is unchanged, a proposal alone lifts nothing, and no live run, spend or reset of run 2 happened.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-11-12T04:03:58Z
- **Completed:** 2026-11-12T04:20:04Z
- **Tasks:** 3
- **Files modified:** 4 (two source files, two red evidence files)

## Accomplishments

- `stopLossEpochOf(evidence, role)` returns the confirmation time of the run's latest valid reset (a `confirmed` record by the owner with a reference and a time, over a proposal by Claude with one scenario per covered attempt and a parity report that is true with no problem), or null. A later entry wins a tie.
- `startRefusal` counts only failed attempts that started at or after that time. All the other rules (the order, the owner rulings, the D-34 ledger read over every earlier attempt) are as they were, and `authorize` still runs the D-05 guard after it.
- `reset --propose` and `reset --confirm` on the classify pattern. `judgeResetProposal` is pure and returns the list of problems; the command prints one `exit-run: reset: <problem>` line each and writes nothing when the list is not empty.
- Invariant cases pin that a reset leaves D-26's epoch and the verdict alone, and that every writer keeps the `resets` list.

## The stop-loss texts

| State | Exit | Text |
|---|---|---|
| No valid reset (unchanged from plan 03-53) | 75 | `stop-loss (D-29): run2 has failed twice; return to the owner before spending again` |
| Two failed attempts since the run's reset | 75 | `stop-loss (D-29, D-36): run2 has failed twice since its reset at <confirmation time>; return to the owner before spending again` |

After a confirmed reset, one failed attempt admits the next start whatever its ruling; the second refuses it. An attempt that started exactly at the reset time counts in the new epoch; earlier attempts never count again.

## The reset record

`resets[]` in the evidence file: `{ run, covers[], proposed: { by: 'claude', at, summary, pin, scenarios[{ runId, test, red{path,sha256}, green{path,sha256} }], parity{ path, sha256, checkedAt, pin, parity, problems } }, confirmed?: { by: 'owner', ref, at } }`. `covers` is the run IDs of the role's failed attempts in its current stop-loss epoch, in file order.

## Red evidence

- `03-66-red-task1.json` (`RED_EVIDENCE_OK`, `target_test_failed`): target "admits a start after a recorded, owner-confirmed reset of the run (D-39)". Before the code, `stopLossEpochOf` did not exist (`TypeError: exitTools.stopLossEpochOf is not a function`) and `reset` was an unknown subcommand (exit 2 with the usage line). 8 of 262 tests failed: cases 2 to 8 and the CLI tracer. Case 1 (no reset, the unchanged 03-53 text) and all 03-53 stop-loss cases passed, as they must.
- `03-66-red-task2.json` (`RED_EVIDENCE_OK`, `target_test_failed`): target "returns no problem for a complete input, and an earlier unconfirmed proposal of the run is not a problem". `judgeResetProposal` did not exist, so all 35 pure cases failed; 38 of 304 tests failed in all. Of the CLI cases, three failed on Task 1's presence-only code (a proposal whose green proof holds `not ok`, a proposal for a run with no failed attempt left, a confirmation after a proof file was rewritten: each exited 0 where 2 was planned). Four already passed on Task 1's code, recorded as the plan asks: a proposal `--by owner`, three `--defect` with two `--red`, the confirmation refusals (`--by claude`, an empty `--ref`, a run with no pending proposal), and a second confirmation once the latest reset is confirmed.
- Task 3's invariant and writer cases are not red-first by design (the plan says they pass on Task 2's code); they passed on the code of commit 9b18ab8 (309 of 309 in the file), which is the proof that a reset touches only the stop-loss count.

## The refusal list

Each exits 2 and leaves the evidence file byte-identical (CLI cases), or is a problem in the pure list.

- `reset --propose`: a flag missing; `--by` not claude; `--defect/--test/--red/--green` counts unequal or none; a named file missing; an authorization that authorizes nothing; the role not in the order; an attempt of the role neither passed nor failed; no failed attempt since the last reset (`nothing to reset`); a latest failed attempt with no owner ruling, or ruled a brief/harness defect (`only an owner-confirmed product defect resets the count (D-36)`); a product-defect attempt with no scenario, or two; a scenario naming an attempt that is not a covered one; a test outside `test/`, holding `..`, absolute, or not tracked; a red proof missing, with command not naming the test, exit code 0 or no `# fail` above 0; a green proof missing, with command not naming the test, exit code not 0, `# fail` not 0, `# pass` not above 0 or a `not ok` line; two scenarios sharing one red proof; a red proof an earlier confirmed reset cites (`already proved by an earlier reset: a repeat of the same failure still counts (D-36)`); a parity report missing, not schema 1, parity not true, with a problem or a mismatch, with spend, with the checkout changed, at another pin, checked at or before a covered ruling, or not covering the run's brief digest.
- `reset --confirm`: `--by` not owner; an empty `--ref`; a run whose latest reset is absent or already confirmed; a pending proposal that lacks a field the proposal writes; a proof file missing or changed since the proposal (`<path> changed since the proposal (D-37)`).

## Invariant results

For three evidence files (run2 failed twice as product defects with a confirmed reset; the same plus a passed run2 attempt 3 and a passed run3; the same plus a failed run3), `epochOf` and `exitVerdict` deep-equal their values for the file with `resets` removed. `evidenceFileBody` and `withClassification` keep the list, and the `verdict` and `supplement` subcommands, run on a temporary evidence file with `resets`, leave it deep-equal.

## Verification run

- `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 345 tests, 345 pass (exit-evidence alone: 309).
- `node --test test/integration/exit-parity.test.ts`: 15 of 15 pass (the `parity` dispatch is unchanged).
- `npm run typecheck` clean; `node scripts/check-boundaries.ts` ok (99 files); `npm run test:unit`: 2273 tests, 2273 pass.
- `git diff --stat 3b11269` over `src`, `test/fixtures/json-shapes`, `test/benchmark`, `test/containment/live-spend-phase3.jsonl`, the authorization, the exit evidence and `docs`: empty.
- `gsd_run check tdd-red-evidence` on both red files: `RED_EVIDENCE_OK`.

## Task Commits

1. **Task 1: tracer, a confirmed reset begins a new stop-loss epoch**: `d411639` (test, red), `9240dd6` (feat, green)
2. **Task 2: the three D-37 proofs checked before a proposal, only a product defect resets, only the owner confirms**: `1efbbe7` (test, red), `9b18ab8` (feat, green)
3. **Task 3: what a reset does not change, header and usage**: `f8136b9` (test, invariants and writers, passing on Task 2's code), `6fc46e0` (docs, header and usage)

**Plan metadata:** the commit of this SUMMARY and the tracking update that follows it.

## Files Created/Modified

- `scripts/exit-run-phase3-tools.ts` - `stopLossEpochOf`, `isValidReset`, `judgeResetProposal` and `ResetProposalInput`, `resetCommand` behind `reset`, startRefusal's per-epoch count, the header paragraph and the usage line
- `test/unit/exit-evidence.test.ts` - the plan 03-66 describes (stop-loss epoch cases, the pure proof refusals, the invariants and writers), the CLI tracer and the CLI refusals inside the authorize describe, the helper `reset66`
- `.planning/phases/03-decisions-independent-work-and-amendments/03-66-red-task1.json`, `03-66-red-task2.json` - the RED runs

## Decisions Made

- `--confirm` acts on the run's latest reset, and only when that reset has no `confirmed` record. The plan says "the run's latest unconfirmed proposal". Read literally, an older unconfirmed proposal would become confirmable once a later one was confirmed, and its confirmation time would then move the epoch past failures that came after the later reset. Taking the latest entry closes that hole and costs nothing in the planned flow (see Deviations).
- Two scenarios in one proposal may not share a red proof. The plan hints at it (the tracer's red outputs differ) but does not list it; a second scenario with the same reproduction proves nothing new.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] `--confirm` takes the run's latest reset, not any earlier unconfirmed one**
- **Found during:** Task 1 (the reset subcommand)
- **Issue:** "acts only on the run's latest unconfirmed proposal" could confirm a stale proposal whose confirmation time would reset the count past newer failures (T-03-183, T-03-186)
- **Fix:** the pending proposal is the run's last entry in `resets`, and only if it has no `confirmed` record; otherwise `no pending reset proposal to confirm`. Covered by the case "a confirmation once the run has no pending proposal because its latest reset is confirmed"
- **Files modified:** scripts/exit-run-phase3-tools.ts, test/unit/exit-evidence.test.ts
- **Committed in:** 9240dd6, 1efbbe7

**2. [Rule 2 - Missing critical] A hand-edited pending proposal cannot be confirmed**
- **Found during:** Task 2 (the confirmation)
- **Issue:** the plan's `--confirm` hashes the proof files the proposal records, but a proposal that lacks them would pass with nothing to hash
- **Fix:** `--confirm` first checks that the proposal with the new confirmation is a valid reset (`isValidReset`) and refuses otherwise
- **Files modified:** scripts/exit-run-phase3-tools.ts
- **Committed in:** 9b18ab8

**3. [Rule 2 - Missing critical] Two scenarios sharing one red proof are refused**
- **Found during:** Task 2
- **Issue:** the plan lists no check that the scenarios of one proposal differ from each other
- **Fix:** `judgeResetProposal` reports `the scenarios share one red proof`; one pure case
- **Files modified:** scripts/exit-run-phase3-tools.ts, test/unit/exit-evidence.test.ts
- **Committed in:** 9b18ab8, 1efbbe7

**4. [Environment] Task 3's test commit and comment commit are two commits.** The plan describes one task; the invariant and writer cases were committed first so the SUMMARY can say they passed on Task 2's code.

---

**Total deviations:** 3 auto-fixed (3 missing critical), 1 environment note
**Impact on plan:** All three tighten the owner-only, proof-bound reset. No scope creep: each stays in the exit tools and their unit test.

## Issues Encountered

None. The session refused some compound shell commands that name git next to other text, so commands were split into plain ones and the RED records were built with a small script kept outside the repository.

## No live run, no spend, no reset of run 2

No live AVARICE run was started, no model host was launched, nothing was spent and nothing was installed. `test/containment/live-spend-phase3.jsonl` is unchanged. `avarice cancel`, `contract amend`, `decide` and `resume` were not run, and no `--by owner` confirmation was written outside a test fixture. Run 2's actual reset is plan 03-67 and its attempt 3 is plan 03-68; `src/`, the authorization, the exit evidence and the briefs are unchanged.

## Documentation surfaces for plans 03-31 to 03-33

This change touches no `docs/system` document and needs no `findings.md` line. `docs/system` documents no exit tool: no document there names the stop-loss, D-29 or `exit-run-phase3-tools.ts`. The exit tools under `scripts/` are test tooling, with no `docs/system` row, as plans 03-31 and 03-65 record. No proposal document under `docs/` names the stop-loss either, so no code and proposal disagree here. `docs/` was not edited (`git diff --stat 3b11269 -- docs` is empty).

## Known Stubs

None.

## Threat Flags

None. T-03-182 (Claude writing the owner's confirmation): `--confirm` refuses any `--by` but owner and an empty `--ref`, `--propose` refuses any `--by` but claude, and `stopLossEpochOf` counts only a reset with `confirmed.by` owner and a reference. T-03-183 (a reset without proof, for a brief/harness stop, or by reusing a reproduction): `judgeResetProposal` and its cases. T-03-184 (proof files changed after the proposal): re-hashed at the confirmation. T-03-185 (a reset rewriting which passes count): invariant cases. T-03-186 (another run's reset, a hand-edited reset): per-run filter and `isValidReset`. T-03-SC: nothing was installed.

## Next Phase Readiness

Ready for 03-67: the owner can cancel the blocked run in their own terminal, and Claude can then re-run parity at the pin, record the 03-61, 03-64 and 03-65 proofs for run 2's two defects with `reset --propose`, and present the reset for the owner's `reset --confirm`. Run 2's third start stays refused until that confirmation exists.

## Self-Check: PASSED

- Created files exist: 03-66-red-task1.json, 03-66-red-task2.json, and the modified scripts/exit-run-phase3-tools.ts and test/unit/exit-evidence.test.ts.
- Task commits are on the branch: d411639, 9240dd6, 1efbbe7, 9b18ab8, f8136b9, 6fc46e0.
