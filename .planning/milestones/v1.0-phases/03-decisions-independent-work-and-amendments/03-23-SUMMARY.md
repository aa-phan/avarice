---
phase: 03-decisions-independent-work-and-amendments
plan: 23
subsystem: notifications
status: complete
tags: [digest, schedule, launchd, launchagent, plutil, launchctl, quiet-hours, d-23, d-24, aut-6]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the Notifier port, the delivery loop, notification rows and the profile notify reader (03-16); the notification row states and setNotificationState (03-12); notify-policy bannerText, inQuietHours and parseProfileNotify (03-07); refuseOutsideTerminal, ownsProfile and the `ancestry` seam pattern (03-15, 03-20)"
provides:
  - "`avarice digest`: one batched banner counting open decisions and review-ready runs, one `digest` notification row (run_id NULL) with its attempts, silence when nothing waits"
  - "`avarice schedule install | remove`: a user LaunchAgent `io.avarice.digest.<profile>` under ~/Library/LaunchAgents, no admin rights, bootstrapped and booted out with launchctl"
  - "runDigest() in src/app/digest.ts and deliverWithBackoff() exported from src/app/notify.ts"
  - "src/adapters/schedule/launchd.ts: DIGEST_LABEL_PREFIX, PLIST_MARKER, renderDigestPlist, LaunchdScheduler, SchedulerSeam"
  - "the ledger edge failed -> delivered, reachable only through setNotificationState"
  - "CommandExtras on the command-module contract and the MainOverrides.scheduler test seam, pinned by footprint.test.ts"
affects: [03-31, 03-33, 03-24, 03-25]

actuals:
  tokens: 42000
  tasks: 3
  commits: 6
plan_head_before: 7dc1ebc8b1be81fb51df927ce8b5a9fa22b85a42
plan_head_after: 4243ca59405e5908d67c7ac4173a01f6a5005017
commits: 6

tech-stack:
  added: []
  patterns:
    - "A digest is the catch-up for missed banners: a delivered digest marks the pending, held and failed rows it covers as delivered; an undelivered one leaves them alone"
    - "The LaunchAgent is a fixed template with validated, XML-escaped values, linted by plutil before the rename, and carries a marker line so install and remove only touch a file AVARICE wrote"
    - "A test seam that a command needs beyond AppDeps travels as CommandExtras from main() (the one reader of the override), never through composition"

key-files:
  created:
    - src/app/digest.ts
    - src/adapters/schedule/launchd.ts
    - src/cli/commands/digest.ts
    - src/cli/commands/schedule.ts
    - test/helpers/fake-launchctl.mjs
    - test/integration/digest.test.ts
    - test/integration/schedule.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-23-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-23-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-23-red-evidence-task3.json
  modified:
    - src/app/notify.ts
    - src/adapters/sqlite/ledger.ts
    - src/ports/ledger.ts
    - src/cli/args.ts
    - src/cli/main.ts
    - test/integration/notification-ledger.test.ts
    - test/unit/footprint.test.ts
    - test/unit/shell.test.ts

key-decisions:
  - "Orchestrator-resolved conflict with plan 03-12: `failed` stays final for the delivery of a single banner (recordNotificationAttempt still refuses a failed row), but setNotificationState gains the edge failed -> delivered, used only when a successful digest covers the row; every other edge is as 03-12 built it and the 03-12 notification-state tests gained a case for it"
  - "A digest covers a pending, held or failed row only when it is about something the digest counts: a `decisions` row with an open decision among its subjects, a `review` row for a run that still waits, any earlier `digest` row. A row about a decision no longer open and a `blocked-run` row are left alone"
  - "Each decision is counted once however many rows name it: the count is the number of open decisions in the inbox, not the number of rows"
  - "In quiet hours the digest creates one held `digest` row and later digests in the same hours reuse it; the first digest outside the hours delivers and marks it delivered"
  - "Destinations of a digest are the profile's destinations (a digest is about no one run, so no contract list applies)"
  - "A digest whose banner is not delivered after three attempts exits 70 with one stderr line, so launchd's last exit status shows it; held and nothing-to-say exit 0"
  - "The plist carries the three resolved profile roots (AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT, AVARICE_WORK_ROOT) so the scheduled digest reads the profile that installed it; no other variable, not even PATH, is carried"
  - "install bootouts an existing agent before replacing it, rolls a new file back when bootstrap fails, and remove treats launchctl bootout exit 3 and 113 (not loaded) as already unloaded but keeps the file on any other failure"
  - "The scheduler seam travels to the command as a fourth argument of run (CommandExtras), read once in main.ts, so composition and AppDeps stay free of it"

patterns-established:
  - "digest exit codes: 0 posted, held or nothing to say; 64 refusal or argument; 70 not delivered or ledger unreadable. schedule: 0, 3 refused (symlink, foreign file), 64 usage, refusal of who runs it, a value that is not allowed, 70 a tool failed"

requirements-completed: []

coverage:
  - id: D1
    description: "`avarice digest` posts one batched banner `1 decision waiting, 1 run ready for review. Run: avarice inbox` for an open decision and a review-ready run, records one digest notification (run_id NULL) delivered on the first attempt, works with no terminal, and posts nothing, prints nothing and writes no row when nothing waits; it refuses under AVARICE_RUN and any argument before the profile resolves"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/digest.test.ts#avarice digest posts one banner for an open decision and a review-ready run, and nothing when there is none (tracer; D-23, AUT-6)"
        status: pass
      - kind: integration
        ref: "test/integration/digest.test.ts#avarice digest with nothing to report"
        status: pass
      - kind: integration
        ref: "test/integration/digest.test.ts#avarice digest refuses inside a run"
        status: pass
    human_judgment: false
  - id: D2
    description: "A successful digest marks the held, failed and pending banners it covered delivered (each decision counted once), leaves a banner about a decision no longer open and a blocked-run banner alone, holds its own banner in quiet hours in one reused row, and with a failing osascript ends failed after three attempts at 0, 10 and 60 seconds while the covered rows and the decisions are untouched; the ledger moves failed -> delivered through setNotificationState only"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/digest.test.ts#the digest covers the banners that were held or failed (D-23, D-24; AUT-6)"
        status: pass
      - kind: integration
        ref: "test/integration/notification-ledger.test.ts#setNotificationState"
        status: pass
    human_judgment: false
  - id: D3
    description: "`schedule install` writes a user LaunchAgent from a fixed template (integer Hour and Minute from notify.digestTimes, absolute existing paths, the profile name), lints it with plutil, bootstraps it with `launchctl bootstrap gui/<uid>`, replaces it idempotently, and `schedule remove` boots it out and deletes only a marker-carrying file; symlinked directory or plist, a foreign plist, bad values and a failing launchctl or plutil write nothing or roll back; the terminal identity rule refuses a run, a pipe and a run's process tree"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/schedule.test.ts#renderDigestPlist (T-03-44)"
        status: pass
      - kind: integration
        ref: "test/integration/schedule.test.ts#schedule install (D-23; T-03-44, T-03-45)"
        status: pass
      - kind: integration
        ref: "test/integration/schedule.test.ts#schedule remove (D-23; T-03-45)"
        status: pass
      - kind: integration
        ref: "test/integration/schedule.test.ts#schedule refuses outside a person at a terminal (T-03-46, CS-11)"
        status: pass
      - kind: unit
        ref: "test/unit/footprint.test.ts#the scheduler seam stays out of production"
        status: pass
    human_judgment: false
  - id: D4
    description: "A1: the real launchd accepts StartCalendarInterval as an array of Hour and Minute dictionaries; a temporary test-only agent was bootstrapped into gui/<uid>, listed by `launchctl print` with its calendar intervals and the CLI entry, booted out and deleted"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "AVARICE_LAUNCHD=1 node --test --test-name-pattern=\"real launchd\" test/integration/schedule.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "That launchd actually fires `avarice digest` at 12:30 and 17:30 on the owner's machine, and that macOS shows the banner, is not asserted: the real test registers and removes an agent within a second and never waits for a calendar time"
    requirement: "AUT-6"
    verification: []
    human_judgment: true
    rationale: "Firing happens at wall-clock times and the banner depends on the owner's notification settings; the format launchd accepts is proven, the firing is launchd's own behavior."

duration: about 75min
completed: 2026-11-09
---

# Phase 3 Plan 23: Scheduled digest and LaunchAgent Summary

**`avarice digest` posts one batched banner for open decisions and review-ready runs (and marks the held and failed banners it covers delivered), and `avarice schedule install | remove` manages a no-admin user LaunchAgent that runs it at the profile's digest times, proven against the real launchd with a temporary label.**

## Performance

- **Duration:** about 75 min (start time was not recorded; estimated from the previous plan's last commit)
- **Completed:** 2026-11-09
- **Tasks:** 3 of 3
- **Commits:** 6 task commits (3 RED, 3 GREEN), plus the metadata commit
- **Files:** 10 created (including 3 RED records), 8 modified

## Accomplishments

- **Digest.** `runDigest` reads the inbox, counts the open decisions and the runs ready for review, creates one `digest` notification (run_id NULL, subjects the decision and run IDs) per profile destination and delivers it through `deliverWithBackoff` (the loop of plan 03-16, now exported): up to three attempts at 0, 10 and 60 seconds, each recorded. Nothing waiting means no row, no call and no output. The command refuses `AVARICE_RUN` and any argument before the profile resolves, needs no terminal (launchd runs it), prints one line when it posted, and exits 70 with one stderr line when the banner was not delivered.
- **Catch-up.** A delivered digest moves the `pending`, `held` and `failed` rows of open decisions, still-waiting review runs and earlier digests to `delivered`; its body counts each decision once however many rows name it. A row about a decision no longer open and a `blocked-run` row stay as they were. A failed delivery leaves every covered row and every decision untouched.
- **Quiet hours.** Inside them the digest posts nothing and holds one `digest` row; later digests in the same hours reuse it and the first one outside delivers and covers it.
- **LaunchAgent.** `renderDigestPlist` is a fixed template: label `io.avarice.digest.<profile>`, `ProgramArguments` the absolute Node binary, the one allowed node flag, the absolute CLI entry and `digest`, the three profile roots as `EnvironmentVariables`, integer Hour and Minute dictionaries, `StandardOutPath` and `StandardErrorPath` in `<dataRoot>/logs/digest.log`, and a marker line. `LaunchdScheduler.install` refuses a symlinked agents directory, plist or log directory and a plist without the marker, writes a temp file (`wx`, 0644), lints it with `plutil -lint`, renames it, and runs `launchctl bootstrap gui/<uid>`; a replace boots the old agent out first; a failed bootstrap removes a new file again. `remove` checks the marker first, runs `launchctl bootout gui/<uid>/<label>` (exit 3 and 113 mean not loaded) and deletes the file; a missing agent prints `not installed`, exit 0.
- **Seam.** The agents directory, launchctl and plutil paths, the uid and the program line are a `scheduler` override of `main()`, handed to the command as `CommandExtras`; `footprint.test.ts` pins that only `main.ts` reads it, `bin/avarice.ts` never names it, only `schedule.ts` constructs the writer, and the launchctl argv uses bootstrap and bootout only.

## A1 verdict (real launchd round trip)

`AVARICE_LAUNCHD=1 node --test --test-name-pattern="real launchd" test/integration/schedule.test.ts` passed: 1 test, 0 failures, 25 ms. With a test-only label `io.avarice.digest.test-<12 hex>` the test installed the agent into the real `~/Library/LaunchAgents` (mode 0644, plutil-linted, `launchctl bootstrap gui/501`), `launchctl print gui/501/<label>` exited 0 and showed the label, the registered calendar intervals and the CLI entry, `remove` booted it out and deleted the file, and `launchctl print` then failed. **A1 holds: launchd accepts `StartCalendarInterval` as an array of `Hour` and `Minute` dictionaries on this machine.** The environment of the temporary agent named temporary profile roots, and its two times were twelve hours ahead and 03:07, so nothing could fire during the second it was loaded.

Cleanup check, run after the test and again before this summary was written: `launchctl list | grep -i avarice` printed nothing (exit 1) and `ls ~/Library/LaunchAgents | grep -i avarice` printed nothing (exit 1). The test removes its agent in `after` as well, so a failing run cleans up too. No production schedule was installed.

## TDD gate

- **Task 1 (tracer):** target test "gives the fake osascript one call whose body counts the decision and the review" failed (7 of 8, all on exit codes, a missing osascript log and a missing row); `RED_EVIDENCE_OK`. RED `09d3bd9`, GREEN `e454173`. **Tracer gate:** the task's verify re-run passed end to end before expansion: "Tracer verified end-to-end - expanding".
- **Task 2:** target test "is a plist that plutil -lint accepts, with two StartCalendarInterval dictionaries holding integer Hour and Minute" failed with the render, install, remove, footprint and completion tests; `RED_EVIDENCE_OK`. The refusal tests that passed at RED passed because the stub refuses everything; they are regression guards. RED `f830373`, GREEN `0510e55`.
- **Task 3:** target test "marks the held and failed rows of open decisions and ready runs delivered, counts each decision once, and leaves the rest alone" failed (4 of 68, all row-state and call-count assertions); `RED_EVIDENCE_OK`. RED `341cdd2`, GREEN `4243ca5`.

## Task Commits

1. **Task 1: Tracer, `avarice digest`** - `09d3bd9` (test, RED), `e454173` (feat)
2. **Task 2: `schedule install` and `schedule remove`** - `f830373` (test, RED), `0510e55` (feat)
3. **Task 3: coverage of held and failed banners, quiet hours, real launchd** - `341cdd2` (test, RED), `4243ca5` (feat)

## Files Created/Modified

- `src/app/digest.ts` - `runDigest`; `src/app/notify.ts` - `deliverWithBackoff` exported (renamed from the private `deliverRows`)
- `src/adapters/schedule/launchd.ts` - the plist template, validation and `LaunchdScheduler`
- `src/cli/commands/digest.ts`, `src/cli/commands/schedule.ts` - the two commands; `src/cli/main.ts` - COMMANDS gains `digest` and `schedule`, the `scheduler` seam; `src/cli/args.ts` - `CommandExtras`
- `src/adapters/sqlite/ledger.ts`, `src/ports/ledger.ts` - the `failed -> delivered` edge and its contract text
- `test/integration/digest.test.ts`, `test/integration/schedule.test.ts`, `test/helpers/fake-launchctl.mjs`; `test/integration/notification-ledger.test.ts`, `test/unit/footprint.test.ts`, `test/unit/shell.test.ts` - tests and pins

## Decisions Made

See `key-decisions` in the frontmatter. The conflict the orchestrator resolved (`failed` final in 03-12 versus a digest that must mark failed rows delivered) is the first one; it closes the open question that the 03-12 and 03-16 summaries carried.

## Deviations from Plan

### Auto-fixed Issues

None needing a fix of earlier work.

### Plan wording and judgment calls

**1. Orchestrator-resolved edge `failed -> delivered`** (see key-decisions). The 03-12 notification-state test file gained one case for the new edge (and the refusal of every other move out of `failed`); no existing assertion changed, because none of them moved a failed row.

**2. Environment of the agent.** The plan says "only the AVARICE profile and root variables that are set". The command cannot see which variables the caller set, only the roots composition resolved, so the agent always carries the three resolved roots (harmless when they are the defaults, and it pins the scheduled digest to the profile that installed it). There is no profile-name variable in this code base; the label carries the profile name.

**3. Seam as a fourth argument.** `CommandModule.run` gained an optional `extras` argument (`CommandExtras`) so the scheduler seam reaches `schedule` without entering `AppDeps` or composition. The footprint pin is on `overrides.scheduler`, read once in `main.ts`.

**4. Digest exit 70 on an undelivered banner.** The plan fixes exit 0 only for the nothing-to-report case. A banner that failed three times exits 70 so launchd's last exit status shows it; the decisions stay in `inbox`.

**5. Pending rows are covered too.** The task text names pending, held and failed rows; a pending row that a live supervisor is delivering at that instant is the one race, handled by re-listing the coverable rows just before marking, so a row that moved meanwhile is skipped rather than failing the whole move.

**6. `docs/system/` not edited.** The directory exists in this checkout, but as in plans 03-07, 03-12 and 03-16 the surfaces are listed below for the phase's documentation plan (03-31).

**Total deviations:** 0 auto-fixed, 6 plan-wording or judgment calls. **Impact:** none on scope.

## Issues Encountered

None. No real banner was posted (tests use the fake osascript or a fake notifier) and nothing was registered with the real launchd except the one gated, self-removing test agent.

## Documentation surfaces

For plan 03-31 (and `docs/system/findings.md` entries for plan 03-33):

- **Commands:** `avarice digest` (no arguments; refuses `AVARICE_RUN`; no terminal needed; exit 0 posted, held or nothing to say, 64 refusal or argument, 70 not delivered or ledger unreadable) and `avarice schedule install | remove` (terminal identity rule: refuses `AVARICE_RUN`, a non-terminal stream and a run's process tree before the profile resolves; owner's own profile only; exit 0, 3 refusal that wrote nothing, 64 usage or bad value or who runs it, 70 a tool failed). `install` prints `digest schedule installed|replaced: <label> at <times>` and the log path; `remove` prints `removed` or `not installed`. COMMANDS grows from 12 to 14.
- **LaunchAgent:** `~/Library/LaunchAgents/io.avarice.digest.<profile>.plist`, mode 0644, written by temp file and rename; keys Label, ProgramArguments (node, optional `--disable-warning=<Name>`, entry, `digest`), EnvironmentVariables (`AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`), StartCalendarInterval (array of Hour and Minute integer dictionaries, at most 6), StandardOutPath and StandardErrorPath (`<dataRoot>/logs/digest.log`, directory created 0700); marker comment line; no RunAtLoad, no KeepAlive.
- **External tools:** `/bin/launchctl` (`bootstrap gui/<uid> <plist>`, `bootout gui/<uid>/<label>`; bootout exits 3 and 113 mean not loaded), `/usr/bin/plutil` (`-lint` before the rename); argv only, 10 s timeout, no detached child.
- **Profile keys read:** `notify.digestTimes` (install; an empty list is refused with exit 64), `notify.destinations`, `notify.quietHours`, `notify.local.osascriptPath` (digest, through the 03-16 reader).
- **Ledger:** notification rows of kind `digest` (run_id NULL, subjects the open decision IDs and waiting run IDs); the state machine gains `failed -> delivered` (setNotificationState only; recordNotificationAttempt still refuses a failed row). Events: the existing `notify.delivered` and `notify.failed` per attempt; no new event kind, no new table.
- **Behavior:** a delivered digest marks the pending, held and failed rows it covers delivered (decisions rows with an open subject, review rows for waiting runs, earlier digest rows); quiet hours hold one reused digest row; a digest never answers a decision.
- **Test surface:** `scheduler` override of `main()` (`agentsDir`, `launchctl`, `plutil`, `uid`, `nodePath`, `nodeArgs`, `entryPath`), `FAKE_LAUNCHCTL_LOG`, `FAKE_LAUNCHCTL_EXIT`, `FAKE_LAUNCHCTL_EXIT_BOOTOUT` for `test/helpers/fake-launchctl.mjs`, and `AVARICE_LAUNCHD=1` for the real round trip.
- **Coverage counts that move:** CLI commands +2, external systems +2 (launchctl, plutil), the notification state edges +1.

## Known Stubs

None. The RED-phase stubs were replaced in the GREEN commits.

## Threat Flags

None beyond the plan's register. T-03-44 (a LaunchAgent that runs an attacker-chosen program) is mitigated by the fixed template, existing absolute Node and entry paths, validated and escaped values, a whitelist of three environment names and one node flag, and the plutil lint before the rename; T-03-45 by the marker check, `lstat` and `O_NOFOLLOW` refusals, temp file plus rename and refusals that write nothing (tested for a symlinked directory, a symlinked plist, a foreign plist, a failing plutil and a failing bootstrap); T-03-46 by `refuseOutsideTerminal` in `usage()` and `ownsProfile`; T-03-SC: no package installs.

## Next Phase Readiness

The digest and the schedule are ready for plans 03-24 and later; the documentation plan 03-31 has the surfaces above. AUT-6 is also declared by plans that have no SUMMARY yet, so it is not marked complete here.

## Self-Check: PASSED

- The ten created files (four sources, the fake launchctl, two test files and three RED records) exist on disk.
- Commits `09d3bd9`, `e454173`, `f830373`, `0510e55`, `341cdd2` and `4243ca5` are on the branch; `git rev-list --count 7dc1ebc..HEAD` gives 6, matching `commits: 6`.
- The plan's verify commands: `node --test` over `digest.test.ts`, `schedule.test.ts`, `footprint.test.ts`, `shell.test.ts`, `run-notify.test.ts` and `notification-ledger.test.ts` passes 173 of 173; `npx tsc -p .` reports no error; `node scripts/check-boundaries.ts` is ok (95 files); `grep -nE "'load'|'unload'" src/adapters/schedule/launchd.ts` prints nothing; the gated real launchd test passes.
- The full `npm test` run passes 3308 of 3368 tests, 0 failures (60 skipped, the live, sandbox and launchd gated ones).
- After the real round trip and after the full run, `launchctl list | grep -i avarice` and `ls ~/Library/LaunchAgents | grep -i avarice` each printed nothing.
- Requirement AUT-6 was not marked complete: `requirements.ready-ids` reports 0 of 1 ready, because sibling plans that declare it have no SUMMARY yet.
