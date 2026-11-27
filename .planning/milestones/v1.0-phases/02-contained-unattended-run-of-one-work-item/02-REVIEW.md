---
phase: 02-contained-unattended-run-of-one-work-item
reviewed: 2026-11-07T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - src/adapters/exec/allowlist-proxy.ts
  - src/adapters/exec/sandboxed-executor.ts
  - src/adapters/exec/seatbelt-profile.ts
  - src/adapters/git/run-source.ts
  - src/adapters/git/run-workspace.ts
  - src/adapters/git/safe-git.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/git/staging-clone.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/env.ts
  - src/adapters/host-claude/hook-policy.ts
  - src/adapters/host-claude/invocation-files.ts
  - src/adapters/host-claude/settings.ts
  - src/adapters/host-claude/skill-install.ts
  - src/adapters/sqlite/ledger.ts
  - src/app/budget.ts
  - src/app/checks.ts
  - src/app/invocation.ts
  - src/app/run-resume.ts
  - src/app/run-service.ts
  - src/app/run-stages/finish.ts
  - src/app/run-stages/item.ts
  - src/app/run-stages/prepare.ts
  - src/app/run-start.ts
  - src/cli/args.ts
  - src/cli/commands/onboard.ts
  - src/cli/commands/resume.ts
  - src/cli/commands/supervise.ts
  - src/cli/render/style.ts
  - src/cli/spawn-supervisor.ts
  - src/domain/evidence.ts
  - src/domain/gates.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - src/domain/outcome.ts
  - src/hook/pre-tool-use.ts
  - scripts/checkout-digest.ts
  - scripts/exit-run-phase2.sh
  - test/helpers/live-attended.ts
  - test/integration/run-sandbox-other-profiles.test.ts
  - test/unit/exit-drafts.test.ts
  - test/containment/npm-ci-proxy.test.ts
  - test/integration/install-host.test.ts
  - test/containment/live-attended-phase2.jsonl
  - test/containment/live-run-phase2.jsonl
  - test/containment/live-run-phase2-admission.jsonl
  - test/containment/LIVE-CASES.md
  - docs/system/containment.md
  - docs/system/config-reference.md
findings:
  critical: 1
  warning: 9
  info: 9
  total: 19
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-11-07
**Depth:** standard
**Files Reviewed:** 52 (of 204 in scope; see Summary)
**Status:** issues_found

## Summary

The containment core is carefully built. The hook fails closed, the Seatbelt profile builder refuses unsafe paths, git runs through a hardened environment, and the lease and fence logic is consistent. One real containment bypass exists in the hook's read-only command handling, nine warnings follow, and the four residuals from the security audit are confirmed.

Offline-suite status (2343 pass / 0 fail) says nothing about the critical finding. No test covers `git show <rev>:<secret path>`.

Reviewed in depth: sandbox and proxy adapters, safe git, run workspace, hook policy, hook entry, run stages, budget, checks, supervisor, CLI commands and the exit scripts. Not line-read: most `test/`, `docs/` and `spikes/` files, `src/app/check-validation.ts`, `src/app/onboarding-service.ts`, the rest of `src/domain/*`, and the remaining `src/cli/shell/*` and render files.

## Critical Issues

### CR-01: `git show <rev>:<path>` and `git log -p` bypass the secret-glob read denial

**File:** `src/domain/hook-decision.ts:519-532` (`checkSegment`), `src/domain/hook-decision.ts:391-425` (`parseReadArgs`); admitted commands listed in `src/domain/invocation-scope.ts:83-95`

**Issue:** `git show`, `git log` and `git status` are admitted as read-only shell commands. Their operands are judged as clone-relative file paths. `git show HEAD:.env` has the operand `HEAD:.env`, which is absolutized to `<clone>/HEAD:.env`. That does not match the deny glob `**/.env`, so the hook allows it and git prints the committed secret file.

Two further forms leak the same way. `git show :.env` reads the staged blob. `git log -p` with no pathspec prints every committed diff, including those of secret-glob files. Both are allowed.

Confirmed by calling `decideToolCall` with the run-purpose policy and `denyReadGlobs: ['**/.env', ...]`:

| Command | Decision |
|---|---|
| `git show HEAD:.env` | allow (`shell-identity`) |
| `git show :.env` | allow |
| `git log -p` | allow |
| `cat .env` | deny (`deny-secret-read`) |
| `git log -p --follow -- .env` | deny (`deny-secret-read`) |
| `git show HEAD:config/.env.local` | deny, by accident, because the `/` splits the operand |

Any secret file that is tracked in the repository reaches the model, even though Read, cat and the settings `Read(...)` deny rules all refuse it. That defeats the `deny-secret-read` control (CON secret globs) for exactly the files the globs exist to protect. No test pins this: grep of `test/` finds no `git show` or `git log` case with a secret path.

**Fix:** Do all of the following in `checkSegment` for `git` entries:
- Treat any operand containing `:` as `<rev>:<path>`. Split on the first `:`, run the read rule on the path part (for `:path`, on the whole remainder), and refuse a `:`-word whose path cannot be resolved.
- For `git show` and `git log`, refuse patch-producing output unless every changed path is checked. Concretely, require `--no-patch`/`-s` for `show` and refuse `-p`, `-u`, `--patch`, `--cc`, `-c`, `--stat`, `--raw`, `--name-only` and `--name-status` for `log`. Simpler still: drop `git show` and `git log -p` from `READ_ONLY_COMMANDS` and keep `git log --format=...`.
- Add test cases: `git show HEAD:.env`, `git show :.env`, `git log -p` must each deny when the clone tracks `.env`.

## Warnings

### WR-01: Unsanitized note and reason printed to the terminal (audit residual W-1, confirmed)

**File:** `src/cli/commands/onboard.ts:54-55`, `src/cli/commands/resume.ts:56-57`

**Issue:** `message` (the last stage note) and `reason` are written with `io.out` without `stripControl`. `supervise.ts:48` strips the same text, so this is inconsistent. Notes are built from repository-derived strings, so an escape sequence in one can rewrite the user's terminal (T-02-03). `resume.ts:45,49,52` also echo the user-supplied `onboardingId` and `describeError(e)` raw.

**Fix:**
```ts
io.out(`${resultLine(`onboarding ${onboardingId}`, state, reason)}\n`);
if (message !== null) io.out(`${stripControl(message)}\n`);
```
Use `errorLine('onboard'|'resume', ...)` for the error lines.

### WR-02: Install egress proxy admits any declared host, including loopback and private addresses

**File:** `src/domain/conventions.ts:224-237` (`readHosts`), `src/domain/run-contract.ts:476`, `src/adapters/exec/allowlist-proxy.ts:95`

**Issue:** `registryHosts` only has to be a syntactically valid bare host. `localhost`, `127.0.0.1`, `169.254.169.254` or an intranet name are accepted. The proxy then opens a connection to it, with no check on the resolved address.

The conventions file can come from the newest descendant commit that changes only `.avarice/`. Whoever can commit there can therefore point the sandboxed install command, whose argv is also taken from that file, at services on the user's machine or LAN through the proxy. The documented intent is "registry-only".

**Fix:** In `readHosts`, reject IP literals, `localhost` and single-label names. Optionally require a known registry suffix, or an explicit owner-level allowlist. In the proxy, resolve the host with `dns.lookup`, refuse loopback, link-local and private ranges, and connect to the vetted address. That also closes DNS rebinding.

### WR-03: Check, install and list sandboxes deny only three credential directories

**File:** `src/app/checks.ts:120`, `src/domain/invocation-scope.ts:289`

**Issue:** The command sandboxes use `(allow default)` for reads and deny only `~/.ssh`, `~/.aws`, `~/.config/gh`, the data root and the AVARICE parents. Repository code runs there: install, checks and list commands. Agent-written test code is included, and it runs outside the hook's allow-list.

It can read `~/.gnupg`, `~/.netrc`, `~/.npmrc`, `~/.docker/config.json`, `~/.kube`, `~/.config/gcloud` and `~/Library/Keychains`. It can copy them into the scratch directory, which is writable here and is a read root of the next agent invocation. That is a path from host secrets to the model. Check output is also stored unredacted as an artifact (`checks.ts:217,226`), while transcripts go through `redactSecrets`. The three-directory list is a documented choice (`docs/system/containment.md:349-350`), but the residual risk is larger than the docs imply.

**Fix:** Extend the deny list to the common credential locations above, or invert it to an allow-list of system paths plus the clone and scratch. Run `redactSecrets` over check output before `artifacts.put`. Document the scratch-to-agent channel in the limits section.

### WR-04: A crashed host that reports no result is charged $0

**File:** `src/app/invocation.ts:152-159` (`wasKilled`), `src/adapters/host-claude/claude-host.ts:248`

**Issue:** `killed` is true only for a timeout or a signal. A host that exits non-zero with no `result` event, not timed out and with no signal, gets `costUsd: result?.totalCostUsd ?? 0` and `killed: false`, so the budget is charged nothing. That is the case the CON-16 retry exists for: the unit crashes, is discarded and is retried. Spend on the crashed attempt is invisible to the cost budget, which contradicts the "nothing is refunded" rule in `budget.ts:11-14`.

**Fix:** Treat `details.resultSeen === false` as killed in `wasKilled`:
```ts
return d !== undefined && (d.timedOut || d.signal !== null || d.resultSeen === false);
```

### WR-05: Orphan charging is three separate ledger writes

**File:** `src/app/budget.ts:108-119` (`chargeOrphans`)

**Issue:** Moving the reservation to used, charging the orphans' cost and appending the event are three calls with no enclosing transaction. A kill after the first leaves the invocation spent but the cost uncharged. On the next resume `reserved` is already 0, so the cost is never charged. That is a permanent under-charge on exactly the path CON-13 is meant to protect.

**Fix:** Add a ledger method that does both budget charges and the event in one `tx`, for example `settleOrphans(runId, count, costUsd, event)`. Or charge cost first and invocations last, so a retry cannot lose the cost.

### WR-06: Commit-id patterns disagree between adapters and domain (SHA-256 repositories)

**File:** `src/domain/evidence.ts:38`, `src/domain/gates.ts:146` versus `src/adapters/git/staging-base.ts:22`

**Issue:** The adapters accept 40- or 64-hex commit ids (`COMMIT_SHA`). `revisionOf` and G4 accept only 40. A SHA-256 repository passes `start`, the clone and the unit invocation, then fails with `invalid revision.head` in `cloneRevision` and G2, after an invocation has been spent.

**Fix:** Use one shared pattern in `evidence.ts` and `gates.ts`. Or reject non-40-hex repositories at `start` preflight.

### WR-07: `Math.min(...times)` throws on a large commit range

**File:** `src/adapters/git/run-source.ts:74`

**Issue:** `git log pin..head` is unbounded and is spread into `Math.min`. Above about 100k commits outside `.avarice/` and `.planning/`, this throws `RangeError`. `start` crashes with an uncaught exception instead of reporting staleness.

**Fix:** `times.reduce((a, b) => (a < b ? a : b))`, or request the oldest commit directly with `git log --reverse --max-count=1 --format=%ct`.

### WR-08: Live attended harness allows `Bash(cat:*)` (audit residual W-3, confirmed)

**File:** `test/helpers/live-attended.ts:474-477`

**Issue:** The allow list contains `Bash(cat:*)`, `Bash(head:*)` and `Bash(git diff:*)`. A permission prefix match does not stop `cat > file` redirection or `git diff --output=file`, so the harness can write outside `Edit(...)`. The harness is meant to model the owner's own session, not the contained run, but this widens what a live case can modify.

**Fix:** Remove `cat` and `head`. Rely on `Read`, or use anchored rules such as `Bash(git status)` and `Bash(git log --oneline:*)`.

### WR-09: `cleanupAttended` recursively deletes directories under the real home with no containment assertion (audit residual W-2, confirmed)

**File:** `test/helpers/live-attended.ts:559-563`

**Issue:** The fixture's profile directories live under the real `~/.local/share/avarice*`. They are removed with `rmSync(..., {recursive: true, force: true})`, with no assertion that they are fixture-created, nor that the `fixture.evidenceDir` realpath is under `tmpdir()`.

**Fix:**
- Assert `realpathSync(dir)` starts with the fixture's own unique prefix before each recursive removal.
- Assert `realpathSync(evidenceDir)` starts with `realpathSync(tmpdir())`.
- Throw instead of deleting when either check fails.

## Info

### IN-01: Home path committed in four live-evidence files (audit residual W-4)

**File:** `test/containment/live-attended-phase2.jsonl:1`, `test/containment/live-run-phase2.jsonl`, `test/containment/live-run-phase2-admission.jsonl`, `test/containment/LIVE-CASES.md`
**Issue:** The owner's absolute home path appears in each, not just the attended log.
**Fix:** Rewrite to `~` before commit, for example in the recorder with `replaceAll(home, '~')`.

### IN-02: Portfolio drafts test passes vacuously on any other machine

**File:** `test/unit/exit-drafts.test.ts:21,48,53`
**Issue:** The default path is `~/aa-phan-portfolio-v2` with a hard-coded pin. The checks against the real package.json and file existence are skipped when the checkout is absent.
**Fix:** Mark the suite as owner-machine-only explicitly (a named env flag), and keep the parse and compile cases unconditional. The skip reason already says so; make it visible in the summary.

### IN-03: Literal invisible characters in the control-strip regex, with incomplete coverage

**File:** `src/cli/render/style.ts:15`
**Issue:** `BIDI` is written with raw bidi override characters, which are hard to review or edit, and which the injection scanner flagged as false positives. It omits U+200E, U+200F, U+061C and the zero-width U+200B to U+200D.
**Fix:** Write the class with \u escapes, covering U+061C, U+200B-U+200F, U+202A-U+202E and U+2066-U+2069.

### IN-04: `checkRelative` splits on backslash

**File:** `src/adapters/git/staging-base.ts:90`, used by `src/adapters/git/run-workspace.ts:68-76`
**Issue:** On POSIX, a tracked file named `a\b` is rewritten to `a/b` by `checkCommitPath`. The commit then fails, or names a different path.
**Fix:** Split on `/` only. Reject a backslash explicitly if Windows semantics are not wanted.

### IN-05: Resume silently skips reaping when it cannot

**File:** `src/app/run-resume.ts:81`
**Issue:** A `launch:*` step with no `sessionId`, or a host with no `reap`, is skipped and then marked `interrupted`. A surviving host in that case is never ended before the clone is read.
**Fix:** Fail the reconcile for a `started` step when a reap is impossible, or record that nothing was reaped.

### IN-06: Host invocation takes a signal that is never aborted

**File:** `src/app/run-stages/item.ts:511`
**Issue:** `new AbortController().signal` is created and never aborted. Losing the lease (`run-service.ts:131`) cannot cancel an in-flight unit. The old supervisor keeps waiting on a host until the wall clock, until the new supervisor's reap kills it.
**Fix:** Pass an abort signal into the stage context. Abort it from the lease-loss branch in `runSupervisor`, and optionally on SIGTERM.

### IN-07: `test:<text>` acceptance matches by substring

**File:** `src/app/run-stages/finish.ts:203-207`
**Issue:** An acceptance criterion is satisfied by any test id that contains the text, including a test the unit itself just added. The inventory comparison only detects weakening.
**Fix:** Match whole test ids, or require the matched id to exist in the base inventory or in an explicit contract list.

### IN-08: Gated-commit recognition does not check the commit's parent

**File:** `src/app/run-stages/item.ts:419-433`
**Issue:** After a kill, `reconcileGated` accepts a moved HEAD whose trailers name this run and attempt. It does not check that its parent is the snapshot head or that it is a single commit.
**Fix:** `git rev-list --count snapshot..head` must be 1, and the parent must equal `snapshot.head`.

### IN-09: Run-ref allowance in the checkout digest is a prefix match

**File:** `scripts/checkout-digest.ts:37,48-51`
**Issue:** `refs/heads/avarice/run_*` is converted with `*` to `.*`, which crosses `/`. Any number of extra refs under that prefix are excluded from `refsDigest`, so "exactly one new ref" is not proven. Only `counts.refsAllowed` reveals it.
**Fix:** Match `^refs/heads/avarice/run_[0-9A-Z]{26}$`, and assert `refsAllowed <= 1` in the exit evidence.

---

_Reviewed: 2026-11-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
