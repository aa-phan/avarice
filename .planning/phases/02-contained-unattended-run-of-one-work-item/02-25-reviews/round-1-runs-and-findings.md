Both reviewers are still running, one for each document. I don't have any findings or verdicts yet.

The digests I computed before dispatching match the expected values:

- `docs/system/runs.md`: sha256 `9f62718f45ead4836dce586d616c57c30fdbc4fff148d302cd579a27855a5b88`
- `docs/system/findings.md`: sha256 `a3c7b280dee2e11abc89e49cb1412d4f568067ad8dc682401dbb5d2a5c89d0e7`

Each verdict will bind to the digest above for its file. I'll relay both reports, most severe findings first, when the reviewers finish.

The `runs.md` review is back. The `findings.md` reviewer is still running, so I have no result for it yet.

Reviewed: docs/system/runs.md sha256 9f62718f45ead4836dce586d616c57c30fdbc4fff148d302cd579a27855a5b88

**Verdict: PASS** (binds to the digest above). The added sentence is true of the code, and only OBS findings remain.

**Findings, most severe first**

1. **OBS** (confidence medium): the sentence says the host "reports no final text", but the host does see the final text.
   - Text: "The Claude host reports no final text, so for it only the waiting file and the VERIFICATION status signal a pause." (`docs/system/runs.md:229`)
   - Evidence:
     - The Claude host returns an outcome with no `question` field (`src/adapters/host-claude/claude-host.ts:244-268`). The field is optional in the port (`src/ports/agent-host.ts:68`).
     - The supervisor passes `outcome.value.question` to the pause detector only when it is defined (`src/app/run-stages/item.ts:201-203`).
     - The transcript still holds the final text as a stored artifact (`claude-host.ts:238-242`).
     - `LIVE-CASES.md:282` words it as "hands no final text to the pause recogniser".
   - Fix: say what the host hands over. For example: "The Claude host hands no final text to the supervisor, so for it only the waiting file and the VERIFICATION status signal a pause."

2. **OBS** (confidence low): "Claude host" appears nowhere else in `runs.md`, which says "the host" (7 matches). A reader may wonder whether other hosts exist. If the opening already names the Claude host as the only built host, the term is fine. If not, name it once there. This is optional.

**Checked and clean**
- **Code claim.** The numbered-choice branch fires only when `finalTextTail` is set (`src/domain/outcome.ts:114`). The supervisor sets it only from the outcome's `question` (`item.ts:203`). So for the Claude host only the waiting file and `human_needed` can signal a pause.
- **Live evidence.** `LIVE-CASES.md:238-240` and `:282` agree with the sentence. The routable-question cases failed 0/3 because the sessions made the edit instead of asking.
- **Prose rules.** The sentence has no file paths, function names or delivery history, and no banned dashes or constructions. It is 22 words.
- **Not checked.** The reviewer did not open `live-attended-phase2.jsonl`, because this sentence makes no claim about it.
- **Read-only.** The reviewer edited no files.

I'll relay the `findings.md` report, with its digest and verdict, when it arrives.

Both reviews are in. `findings.md` bounces and `runs.md` passes. The `runs.md` report is in my previous message.

Reviewed: docs/system/runs.md sha256 9f62718f45ead4836dce586d616c57c30fdbc4fff148d302cd579a27855a5b88
Reviewed: docs/system/findings.md sha256 a3c7b280dee2e11abc89e49cb1412d4f568067ad8dc682401dbb5d2a5c89d0e7

Verdict: **BOUNCE**. This verdict is for `findings.md`, bound to the digest above, and it has no BLOCKERs. The two WARNINGs on accuracy are what bounce it. Together with the `runs.md` PASS, the overall result is BOUNCE until `findings.md` is fixed and re-reviewed.

## FINDINGS for findings.md

1. **WARNING:** the line-36 finding blames the skill text for sessions that never loaded it.
   - Text: `findings.md:140`, "was not followed in any of 3 attended sessions: each session made the edit instead of asking".
   - Evidence: `LIVE-CASES.md:253` and `:259` record "skill not invoked" for `routable-question-1` and `-3`. Row `:256` does not say either way. `LIVE-CASES.md:272` makes the same caveat for stop-on-denial.
   - Fix: state the exposure, for example "in at least 2 of the 3 the skill was never invoked, so the line was not in front of the model". Then "Intent unknown: revise the text, or accept" is an informed choice.

2. **WARNING:** the first new finding claims something no session showed.
   - Text: `findings.md:138`, "A real attended session phrased in that shape is recognised by the recogniser".
   - Evidence: no attended session produced the shape. `LIVE-CASES.md:267` and `:273` record 0 of 3 and "No session asked". Line 140 says the same, so line 138 contradicts its neighbour.
   - Fix: replace the claim with "the recogniser classifies a final text of that shape as a `numbered-choice` pause (`src/domain/outcome.ts:94` to `:114`)". Drop "real attended session".

3. **WARNING:** sentences exceed the 35-word hard cap in the style reference.
   - Text: `findings.md:138`, `:139`, `:140` and `:255` each run about 40 to 70 words with a semicolon chain. The first sentence of line 138 is about 44 words, and that of line 139 about 43.
   - Fix: split at the semicolons and the parenthetical. For line 255, write "(intent unknown)", then: "This no longer holds: a live suite now runs the installed skill in attended sessions (`test/containment/live-attended-skill.test.ts`) and judges status first, a stop on a denial and the shape of a question. The contained-run half of that row still has no harness."

4. **OBS:** the order in `findings.md:139` is slightly off.
   - Text: "in the other 3 the session loaded the skill and ran `git` or `grep` commands before `avarice status`".
   - Evidence: `LIVE-CASES.md:254` and `:271` show `status-first-3` ran its `git` and `grep` command before it loaded the skill.
   - Fix: drop the skill-loading clause, or write "(in one case before loading the skill)".

5. **OBS:** the amended line at `findings.md:255` stacks two parentheticals, "(intent unknown) (no longer holds: ...)".
   - Other "no longer holds" entries in the file pin a commit, for example `at 72a86b1`. This one pins none, so a reader cannot tell when it stopped holding.
   - Fix: add the commit or the date.

## Verified correct
- **Counts and verdicts.** All match `live-attended-phase2.jsonl` and `LIVE-CASES.md:250-267`.
  - Status first: 1 of 4 judged sessions, FAIL. The invalidated first `status-first-1` record is correctly excluded.
  - Routable question: 0 of 3, FAIL.
  - Stop on a denial: 3 of 3, PASS.
- **Line numbers.** All are exact: `claude-host.ts:244`, `item.ts:203`, `avarice-run-skill.ts:32` and `:36`, `docs/extensions.md:215`, and `agent-host.ts:68`.
- **Amended line 255.** The live suite does judge status first, a stop on a denial and the shape of a question. No harness exists for the contained-run half; only fake-host integration tests cover pause endings.
- **Prose rules.** The banned dash forms are absent, and the "no longer holds" parenthetical matches the file's own convention.
- **Read-only.** The reviewer edited no files.

I applied no fixes. Any edit to `findings.md` voids this verdict, so the edited file needs a fresh review against its new digest.
