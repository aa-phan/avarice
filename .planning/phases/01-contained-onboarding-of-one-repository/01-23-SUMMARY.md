---
phase: 01-contained-onboarding-of-one-repository
plan: 23
subsystem: hook-read-confinement
tags: [hook, pre-tool-use, allow-list, grep, option-parser, containment, tdd]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: decideToolCall and readRule (deny-list), InvocationScope.readRoots, buildHookPolicy, the real hook entry
provides:
  - "Allow-list read rule shared by shell, Read, Grep and Glob: staging, policy readRoots and allowRead, else outside-read-set"
  - "HookPolicy.readRoots (optional, canonical), parsed by parseHookPolicy and emitted by buildHookPolicy"
  - "Read-command option parser: attached short values, --name=value, words after a bare --, per-character clusters, shell-option-value on a stray character"
  - "shell-recursive-read: recursive grep judged on the directories it walks (links, denied roots, secret globs below staging)"
  - "Exported SHORT_VALUE_OPTIONS and every VERIFICATION.md P-3 case as a unit test"
affects: [01-24 work-root deny, docs/containment.md, mapper and intel invocations]

plan_head_before: fcb409b32a23f43d6d78ba9b3679d0994bf15014
plan_head_after: f144eb486a841965f228cc56112ca5038e8bfa17

actuals:
  tokens: 8230
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Allow-list after deny rules in one shared readRule, so every read kind inherits it through checkRead"
    - "Every attached option value and operand of a read command is a path candidate (fail closed)"
    - "A recursive read is judged on the roots it starts from, because the hook cannot list what the walk reaches"

key-files:
  created:
    - .planning/phases/01-contained-onboarding-of-one-repository/01-23-red-evidence-task1.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-23-red-evidence-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/adapters/host-claude/hook-policy.ts
    - test/unit/hook-decision.test.ts
    - test/integration/hook.test.ts
    - test/mutation/fail-closed.test.ts

key-decisions:
  - "readRule order is readConfine, deny-read, allow-list (outside-read-set), secret globs; a missing readRoots confines reads to staging and allowRead"
  - "A recursive grep inside staging is denied under the default secret globs (all start with **/); the mapper falls back to the host Grep tool"
  - "Separate-word option values are path-checked but are not positional operands, so the grep pattern is never mistaken for a walked root"
  - "BSD grep -S and -O (follow links while walking) are treated like -R, a hardening beyond the plan text"

patterns-established:
  - "Pattern-supplying long options are matched by prefix (liberal), so an abbreviated --regexp cannot hide a walked root"
  - "Secret glob below a root: a ** or wildcard segment agrees with anything, and the glob must name something deeper than the root"

requirements-completed: [CON-1, ONB-3]

coverage:
  - id: D1
    description: "Shell, Read, Grep and Glob reads are confined to staging, the policy's readRoots and allowRead; anything else is denied outside-read-set, after deny-read and before the secret globs"
    requirement: CON-1
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#reads are confined to an allow-list (CR-02, D-GAP-01)"
        status: pass
      - kind: integration
        ref: "test/integration/hook.test.ts#the read allow-list through the real hook entry (CR-02, D-GAP-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildHookPolicy emits canonical readRoots from the scope and parseHookPolicy refuses a malformed readRoots"
    requirement: CON-1
    verification:
      - kind: integration
        ref: "test/integration/hook.test.ts#the read allow-list through the real hook entry (CR-02, D-GAP-01) writes the scope read roots as canonical readRoots"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#reads are confined to an allow-list (CR-02, D-GAP-01) parses readRoots, refuses a malformed one, and parses a policy without it"
        status: pass
    human_judgment: false
  - id: D3
    description: "Attached option values, words after a bare --, and stray cluster characters are judged or refused; every P-3 shell case is denied with its named rule"
    requirement: ONB-3
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#shell option values, operands after --, and recursive reads (CR-02, D-GAP-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A recursive grep is refused when it follows links, contains a denied root, or can reach a secret glob below staging; one inside a read root is allowed"
    requirement: ONB-3
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#shell option values, operands after --, and recursive reads (CR-02, D-GAP-01) judges a recursive grep on the directories it walks, not on the command"
        status: pass
    human_judgment: false
  - id: D5
    description: "The mapper's live run still writes its documents when the shell grep -r it used is denied and it falls back to the host Grep tool"
    verification: []
    human_judgment: true
    rationale: "Not re-run live in this round (spend), as the plan's flagged assumption states; no test asserts the agent's fallback behaviour"

duration: 10min
completed: 2026-11-04
status: complete
---

# Phase 1 Plan 23: Hook read allow-list, option values and recursive grep Summary

**Hook read confinement by allow-list (staging, policy readRoots, allowRead) shared by shell, Read, Grep and Glob, with an option and operand parser that judges attached values and words after `--`, and a recursion rule that refuses a grep walk that can reach links, a denied root or a secret glob (gap P-3, CR-02, hook half)**

## Performance

- **Duration:** 10 min
- **Started:** 2026-11-04T09:58:17Z
- **Completed:** 2026-11-04T10:08:34Z
- **Tasks:** 2 (a tracer, then an auto TDD task)
- **Files modified:** 5 source and test files, 2 RED evidence records

## Accomplishments

- `readRule` now applies a fixed order (readConfine, deny-read, allow-list, secret globs). A path under none of staging, `readRoots` or `allowRead` is `outside-read-set`, so `cat ~/.netrc`, a sibling onboarding's staging file and a Grep or Glob rooted outside the read set are denied; `buildHookPolicy` writes the scope's `readRoots` canonical, and the real hook entry shows the same decisions with only the tool, rule and IDs in `hook.decision` events.
- `checkSegment` no longer skips every word starting with `-`: a parser reads attached short values (`-fPATH`), `--name=value`, separate-word values, the words after a bare `--`, and clusters per character, and path-checks all of them. A stray cluster character (`/`, `é`) is `shell-option-value`.
- A recursive grep (`-r`, `-R`, `--recursive`, `--dereference-recursive`, `-d recurse`, `-drecurse`, `--directories=recurse`, and unambiguous long prefixes) is `shell-recursive-read` when it follows links, when a walked root contains a denied root, or when a root in staging can contain a secret-glob match. With the default globs every recursive grep inside staging is denied; one inside a read root is allowed.
- Each P-3 case VERIFICATION.md reproduced is a unit test with its expected rule, plus adjacency, empty-list, ordering, encoding and symlink edges.

## Task Commits

1. **Task 1: Tracer, read allow-list end to end**
   - RED `65f60ad` (test) with `01-23-red-evidence-task1.json`
   - GREEN `84910d3` (feat)
2. **Task 2: option values, `--` operands, recursion rule**
   - RED `d082904` (test) with `01-23-red-evidence-task2.json`
   - GREEN `f144eb4` (feat)

**Plan metadata:** the docs commit that adds this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `src/domain/hook-decision.ts` - `HookPolicy.readRoots`, parse check, allow-list in `readRule`, `SHORT_VALUE_OPTIONS`, `parseReadArgs`, `globMayMatchBelow`, `recursiveRule`
- `src/adapters/host-claude/hook-policy.ts` - canonicalizes and emits `readRoots`
- `test/unit/hook-decision.test.ts` - allow-list and option/recursion describes; pipeline test now denies `grep -rn "a|b" src` and allows `grep -n "a|b" src/a.ts`
- `test/integration/hook.test.ts` - allow-list through the real hook entry
- `test/mutation/fail-closed.test.ts` - MF-04 quoted forms over non-recursive `grep -n ... src/a.ts`
- `.planning/phases/01-contained-onboarding-of-one-repository/01-23-red-evidence-task1.json`, `...-task2.json` - classifier-validated RED records (`RED_EVIDENCE_OK`)

## TDD Gate Compliance

Both tasks have RED then GREEN commits in order (`test(01-23)` before `feat(01-23)`); no refactor commit was needed.

- **RED task 1:** target test `denies a sibling onboarding staging file and a credential store outside every root` failed on the planned assertion (`allow:shell-identity` instead of `deny:outside-read-set`); `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (TAP, 46 tests, 6 failing in the unit file). Semantic assessment: the target ran and failed because `readRule` was a deny list, not on syntax, fixture or unrelated faults. The integration describe also failed on the missing `readRoots` field of the written policy.
- **RED task 2:** target test `denies each case VERIFICATION.md P-3 reproduced, with its rule` failed on `grep -r PASSWORD .` (`allow:shell-identity` instead of `deny:shell-recursive-read`); `RED_EVIDENCE_OK` (TAP, 57 tests, 10 failing). Semantic assessment: `checkSegment` skipped every dash word and nothing judged a recursive walk.
- **Acceptance wording vs fact:** the plan says Task 2's RED run shows each P-3 shell case allowed before the change. Task 1's allow-list had already closed `cat /work/onb-2/staging/secret.txt`, `cat /home/u/.netrc` and `grep -r token /home/u` (their operands do not start with a dash), so those three were denied at the Task 2 RED run; the other three (`grep -r PASSWORD .`, `grep -f...`, `grep --file=...`) were allowed. The evidence record states this.

## Mutation checks (restored from a saved copy each time)

| Mutation | Unit-test result |
| --- | --- |
| Drop the `--` operand rule (treat words after `--` as options) | 1 failure |
| Drop attached-value checks (path-check operands only) | 2 failures |
| Treat `R` like `r` (no link-following) | 1 failure |

After each, the saved copy was restored (diff empty) and the file passed 57/57.

## Decisions Made

- Order of rules in `readRule` is fixed and commented: readConfine, deny-read, allow-list, secret globs. A policy without `readRoots` is never wider than staging plus `allowRead`.
- Separate-word option values are path-checked but kept out of the positional list, so `grep -d recurse x src` has pattern `x` and root `src`, and `grep -e foo src` walks `src`.
- A glob can match below a root only if it names something deeper than the root (`docs/*.pem` does not reach below `docs/sub`); a `**` or wildcard segment agrees with anything.
- Pattern-supplying long options (`--regexp`, `--file`) are matched by prefix of 4 or more characters; this over-includes and so judges more roots, never fewer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] BSD grep `-S` and `-O` treated as link-following**
- **Found during:** Task 2 (recursion rule)
- **Issue:** On macOS (BSD grep) `-S` and `-O` make a recursive walk follow symbolic links, which would let `grep -rS` leave every root; the plan names only `-R` and `--dereference-recursive`.
- **Fix:** `recursiveRule` returns `shell-recursive-read` when `S` or `O` is among the cluster flags of a recursive grep; a unit test (`grep -rS x /gsd/core`) covers it.
- **Files modified:** `src/domain/hook-decision.ts`, `test/unit/hook-decision.test.ts`
- **Committed in:** `f144eb4`

**2. [Rule 2 - Missing Critical] Unambiguous long-option prefixes and a separate-word `--directories recurse`**
- **Found during:** Task 2
- **Issue:** getopt accepts `--recurs` for `--recursive`; matching only exact spellings would let an abbreviation walk a tree unjudged. `--directories recurse` (separate word) is the same.
- **Fix:** `--recursive`, `--dereference-recursive` and `--directories` match by prefix of 5 or more characters; `--directories` with no attached value counts as `recurse` when a positional word is `recurse`. Tests: `grep --recurs x src`, `grep --directories recurse x src`.
- **Files modified:** `src/domain/hook-decision.ts`, `test/unit/hook-decision.test.ts`
- **Committed in:** `f144eb4`

**3. [Rule 2 - Missing Critical] The implicit working-directory root and every walked root also go through the allow-list**
- **Found during:** Task 2
- **Issue:** `grep -r x` with no operand walks the cwd; judging it only against secret globs would leave a cwd outside the read set unjudged.
- **Fix:** `recursiveRule` passes each walked root, including the cwd, through `readRule` first (test: `grep -r x` with cwd `/gsd/core` allowed with `readRoots`, `deny:outside-read-set` without).
- **Files modified:** `src/domain/hook-decision.ts`
- **Committed in:** `f144eb4`

---

**Total deviations:** 3 auto-fixed (all Rule 2, hardening within the plan's fail-closed intent)
**Impact on plan:** No scope creep; each strengthens a mitigation of T-01-79 or T-01-80.

## Issues Encountered

- The first RED record for Task 2 was written with a wrong expected-case description; the classifier passed it, but the assertion that actually failed first was `grep -r PASSWORD .`, so the record was regenerated before its commit.
- A shell `$CMD` variable in zsh did not word-split during the first attempt to capture Task 1's RED run (exit 127, `INVALID_RED`); re-run with the literal command gave `RED_EVIDENCE_OK`.

## Known Stubs

None.

## Residual risks (as planned)

- T-01-81 stays accepted: committed secret-glob files readable through git objects (`git show <rev>:<path>`, `git log -p`) and files the host Grep tool reaches while recursing inside staging. Plan 01-24 records both as known bypasses in docs/containment.md.
- The mapper's `grep -r ... src/` is now denied inside staging; it is expected to fall back to the host Grep tool. Not re-run live (spend), per the plan's flagged assumption (coverage D5 is `human_judgment: true`).
- The work-root deny in the hook and sandbox policy is plan 01-24; the test for it here only pins the rule name (`deny-read`) when a policy already carries the work root.

## Verification

- `node --test "test/unit/hook-decision.test.ts" "test/integration/hook.test.ts" "test/mutation/fail-closed.test.ts" "test/containment/failclosed.test.ts"`: 164 tests, 164 pass, 0 fail
- `npx tsc -p .`: exit 0; `node scripts/check-boundaries.ts`: `check-boundaries: ok (53 file(s))`
- Full suite `node --test`: 1229 tests, 1207 pass, 0 fail, 22 skipped
- `grep -c "readRoots" src/adapters/host-claude/hook-policy.ts` = 2; `grep -c "needs a list of strings readRoots" src/domain/hook-decision.ts` = 1; `shell-recursive-read` count 3, `shell-option-value` count 1 in `src/domain/hook-decision.ts`
- Each of the six P-3 command strings appears verbatim in `test/unit/hook-decision.test.ts`

## Threat Flags

None. The change tightens an existing trust boundary (shell command to hook decision) and adds no endpoint, auth path or schema.

## Next Phase Readiness

Ready for 01-24: `readRoots` is in the policy, the allow-list and `deny-read` ordering are pinned by tests, and a work-root entry in `denyRead` plus the staging path in `allowRead` already yields `deny-read` for a sibling staging file.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-04*

## Self-Check: PASSED
