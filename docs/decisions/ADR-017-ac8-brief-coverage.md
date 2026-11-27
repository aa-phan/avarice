# ADR-017: Count an AC-8 run that skips part of its brief as partial

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Deciders** | Aaron Phan (owner) |

## Context

The context retrieval evaluation (requirement AC-8) judged a task a success when every required check passed and a held-out test taken from the replayed commit passed. ADR-015 records the setup and the first result, and ADR-016 re-judges that result at a new token bound. Both report the same success counts: arm A 2 of 6, arm B 4 of 6, arm C 4 of 6.

The owner spot-checked the successful runs and found two judged successes, one of arm B on task T01 and one of arm A on task T05, that delivered unit tests where their briefs also asked for end-to-end coverage. The run summary of T01 arm B says that no end-to-end or browser test was written, as instructed. Two causes together produced the over-count, and either alone would not have:

- **The brief told every run to skip the work.** The harness appended a scope paragraph to each brief that put any end-to-end or browser test out of scope and told the run not to write it, not to ask, and not to stop. The paragraph sat directly under brief bullets that asked for such tests. The host copied it into its planner, plan checker, executor and verifier prompts, so each gate that could have flagged the missing test was told not to. Without the paragraph the verifier would have recorded a gap and the run would have stopped on a decision.
- **The judge did not compare the result with the brief.** Success was the required checks and the held-out unit test. The end-to-end specs were denied reads, no required check ran them, and the held-out test was a unit test, so no check could notice a skipped bullet.

The owner decided on 2026-11-23 to count such a run as partial, to re-judge the recorded runs from recorded data, to restate the figures ADR-015 and ADR-016 report, and to amend the success rule with the decision recorded. The owner also set the limits: no new evaluation spend, no re-run, and the briefs not stripped of their end-to-end bullets.

Reading each of the 18 recorded runs against every bullet of its brief gives 9 bullets that were not fully delivered, in 9 runs. Every one is judged partly delivered: the run wrote the unit tests the bullet names and edited no end-to-end test file. No bullet was skipped outright. Of the 10 recorded successes, 5 are partial. The other 4 runs with an undelivered bullet had already failed their required checks or the held-out test, and they stay failures.

## Decision

1. We amend the success definition. A task succeeds when every required check passes at the end of the run, the held-out test copied from the target commit after the agent finishes passes, and the run delivered every bullet of its brief, as the brief-coverage record of the run states. A run whose required checks and held-out test pass but which skipped or only partly delivered a bullet of its brief is partial. It is not a success, it is not a failure of its checks, and it is not counted as a success. Reviewer judgment beyond the brief's bullets stays a sampled owner spot-check, not a gate. The wording is the owner-approved amendment file, which is pinned to the digest of the unedited task list.
2. We keep a brief-coverage record: for each recorded run, every bullet of its brief with a status (delivered, partly, skipped) and the evidence for it. The rules were fixed before judging and are the same for every arm. A bullet that asks for tests of one or more kinds is delivered only when the run edited a test file of each kind it names, partly when it edited some of the kinds, and skipped when none. A bullet that asks for behavior or a code change is delivered when an edit implements it as stated. A run with no source edit has every bullet skipped. A run that recorded a failure is judged by the same rules and stays a failure. The owner reviewed every partly delivered bullet with its evidence and approved the record and the amendment as drafted on 2026-11-25.
3. We keep the 18 recorded runs and re-judge them under this definition with no spend and no re-run, and the briefs of those runs are unchanged. The harness computes the re-judgement from the recorded results, the approved task list, the coverage record and the approved amendment, refuses a mismatch of any of their digests, and writes nothing. The task list and the results file are not edited.
4. We change the brief text for future runs only. The scope line still names the checks that can run. It now says that an end-to-end or browser test the brief asks for cannot be run in the environment, and that it is still part of the change: the run writes it as the brief asks, does not try to run it, and does not stop to ask about running it. The 18 recorded runs were given the earlier text.
5. We restate the figures from the re-judgement, recorded beside the figures ADR-015 and ADR-016 report:

   | Arm | Runs | Successes recorded | Successes now | Partial | Tokens | Share of A |
   |---|---|---|---|---|---|---|
   | A | 6 | 2 | 0 | 2 | 19,833,920 | 100% |
   | B | 6 | 4 | 2 | 2 | 18,715,894 | 94.4% |
   | C | 6 | 4 | 3 | 1 | 17,557,851 | 88.5% |

6. AC-8 passes through arm B, as it did under ADR-016: arm B succeeds at least as often as A, at 94.4% of A's tokens, inside the 95% bound. Arm C, at 88.5%, also qualifies, and the verdict names B because B is judged first. The pass rests on the token bound. With arm A at 0 successes, the success clause holds for any pack arm whatever it delivered, so B and C do not beat A on success in any way the measurement can show.
7. The D-08 rule keeps the knowledge pass on, now for a different reason. ADR-015 kept it on because arm C cost fewer tokens than arm B. Under the new counts arm C also succeeds more often than B, 3 runs against 2, so the rule's first condition fails: C shows a success gain. `adapters.knowledgePass` keeps its default of true.
8. This supersedes the success definition of D-07 and the success rule in the task list, and the success counts that ADR-015 and ADR-016 report. Their decisions stand: the knowledge pass is on by default, and the AC-8 token bound is 95% of the baseline's tokens. Neither of those ADRs is edited.

## Consequences

**Positive:**
- An AC-8 success means the run delivered what its brief asked. The figures say what the runs did, and a later run is judged by the same rule.
- The run instructions no longer forbid work the brief requires, so a future run is not told to skip a bullet and then judged on the rest.
- Closing the discrepancy costs no evaluation spend.

**Negative:**
- The baseline has no success under the new definition: 0 of 6, against 2 of 6 recorded. The success clause of AC-8 then holds trivially for B and C, and the evaluation no longer shows that a pack arm helps a run succeed, only that it does not cost more than 95% of A's tokens. Owner: Aaron Phan.
- Coverage is judged by reading the recorded edits of each run, not by running an end-to-end test. A bullet counts as delivered when the run edited a test file of the named kind, and the record does not show that the test would pass. The judgments were made by an AVARICE agent and approved by the owner, and two of them were close calls shown to the owner: a strict year-and-month reading of one brief (arm A on T04, a recorded failure, so the count is unchanged), and the first bullet of T05 counted as delivered through a `sizes` attribute. Owner: Aaron Phan.
- The count of full successes is smaller: 5 of 18 runs, against 10 recorded. One task moves an arm's count by 17 points, so the 2, 2 and 3 successes of the three arms are within one task of each other, and the ranking of B and C is one run. The knowledge-pass outcome now depends on that one run. Owner: Aaron Phan.
- The recorded runs were told to skip the end-to-end work and were judged partial for skipping it. The partial count measures the instruction as much as the arm, and no run under the corrected brief exists. Whether a run given the corrected text writes the end-to-end test, and whether the host then stops on a decision, is unmeasured. Owner: Aaron Phan.
- The consequences listed in ADR-016 still apply: the pass is one measurement of 6 tasks on one repository, arm B clears the bound by 0.6 points, the recorded runs did not run under the whole-file read caps now enforced, and four harness defects stay open before any further AC-8 run.

**Neutral:**
- The recorded results file and the task list stay byte-identical. The amended rule lives in its own file, so a reader can compare the original and the amended rule.
- The re-judgement is a committed file that a unit test compares with the harness output, so the figures here are recomputed on every test run.

## Alternatives considered

**Re-run the tasks with the corrected brief.** For: it measures what each arm does when the brief no longer forbids the work, and it would give full successes instead of partial runs. Against: it costs about 12 USD for each 18-run evaluation out of the evaluation's spend ceiling, needs the owner's authorization at a terminal, and the host may then stop on a decision for the end-to-end bullet that it cannot verify. Why not chosen: the owner set no new spend. The option stays open as a later decision.

**Strip the end-to-end bullets from the briefs.** For: the brief and the judge would then agree, and every run would be judged on work the harness can check. Against: it changes the task the arms were given after the result is known, and it drops the part of the replayed change that the harness cannot judge. Why not chosen: the owner chose to keep the briefs as approved.

**Exclude the affected runs from the counts.** For: the arms would be compared on runs that delivered their brief, with no run counted for a result it did not earn. Against: it leaves arms with different numbers of runs, which the verdict arithmetic does not compare, and it removes 5 of the 18 runs from the evidence. Why not chosen: the owner chose to count the run as partial.

## References

- The re-judgement under this decision: `test/benchmark/phase4/eval-verdict-adr017.json`. The coverage record: `test/benchmark/phase4/eval-coverage.json`. The amendment: `test/benchmark/phase4/eval-success-amendment.json`.
- The recorded results and the approved task list, both unchanged: `test/benchmark/phase4/eval-results.json` and `test/benchmark/phase4/eval-tasks.json`. The ADR-016 re-judgement, unchanged: `test/benchmark/phase4/eval-verdict-adr016.json`.
- ADR-015 for the evaluation setup, the owner rulings and the knowledge-pass decision, and ADR-016 for the token bound.
- The diagnosis of the over-count: `.planning/debug/ac8-success-ignores-brief.md`.
- The harness: `scripts/eval-retrieval.ts` (`rejudgeWithCoverage`, `loadCoverage`, `loadAmendment`, `briefFor`). The test: `test/unit/eval-retrieval.test.ts`.
- The evaluation section of `docs/operations-and-testing.md`.
