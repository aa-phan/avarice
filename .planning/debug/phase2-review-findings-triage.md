---
status: diagnosed
trigger: "G-02-H4 / UAT Test 4 (02-HUMAN-UAT.md): triage every open Phase 2 review finding (02-REVIEW-DISPOSITION.md CR-01, WR-01..WR-09, IN-01..IN-09; 02-26-REVIEW.md WR-01, WR-02, IN-01..IN-04); owner said 'fix it'"
created: 2026-11-07T00:00:00Z
updated: 2026-11-07T00:00:00Z
goal: find_root_cause_only
head: 86e6c4da67cd4dbe02ea6ffc231749a92c5a4903
---

## Current Focus

hypothesis: DONE. Every finding was judged against HEAD 86e6c4d individually (code read at file:line, plus a scratch reproduction where a reproduction was cheap).
test: scratch scripts under /Users/aphan/.claude-edu/jobs/eebeb914/tmp/triage/ (cr01.mts, wr02.mts, wr03.mts, wr06.mts, in03.mts, in04.mts, wr02-26.mts); no tracked file touched
expecting: n/a
next_action: return ROOT CAUSE FOUND to the caller (plan-phase --gaps plans the fixes)
bug_class: Bohrbug (all deterministic); WR-05 is a crash-window (kill between writes) that is traced, not executed

## Symptoms

expected: every open Phase 2 review finding is fixed, or skipped/deferred with a recorded reason, and the disposition files show each outcome
actual: owner reported "fix it" for UAT Test 4
errors: none
reproduction: 02-HUMAN-UAT.md Test 4
started: owner UAT after gap-closure plan 02-26

Naming used below: `R-` is 02-REVIEW.md (phase-wide), `S-` is 02-26-REVIEW.md (scoped to plan 02-26). The scoped review's CR-01 is gap G-02-H2, diagnosed in `.planning/debug/git-object-name-symlink-secret-bypass.md`; it is not triaged here.

## Eliminated

- hypothesis: "R-CR-01 (git show/log secret read) is still open"
  evidence: cr01.mts against HEAD with the real decideToolCall, real canonicalAbsolute, real git and the default secretGlobs: `git show HEAD:.env`, `git show :.env`, `git log -p --follow -- .env`, `git show HEAD:config/.env.local` DENY(deny-secret-read); `git log -p`, `--patch`, `-u` DENY(shell-git-output); `git show HEAD` DENY(shell-git-object). git itself prints the sentinel for every one of them, so the refusals are not vacuous. Allowed and harmless: `git log --oneline`, `--stat`, `git status`.
  timestamp: 2026-11-07
- hypothesis: "R-IN-02 (portfolio drafts test passes vacuously on another machine) is a defect"
  evidence: with AVARICE_PORTFOLIO=/nonexistent the suite reports `skipped 7` and the spec reporter prints each skip with its reason (`# the portfolio checkout /nonexistent is absent`). A skipped test is not a pass. The parse and compile cases are already unconditional (the first `describe` has no skip).
  timestamp: 2026-11-07
- hypothesis: "S-WR-02 (two git option tables disagree) is exploitable today"
  evidence: wr02-26.mts: `git status -M HEAD:.env`, `git log -C HEAD:.env`, `git show -M HEAD:.env` are all DENY(shell-git-output) because checkGitOutput refuses every letter outside its allow-list; `git log -n HEAD:.env` is ALLOW but git itself rejects a non-numeric `-n` value and prints nothing. The drift is latent.
  timestamp: 2026-11-07

## Evidence

- timestamp: 2026-11-07
  checked: R-WR-03 repro (wr03.mts): fake HOME holding a sentinel in each credential path, deny list built by the real `sandboxSetup`, real `/bin/cat` through the real SandboxedExecutor (sandbox-exec works in this session)
  found: `.ssh`, `.aws`, `.config/gh` denied; `.gnupg`, `.netrc`, `.npmrc`, `.docker/config.json`, `.kube/config`, `.config/gcloud`, `Library/Keychains` READABLE; `cp ~/.netrc <scratch>/stolen` exits 0 (scratch is writable there and is in the run purpose's allowRead, src/domain/invocation-scope.ts:521)
  implication: R-WR-03 reproduced
- timestamp: 2026-11-07
  checked: R-WR-02 repro (wr02.mts): parseConventions with registryHosts holding each candidate
  found: `localhost`, `127.0.0.1`, `169.254.169.254`, `10.0.0.5`, `192.168.1.1`, `intranet`, `2130706433`, `0x7f.1`, `127.1`, `metadata.google.internal` are all ACCEPTED. The proxy then calls `connect(port, host)` with no address check (src/adapters/exec/allowlist-proxy.ts:95).
  implication: R-WR-02 reproduced at the validator; the numeric spellings show a syntactic IP-literal refusal alone is incomplete
- timestamp: 2026-11-07
  checked: R-WR-06 repro (wr06.mts): a real `git init --object-format=sha256` repository
  found: `GitRunSource.head()` returns 64 hex and `staleness()` is ok; `revisionOf({head: <64 hex>})` returns `invalid revision.head: expected 40 lowercase hex characters`
  implication: R-WR-06 reproduced (adapter 40|64, domain 40)
- timestamp: 2026-11-07
  checked: R-IN-03 repro (in03.mts) of stripControl
  found: the BIDI class holds 4 raw code points (U+202A, U+202E, U+2066, U+2069 as range ends); U+200E, U+200F, U+061C, U+200B, U+200C, U+200D, U+2060, U+FEFF, U+00AD are KEPT
  implication: R-IN-03 valid on both counts (raw characters, incomplete coverage)
- timestamp: 2026-11-07
  checked: R-IN-04 repro (in04.mts): checkRelative('a\\b')
  found: returns segments ['a','b'] on POSIX where `a\b` is one legal file name; callers join them (`checkCommitPath` joins with `/`; `removeAddedPath` and `clearDirectoryInTheWay` join under the clone root)
  implication: R-IN-04 valid; the wrong path is acted on
- timestamp: 2026-11-07
  checked: R-WR-07 spread limit
  found: `Math.min(...new Array(n))` is fine at 100000 and throws RangeError at 125000 on this Node (v26.9); runGit's output cap is 64 MiB (src/adapters/git/safe-git.ts:35), so a 125k-line `git log` is delivered to the spread
  implication: R-WR-07 valid
- timestamp: 2026-11-07
  checked: hook-git-secret-reads integration suite at HEAD (`node --test test/integration/hook-git-secret-reads.test.ts`)
  found: 56 pass; diagnostics show `git show :sub printed the sentinel of sub/.env: no; hook: allow shell-identity`, `git log --cc` prints the sentinel (hook denies it), `git show HEAD:.ENV` prints none
  implication: the hook decisions are right today; S-WR-01 is about the test not asserting what git does for the allowed `:sub`

## Resolution

root_cause: see "Per-finding triage" below. Summary: 1 already-fixed (R-CR-01), 1 not-a-defect (R-IN-02), 1 valid-but-design-decision (R-IN-07), 22 still-valid with a bounded fix; none needs a paid or live run to verify.
fix: (not applied: find_root_cause_only)
verification: reproduced where noted in Evidence; the rest traced at file:line
files_changed: []

---

# Triage table

Size: S = under about 40 changed lines, one module; M = several modules or a new port method; L = cross-cutting. "Offline" = verifiable with `node --test` on this machine without the network and without a paid host run (macOS sandbox-exec is available here and costs nothing).

| ID | Verdict at HEAD | Root cause (one line) | Fix direction | Size | Risk | Touches | Offline | Plan |
|----|-----------------|-----------------------|---------------|------|------|---------|---------|------|
| R-CR-01 | already-fixed (02-26) | git object names and patch-producing options now refused (hook-decision.ts:502-514 `checkGitObjects`, :533-595 `GIT_OUTPUT_FORMS`/`checkGitOutput`) | none; mark `fixed`. Residual symlink gap is G-02-H2 | - | - | CON-1 | yes | record only |
| R-WR-01 | still-valid | `onboard.ts:54-55` and `resume.ts:45,49,52,56-57` print recorded text with `io.out`/`io.err` and no `stripControl`; the run paths (`supervise.ts:48-51`, `resume.ts:77-124`) already do | route every line through `resultLine`/`errorLine`/`stripControl`; best as one shared outcome printer | S | low | T-02-03, OPS-7 | yes | P4 |
| R-WR-02 | still-valid, reproduced | `readHosts` (conventions.ts:224-237) accepts any bare host; the proxy dials it unvetted (allowlist-proxy.ts:95); allow entries are `${host}:443` (checks.ts:355) | refuse localhost/IP-literal/single-label hosts in `readHosts` AND resolve-and-vet in the proxy (refuse loopback/link-local/private/CGNAT, connect to the vetted address) | M | medium (tests use a loopback registry) | CON-5, RC-5, D-11, T-02-15 | yes (loopback servers) | P3 |
| R-WR-03 | still-valid, reproduced | the 3-directory credential list is repeated in checks.ts:120, invocation-scope.ts:291 and :488 (feeds the host sandbox and hook too); sandbox is `(allow default)` for reads | one shared `CREDENTIAL_DIRS` constant, extended; redact check output before `artifacts.put` (checks.ts:226) | M | low-medium | RC-5 (credentials), CON-5, CON-1 | yes (real sandbox-exec, fake HOME) | P3 |
| R-WR-04 | still-valid | `wasKilled` (invocation.ts:152-159) ignores `details.resultSeen === false`; host reports `costUsd: result?.totalCostUsd ?? 0` (claude-host.ts:248); crashed unit (exit != 0, no result) is charged 0 | add `|| d.resultSeen === false` | S | low-medium (an instant startup failure now charges a full reservation) | CON-13, CON-16 | yes | P2 |
| R-WR-05 | still-valid (traced) | `chargeOrphans` (budget.ts:108-117) = 3 separate ledger writes; after write 1 `reserved` is 0, so a retry sees no orphan and the cost is never charged. `settleInvocation` (budget.ts:202-209) has the same 3-write shape (not in the review) | one ledger method that does all budget charges (+ event) in one `tx`; use it from both | M | low | CON-13, kill-survival | yes | P2 |
| R-WR-06 | still-valid, reproduced | `COMMIT_SHA` (staging-base.ts:22) is 40\|64 hex; evidence.ts:38 and gates.ts:146 are 40 only (so are freshness.ts:7, knowledge-corpus.ts:17, graph-validation.ts:4, knowledge-validation.ts:33) | narrow `COMMIT_SHA` to 40 hex so a SHA-256 repo is refused at the first adapter call (S), rather than widening 6 domain patterns (M) | S | low | start preflight | yes | P4 |
| R-WR-07 | still-valid | `Math.min(...times)` at run-source.ts:74 throws RangeError above ~100k commits | `reduce`, or `git log --reverse --max-count=1` for the oldest | S | low | start preflight | yes | P4 |
| R-WR-08 | still-valid (config); exploitability unverified | `attendedSettings` allows `Bash(cat:*)`, `head`, `git diff`, `git show` etc. (live-attended.ts:474-477); a prefix rule does not stop `cat > f` or `git diff --output=f` | drop `cat`/`head`; anchor or drop `git diff` | S | low; changes what the harness measures | live evidence provenance | settings offline; live re-run not needed | P6 |
| R-WR-09 | still-valid | `cleanupAttended` (live-attended.ts:559-563) `rmSync(..., recursive)` of dirs under the real home and of `evidenceDir` with no containment assertion (creation asserts only that they did not exist) | `realpathSync(dir)` must start with the fixture's own prefix / tmpdir, else throw | S | low | test hygiene | yes (unit test with a forged fixture) | P6 |
| R-IN-01 | still-valid, low value | 4 evidence files hold `/Users/aphan` (1 line each); the same string is in 28 spike evidence files, 1 doc, 1 script and 113 `.planning` files | redact in the record writers (live-attended.ts:252, live-run.test.ts:37) + rewrite the 4 files to `~`; the wider residue is a public-release decision | S | low | evidence hygiene | yes | P6 |
| R-IN-02 | not-a-defect | skipped tests are reported `skipped 7` with the reason printed; parse/compile cases are unconditional | skip with reason | - | - | - | - | none |
| R-IN-03 | still-valid, reproduced | style.ts:15 holds raw bidi characters; U+200E/200F/061C/200B-D/2060/FEFF not stripped | `\u` escapes; add U+061C, U+200B-U+200F, U+2060, U+FEFF | S | low | T-02-03 | yes | P4 |
| R-IN-04 | still-valid, reproduced | staging-base.ts:90 splits on `[\\/]`; `a\b` becomes `a/b` | split on `/` only (the product is macOS-only) | S | low | CON-2 (discard) | yes | P4 |
| R-IN-05 | still-valid, defensive branch | run-resume.ts:81 `continue`s when `host.reap` is absent or `sessionId` is missing; production always has both (invocation.ts:131-140 records a `randomUUID()` session id; ClaudeHostAdapter.reap exists) | return an error (or record a failed `resume:reconcile`) instead of `continue`, restoring the T-02-56 invariant | S | low | FR-7, T-02-56 | yes | P5 |
| R-IN-06 | still-valid | item.ts:511 passes `new AbortController().signal`; `runSupervisor` (run-service.ts:131-136) only sets `lease.lost`, checked at the top of the loop, so a lost lease waits out the unit's wall clock | add `signal` to `RunStageContext`; abort it from the renewal-failure branch (and on SIGTERM in supervise); the host already honors abort (claude-host.ts:138,319) | M | medium (cancelled-outcome handling under a lost lease) | CON-13, FR-7 | yes (fake host, real process group) | P5 |
| R-IN-07 | valid observation, documented design | finish.ts:204-207 matches `id.includes(text)`; docs/system/checks-and-evidence.md:123 and runs.md:280 document substring; proposal docs/contracts-and-state.md:126-127 shows exact ids. The suggested whole-id match breaks the owner's R1 briefs (`test:isIsoYearMonth`, `test:ignores non-finite deltas`) | owner decision. Default: defer, add a findings.md line for the proposal divergence | M if tightened | medium-high | G4 acceptance semantics | yes | defer |
| R-IN-08 | still-valid | item.ts:419-433 `reconcileGated` checks trailers only, not that the commit's parent is `snapshot.head` or that the range is one commit | `rev-list --count snapshot..head == 1` and parent == snapshot.head (new workspace port method) | S-M | low | T-02-57 | yes | P5 |
| R-IN-09 | still-valid, mitigated | checkout-digest.ts:37 `RUN_REF_GLOB` `*` crosses `/`; but exit-run-phase2-tools.ts:699-706 already fails any new ref other than `refs/heads/avarice/<runId>` | anchored single-segment regex for `--allow-run-refs`; update the test that uses `run_01TESTRUN` | S | low | exit evidence | yes | P6 |
| S-WR-01 | still-valid | hook-git-secret-reads.test.ts:171-180 (and :152-169, :182-190) only `t.diagnostic` git's output | move `git show :sub` into the `admitted` list (asserts no sentinel); keep `.ENV` conditional | S | low | CON-1 | yes | P1 |
| S-WR-02 | still-valid, latent | `SHORT_VALUE_OPTIONS` (hook-decision.ts:339-347) disagrees with `GIT_OUTPUT_FORMS` (:533-558); a word taken as a value skips `checkGitObjects` (:634) | derive the git rows from `GIT_OUTPUT_FORMS`; add a unit test pinning the tables | S-M | medium (refactor of the security parser) | CON-1 | yes | P1 |
| S-IN-01 | still-valid, negligible reach | object path resolved from `stagingPath` and the shell cwd (hook-decision.ts:510); the model has no `cd` or `git -C` (READ_ONLY_COMMANDS, invocation-scope.ts:81-94) | skip with reason; one sentence in docs/system/containment.md rule 12 | S | none | - | yes | P1 (doc line) |
| S-IN-02 | still-valid (usability) | `git log --max-count 5` is DENY(shell-git-output) and `--grep=.env` is DENY(deny-secret-read); `deny()` (hook-decision.ts:107) carries no `reason` though `HookDecision.reason` exists (:88) | add a corrective `reason` to `shell-git-output`/`shell-git-object` denials; unit tests compare `[decision, rule]` only | S | low | usability | yes | P1 |
| S-IN-03 | still-valid, design gap, no known leak | `GIT_OUTPUT_FORMS` has no entry for `git rev-parse`/`git ls-files` (probe: `git ls-files --with-tree=HEAD`, `git rev-parse HEAD:.env` behave; no option prints blob content on git 2.39.5) | record the reason beside the table (comment), or add entries | S | none | - | yes | P1 |
| S-IN-04 | still-valid | `rig()` runs in 7 `describe` bodies at collection time (hook-git-secret-reads.test.ts:74,93,112,141,153,172,183); `gitOutput` splits on single spaces (:68-71) | build rigs in `before`; give `gitOutput` an argv form or the hook's lexer | S | low | test quality | yes | P1 |

---

# Per-finding notes

## R-CR-01 already-fixed
Plan 02-26 added `checkGitObjects` (hook-decision.ts:498-514), `GIT_OUTPUT_FORMS` and `checkGitOutput` (:516-595) and the call at :634. The reproduction table in 02-REVIEW.md CR-01 now reads: `git show HEAD:.env` deny-secret-read, `git show :.env` deny-secret-read, `git log -p` deny shell-git-output, `git show HEAD:config/.env.local` deny-secret-read. Plan tests: `test/unit/hook-decision.test.ts`, `test/integration/hook-git-secret-reads.test.ts` (56 pass). Disposition: `fixed`. The remaining symlink bypass is G-02-H2.

## R-WR-01 unsanitized note and reason
Root cause: the onboarding branch of two commands bypasses the shared text style. `message` is the last stage `ctx.note` (onboarding-service.ts:186), and notes are built from repository-derived strings: activate.ts:132 (staging paths), validate.ts:151 (secret-hit locations), contract.ts:61 (a parse detail). A file name may hold an ESC byte. Run commands already print through `resultLine`/`errorLine`/`stripControl`.
Files: src/cli/commands/onboard.ts:54-55 (also :43 and :50 echo `describeError`), src/cli/commands/resume.ts:45,49,52,56-57.
Fix: `resultLine(\`onboarding ${id}\`, state, reason)` and `stripControl(message)`; use `errorLine('onboard'|'resume', ...)` for errors. Cleaner: one `outcomeLines()` pure function in `src/cli/render/` used by onboard, resume and supervise, which also makes it unit-testable without building `AppDeps`. Size S. Offline.
Note: no test calls these `run()` functions directly today (the CLI tests spawn the binary), so the new test goes on the pure helper.

## R-WR-02 install egress proxy admits loopback and private hosts
Root cause: the host allowlist is a syntax check only (`HOST_LABEL` per dot label, conventions.ts:222-237), so any IPv4 spelling (including `2130706433`, `0x7f.1`, `127.1`) passes; the proxy compares the requested `host:port` to the allowlist string and then `connect(port, host)` (allowlist-proxy.ts:95) without looking at the resolved address. Provenance of the list: `.avarice/config.json` from the newest descendant commit that changes only `.avarice/` (run-source.ts:30-58), and the install argv comes from the same file. The reach is port 443 only (checks.ts:355), the sandbox's only egress, so it is SSRF to `:443` on loopback, link-local (169.254.169.254) or the LAN. `docs/system/containment.md:443` documents "the proxy trusts DNS for an allowed registry name"; it does not mention private addresses.
Fix direction (two layers, because a syntactic refusal cannot be complete):
1. `readHosts`: refuse `localhost`, single-label names and any host whose labels are all numeric or `0x..` forms. `src/domain` may import only relative paths plus `node:crypto` (check-boundaries), so this is a hand-written regex, not `node:net.isIP`.
2. `allowlist-proxy.ts` (adapter, may import `node:dns`/`node:net`): `dns.lookup(host, {all:true})`, refuse the connection if any address is loopback, link-local, private (RFC 1918), CGNAT, unspecified or IPv6 equivalents, then `connect(port, vettedAddress)`. This also closes rebinding.
Test impact (the load-bearing detail): `test/unit/conventions.test.ts:205` pins `127.0.0.1` as an accepted registry host, and `test/integration/run-deps.test.ts:67` (`registryHosts: ['127.0.0.1']`, fake registry on a loopback port via `proxyAlso`) and `test/integration/allowlist-proxy.test.ts`, `test/containment/npm-ci-proxy.test.ts` all rely on dialing loopback. The fix needs a test seam: an injected `lookup`/`allowPrivate` option on `startAllowlistProxy` (production never sets it, like `sandboxExecPath`), and run-deps must use a name that the seam maps to loopback rather than a literal.
Docs: docs/system/containment.md (lines ~367, 376, 443) and config-reference.md:136 (`registryHosts` rules). Size M. Offline.

## R-WR-03 credential directories
Root cause: three code sites hold the same 3-directory list, and the command sandboxes use `(allow default)` for reads. Reproduced (Evidence). The list feeds: the supervisor's install/check/inventory sandbox (`sandboxSetup`, checks.ts:120), the onboarding scope (invocation-scope.ts:291) and the run scope's `credentialDirs` (invocation-scope.ts:488, which becomes the host's `sandbox.filesystem.denyRead` and the hook's `denyRead`, settings.ts:122-124). A contract command the model runs through the host Bash tool is therefore exposed the same way. The scratch channel is real: scratch is writable to those commands and is in the run purpose's `allowRead` (invocation-scope.ts:521), so the model's Read tool can read what they copied there. Check output is stored unredacted (checks.ts:215-226) while transcripts go through `redactSecrets` (claude-host.ts:239); the check-output artifact is not read back into prompts (only inventory artifacts are, checks.ts:517), so that half is owner-visible, not model-visible.
Fix: one exported `CREDENTIAL_DIRS` (home-relative: `.ssh .aws .config/gh .gnupg .netrc .npmrc .docker .kube .config/gcloud Library/Keychains`, plus `.git-credentials`, `.pgpass` if wanted) in `src/domain/invocation-scope.ts`, used by all three sites; `redactSecrets` over `output` before `artifacts.put` (checks.ts:226). HOME is already redirected to scratch for these commands (checks.ts:118), so legitimate tools do not need the real home credentials. Do not invert to an allow-list: node/npm need many system paths; that is L and risky. Update the "three credential directories" sentence in containment.md (~line 349) and the limits section.
Tests: extend `test/unit/invocation-scope.test.ts`, `test/unit/claude-settings.test.ts`; add a real-sandbox test with a fake HOME (wr03.mts is the template). Size M. Offline, free.

## R-WR-04 crashed host charged $0
Root cause: `wasKilled` (invocation.ts:152-159) treats only `timedOut` or `signal !== null` as killed; `settleInvocation` charges `Math.max(reported, reservation)` only when `killed` (budget.ts:200-210). A host that exits non-zero with no `result` event reports `costUsd: result?.totalCostUsd ?? 0` (claude-host.ts:248), so the charge is 0. That is the CON-16 retry path (`crashed`, item.ts:610: `exitCode !== 0 || signal !== null || !resultSeen`).
Fix: `|| d.resultSeen === false` (the review's one-liner is right). Decide the clean-exit-no-result case (exit 0, `resultSeen=false`) deliberately: it is also an unknown cost, so charging the reservation is consistent. Risk: a host that fails instantly at startup (bad flag) now charges a full per-invocation cap; the invocation unit is spent anyway.
Tests: test/fault/budgets.test.ts has the `outcomeOf` helper whose default `details` is `resultSeen: false` (line ~375); existing non-killed cases that rely on the default must set `resultSeen: true`. Add the crashed case. Size S. Offline.

## R-WR-05 orphan charging not atomic
Root cause: `chargeOrphans` (budget.ts:95-123) does `chargeBudget(invocations, fromReserved)`, `chargeBudget(costUsd)`, `appendEvent` as three `tx` calls. The orphan count is read from `reserved` (budget.ts:97), which write 1 sets to 0, so a kill between 1 and 2 loses the cost for good. Same shape in `settleInvocation` (budget.ts:202-209): invocations, wallClockMs, costUsd in three writes; a kill after the first leaves the reservation spent with cost and time never charged, and resume finds `reserved = 0` (no orphan).
Fix: add one ledger port method (src/ports/ledger.ts near :583, implementation in src/adapters/sqlite/ledger.ts next to `chargeBudget` :673) that applies a list of charges and the event in a single `tx`; `chargeOrphans` and `settleInvocation` call it. SqliteLedger is the only Ledger implementation, so no other adapter changes. Adjacent, not in the review: docs/system/findings.md:116 records that an orphan's wall-clock is never charged; the same method is the place to decide that. Size M. Offline; a fault-injection style test (throw between writes) is not needed once the writes are one transaction, a unit test of the new method plus the existing kill tests (test/fault/budgets.test.ts:519) suffices.

## R-WR-06 SHA-256 repositories
Root cause: `COMMIT_SHA` accepts 64 hex (staging-base.ts:22, used by run-source.ts, run-workspace.ts, staging-base.ts), while `revisionOf` (evidence.ts:38) and G4's `COMMITTED_CLEAN` (gates.ts:146) accept 40. Reproduced with a real sha256 repository. Note that Phase 1 modules are 40-only too (freshness.ts:7, knowledge-corpus.ts:17, graph-validation.ts:4, knowledge-validation.ts:33), so a SHA-256 repository is not supported end to end anyway.
Fix: narrow `COMMIT_SHA` to `[0-9a-f]{40}` so `start` refuses a SHA-256 repository with a clear message before any work (S). Widening every domain pattern is M and buys nothing while onboarding cannot map such a repository. Where it fails today: `cloneRevision` (checks.ts), which runs in `checks:validate`, before the first unit invocation (run-deps.test.ts step order), so the review's "after an invocation has been spent" overstates it. Size S. Offline. Check that no test uses a 64-hex pin: grep found none.

## R-WR-07 Math.min spread
Root cause: run-source.ts:74. Reproduced limit: ok at 100000, RangeError at 125000. The preflight limit is 25 commits (run-preflight.ts:7), so the count matters more than the oldest time. Fix: `times.reduce((a, b) => (a < b ? a : b))`. Add a unit test that feeds 150k lines through a stubbed `runGit`, or test the pure reduction. Size S. Offline.

## R-WR-08 attended harness allow list
Root cause: live-attended.ts:474 builds `Bash(cat:*)`, `Bash(head:*)`, `Bash(git diff:*)`, `Bash(git show:*)`, `Bash(git log:*)` as prefix rules with no hook; production settings.ts:71 builds the same shape from `READ_ONLY_COMMANDS` but the PreToolUse hook refuses `>` and `--output`, which the harness has no equivalent of. Whether the host's permission engine lets `cat > file` through a `cat:*` prefix rule needs a live session to establish; I did not run one. Fix: drop `cat` and `head` (the model has `Read`), anchor or drop `git diff`. Provenance note for the planner: the recorded G-02-9 verdicts (status first FAIL 1/4, stop on a denial PASS 3/3, routable question FAIL 0/3) were measured under the current list; LIVE-CASES.md:244 says a judged FAIL is never re-run, so do not re-run. Add one sentence to LIVE-CASES.md stating the list used for those records. Size S. Offline (assert the generated settings).

## R-WR-09 cleanupAttended recursive delete
Root cause: live-attended.ts:559-563 removes `fixture.profileDirs` (under the real `~/.local/share/avarice*`, `~/.config/avarice`) and `fixture.evidenceDir` recursively, trusting the fixture object. Creation asserts only `!existsSync` (:480-484), so the path shape is safe today by construction, not by check. Fix: before each `rmSync`, require `realpathSync(dir)` to be inside the fixture's own tag prefix (basename starts `avarice-live-attended-<name>-` for the profile dirs) and `evidenceDir` inside `realpathSync(tmpdir())`; throw otherwise. Test with a forged fixture. Size S.

## R-IN-01 home path in evidence
Valid but low value: the four files named hold one line each (`live-attended-phase2.jsonl:1` a profile path and `/Users/aphan/.local/bin/claude`, the two live-run files one line each, LIVE-CASES.md:278 `/Users/aphan/.claude-edu`). The same string is committed in 28 `spikes/slice-0-wave-0/evidence` files, `docs/existing-tooling-assessment.md`, `spikes/2026-11-01-pre-slice-0/run.sh` and 113 `.planning` files, so the repository is already private-by-assumption. Fix narrowly: redact in the writers (live-attended.ts:252, live-run.test.ts:37, live-harness.ts) and rewrite the four files; nothing digests these files (grep found no reference besides prose). Defer the wider residue to a public-release decision (owner). Size S.

## R-IN-02 not-a-defect
See Eliminated. Recommend `skipped` with the reason: "node:test reports these as skipped, with the reason printed; the parse and compile cases are unconditional". The only residual is the hard-coded `PIN`/default path, which the test header documents.

## R-IN-03 bidi regex
Reproduced (Evidence). The scanner flagged style.ts as invisible-unicode for exactly this line. Fix: write the class with `\u` escapes and cover U+061C, U+200B-U+200F, U+2060, U+FEFF and U+202A-U+202E, U+2066-U+2069 (keep soft hyphen U+00AD out unless wanted). Tests in test/unit/render.test.ts. Size S.

## R-IN-04 checkRelative backslash
Root cause: staging-base.ts:90 splits on `[\\/]`. Reproduced. Callers that then act on the rewritten path: `checkCommitPath` (run-workspace.ts:68-76, joins with `/` for `git add`), `removeAddedPath` (:93) and `clearDirectoryInTheWay` (:125) (join under the clone root), plus staging reads. A run-added file named `a\b` therefore makes discard act on `a/b`, a different path. Fix: split on `/` only. A backslash then stays a literal character; `..` traversal checks are unaffected because POSIX has no `\` separator. Size S. Offline.

## R-IN-05 resume skips reaping silently
Root cause: run-resume.ts:81 `continue` for a missing `reap` or `sessionId`. In production neither is missing (invocation.ts:131-140 records a `randomUUID()` session id before launch; ClaudeHostAdapter implements `reap`, claude-host.ts:367; every test host implements it too), so the branch is defensive and unreachable today. The file's own header (T-02-56) says "a reap that fails stops the resume"; the silent `continue` contradicts it on paper. Fix: return `err({kind:'internal', ...})` (recorded as the failed `resume:reconcile` step by `reconcileRun`). Sibling already in findings.md:115 for the onboarding resume (`src/app/resume.ts:29`). Size S.

## R-IN-06 abort signal never aborted
Root cause: item.ts:511 `new AbortController().signal`; `RunStageContext` (stage.ts) carries no signal; `runSupervisor` (run-service.ts:131-136) records a lost lease in `lease.lost` that is read only at the top of the stage loop, i.e. after the in-flight unit returns. The host adapter already honors abort (claude-host.ts:138, :319). Correctness is protected by the fence (every ledger write presents it), so the cost is wasted spend and a delayed stop until the new supervisor reaps. Fix: `signal` on the stage context, aborted from the renewal-failure branch and on SIGTERM in supervise.ts; the cancelled outcome then settles through the normal `wasKilled` path (charged the reservation). The onboarding map stage uses `AbortSignal.timeout(wallClockMs)` (stages/map.ts:57), the same lease-loss gap, bounded. Size M, medium risk. Offline with the fake run host (real process group).

## R-IN-07 substring acceptance (valid observation, documented design)
`finish.ts:204-207` accepts `id.includes(text)`. It is the documented behavior (docs/system/checks-and-evidence.md:123, runs.md:280), the finish.ts comment says so, and the owner's own R1 briefs depend on it (`test:isIsoYearMonth`, `test:ignores non-finite deltas`, test/benchmark/r1/). A whole-id match breaks them; "id must exist in the base inventory" forbids the unit from satisfying a criterion with the regression test it adds, which is the normal bug-fix shape. The mitigations that exist: the checks that run the tests must pass at head and the inventory comparison detects weakening. The proposal (docs/contracts-and-state.md:126-127) shows exact ids, so code and proposal disagree: per CLAUDE.md that is a one-line entry in docs/system/findings.md for the owner to decide. Recommendation: `deferred` with that reason and the findings.md line; if the owner still wants a fix, the least breaking tightening is a segment-anchored match plus updating the two briefs.

## R-IN-08 gated-commit parent
Root cause: item.ts:419-433 accepts a moved HEAD on trailers alone. Between `gated` and the commit only the supervisor acts and the host has been reaped before reconcile, so this is defense in depth. Fix: `git rev-list --count <snapshot.head>..HEAD` equals 1 and `HEAD^` equals `snapshot.head`; needs a small `RunWorkspace` port method (or reuse `diffCommits`' underlying git call) and a fake. Size S-M.

## R-IN-09 run-ref prefix match
Root cause: `RUN_REF_GLOB` + `globToRegExp` (checkout-digest.ts:37, :46-49) turn `*` into `.*`, so `refs/heads/avarice/run_X/extra` is also excluded from `refsDigest`. Mitigated: the Phase 2 exit evidence tool judges new refs from the full ref list and fails any new ref other than `refs/heads/avarice/<runId>` (exit-run-phase2-tools.ts:699-706). Fix: a dedicated anchored regex for `--allow-run-refs` (`^refs/heads/avarice/run_[A-Za-z0-9_]+$`; the unit test uses `run_01TESTRUN`, production ids are `run_` plus 26 characters, so do not hard-code 26). Leave `--allow-ref` glob semantics as documented. Size S.

## S-WR-01 integration tests that only report
Confirmed (see Evidence): `git show :sub` is allowed and prints no sentinel on git 2.39.5, so nothing is wrong today; the test cannot fail if that changes. Fix: add `git show :sub` to the `admitted` list. Same file as S-IN-04.

## S-WR-02 two tables
Latent, not exploitable (Eliminated). The drift is real: git rows of `SHORT_VALUE_OPTIONS` list `M`/`nSGOLUMCBl`; `GIT_OUTPUT_FORMS` lists `n` (log), `u` attached (status), nothing (show). Fix: derive the git rows from `GIT_OUTPUT_FORMS` (`shortValued` takes the next word, `shortAttached` only the cluster rest) and add the pinning unit test the review suggests. Do this after the G-02-H2 change, with its corpus in place, because it refactors the same parser.

## S-IN-01 nested repositories
Negligible: object paths resolve from the staging root and the shell cwd, and the model can change neither (no `cd`, no `git -C`; `git -c` is refused). Recommend skip with that reason and one sentence in docs/system/containment.md rule 12.

## S-IN-02 refusals say nothing
Valid usability item: `deny()` (hook-decision.ts:107) never sets `reason`, although the decision type has it (:88) and the hook prints it (pre-tool-use.ts:334). Add a corrective reason ("use --name=value; admitted options: ...") for `shell-git-output` and `shell-git-object`. Fewer retries means fewer consecutive-denial stops (CON-14).

## S-IN-03 rev-parse and ls-files
No leak found: probes of `git rev-parse HEAD:.env`, `git rev-parse --verify HEAD:.env`, `git ls-files -s .env` are denied by the path check; `git ls-files --with-tree=HEAD` prints names only. Cheapest honest fix is the reviewer's second option: a comment beside `GIT_OUTPUT_FORMS` recording why these two are left out and what was checked.

## S-IN-04 test collection
`rig()` is called inside seven `describe` bodies (lines 74, 93, 112, 141, 153, 172, 183), so repositories are created at load. Move to `before` hooks; give `gitOutput` an argv overload or reuse the hook's lexer.

---

# Grouping, ordering and file overlap

Six plans cover everything fixable; none needs a paid run.

| Plan | Findings | Main files | Size |
|------|----------|-----------|------|
| P1 hook git-read hardening | G-02-H2 (separate gap, same plan), S-WR-01, S-WR-02, S-IN-01 (doc line), S-IN-02, S-IN-03 (comment), S-IN-04 | src/domain/hook-decision.ts, test/unit/hook-decision.test.ts, test/integration/hook-git-secret-reads.test.ts, docs/system/containment.md (rules 12-13), docs/system/findings.md:181-182 | M |
| P2 budget settlement | R-WR-04, R-WR-05 | src/app/invocation.ts, src/app/budget.ts, src/ports/ledger.ts, src/adapters/sqlite/ledger.ts, test/fault/budgets.test.ts, test/integration/run-invocation.test.ts, docs/system (budget accounting) | M |
| P3 sandbox and egress | R-WR-03, R-WR-02 | src/app/checks.ts, src/domain/invocation-scope.ts, src/domain/conventions.ts, src/adapters/exec/allowlist-proxy.ts, tests for conventions, run-deps, allowlist-proxy, invocation-scope, claude-settings; docs/system/containment.md, config-reference.md | M-L (two tasks) |
| P4 terminal text and git adapters | R-WR-01, R-IN-03, R-WR-06, R-WR-07, R-IN-04 | src/cli/commands/{onboard,resume}.ts, src/cli/render/style.ts, src/adapters/git/{staging-base,run-source,run-workspace}.ts | S x5 |
| P5 resume, lease, gated commit | R-IN-05, R-IN-06, R-IN-08 | src/app/run-resume.ts, src/app/run-stages/item.ts, src/app/run-stages/stage.ts, src/app/run-service.ts, src/cli/commands/supervise.ts, workspace port | M |
| P6 harness and evidence hygiene | R-WR-08, R-WR-09, R-IN-01, R-IN-09 | test/helpers/live-attended.ts, test/containment/*.jsonl and LIVE-CASES.md, test/containment/live-run.test.ts, scripts/checkout-digest.ts | S x4 |

Ordering and overlap:
- P1 first: it contains the BLOCKER (G-02-H2). The scoped review's WR-02 touches `src/domain/hook-decision.ts` like G-02-H2 does (checkGitObjects :502-514 and the option tables :339-347, :533-558, consumer :628-634): one plan, H2 task first, the table refactor after it so the H2 corpus guards the refactor. `docs/system/containment.md` rules 12-13 and findings.md:181-182 change once, in that plan.
- P3 after P1: both edit docs/system/containment.md; P3 also edits `src/domain/invocation-scope.ts` (credential constant) while P1 may touch only its comment (:78-83). No code conflict, a docs conflict only.
- P2 is independent. Within it, land the atomic ledger method before changing `wasKilled`, so the new charge goes through the transactional path.
- P4, P5, P6 are independent of each other and of P1-P3 (P5: `item.ts` for both R-IN-06 and R-IN-08, so keep them together).
- Per CLAUDE.md each plan updates the matching docs/system document in the same change; the Phase 2 documentation plan (coverage.md, README tables, findings.md, fresh `technical-writer:prose-reviewer`) should run last and cover all six.

Recommended dispositions to record: `fixed` for R-CR-01 now (closed by 02-26) and for every finding a plan above lands; `skipped` for R-IN-02 (not a defect) and S-IN-01 (negligible, doc line only); `deferred` for R-IN-07 (owner decision on acceptance semantics) and for the wider home-path residue under R-IN-01. 02-26-REVIEW.md has no disposition file yet (only 02-REVIEW-DISPOSITION.md exists); one needs creating for S-WR-01..S-IN-04 (the `code-review-fix` workflow's `record_disposition` writes `fixed`/`skipped` rows once a fix report exists; `deferred` is set by hand with the reason in the Source cell).

Live or paid verification: none. The nearest to "live" are R-WR-03 (real `sandbox-exec`, free, offline, template wr03.mts) and R-IN-06 (real process group via the fake host). R-WR-08's exploitability question would need a live Claude Code session; the fix does not.
