# S3-A: the live pause and resume of a real `/gsd-quick --validate --text` unit (plan 03-13, RESEARCH A2, A3, A4, A10)

Harness: `test/helpers/live-harness.ts` (`runLiveRunUnit` with `resume` and `resumeOnly`, `spike3Refusal`, `SPIKE3_PLAN`, `SPIKE3_TOTAL_CAP_USD`, `promptItemOf`), suite `test/containment/spike-pause-resume.test.ts` (tests `round-1 pause`, `round-1 resume`, `missing-session`, `round-2 pause`, `round-2 resume`; all skipped unless `AVARICE_LIVE=1`).
Results file: `test/containment/live-run-phase3-spike.jsonl` (cited below as "results line N"). Spend ledger: `test/containment/live-spend-phase3.jsonl` (plan `03-13`).
Host: Claude Code 2.1.319 (admitted in plan 03-01), model `sonnet`, real `ClaudeHostAdapter`, purpose `run`, owner kind `run`, the launch line of plan 03-08 (`--resume <id>` in place of `--session-id <id>`, every containment flag kept).
Scratch project: `makeRunRepo()` (the `slugify` of S2-B), onboarded with the fake host, conventions committed, started through the real `startRun`, run clone prepared at the pin. The brief has two items: A (collapse repeated dashes, independent, one line) and B (the fallback word for a title with no letters or digits). B's criterion AC2 reads that the owner chooses between the wordings `untitled` and `page` and that the unit must ask the owner and must not pick one. Only item B was run. The prompt was `runUnitPrompt(contract, '', itemB)` with the `RUN_DECISION_SENTENCE` of plan 03-08, and the resume prompt `runResumePrompt('1', itemB)`.
Spend guard: every start is refused unless the Phase 3 ledger plus the cap stays within 25 USD (D-05) and plan 03-13's own recorded spend plus the cap stays within 4.00 USD (`spike3Refusal`). The resume is guarded the same way before it starts.

## 1. Why the resume runs inside one harness call

A host session belongs to the working directory it was started in, so the resume has to use the same fixture and clone as the first invocation. `round-1 pause` and `round-1 resume` therefore share one `runLiveRunUnit` call (a pause, then a resume of its session with the answer `1`); each test records its own results line. `missing-session` is its own call with no first unit (`resumeOnly`).

## 2. Rounds

Only round 1 was run. Round 2 exists to change `RUN_DECISION_SENTENCE` once if round 1 shows a silent pick, and round 1 did not (A3 below), so `RUN_DECISION_SENTENCE` is unchanged and the `round-2` tests never ran.

| Test | Results line | Outcome kind (classifier) | Result event | Exit | Cost (USD) | Cap (USD) |
|---|---|---|---|---|---|---|
| `round-1 pause` | 1 | `no_progress` | `success`, `is_error` false | 0 | 0.0617 | 1.50 |
| `round-1 resume` | 2 | `denied` | `success`, `is_error` false | 0 | 0.8795 | 1.50 |
| `missing-session` (first run) | 3 | `failed` | `error_during_execution`, `is_error` true | 1 | 0 | 0.10 |
| `missing-session` (re-run, adds `numTurns`) | 4 | `failed` | `error_during_execution`, `is_error` true | 1 | 0 | 0.10 |

Spend of plan 03-13: 0.9412 USD of its 4.00 USD cap (ledger lines `round-1`, `round-1-resume`, `missing-session` twice). The Phase 3 ledger total after the plan is 1.0927 USD of 25 USD.

### Round 1 pause (results line 1)

Ground truth, from the outcome fields, the clone and the ledger:

| Fact | Value |
|---|---|
| Session ID reported | `83cd7539-d8f6-4e43-8739-95fc3994eae5` |
| Tool calls / subagents / `AskUserQuestion` | 0 / 0 / not called |
| Hook decisions | 0 (no tool was called) |
| `outcome.question` | present, 356 characters (the text is not stored: T-03-23) |
| `detectPause` on `outcome.question` | `paused`, signal `numbered-choice` |
| Changed paths in the clone | none |
| Quick directory | absent (no PLAN, no SUMMARY) |
| `src/slug.ts` contains `untitled` or `page` | no (digest `sha256:13f5ab23...`, the pin's file) |
| Clone HEAD before and after | equal |
| User's repository | unchanged |
| Duration | about 6 s (line 1 `durationMs` 204820 includes the resume that followed; the first invocation's own time is that minus the resume's 198952) |

The unit stopped before it ran any workflow step, made no edit to the owner-choice behaviour and ended with a question line followed by numbered choices, which the host outcome carried and `detectPause` read as a pause.

Transcript artifact digest: `sha256:b6936965b836dfb8801c0da1840a813d8db3707197ca52c4536da76e7852d44b`. The first version of the suite deleted its evidence directory at the end of the run, so the transcript bytes of the pause and the resume are gone; the digests, the results lines and the clone facts above were recorded before the deletion. The suite now keeps the evidence directory, as S2-B did.

### Round 1 resume (results line 2)

| Fact | Value |
|---|---|
| Session resumed / session reported | the pause's session, the same session |
| Host started (the launch line was accepted by the adapter's `assertLaunchArgsSafe` and by the host) | yes |
| Result event | `success`, `is_error` false, exit 0 |
| Cost | 0.8795 USD against a fresh 1.50 USD cap (the pause cost 0.0617 USD) |
| Tool calls | 40 (Bash, Read, Agent, Write, Edit); `AskUserQuestion` not called |
| Hook decisions in the resumed invocation | 33 allowed, 6 denied: `shell-syntax` 5, `shell-not-allowed` 1 (the improvised compound shell lines S2-B also met); no denial names a read-before-edit rule |
| Edit and Write calls | 6, of which 3 follow a `Read` of the same path in the same invocation; the run scope turns the hook's read-before-edit rule on (`readBeforeEdit: true`), the hook keeps its read record per invocation, and none of the 6 was denied |
| Changed paths | `.planning/STATE.md` (modified), `.planning/quick/20261108-slug-fallback-word/PLAN.md` (added), `.planning/quick/20261108-slug-fallback-word/SUMMARY.md` (added), `src/slug.ts` (modified), `test/slug.test.ts` (modified) |
| Writes outside the write set | none |
| `src/slug.ts` contains a fallback word | yes (the unit finished the item) |
| VERIFICATION file | none was written (`verificationStatus` null) |
| Final text | 1465 characters; `detectPause` reads it as not paused |
| Clone HEAD | unchanged (no commit by the model) |
| User's repository | unchanged |

Transcript artifact digest: `sha256:c23cd31ee4ad6b06ca25c68692438f61f2c4a77bd046b1bae4343b7bcd1e4769` (bytes deleted, see above).

### Missing session (results lines 3 and 4)

`--resume` of a random UUID, started through the same adapter. Line 4 is a re-run, repeated because line 3 predates the `numTurns` field. The re-run's evidence directory is kept (`avarice-cli-YaRwNJ` under the system temporary directory).

| Fact | Value |
|---|---|
| Host started (launch marker) | yes |
| Result event | **printed**: `type: result`, `subtype: error_during_execution`, `is_error: true`, `num_turns: 0`, `total_cost_usd: 0`, `errors: ["No conversation found with session ID: <id>"]` |
| System init event | none; the stream is the one result event |
| Exit code | 1 |
| Adapter outcome | kind `failed`, `details.resultSeen` true, `details.isError` true, `details.subtype` `error_during_execution`, `details.numTurns` 0, cost 0 |
| Time | about 1 s; no model call |
| The host's no-conversation message | in the result event's `errors` array of the stored transcript, and on standard error (which the adapter drops) |
| Clone changes | none; user's repository unchanged |
| Transcript digest (line 3 / line 4) | `sha256:84b2c0671d2c2da670bb7bf3e6d9e84b17d9c5b27c8a021589442d7ca906552b` / `sha256:9b96efe21df7bfb2f2926dbfef9d67c8b7fa25c16e31e2e39cece4031d1818f6` |

The plan expected this ending to have no result event. It does have one. A model-free probe of the installed CLI before the run (a direct `claude -p --resume <random UUID> --output-format stream-json`, no model call, cost 0) gave the same event, so the shape is the host's own and does not come from the harness.

## 3. Verdicts

**A3: confirmed (one round, one sample).** Round 1 pause ended with `questionPresent` and `pauseSignal: numbered-choice` (results line 1), the clone has no change and `src/slug.ts` has neither wording, so the unit asked and did not choose. The question is a numbered-choice final text, and the host outcome's `question` carries it. `RUN_DECISION_SENTENCE` is not changed. Caveat: the unit asked before it ran any tool, so a quick unit that must ask may leave no PLAN and no quick directory behind.

**A2: confirmed.** The paused session relaunched with `--resume <session>` under the full launch line: the host started and answered (results line 2), the hook ran in the resumed invocation (33 allowed, 6 denied), the result event was `success`, nothing was written outside the write set and the clone's HEAD did not move. The resumed unit finished the item (`src/slug.ts` and the test changed, a SUMMARY written). The classifier called it `denied` because of the 6 hook denials, the same as S2-B finding 3, so a run must judge a resumed unit from the clone and the gates, not from `kind`. Caveat: no VERIFICATION file was written in this sample, so a `required-passed` verifier gate would have read `missing` for this resumed unit.

**A10: confirmed in the sense the plan sets, with one part not separable.** The resume ran with `--max-budget-usd 1.50`, resultSeen was true and 0.8795 USD was charged against it (results line 2). Whether the host counts that cap from zero or against the session's running total (0.0617 USD at the pause) cannot be told apart at these numbers; the ledger records the host's reported value, which can only over-count. Re-read before editing: the hook enforced it per invocation and denied none of the resumed unit's 6 edits.

**A4: the PLAN cited the item's acceptance ID, and `PLAN_CITES_ACCEPTANCE_HARD` stays false.** The only PLAN of the spike (written after the resume, results line 2) cites `AC2`, the item's one acceptance ID (`citesAllItemAcceptance` true). The plan's own rule sets the constant true only when both rounds' plans cite every acceptance ID; one round ran, the PLAN was written after the owner's answer had settled the choice, and the pause left no PLAN at all. How the planner marks a `checkpoint:decision` was not observed: the PLAN has 0 decision checkpoints, because the unit asked in its final text instead. One sample does not show that a hard gate will not fail a real run, so the gate stays an advisory. Setting it true is a one-line change in `src/domain/gates.ts` and `test/unit/gates.test.ts` once a second live PLAN cites its item's IDs.

**Missing session.** A resume of an unknown session ends **with** a result event: `error_during_execution`, `is_error` true, 0 turns, 0 cost, exit 1, and the host's no-conversation message in the event's `errors` array. The adapter reports it as kind `failed` with `resultSeen` true. There is no "no result" ending to detect.

## 4. What changed in code

- Harness and suite only: `SPIKE3_PLAN`, `SPIKE3_TOTAL_CAP_USD`, `spike3Refusal`, `RunUnitSpec.resume`, `resumeOnly`, `itemId` and `probe`, `PrepareRunUnitOptions.brief`, per-invocation `CloneFacts`, `ResumedUnit` and `promptItemOf` in `test/helpers/live-harness.ts`; `test/containment/spike-pause-resume.test.ts`.
- `RUN_DECISION_SENTENCE` and `PLAN_CITES_ACCEPTANCE_HARD`: unchanged. Only a comment in `src/domain/gates.ts` now records this spike's measurement.

## 5. What plans 03-18 and 03-22 must assume

- **03-18 (the pause in the run).** A unit that must ask may make no tool call: no quick directory, no PLAN, no SUMMARY, classifier kind `no_progress`. The pause must be read from `outcome.question` (`detectPause`, signal `numbered-choice`), not from any file, and G1 must not read an absent PLAN of a paused unit as a failure.
- **03-18 (the resumed unit).** It can finish with kind `denied` after improvised compound shell lines are denied, and it can leave a PLAN and a SUMMARY and no VERIFICATION. Judge it from the clone, the quick files and the gates. The sample's resume cost 0.88 USD, so a resume needs a cap of the same order as a whole unit, not a fraction of one.
- **03-18 (G1).** `PLAN_CITES_ACCEPTANCE_HARD` is false: the rule stays advisory.
- **03-22 (a refused resume).** The trigger for the fresh-unit fallback is a resumed request whose outcome is kind `failed` with `resultSeen` true, `isError` true, subtype `error_during_execution`, `numTurns` 0, cost 0 and exit code 1. It is not "no result event". The adapter does not hand over the host's message text, so the trigger has to be these structural fields. The failed resume left the clone and the user's repository unchanged and cost nothing.
