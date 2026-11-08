Reviewed: docs/system/runs.md sha256 1a11c3d60f04cd0ce51f5ef81f3699bb564b93fac0657b4a0d383aaa13bc7185 at b9c7aca (uncommitted on top)
Reviewed: docs/system/data-model.md sha256 7d6b3b73f45498899f4519a834c3706fda498a8f1c412f55509771dc1b82aa0d at b9c7aca (uncommitted on top)

Both digests matched `shasum -a 256` before the review started. I did this review myself rather than handing it to a separate reviewer, because your brief named me as the fresh reviewer.

Verdict: PASS: no finding above OBS remains

All four round 1 findings are fixed. Every claim in the changed text matches the code and the fault test. One wording ambiguity remains as an OBS.

Severities: **BLOCKER** means it cannot ship. **WARNING** means likely rework, fix it but it does not block. **OBS** is worth noting.

## Round 1 findings, rechecked

1. **BLOCKER, sentence over 35 words: fixed.** The bullet is now two sentences of 9 and 27 words (`data-model.md:318`). No fact was added or lost. "Other steps" correctly narrows the exception.
2. **WARNING, "records nothing" was too wide: fixed.** It now reads "records no failed reconcile step, so a later `resume --wait` does not read its refusal as one" (`runs.md:308`). This matches the code: only the failed reconcile record passes a guard (`src/app/run-resume.ts:310-321`, `src/adapters/sqlite/ledger.ts:936-939`). It no longer contradicts the discard paragraph.
3. **WARNING, ordering: fixed.** The superseded-supervisor text is now its own paragraph (`runs.md:251`). It comes after the paragraph that explains what the discard restores and how a moved HEAD is refused. It opens with the named "the discard's checkpoint", so "that checkpoint" no longer points back to a verb.
4. **OBS, the removed list is lost too: fixed.** It now reads "lists nothing restored or removed" (`runs.md:251`). This matches the upsert at `ledger.ts:944-949` and the empty lists the test reports (`test/fault/run-discard-stale-fence.test.ts:407-411`).

## FINDINGS

**BLOCKER:** none.

**WARNING:** none.

**OBS 1: "records the discard" can be read as the operation, not its step record.** Confidence: medium.
- **Text** (`runs.md:251`): "still restores the clone and records the discard and the attempt's end, which take no fence."
- **Problem:** "the discard" is already the subject of the whole section, as an operation. Here it means the `discard` step row. The other fenced and unfenced writes in both documents are named as rows ("step", "attempt", "checkpoint"), so a reader may stop for a moment on this one.
- **Evidence:** the unfenced write is `recordRunStep` with step `discard` (`src/app/run-stages/discard.ts:69-71`), and the test names it the same way (`run-discard-stale-fence.test.ts:380-385`).
- **Fix:** "...still restores the clone and records the `discard` step and the attempt's end, which take no fence."

## Checked and verified against code

**runs.md:251, the superseded-supervisor paragraph**
- "Superseded after the discard's checkpoint ... still restores the clone":
  - The checkpoint comes first and is the only fenced write before the restore (`discard.ts:46-51`).
  - The test commits one `discard-attempt` checkpoint, makes one restore call, puts the pin bytes back and removes the extra file (`test:361-367`).
- "Records the discard and the attempt's end, which take no fence":
  - `recordRunStep` without a guard and `endRunAttempt` never check the fence (`discard.ts:69-92`; `ledger.ts:936-939,978-987`).
  - After the takeover, the test finds new rows only in `run_steps` (one completed `discard`, attempt 1), `attempts` (ended_at and outcome) and `events` (`attempt.ended`) (`test:380-394`).
- "Its work item move then fails on the fence, and the run and the item stay as they were":
  - `transitionWorkItem` checks the fence (`ledger.ts:1134-1137`), and the discard calls it with the stale fence (`discard.ts:97`).
  - The test gets a conflict from lease fence 1 to 2, the run state and version are unchanged, and the item is still `delegated` (`test:370-377`).
- "The next supervisor's resume repeats the discard, which finds nothing left to restore, and retries once":
  - A delegated item goes through `reconcileDelegated` and then `discardAttempt`, which returns `retry` (`src/app/run-stages/item.ts:288-292,395-397`).
  - The second ending of an attempt is tolerated as a conflict (`discard.ts:91-92`).
  - The test reaches `ready_for_review` with attempts `['discarded','handed-off']` and no third attempt (`test:397-403`).
- "Replaces the step record ... nothing restored or removed": the upsert on (run, step, attempt) is at `ledger.ts:944-949`, called with the same ordinal (`item.ts:395`).

**runs.md:308, the prelude paragraph**
- "The record presents the supervisor's fence": `{ fence: ctx.fence }` is passed at `run-resume.ts:320`, and `checkFence` runs inside the transaction (`ledger.ts:939`).
- "Records no failed reconcile step": the test finds no `resume:reconcile` row when the supervisor is superseded (`test:264-267`).
- "`resume --wait` does not read its refusal as one": `--wait` counts failed reconcile steps before the spawn and exits 70 only if the count grew (`src/cli/commands/resume.ts:62-70,96,113-120`).

**data-model.md:197, the fence paragraph**
- The failed reconcile step is the only step write in `src` that passes a guard, out of all the `recordRunStep` call sites.
- "Cannot record it" holds because a fence mismatch aborts that transaction.
- "The other unfenced rows until its next fenced write fails" is consistent with the post-checkpoint window above.

**data-model.md:318, the quirks bullet**
- Run transitions, checkpoints, contract and work item moves are fenced (`ledger.ts:863,906,1137`), plus the failed reconcile step.
- Attempts are not fenced (`ledger.ts:964-987`).

**House rules**
- No em dash, en dash or " -- " in either file (scripted check, no hits).
- No file paths, function names, phase numbers, plan IDs or threat IDs in the changed prose.
- Scripted word counts on the 12 changed sentences: highest 27, all 35 or fewer.
- Each changed paragraph opens with its main claim. The data-model sentence that lists the unfenced writes and then states the exception is a factual rule followed by its scope, not a buried conclusion.
- Terms match the rest of both documents ("superseded supervisor", "fence", "presents the fence").

The new paragraph is clean and specific, and it gives the reader both the window the fence cannot cover and how a resume converges after it.
