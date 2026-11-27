Reviewed: docs/system/runs.md sha256 501c8a8ff9e3510f1b39ff51981057a21e346ed076b02568dcb3491b99d7473f
Reviewed: docs/system/findings.md sha256 66b0fbaa43df5caeaa6c4ea91f8fb22e9633c0d14a8e081d5a1cfbfda5004719

Both digests match the expected values. I did the review myself rather than dispatching a second reviewer, so the verdict comes from one pass. Partway through, Bash was denied, so I finished with Grep and Read. I did not run `git diff` or `git show` on the docs, so I checked their text against the diff file only.

Verdict: BOUNCE

## FINDINGS

**1. WARNING — `findings.md`, Proposal drift, `docs/extensions.md:215` line (diff line 20).** The edited line says the finding "no longer holds at fdc29c6", but the section is defined as differences that "still hold at the pass's code state".
- Evidence: `findings.md:245` states that definition. The new text sits in the same bullet as "(intent unknown)", so one line carries three stacked parentheticals that contradict each other.
- The commit hash is also delivery history, which `CLAUDE.md` keeps out of `docs/system/` prose.
- Fix: rewrite the bullet to the part that still holds. For example: "the skill section's test row names 10 contained runs checking that pause questions follow the supervisor's format; no harness for them was found (intent unknown). The attended half is now covered by `test/containment/live-attended-skill.test.ts`." Drop the hash and the "no longer holds" wording.

**2. WARNING — `findings.md`, new entry at `claude-host.ts:244` (diff line 9).** It cites `docs/extensions.md:215` as expecting the supervisor to route the question. That row is a Tests row. It says contained runs check that pause questions follow the format the supervisor classifies. It says nothing about routing.
- Evidence: the routing expectation is at `docs/extensions.md:12` ("phrase a question so the supervisor can route it") and `:85` ("route GSD pauses").
- Fix: cite `docs/extensions.md:12` for routing, or `:12` and `:215` for routing and classification respectively.

**3. OBS — `findings.md`, same entry.** The entry says the host returns "no `question`", but never names the field it means. `question?: string` is declared at `src/ports/agent-host.ts:68`. The only reader is `src/app/run-stages/item.ts:201`, which passes it to `detectPause` at `:203`. The return object at `claude-host.ts:244` onward sets no such key, and a Grep of `src` found no other writer. Citing `agent-host.ts:68` would let a reader verify the claim in one hop.

**4. OBS — `findings.md`, same entry.** "`src/domain/outcome.ts:94` to `:114`" stops one line short. The `detectPause` function ends at `:115`. Cite `:94` to `:115`.

**5. OBS — `findings.md`, the last sentence of the same line 20 (diff line 20).** "The contained-run half of that row still has no harness" is a negative claim I could not fully confirm. `test/integration/run-baseline-workflow.test.ts` and `test/unit/outcome.test.ts` do reference `numbered-choice`. Both are offline fake-host or unit tests, not 10 live contained runs, so the claim is plausible. Say "no live harness" to make it exact.

**6. OBS — `findings.md`, two new attended-session entries (diff lines 10–11).** The counts match the record.
- Status-first: 1 of 4 judged sessions followed the line. `status-first-1` is the re-run PASS, and the invalidated first run is correctly excluded. In `status-first-2`, `-3` and `-4`, `git` or `grep` ran before `avarice status`. In `-3`, `git` ran before the skill was loaded. The skill was loaded first in `-2` and `-4`, so "2 of the 3" holds.
- Routable question: all 3 sessions edited `src/slug.ts`. `routable-question-1` and `-3` had `skillInvoked:false`, and `-2` had it true, so "at most 1" holds. No final text ends in numbered choices; I read `-3` directly, and `LIVE-CASES.md:253`, `:256` and `:273` cover `-1` and `-2`.
- Both entries end "Intent unknown: revise the text, or accept", which gives the owner a decision. Other entries end "Intent unknown." Consider whether the extra clause fits the file's convention.

**7. OBS — `runs.md:229` (diff line 30).** Claim confirmed, no change needed.
- `item.ts:201–203` builds `finalTextTail` only from `outcome.question`, and `claude-host.ts:244` returns none.
- The other three signals in `detectPause` are `waitingJson` and `verificationStatus` (both passed) and `stateNeedsHuman` (not passed). So for the Claude host, only the waiting file and the VERIFICATION `human_needed` status can signal a pause.
- The added sentence names no module paths and follows the prose rules.
- It does not point to the `findings.md` entry. That is optional, since `docs/system/` documents describe what is, and the finding records the disagreement.

**Checked and correct:**
- The `avarice-run-skill.ts:32` and `:36` citations match the lines quoted.
- `item.ts:203` is the `detectPause` call.
- `test/containment/live-attended-skill.test.ts` exists and judges three behaviors, with the control not judged.
- Commit `fdc29c6` exists.
- `coverage.md` records no count that these two additions change.

**Fix order:** fix finding 1 first. Findings 2 to 5 are one-line edits. After any edit the digests change, so both files need a fresh review before they are marked reviewed in `coverage.md`.
