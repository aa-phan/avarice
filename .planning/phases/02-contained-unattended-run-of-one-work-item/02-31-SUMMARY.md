---
phase: 02-contained-unattended-run-of-one-work-item
plan: 31
subsystem: live-test-harness
tags: [redaction, evidence-hygiene, cleanup-containment, permission-allow-list, offline-tests]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: attended harness and live run harness (02-25, 02-26), the live evidence files they recorded
provides:
  - redactHome(text) in the live harness, applied by every live recorder
  - cleanupAttended with real-path containment checks (all before the first removal), taking optional home and tmp roots
  - attendedSettings with no cat, head, git diff, git show or git log prefix rule; git only as git status and git log --oneline
  - the three live jsonl files and LIVE-CASES.md holding ~ instead of the owner's home path
  - test/unit/live-harness-hygiene.test.ts (18 offline tests)
affects: [02-35 documentation pass, verify-work 2]

plan_head_before: bf8fc24694bd73fc59396050e43dc6a7aa71dbec
plan_head_after: f148e3d31d43f3796818162d2edf7b486be382c7

actuals:
  tokens: 12000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "destructive test-harness cleanup validates every target's real path against explicit roots before the first removal, with the roots injectable so the offline tests never name the real home"
    - "a recorder serializes, then redacts the whole line, so one function covers every field"

key-files:
  created:
    - test/unit/live-harness-hygiene.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-31-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-31-red-evidence-task2.json
  modified:
    - test/helpers/live-harness.ts
    - test/helpers/live-attended.ts
    - test/containment/live-run.test.ts
    - test/containment/live-onboarding.test.ts
    - test/containment/LIVE-CASES.md
    - test/containment/live-attended-phase2.jsonl
    - test/containment/live-run-phase2.jsonl
    - test/containment/live-run-phase2-admission.jsonl

key-decisions:
  - "redactHome replaces the home wherever the next character cannot continue a path component (not a letter, digit, dot, underscore, at, plus or dash), which includes the plan's slash, quote and end of text and also whitespace, a colon or a JSON backslash escape. A sibling such as <home>2/x or <home>-backup is kept."
  - "cleanupAttended takes an optional second argument { home, tmp } that defaults to the real home and real temporary directory. The offline tests pass two temp directories, so no test names the real home."
  - "The verdict judge's READ_ONLY_BASH list in live-attended.ts is unchanged (it judges the recorded sessions, which ran under the earlier allow list); it was reformatted over several lines with a comment so the plan's grep on the allow list reads only the allow list."

patterns-established:
  - "Plan-level verify greps that name a literal list can match a second, unrelated list in the same file; comment and reformat the second rather than change its meaning"

requirements-completed: [CON-1]

coverage:
  - id: D1
    description: "Every live recorder (attended results, live run cases, live onboarding cases) writes the owner's home as ~; a real file write through appendAttendedResult holds no home path"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/live-harness-hygiene.test.ts#appendAttendedResult (R-IN-01) > writes a line whose reason holds the home path with ~ and no home path"
        status: pass
      - kind: unit
        ref: "test/unit/live-harness-hygiene.test.ts#redactHome (R-IN-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "cleanupAttended throws and deletes nothing for a profile directory outside the default parents, without the fixture tag, or linked out of its parent, for a created parent that is not a default parent, and for an evidence directory outside or equal to the temporary directory; a genuine fixture is removed"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/live-harness-hygiene.test.ts#cleanupAttended (R-WR-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The attended allow list holds git only as git status and git log --oneline and no cat, head, git diff or git show rule"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/live-harness-hygiene.test.ts#attendedSettings allow list (R-WR-08)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four evidence files hold no absolute home path, every jsonl line parses to the same record as before once paths are redacted, and the verdict test still passes"
    requirement: "CON-1"
    verification:
      - kind: command
        ref: "node --test test/unit/live-attended-verdicts.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Whether the host's permission engine admits a redirect through a prefix rule such as ls:* is not established"
    verification: []
    human_judgment: true
    rationale: "Needs a live paid session; none was run (plan scope). Recorded as open in LIVE-CASES.md."

duration: 45min
completed: 2026-11-08
status: complete
---

# Phase 2 Plan 31: Harness and evidence hygiene Summary

**The live recorders now write the home directory as `~`, the attended cleanup refuses to delete anything outside its own fixture after checking real paths, and the attended allow list no longer admits a write through `cat`, `head` or the git read commands.**

## Performance

- **Duration:** about 45 min (the full suite took 7.6 min of it)
- **Completed:** 2026-11-08T03:00Z
- **Tasks:** 3
- **Files modified:** 11 (including the two RED evidence files and one new test file)

## Accomplishments

- R-IN-01 (narrow) fixed. `redactHome` in `test/helpers/live-harness.ts`; `appendAttendedResult`, the `record` of `live-run.test.ts` and the `record` of `live-onboarding.test.ts` write the serialized line through it. Four lines were rewritten (one in each of the three jsonl files, one in LIVE-CASES.md). Each jsonl line parses to the same record as before once paths are redacted on both sides (13, 52 and 23 lines compared), so verdicts, cases and costs are unchanged.
- R-WR-09 fixed. `cleanupAttended` resolves each target's real path and, before the first removal, requires: a profile directory is a direct child of one of the three default AVARICE parents under the real home and is named with the fixture's own tag (new `tag` field, set in `prepareAttendedFixture`); a created parent is one of those three parents; the evidence directory lies strictly inside the real temporary directory. Otherwise it throws naming the path and the rule, and nothing is deleted. A missing path is skipped. It removes the real path it checked.
- R-WR-08 fixed. The Bash allow rules are `avarice status:*`, `avarice context:*`, `ls:*`, the exact `git status` and `git log --oneline`, and the existing `npm test` rules. `cat`, `head`, `git diff`, `git show` and the `git log` prefix rule are gone.
- LIVE-CASES.md names the earlier allow list the recorded G-02-9 sessions ran under (verdicts stand, not re-run) and records the redirect question as open.

## Task Commits

1. **Task 1: Tracer, recorders write `~` (R-IN-01 recorders)**
   - RED `f5f78f8` (test): redaction and recorder cases
   - GREEN `8807d4a` (feat): `redactHome` and the three recorders
2. **Task 2: cleanup containment (R-WR-09) and the narrowed allow list (R-WR-08)**
   - RED `238b0f1` (test): forged-fixture and allow-list cases
   - GREEN `b4f7a64` (feat): real-path checks, narrowed list, LIVE-CASES.md notes
3. **Task 3: evidence files** - `f148e3d` (fix)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Both TDD tasks have a `test(02-31)` commit before the `feat(02-31)` commit. No refactor commits. Task 3 is not TDD.

- **RED, Task 1** (`02-31-red-evidence-task1.json`): `node --test --test-reporter=tap test/unit/live-harness-hygiene.test.ts` on the base. 6 tests, 2 pass (the negative cases), 4 fail on the planned assertion (`expected ~/.local/bin/claude`, actual the absolute path). `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK`. The test file reaches `redactHome` through a stand-in so its absence fails an assertion and not the import; the named import replaced the stand-in at GREEN.
- **RED, Task 2** (`02-31-red-evidence-task2.json`): 18 tests, 9 fail. Five of the seven cleanup failures are `Missing expected exception.` at base (the directory was removed and nothing thrown). Two (wrong tag, bad created parent) and the full-removal case fail before the intended check because the base removes created parents with `rmSync(parent, { recursive: false })`, which raises EISDIR for any directory; that is a second real defect at base, fixed at GREEN with `rmdirSync`. The classifier rejected the full TAP report (`invalid_record`: blank lines inside the SystemError messages break the TAP YAML blocks), so a rerun limited with `--test-name-pattern` to five single-line failures returned `RED_EVIDENCE_OK` for the first target. The evidence file records this.

## Files Created/Modified

- `test/helpers/live-harness.ts` - `redactHome`
- `test/helpers/live-attended.ts` - `AttendedFixture.tag`, `DEFAULT_PARENTS`, `cleanupAttended` with checks and optional roots, narrowed `attendedSettings`, redacted `appendAttendedResult`, a comment on the judge's `READ_ONLY_BASH`
- `test/containment/live-run.test.ts`, `test/containment/live-onboarding.test.ts` - `record` through `redactHome`
- `test/unit/live-harness-hygiene.test.ts` - new, 18 offline tests
- `test/containment/LIVE-CASES.md` - one limits bullet for the allow list and the open question; the home path in the configuration check paragraph now `~`
- `test/containment/live-attended-phase2.jsonl`, `live-run-phase2.jsonl`, `live-run-phase2-admission.jsonl` - one line each rewritten

## Decisions Made

- `redactHome` matches wherever the next character cannot continue a path component, a little wider than the plan's slash, quote or end of text. The plan's behavior line (a sibling sharing the prefix is kept) holds, and a leak followed by a space (`cd <home> && ...`) or a JSON `\n` is caught too.
- `cleanupAttended(fixture, roots?)`: the plan's forged evidence-directory case used the real home itself. At the RED base that would have run `rmSync(recursive)` on the real home, because the base trusts the fixture. The roots argument lets the tests stand in two temp directories for the home and the temporary directory, so no test can touch the real home at any commit. Default behavior is unchanged: real home, real tmp.
- Created parents are removed only while empty (`rmdirSync`, ENOTEMPTY ignored): another session may have put a profile in a parent since this fixture created it.
- The judge's `READ_ONLY_BASH` list was left as it was in meaning. It decides which calls after a denial count as read-only for the recorded sessions, which ran under the earlier allow list; narrowing it would re-judge them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The forged evidence-directory test could not use the real home**
- **Found during:** Task 2 (RED)
- **Issue:** the plan's test ("use the home directory itself") would delete the real home at the RED base.
- **Fix:** injectable `{ home, tmp }` roots on `cleanupAttended`; all forged fixtures are temp paths. See Decisions Made.
- **Files modified:** test/helpers/live-attended.ts, test/unit/live-harness-hygiene.test.ts
- **Committed in:** `238b0f1`, `b4f7a64`

**2. [Rule 1 - Bug] Created parents were never removable**
- **Found during:** Task 2 (RED, the full-removal case)
- **Issue:** `rmSync(parent, { recursive: false, force: true })` raises EISDIR on any directory, so a parent the fixture created could not be removed (the live suites never hit it because no parent had to be created on the owner's machine).
- **Fix:** `rmdirSync` while empty.
- **Files modified:** test/helpers/live-attended.ts
- **Committed in:** `b4f7a64`

**3. [Rule 3 - Blocking] The plan's allow-list grep matched the judge's list**
- **Found during:** Task 2 (verify)
- **Issue:** `grep "'cat', 'head'" test/helpers/live-attended.ts` also matched `READ_ONLY_BASH`, an unrelated list, so the verify could not pass.
- **Fix:** commented the judge's list and wrote it one entry per line; its content is unchanged.
- **Files modified:** test/helpers/live-attended.ts
- **Committed in:** `b4f7a64`

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking), all in the harness. **Impact:** none on the recorded verdicts; no scope creep.

## Issues Encountered

None in the code under change. The known load-sensitive full-suite failures (SIGTERM case of claude-host.test.ts, fail-closed.test.ts WR-07 and FC-10, the ENOTEMPTY in run-start.test.ts) did not occur; the full suite was clean.

## Findings status (for plan 02-35)

| Finding | Status |
|---|---|
| R-WR-08 (allow list admits writes) | Fixed offline |
| R-WR-09 (cleanup trusts the fixture) | Fixed offline |
| R-IN-01 (home path in evidence), narrow | Fixed: recorders and four committed files |
| R-IN-01, wider residue | Deferred to the owner (public-release decision), not touched: 28 spike evidence files under `spikes/slice-0-wave-0/evidence`, 1 spike script (`spikes/2026-11-01-pre-slice-0/run.sh`), 1 proposal document (`docs/existing-tooling-assessment.md`), and 115 `.planning` files (counted before this SUMMARY was written) |
| Redirect question | Open: whether the host's permission engine admits a redirect through a prefix rule such as `ls:*` needs a live session; none was run; recorded in LIVE-CASES.md |

No digest of any of the four rewritten evidence files exists in `scripts`, `src`, `test` or `.planning` (the 02-21 authorization file digests the three briefs and sums `live-spend-phase2.jsonl`, neither of which changed), so all four were rewritten. No `docs/system` document needed a change: the files touched are test harness and evidence only.

## Verification Results

- `node --test test/unit/live-harness-hygiene.test.ts test/unit/live-attended-verdicts.test.ts`: 89 pass (18 new, 71 existing)
- `grep -c redactHome` on live-attended.ts, live-run.test.ts, live-onboarding.test.ts: 2, 2, 2
- `grep -n "Bash(cat\|'cat', 'head'" test/helpers/live-attended.ts` exits 1 (`allow-list-narrowed`)
- `grep -n realpathSync test/helpers/live-attended.ts` shows the checks inside `cleanupAttended`
- `grep -c "$HOME"` on the four evidence files: 0 each (`home-path-gone`); every jsonl line parses (`jsonl-valid`)
- `npx tsc -p .` clean
- `npm test` (full suite): 2585 tests, 2530 pass, 0 fail, 55 skipped (the skips predate this plan)
- No live session was started (`AVARICE_LIVE` unset throughout)

## Known Stubs

None.

## Threat Flags

None. T-02-109 (allow rules), T-02-110 (cleanup) and T-02-111 (home path in evidence) are mitigated and tested; the wider residue of T-02-111 is deferred to the owner as above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for the remaining plans of the round and the documentation pass (02-35). To carry into 02-35: the deferred R-IN-01 residue and its counts, the open redirect question, and the confirmation that this plan changed no `docs/system` document.

## Self-Check: PASSED

- Files exist: test/unit/live-harness-hygiene.test.ts, both red-evidence JSON files, this SUMMARY.
- Commits exist on the branch: f5f78f8, 8807d4a, 238b0f1, b4f7a64, f148e3d.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-08*
