# ADR-015: Keep the knowledge pass on by default

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-20 |
| **Deciders** | aa-phan (owner decision D-08 set the rule; the outcome follows from the rule and the measured result) |

## Context

Onboarding can build a knowledge graph on top of the code graph: a model reads the repository's documents in chunks and extracts nodes and edges from them (the knowledge pass). It is the only model-paid part of the index stage. The profile key `adapters.knowledgePass` switches it, and its default is true. Owner decision D-08 fixed the rule for that default before any measurement: the knowledge pass stays on unless the with-knowledge arm shows no task-success gain over code-only and also costs more tokens, and the outcome is recorded as a decision record either way.

The measurement is the context retrieval evaluation (requirement AC-8). The proposal describes two arms: the pack built from the code indexes, and a baseline of the repository's GSD codebase map plus the files the agent finds itself. Owner decision D-07 made it three arms so that the knowledge pass could be judged on its own.

- **A** is the baseline (D-06): no AVARICE pack, and the agent works from the GSD codebase map and what it finds.
- **B** is the pack from the code indexes only, with the knowledge pass off.
- **C** is the same pack with the knowledge graph, with the knowledge pass on.

AC-8 passes when a pack arm matches the success of A at no more than 50% of A's tokens. A task succeeds when the required checks pass and a held-out test taken from the replayed commit passes. Each arm ran each task once, in its own repository at the task's parent commit, and the held-out test was added only after the agent stopped.

The task set shrank by three owner rulings, each recorded before the spend that depended on it. The approved list held 20 replayed commits from the owner's repositories. The first ruling cut it to 9 tasks ("authorize balanced-9 pilot 11.70 total 33.00."). An offline probe then showed that 6 of those 9 cannot succeed in this harness for any arm, whatever the retrieval: three need Python packages the harness's interpreter lacks, and three need a Postgres database in the test setup. The second ruling cut the set to the 6 tasks of one repository, the portfolio ("diagnose, then portfolio-6"). The third ruling ("keep evidence, diagnose") added the capture of each run's records and led to a diagnosis of the first attempt's stop, which was the brief given to the agent, not the product. That was fixed for every arm, and the 18 runs of the final set all ran.

The measured result, from the results file, with tokens as the host reported them for the runs' own invocations:

| Arm | Successes | Tokens | Share of A | Mean setup cost per project |
|---|---|---|---|---|
| A | 2 of 6 | 19,833,920 | 100% | 0.19 USD (onboarding and generating the GSD map) |
| B | 4 of 6 | 18,715,894 | 94.4% | 0.12 USD (onboarding) |
| C | 4 of 6 | 17,557,851 | 88.5% | 0.83 USD (onboarding with the knowledge pass) |

Setup is reported apart and is not in the verdict.

## Decision

1. We record that AC-8 failed. B and C each match A's success, with twice its successes, but neither stays within 50% of A's tokens: B uses 94.4% and C 88.5%.
2. We apply the D-08 rule as written. C has no success gain over B (4 of 6 and 4 of 6), and it costs fewer run tokens than B, not more. The rule's second condition does not hold, so the rule does not turn the knowledge pass off.
3. `adapters.knowledgePass` keeps its default of true. No code changes. A profile that wants the cheaper onboarding sets it to false, which records the knowledge index step as disabled and starts no knowledge invocation.

## Consequences

**Positive:**
- Onboarding keeps its knowledge index with no change of default or behavior.
- The decision is reversible by configuration, for one profile or for the default.

**Negative:**
- The requirement is not met. No pack arm both matched A's success and stayed within half of its tokens, and the measured shares are 88.5% and 94.4%. The owner decides whether the 50% bound is wrong for this system, the pack must shrink, or the requirement changes. Owner: aa-phan.
- The sample is small. It is 6 tasks on one repository, one run per task and arm, so one task is 17% of a rate. The other repositories of the approved list cannot be judged in this harness. The owner's own spot-check of three successful runs is still pending, and by D-07 it does not change the verdict.
- The rule's tie-break is thin. C and B tie on success, and C's token advantage is 6.2% of B's on a single run per task. A different draw could reverse the sign, and the rule would then turn the knowledge pass off. Owner: aa-phan.
- The rule ignores setup cost, and that cost is where the knowledge pass is expensive. C's onboarding averaged 0.83 USD against 0.12 USD for B, about seven times as much, and the mean cost per run including setup was 0.97 USD for C and 0.26 USD for B. The default stays on although the extra onboarding spend buys no measured success. Owner: aa-phan decides whether a later rule should count setup.
- Six of the 18 runs ended without a branch on a verifier or gate stop and count as non-successes whatever the cause. Three of them were arm A, which lowers A's success rate and so helps the success half of the comparison for B and C. The token half fails regardless.

**Neutral:**
- The harness writes the verdict and the D-08 outcome at the top level of the results file, equal to its summary, so a later re-run is read the same way.
- Two defects of the harness found on the way are fixed and do not change the verdict: tool caches that the required checks write to were undeclared, and the brief asked for end-to-end work the harness cannot run.

## Alternatives considered

**Turn the knowledge pass off by default.** For: C shows no success gain over B, and its onboarding costs about seven times B's, so the pass adds spend and no measured benefit. Against: D-08 states the condition for turning it off, and the condition is that C also costs more tokens, which it does not. Why not chosen: the owner fixed the rule before the data, and a rule that is overridden when it is inconvenient is not a rule. A new decision can supersede this one with a rule that counts setup cost.

**Run the other 14 tasks of the approved list.** For: a larger sample on more repositories would narrow the ties. Against: the offline probe showed that success is impossible in this harness for every arm on 6 of the 9 balanced tasks, independent of retrieval, so those runs would only add cost. Why not chosen: the spend would buy no information about the question.

**Repeat the 6 tasks several times.** For: the arms would each have more than one draw per task, which would show how much of the 6.2% token gap is noise. Against: it multiplies a 12 USD spend, and the rule would still compare the same two numbers. Why not chosen: not authorized by the owner, and the verdict on AC-8 does not depend on it, because both pack arms are far from the 50% bound.

**Judge the arms on cost including setup.** For: it is the cost an owner pays. Against: it is not the rule D-07 and D-08 set, and the AC-8 bound is stated in tokens. Why not chosen: a different rule needs its own decision, and this one is where that decision is raised.

## References

- The results file: `test/benchmark/phase4/eval-results.json` (the summary, `verdict` and `knowledgeRule`) and the approved task list `test/benchmark/phase4/eval-tasks.json`, which was not edited.
- The kept evidence of the 19 runs, redacted and capped: `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-36-evidence/`.
- Owner decisions D-06, D-07 and D-08 in `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-CONTEXT.md`.
- The requirement AC-8 in `docs/requirements.md` and the evaluation section of `docs/operations-and-testing.md`.
- ADR-014 for the sibling decision on host admission.
