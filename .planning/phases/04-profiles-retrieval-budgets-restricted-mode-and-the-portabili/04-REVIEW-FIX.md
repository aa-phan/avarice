---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
review: 04-REVIEW.md
plan: 04-52
recorded: 2026-11-22T23:20:27.653Z
---

# Phase 04: Code Review Fix Report

Source review: `04-REVIEW.md`. Triage: the owner's decision "Triage + fix security ones", applied by plan 04-52. A warning is fixed when it touches approvals, containment, redaction, profile isolation, credential handling or a fail-open path (spend guards included); the rest carry a recorded disposition. Fixes landed in plans 04-40 to 04-49, 04-51 and 04-55 after the planning base `792536d`. A fixed entry names commits that exist in this repository and the test that failed before the fix.

## Fixed Issues

### CR-01: Attended hook allows any privileged command longer than 65,536 characters, and the parser fails open past its nesting and wrapper limits (part A)

- **Plan:** 04-40
- **Commits:** `07c4cde`, `d7d1f06`, `a28082e`, `423006c`, `4df8903`
- **Test that failed before the fix:** "denies a Bash command of 70,000 characters with privileged:unparseable and names the limit" in `test/integration/hook-privileged.test.ts`; RED record `04-40-red-task1.json` (exit 1): the attended hook printed nothing for a 70,000-character push line.
- **Test that failed before the fix:** "says unparseable, naming the limit, for a push behind 17 wrapper words" in `test/unit/privileged-commands.test.ts`; RED record `04-40-red-task3.json` (exit 1): a push behind 17 wrapper words classified as none.

### CR-02: A double-quoted `)` inside `$(...)` makes the splitter lose the rest of the line, hiding a privileged command (part A)

- **Plan:** 04-40
- **Commits:** `ba65243`, `a28082e`
- **Test that failed before the fix:** "under bash" in `test/unit/privileged-commands.test.ts`; RED record `04-40-red-task2.json` (exit 1): bash ran `git push` for `echo $(echo ")"; git push)` and the classifier said none; the unit target is "classifyLine finds the push the shell would run (CR-02, WR-01)".

### CR-03: The approval digest omits git global options and leading environment assignments, so an approved push can go to a different target (part A)

- **Plan:** 04-51
- **Commits:** `eb9b5f7`, `d027730`
- **Test that failed before the fix:** "the -c push has other params than the plain push, and names the option words" in `test/unit/privileged-commands.test.ts`; RED record `04-51-red-task1.json` (exit 1): the `-c` push and the plain push had equal params, so an approval of one was spent on the other.

### CR-04: Attended hook lets one approval authorize every privileged command in a compound shell line (part D)

- **Plan:** 04-48
- **Commits:** `ebb66f0`, `9778271`, `fb44006`
- **Test that failed before the fix:** "one approval of the push alone does not let the line run: it is denied again, the push approval stays unconsumed and the publish request is named again" in `test/integration/hook-privileged.test.ts`; RED record `04-48-red-task1.json` (exit 1): with only the git.push request approved, the hook printed nothing for `true; git push origin main && npm publish`, so the line ran on one approval.
- **Test that failed before the fix:** "denies the line, and one approval of the request named spends nothing: the line is denied again and a second request is named" in `test/integration/hook-privileged.test.ts`; RED record `04-48-red-task2.json` (exit 1): taken from a defect planted in the working tree and reverted (the repeated-command count already held): a repeated command counted once let the line run on one approval.

### CR-05: Catastrophic regex backtracking in the planning-section heading parser hangs the supervisor on a hostile repository (part E)

- **Plan:** 04-41
- **Commits:** `0c34643`, `4e4771f`
- **Test that failed before the fix:** "finds in a PROJECT.md whose heading is "# a" + 200,000 spaces + "x" within 2 seconds, in a child process" in `test/unit/gsd-planning-headings.test.ts`; RED record `04-41-red-task1.json` (exit 1): the child process was killed at the 10-second timeout on a heading of 200,000 spaces.

### WR-01: Common literal wrappers and quoting forms are not parsed, so `git push` inside them is not seen (part A)

- **Plan:** 04-40 and 04-51
- **Commits:** `ba65243`, `a28082e`, `423006c`, `4df8903`, `360dbb0`, `d548047`
- **Test that failed before the fix:** "under bash" in `test/unit/privileged-commands.test.ts`; RED record `04-40-red-task2.json` (exit 1): an ANSI-C quoted program name, a here-string and a comment with an apostrophe each hid a push from the classifier.
- **Test that failed before the fix:** "names every command of a shell string, in order" in `test/unit/privileged-commands.test.ts`; RED record `04-51-red-task2.json` (exit 1): `bash -c "git push origin main"`, `sh -c 'npm publish'`, `eval` strings and `timeout 5 git push` classified as none.

### WR-02: Wrapper table lookup reads the prototype chain, so a command named `constructor` or `__proto__` crashes the classifier (part A)

- **Plan:** 04-40
- **Commits:** `423006c`, `4df8903`
- **Test that failed before the fix:** "says unparseable, naming the limit, for a push behind 17 wrapper words" in `test/unit/privileged-commands.test.ts`; RED record `04-40-red-task3.json` (exit 1): `constructor -x` threw in the wrapper-table lookup.

### WR-03: `npm publish` is not recognized when an unlisted valued option comes first (part A)

- **Plan:** 04-51
- **Commits:** `360dbb0`, `d548047`
- **Test that failed before the fix:** "names every command of a shell string, in order" in `test/unit/privileged-commands.test.ts`; RED record `04-51-red-task2.json` (exit 1): publish after an option npm takes a value for, and npm's abbreviations of publish, were not classified (test "npm publish is found after any option, and only as the subcommand").

### WR-04: `gh api` approval binds endpoint and method but not the request body (part A)

- **Plan:** 04-51
- **Commits:** `51633f3`, `606c69b`
- **Test that failed before the fix:** "denies each with privileged:unapprovable and a reason that says to pass the fields inline, with no request and one policy.denied" in `test/integration/hook-privileged.test.ts`; RED record `04-51-red-task3.json` (exit 1): the attended hook offered an approval request for `gh api graphql -F query=@q.graphql` instead of denying it as privileged:unapprovable.

### WR-05: `knowledgeChunkLimit` returns NaN for a negative cost cap, which removes the cost cap (part A)

- **Plan:** 04-49
- **Commits:** `cf1e41d`, `0ec480c`, `0eab5a5`
- **Test that failed before the fix:** "starts no knowledge invocation, builds no corpus, and the knowledge index step names the budget" in `test/integration/knowledge-cost-cap.test.ts`; RED record `04-49-red-task2.json` (exit 1): with the cost row overrun the pass built and stored an uncapped corpus manifest; `knowledgeChunkLimit(-0.1)` was NaN. The first test (`cf1e41d`) failed for the wrong reason and `0ec480c` corrected it before the fix.

### WR-06: Broad-discovery gate is bypassed by a Grep `glob` or `type` that matches everything (part A)

- **Plan:** 04-49
- **Commits:** `f51a6cd`, `5e39274`
- **Test that failed before the fix:** "without broadDiscovery denies each every-file glob at the clone root as retrieval:broad-discovery-not-authorized, charging nothing" in `test/integration/hook-retrieval.test.ts`; RED record `04-49-red-task1.json` (exit 1): a Grep with glob `*` at the clone root was allowed instead of denied as broad discovery.

### WR-07: Onboarding resume fails open when the launching host cannot be reaped (part B)

- **Plan:** 04-42
- **Commits:** `848c076`, `e4efbc8`
- **Test that failed before the fix:** "resume stops when a started launch cannot be reaped (WR-07, CON-4)" in `test/integration/resume-reap.test.ts`; RED record `04-42-red-task2.json` (exit 1): a started launch with no restricted host, a host with no reap, or no recorded session ID resumed ok instead of returning an internal error.

### WR-08: An interrupted privileged action does not stop a run that is already blocked on another reason (part B)

- **Plan:** 04-42
- **Commits:** `848c076`, `e4efbc8`
- **Test that failed before the fix:** "resume re-blocks the run with reason enforcement_failure, opens the permission decision, and the supervisor no longer continues it" in `test/fault/privileged-no-replay.test.ts`; RED record `04-42-red-task2.json` (exit 1): the blocked run kept reason `decision` instead of `enforcement_failure`.

### WR-09: The no-replay rule is not enforced by the approval gate (part B)

- **Plan:** 04-42
- **Commits:** `c8db2c6`, `70a4222`
- **Test that failed before the fix:** "a second start of the same scope, action and parameters is denied with interrupted-action-open and writes no second action.started" in `test/fault/privileged-no-replay.test.ts`; RED record `04-42-red-task1.json` (exit 1): the second `authorizeAction` returned allow instead of deny with `interrupted-action-open`.

### WR-10: Path-scoped map falls back to the full read scope instead of failing (part B)

- **Plan:** 04-42
- **Commits:** `54454a5`, `af1a505`
- **Test that failed before the fix:** "an empty list: the map is not launched and the error is invalid with field mapping:plan" in `test/integration/refresh-scoped.test.ts`; RED record `04-42-red-task3.json` (exit 1): `prepareInvocation` returned ok for an empty list, a number entry, an out-of-scope path and a missing list.

### WR-11: The whole-file read caps are not enforced by anything a run does (part B)

- **Plan:** 04-55
- **Commits:** `9eace81`, `a65c2c7`, `99f5e2a`, `cefb2e2`
- **Test that failed before the fix:** "allows twenty Reads of a 10-byte file and denies the 21st with budget:retrieval.fullReads; the rows end at 20, 200 and 20 tool calls" in `test/integration/hook-retrieval.test.ts`; RED record `04-55-red-task1.json` (exit 1): the 21st Read of a run was allowed because the hook charged toolCalls only.
- **Test that failed before the fix:** "charges 50 bytes for offset 11 and limit 5 of a file of 100 lines of 10 bytes" in `test/integration/hook-retrieval.test.ts`; RED record `04-55-red-task2.json` (exit 1): a Read of lines 11 to 15 was charged the whole 1000 bytes instead of 50.

### WR-12: A restricted run whose host leaves an unreadable or oversize output aborts the stage after the host ran, and every resume launches the host again (part C)

- **Plan:** 04-44
- **Commits:** `b92d03a`, `d048520`
- **Test that failed before the fix:** "blocks on a plan over 256 KiB, names the unreadable plan, and a resume does not launch the host again" in `test/integration/restricted-mode.test.ts`; RED record `04-44-red-task2.json` (exit 1): the oversize and linked plans left the run in `contract_ready` after the host ran, and a 1.2 MiB patch was stored with no problem named.

### WR-13: The restricted patch is never checked against the contract's write scope, although the owner is told to `git apply` it (part C)

- **Plan:** 04-44
- **Commits:** `d17053b`, `c64a5fb`
- **Test that failed before the fix:** "leaves a path outside the write set and a protected path out of the stored patch, and names both in the block text" in `test/integration/restricted-mode.test.ts`; RED record `04-44-red-task1.json` (exit 1): the stored patch held `diff --git` headers for `.github/workflows/ci.yml` and `package.json`, outside the contract.

### WR-15: Bindings registry write is an unlocked read-modify-write; concurrent writers drop a binding (part D)

- **Plan:** 04-43
- **Commits:** `65b0175`, `c13eebe`
- **Test that failed before the fix:** "repetition 1: after two writers each add 20 bindings, bindings.json holds all 40" in `test/fault/bindings-race.test.ts`; RED record `04-43-red-task2.json` (exit 1): two writers of 20 bindings each left 22, 20 and 21 of 40 bindings in three repetitions.

### WR-16: `cmd:` provider rejects a good credential when the helper's stderr is large (part D)

- **Plan:** 04-43
- **Commits:** `6a0cc76`, `fcf9e91`
- **Test that failed before the fix:** "resolves a helper that prints a 40-character token on stdout and 20 KiB on stderr, and the event carries no value" in `test/integration/credential-broker.test.ts`; RED record `04-43-red-task3.json` (exit 1): a helper with a 20 KiB stderr was refused as oversized.

### WR-17: Profile registry skips a profile config it could not read, so that profile's moved roots are not denied (part D)

- **Plan:** 04-43
- **Commits:** `486e92c`, `58cce13`
- **Test that failed before the fix:** "is an unavailable error naming the profile, not a shorter list" in `test/unit/profile-registry.test.ts`; RED record `04-43-red-task1.json` (exit 1): `knownProfileRoots` returned a shorter list, and the CLI exited 0, for a mode-000 config of another profile.

### WR-18: A code node's graph excerpt carries untrusted neighbour IDs and descriptions but is not marked untrusted (part E)

- **Plan:** 04-41
- **Commits:** `e1060b1`, `614a9ca`, `9870ddb`
- **Test that failed before the fix:** "marks the handle and the item of a code node with a description" in `test/integration/context-adapters.test.ts`; RED record `04-41-red-task3.json` (exit 1): a code node with a description, and an id-only edge to a document, concept or unknown node, came back with `untrusted` undefined.

### WR-19: `gsd-intel` excerpts are never marked untrusted (part E)

- **Plan:** 04-41
- **Commits:** `e1060b1`, `614a9ca`, `9870ddb`
- **Test that failed before the fix:** "gsd-intel marks every handle and item untrusted (WR-19, T-04-110, FR-14)" in `test/integration/context-adapters.test.ts`; RED record `04-41-red-task3.json` (exit 1): every gsd-intel handle and item came back with `untrusted` undefined.

### WR-20: `gsd-planning` `refresh` reads through intermediate symbolic links, contradicting the adapter's stated guarantee (part E)

- **Plan:** 04-41
- **Commits:** `e3992eb`, `3b9002b`
- **Test that failed before the fix:** "answers deleted when .planning/phases is a symbolic link to a directory outside the staging copy that holds the section" in `test/integration/context-adapters.test.ts`; RED record `04-41-red-task2.json` (exit 1): refresh answered fresh or stale through a linked `phases` directory.

### WR-21: Excluded read directories are only excluded at the repository root (part E)

- **Plan:** 04-41
- **Commits:** `e3992eb`, `3b9002b`
- **Test that failed before the fix:** "git-files: an excluded directory is excluded at any depth (WR-21, T-04-111)" in `test/integration/context-adapters.test.ts`; RED record `04-41-red-task2.json` (exit 1): a hit under a nested `node_modules` and `vendor` was returned.

### WR-22: Promotion path check admits `.git` segments and non-canonical paths at the one boundary that writes to the user's checkout (part E)

- **Plan:** 04-44
- **Commits:** `0a501da`, `744ce92`
- **Test that failed before the fix:** "refuses ".planning/codebase/.git/HEAD" with an invalid error naming it, before anything is written into the checkout" in `test/integration/promotion.test.ts`; RED record `04-44-red-task3.json` (exit 1): all five paths (a `.git` segment in two letter cases, dot-only, empty segment, trailing slash) were promoted into the checkout.

### WR-24: `install-host` refuses only on the AVARICE_RUN variable, not on a run's process tree, although it now writes an executable hook entry (part F)

- **Plan:** 04-45
- **Commits:** `1034920`, `1e9a340`
- **Test that failed before the fix:** "exits 64 naming the process tree and writes no skill, no settings.json, no store" in `test/integration/install-host.test.ts`; RED record `04-45-red-task1.json` (exit 1): install-host ran from a run's process tree with AVARICE_RUN unset.

### WR-25: `install-host` writes a hook entry that blocks on failure without checking that the hook script exists (part F)

- **Plan:** 04-45
- **Commits:** `fc131f0`, `f8bb303`, `4c4ea2c`, `b97c0e4`
- **Test that failed before the fix:** "exits 3 naming the path and writes neither the skill nor settings.json (case 0)" in `test/integration/install-host.test.ts`; RED record `04-45-red-task2.json` (exit 1): install-host exited 0 (expected 3) and installed an entry whose script does not exist.
- **Test that failed before the fix:** "lists an error naming the deleted hook script, with a fix naming avarice install-host" in `test/integration/doctor.test.ts`; RED record `04-45-red-task3.json` (exit 1): doctor listed no error for an attended entry whose hook script or node executable was gone.

### WR-27: `approve` reports a missing approval request as "no such approval" (part F)

- **Plan:** 04-45
- **Commits:** `fc131f0`, `f8bb303`
- **Test that failed before the fix:** "answers n or nothing without writing an approval, and an unknown request with exit 64" in `test/integration/approvals.test.ts`; RED record `04-45-red-task2.json` (exit 1): the approvals case failed on its message assertion: `approve` named an unknown request with the wrong noun. The record's own target is the WR-25 case of the same commit.

### WR-30: `spendStep` can under-record (or lose) the spend of a step that really ran (part G)

- **Plan:** 04-46
- **Commits:** `e54ae05`, `cdafbee`
- **Test that failed before the fix:** "records the cap for a step the timeout killed after one finished invocation" in `test/unit/eval-retrieval.test.ts`; RED record `04-46-red-task2.json` (exit 1): a step killed by the timeout after one finished invocation recorded `[]` instead of the cap (`stepSpendUsd` did not exist and `spendStep` did not floor at the cap).

### WR-31: AC-14 `run-one` records 0 spend when the ledger read fails, and under-records partially reported costs (part G)

- **Plan:** 04-46
- **Commits:** `e54ae05`, `cdafbee`
- **Test that failed before the fix:** "run-one records spend at no less than the onboarding may have cost (plan 04-46, WR-31, T-04-126)" in `test/unit/exit-run-phase4-tools.test.ts`; RED record `04-46-red-task2.json` (exit 1): the same record covers the AC-14 side: its second target, "run-one records spend at no less than the onboarding may have cost (plan 04-46, WR-31, T-04-126)", failed with it.

### WR-33: `eval-retrieval.ts --live` has no owner-authorization gate; the ceiling is the only guard (part G)

- **Plan:** 04-46
- **Commits:** `7bea550`, `7ea998b`
- **Test that failed before the fix:** "refuses without AVARICE_LIVE=1, even with a matching current record" in `test/unit/eval-retrieval.test.ts`; RED record `04-46-red-task1.json` (exit 1): `--live` ran without AVARICE_LIVE=1 or an authorization record (64 !== 3).

### WR-35: `exit-run-phase4.sh --run --only <unknown id>` exits 0 having run nothing; `--ruling-ref` without `--only` applies to every repository (part G)

- **Plan:** 04-46
- **Commits:** `a285de4`, `b5fb7bc`
- **Test that failed before the fix:** "exits 2 naming an id that is not on the approved list, and calls run-one zero times" in `test/unit/exit-run-phase4-tools.test.ts`; RED record `04-46-red-task3.json` (exit 1): `--only` with an id off the approved list exited 0 (expected 2) having run nothing.

### WR-39: the artifact-kind source scan misses call sites written with the `{ kind, runId }` shorthand, so the "a new kind cannot be added without deciding whether it is redacted" guard has a hole (part H)

- **Plan:** 04-47
- **Commits:** `a03fdf6`
- **Test that failed before the fix:** "every kind stored through artifacts.put is a map kind or is in REDACTED_TEXT_KINDS" in `test/integration/artifact-redaction.test.ts`; RED record `04-47-red-task1.json` (exit 1): test-only fix; the red record is the strengthened scan failing against a plant (`restricted-patch` removed from REDACTED_TEXT_KINDS, reverted before the commit), a plant the old scan passed.

### WR-40: credential-ref tests `return` early on an unexpected error kind, silently skipping the remaining assertions (part H)

- **Plan:** 04-47
- **Commits:** `bf92fa7`
- **Test that failed before the fix:** "refuses another scheme, an empty or missing name, and a name that could walk out of its lookup, naming the reference" in `test/unit/credential-ref.test.ts`; RED record `04-47-red-task2.json` (exit 1): test-only fix; the red record is the strengthened test failing against a planted parser that answers `denied` for `keychain:../x`, which the old test passed (12 of 12).

### WR-41: the moved-roots sandbox denial is judged only by `exitCode !== 0`, which a timeout, a cancellation or a broken `ls`/`cat` also satisfies (part H)

- **Plan:** 04-47
- **Commits:** `bf92fa7`
- **Test that failed before the fix:** "the same holds for the moved work root, for listing either root, and for the config home that names them" in `test/integration/run-sandbox-other-profiles.test.ts`; RED record `04-47-red-task2.json` (exit 1): test-only fix; the red record is the strengthened denial test failing with `/bin/ls` and `/bin/cat` replaced by `/usr/bin/false`, which the old test passed.

### WR-42: the two process-race tests pass when the processes run one after the other, so they cannot show the race they claim (part H)

- **Plan:** 04-47
- **Commits:** `040c754`
- **Test that failed before the fix:** "runs 25 rounds, each with its own approval, in two processes that start together, and at least one round has the two calls in the store at once" in `test/fault/approval-consume.test.ts`; RED record `04-47-red-task3.json` (exit 1): test-only fix; the red record is the strengthened race test failing when the two processes run one after the other, which the old test passed.

### IN-03: Policy action table has actions that no shell form can reach (part A)

- **Plan:** 04-51
- **Commits:** `51633f3`, `606c69b`
- **Test that failed before the fix:** no separate red record: `test/unit/enforcement-map.test.ts` (commit `51633f3`) pins the rewritten `privileged-approval` row, and the row before `606c69b` read "Evaluates policy in the PreToolUse hook the host runs", which fails its first assertion (`classifies every command of a Bash call`). Record `04-51-red-task3.json` belongs to the WR-04 test of the same commit.

## Skipped Issues

### WR-34: The AC-14 spend authorization is a plain JSON field the agent can write, so the TTY check in `authorize` is not a guard (part G)

- **Plan:** 04-46 (headers only)
- **Commits:** `a285de4`, `b5fb7bc`
- **Reason:** accepted: the authorization record is a procedural guard. The agent runs as the owner's user, so no owner-writable record is out of its reach; the TTY check in `authorize` cannot be a mechanical guard. Plan 04-46 made both tool headers say so (`b5fb7bc`); the Phase 4 spend ledger's ceiling is the mechanical guard.
