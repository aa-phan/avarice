# History

This document records what the git history of this repository shows about how the built system arrived, dated by commit. It is historical: entries are not revised when the code changes. Inference about intent is labeled as inference and names what it is inferred from. The current behavior is described in the other documents of this tree, never here. The history below ends at commit `0632fd4`; dates are author dates, so a few commits sit under an earlier day than their neighbors.

## Summary

The repository started on 2026-11-01 as a specification package with no code. Between 2026-11-02 and 2026-11-05 the onboarding slice was built: one existing repository is taken to an active project record by contained Claude Code invocations, with GSD as the mapper. Between 2026-11-05 and 2026-11-06 the run slice was built on top of it: one work item is taken from a brief to a reviewable branch, unattended, inside the same containment. The history shows 412 commits over six days (`git log --format=%ad --date=short 0632fd4 | sort | uniq -c`). The onboarding slice ended with the commit that closed it (`5457f85`); the run slice's first commit follows the planning records that opened it (`e725db6`).

| Date | Commits |
|---|---|
| 2026-11-01 | 8 |
| 2026-11-02 | 108 |
| 2026-11-03 | 56 |
| 2026-11-04 | 89 |
| 2026-11-05 | 108 |
| 2026-11-06 | 43 |

The run slice itself is the 114 commits after `e725db6` (`git log --oneline e725db6..0632fd4 | wc -l`): 71 dated 2026-11-05 and 43 dated 2026-11-06. It includes the documentation work that follows it. The run behavior is described in [runs.md](runs.md).

## 2026-11-01: specification package

- The specification package (requirements, architecture, containment, contracts and state, onboarding, the ADRs) was added with no implementation (`9858bd0`).
- Pre-build spike results were recorded and applied to the specification the same day (`c67a82e`, `22769b7`).

## 2026-11-02: the onboarding slice end to end

The first implementation day built the whole path from an empty store to an active record, first against a fake host and then against the real one:

- Pure domain contracts (`eeb74bf`) and live host spikes (`64c6816`).
- The SQLite store, its writers and `avarice status` (`e7a1e50`, `414084b`); leases, `avarice resume`, the pre-migration backup and the checksum refusal (`5c10e15`, `db8a36c`).
- `avarice init` with the root placement rules, the local-mount check and the SQLite version gate (`5d1230b`).
- Staging, first as a linked worktree (`03c1953`), then as a local clone chosen by the owner (`c2f8bca`); preflight and `avarice repo add` (`a949e2c`).
- GSD location and mapping (`00197b3`, `e43b63d`), map validation and the project record (`bace2c3`, `e05c3d2`).
- The contained launch: invocation scope, generated settings, environment allowlist, agents file and launch preflight (`adb5b06`, `2768a53`); the PreToolUse hook and persisted budgets (`8ef2a5d`, `9fddd17`); the sandboxed executor (`f828062`).
- The code graph, the index step registry and activation's scope check (`aa86b3a`, `04c5449`, `8cb06c3`).
- The real Claude Code host adapter, the stream-json parser and outcome classification (`c99cdf0`, `84a1378`).
- GSD intel, `avarice context` (`c5277fd`, `a4f9e42`) and the knowledge pass with AVARICE's own graph merge (`a3bf131`, `84ac660`).

## 2026-11-03: mutation probing and the first real target

- Mutation probing closed four weak spots in the launch preflight, the document-node text cap, the hook's glob handling and the subagent concurrency limit (`a620ed3`, `6a89140`, `d102659`, `7dc21d1`).
- Exit-run tooling was added (`ef2c983`). Running against a real repository led to fixes in the existing-map answer, full-map stamping, path-reference rules and budget derivation (`8cc18b6`, `ef1ae0b`, `34eac4b`, `6477c32`), and to splitting the knowledge pass so the model has no shell (`7ffc697`).
- Claude Code 2.1.317 was admitted after a green live containment run (`07b16ca`).

## 2026-11-04: confinement hardening

- Resume reaps every interrupted launch, not only the mapping launch (`5d558e9`).
- The staging diff judges ignored untracked files (`c7756a1`).
- Hook reads were confined to staging, read roots and allowed reads; option values and operands are judged (`84910d3`, `f144eb4`); the work root is denied except the invocation's own staging (`630f7f8`).
- Shell `grep` was removed from the admitted read commands, so searches go through the host's Grep tool (`99dd4fb`).
- Knowledge coverage began to be counted per document after the merge (`8054cb8`). Inferred from the commit subject and its gap reference: this followed a live run in which the knowledge agent read the wrong copies of the documents.

## 2026-11-05: review fixes and the end of the onboarding slice

- Code review findings were fixed: option-name parsing, GSD run argument checks, sandbox probe retry and the exit-run spend guard (ending at `4ac1127`).
- The planning records closed the onboarding slice (`5457f85`).

## 2026-11-05: the onboarding slice documented

- The built onboarding slice was written up in `docs/system/` from the code (`f742b3e`).
- The documentation rules followed: `docs/system/` became the source of truth for built behavior, with the proposal documents left as plans for unbuilt work (`ff670c4`, `bec3507`, `b8c7ca4`). Later slices were each given a closing documentation step (`b9e4d58`).

## 2026-11-05: run slice, groundwork

- A live-spend ledger with a hard ceiling guard was added before any live run (`d86c8da`). Claude Code 2.1.318 was then admitted on a live containment run of 22 cases with no containment failure (`4f968ab`, `304e551`).
- The JSON shapes of `status` and `context` were frozen by test before the renderers changed. Then the status renderer, `init`, `repo` and the dispatcher's errors moved to one output style (`b5fe3f7`, `09a9924`, `d623c52`).

## 2026-11-05: run slice, kernel

The run kernel arrived as a chain of small slices, each starting from a tracer:

- The run lifecycle table, the second schema migration and the run ledger: leases, checkpoints, contracts with budgets, steps, attempts, evidence, gate results, work items, decisions and check validations (`49f10eb`, `a741b2c`, `48fa34c`).
- The contract compiler, with briefs and repository conventions validated as untrusted input; the compiler only narrows authority (`21b0cef`, `3e04ebf`, `4a2fb6b`).
- Evidence from check results at base and head, the verdict gates, the test-inventory comparison that refuses weakened tests, and a structural paused outcome (`adf9582`, `c70df8e`, `82f3c3a`).
- Sandboxed commands may be given exact loopback ports, and an allowlisting CONNECT proxy was added, proven by installing dependencies through the sandbox in a live spike (`61cb42f`, `97e1429`, `978ceb9`).
- The run workspace as a clone, the supervisor's commit, fetch of the run branch into the source, snapshot-bound discard, and a reader for conventions at a descendant of the pin (`e88fc96`, `f27a702`, `152ecee`).
- The run purpose in the containment kernel: a scope computed from the contract globs, run command identity with no human prompts and no background shell, run settings and a run-scoped GSD configuration (`c5a3345`, `822a45a`, `ff44244`).
- The `start` command, which compiles a contract and stores the run, budgets and work item in one transaction, and the start refusals that all fire before anything is created (`f5b2be8`, `8125894`). A live spike of the real quick unit under the run purpose disposed of its findings on evidence (`04d9154`, `4229625`).
- The detached supervisor with checkpointed stages, run-aware budget reservation and the lease and process guarantees (`161eb67`, `66b4459`, `7e63041`).
- Read-before-edit with a digest precondition in the run hook, and loop limits that stop a looping run for escalation (`ad4871e`, `6ae2f04`).
- The first end-to-end run, from start to a handed-off branch against the fake host, with every other ending recorded as a decision with a reason, correlation identifiers on every run event and the GSD presence refusal at start (`95bd3d1`, `6fcb105`, `ddfa3be`).
- The checks pipeline: declared checks validated and a baseline measured so a check already failing at the pin is reported rather than blocking, dependency installation through the registry-only proxy, and the test inventory measured at base and after the unit (`320fede`, `5660170`, `b4ac1e5`).
- `status` shows each run's state, checkpoint, evidence, gates and branch offline; the `inbox` command and `install-host` were added (`54711b6`, `5cab6fb`, `c5b7e3d`).

## 2026-11-06: run slice, recovery and the shell

- A crashed or timed-out attempt is discarded to its snapshot and retried once (`be1abd5`). Loop-limit and budget endings became decisions, and a test shows the source checkout untouched through failure and recovery (`a017bf1`).
- `resume` reaps by session identifier, reconciles a verification killed mid-pass and a unit, commit or hand-off interrupted mid-way from the ledger and git, and re-verifies (`537337d`, `1e1bafa`). A kill-point suite covers every run transition and checkpoint, and the budgets across kill and resume (`1afb0ec`).
- The run-purpose rows of the containment matrix and a completeness test for it were added after a spike, and the proposal documents were amended for the run purpose (`265b57a`, `3fb6ae4`, `53181e7`).
- The interactive shell arrived in three steps: a home view with in-process commands, an action menu that starts, watches and resumes a run while the supervisor outlives the shell, and command-name completion with a 0600 history file (`beff8ef`, `e6c9e70`, `378de13`).

## 2026-11-06: run slice, live containment

- A tracer ran one routine run live on a scratch repository from start to the handed-off branch, killed it in verification and resumed it (`12b6819`). Scripted live cases followed for writes, reads and self-amendment by the run, and for the fail-closed and crash cases (`0b3c33e`, `6011f19`).
- The live suite found that a run in another profile could reach the default AVARICE parents. The sandbox now denies those parents to every run and re-allows the run's own clone and scratch (`059cd3d`, `e1740a6`). Inferred from the commit subjects: the fix closed the finding the suite recorded as open.
- A follow-up gave back the metadata of the directories above a re-allowed path so node can resolve real paths (`7fe273c`). The test-list command may write the cache paths that the declared checks name (`57aaa4e`).

## 2026-11-06: run slice, exit run

- Exit-run mode was added with its spend guard, checkout snapshots and a run evidence record (`92bdf9c`). Portfolio conventions and three briefs were drafted and proven against the pin by a no-spend dry run, then approved by the owner (`52fe97c`, `1552ba2`).
- The bug-fix brief reached the handed-off state on the portfolio repository, unattended, with the source checkout untouched (`f759ec8`). The refactor and documentation briefs also reached it, so all three briefs ended there (`58fd5e9`).

## 2026-11-06: the run slice documented

- The documentation pass for the run slice began with its success criterion and plan, and a first document, runs.md, was written from the code and landed awaiting review (`1859f5e`, `72a86b1`, `6f825ce`, `0632fd4`).
