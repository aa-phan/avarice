Reviewed: docs/system/runs.md sha256 501c8a8ff9e3510f1b39ff51981057a21e346ed076b02568dcb3491b99d7473f
Reviewed: docs/system/findings.md sha256 ecdb59157692a1dc3bcf4ff76fc3d0087f4bf5047047c3bb371d27f7d0708e11

Both digests match the expected values. I reviewed these myself and did not dispatch the `prose-reviewer` agent, as you instructed. I changed no files.

**Verdict: PASS** for both documents, with the observations below. A Bash permission denial stopped one scripted JSONL parse. I covered that data with Grep and Read instead, so the check on the third finding is partial (see OBS 1).

## FINDINGS

No BLOCKER or WARNING findings.

**OBS 1 — findings.md:11 (routable-question claim).** The claim is "no final message was a numbered-choice pause".
- **Evidence:** The JSONL verdict `reason` for all three sessions is only "src/slug.ts changed". The no-pause fact rests on `finalTextTail` and on the LIVE-CASES prose. I read the tails of cases 2 and 3 in the JSONL and they are prose, not numbered options. The tail for case 1 was truncated in my output. LIVE-CASES records its ending as "run `npm test`".
- **Fix:** Optional. Cite `test/containment/LIVE-CASES.md` ("Cases" table) next to the JSONL. Or name the 0/3 `attended routable-question` verdict, which is how the recogniser's result is reported.

**OBS 2 — findings.md:252 (extensions.md row split).** The new line splits the row's two halves between "contained runs" and "attended sessions". The attended harness also measures the routable-question behavior, which the row assigns to the contained half.
- **Evidence:** `test/containment/LIVE-CASES.md` lists `routable-question-1` to `-3` as attended cases. `docs/extensions.md:215` names "10 contained runs" for pause questions.
- **Fix:** Optional. Say "the row's attended half, including the routable-question sessions, is run by `test/containment/live-attended-skill.test.ts`". Keep the contained-run harness as "not found".

**OBS 3 — findings.md:9 (length and repetition).** This line is long and says twice that no final text reaches the recogniser: "reachable only from a host that reports final text" and "nothing hands it a Claude host's final text". It is accurate but could be one sentence shorter. No suggested change affects the facts.

## Verified claims

**Code citations in findings.md:9**
- `claude-host.ts:244` is the `return ok({` block. It has no `question` field.
- `item.ts:201` reads `outcome.value.question`, and `item.ts:203` calls `detectPause`.
- `agent-host.ts:68` declares `question?`.
- `outcome.ts:94` to `:115` covers `endsInNumberedChoice` and `detectPause`, including the `numbered-choice` signal.
- A search of `src` finds no producer of `question` in any host.
- `docs/extensions.md:12` is the Skill row, and it says the skill teaches "how to phrase a question so the supervisor can route it".
- `avarice-run-skill.ts:32` is the status-first line and `:36` is the question line.

**JSONL data behind findings.md:10 and :11**
- **Status-first:** The re-run of `status-first-1` passed and the first run carries an invalidation marker, so the denominator is 4 judged sessions with 1 pass.
- **Skill load order:**
  - In `status-first-2` and `status-first-4` the Skill call came before `git` and `grep`.
  - In `status-first-3` the `git` and `grep` command came before the Skill call.
  - So the skill was loaded first in 2 of the 3 failures.
- **Routable-question:** The routable-question sessions all show an `Edit` or write on `src/slug.ts`. `skillInvoked` is false in cases 1 and 3 and true in case 2, so the skill was never invoked in 2 of the 3.

**runs.md:229**
- The sentence is accurate, because `item.ts:203` is the only caller. It contains no file path, function name or delivery history, which complies with `CLAUDE.md`.
- It does not mention the `stateNeedsHuman` signal. `item.ts:203` never passes that signal, so leaving it out is correct for runs.
