# Checks and evidence

A run proves its work with commands the repository declares, and AVARICE runs them itself. This document describes how those commands become evidence and how two gates judge it: the dependency install, the validation of each declared check, the baseline, the required and target checks, the test inventory, evidence rows and the acceptance mapping, the baseline delta, and gates G2 and G4. It covers the check and install code, the allowlist proxy, the run clone adapter, the stage code that calls them, and the domain modules for evidence, gates, test inventory and conventions (`src/app/checks.ts`, `src/app/check-validation.ts`, `src/app/run-stages/prepare.ts`, `src/app/run-stages/item.ts`, `src/app/run-stages/finish.ts`, `src/adapters/exec/allowlist-proxy.ts`, `src/adapters/git/run-workspace.ts`, `src/domain/evidence.ts`, `src/domain/gates.ts`, `src/domain/test-inventory.ts`, `src/domain/conventions.ts`).

Every verdict here comes from a status AVARICE measured by running a command itself, inside the sandbox and outside any agent invocation. Model text, such as a GSD verification status or a summary, can fail a gate and can never pass one. [runs.md](runs.md) owns the stage order and what a blocked gate does to the run. [containment.md](containment.md) owns the sandbox, the proxy internals and the hook. [data-model.md](data-model.md) owns the tables and event payloads. [config-reference.md](config-reference.md) owns the conventions keys and limits; this document says only what the checks section of the conventions means for validation and execution.

## Where the pieces run

| Step | Stage and order | Network | A failure ends the run as |
|---|---|---|---|
| Dependency install | Preparation, after the clone and the GSD configuration | A loopback proxy to the registry hosts | A block: `enforcement_failure` or `decision` (see "The dependency install") |
| Check validation | Preparation, after the install | None, or one loopback port to a detector proxy | A block (see "Validating a declared check") |
| Baseline | Preparation, after validation | None | An internal error only; a failing baseline check blocks nothing |
| G2 | The unit, after a progressed outcome | None | A block before any commit |
| Final proof and G4 | After the commit, on the committed revision | None | A block, and no branch |

Every command in this document starts under the sandbox. When no sandbox is available the executor spawns nothing and reports `unavailable`. The install and the validation turn that into a block; a baseline, G2 or final check turns it into evidence with status `unavailable`.

## The sandbox every command runs in

The install, the validation runs, the baseline, G2, the final proof and the test inventory list command share one sandbox shape. The working directory is the run clone (the validation clone, for validation). The clone and a per-run scratch directory under the work root are the only parts of the work root a command may read.

| Aspect | Rule |
|---|---|
| Environment and reads | Built and denied by AVARICE as [containment.md](containment.md) describes. A check's own `env` is merged first, so the sandbox values win. The validation run passes no read re-allowance (see Quirks). |
| Writes | Checks: the scratch directory and that check's declared `writes`. Install: `node_modules` in the clone and the scratch directory. List command: the scratch directory and the `writes` of every declared check. Validation: anywhere in the validation clone. |
| Network | Checks, the baseline and the list command: none. Install: one loopback port. Validation: one loopback port when the detector proxy starts, otherwise none. |

A declared `writes` glob is reduced to the directory or file named by its segments before the first wildcard. A glob that starts with a wildcard, or holds an empty, `.` or `..` segment, names nothing and grants no write.

The sandbox denials are prevention. What the pipeline concludes afterwards from the clone, such as new files or network attempts, is detection and is labeled so below.

## The dependency install

The install is a supervisor step, not an agent invocation: the agent host never receives a proxy or a loopback allowance. The step runs the conventions' install command in the run clone before the first agent invocation, and it is the only part of a run with network access.

- With no `dependencies` section the step is recorded `skipped` and nothing runs.
- The lockfile named by the conventions must exist in the clone at the pinned revision, and its digest is recorded. An absent lockfile is a block. A lockfile that is unreadable, not a regular file, over 32 MiB, or reached through a link out of the clone is an internal error of the supervisor, not a block.
- The command runs with a 15 minute timeout. Its network is a single loopback port in front of an allowlist proxy created for this one command. The proxy admits a CONNECT to exactly `<registry host>:443` for each declared registry host. It refuses every other target, a malformed target and any non-CONNECT request, and records each by host and port. It is closed when the command ends.
- Install scripts are switched off through an environment variable that npm reads, whatever command the conventions declare. The command's own arguments are not screened (see Quirks).
- The step records the outcome, the lockfile and its digest, the exit status, the duration, and the proxy attempts grouped by host, port and verdict (at most 20 groups, each with a count).

A failed install blocks the run. The reason depends on the condition that selected it:

| Condition | Reason | Decision class |
|---|---|---|
| The proxy is not composed, or cannot start | `enforcement_failure` | `permission` |
| No sandbox is available | `enforcement_failure` | `permission` |
| The proxy refused at least one target (a host that is not an allowed registry) | `decision` | `permission` |
| The command timed out or exited non-zero, and no target was refused | `decision` | `repeated_failure` |
| The lockfile is absent | `decision` | `repeated_failure` |

A refused target is judged before the exit status, so an install that was refused and also failed is reported as the refusal. A registry host is a bare host name, so an IPv4 literal is accepted, and at most 16 hosts may be declared. [config-reference.md](config-reference.md) gives the host grammar.

## Validating a declared check

A check named in the conventions is repository code, so it is not run for evidence until it has been seen to behave. Validation runs before the baseline and before any agent invocation.

Each declared check, required or not, runs once in a separate validation clone detached at the pinned revision, with the dependencies installed there by the same install rules. The install in the validation clone runs only when some check still needs validating. If it fails, the run blocks with the install's own reason and the issue says it came from that clone. The check's exit status is not judged: a check that fails at the pin is still a check, and that failure is a baseline fact. Three verdicts exist:

| Verdict | Meaning | Cached |
|---|---|---|
| `active` | The check wrote no path outside its declared `writes` and made no network attempt. | Yes |
| `rejected` | It wrote an undeclared path (reason `unexpected-write`, with up to 20 paths) or reached for the network (reason `network`, with up to 10 hosts). | Yes |
| `unavailable` | No sandbox, the command could not spawn, or it timed out or was cancelled (reasons `sandbox-unavailable`, `spawn-error`, `timeout`). | Never |

An undeclared write is judged first, so a check that did both is rejected as `unexpected-write` with its hosts attached.

Write detection is detection only. The sandbox lets the check write anywhere in the validation clone, because the point is to measure what it writes. The paths come from the clone's status before and after, ignored files included, and count only when they were not in the status before. The sandbox prevents network use, and the pipeline detects it from two signals. One is an attempt that reached the proxy, whose allowlist is empty. The other is error text in the check's output (`ENOTFOUND`, `EAI_AGAIN`, `getaddrinfo`, `connect EPERM`, `ECONNREFUSED`). When the proxy cannot start, the check runs with no network at all and only the text signal remains.

A verdict is cached in the ledger per project, pinned revision, check name and a digest of that one check's whole declaration (name, arguments, timeout, required flag, environment and writes). A later run on the same pin reuses it, and a change to one declaration re-validates that check alone. A `rejected` verdict is cached like an `active` one, so a rejected check stays rejected until its declaration changes. Each fresh validation appends a `check.validated` event with the check name, the verdict and, when there is one, the reason.

What a verdict does to the run:

- A required or target check that is not `active` blocks the run in the `permission` class before any agent invocation. The reason is `enforcement_failure` when any blocking check was `unavailable` for `sandbox-unavailable`, and `decision` in every other case, including `rejected`, `spawn-error` and `timeout`.
- An optional check that is `rejected` or `unavailable` blocks nothing. It is left out and recorded in the validation step with its verdict.
- A check that is not `active` is never executed for evidence in any later pass.
- A blocked validation is recorded as a failed step, so a resumed run validates again. Verdicts of `unavailable` were not cached, so the resume looks at those checks anew.

## Required checks and target checks

The checks that run for evidence are the active declared checks that are required or named as target checks in the brief. A check's `required` flag defaults to true. A target check is one the brief names; it need not be required, and it must pass wherever it is declared, even when it already fails at the pinned revision. Checks run in declaration order, in three passes:

| Pass | Where | Row label |
|---|---|---|
| Baseline | The run clone at the pinned revision, before the unit | `base` |
| G2 | The clone's working tree after the unit, before the commit | `g2` |
| Final | The committed revision | `final` |

Each check run produces one insert-only evidence row, one `check-output` artifact and one `check.finished` event. The artifact holds the command line and the standard output and error as the check printed them, or a "not run" line with the cause when no sandbox was available. AVARICE does not filter that text. The artifact is kept for the life of the run. The event carries the run and attempt, the check name, the pass label, the status, the exit code, the duration, the evidence ID and, when set, the pre-existing flag.

A command result maps to an evidence status as follows. A pass is `passed`, a non-zero exit is `failed`, a command that could not spawn or had no sandbox is `unavailable`, and a timeout or a cancel is `inconclusive`. Any other value is `inconclusive` and never `passed`.

## Evidence

Evidence is an insert-only row per measured fact. It has a status, an independence label, a revision, and the attempt and work item it belongs to.

| Status | Written by the code |
|---|---|
| `passed` | A check or inventory that passed, a passing GSD verification, an unchanged path. |
| `failed` | A check that exited non-zero, a failing GSD verification, a changed path. |
| `unavailable` | No sandbox, or a spawn error. |
| `inconclusive` | A timeout or a cancel; also a check the resume reconcile marks after an interrupted final pass. |
| `skipped` | Never written. The ledger accepts it. |
| `stale` | Never written. The ledger and G4 accept it. |

The kinds written are `check`, `test-inventory`, `diff` and `gsd-verdict`. The domain also names `mutation`, `ci`, `review` and `manual`; none is written. Independence is `deterministic` for every row AVARICE measured and `model-review` for the GSD verdict. The value `external` exists in the type and is never written.

A row's revision is `git:<commit>` when the working tree matches its commit exactly, and otherwise `tree:sha256:<digest>` of the tree content (tracked and untracked files, ignored files excluded). The revision is taken before a check runs. The baseline rows are measured in a clone that holds the untracked GSD configuration file, so they carry a tree revision unless the repository ignores that file. G2 rows carry a tree revision, because the unit has changed the clone. Only the final proof runs on a clean commit.

Three kinds are not check rows:

- The GSD verification verdict is stored at the final proof as `gsd-verdict` evidence: `passed` when the unit's record said `passed`, `failed` otherwise, with independence `model-review`. It can never satisfy an acceptance criterion.
- A `diff:<path> unchanged` reference produces a `diff` row: `passed` when the path is not among the paths changed between the pinned revision and the commit, `failed` when it is. The match is on the exact path, not a glob. Any other `diff:` rule produces no row.
- The test inventory produces a `test-inventory` row (below).

### Acceptance mapping

A criterion is satisfied only by deterministic evidence that passed at the final revision:

- `check:<name>`: a `check` row of that name with status `passed`, independence `deterministic` and no pre-existing flag.
- `diff:<name>`: a `diff` row of that name that passed.
- `test:<text>`: a test ID containing the text in the passed after-unit inventory, provided the checks that run the tests passed in the final proof. Those are the required checks whose names start with `test`, and every required check when none does. An empty text matches nothing, and the evidence reference is the after-unit inventory row.

A criterion with several references is satisfied when any one is. Rows of any other kind or independence never satisfy a criterion, whatever their status says. The mapping runs in the final proof only.

## The baseline

The baseline runs once per run, after validation and before the unit. Every active required or target check runs at the pinned revision in the run clone, and the test inventory is measured when the conventions declare one. The step records the attempt, each check with its status and evidence ID, and the inventory. A failing baseline check does not block: the gates judge the unit against what the baseline measured, never against an assumed green base. A repeated baseline after a kill leaves several rows, and the latest per check counts. The baseline opens the run's first attempt, because evidence names an attempt, and the unit adopts that attempt.

### The baseline delta

Each gate compares the head results with the baseline for the required checks and the target checks, by status only:

| Result at head | Base | Outcome |
|---|---|---|
| No result (the check did not run) | any | Blocking, `missing` |
| `passed` | any | Fine |
| `skipped`, `unavailable`, `inconclusive` or `stale` | any | Blocking, `not-conclusive` |
| `failed`, check is a target | `failed` | Blocking, `target-not-passed` |
| `failed`, check is not a target | `failed` | Pre-existing, not blocking |
| `failed` | `passed`, or not measured as failed | Blocking, `regressed` |

Only a base failure that AVARICE measured can make a head failure pre-existing. A base that was `unavailable`, `inconclusive` or absent makes the head failure a regression. A target never earns the pre-existing treatment, so a target check that fails at the pinned revision and at head blocks. The comparison is by status: a required check that fails for a different reason than at the baseline is still pre-existing. The flag is stored on the failed row and never as another status. Every pre-existing check is named in the move to `ready_for_review`, so a green hand-off never hides one.

## The test inventory

When the conventions declare a test inventory, AVARICE measures it at the baseline and after the unit, from the repository and never from what the model said about its tests. A measurement has three parts:

- The test IDs: each non-empty line of the list command's output, at most 50000 IDs, each cut to 500 characters. The command runs in the sandbox with a 120 second timeout. Without a list command no IDs are measured.
- The test files: every tracked or untracked non-ignored file matching the declared globs, at most 20000. A file that vanished is not counted. A file over 4 MiB or unreadable is counted, and its markers are unknown.
- The skip and focus markers per file, found by matching each line against the patterns below. A marker inside a comment still counts, so a false positive fails G2 into a decision and never passes it.

| Marker | Matches |
|---|---|
| `.skip(` | `.skip` followed by `(` or `.` |
| `.only(` | `.only` followed by `(` or `.` |
| `xit(`, `xdescribe(`, `xtest(` | the global call, not preceded by a word character, `$` or `.` |
| `it.todo(`, `test.todo(`, `describe.todo(` | the call, with the same boundary |
| `{ skip: true }`, `{ only: true }` | the key inside an object literal on one line |
| `@pytest.mark.skip`, `@unittest.skip` | the decorator |

The row is of kind `test-inventory` with the count, a digest of the sorted ID list, the markers per file and the file count. The sorted ID list is stored as a `test-inventory` artifact for the life of the run. A list command that cannot run, fails or times out is recorded with the mapped status (`unavailable`, `failed` or `inconclusive`) and an empty ID list.

G2 compares the two measurements and reports failures in this order:

| Failure | Condition |
|---|---|
| `removed-test` | An ID present at base is missing after (the first 20, then a count). |
| `new-skip-marker` | A file's marker count after is higher than at base (a file with none at base counts from zero). |
| `lowered-test-count` | The number of test files fell. |

Three properties follow from a comparison that reads only IDs, counts and file numbers. A failed list command after the unit yields no IDs and so reads as every base test removed. A baseline list command that failed leaves no IDs to protect, so only markers and the file count are guarded. Moving a marker within one file, or swapping one for another, keeps the count and is not flagged.

## Gate G2

G2 judges one unit's changes before the commit, over facts AVARICE measured. It has eight rules, always reported in this order:

| Rule | Fails when |
|---|---|
| `outcome-progressed` | The classified outcome is not `progressed`. The supervisor sends no other outcome to G2, so this rule cannot fire in a run. |
| `scope-conformance` | A changed path is protected; a modified path is outside the write and artifact globs; an added path is outside the create and artifact globs; or the change status is unknown. |
| `deletion-scope` | A deleted path is outside the delete globs. The delete list is always empty, so any deletion fails, and so does a rename. |
| `test-inventory` | The inventory comparison reports any failure. |
| `gsd-verification` | The unit's GSD verification status is not `passed`; an absent record counts as `missing`. |
| `no-new-overrides` | The unit's verification record applied at least one override. |
| `prune-is-decision` | The unit's records hold at least one node-repair PRUNE entry. |
| `checks-delta` | At least one required or target check is blocking against the baseline. |

Path lists in a failure are sorted and capped at 20, and every list is sorted before it is judged, so the same facts give the same verdict in any order.

G2 is evaluated in three stages, so repository commands run only for a unit that has passed everything cheaper. First the rules that need no measurement are judged: outcome, scope, deletion, verification, overrides and PRUNE. Only if they pass does the inventory list command run and the comparison join the verdict. Only if the verdict still passes do the required and target checks run on the working tree and the delta join it. A verdict therefore lists failures from one stage only. The rule `test-inventory` is never reported with a first-stage failure, and `checks-delta` is reported only when everything else passed. A contract with no declared inventory skips the second stage. A resumed run that finds the item implemented but not gated judges again, so its evidence rows are written again and the latest per pass counts.

Every G2 verdict, pass or fail, is stored as a gate row for the attempt with its failures. A failed G2 blocks before the commit; [runs.md](runs.md) gives the block reason and class for each failure. A passed G2 moves the item to `gated`, and the supervisor commits.

## The final proof and gate G4

After the commit, the final proof runs on the committed revision. Every active required and target check runs, one row each. Then the GSD verdict and the `diff` rows are stored, and G4 judges the facts. When a run is resumed after G4 already passed for the same commit, the proof is not repeated and the run goes straight to the hand-off.

G4 has seven rules, all evaluated, reported in this order:

| Rule | Fails when |
|---|---|
| `revision-clean` | The final revision is not `git:<40 hex>`. A check that leaves an un-ignored file in the clone makes the tree dirty and fails this rule. |
| `checks-delta` | Any required or target check is blocking against the baseline (the delta table above). |
| `acceptance-mapped` | There is no criterion at all, or a criterion has no passed deterministic evidence. The failure names the criteria. |
| `no-stale-or-inconclusive` | A required check's row from this pass is `stale` or `inconclusive`. |
| `diff-gate-clean` | A path changed between the pinned revision and the commit is protected, is an artifact, or is outside the write (modified), create (added) or delete (deleted) globs. |
| `decisions-closed` | The run has an open decision. |
| `budgets-within` | A budget row has used more than its limit. |

A passed G4 row for exactly the handed-off commit must exist before the run moves to `ready_for_review`; without it the supervisor stops with an internal error. A failed G4 stores its row and blocks the run (decision, class `repeated_failure`, with the blocking evidence attached). There is no repair item and no second attempt. The hand-off fetch is described in [runs.md](runs.md); this stage records a `handoff.fetched` event with the run, attempt, branch, commit and whether the ref was created.

## Records these steps write

The steps, events, artifacts and gate rows named above are listed once here. The columns are in [data-model.md](data-model.md).

| Kind | Name | When |
|---|---|---|
| Run step | `deps:install` | The install: `completed`, `skipped` or `failed`. |
| Run step | `checks:validate` | The validation: `completed`, or `failed` when a blocking check or the validation install failed. |
| Run step | `baseline` | The baseline: `completed`. |
| Event | `check.validated` | One per check validated in this run; a reused verdict writes none. |
| Event | `check.finished` | One per check run for evidence. |
| Event | `handoff.fetched` | The hand-off fetch recorded. |
| Artifact | `check-output`, `test-inventory` | The check output; the sorted test ID list. |
| Gate row | G0, G2, G4 | G0 at the end of preparation, G2 per unit judgment, G4 per final proof. |

## Quirks

- A check can be referenced by an acceptance criterion and never run. The compiler only requires that the referenced check is declared. A check with `required: false` that the brief does not name as a target is validated but never executed for evidence, so its criterion cannot be satisfied and the run blocks at G4 after the commit.
- The same declared command runs in four places: the validation clone, the run clone at the pin, the working tree and the commit. A check that behaves differently in those places has several verdicts.
- Pre-existing is judged by status, not by cause. A required check that failed at the baseline and fails again for a new reason is flagged pre-existing and does not block.
- A target check that already fails at the pinned revision can never pass the run, because a target is not allowed the pre-existing treatment.
- Install scripts are disabled by an environment variable, not by changing the install command. The command is not screened for arguments or for the words refused to agent commands. The sandbox and the proxy still confine its writes and network. Whether every installer honours the variable was not determined.
- Network detection in validation includes text matching. A check that merely prints `ECONNREFUSED` or `getaddrinfo`, for instance a test of connection errors, is rejected as `network`.
- The validation run is given the read deny list and no read re-allowance, unlike every other command here. Whether that stops a check from reading its own clone under the default roots was not run.
- A check that leaves un-ignored files in the clone during the final proof makes the tree dirty after the checks ran. G4 then fails `revision-clean`, and the check rows, stored under the clean commit, no longer match the final revision.
- The check output is stored whole and unfiltered. A check that prints a secret from its environment writes it into the run's artifact store.
- The evidence statuses `skipped` and `stale`, the kinds `mutation`, `ci`, `review` and `manual`, and the independence `external` are accepted by the types or the ledger and are never written by a run.
- `no-stale-or-inconclusive` and `checks-delta` overlap for an `inconclusive` required check, which fails both. `stale` is never written, so the rule fires only for `inconclusive`.
- The inventory comparison ignores the measurement status. A failed list command after the unit reads as every test removed.
- The G2 rule `outcome-progressed` is live code that no run can trip, because only progressed units reach the gate.
