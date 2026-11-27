---
phase: 03-decisions-independent-work-and-amendments
plan: 54
subsystem: exit-tools-role-judges-silence-verdict
tags: [exit, expects, amend-stale, d-35, silence, verdict, supplement, d-28, d-34, sc2, sc3, sc4]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-51 checksNotRun and the statusView.checksNotRun report (D-35)
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-53 role and attempt bookkeeping, classify, epochOf and the entry fields run, attempt, expects
provides:
  - "judgeFinish `expects` (the role rule: only amend-stale is amended) and judgeStart / judgeFinish D-35 check through `checksNotRunExpected` and `statusView`"
  - "judgeSilence, runSilence and the `silence` subcommand: run 3's step, with `scripts/exit-run-phase3.sh --silence`"
  - "exitVerdict and the `verdict` and `supplement` subcommands: the exit record"
  - "the exit script's default evidence file 03-57-evidence-exit.json and plan 03-57"
affects: [03-55, 03-56, 03-57, 03-58, 03-59, 03-60]

actuals:
  tokens: 60000
  tasks: 3
  commits: 6
plan_head_before: 1f157c50fd4500d79ff214a00b3b656ada653ed0
plan_head_after: e9e290a46190f369e327cc9ccb63967b8e134767

tech-stack:
  added: []
  patterns:
    - "A run's expectation comes from the authorization entry (`expects`), copied into the evidence entry at start and read by the finish judge and by exitVerdict"
    - "The silence step is a pure judge plus a flow over four seams (read, digest, nowMs, pause), so the wait and the single digest are tested without a ledger, a notifier or a clock"
    - "verdict and supplement write top-level keys through evidenceFileBody and a temporary file and rename; every refusal precedes any write"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-54-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-54-red-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-54-red-task3.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - scripts/exit-run-phase3.sh
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "With `expects` present the relax rule is closed for every role: a relax record is a problem and relaxes nothing, and an `expects` other than amend-stale makes a contract above version 1 a problem"
  - "amend-stale judges `files.write` as the diff path `files.write`, which is the real path in a contract body (RunContract.files.write)"
  - "D-35 compares the sorted names of statusView.checksNotRun with checksNotRun on the run's stored contract; a null or absent status view is a problem when an expected list is given, and no list given judges nothing"
  - "judgeSilence requires blocking banners to fail with exactly osascript-missing (the plan's text), at least one blocking banner row, and the latest digest row covering the decision to be failed; the elapsed seconds are those that had passed when the digest was started, so a slow digest cannot make a short wait pass"
  - "exitVerdict reads each role's expectation from the authorization's `briefs[].expects`, never from the role name, and reads `3/3` only for three counted roles of an order of exactly three"

requirements-completed: [AUT-4, AUT-5, AUT-6, RC-6, AUT-16]

duration: about 1h 45min
completed: 2026-11-10
status: complete

coverage:
  - id: D1
    description: "judgeFinish with expects amend-stale accepts version 2 by the owner with a reason and a files.write diff, a stale original with its answer kept and one answered successor, and lists one problem for each of twelve single faults; every other expectation refuses a contract above version 1; a relax record is never accepted under an expectation"
    requirement: AUT-5
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: run 2's amendment and stale original are its expected path, and no other run's (plan 03-54; D-28, SC3, SC4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "judgeStart and judgeFinish name D-35 when statusView.checksNotRun differs from checksNotRun on the run's own contract, and the finish stage records checksNotRunExpected beside statusView from a real ledger"
    requirement: AUT-16
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: the status reports the declared checks that do not run as not run (plan 03-54; D-35, T-03-139)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: the finish stage records the expected not-run list beside the status view, from the run's own contract (plan 03-54; D-35)"
        status: pass
    human_judgment: false
  - id: D3
    description: "judgeSilence, runSilence, the silence subcommand and --silence: failed banners and digest, an open decision with four null answer columns, inbox and status, and the batch window plus 15 s are judged; nothing is answered"
    requirement: AUT-6
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: judgeSilence judges run 3's silence from the rows the owner's ledger holds (plan 03-54; SC2, AUT-4, AUT-6, T-03-136)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: runSilence waits for the banners to be final and the window to pass, runs the digest once, and answers nothing (plan 03-54; AUT-4)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit-run-phase3.sh --silence (plan 03-54)"
        status: pass
    human_judgment: true
    rationale: "The live behaviour (a real owner profile with osascript missing, a real digest, the 70 s of backoff, the real inbox and status) is exercised only by the exit run of plan 03-57 or later; the unit cases play the rows and the clock"
  - id: D4
    description: "exitVerdict, verdict and supplement: 3/3 only with a clean run per role in the current epoch, correct stops and supplementary runs never counted, a pre-epoch pass not counted"
    requirement: RC-6
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: exitVerdict counts only clean runs of the current epoch, one per role (plan 03-54; D-26, D-28, D-34, T-03-138)"
        status: pass
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit evidence: verdict writes the exit record and supplement keeps a superseded run as evidence that never counts (plan 03-54; D-28, D-34)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The exit script's default evidence file is 03-57-evidence-exit.json and its default plan 03-57; the earlier evidence files are named only as history in the header"
    requirement: AUT-4
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#exit-run-phase3.sh: the default evidence file of the replanned exit (plan 03-54; plans 03-41 and 03-44 introduced the variable)"
        status: pass
    human_judgment: false
---

# Phase 3 Plan 54: Role-aware exit judges, run 3's silence step, verdict and supplement Summary

**The exit tools now judge each run against what the authorization says it expects (run 2's amendment and stale answer are its path, any other amendment is a problem), judge D-35's `not run: not required` report live at both stages, record run 3's silence with `--silence`, and write the exit record with `verdict` (3 of 3 only from three clean runs of the current epoch) and `supplement` (old run 1 as evidence that never counts).**

## Performance

- **Duration:** about 1 h 45 min
- **Tasks:** 3 of 3 (Task 1 a tracer, Tasks 2 and 3 auto; all TDD)
- **Files:** 3 modified (`scripts/exit-run-phase3-tools.ts`, `scripts/exit-run-phase3.sh`, `test/unit/exit-evidence.test.ts`), 3 RED evidence records created
- **No file under `src/` changed; no live run, no spend, no call to the Claude host. The silence step's real digest was not run: tests play the rows and the clock. The owner's profile was never read.**

## Accomplishments

- **Task 1 (tracer).** `judgeFinish` takes `expects`; `amendmentProblemsOf` and `staleProblemsOf` implement the role rule. `judgeStart` and `judgeFinish` take `statusView` and `checksNotRunExpected` and share `checksNotRunProblem`. `collect` returns the run's contract body, and `evidenceCommand` computes `checksNotRun(contract)`, passes it with `expects` (from the prior entry) to the judges at the right stage, and records `checksNotRunExpected` in the entry. Tracer gate: the verify (`node --test test/unit/exit-evidence.test.ts`, `npm run typecheck`) re-ran green before Tasks 2 and 3 started.
- **Task 2.** `judgeSilence`, `runSilence` (over four seams), `silenceCommand`, `scripts/exit-run-phase3.sh --silence RUNID --authorization-file F`; default evidence file `03-57-evidence-exit.json`, default plan `03-57`, a header that names the replanned exit and lists the old evidence files as history.
- **Task 3.** `exitVerdict`, `verdictCommand`, `supplementRecordOf`, `supplementCommand`, dispatched from `main` and described in the header comment and the usage line.

## TDD Gate Compliance

All three tasks ran RED then GREEN; no REFACTOR commit.

- **Task 1** RED `76463a0`, GREEN `146a4ad`. RED (`03-54-red-task1.json`): 194 tests, 175 pass, 19 fail; `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`), target "accepts the expected path: version 2 by the owner ...". Expected `[]`, actual one problem, "the contract was amended (version 2) without a valid relax record: an amendment is accepted only when the owner relaxed D-03 for this run". Semantic assessment: the real `judgeFinish` ran and failed on the planned deepEqual because it still judged an amendment only through the relax record; the eleven refusal cases, the block-resume and silence case, the relax-under-expectation case, the eight D-35 cases and the live-ledger case failed on their planned assertions (the version 3 case and the resume case passed before, because the old text already contained "version 3" and the resume check is unchanged).
- **Task 2** RED `cdf1cb6`, GREEN `da84882`. RED (`03-54-red-task2.json`): 222 tests, 195 pass, 27 fail; `RED_EVIDENCE_OK`, target "defaults to 03-57-evidence-exit.json and plan 03-57 ...", failing on its `assert.match` against the script text (the script still named 03-48 and 03-42). The judgeSilence and runSilence cases failed with `exitTools.judgeSilence is not a function` and `exitTools.runSilence is not a function` (the planned missing exports); the four subcommand refusal cases and the script cases failed because `silence` and `--silence` did not exist. Two cases passed before only because an unknown command and an unknown flag already exit 2.
- **Task 3** RED `65000a9`, GREEN `e9e290a`. RED (`03-54-red-task3.json`): 289 tests, 259 pass, 30 fail; `RED_EVIDENCE_OK`, target "verdict writes verdict, verdictRuns, correctStops and verdictAt, keeps every other key, and exits 0 for 3/3", failing on the exit-status assertion `2 !== 0` because `verdict` was not a subcommand (usage line, exit 2). The exitVerdict cases failed with `exitTools.exitVerdict is not a function`.

## Problem texts the run plans will see

Finish stage, `expects: amend-stale` (run 2). Each is one problem; the run plans quote them in their checkpoint branches.

| Fault | Text |
|---|---|
| contract at version 1, or none | `no amendment: the contract is still at version 1, and run 2 expects the owner's amendment (SC3, SC4)` |
| version above 2 | `the contract was amended to version N: run 2 expects exactly one amendment, contract version 2 (D-28)` |
| authorized_by not the owner | `the amendment's authorized_by is "X", not owner:<user>` |
| empty reason | `the amendment records no reason` |
| diff without files.write | `the amendment's diff does not name files.write` |
| no stale decision | `no decision is stale: run 2 expects its original pause decision to go stale at the amendment (SC3)` |
| stale decision without its answer | `the stale decision <id> has no answer kept (SC3)` |
| successor does not supersede it | `the answered decision <id> does not supersede the stale decision <id> (SC3)` |
| successor not by the owner / not on the terminal | the unchanged `the answer was given by "X", not owner:<user>` and `the answer arrived on channel "X", not terminal` |
| two answered decisions | the unchanged `N decision(s) are answered, not one` |

Any other `expects` (`block-resume`, `silence`) with a contract above version 1: `the contract was amended (version N); only run 2 expects an amendment (D-28)`. A relax record under any `expects`: `a relax record is not accepted in the exit (D-28)`.

D-35, both stages (`<names>` are the expected checks, for the portfolio `test:e2e`):

- `status does not report <names> as not run: not required (D-35)` (key absent, status view null, or another check named)
- `status reports <names> as not run, but the contract expects <names> (D-35)` (an extra check reported)
- `status reports <names> as not run, but the contract expects none (D-35)`

`silence` (run 3), each a problem of the block and a `PROBLEM:` line on stdout:

- `the run has no blocking banner row: the stop raised none, so no failed delivery was recorded (AUT-6)`
- `blocking banner <id> was delivered: the notifier was not down (SC2)`; `blocking banner <id> is <state>, not failed: its delivery attempts are not final`; `blocking banner <id> failed with "<code>", not osascript-missing`
- `no digest row covers the decision: the digest after the batch window recorded none (AUT-6)`; `the digest row <id> is <state>, not failed`
- `the decision row cannot be read from the ledger`; `the decision <id> is not open and unanswered: state <s>, answer columns set: <list or none> (AUT-4)`
- `inbox does not list the decision (AUT-6)`; `inbox lists the decision with notification state <s>, not failed (AUT-6)`
- `status shows <state>, not blocked_on_decision (SC2)`
- `only N s have passed since the block; the batch window of M min plus 15 s needs T s (SC2)`

`silence` refusals (exit 2, file untouched, before any profile is read), after `exit-run: silence: `: `usage: silence needs --<flags> [--wait-max-minutes N]`; `refusing to spend: <authorization problem>`; `the evidence file holds no entry for <runId>`; `the evidence file has no start-stage record of <runId>: nothing to wait on`; `the entry of <runId> expects <value>, not silence: only run 3 waits for the owner's silence`; `the start-stage record of <runId> names no pause decision to watch`.

`verdict` prints the verdict line, then one `counted:` line per counted role, `correct stop, evidence that does not count (D-28): ...` per correct stop and `not counted: <role> <runId>: <reason>` per other entry. Reasons: `no outcome yet: the attempt still waits for the owner`; `stopped with no owner-confirmed classification (D-26, D-27)`; `owner-confirmed product defect: it starts a new epoch and every run passes again (D-26)`; `owner-confirmed brief/harness defect, but the proposal does not say docs/system is conformant, so it is not a correct stop (D-27)`; `passed before the epoch that began at <time>, when the owner confirmed a product defect: every run passes again (D-26)`; `does not count: <unmet conditions>`; `a later attempt of <role> is the one counted`; `not a run of the authorization (D-28)`.

`supplement` refusals, after `exit-run: supplement: `: `--note is empty: say why the run is kept as supplementary evidence (D-34)`; `<runId> is an entry of the evidence file: a run that counts is not supplementary evidence (D-34)`; `<file> holds no entry for <runId>`; `<runId> is already supplementary evidence in the file (D-34): it is recorded once`; `<file> is not an evidence file`.

## Interpretations the run plans should know

1. **The silence step waits for real time.** Three delivery attempts back off 0, 10 and 60 s (`BACKOFF_DELAYS_MS`), so the supervisor's banner takes about 70 s to become final and the `avarice digest` run takes about 70 s again when the notifier is down. The wait cap is 10 minutes (`--wait-max-minutes`), and the digest itself runs with a 300 s timeout. With a batch window above about 9 minutes the wait ends before the window passes and the block lists the "only N s have passed" problem; the live profile's `batchWindowMinutes` should stay small (the offline suite used 1).
2. **Run 3 needs the notifier down with osascript missing.** `judgeSilence` follows the plan: blocking banners must fail with `osascript-missing`, not `osascript-failed` or `osascript-timeout`. A profile whose `notify.local.osascriptPath` names an existing script that exits non-zero would fail the step. The tools never edit the profile; the run plan's checkpoint must have the owner set it up.
3. **Elapsed time is measured from the decision's `openedAt` to the moment the digest starts**, not to when the rows are read afterwards, so the 70 s of the digest cannot make an early digest look late.
4. **`verdict` reads each role's expectation from the authorization's `briefs[].expects`.** `amend-stale` needs contract version 2 and a stale decision in the entry; `silence` needs a `silence` block with an empty `problems` list. A run whose authorization entry names `block-resume` needs neither. In the test authorization of plan 03-53, run 3 is `block-resume`; the real authorization of the replanned exit must name run 3 `silence`.
5. **`verdict` and `supplement` rewrite the file through `evidenceFileBody`**, which sets `schema: 1`, replaces `updatedAt`, and (as in every evidence write) keeps every other top-level key. The file's own `plan` and `decision` values are restored after it, so a file seeded by plan 03-55 keeps them.
6. **A correct stop is listed under `correctStops` only; it is not repeated in the not-counted reasons.** Only `runs` is read for counting: `supplementary` is never read by `exitVerdict`.

## Verification

- `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 289 tests, 289 pass, 0 fail.
- `npm run typecheck` (`tsc -p .`): no output (clean). `node scripts/check-boundaries.ts`: `check-boundaries: ok (99 file(s))`. `bash -n scripts/exit-run-phase3.sh`: no output.
- Task 2 automated check: `bash -n scripts/exit-run-phase3.sh && grep -q -- "--silence" ... && grep -q "03-57-evidence-exit.json" ...` printed `script-ok`.
- Acceptance: `bash scripts/exit-run-phase3.sh --silence run_X` printed `exit-run-phase3: refusing to spend without --authorization-file (the owner's recorded decision, D-04)` and exited 2. `grep -n "export function exitVerdict" scripts/exit-run-phase3-tools.ts` prints line 2043; `main` dispatches `verdict` and `supplement`. `grep -n "checksNotRun" scripts/exit-run-phase3-tools.ts` shows the import from `src/app/checks.ts`, the `checksNotRun(facts.contractBody)` call in the evidence stage, and the option passed to both `judgeStart` and `judgeFinish`.
- Wider sweep: only `test/unit/exit-drafts.test.ts` and `test/unit/exit-evidence.test.ts` reference the script or its tools; both ran. The full `npm run test:unit` was not re-run (no file under `src/` changed).

## Documentation surfaces for the documentation plan

`docs/system/` exists in this checkout; as in plans 03-51 to 03-53 this plan lists its surfaces instead of editing it mid-phase. These are exit tooling under `scripts/`, so the documentation plan decides whether `docs/system/` covers them at all; if it does: the `silence`, `verdict` and `supplement` subcommands (flags, exit codes 0, 1 and 2, the `silence` block and the top-level keys `verdict`, `verdictRuns`, `correctStops`, `verdictAt`, `supplementary[]`), the `--silence` mode of the exit script and its default evidence file, the evidence entry field `checksNotRunExpected`, and the role rule of the finish judge. A `docs/system/findings.md` line is not needed: no code and `docs/system/` disagree here.

## Deviations from Plan

None - plan executed exactly as written.

Notes, none a deviation: (1) the silence step's wait/digest/judge flow is split over four seams (`read`, `digest`, `nowMs`, `pause`) so it can be tested without a ledger, a notifier or the 70 s of real backoff; the plan asked for the behaviour, not its structure; (2) the plan-commit ledger file (`gsd-plan-head-before-03-54` under the git dir) could not be written because the sandbox refuses writes to the shared git directory from this worktree, so the base `1f157c5…` was recorded from `git rev-parse HEAD` at start and `commits: 6` is measured as `git rev-list --count 1f157c50fd4500d79ff214a00b3b656ada653ed0..HEAD`; (3) git commands ran as separate simple commands because the sandbox refuses compound commands that contain git.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-03-136 (a failed banner, digest or time read as an answer): `judgeSilence` requires the decision open with all four answer columns null after the wait and the digest, and the step's seams hold no way to answer (a case asserts it); the subcommand never calls decide. T-03-137 (an amendment outside run 2's path): the role rule refuses a contract above version 1 for every `expects` but `amend-stale`, and a relax record is refused under any `expects`. T-03-138 (a correct stop, a supplementary run or a pre-epoch pass counted): `exitVerdict` counts only entries of the current epoch per role, `correctStops` and `supplementary` are separate keys, `supplement` marks `countsToward3of3: false`, and cases pin each. T-03-139 (D-35 claimed while the live status does not report it): both judges compare `statusView.checksNotRun` with `checksNotRun` on the run's own stored contract, and a case reads it from a real ledger.

## Self-Check: PASSED

- FOUND: scripts/exit-run-phase3-tools.ts, scripts/exit-run-phase3.sh, test/unit/exit-evidence.test.ts, 03-54-red-task1.json, 03-54-red-task2.json, 03-54-red-task3.json
- FOUND commits: 76463a0, 146a4ad, cdf1cb6, da84882, 65000a9, e9e290a
- STATE.md and ROADMAP.md untouched.
