---
phase: 02-contained-unattended-run-of-one-work-item
plan: 27
subsystem: containment
tags: [hook, git, secret-read, symlink, gap-closure, G-02-H2, G-02-H4]
requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: checkGitObjects, GIT_OUTPUT_FORMS and the real-git sentinel suite from plan 02-26
provides:
  - lexicalAbsolute(path) in src/domain/normalized-root.ts, a string-only normal form of an absolute path
  - checkGitObjects matches the path part of a git object name against the secret globs as written (from the working copy root and the shell's directory) before the canonical check
  - gitArgs(form, args), one git operand walker shared by the object check and checkGitOutput
  - corrective reasons on shell-git-output and shell-git-object, printed by the hook after the rule
  - commandWords(command), a test aid; the real-git suite builds its rigs in before hooks and runs git on the lexer's words
  - docs/system/containment.md and findings.md describe the two-way judgement of object names
affects: [containment, hook read rules, plan 02-35 (documentation pass and findings disposition)]
actuals:
  tokens: 17000
  tasks: 3
  commits: 7
plan_head_before: 2ac2b6311ff27453e7b0988c55045c7300fe2379
plan_head_after: 5ab37659c8d6865f0ee36077c40571c359f67048
tech-stack:
  added: []
  patterns: ["a git object name is matched lexically as written and again after symlink resolution", "one option walker for both the object and the output checks, so the two option tables cannot disagree about operands", "real-git sentinel assertions on repositories built in before hooks"]
key-files:
  created:
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-27-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-27-red-evidence-task2.json
  modified:
    - src/domain/normalized-root.ts
    - src/domain/hook-decision.ts
    - test/unit/normalized-root.test.ts
    - test/unit/hook-decision.test.ts
    - test/integration/hook-git-secret-reads.test.ts
    - docs/system/containment.md
    - docs/system/findings.md
key-decisions:
  - "A git object name is matched against the secret globs lexically (`.` removed, `..` applied on the string) from the working copy root and from the shell's directory, then judged again by the canonical read rules; no rule ID was added"
  - "git show <revision>:.env is refused even when that revision stores a symlink at .env (deliberate over-deny: git would print only the link text)"
  - "SHORT_VALUE_OPTIONS keeps its git log and git show value letters (so earlier rule names such as deny-read for `git log -pO/path` hold); only the M of git status is dropped"
  - "S-IN-01 is skipped: the model has no admitted way to change directory, documented in rule 12"
requirements-completed: [CON-1, RC-5, CON-14]
coverage:
  - id: D1
    description: "A working-copy symlink (live, dangling, or on a parent directory) at a secret object name no longer hides it: git show HEAD~1:.env, :.env, :0:.env and HEAD~1:secrets/key.txt are deny-secret-read, and real git prints the sentinel for each"
    requirement: "CON-1"
    verification:
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts#symlink at a secret object name (G-02-H2)"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#symlink at a secret object name (G-02-H2)"
        status: pass
    human_judgment: false
  - id: D2
    description: "lexicalAbsolute: `.` and empty segments removed, `..` applied on the string, null above `/` or for a relative path; no node:path in src/domain"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/normalized-root.test.ts#lexicalAbsolute"
        status: pass
      - kind: command
        ref: "node scripts/check-boundaries.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "File reads keep judging the resolved target (cat .env stays allowed behind a link to config/dev.env; link.txt -> .env stays deny-secret-read); every earlier CR-01 decision keeps its rule"
    requirement: "RC-5"
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#git object reads and output forms (CR-01)"
        status: pass
      - kind: integration
        ref: "test/integration/hook.test.ts and test/mutation/fail-closed.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every operand of the admitted git option grammar is judged as an object name (gitArgs), the git rows of SHORT_VALUE_OPTIONS are pinned to GIT_OUTPUT_FORMS, git status -M HEAD:.env is deny-secret-read"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#git object reads and output forms (CR-01) > table pin / operand grammar"
        status: pass
    human_judgment: false
  - id: D5
    description: "shell-git-output and shell-git-object denials carry a corrective reason, printed by the real hook as `avarice: <rule>: <reason>`"
    requirement: "CON-14"
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#git object reads and output forms (CR-01) > corrective reasons"
        status: pass
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts#corrective reasons through the real hook"
        status: pass
    human_judgment: false
  - id: D6
    description: "Real-git suite hygiene: rigs in before hooks, git run on commandWords, git show :sub admitted and sentinel-free; hook-rule count is 35"
    requirement: "RC-5"
    verification:
      - kind: integration
        ref: "test/integration/hook-git-secret-reads.test.ts"
        status: pass
      - kind: command
        ref: "grep -ohE ... src/domain/hook-decision.ts src/hook/pre-tool-use.ts | sort -u | wc -l prints 35"
        status: pass
    human_judgment: false
  - id: D7
    description: "docs/system/containment.md and findings.md describe the two-way judgement as built; fresh prose review and coverage.md recount follow in plan 02-35"
    requirement: "CON-1"
    verification: []
    human_judgment: true
    rationale: "Documentation prose accuracy is judged by a fresh reviewer in plan 02-35; this plan does not run the reviewer or edit coverage.md"
duration: 18min
completed: 2026-11-08
status: complete
---

# Phase 02 Plan 27: G-02-H2 symlink at a secret git object name Summary

**A working-copy symlink (live, dangling or on a parent directory) can no longer hide a secret path that git reads by name from history or the index: the hook matches the object name against the secret globs as written, from the working copy root and from the shell's directory, before the canonical check, proven on three real repositories.**

The same plan gives the two git option tables one operand walker, adds corrective reasons to the two git rules, and moves the real-git suite to before-hook rigs that run git on the lexer's own words.

## Performance

- **Duration:** 18 min (2026-11-08T01:22:35Z to 2026-11-08T01:40:41Z)
- **Tasks:** 3
- **Commits:** 7 (plus the plan metadata commit)
- **Files modified:** 7 source, test and docs files, 2 new RED evidence files

## Accomplishments

- **Task 1 (tracer):** `lexicalAbsolute` in `src/domain/normalized-root.ts`; `checkGitObjects` calls it on `stagingPath + '/' + path` and `canon(cwd) + '/' + path` and returns `deny-secret-read` when the staging-relative remainder matches `denyReadGlobs`, `outside-read-set` when a name climbs above `/`, `unresolvable-path` for a null cwd. The existing canonical check follows unchanged. Real hook plus real git: `git show HEAD~1:.env`, `git show :.env`, `git show :0:.env` (live link, different `.env` staged in the index), the dangling-link form, and `git show HEAD~1:secrets/key.txt` behind a directory link are all denied and real git prints the sentinel for each. `cat .env` stays allowed.
- **Task 2:** `gitArgs(form, args)` is the single walk of the `GitOutputForm` grammar. `checkGitOutput` uses it for its refusal, and `checkSegment` object-checks the deduplicated union of the read parser's positionals and the walker's operands. `M` is dropped from the `git status` value letters. `GIT_RULE_REASONS` gives `shell-git-output` and `shell-git-object` a corrective reason through an optional second argument of `deny`. The comment beside `GIT_OUTPUT_FORMS` records why `git rev-parse` and `git ls-files` have no entry and what was probed.
- **Task 3:** `commandWords(command)` exported as a test aid. In the integration suite every `rig()` call sits in a `before` hook, `gitOutput` runs git on `commandWords(line).slice(1)` (the quoted-wildcard block is folded into the leaks list), `git show :sub` is in the admitted list (real git prints no sentinel) and the reported-only describe is gone. docs/system: containment.md (canonical-comparison note, object-name paragraph, rules 12 and 13, check order, Quirks) and findings.md (symlink-gap line removed, proposal line re-anchored).

## Task Commits

1. **Task 1: tracer** - `0f68bd5` (test, RED), `0b35653` (feat, GREEN)
2. **Task 2: one operand grammar, reasons** - `906e1a4` (test, RED), `06ee1fe` (feat, GREEN)
3. **Task 3: hygiene and docs** - `5050e66` (test, RED), `04b4111` (feat, GREEN), `5ab3765` (docs)

## RED evidence (TDD gate)

- **Task 1** (02-27-red-evidence-task1.json): 219 tests, 210 pass, 9 fail. The unit and integration symlink cases failed with the hook allowing the forms (`allow` / `shell-identity`, hook verdict `allow`) where `deny-secret-read` was expected. The classifier returned `RED_EVIDENCE_OK` on the unit TAP report. The `lexicalAbsolute` cases failed at link time (named export missing), so that file is recorded but not used as RED authority. The `cat` cases and the unchanged cases passed at base. The git-leak assertion sits after the deny assertion in each integration test, so it was not reached at base; it passes at GREEN, which shows real git prints the sentinel for each rig.
- **Task 2** (02-27-red-evidence-task2.json): unit 159 tests, 3 fail (the `-M` operand case, the operand grammar test, the reasons test); integration 65 tests, 2 fail (both reason tests). The classifier returned `RED_EVIDENCE_OK`. **The table-pin test passed at base** (the plan expected it to fail on `M`): `checkGitOutput` already refused `-M`, so every unadmitted value letter was already denied. It is kept as a guard of the tables, and the `-M` operand behavior is covered by the separate failing `-M` test.
- **Task 3** (no evidence file, per plan): both `commandWords` tests failed with `TypeError: commandWords is not a function` (161 tests, 159 pass, 2 fail).

## Findings closed or skipped (input to plan 02-35's disposition record)

| Finding | Disposition | Where |
|---|---|---|
| G-02-H2 (the scoped review's CR-01) | fixed | lexical match in `checkGitObjects`; symlink exception removed from containment.md and findings.md |
| S-WR-01 | fixed | rigs in `before` hooks |
| S-WR-02 | fixed | `gitArgs` walker, table pin, `M` dropped from the git status value letters |
| S-IN-02 | fixed | corrective reasons on the two git rules |
| S-IN-03 | fixed | comment beside `GIT_OUTPUT_FORMS` |
| S-IN-04 | fixed | git run on `commandWords`; `git show :sub` asserted admitted and sentinel-free |
| S-IN-01 | skipped | the model has no admitted way to change directory (`cd` and `git -C` are not admitted, `git -c` is refused); documented in rule 12 |

## Truth and `missing:` coverage

| Item | Evidence |
|---|---|
| Lexical or resolved match denies the object name (live, dangling, parent directory) | D1 |
| Pure normalizer in src/domain, no node:path | D2 (boundary lint ok) |
| `cat` judges the target; link to a secret still denied; CR-01 decisions kept | D3 |
| Every operand of the grammar object-checked; tables pinned; `-pO/...` stays `deny-read`, `-O/home/u/.netrc` stays `outside-read-set` | D4 |
| Corrective reasons through the real hook | D5 |
| Before-hook rigs, lexer-driven argv, `:sub` admitted | D6 |
| Rule count prints 35 | D6 |
| symlink exception removed from containment.md and findings.md | D7 (prose review in 02-35) |

## Deliberate over-deny

`git show HEAD:.env` (and `<revision>:.env`) is now denied `deny-secret-read` even when that revision stores a symlink at `.env`, where git would print only the link text. Kept on purpose; recorded in containment.md Quirks.

## Test files whose expected decision gained a reason

None. No suite other than test/unit/hook-decision.test.ts and test/integration/hook-git-secret-reads.test.ts mentions `shell-git-output` or `shell-git-object`, and both compare `[decision, rule]` pairs. The integration helper `hookVerdict` now returns only the rule (text after `avarice: ` up to the next `: `). test/integration/hook.test.ts needed no edit.

## Decisions Made

See key-decisions. No CONTEXT decision governs hook read forms.

## Deviations from Plan

### Auto-fixed Issues

None - the plan executed as written, with these notes:

- **Table-pin test passes at base.** Recorded above under RED evidence (a RED-expectation difference, not a code deviation); the `-M` operand test carries the RED for that change.
- **Pin guard run by hand.** The supplied root-pin script runs `git -C`, which the session's command filter refused as a whole; the equivalent check (`git rev-parse --show-toplevel` equals the pinned root) was run as a plain command before each commit and always matched.
- **Dynamic imports in RED tests.** `gitArgs` and `commandWords` are reached through `await import(...)` inside their tests, so the unit file still loads at base and the failures are real assertion failures.

**Total deviations:** 0 auto-fixed. **Impact on plan:** none.

## Issues Encountered

- The `Bash` filter refused redirects and heredocs in commands that name a file containing `git` (the integration test file), so the TAP report for the classifier was captured from the unit file alone.
- Full suite (`npm test`): 2519 tests, 2464 pass, 0 fail (the rest skipped). No load-sensitive failure occurred; test/mutation/fail-closed.test.ts also passed alone (35/35).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-02-94 (object name behind a symlink) is mitigated by the lexical match, with unit and real-git cases; T-02-95 by `gitArgs`, the table pin and the dropped `M`; T-02-96 by the corrective reasons, asserted through the real hook; T-02-97 and T-02-98 are accepted as planned (rule 12 and the comment beside `GIT_OUTPUT_FORMS`); no package was installed (T-02-SC).

## Self-Check: PASSED

Created files exist (SUMMARY, both RED evidence JSON files, all modified files); commits `0f68bd5`, `0b35653`, `906e1a4`, `06ee1fe`, `5050e66`, `04b4111`, `5ab3765` are ancestors of HEAD; the hook-rule count prints 35; `git diff --quiet -- docs/containment.md` is clean.
