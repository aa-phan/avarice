# Phase 4 exit inputs

Two lists drive the live exit runs of Phase 4. Neither is used for spend until the owner has approved it. Approval is recorded in the file itself: `approvedBy` and `approvedAt` (RFC 3339) are both `null` in a draft and both set once approved. `test/unit/phase4-exit-inputs.test.ts` rejects a half-written approval.

## Files

| File | What it is |
| --- | --- |
| `ac14-repositories.json` | The five brownfield repositories for AC-14 (D-05): stack, source, a 40-hex commit pin, whether `.planning/` is tracked at the pin, and for public entries the licence and tracked file count. |
| `eval-tasks.json` | The twenty replayed historical commits for AC-8 (D-07), the three arms, the pass rule, the knowledge rule, the token metric and the isolation rule. It is not edited after approval. |
| `eval-coverage.json` | For each of the 18 recorded AC-8 runs, every bullet of its brief with a status (delivered, partly or skipped) and the evidence for it. Pinned to the sha256 of `eval-results.json` and of `eval-tasks.json` (ADR-017). |
| `eval-success-amendment.json` | The amended success rule and the partial rule, pinned to the sha256 of `eval-tasks.json`, with its own `approvedBy` and `approvedAt`, both `null` until the owner approves (ADR-017). |
| `eval-verdict-adr017.json` | The re-judgement of the 18 recorded runs with the coverage record and the approved amendment (plan 04-65). |

The pass bar for AC-14 is 5 of 5 repositories reaching an active profile with no source change and 0 containment failures.

## The repositories

Three are the owner's own repositories and two are public projects pinned at a release commit.

- `aa-phan-portfolio-v2` (TypeScript) carries committed GSD planning but no `.planning/codebase` map.
- `auto_search_workflow` (Python) carries committed GSD planning and seven `.planning/codebase` files with `last_mapped_commit` stamps. It is the ONB-6 adoption case.
- `GroceriesGPT` (TypeScript) has no GSD artifacts: the plain brownfield case.
- `spf13-cobra` (Go) and `BurntSushi-ripgrep` (Rust) are mapping-only. Go and Cargo are not installed, so these runs build the index and the profile and do not run the repository checks.

`hasPlanning` and the file counts were read from the git tree at the pin, not from the working tree. The `GroceriesGPT` checkout has uncommitted edits; the pins are commits and the edits are not part of them.

## How the tasks were mined

For each owner repository, the history reachable from the pin was filtered to non-merge commits that change source files and test files together. Fix commits with a small diff were preferred, and commits whose checks need only the repository's own offline test runner. For each kept commit:

- `parent` is the commit's first parent, the base the arms start from.
- `brief` is the commit subject followed by the commit body, with trailer lines such as `Co-Authored-By` removed. It is the text of the commit message and is not rewritten. Four tasks (T06, T11, T12, T14) have a subject-only message.
- `checks` are the offline checks the repository defines at the parent. The portfolio uses `typecheck`, `lint`, `format:check` and `test`; `auto_search_workflow` uses `unittest discover`; `GroceriesGPT` uses `build`, `lint` and `test`.
- `heldOutTest` is a test file the commit added or changed, with `heldOutCommand` to run it. `deniedReads` lists every test file the commit touched, including end-to-end specs the harness does not run.
- `size` is `small` under 40 changed source lines (documentation, workflow and lock files excluded) and `medium` otherwise. `sourceFileCount` and `sourceLines` record the measure.

The lists hold repository ids, commit SHAs, commit messages and test paths. No file content is copied from a private repository.

## Arms

| Arm | Contents |
| --- | --- |
| A | Baseline (D-06): the GSD codebase map plus the files the agent finds itself. The map is generated at the task parent when the repository carries none there. |
| B | The AVARICE context pack built at the parent with the code-only graph. |
| C | The same pack with the knowledge graph (document nodes). |

The spec names its three arms as document section reads, the code-only graph and the graph with document nodes. Arm A here is the D-06 baseline instead of section reads. The difference is a findings line, written by plan 04-39.

## Rules

- **Success:** every required check passes at the end of the run and the held-out test, copied from the target commit after the agent stops, passes. Reviewer judgment is a sampled owner spot-check, not a gate. The amended rule in `eval-success-amendment.json` (ADR-017) adds that the run delivered every bullet of its brief, as `eval-coverage.json` records; a run that skipped or only partly delivered a bullet is partial, not a success. The amendment is a separate file pinned to the approved task list, so the task list itself, and the `successRule` text it holds, are not edited.
- **AC-8:** passes when arm B or arm C has a success rate at least arm A's, at no more than 95% of arm A's total tokens, inclusive (ADR-016). The task list keeps its original rule text unedited, so the bound in force is the one in ADR-016.
- **Knowledge pass (D-08):** stays on unless arm C shows no success gain over arm B and also costs more tokens than arm B.
- **Tokens:** the sum over distinct assistant messages of input, cache-creation, cache-read and output tokens. USD cost is recorded beside them.
- **Isolation:** each arm runs in a checkout at the task parent with no later history and no remote. `deniedReads` takes precedence over `allowedReads`. The index and the pack are built at the parent, never at the target commit.

## Not yet verified

The drafting checked git facts only: every pin is a commit, every parent is the commit's first parent, and every held-out test exists at its commit. It did not run any task's checks or held-out test. That a held-out test fails at the parent and passes at the target commit is established by the pilot (plan 04-31), before any arm runs.
