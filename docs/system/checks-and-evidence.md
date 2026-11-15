# Checks and evidence

A run proves its work with commands the repository declares, and AVARICE runs them itself. This document describes how those commands become evidence and how four gates judge it: the dependency install, the validation of each declared check, the baseline, the required and target checks, the test inventory, evidence rows and the acceptance mapping, the baseline delta, and gates G1, G2, G3 and G4 with the integrity gates they enforce. It covers the check and install code, the allowlist proxy, the run clone adapter, the stage code that calls them, and the domain modules for evidence, gates, quick records, reproducers, test inventory and conventions (`src/app/checks.ts`, `src/app/check-validation.ts`, `src/app/run-stages/prepare.ts`, `src/app/run-stages/item.ts`, `src/app/run-stages/repair.ts`, `src/app/run-stages/finish.ts`, `src/app/run-gsd-config.ts`, `src/adapters/exec/allowlist-proxy.ts`, `src/adapters/git/run-workspace.ts`, `src/domain/evidence.ts`, `src/domain/gates.ts`, `src/domain/quick-record.ts`, `src/domain/reproducer.ts`, `src/domain/test-inventory.ts`, `src/domain/conventions.ts`, `src/domain/amendment.ts`).

Every verdict here comes from a status AVARICE measured by running a command itself, inside the sandbox and outside any agent invocation. Model text, such as a GSD verification status or a summary, can fail a gate and can never pass one. [runs.md](runs.md) owns the stage order and what a blocked gate does to the run. [containment.md](containment.md) owns the sandbox, the proxy internals and the hook. [data-model.md](data-model.md) owns the tables and event payloads. [config-reference.md](config-reference.md) owns the conventions keys and limits; this document says only what the checks section of the conventions means for validation and execution.

## Where the pieces run

| Step | Stage and order | Network | A failure ends the run as |
|---|---|---|---|
| Dependency install | Preparation, after the clone and the GSD configuration | A loopback proxy to the registry hosts | A block: `enforcement_failure` or `decision` (see "The dependency install") |
| Check validation | Preparation, after the install | None, or one loopback port to a detector proxy | A block (see "Validating a declared check") |
| Baseline | Preparation, after validation | None | An internal error only; a failing baseline check blocks nothing |
| G1 | Each unit that progressed, before anything else is judged | None | A block: the unit's change is parked and a decision opens; G2 never runs |
| G2 | The unit, after G1 and a progressed outcome | None | A block before any commit |
| G3 | A repair unit, before G2 judges the item again | None | A block, named in the item's decision |
| Final proof and G4 | After the commit, on the committed revision | None | A block, and no branch |

Every command in this document starts under the sandbox. When no sandbox is available the executor spawns nothing and reports `unavailable`. The install and the validation turn that into a block; a baseline, G2 or final check turns it into evidence with status `unavailable`.

## The sandbox every command runs in

The install, the validation runs, the baseline, G2, the final proof and the test inventory list command share one sandbox shape. The working directory is the run clone (the validation clone, for validation). The clone and a per-run scratch directory under the work root are the only parts of the work root a command may read.

| Aspect | Rule |
|---|---|
| Environment and reads | Built and denied by AVARICE as [containment.md](containment.md) describes. A check's own `env` is merged first, so the sandbox values win. The validation run passes no read re-allowance (see Quirks). The install command and the list command receive no check `env`: the list command gets the sandbox values only, and the install adds its proxy, update-notifier and ignore-scripts variables to them. |
| Writes | Checks: the scratch directory and that check's declared `writes`. Install: `node_modules` in the clone and the scratch directory. List command: the scratch directory and the `writes` of every declared check. Validation: anywhere in the validation clone. |
| Network | Checks, the baseline and the list command: none. Install: one loopback port. Validation: one loopback port when the detector proxy starts, otherwise none. |

A declared `writes` glob is reduced to the directory or file named by its segments before the first wildcard. A glob that starts with a wildcard, or holds an empty, `.` or `..` segment, names nothing and grants no write.

The sandbox denials are prevention. What the pipeline concludes afterwards from the clone, such as new files or network attempts, is detection and is labeled so below.

A check's environment reaches two places. AVARICE runs the check with it, under the sandbox values. The unit's own list of commands also carries it. The contract lists each check the run executes as its `NAME=value` words, sorted by name, followed by its argument vector, and the hook admits that command only when the unit writes those words exactly. The names the check sandbox sets itself (`PATH`, `HOME`, `TMPDIR`, `npm_config_cache`, `CI` and `LANG`) are left out of that listing. The sandbox value overrides them for AVARICE, and the unit must not be given a value AVARICE does not use. The rest of the unit's environment is the host's, not the check sandbox's. The host keeps the forwarded `HOME` rather than the scratch directory and has a `PATH` that starts with the gsd-core `bin` directory instead of the Node binary's directory. It sets no `CI`, and its `TMPDIR` is a subdirectory of the scratch directory. A check can therefore behave differently when the unit runs it than when AVARICE does. [config-reference.md](config-reference.md#environment-variables-avarice-sets-for-child-processes) lists both environments, and the rules a value must meet are in [config-reference.md](config-reference.md#run-conventions-reader-schema-1).

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

A declared check that is neither required nor a target is validated like every declared check but is never run for evidence, in any pass. The contract keeps it in its list of declared checks only, so the unit's command list omits it too. Three places report it, each as `<name> not run: not required`. They are the evidence line of a run in `status`, the `checks <run>:` line of a review in `inbox`, and the optional `checksNotRun` key of `status --json` and `inbox --json` ([cli-reference.md](cli-reference.md) has the shapes). No gate reads that report, so it changes nothing that runs and no verdict. The contract's check listing never gives a reported check to the unit as a command (a repository's own `agentCommands` entry is kept as written). The unit's prompt lists it as a check no gate judges, so the unit does not make it a condition of its work. An amendment that makes it required adds its command to the list.

Each check run produces one insert-only evidence row, one `check-output` artifact and one `check.finished` event. The artifact holds the command line and the standard output and error as the check printed them, or a "not run" line with the cause when no sandbox was available. Secret-shaped strings in that text are replaced by `[REDACTED:{kind}]` before the artifact is stored, as in a transcript (see [containment.md](containment.md#secret-redaction)). The artifact is kept for the life of the run. The event carries the run and attempt, the check name, the pass label, the status, the exit code, the duration, the evidence ID and, when set, the pre-existing flag.

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
| `stale` | Written only by an amendment, as a copy of a row it invalidates (see "Stale rows after an amendment"). No check pass writes it. |

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

The baseline runs once per run, after validation and before the first unit. Every active required or target check runs at the pinned revision in the run clone, and the test inventory is measured when the conventions declare one. The step records the attempt, each check with its status and evidence ID, and the inventory. A repeated baseline after a kill leaves several rows, and the latest per check counts. The baseline opens the run's first attempt, because evidence names an attempt, and the unit adopts that attempt.

A required check that fails at the baseline blocks no gate. The gates judge a unit against what the baseline measured, never against an assumed green base, and a head failure of such a check is pre-existing and not blocking (see "The baseline delta"). Nothing stops the run at the baseline either, so the run goes on with the check red.

The unit is told. When an item begins with required checks already failing, its prompt names them. Only the checks that the delta would call pre-existing if they failed again appear. A target, a check that passed, a check that was not conclusive and a check that was not measured never do. The prompt says that the gate judges each of them against that start. It says that one which still fails is not a question for the owner and does not by itself make the unit's verification `human_needed` or `gaps_found`. It also says that a failure a check reports in a file the unit changed is the unit's to fix. It tells the unit to give the list to the verifier, and the verifier's own closing note repeats the point ([runs.md](runs.md#the-unit-running) describes the prompt). AVARICE never overrides a status the unit wrote. A unit that still reports `human_needed` because of a pre-existing failure therefore pauses like any other unit and opens a decision, and one that reports `gaps_found` fails G2's verification rule. The pre-existing flag only keeps the check itself from blocking.

### Item start reference

An item's start is the reference its gate judges it against, and it moves as items commit. The first item starts from the baseline. Each later item starts from the baseline overlaid with the latest G2 result of every check of the item that was committed last, so a check that item did not run keeps its earlier status. An item's start inventory is the one the item committed last ended with, and the baseline's for the first item. G2 and the repair rule read the start, so a regression is charged to the item that caused it and never to an earlier one. G4 is different: the final proof compares the whole run with the baseline at the pin.

### The baseline delta

G2 and G4 compare the head results with a base for the required checks and the target checks, by status only. The base is the item's start for G2 and the baseline at the pin for G4. In the table, "base" is that reference:

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

## Gate G1

G1 judges the plan of a unit that progressed, before G2 and before anything is committed. The plan is model-written text that AVARICE reads as data. It can fail G1 and can never pass anything on its word, and a plan that is absent fails closed.

AVARICE reads every quick PLAN record the unit wrote (a file under the quick-task directory whose name ends in `PLAN.md`, new or changed since the attempt began and not deleted). It reads each as data up to 64 KiB and merges them into one plan. A PLAN file over 64 KiB, or one that is not a regular file, makes the merged plan absent, and `plan-present` fails. From the merged text it takes:

- the paths the plan names: the `files_modified` list of its frontmatter, written inline as `[a, b]` or as dash lines. They also come from the text of every `<files>` element inside a `<task>`, split on commas and line breaks. Surrounding quotes, backticks and list bullets are removed, and a leading `./` is dropped.
- the decision checkpoints: each `<task>` whose `type` is `checkpoint:decision`, whether it declares an `auto_select` (as an attribute or an element), and the IDs of its `<option id="...">` children.
- the acceptance references: every `AC` followed by digits, anywhere in the text.

G1 has six rules, reported in this order. `plan-present` is judged alone: when it fails, no other rule is evaluated.

| Rule | Fails when |
|---|---|
| `plan-present` | The unit left no readable plan. |
| `plan-within-write-scope` | A plan path is not repository-relative (absolute, a drive letter, a backslash or a `..` segment), is protected, or lies outside the write and create globs. |
| `plan-within-spec` | A plan path lies outside the item's spec files. Not judged when the item's spec files were derived from the write set, because the write set is then the only list there is. |
| `decision-checkpoint-unresolved` | The unit progressed although its plan holds a decision checkpoint with no `auto_select`. It resolved a question that was the owner's without pausing. |
| `owner-choice-unasked` | An acceptance criterion of the item is verified by `decision:<key>` and the owner was never asked. An answered decision of the item that is the unit's own question, or that G1 opened for exactly that choice, settles it. The answer to a decision G1 opened for a plan checkpoint settles none. |
| `plan-cites-acceptance` | An advisory. The plan cites none of the item's acceptance IDs. The finding is stored in the gate row marked `advisory` and never fails the gate. A switch in the code makes it a failing rule, and the switch is off. |

Every G1 verdict is stored as a gate row for the attempt. A failed G1 blocks the item before anything else is judged. The unit's change is parked, a decision opens with the issue `gate G1 failed: <details>`, and G2 never runs for that unit. A plan path outside the contract or outside the item's spec files opens a `scope_expansion` decision that offers only `withdraw` and names the amend command for exactly those paths. An unresolved checkpoint opens an `acceptance` decision with the plan's option IDs. An unasked owner choice opens an `acceptance` decision that takes free text. An absent plan opens one the owner answers in words. [autonomy-and-decisions.md](autonomy-and-decisions.md) owns the classes and how the answer is checked.

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
| `checks-delta` | At least one required or target check is blocking against the item's start. |

Path lists in a failure are sorted and capped at 20, and every list is sorted before it is judged, so the same facts give the same verdict in any order.

G2 is evaluated in three stages, so repository commands run only for a unit that has passed everything cheaper. First the rules that need no measurement are judged: outcome, scope, deletion, verification, overrides and PRUNE. Only if they pass does the inventory list command run and the comparison join the verdict. Only if the verdict still passes do the required and target checks run on the working tree and the delta join it. A verdict therefore lists failures from one stage only. The rule `test-inventory` is never reported with a first-stage failure, and `checks-delta` is reported only when everything else passed. A contract with no declared inventory skips the second stage. The inventory comparison and the delta read the item's start, not the pin (see "Item start reference"). A resumed run that finds the item implemented but not gated judges again, so its evidence rows are written again and the latest per pass counts.

Every G2 verdict, pass or fail, is stored as a gate row for the attempt and the item with its failures. A failed G2 blocks before the commit; [runs.md](runs.md) gives the block reason and class for each failure. A passed G2 moves the item to `gated`, and the supervisor commits.

## Repair and gate G3

A required check that passed when an item began and fails after it is the item's own regression. When that is the only thing wrong with a unit, the item gets one repair before the owner is asked.

The repair is offered when every failure is the `checks-delta` rule and every blocking check is `regressed` (not `target-not-passed`, `not-conclusive` or `missing`). It also needs each of them to have run and failed, and the unit not to be itself a repair that failed G3. Each check must have had fewer repair attempts than the contract allows (the routine preset allows one per check), and the invocations budget must have room for one more unit. Otherwise the item goes to a decision. A failure on the checks alone opens a `repeated_failure` decision, or a `budget` decision naming `invocations` when it is the budget that has no room. Any other failure takes the route in the G2 table of [runs.md](runs.md#gate-g1-gate-g2-and-the-commit): a scope or deletion failure blocks the run. For a unit that is not a repair, the rest open an `acceptance` decision. Any other failure of a repair unit opens a `repeated_failure` decision.

The repair is a second unit of the same item, on the work the first unit left in the clone. It records the checkpoint `repair`, opens an attempt with the reason `repair`, moves the item from implemented back to delegated, and writes a `repair:reproducer` step. A failing check that goes to a decision without a repair gets the same step, and its decision cites the reproducer. The unit's prompt carries the reproducer as data, then the instruction to fix the code without deleting, skipping or changing the failing test. The repair's changes and the first unit's make one commit, so G2 judges the whole item against the item's own base again, and G3 judges the repair on its own.

The reproducer is the smallest description of the failure that AVARICE measured. The output text is never stored, only its digest.

| Field | Content |
|---|---|
| `check` | The check's name. |
| `command` | The argument vector joined by spaces, control characters removed, cut to 1000 characters. |
| `exitCode` | The exit code. |
| `outputDigest` | `sha256:` and the digest of the output the check printed. |
| `failingTests` | The failing test names the output holds, in order of first appearance, at most 20, each cut to 200 characters with control characters removed. |
| `diff` | `paths`: the paths the item changed since its base, sorted and de-duplicated, the first 20; `digest`: a digest of the whole sorted list, so a change past the cap still moves it. |

Test names come from output in three shapes, after terminal colour codes are removed. A vitest line `FAIL <file> > <suite> > <test>` names a test, and a line that names only a file does not. A node:test line `not ok <n> - <name>` in the TAP reporter names one, unless it carries a `TODO` or `SKIP` directive. A node:test spec-reporter line `<cross> <name> (<n>ms)` names one, once where the test ran and again in the closing list, and the name is listed once. Output of any other shape gives no names, and a reproducer is valid without them. The names are then resolved against the test inventory: a name that equals an inventory ID, or that an ID ends with after ` > `, becomes that ID. A name the inventory does not hold is not judged.

G3 has three rules, reported in this order.

| Rule | Fails when |
|---|---|
| `repair-limit` | The repairs the check has already had have reached the limit. |
| `failing-test-present` | A failing test's ID is missing from the inventory measured after the repair. |
| `failing-test-unchanged` | A file that holds a failing test was changed during the repair, whatever the change. A path that an amendment authorized would be exempt, but the authorized list that the gate is given is always empty, so no path is. |

G3 judges only the paths the repair itself changed, from its own snapshot. Both verdicts are stored whatever either says, so a repair that fails G3 and G2 leaves two gate rows, and the item's decision names the failures of both, as `G3:<rule>` and `G2:<rule>`. A repair that fails goes to the decision. It is never repaired again, unless an answered decision restarts the count ([runs.md](runs.md#repair-and-gate-g3)).

## The integrity gates

The contract lists five integrity gates by name. Each is enforced by named rules of G1, G2 and G3, and no gate reads the list itself.

| Integrity gate | Enforced by |
|---|---|
| `no-new-overrides` | G2 `no-new-overrides` |
| `no-test-deletion` | G2 `test-inventory` failures `removed-test` and `lowered-test-count`; G3 `failing-test-present` and `failing-test-unchanged` |
| `no-skip-markers` | G2 `test-inventory` failure `new-skip-marker` |
| `scope-conformance` | G1 `plan-within-write-scope`; G2 `scope-conformance` and `deletion-scope` |
| `prune-is-decision` | G2 `prune-is-decision` |

When a failed G1, G2 or G3 blocks an item, the block event lists the integrity gates that the verdicts broke, sorted, so the owner can tell a weakened test from a scope breach. An advisory never counts. The G1 rules `plan-present`, `plan-within-spec`, `decision-checkpoint-unresolved` and `owner-choice-unasked`, and the G2 rules `outcome-progressed`, `gsd-verification` and `checks-delta`, belong to no integrity gate.

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

## Stale rows after an amendment

An amendment never edits evidence or a gate result; both tables are insert-only. It appends rows that say an earlier result no longer stands, and the originals stay. [runs.md](runs.md#amendments-and-contract-versions) owns which fields an amendment may change and which classes of result each change invalidates. This section says what the appended rows are.

- **Evidence.** For each evidence row the amendment invalidates, a copy with status `stale`, written under the new contract version. The copy keeps the original's kind, name, revision, independence and acceptance mapping. It holds no command, exit code, duration or artifact, and its environment says it was invalidated by an amendment and names the row it supersedes. Rows come from the latest contract version in the ledger that are not already stale. A change to the required checks selects every check row. A change to the acceptance criteria selects every row that maps to a criterion.
- **Gates.** For each gate whose latest row stands as passed and that the change invalidates, a row that has failed, with the single failure `stale-after-amendment` and a detail naming the amendment. It keeps the latest row's work item and revision. A change to the acceptance criteria selects every standing gate. A change to the write, create or protected paths selects G2 and G4 where they stand passed.

A budget, notification or exclusion change appends nothing, so it never turns an earlier pass into a fail. A stale row is never a head result: the next G2 or final proof writes fresh rows by running the checks again, and the delta judges those. The delta treats a stale head status as `not-conclusive`, and no pass produces one.

## Records these steps write

The steps, events, artifacts and gate rows named above are listed once here. The columns are in [data-model.md](data-model.md).

| Kind | Name | When |
|---|---|---|
| Run step | `deps:install` | The install: `completed`, `skipped` or `failed`. |
| Run step | `checks:validate` | The validation: `completed`, or `failed` when a blocking check or the validation install failed. |
| Run step | `baseline` | The baseline: `completed`. |
| Run step | `repair:reproducer` | A repair unit is prepared, or a failing check goes to a decision without a repair; holds the reproducer of each failing check. |
| Event | `check.validated` | One per check validated in this run; a reused verdict writes none. |
| Event | `check.finished` | One per check run for evidence. |
| Event | `handoff.fetched` | The hand-off fetch recorded. |
| Artifact | `check-output`, `test-inventory` | The check output; the sorted test ID list. |
| Gate row | G0, G1, G2, G3, G4 | G0 at the end of preparation, G1 per plan judgment, G2 per unit judgment, G3 per repair, G4 per final proof. An amendment also appends a failed row with the failure `stale-after-amendment` for each standing gate it invalidates. |

## Quirks

- A check can be referenced by an acceptance criterion and never run. The compiler only requires that the referenced check is declared. A check with `required: false` that the brief does not name as a target is validated but never executed for evidence, and `status` and `inbox` report it as `not run: not required`. Its criterion cannot be satisfied, so the run blocks at G4 after the commit.
- A required check that fails at the baseline is flagged pre-existing for the whole run, and the unit is told so. The unit can still report `human_needed` for it, and that pauses the item like any other pause, because a status the unit wrote is never overridden.
- G1's `plan-cites-acceptance` is only an advisory. A plan that cites none of its item's acceptance IDs passes G1 and the finding is stored in the row.
- G3 is always given an empty list of authorized test paths, so the exemption for a path an amendment authorized never applies. A repair that has to change the failing test goes to a decision.
- A check's environment is written to the unit as `NAME=value` words, and the hook compares those words exactly. A unit that writes another assignment before the command, or the same words in another order, is refused as `shell-not-allowed`.
- The same declared command runs in four places: the validation clone, the run clone at the pin, the working tree and the commit. A check that behaves differently in those places has several verdicts.
- Pre-existing is judged by status, not by cause. A required check that failed at the baseline and fails again for a new reason is flagged pre-existing and does not block.
- A target check that already fails at the pinned revision can never pass the run, because a target is not allowed the pre-existing treatment.
- Install scripts are disabled by an environment variable, not by changing the install command. The command is not screened for arguments or for the words refused to agent commands. The sandbox and the proxy still confine its writes and network. Whether every installer honours the variable was not determined.
- Network detection in validation includes text matching. A check that merely prints `ECONNREFUSED` or `getaddrinfo`, for instance a test of connection errors, is rejected as `network`.
- The validation run is given the read deny list and no read re-allowance, unlike every other command here. Whether that stops a check from reading its own clone under the default roots was not run.
- A check that leaves un-ignored files in the clone during the final proof makes the tree dirty after the checks ran. G4 then fails `revision-clean`, and the check rows, stored under the clean commit, no longer match the final revision.
- The check output is redacted only by the secret patterns. A check that prints a secret from its environment writes it into the run's artifact store when the secret matches no pattern, such as a password with no recognizable shape.
- The evidence status `skipped`, the kinds `mutation`, `ci`, `review` and `manual`, and the independence `external` are accepted by the types or the ledger and are never written by a run. The status `stale` is written only by an amendment.
- `no-stale-or-inconclusive` and `checks-delta` overlap for an `inconclusive` required check, which fails both. The rule reads the rows of the final proof's own pass, and no pass writes `stale`, so it fires only for `inconclusive`.
- The inventory comparison ignores the measurement status. A failed list command after the unit reads as every test removed.
- The G2 rule `outcome-progressed` is live code that no run can trip, because only progressed units reach the gate.
