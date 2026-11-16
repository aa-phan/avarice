Reviewed: docs/system/runs.md sha256 4d58c04bb6e11d90b3a30530bf3e6d49583b50e6e37b46ea48ff0432ad017320 at b9c7aca (uncommitted on top)
Reviewed: docs/system/data-model.md sha256 db0f65c1482a697719c049d4cd592d1f34b21c29bb7f3ce834826863114e745a at b9c7aca (uncommitted on top)

Both digests matched `shasum -a 256` before the review started.

Verdict: BOUNCE

The bounce has one cause: a sentence over the 35-word limit. Every factual claim in the changed text matches the code and the fault test. Two scope and ordering problems also need a fix.

## FINDINGS

**1. BLOCKER: sentence over 35 words (house rule)**
- **Text** (data-model.md, quirks bullet): "A block of a run is not one transaction, and the fence guards a run's transitions, checkpoints, contract and work item moves but not its steps (a failed reconcile step excepted), attempts, evidence, gates or decisions."
- **Evidence:** the sentence is 37 words. The added parenthetical "(a failed reconcile step excepted)" pushed it over the limit.
- **Fix:** split it in two, for example: "A block of a run is not one transaction. The fence guards a run's transitions, checkpoints, contract and work item moves, and a failed reconcile step, but not its other steps, attempts, evidence, gates or decisions."

**2. WARNING: "records nothing" is wider than the code and contradicts the new discard sentences**
- **Text** (runs.md, prelude paragraph): "A supervisor that another one superseded therefore records nothing, and a later `resume --wait` does not read its refusal as a failed reconcile."
- **Evidence:**
  - Only the failed reconcile record carries the fence (`src/app/run-resume.ts:310-321`, `src/adapters/sqlite/ledger.ts:939`).
  - A prelude discard that is superseded after its checkpoint still writes the `discard` step and the attempt's end (`src/app/run-stages/discard.ts:69-92`, reached from the prelude via `src/app/run-stages/item.ts:395`).
  - The fault test shows those writes land after a takeover (`test/fault/run-discard-stale-fence.test.ts:380-394`).
  - The discard section of this same document now says so too.
- **Fix:** narrow the claim: "A supervisor that another one superseded therefore records no failed reconcile step, so a later `resume --wait` does not read its refusal as one."

**3. WARNING: the superseded-supervisor sentences come before the text that explains what the discard does**
- **Text** (runs.md, "Discard and the one retry"): the four new sentences, from "A supervisor superseded after that checkpoint…" to "…lists nothing restored.", sit between "The discard checkpoints first…" and "The discard puts the clone back to the snapshot…".
- **Problems:**
  - The reader meets "restores the clone" and "finds nothing left to restore" before the paragraph says what the discard restores, and limits it to the changed paths.
  - "that checkpoint" points back to a verb ("checkpoints first"), not to a named checkpoint.
  - The added sentences break the procedure into an edge case and then resume it.
- **Evidence:** the order of operations is checkpoint → restore → step → attempt end → item move (`src/app/run-stages/discard.ts:7-8`).
- **Fix:** move the four sentences after "If the clone HEAD moved by then, the discard is refused…", or into a paragraph of their own after it. Open with "A supervisor superseded after the discard's checkpoint…".

**4. OBS: the final record loses the removed list as well as the restored list**
- **Text:** "The repeated discard replaces the step record, so the final record lists nothing restored."
- **Evidence:**
  - The upsert on (run, step, attempt) replaces the row (`src/adapters/sqlite/ledger.ts:944-949`).
  - The resumed discard uses the same attempt ordinal (`src/app/run-stages/item.ts:395`).
  - I ran the convergence test. Its diagnostic printed: `discard step, attempt 1: restored [], removed [], ignoredLeft []`. The file the crashed unit created was removed by the superseded supervisor (`test/fault/run-discard-stale-fence.test.ts:367`), but the final record no longer shows that.
- **Fix:** "…so the final record lists nothing restored or removed."

## Checked and verified against code

- The discard commits its checkpoint before anything is restored, and a stale fence fails there. See `discard.ts:46-48`, and the test at `run-discard-stale-fence.test.ts:252-254` (no checkpoint, no restore call).
- After the checkpoint, the superseded supervisor restores the clone and records the `discard` step and the attempt's end with no fence. Neither `recordRunStep` without a guard nor `endRunAttempt` checks the fence (`discard.ts:51,69-92`; `ledger.ts:936-939,978-987`). The test confirms the restore at :361-367, and at :380-394 confirms the only rows written are in `run_steps`, `attempts` and `events`.
- The work item move then fails on the fence, and the run and item stay as they were. `transitionWorkItem` checks the fence (`ledger.ts:1134-1137`). The test (:370-377) shows a conflict from lease fence 1 to 2, with the run state and version unchanged and the item still `delegated`.
- The next supervisor's resume repeats the discard and retries once. A delegated item goes through `reconcileDelegated` and then `discardAttempt`, which returns `retry` (`item.ts:288-292,395-397`). The test (:397-405) reaches `ready_for_review` with attempts `['discarded','handed-off']` and no third attempt. I re-ran this test: 1 passed, 0 failed.
- The repeated discard replaces the step record: the `ON CONFLICT (run_id, step, attempt) DO UPDATE` upsert at `ledger.ts:944-949`, with the same ordinal. "Nothing restored" matches the observed diagnostic.
- A prelude failure is recorded as a failed `resume:reconcile` step and the supervisor stops (`run-resume.ts:29,302-322`). The record presents the supervisor's fence (`run-resume.ts:320`, `ledger.ts:939`).
- A superseded supervisor writes no failed reconcile row. The test shows no failed reconcile record (:264-267).
- `resume --wait` counts failed reconcile steps before and after the spawn and exits 70 only when the count grew (`src/cli/commands/resume.ts:62-70,96,113-120`). A refused record therefore never reads as a failed reconcile.
- The data-model claim that the failed reconcile step is the one fenced step write holds. `run-resume.ts:320` is the only `recordRunStep` call in `src` that passes a guard.
- The fence guards run transitions, checkpoints, contract storage and work item transitions (`ledger.ts:863,906,1137`). Attempts take no fence (`ledger.ts:964-987`).
- House rules:
  - No em dash, en dash or " -- " in either document.
  - No file paths, function names, phase numbers, plan IDs or threat IDs in the changed prose.
  - Every changed sentence except the bullet in finding 1 is 35 words or fewer.
  - The changed paragraphs lead with their conclusion. The exception is the ordering problem in finding 3.
