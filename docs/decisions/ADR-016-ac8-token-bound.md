# ADR-016: Set the AC-8 token bound at 95% of the baseline's tokens

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-22 |
| **Deciders** | Aaron Phan (owner) |

## Context

Requirement AC-8 asks that a task success rate with the context pack, index adapters present, is at least equal to a full-repo baseline's at no more than 50% of the baseline's tokens. The context retrieval evaluation measured it over 6 tasks of one repository, one run per task and arm. Arm A is the baseline, arm B is the pack from the code indexes only, and arm C is the same pack with the knowledge graph. ADR-015 records the setup, the three owner rulings that shrank the task set, and the result.

| Arm | Successes | Tokens | Share of A | Mean tokens per run |
|---|---|---|---|---|
| A | 2 of 6 | 19,833,920 | 100% | 3.31 M |
| B | 4 of 6 | 18,715,894 | 94.4% | 3.12 M |
| C | 4 of 6 | 17,557,851 | 88.5% | 2.93 M |

B and C each matched A's success with twice its successes. Neither came near 50% of A's tokens, so AC-8 failed as worded. ADR-015 left the next step to the owner: the 50% bound is wrong for this system, the pack must shrink, or the requirement changes.

Three facts bear on that choice. All 18 runs ended in `ready_for_review` or `blocked_on_decision` with complete token counts, and every arm ran 6 tasks, so the known arithmetic defects of the harness do not change the figures above. The pack budget is 24,000 tokens per run, under 1% of a run's 2.9 to 3.3 million tokens, so shrinking the pack cannot reach 50%; reaching it takes an agent that reads less. The recorded runs predate the enforcement of the whole-file read caps (20 files and 256 KiB per run), so they were not measured under those caps.

The measured data was in hand when the bound was chosen. The evidence of the 18 runs is kept apart from the results file, and a scan of their transcripts found no read of the held-out test through git history.

## Decision

1. We change the token clause of AC-8 to: a pack arm matches the baseline's success with no more than 95% of the baseline's tokens. The bound is inclusive: exactly 95% passes and one token over fails. The success clause is unchanged: the pack arm's success rate is at least the baseline's.
2. The evaluation harness states the bound as one named constant, `AC8_TOKEN_BOUND_PERCENT`, and compares in whole numbers. It can judge a results file again at the current bound without a model call and without spending; the recorded results file is read and never rewritten.
3. Judged at 95%, the recorded evaluation passes through arm B at 94.4% of A's tokens. Arm C, at 88.5%, also qualifies, and the verdict names B because B is judged first. The re-judgement is recorded in its own file, apart from the recorded results.
4. This supersedes only the consequence of ADR-015 that leaves the requirement unmet. ADR-015's decision on the knowledge pass is unchanged: the pass stays on by default, because arm C shows no success gain over B and does not cost more tokens.

## Consequences

**Positive:**
- AC-8 states what this system measured and what its owner accepts: a pack that matches or beats the baseline's success at a lower token count.
- The requirement, the harness and the roadmap state one bound, and a later run is judged by it with no manual arithmetic.
- No evaluation spend is needed to close the requirement.

**Negative:**
- The requirement no longer asks for a large saving. A pack arm that saves 5% of the baseline's tokens passes. The claim that retrieval makes a run read half as much is dropped, not met. Owner: Aaron Phan.
- The bound was set after the result was known, and arm B clears it by 0.6 points. A fresh draw of the same 6 tasks could put B over 95%, and a reader should treat the pass as one measurement, not a margin. Owner: Aaron Phan.
- The sample is small: 6 tasks on one repository, one run per task and arm, so one task moves a success rate by 17 points. Three of arm A's four non-successes ended on a verifier or gate stop, which lowers A's rate and helps the success clause for B and C.
- The recorded runs did not run under the whole-file read caps now enforced. A measurement under the caps could differ, and none is planned. Owner: Aaron Phan.
- Four defects of the harness found in review (infrastructure outcomes counted in the summary, totals compared across unequal task counts, an error in the judge step dropping a paid run, and old held-out files kept in the arm repositories' history) stay open. They do not change this verdict, and they stay open before any further AC-8 run.

**Neutral:**
- The proposal text in the requirements document changes only through this decision.
- The knowledge pass keeps its default and its configuration switch.

## Alternatives considered

**Make runs read less, then run the evaluation again at 50%.** For: it keeps the original requirement and might find a real token saving, since the tokens are in what the agent reads, not in the pack. Against: it needs its own engineering first, then about 12 USD for each 18-run evaluation out of the 23.98 USD left in the Phase 4 spend ceiling, authorized by the owner at a terminal, and it may still fail. Why not chosen: the owner judged the 95% bound the right statement of what the system must do for now; the option stays open as a later decision.

**Accept the failure and defer AC-8 to a later phase.** For: it changes no proposal text and records the failure as measured. Against: the phase would close with a known unmet acceptance criterion and a deferral target to name and keep. Why not chosen: the owner chose to state the bound the system can meet, not to carry an unmet criterion.

## References

- The recorded results: `test/benchmark/phase4/eval-results.json`, unchanged by this decision. The re-judgement at the new bound: `test/benchmark/phase4/eval-verdict-adr016.json`.
- ADR-015 for the evaluation setup, the measured result and the knowledge-pass decision.
- The requirement row AC-8 in `docs/requirements.md`.
- The harness: `scripts/eval-retrieval.ts` (`AC8_TOKEN_BOUND_PERCENT`, `verdict`, `rejudgeResultsFile`).
