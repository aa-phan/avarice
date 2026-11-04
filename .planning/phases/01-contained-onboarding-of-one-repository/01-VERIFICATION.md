---
phase: 01-contained-onboarding-of-one-repository
verified: 2026-11-04T10:30:00Z
status: gaps_found
score: 7/8 must-haves verified
covered_files:
  - .planning/phases/01-contained-onboarding-of-one-repository/01-01-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-01-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-02-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-02-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-03-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-03-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-04-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-04-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-05-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-05-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-06-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-06-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-07-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-07-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-08-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-08-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-09-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-09-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-10-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-10-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-11-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-11-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-12-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-12-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-13-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-13-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-14-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-14-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-15-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-15-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-16-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-16-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-17-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-17-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-18-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-18-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-19-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-19-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-20-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-20-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-21-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-21-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-22-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-22-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-23-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-23-SUMMARY.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-24-PLAN.md
  - .planning/phases/01-contained-onboarding-of-one-repository/01-24-SUMMARY.md
  - docs/containment.md
  - src/adapters/git/repo-facts.ts
  - src/adapters/git/staging-base.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/hook-policy.ts
  - src/adapters/host-claude/settings.ts
  - src/app/invocation.ts
  - src/app/resume.ts
  - src/domain/hook-decision.ts
  - src/domain/invocation-scope.ts
  - test/fault/killpoints.test.ts
  - test/integration/claude-host.test.ts
  - test/integration/ignored-writes.test.ts
  - test/integration/resume-reap.test.ts
  - test/unit/hook-decision.test.ts
covered_digest: "v3:sha256:55f0c2cb72dd5a787f613f94f5b77d774cde58a05e3813f0d389c032f2e36378"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/8
  gaps_closed:
    - "P-1: every interrupted launch:* host (map, intel, knowledge) is reaped on resume (plan 01-21)"
    - "P-2: staging diff sees ignored untracked files (plan 01-22)"
  gaps_remaining:
    - "P-3 (residual): the recursive-grep detector in the hook recognizes only the lowercase exact spelling 'recurse' of -d/--directories"
  regressions: []
gaps:
  - truth: "A recursive grep is denied with shell-recursive-read when it follows symlinks, or when a directory it walks lies in staging where a secret glob can match below it; with the default secret globs every recursive grep inside staging is denied (plan 01-23 truth 4, D-GAP-01); shell read confinement matches docs/containment.md"
    status: partial
    reason: "The five cases VERIFICATION.md reproduced for P-3 are all denied now, and the allow-list, option-value parsing, work-root deny and docs row work as designed. But the recursion detector (hook-decision.ts:380-385) tests `-d`/`--directories` against the exact lowercase string 'recurse', so every other spelling of a recursing grep is allowed. Reproduced with the real decideToolCall and a production-shaped policy (default secret globs **/.env and **/*.pem, work root and repo in denyRead): `grep -dRECURSE PASSWORD .`, `grep -d RECURSE PASSWORD .`, `grep --directories=RECURSE PASSWORD .`, `grep --directories=Recurse`, `grep --dir=RECURSE`, `grep -d rec`, `grep -d dereference-recurse PASSWORD .`, `grep --directories=dereference-recurse`, `grep -ddereference-recurse` are all `allow shell-identity`, while `grep -r PASSWORD .` and `grep -drecurse PASSWORD .` are denied. Two of these really recurse on this machine: macOS /usr/bin/grep matches the value case-insensitively (`--directories=RECURSE`, `--dir=RECURSE` and `-dRECURSE` printed ./sub/.env:PASSWORD=hunter2 from a scratch tree), and the grep embedded in the Claude Code binary (ugrep, which the Bash tool's shell function substitutes for `grep`) accepts `-d dereference-recurse` and then FOLLOWS a symlink out of the tree (a symlink to a scratch file outside the tree was read). That last form is the one the rule exists to refuse (dereferences -> shell-recursive-read), and a tracked symlink in a hostile repository is materialized in staging. The sandbox denyRead covers the repository, data root, work root, ~/.ssh, ~/.aws and ~/.config/gh, not ~/.netrc or ~/.npmrc, so those stay reachable by this route. I ran these outside the sandbox and the live host; I did not run the escape end to end under a contained invocation."
    artifacts:
      - path: "src/domain/hook-decision.ts"
        issue: "line ~380-385: `shortValues.some(v => v.flag === 'd' && v.value === 'recurse')` and `(l.value ?? ...) === 'recurse'`; no case folding, no abbreviation, no 'dereference-recurse'; the dereference test (`flags.has('R')`, `--dereference-recursive`) does not include `-d dereference-recurse`"
      - path: "docs/containment.md"
        issue: "row 'No reads of secrets...' lists the known bypasses (git objects, host Grep tool) but not this one, and states recursive grep is covered; plan 01-24 prohibition 'MUST NOT state a read restriction the hook does not enforce' is not met for this spelling family"
      - path: "test/unit/hook-decision.test.ts"
        issue: "lines ~376-390 pin only the lowercase spellings; no case, abbreviation or dereference-recurse case"
    missing:
      - "Fail closed (review CR-01 fix): treat any -d / --directories value (attached or separate, any long-option prefix of --directories) that is not exactly `read` or `skip`, compared case-insensitively, as recursive; treat `dereference-recurse` (any case) as following links -> shell-recursive-read"
      - "Tests for each reproduced spelling in test/unit/hook-decision.test.ts, expected shell-recursive-read"
      - "Establish which grep the contained shell runs (review WR-02) or drop `grep` from READ_ONLY_COMMANDS and rely on the Grep tool, whose root the hook judges; record the result and the remaining bypass in docs/containment.md"
deferred: []
behavior_unverified_items: []
coincidental_reliance_items:
  - truth: "Killing mapping part-way and running `avarice resume` reaches the same active record (ROADMAP SC4)"
    reason: undeclared-precondition
    harden: "test/fault/killpoints.test.ts needs real graphify and real GSD installed and never skips without them (WR-03d); assert the reference record has indexes.graph, empty findings and absent == [intel, knowledge] so a degraded reference cannot pass vacuously, and drop the blanket catch in snapshotWithoutTimestamp"
---

# Phase 1: Contained onboarding of one repository Verification Report

**Phase Goal:** As a solo developer, I want to onboard one existing repository into AVARICE, so that later unattended runs start from an active project record with a code-and-document graph.
**Verified:** 2026-11-04T10:30:00Z
**Status:** gaps_found
**Re-verification:** Yes, after gap-closure plans 01-21 to 01-24
**Mode:** mvp (goal passes the user-story format; the [outcome] clause, "an active project record with a code-and-document graph", is observably true)

## Verdict in one paragraph

Gaps P-1 and P-2 are closed and I confirmed each against the code, not the SUMMARYs. Gap P-3 is closed for the cases VERIFICATION.md named (sibling staging, `~/.netrc`, `grep -r token ~`, `grep -r PASSWORD .`, `grep -f<path>`) but is still open in a narrower form: the fresh review's CR-01 is real, and it does reopen P-3 against plan 01-23's own must-have ("a recursive grep ... that follows symlinks ... is denied" and "every recursive grep inside staging is denied"). The recursion detector knows one spelling of the directories option. I reproduced nine allowed spellings through the real decision function, and confirmed on this machine that two real greps recurse on them, one of them following a symlink out of the tree. The deliverable the goal names (a real repository behind an `active` record with 1010 code and 24 document nodes) is unaffected, and no ROADMAP success criterion fails. The status is `gaps_found` because the read-confinement must-have, which this containment-first phase exists to establish, is not fully true, and the fix is one comparison plus tests.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `~/aa-phan-portfolio-v2` reaches an active project record whose graph lists code and document nodes, graph and intel record the onboarded revision, and the checkout is unchanged | VERIFIED (re-checked, no regression) | Re-ran `node bin/avarice.ts status --json`: onboarding `onb_01M6J4ATTTXW68YGE2P9V2QMH5` state `active`, record v1, `onboardedRevision git:9f1cd8d5...`, `indexes.graph.builtAtCommit` the same, nodes code 1010, document 24, concept 114, rationale 25, mapping complete and fresh. Target HEAD is still `9f1cd8d5...`; its only status entry is the untracked `.env`. |
| SC2 | During mapping a scripted source or policy edit through Edit, Bash and Python is blocked | VERIFIED (carried, regression check) | Live T3 evidence from the first verification is unchanged (not re-run: it spends model budget). `test/integration/hook.test.ts` and `test/mutation/fail-closed.test.ts` pass in this run (222 tests across the six hook, host, scope and settings files, 0 fail). Write confinement is untouched by plans 01-21 to 01-24 except the scope's `allowRead` addition. |
| SC3 | With the hook removed, settings missing or the sandbox unavailable, onboarding stays `blocked` and never runs unrestricted | VERIFIED (carried, regression check) | `test/mutation/fail-closed.test.ts` and `test/integration/claude-host.test.ts` pass. |
| SC4 | Killing mapping part-way and running `avarice resume` reaches the same active record | VERIFIED (coincidental-reliance) | `node --test test/fault/killpoints.test.ts` alone: 22/22 pass, including the new `mid-invocation:intel`, `mid-invocation:knowledge` and `after-checkpoint:index:*` cases. The load-sensitive flake from the first report (WR-01..03 in the older review) is still not reproduced and still unresolved; it is a test-hardening item, not a failed truth. |
| SC5 | Install to first successful `avarice status` takes under 10 minutes with no admin rights | VERIFIED (re-ran) | `bash scripts/ac1-timing.sh`: `AC-1 elapsed 1s (target 600s)`. |
| P-1 | Every interrupted `launch:*` host is reaped before reconciliation, in every non-stop state including `planning_ready` (plan 01-21) | VERIFIED (closed) | `src/app/resume.ts` `reapStartedLaunches` selects every `launch:` step still `started` (not only `launch:map`), loads the contract only when one exists (empty edge), reaps every row before marking any, returns the first reap error with every row still `started`, and marks the rows `interrupted` except a `launch:map` of a `mapping` or `paused` onboarding, which `reconcileInvocation` decides. It runs from `reconcileOnResume` ahead of `reconcileInvocation`, so it is outside the `row.state !== 'paused'` early return that broke the old design. `reapBySessionId` is exported from `claude-host.ts` and is the same function the fake host calls. Behavioral evidence: the killpoint file passes 22/22 with a real surviving process carrying the session ID and an assertion of exactly one `invocation.reaped` event with `terminated: 1` (killpoints.test.ts:266-268); `test/integration/resume-reap.test.ts` passes (fail-closed reap, ledger order, no reap without a started launch). |
| P-2 | Before activation the whole staging diff is re-checked against every write set, including paths the repository's own `.gitignore` hides (plan 01-22) | VERIFIED (closed) | `staging-base.ts:115` now calls `git status --porcelain=v2 -z --untracked-files=all --ignored=traditional`; `parseStatus` reads `!` records as untracked (repo-facts.ts:57-59) and sorts; `changes()` merges into a sorted, deduplicated `added`. I reproduced the git behavior independently in `/tmp/vf4` (committed `.gitignore` of `*`, new `evil.txt`, `evil/deep/a.sh`): output was `! evil.txt` and `! evil/deep/a.sh`, one record per file, no collapsed directory record. The plan's choice of `traditional` over the gap text's `matching` is justified by that observation. `collectRepoFacts` still uses a status call without an ignored mode, so the user's checkout is not listed (test T-01-77 passes). `test/integration/ignored-writes.test.ts` (validate, prefix adjacency, per-file naming, activation block, positive controls, graph/knowledge admitted) and `test/unit/repo-facts.test.ts` pass. Write sets were not widened. |
| P-3 | Shell read confinement matches `docs/containment.md` (other profile roots denied; secret reads denied; a recursive grep that follows links or can reach a secret glob is denied) | FAILED (partial, BLOCKER) | See gap above. Closed: the original five cases, the allow-list for Read, Grep, Glob and every shell operand and attached option value, `workRoot` in hook and sandbox `denyRead` with own staging re-allowed, no `Read(...)` deny that contains staging, the docs row. Open: recursion detection by exact lowercase `recurse`. |

**Score:** 7/8 truths verified (SC1-SC5, P-1, P-2); P-3 is partially false. 0 present-but-behavior-unverified.

### Judgement on the review's CR-01 against gap P-3

CR-01 is a genuine, reproduced defect and it does keep P-3 open, for three reasons. First, plan 01-23 truth 4 states the rule generally ("with the default secret globs every recursive grep inside staging is denied", "when it follows symlinks, ... denied"), and the tests enumerate only the spellings the author thought of; the general claim is false. Second, the exact class P-3 was opened for, a command whose spelling the parser did not model, recurs: the first verification already found `grep -r PASSWORD .` allowed, and an equivalent recursion spelling still is. Third, one of the spellings (`-d dereference-recurse`, ugrep) follows symlinks, which is the escape the hook was built to refuse, and which can leave staging and the allow-list. Mitigations I weighed and did not accept as closing it: (a) the documented known bypass `git show <rev>:<path>` already exposes committed secret-glob files, so recursion adds no new class of staging secret; that is true for secret-glob files, but it is not true for files outside staging reached by a symlink, and the docs do not name the grep route; (b) the sandbox denies the repository, data root, work root, `~/.ssh`, `~/.aws` and `~/.config/gh` at the OS layer, which holds for the highest-value targets but leaves `~/.netrc`, `~/.npmrc` and similar readable; (c) which grep the contained shell runs is unproven (review WR-02), though both candidates (BSD grep on this Mac, embedded ugrep) are exploitable. The severity is therefore narrower than the first report's P-3, not zero. The review's other findings (WR-01, long option with separate value shifting the walk root) do not change the verdict by themselves: with the production globs every `-r` under staging is denied regardless, so WR-01 only bites with narrow custom globs; WR-03 (optional `workRoot`) and WR-04 (a vacuous integration assertion, which I did not independently re-prove) are hardening items with no current exposed path.

### Deferred Items

None. Phases 2 to 8 in `ROADMAP.md` do not name read confinement of onboarding-invocation shell commands; Phase 2 owns run-worktree write prevention, Phase 4 owns environment scrubbing. Not clear enough to defer.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/resume.ts` | Generic reap prelude | VERIFIED | Read in full; wired through `resumeOnboarding` -> `runOnboarding({ prelude })`. |
| `src/adapters/host-claude/claude-host.ts` (`reapBySessionId`) | Shared session-ID reaper | VERIFIED | Exported, UUID-validated, pgrep by `--session-id <uuid>`, group-aware TERM then KILL, fails closed when pgrep or the kill cannot complete; shared by `ClaudeHostAdapter.reap` and `FakeAgentHost.reap`. |
| `test/helpers/fake-agent-host.ts` (`killInPurpose`) | Dies inside intel or knowledge leaving a survivor | VERIFIED | Spawns a detached survivor carrying the session ID, writes its PID, SIGKILLs the supervisor. |
| `src/adapters/git/staging-base.ts`, `repo-facts.ts` | Staging diff including ignored files | VERIFIED | See P-2. |
| `src/domain/hook-decision.ts` | Allow-list read rule, option-value parsing, recursion rule | STUB-in-part | Allow-list and option parsing verified; recursion rule bypassable (P-3). |
| `src/adapters/host-claude/hook-policy.ts`, `src/domain/invocation-scope.ts`, `src/adapters/host-claude/settings.ts`, `src/app/invocation.ts` | readRoots, work-root denyRead, own-staging allowRead, no containing Read deny | VERIFIED | `prepareInvocation` passes the profile work root; unit and production-path tests pass. `ScopeInput.workRoot` is optional (review WR-03, warning). |
| `docs/containment.md` | CON-1 row with enforcement points, tests, known bypasses | PARTIAL | Row exists and is specific, but omits the recursion-spelling bypass, so it claims more than the hook enforces. |
| `test/unit/hook-decision.test.ts` | Every reproduced P-3 case | VERIFIED for the listed cases | Passes. Does not cover other spellings. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `reconcileOnResume` | `reapStartedLaunches` | prelude of `runOnboarding` | WIRED | Runs before `reconcileInvocation`. |
| `prepareInvocation` | `host.reap` (on resume) | `launch:{purpose}` row carrying `sessionId` | WIRED | Consumed for map, intel and knowledge. |
| `FakeAgentHost.reap` | `reapBySessionId` | direct import | WIRED | Tests exercise production reaper. |
| `StagingBase.changes` | `parseStatus` -> `activate` scopeCheck / validate | `added` | WIRED | Includes `!` records. |
| `prepareInvocation` | `computeInvocationScope` | `workRoot: deps.profile.workRoot` | WIRED | |
| `computeInvocationScope` | settings and hook policy | `denyRead`, `allowRead` | WIRED | |
| `buildHookPolicy` | `readRule` | `readRoots` | WIRED | |
| `recursiveRule` | every recursion spelling | flag and option recognition | NOT_WIRED for non-lowercase / dereference-recurse spellings | P-3. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `avarice status` | record, indexes, nodes | `project_records.body_json` in the real SQLite ledger | Yes (1010 / 24 re-read) | FLOWING |
| Resume prelude | `started` launch rows, `sessionId` | ledger `getStepResults` | Yes (rows written by `prepareInvocation`) | FLOWING |
| `changes()` | `added` | `git status ... --ignored=traditional` | Yes (reproduced against a hostile `.gitignore`) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type check and boundary lint | `npx tsc -p .`; `node scripts/check-boundaries.ts` | exit 0; `ok (53 file(s))` | PASS |
| Hook, integration host, scope, settings, fail-closed mutation | `node --test` over 6 files | 222 pass, 0 fail | PASS |
| P-2 and P-1 tests | `node --test` over ignored-writes, repo-facts, resume-reap, staging-adapters (38 tests) | 38 pass, 0 fail | PASS |
| Kill and resume at every kill point incl. intel and knowledge | `node --test test/fault/killpoints.test.ts` | 22/22 pass | PASS |
| Hostile `.gitignore` is visible | `git status --porcelain=v2 -z --untracked-files=all --ignored=traditional` in `/tmp/vf4` | `! evil.txt`, `! evil/deep/a.sh` | PASS |
| Recursion spellings through the real `decideToolCall` (production-shaped policy) | `/tmp/vfscript/probe.ts` | 9 recursing spellings `allow shell-identity`; `-r` and `-drecurse` denied | FAIL (confirms CR-01) |
| Spellings recurse on a real grep | `/usr/bin/grep --directories=RECURSE`, `--dir=RECURSE`, `-dRECURSE` in a scratch tree; embedded ugrep `-d dereference-recurse` | secret-named file printed; ugrep also followed a symlink out of the tree | FAIL (confirms the bypass is real) |
| Active record on the real target | `node bin/avarice.ts status --json` | active, graph at `9f1cd8d` | PASS |
| AC-1 | `bash scripts/ac1-timing.sh` | 1 s | PASS |

I did not run the full workspace suite (the caller reports 1218 pass, 0 fail, 22 skipped); I ran 12 named files plus the kill-point file once each. A passing suite does not contradict the gap: no test exercises the failing spellings.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and the phase declares none. SKIPPED (no probes declared).

### Requirements Coverage

All 14 requested IDs appear in at least one PLAN `requirements:` field (counts: ONB-1 7 plans, ONB-2 4, ONB-3 14, ONB-4 6, ONB-5 4, ONB-7 2, ONB-8 4, ONB-9 4, ONB-12 8, ONB-13 4, ONB-14 3, FR-20 2, SEC-5 2, NFR-2 7). REQUIREMENTS.md maps no further ID to Phase 1 beyond those and the "partial coverage" extras (CON-2/3/5/6/13/15, NFR-1/3/5/6/9, ONB-6). No orphans. Plans 01-23 and 01-24 additionally claim CON-1, which the traceability table maps to Phase 2 and marks Complete.

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ONB-1 | SATISFIED | Persisted lifecycle; resume reaps every interrupted launch (P-1 closed); 22/22 kill points. Warning: one unreproduced load-sensitive flake of the same suite. |
| ONB-2 | SATISFIED | `no-competing-index` passes; record holds refs and digests. |
| ONB-3 | SATISFIED | Prevention verified (SC2); detection backstop now sees ignored untracked files (P-2 closed). |
| ONB-4 | SATISFIED | `no-repo-exec` passes; neutralized safe git. |
| ONB-5 | SATISFIED | Refs digests unchanged; hook denies ref-moving git. |
| ONB-7 | SATISFIED | Record carries mapping mode, scope, completeness, revision. |
| ONB-8 | SATISFIED | Budgets persist across retries. |
| ONB-9 | SATISFIED | Real versioned record on the target. |
| ONB-12 | SATISFIED | Fail-closed suites pass. |
| ONB-13 | SATISFIED | Graph and intel built in staging, recorded at the onboarded commit. |
| ONB-14 | SATISFIED | 24 document nodes in the real record. |
| FR-20 | SATISFIED | `avarice context` tests pass (carried). |
| SEC-5 | SATISFIED | Carried; no TLS or auth weakening found in changed files. |
| NFR-2 | SATISFIED | AC-1 1 s; status works offline from a scratch HOME. |

Bookkeeping: REQUIREMENTS.md traceability currently lists most of these as `Gaps Found` and unchecked (the verifier-driven revert dd91e24 set them). That table is not evidence and was not edited here; the orchestrator should leave the P-3 dependent items (ONB-3, CON-1 read confinement) as they are until the P-3 gap closes, and may mark the others Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/domain/hook-decision.ts` | ~380-385 | exact, case-sensitive `=== 'recurse'` on an option value | BLOCKER (gap P-3) | See gap. |
| `src/domain/hook-decision.ts` | ~326-331, 390-394 | long option with a separate value shifts the grep pattern (review WR-01) | WARNING | Masked by the `**/` production globs. |
| `src/domain/invocation-scope.ts` | ~186, 237 | optional `workRoot` silently drops the work-root deny (review WR-03) | WARNING | No current exposed caller. |
| `test/integration/claude-host.test.ts` | ~231-235 | vacuous `startsWith` assertion (review WR-04) | WARNING | Unit test pins the property; integration claim overstated. |
| `src/app/resume.ts` | ~29, 63-79 | row marked `interrupted` when the host cannot reap or has no `sessionId` (review IN-02) | INFO | Production adapter always reaps. |
| `test/fault/killpoints.test.ts` | catch-all, no healthy-reference assertion | WARNING (carried) | Can pass or fail vacuously. |

No `TBD`, `FIXME` or `XXX` in the files changed by plans 01-21 to 01-24 (grep over the source files, no hit).

### Human Verification Required

None needed to set the status. Decision requested from the owner: whether to fix CR-01 (recommended: the review's fail-closed rule plus the listed tests and a doc line) before Phase 2, or to remove `grep` from `READ_ONLY_COMMANDS` and rely on the Grep tool. Not a candidate for an override: the deviation is unintentional and the plan states the general rule.

### Gaps Summary

One gap remains, narrower than the first report's three. P-1 and P-2 are closed with behavioral evidence (kill-point cases with a real surviving process; a reproduced hostile `.gitignore`). P-3 is closed for everything the first verification reproduced and for the OS-layer work-root deny, but the recursion detector recognizes a single spelling of the directories option, so recursing greps spelled with other case, an abbreviation or `dereference-recurse` run past the hook; one of them follows symlinks out of the tree. The fix is local to `recursiveRule` (treat any `-d`/`--directories` value other than `read` or `skip`, case-insensitively, as recursive, and `dereference-recurse` as link-following), with a test per spelling and a line in the `docs/containment.md` bypass list. A re-verification after that change can pass without re-running the rest.

---

_Verified: 2026-11-04T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
