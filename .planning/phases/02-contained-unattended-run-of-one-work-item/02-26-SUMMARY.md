---
phase: 02-contained-unattended-run-of-one-work-item
plan: 26
subsystem: containment
tags: [hook, git, secret-read, gap-closure, CR-01]
requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: the PreToolUse hook read rules, the READ_ONLY_COMMANDS list, docs/system as built
provides:
  - the hook judges the path part of a git object name with the read rules (rule ID shell-git-object)
  - option allow-lists for git log and git status, and object-by-path operands only for git show (rule ID shell-git-output)
  - a real-git corpus on a sentinel-bearing scratch repository (admitted, refused, hook-only forms)
  - docs/system rules 12 and 13, 35 rule IDs, the contract-command residual in Limits and findings
affects: [containment, verification of phase 02 (CR-01), run purpose read rules]
actuals:
  tokens: 44500
  tasks: 3
  commits: 14
plan_head_before: f382d9193103bf477695e053f3f8d5996c7c1458
plan_head_after: d91639a1a5a009271f778566906c08b7e37b2562
tech-stack:
  added: []
  patterns: ["allow-list of options per admitted git command", "object-name path part judged by the same read rules as a file path", "real-git sentinel corpus proves a refusal is not vacuous"]
key-files:
  created:
    - test/integration/hook-git-secret-reads.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task2b.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task2c.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task2d.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-red-evidence-task2e.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-26-reviews/
  modified:
    - src/domain/hook-decision.ts
    - src/domain/invocation-scope.ts
    - test/unit/hook-decision.test.ts
    - test/helpers/scratch-repo.ts
    - docs/system/containment.md
    - docs/system/findings.md
    - docs/system/coverage.md
key-decisions:
  - "READ_ONLY_COMMANDS keeps all eleven entries; the hook narrows the forms, so host settings and the documented count are unchanged"
  - "git log --stat, --shortstat, --name-only and --name-status stay admitted: they print names and counts, never content (proven with real git)"
  - "git show takes only object-by-path operands and no option; git show of a commit and git log -p are refused"
  - "Any wildcard, backslash or leading / ! ( ^ in the path part of a colon word is refused shell-git-object: git reads those as pathspecs"
  - "The contract-command (sandbox) residual is named, not closed, and goes to the owner"
requirements-completed: [RC-5, CON-1]
coverage:
  - id: D1
    description: "git show HEAD:.env, git show :.env and git log -p are denied with secret globs set, under the map and the run policy (CR-01 repro)"
    requirement: "RC-5"
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#git object reads and output forms (CR-01) > repro"
        status: pass
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts#tracer: git show of a secret path through the real hook"
        status: pass
    human_judgment: false
  - id: D2
    description: "Whole class against real git: every admitted form prints no sentinel; every refused form is denied and does print it"
    requirement: "RC-5"
    verification:
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts#admitted git forms print no secret content"
        status: pass
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts#refused git forms are real leaks"
        status: pass
    human_judgment: false
  - id: D3
    description: "Legitimate git reads still pass with shell-identity; adjacency with cat; empty, encoding and ordering truths"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#git object reads and output forms (CR-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Earlier rule names kept (shell-git-option, deny-read, outside-read-set, shell-syntax); hook, hook-decision and mutation suites pass"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "node --test test/unit/hook-decision.test.ts test/integration/hook.test.ts test/mutation/fail-closed.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/system states the git object and output rules, 35 rule IDs, the contract-command residual; findings, recount, fresh review PASS"
    requirement: "CON-1"
    verification: []
    human_judgment: true
    rationale: "Prose accuracy was judged by twelve fresh reviewer rounds that could not run git or the ledger commands; the owner reads the Limits bullet and decides the sandbox residual"
  - id: D6
    description: "The sandbox residual: code a contract command runs can read a secret file in the clone"
    requirement: "RC-5"
    verification: []
    human_judgment: true
    rationale: "Closing it needs a sandbox read deny of the clone's secret paths, which can break checks that load them; an owner decision (T-02-91)"
duration: 127min
completed: 2026-11-07
status: complete
---

# Phase 02 Plan 26: CR-01 git secret reads Summary

**The hook now refuses every admitted git form that prints a tracked or staged secret file, proven against real git: object-name path parts get the read rules, git log and git status take option allow-lists, and git show takes only object-by-path operands.**

CR-01 is closed for the model's own tools and the admitted read-only commands. The truth that a run cannot read secret files holds in full only with the contract-command (sandbox) residual accepted by the owner: code that a contract command runs can still read a secret file present in the clone. That residual is named in docs/system/containment.md (Limits of containment) and docs/system/findings.md and is not closed here.

## Performance

- **Duration:** 127 min (started 2026-11-07T20:20:20Z, completed 2026-11-07T22:27:42Z, including a resume after a network error and twelve fresh documentation review rounds)
- **Tasks:** 3
- **Commits:** 14 task commits, plus the plan metadata commit
- **Files modified:** 7 source, test and docs files, one new test file, six RED evidence files, the review record

## Accomplishments

- Task 1 (tracer): `checkGitObjects` judges the path part of `<rev>:<path>`, `:<path>` and `:<stage>:<path>` with the read rules, from the working copy root and from the shell's directory; braces and leading `/`, `!`, `(` refuse `shell-git-object`. End to end: the real hook entry refuses `git show HEAD:.env` on a repository where real git prints the sentinel.
- Task 2: `GIT_OUTPUT_FORMS` and `checkGitOutput` give `git log` and `git status` option allow-lists compared whole (long) or per character (short), and `git show` object-by-path operands with no option. The real-git corpus: 26 admitted forms print no sentinel, 14 refused forms are denied and do print it, 6 hook-only forms are denied.
- Task 3: containment.md rules 12 and 13, the check order, 35 rule IDs (6 allow, 30 deny, one on both), a Limits bullet and a Quirks bullet; findings.md lines for the proposal contradiction, the symlink gap and the sandbox read denial; coverage.md recounted; twelve fresh review rounds ending in PASS.

## Task Commits

1. **Task 1: tracer** - `54d2cd5` (test, RED), `2d6ed2f` (feat, GREEN)
2. **Task 2: the rest of the class** - `2ae1ba9` (test, RED), `9383cb8` (feat, GREEN)
3. **Defects found by the Task 3 reviews, each RED first** - `3718973`/`8d25aa7` (`git status -u -v`), `ebea855`/`31220ff` (a colon word after a bare `-u`), `42d3419`/`156ce48` (`:^` pathspec negation), `b7c94ba`/`42156c7` (quoted wildcard after a leading colon), `ac520c1` (comment example)
4. **Task 3: docs** - `d91639a` (docs)

**Plan metadata:** the final docs commit that holds this SUMMARY, STATE.md and ROADMAP.md.

## RED evidence (TDD gate)

RED records are in 02-26-red-evidence-task1.json, task2.json and task2b to task2e.json, each with the failing tests, the tests passing at base and the semantic assessment. Every RED run failed on the planned assertion (the hook allowing a form the plan refuses), not on a syntax, import or fixture fault. Forms that already denied at base by accident of the whole-word glob match are recorded under passingAtBase in task 1.

## Corpus results (integration)

- **Moved between lists:** none moved. Every LEAKS form printed the sentinel with real git; every ADMITTED form printed none.
- **Added by the reviews:** `git show :^src/a.ts` and four quoted wildcard words (`:*`, `:.env*`, `:?env`, `:[.]env`) are LEAKS forms (real git prints the sentinel); `git log -n -p`, `git status -u`, `-u -s`, `-uno` are ADMITTED. One word of the first draft (`:?nv`) was a test typo (the glob `?nv` does not match `.env`); the RED run recorded in task2e used it, and the corrected `:?env` passes with the sentinel printed.
- **Hook-only observations (t.diagnostic):** `git log --cc` printed the sentinel; `--word-diff`, `--pat`, `-S TOKEN --oneline`, `--raw` and `git show HEAD:sub/../.env` printed none. `git log --pat` and other abbreviations are refused by git itself; `git status --verb` is accepted by git, which is why the allow-list stays whole-word.
- **Case variant:** `git show HEAD:.ENV` prints no sentinel with real git.
- **Index form naming a directory:** `git show :sub` printed no sentinel with this git (reported, not asserted).

## Decisions Made

See key-decisions. No CONTEXT decision governs hook read forms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `git status -u` skipped the next word**
- **Found during:** Task 3 (fresh review round 1)
- **Issue:** `-u` of `git status` was treated as taking the next word; git takes its mode only attached, so `git status -u -v` passed the hook and printed the staged diff.
- **Fix:** new `shortAttached` field in `GitOutputForm` (plan lists six fields); `-u` is attached-only. RED first.
- **Files modified:** src/domain/hook-decision.ts, tests
- **Verification:** unit test plus the real-git leak form `git status -u -v`
- **Committed in:** `8d25aa7` (RED `3718973`)

**2. [Rule 1 - Bug] a colon word after a bare `-u` was not judged as an object name**
- **Found during:** Task 3 (round 2)
- **Fix:** `SHORT_VALUE_OPTIONS['git status']` no longer lists `u`. RED first.
- **Committed in:** `31220ff` (RED `ebea855`)

**3. [Rule 1 - Bug] `:^path` pathspec negation passed**
- **Found during:** Task 3 (round 5)
- **Fix:** a path part starting with `^` is `shell-git-object`. RED first; real git prints HEAD's patch for the form.
- **Committed in:** `156ce48` (RED `42d3419`)

**4. [Rule 1 - Bug] a quoted wildcard after a leading colon is a pathspec for git**
- **Found during:** Task 3 (round 6)
- **Fix:** a path part with `*`, `?`, `[` or a backslash is `shell-git-object`. RED first; real git prints the sentinel for `:*`, `:.env*`, `:?env`, `:[.]env`.
- **Committed in:** `42156c7` (RED `b7c94ba`)

**5. [Rule 1 - Bug] wrong abbreviated-option example in a code comment and the docs**
- **Found during:** Task 3 (round 11), checked with real git
- **Fix:** `git log --pat` is refused by git; the example is now `git status --verb`.
- **Committed in:** `ac520c1`, `d91639a`

**6. [Rule 3 - Blocking] the plan's Task 3 verify command greps coverage.md for "Test files" count**
- No deviation of substance; the count is 117 and matches.

---

**Total deviations:** 5 auto-fixed (4 hook bugs, 1 doc example). **Impact on plan:** the fresh review found four real hook bypasses that the plan's corpus did not contain; each is closed and covered by a failing-first test, and the plan's truths hold unchanged.

## Issues Encountered

- A session ended on a transient network error (ENOTFOUND) after Task 2 RED; the plan resumed from commits `54d2cd5`, `2d6ed2f`, `2ae1ba9` and the uncommitted Task 2 GREEN edits.
- The reviewers had no shell, so the ledger counts and real-git behaviour were checked by the executor (source lines 26,261, test files 117, rule IDs 35, `git log --pat` and `git status --verb` run by hand).
- Full suite (`npm test`): 2493 tests, 2438 pass, 0 fail, 55 skipped, `AC-3: 24/24`. No load-sensitive failure occurred in the final run.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-02-88 to T-02-90 are mitigated by checkGitObjects and GIT_OUTPUT_FORMS with the real-git corpus; T-02-91 (contract-command code reading a secret file) is accepted and named for the owner; T-02-92 is accepted (admitted alternatives carry the same information); T-02-93 is mitigated by the fresh review.

## Items needing the owner

1. **The sandbox residual (T-02-91, human-check of Task 3).** Code that a contract command runs (a test the run wrote, run by `npm test`) can read a secret file present in the clone and print it, because the run sandbox denies reads by root only. Decide: accept, or schedule a sandbox read deny of the clone's secret paths (which can break checks that load them). Until accepted, the CR-01 truth "a run cannot read files the secret globs protect" holds for the model's own tools and admitted commands only. See docs/system/containment.md Limits of containment and docs/system/findings.md.
2. **A symlink gap, recorded in findings.md** (hook-decision.ts:510): the path part of a git object name is judged on the working copy's file system, so a path component that is a symlink in the working copy is judged by its target.
3. **Proposal contradiction** (docs/containment.md:108 still lists the git-object bypass as remaining; the proposal is unedited per CLAUDE.md).
4. G-02-9 and the review items WR-02 to WR-09, IN-01 to IN-09 are not addressed by this plan.

## Next Phase Readiness

CR-01 can be re-verified (`/gsd-verify-work`): the repro forms are denied, the corpus proves the class against real git, and docs/system is current and reviewed. No live model call was made; nothing is spent against the D-15 ceiling.

## Self-Check: PASSED

- Files exist: 02-26-red-evidence-task1.json, task2.json, task2b to task2e.json, 02-26-reviews/README.md, test/integration/hook-git-secret-reads.test.ts.
- Commits exist: 54d2cd5, 2d6ed2f, 2ae1ba9, 9383cb8, 3718973, 8d25aa7, ebea855, 31220ff, 42d3419, 156ce48, b7c94ba, 42156c7, ac520c1, d91639a.
- Plan verification: unit, integration, mutation, boundary lint, tsc and the full suite pass; hook-rule count 35; test-file count 117; docs/containment.md unchanged.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-07*
