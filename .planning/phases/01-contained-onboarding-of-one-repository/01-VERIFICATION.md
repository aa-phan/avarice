---
phase: 01-contained-onboarding-of-one-repository
verified: 2026-11-04T23:10:00Z
status: passed
score: 8/8 must-haves verified
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
  - test/containment/failclosed.test.ts
  - test/fault/killpoints.test.ts
  - test/integration/claude-host.test.ts
  - test/integration/hook.test.ts
  - test/integration/ignored-writes.test.ts
  - test/integration/resume-reap.test.ts
  - test/mutation/fail-closed.test.ts
  - test/mutation/scope-and-validation.test.ts
  - test/unit/claude-settings.test.ts
  - test/unit/hook-decision.test.ts
  - test/unit/invocation-scope.test.ts
covered_digest: "v3:sha256:b840d079201385fd348e5c019ec778eadd3b8e863352793753f7d67edbbb901f"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed:
    - "P-3 (residual): recursion-spelling bypass of the grep detector. Closed by removing the detector's input: shell grep is not an admitted command (quick 261104-l3t, 99dd4fb), after quick 261104-jnc (5e67793) had first made every -d/--directories value except read or skip recursive"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
behavior_unverified_items: []
coincidental_reliance_items:
  - truth: "Killing mapping part-way and running `avarice resume` reaches the same active record (ROADMAP SC4)"
    reason: undeclared-precondition
    harden: "test/fault/killpoints.test.ts needs real graphify and real GSD installed and never skips without them (WR-03d); assert the reference record has indexes.graph, empty findings and absent == [intel, knowledge] so a degraded reference cannot pass vacuously, and drop the blanket catch in snapshotWithoutTimestamp"
---

# Phase 1: Contained onboarding of one repository Verification Report

**Phase Goal:** As a solo developer, I want to onboard one existing repository into AVARICE, so that later unattended runs start from an active project record with a code-and-document graph.
**Verified:** 2026-11-04T23:10:00Z
**Status:** passed
**Re-verification:** Yes, after quick tasks 261104-jnc and 261104-l3t (commits 3ee7131..8ca5539)
**Mode:** mvp (goal passes the user-story format; the [outcome] clause, "an active project record with a code-and-document graph", is observably true)

## Verdict in one paragraph

The one remaining gap, P-3 (residual), is closed, and I confirmed it from the code and by running the real decision function, not from the quick-task SUMMARYs. The two quick tasks did not patch the recursion detector a third time. They removed `grep` from `READ_ONLY_COMMANDS` (`src/domain/invocation-scope.ts:70-82`), so `checkSegment` returns `shell-not-allowed` at `entry === undefined` (`hook-decision.ts:354-355`) before any option of grep is parsed. That makes the verdict independent of spelling, case, abbreviation, binary (BSD grep, embedded ugrep) and of which grep the contained shell would run. All nine allowed spellings from the previous report are now denied through the real `computeInvocationScope` -> `buildHookPolicy` -> `decideToolCall` chain with a production-shaped policy. The docs row claims no more than the hook enforces. I re-checked SC1 to SC5, P-1 and P-2 and found no regression. The code review of the quick-task changes (0 critical, 2 warnings, 4 info) touches no must-have. Score is 8/8; there are no human-verification items.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | `~/aa-phan-portfolio-v2` reaches an active project record whose graph lists code and document nodes, graph and intel record the onboarded revision, and the checkout is unchanged | VERIFIED (re-checked) | `node bin/avarice.ts status --json` today: onboarding `onb_01M6J4ATTTXW68YGE2P9V2QMH5` state `active`, record v1, `onboardedRevision git:9f1cd8d5...`, `indexes.graph.builtAtCommit` the same, nodes code 1010, document 24, concept 114, rationale 25, mapping complete and fresh, intel 5 files at the same commit. Target `HEAD` is still `9f1cd8d5...`; its only status entry is the untracked `.env`. |
| SC2 | During mapping a scripted source or policy edit through Edit, Bash and Python is blocked | VERIFIED (carried, regression check) | Live T3 evidence from the first verification is unchanged and was not re-run (it spends model budget). Write confinement is untouched by the quick tasks (diff over `src` touches `hook-decision.ts` read parsing and `invocation-scope.ts` only). The six hook, host, scope and settings files plus the fail-closed mutation suites pass (291 tests, 0 fail). |
| SC3 | With the hook removed, settings missing or the sandbox unavailable, onboarding stays `blocked` and never runs unrestricted | VERIFIED (carried, regression check) | `test/mutation/fail-closed.test.ts`, `test/containment/failclosed.test.ts` and `test/integration/claude-host.test.ts` pass in the 291-test run. |
| SC4 | Killing mapping part-way and running `avarice resume` reaches the same active record | VERIFIED (coincidental-reliance) | `test/fault/killpoints.test.ts` passes in this run (60 tests across killpoints, resume-reap, ignored-writes, repo-facts and staging-adapters, 0 fail). The reliance note from the previous report stands (test setup supplies the real graphify and GSD preconditions); it is advisory and does not change score or status. |
| SC5 | Install to first successful `avarice status` takes under 10 minutes with no admin rights | VERIFIED (re-ran) | `bash scripts/ac1-timing.sh`: `AC-1 elapsed 1s (target 600s)`. |
| P-1 | Every interrupted `launch:*` host is reaped before reconciliation, in every non-stop state including `planning_ready` | VERIFIED (regression check) | `src/app/resume.ts` untouched since the last report; `test/integration/resume-reap.test.ts` and the 22 kill-point cases pass again. |
| P-2 | Before activation the whole staging diff is re-checked against every write set, including paths the repository's own `.gitignore` hides | VERIFIED (regression check) | `staging-base.ts` and `repo-facts.ts` untouched; `test/integration/ignored-writes.test.ts` and `test/unit/repo-facts.test.ts` pass. |
| P-3 | Shell read confinement matches `docs/containment.md` (other profile roots denied; secret reads denied; a recursive or otherwise unmodelled grep that can follow links or reach a secret glob is denied) | VERIFIED (closed) | See "P-3 independent re-check" below. |

**Score:** 8/8 truths verified (SC1-SC5, P-1, P-2, P-3). 0 present-but-behavior-unverified.

### P-3 independent re-check

I did not reuse the previous probe, which hand-built a policy. `/tmp/vf5/script/probe.ts` builds the policy the way production does: `computeInvocationScope` (purpose `map`, secret globs `**/.env` and `**/*.pem`, work root, repo, data root, home, one read root) -> `buildHookPolicy` (real `canonicalAbsolute`) -> `decideToolCall`, against a scratch tree holding a real `staging/sub/.env`, a sibling `onb-2/staging`, and a `home/.ssh`. The resulting policy's `readOnly` list is `ls, cat, head, tail, wc, find, git ls-files, git log, git rev-parse, git status, git show`: no grep.

The nine spellings the old report listed as allowed, and the others it listed as denied:

| Command | Previous | Now |
|---------|----------|-----|
| `grep -dRECURSE PASSWORD .` | allow shell-identity | deny shell-not-allowed |
| `grep -d RECURSE PASSWORD .` | allow | deny shell-not-allowed |
| `grep --directories=Recurse PASSWORD .` | allow | deny shell-not-allowed |
| `grep --directories=RECURSE PASSWORD .` | allow | deny shell-not-allowed |
| `grep --dir=RECURSE PASSWORD .` | allow | deny shell-not-allowed |
| `grep -d rec PASSWORD .` | allow | deny shell-not-allowed |
| `grep -d dereference-recurse PASSWORD .` | allow (followed a symlink out of the tree under ugrep) | deny shell-not-allowed |
| `grep --directories=dereference-recurse PASSWORD .` | allow | deny shell-not-allowed |
| `grep -ddereference-recurse PASSWORD .` | allow | deny shell-not-allowed |
| `grep -r PASSWORD .`, `grep -drecurse PASSWORD .` | deny | deny shell-not-allowed |

Beyond the old list, all denied `shell-not-allowed`: `grep PASSWORD README.md` (non-recursive), `/usr/bin/grep -r`, quoted `"grep" -r`, `egrep`, `fgrep`, `rg`, `ugrep`, `git grep`, `cat README.md | grep X`, `ls | grep X`, `env grep`, `command grep`, `xargs grep`, `busybox grep`, `sh -c "grep ..."`, `bash -c`. A backslash-prefixed `\grep` is refused earlier by the lexer (`shell-syntax`), per the review. Other probes: `cat sub/.env` deny-secret-read; `cat ../../onb-2/staging/x` and `ls ../..` deny-read (sibling and work root); Grep tool on own staging allow, on the sibling staging and on the work root deny-read; Read tool on `.env` deny-secret-read, on a sibling file deny-read, on `~/.ssh/id` deny-read, on `~/.netrc` outside-read-set (the hook's allow-list covers what the sandbox `denyRead` list does not), on the gsd read root allow. `find . -name x`, `ls`, `git status`, `git log -p`, `head -n 3 README.md` stay allowed.

Nothing that remains admitted recurses and prints file content: `ls`, `find` (names only, its actions `-exec -execdir -ok -okdir -delete -rm -fprint -fprint0 -fprintf -fls` all denied `shell-find-action`, including bfs `-rm`), `wc`, `head`, `tail`, `cat` (named operands, each judged). `git show` and `git log -p` can read committed secret-glob files through git objects; that is a documented known bypass, not new.

Docs claim check (`docs/containment.md` CON-1 row, line 107). Each claim traced to code:

- Hook allow-list (staging, read roots, re-allowed roots) for Read, Grep, Glob and every shell operand, attached option value and word after `--`: `readRule` (`hook-decision.ts:191-200`), `parseReadArgs` (310-344), `checkSegment` (366). True.
- Rules `deny-read`, `deny-secret-read`, `outside-read-set`, `shell-option-value`: all four are returned by the code and observed above or in the unit tests. True.
- Shell grep in any spelling or binary is denied `shell-not-allowed` before any option is parsed: observed for 20+ spellings. True.
- Sandbox `denyRead` (repository, data root, credential directories, work root) with `allowRead` of own staging, and `Read(...)` allow and deny rules: `settings.ts:86-121`. True.
- Known bypasses listed (git objects, host Grep tool inside staging relying on `Read` deny rules, the sandbox not applying secret globs to a command that evades the hook, MCP): none contradicted. The Bash-tool observation (grep and find are shell functions over embedded ugrep and bfs) is presented as observed, with "whether a contained invocation's shell carries the same functions is not established", and the verdict is stated not to depend on it. It is honest.
- The one imprecision (review IN-03): the test cell attributes "no grep-family entry in the read-only commands" to `claude-settings.test.ts` together with `invocation-scope.test.ts`; `claude-settings.test.ts` has no grep assertion (`grep -c` = 0), while `invocation-scope.test.ts` (5 hits) and `claude-host.test.ts` (8) carry it. The enforced behavior is correctly stated and tested; only the test attribution is loose. Cosmetic, not a claim of unenforced behavior.

The plan 01-24 prohibition "MUST NOT state a read restriction the hook does not enforce" is met for this row.

### Weighing the review (01-REVIEW.md): 0 critical, 2 warnings, 4 info

| Finding | Effect on a must-have |
|---------|------------------------|
| WR-01 (`workRoot` is required by type only; `''` or a relative value yields a policy that denies everything, including read roots) | None. The failure direction is closed (denies, does not leak). `prepareInvocation` passes `deps.profile.workRoot` (`src/app/invocation.ts:90`), which `avarice init` validates upstream. Hardening item. |
| WR-02 (the `@ts-expect-error` guard for the required `workRoot` runs only under `tsc`, not under `node --test`) | None. `npx tsc -p .` exits 0 today. The type guard is checked by `npm run typecheck`, not `npm test`; a future regression would not fail `npm test`. Hardening item. |
| IN-01 stale comment (`hook-decision.ts:361-362` cites `-f/home/u/.netrc`) | None. Comment only. I confirmed the example no longer has a value-taking owner. |
| IN-02 redundant `named` local, unused `export` on `SHORT_VALUE_OPTIONS` | None. Confirmed at lines 288 and 366-367. |
| IN-03 misindented line, doc cites a test that lacks the assertion | None; see the docs check above. |
| IN-04 the agent gets no hint that shell grep is gone | None for containment. Operational note below. |

I agree with the reviewer's reasoning that removing the recursion rules opens no new read path: the only command family that could print file content while recursing was grep, and it is now refused as a whole.

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/domain/hook-decision.ts` | Allow-list read rule, option-value parsing, no admitted recursive content reader | VERIFIED | Read lines 150-447. The recursion rule and its helper types are gone; `parseReadArgs` models only the options of `head`, `tail` and three git verbs. |
| `src/domain/invocation-scope.ts` | `READ_ONLY_COMMANDS` without grep, bfs `-rm` in `FIND_DENIED_ACTIONS`, required `workRoot` | VERIFIED | Lines 70-95, 189-190, 237-243. |
| `src/adapters/host-claude/hook-policy.ts`, `settings.ts`, `src/app/invocation.ts` | Policy and settings carry the work-root deny, own-staging allow, no containing Read deny | VERIFIED | Unchanged since the last report; exercised through the production chain above. |
| `docs/containment.md` | CON-1 row matches enforcement | VERIFIED | See docs check; one cosmetic test-attribution slip (IN-03). |
| `test/unit/hook-decision.test.ts` | Pins the nine P-3 spellings, ugrep-only forms, `find -rm` | VERIFIED | Lines 284-286 and 413-460 pin them; the file passes. |
| `src/app/resume.ts`, `claude-host.ts`, `staging-base.ts`, `repo-facts.ts` | P-1 and P-2 closure | VERIFIED | Unchanged; tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prepareInvocation` | `computeInvocationScope` | `workRoot: deps.profile.workRoot` | WIRED | `invocation.ts:90`. |
| `computeInvocationScope` | `buildHookPolicy` / `renderClaudeSettings` | `readOnly`, `denyRead`, `allowRead` | WIRED | Policy printed by the probe has the 11-entry `readOnly` list and the work-root deny. |
| `checkSegment` | `shell-not-allowed` for any grep | `readOnly.find(...)` returning `undefined` | WIRED | Runs before `expands`, option and path checks. |
| `reconcileOnResume` -> `reapStartedLaunches`, `StagingBase.changes` -> `parseStatus` -> activation scope check | P-1, P-2 | unchanged | WIRED | Tests pass. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `avarice status` | record, indexes, nodes | `project_records.body_json` in the real SQLite ledger | Yes (1010 / 24 re-read today) | FLOWING |
| Hook decision | `policy.commands.readOnly` | `READ_ONLY_COMMANDS` through `computeInvocationScope` and `buildHookPolicy` | Yes (printed from the built policy) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type check and boundary lint | `npx tsc -p .`; `node scripts/check-boundaries.ts` | exit 0; `ok (53 file(s))` | PASS |
| Hook, host, settings, scope, fail-closed, containment suites | `node --test` over 8 files | 291 pass, 0 fail, 0 skipped | PASS |
| Kill-point, reap, ignored-write, repo-facts, staging adapters | `node --test` over 5 files | 60 pass, 0 fail | PASS |
| P-3 spellings through the production chain | `node /tmp/vf5/script/probe.ts <scratch tree>` | all grep forms `deny shell-not-allowed`; allowed set is ls, cat, head, tail, wc, find (no action), git ls-files/log/rev-parse/status/show | PASS |
| Active record on the real target | `node bin/avarice.ts status --json` | active, graph at `9f1cd8d` | PASS |
| Target checkout unchanged | `git -C ~/aa-phan-portfolio-v2 rev-parse HEAD`, `status --porcelain` | `9f1cd8d5...`; only untracked `.env` | PASS |
| AC-1 | `bash scripts/ac1-timing.sh` | 1 s | PASS |

I did not run the full workspace suite (the review reports 1171 pass, 0 fail, 22 skipped); I ran 13 named files once each. I did not run an escape end to end under a live contained invocation: the claim rests on the decision function and its production wiring, which the tests also pin.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and the phase declares none. SKIPPED (no probes declared).

### Requirements Coverage

All 14 requested IDs appear in at least one PLAN `requirements:` field (counts re-taken today: ONB-1 7 plans, ONB-2 4, ONB-3 14, ONB-4 6, ONB-5 4, ONB-7 2, ONB-8 4, ONB-9 4, ONB-12 8, ONB-13 4, ONB-14 3, FR-20 2, SEC-5 2, NFR-2 7). REQUIREMENTS.md maps no further ID to Phase 1 beyond these and the "partial coverage" extras. No orphans. Plans 01-23 and 01-24 additionally claim CON-1, which the traceability table maps to Phase 2 (Complete).

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ONB-1 | SATISFIED | Persisted lifecycle; resume reaps every interrupted launch; kill points pass. |
| ONB-2 | SATISFIED | No competing index; record holds refs and digests. |
| ONB-3 | SATISFIED | Prevention (SC2) plus the detection backstop that sees ignored files (P-2); read confinement now enforced for every admitted command (P-3). |
| ONB-4 | SATISFIED | No repo execution; neutralized safe git. |
| ONB-5 | SATISFIED | Ref digests unchanged; hook denies ref-moving git. |
| ONB-7 | SATISFIED | Record carries mapping mode, scope, completeness, revision. |
| ONB-8 | SATISFIED | Budgets persist across retries. |
| ONB-9 | SATISFIED | Real versioned record on the target. |
| ONB-12 | SATISFIED | Fail-closed suites pass. |
| ONB-13 | SATISFIED | Graph and intel built in staging, recorded at the onboarded commit. |
| ONB-14 | SATISFIED | 24 document nodes in the real record. |
| FR-20 | SATISFIED | `avarice context` tests pass (carried). |
| SEC-5 | SATISFIED | Carried; no TLS or auth weakening in changed files. |
| NFR-2 | SATISFIED | AC-1 1 s. |

Bookkeeping, for the orchestrator, none of it edited by me: (1) REQUIREMENTS.md lists the Phase 1 rows above as `Gaps Found` (set by the verifier-driven revert); with this report they can be marked Complete. (2) `01-REVIEW-DISPOSITION.md` still lists CR-02, CR-03, WR-03 (old), WR-04 (old), CR-01 and others as `open` or fixed against the previous review's IDs; CR-02 and CR-03 correspond to the closed P-3 and P-2 gaps (rows marked "not in the current review"), and the open rows WR-05 to WR-08 and IN-05 are older, unreviewed warnings. They are triage items, not must-have failures.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/domain/invocation-scope.ts` | 188-190, 241-243 | `workRoot` required by type only (review WR-01) | WARNING | Fails closed; add an absolute-path assertion. |
| `test/unit/invocation-scope.test.ts` | 309-313 | `@ts-expect-error` guard not run by `npm test` (review WR-02) | WARNING | Covered by `npm run typecheck` only. |
| `src/domain/hook-decision.ts` | 288, 361-362, 366-367 | `SHORT_VALUE_OPTIONS` exported but unused elsewhere, stale comment, redundant local (IN-01, IN-02) | INFO | Cleanup. |
| `test/integration/hook.test.ts` | 442 | Misindented line (IN-03) | INFO | Cosmetic. |
| `test/fault/killpoints.test.ts` | catch-all, no healthy-reference assertion | WARNING (carried) | Can pass or fail vacuously; see coincidental_reliance_items. |

No `TBD`, `FIXME` or `XXX` in `hook-decision.ts`, `invocation-scope.ts` or `docs/containment.md`.

### Human Verification Required

None. One operational note for later phases, not a must-have: with shell grep refused, an agent that reaches for Bash grep gets `shell-not-allowed` and must switch to the Grep tool (review IN-04). The contained mapper and intel agents have not been re-run live since the change. The last live mapping and onboarding evidence predates it. If a later live onboarding spends turns on grep retries, give the denial reason a pointer to the Grep tool; this does not affect any success criterion.

### Gaps Summary

No gaps. P-3 is closed by removal rather than by a more complete parser: the first quick task made the detector fail closed on every `-d`/`--directories` value other than `read` or `skip`, and the second dropped grep from the admitted commands altogether, which supersedes the detector and deletes its option model. The nine bypass spellings from the previous report are denied through the production chain; the docs row states what the hook enforces and no more; P-1, P-2 and SC1 to SC5 show no regression. Remaining items are code-review hardening (WR-01, WR-02), cosmetic cleanup and the carried SC4 test-hardening note.

---

_Verified: 2026-11-04T23:10:00Z_
_Verifier: Claude (gsd-verifier)_
