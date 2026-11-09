---
phase: 03-decisions-independent-work-and-amendments
plan: 16
subsystem: notifications
status: complete
tags: [notifier-port, osascript, banner, backoff, quiet-hours, batching, profile-config]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: src/domain/notify-policy.ts (plan 03-07), notification ledger rows and events (plan 03-12)
provides:
  - src/ports/notifier.ts (Notifier, NotifierMessage)
  - src/adapters/notify/local-notifier.ts (LocalNotifier, osascriptArgs, error codes osascript-missing, osascript-failed, osascript-timeout)
  - src/adapters/fs/profile-config.ts (readProfileNotify)
  - src/app/notify.ts (notifyRunStop, queueDecisionNotice, flushDueNotifications, failureCode)
  - NotifyDeps and AppDeps.notify, DepsOverrides.notifier, and the supervise command raising a banner when a run stops
affects: [03-18, 03-21, 03-23, the documentation plan 03-31, the documentation plan 03-33]

actuals:
  tokens: 13000
  tasks: 3
  commits: 6
plan_head_before: 1ab2840f6310f22a233bd95c7ac5c5e5cb080614
plan_head_after: 9ab1eafc42738cfc3b8f5608967d01457290ee92
commits: 6

tech-stack:
  added: []
  patterns:
    - "A notification is rows in the ledger first and a banner second: the inbox and status never depend on the banner arriving"
    - "Banner text is passed to osascript as arguments after `--` under a fixed three-line script, never interpolated"
    - "Everything that touches the outside (notifier, settings file, sleep, minute of the day) is injected through NotifyDeps, so tests drive backoff and quiet hours with no real time"
    - "A test entry never posts a real banner: test-cli installs a silent notifier unless AVARICE_TEST_NOTIFIER=local"

key-files:
  created:
    - src/ports/notifier.ts
    - src/adapters/notify/local-notifier.ts
    - src/adapters/fs/profile-config.ts
    - src/app/notify.ts
    - test/helpers/fake-osascript.mjs
    - test/integration/notifier.test.ts
    - test/integration/run-notify.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-16-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-16-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-16-red-evidence-task3.json
  modified:
    - src/app/deps.ts
    - src/cli/composition.ts
    - src/cli/commands/supervise.ts
    - test/helpers/test-cli.ts

key-decisions:
  - "The banner for open decisions carries the run ID and a count, not the decision IDs: the plan's behavior line fixes the body as `<runId>: 1 decision waiting. Run: avarice inbox`, so bannerText is called with a count only"
  - "A delivered or failed attempt is recorded on every row that the banner covers, so queued and stop rows of one banner always agree on attempts and state"
  - "A notifier that throws or rejects is a failed delivery with the generic code notifier-error; no error text reaches the ledger or an event"
  - "readProfileNotify opens the config with O_NOFOLLOW and reads at most 64 KiB from the open descriptor; a symlink, a non-regular file, an oversized file and invalid JSON are `invalid`, a missing file gives the defaults, any other read error is `unavailable`"
  - "notifyRunStop merges queued pending decision rows of the run into its one banner and creates a stop row only for open decisions no queued row covers"
  - "supervise prints one stderr line when notifyRunStop returns an error (for example an invalid notify section) and still returns the run's own exit code"

requirements-completed: []

coverage:
  - id: D1
    description: "A run that stops blocked_on_decision raises one banner through the Notifier port and the osascript adapter: one decisions notification for the local destination with the decision as subject, delivered on the first attempt, one notify.delivered event, and the fake osascript receives the fixed -e lines, `--`, the body and the title as separate arguments; the decision stays in `inbox`"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/run-notify.test.ts#a run that stops blocked_on_decision raises one banner (tracer; AUT-6, SC2)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failing notifier is retried at 0, 10 and 60 seconds, each attempt recorded with an error code, the row ends failed with three attempts, and the decision row, the work items and `inbox` are unchanged; a throwing notifier is a notifier-error failure"
    requirement: "AUT-4"
    verification:
      - kind: integration
        ref: "test/integration/run-notify.test.ts#delivery follows the profile (D-21, D-22, D-24; AUT-4, AUT-6)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Destinations are the intersection of the contract notify list and the profile's destinations; during quiet hours no banner is posted and the row is held; ready_for_review raises a review banner and a block for another reason a blocked-run banner"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/run-notify.test.ts#delivery follows the profile (D-21, D-22, D-24; AUT-4, AUT-6)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The osascript call is injection-safe (three fixed -e lines, text only after `--`, a hostile body recorded byte for byte as one argument), maps a missing path, a failing script and a timeout to osascript-missing, osascript-failed and osascript-timeout, and starts no detached child"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/notifier.test.ts#osascriptArgs (T-03-29), #LocalNotifier"
        status: pass
      - kind: unit
        ref: "test/unit/footprint.test.ts#no source file reaches the network or starts a background process"
        status: pass
    human_judgment: false
  - id: D5
    description: "Decision notices can be queued without delivery and flushed as one banner after the batch window (held in quiet hours); a blocked run's banner absorbs queued rows; the profile config reader refuses a symlink, an oversized file and an invalid digest time with the field path; banner text holds no decision text"
    requirement: "AUT-6"
    verification:
      - kind: integration
        ref: "test/integration/run-notify.test.ts#batched decision notices (D-24), #readProfileNotify (D-21)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Whether the real /usr/bin/osascript shows a banner on the owner's macOS (Focus modes, notification permission for the terminal) is not asserted by any test, because tests never post a real banner"
    requirement: "AUT-6"
    verification: []
    human_judgment: true
    rationale: "The adapter is proven against a fake script that records its arguments; the owner's notification settings decide whether the real banner is seen."

duration: 11min
completed: 2026-11-09
---

# Phase 3 Plan 16: Local notification of a stopped run Summary

**A Notifier port with an osascript adapter whose banner text is argv-only, and a notification service that records every notification and attempt in the ledger, retries at 0/10/60 s, holds banners in quiet hours, batches decision notices and never writes a decision; `supervise` raises it when a run stops blocked or ready for review.**

## Performance

- **Duration:** about 11 min (start time was not recorded; estimated from the previous plan's last commit)
- **Completed:** 2026-11-09
- **Tasks:** 3 of 3
- **Commits:** 6 task commits (3 RED, 3 GREEN), plus the metadata commit
- **Files:** 10 created (including 3 RED records), 4 modified

## Accomplishments

- **Port and adapter.** `Notifier` takes a title and a body and returns a `Result`; `LocalNotifier` runs `osascript` once with `['-e','on run argv','-e','display notification (item 1 of argv) with title (item 2 of argv)','-e','end run','--', body, title]`, a 10 s timeout and no detached child. A missing path is `osascript-missing`, a non-zero exit or a non-executable file `osascript-failed`, a killed call `osascript-timeout`. A hostile body (`x" & (do shell script "echo pwned") & "`) reaches the fake script byte for byte as one argument.
- **Service.** `notifyRunStop(deps, runId, { state, reason })` builds the notice from the contract's `notify` list and the run's open decisions, intersects the destinations with the profile's, creates the row and delivers. Up to three attempts follow the injected `sleep` at 0, 10 and 60 s; each attempt is recorded on the row with a short code (`notify.delivered` or `notify.failed`), and after the third failure the row is `failed`. In quiet hours the row is created `held` and nothing is posted. `ready_for_review` raises a `review` banner, a block for a reason other than `decision` a `blocked-run` banner.
- **Batching.** `queueDecisionNotice` records a pending row per decision with no delivery (and no second row for the same decision). `flushDueNotifications` delivers one banner counting the decisions still open once the window has passed from the oldest pending row, holds the rows in quiet hours, and does nothing before the window. `notifyRunStop` folds the run's queued rows into its single banner.
- **Config.** `readProfileNotify` reads the profile config's `notify` section through `parseProfileNotify`: defaults when the file or the section is missing, the field path of an invalid value, and refusal of a symlink, a non-regular file or a file over 64 KiB.
- **Wiring.** `AppDeps.notify` is composed for every command that is not read-only; `supervise` calls `notifyRunStop` after a stop state and ignores the result for its exit code (a settings error is said once on stderr). `DepsOverrides.notifier` replaces the adapter; `test/helpers/test-cli.ts` installs a silent notifier unless `AVARICE_TEST_NOTIFIER=local`, so no existing test can post a banner.
- **Decisions untouched.** The failing-notifier test compares the whole `decisions` and `work_items` tables as JSON before and after the three attempts and finds them identical; the decision stays open in `inbox`.

## TDD gate

- **Task 1 (tracer):** target test "records one decisions notification for the local destination with the decision as subject, delivered on the first attempt" failed (3 of 4 tests) against the stubs; classifier `RED_EVIDENCE_OK` (`03-16-red-evidence-task1.json`). Semantic assessment: assertion failures (a timed-out wait that calls `assert.fail`, a missing log file), not load or syntax errors; the run itself reached `blocked_on_decision`. RED `149244a`, GREEN `637676d`. **Tracer gate:** the task's verify re-run passed end to end before expansion: "Tracer verified end-to-end - expanding".
- **Task 2:** target test "retries a failing notifier at 0, 10 and 60 seconds ..." failed (5 of 17); `RED_EVIDENCE_OK`. Failures are assertions on call counts, delays, row state and an unrefused file. RED `d422547`, GREEN `01ad5d5`.
- **Task 3:** target test "flushes nothing before the batch window has passed, then one banner ..." failed (8 of 32, all batching tests); `RED_EVIDENCE_OK`. The 7 adapter tests passed at RED because the adapter shipped in Task 1; they are regression guards. RED `5ab104a`, GREEN `9ab1eaf`.

## Task Commits

1. **Task 1: Tracer, a blocked run raises one banner through the port and the adapter** - `149244a` (test, RED), `637676d` (feat)
2. **Task 2: Profile settings, quiet hours, destination subset, retries** - `d422547` (test, RED), `01ad5d5` (feat)
3. **Task 3: Injection-safe argv, batching API, adapter codes** - `5ab104a` (test, RED), `9ab1eaf` (feat)

## Files Created/Modified

- `src/ports/notifier.ts` - the port; `src/adapters/notify/local-notifier.ts` - the osascript adapter
- `src/adapters/fs/profile-config.ts` - `readProfileNotify`; `src/app/notify.ts` - the service
- `src/app/deps.ts` - `NotifyDeps`, `AppDeps.notify`; `src/cli/composition.ts` - composes it, `DepsOverrides.notifier`; `src/cli/commands/supervise.ts` - calls `notifyRunStop`
- `test/helpers/fake-osascript.mjs` (executable) and `test/helpers/test-cli.ts` (silent notifier by default)
- `test/integration/run-notify.test.ts` (the CLI tracer, 17 in-process tests) and `test/integration/notifier.test.ts` (7 adapter tests)

## Decisions Made

See `key-decisions` in the frontmatter. The flagged assumptions held: AUT-6 stays `unclassified` and is covered by the delivery, failure and destination tests above; the supervisor stays up at most three attempts (about 70 s) after it released the lease; the AppleScript injection concern is mitigated by argv-only text and not minted as a prohibition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] A notifier that throws is a failed delivery**
- **Found during:** Task 2
- **Issue:** the port returns a `Result`, but a rejecting notifier would have escaped `notifyRunStop`, skipped the ledger record and left a row `pending` forever.
- **Fix:** `safeDeliver` turns a throw into the generic code `notifier-error`, and no error text is stored.
- **Files modified:** `src/app/notify.ts`; **Commit:** `01ad5d5`

**2. [Rule 2 - Missing Critical] The config is opened without following a symlink**
- **Found during:** Task 2
- **Issue:** the plan names `lstat` then read, which leaves a window between the check and the read.
- **Fix:** `readProfileNotify` opens with `O_NOFOLLOW` and checks `fstat` on the open descriptor (regular file, at most 64 KiB) before reading from it.
- **Files modified:** `src/adapters/fs/profile-config.ts`; **Commit:** `01ad5d5`

### Plan wording and judgment calls

**3. Minimal reader in Task 1.** The tracer points the adapter at the fake script through the profile config, so a first `readProfileNotify` (read and parse) arrived with Task 1 instead of Task 2; Task 2 added the symlink and size refusals. The plan said "defaults in this task".

**4. Batching tests live in `run-notify.test.ts`,** which Task 3's file list does not name, because they use the in-process bench built for Task 2; the Task 3 verify runs both files.

**5. Banner for open decisions has a count and no IDs,** following the plan's behavior line for the tracer body (see key-decisions).

**6. No adapter row recorded.** Other adapters call `upsertAdapterConfig` at composition; the notifier does not, so `adapter_configs` is unchanged and no existing row-count test moves.

**7. `docs/system/` not edited.** The directory exists in this checkout, but, as in plans 03-07 and 03-12, the surfaces are listed below for the phase's documentation plan (03-31).

**Total deviations:** 2 Rule 2, 5 plan-wording or judgment calls. **Impact:** none on scope.

## Issues Encountered

None. No real banner was posted: tests use the fake script or a fake notifier, and the test CLI entry installs a silent notifier by default.

## Documentation surfaces

For plan 03-31 (and the `docs/system/findings.md` entries for plan 03-33):

- **Port:** `Notifier { descriptor; deliver(message: { title, body }): Promise<Result<void>> }`; a failed delivery is an `unavailable` error whose `cause` starts with a short code.
- **Adapter and external tool:** `LocalNotifier` runs `/usr/bin/osascript` (or `notify.local.osascriptPath`) with a fixed three-line script and `--`, then body, then title; 10 s timeout; codes `osascript-missing`, `osascript-failed`, `osascript-timeout`; a notifier that throws is recorded as `notifier-error`.
- **Profile keys read** (`<configHome>/profiles/<profile>/config.json`, `notify` section; file opened without following a symlink, at most 64 KiB): `destinations`, `digestTimes`, `quietHours`, `batchWindowMinutes`, `local.osascriptPath`.
- **Contract keys read:** `notify.reviewReady` (ready_for_review), `notify.blocking` (blocked_on_decision, blocked-run, queued decision notices); `notify.digest` is for plan 03-23.
- **Events:** `notify.delivered { notificationId, runId, attempt }`, `notify.failed { notificationId, runId, attempt, code }`, one per attempt, from the existing ledger methods.
- **Row states and kinds:** `pending`, `held`, `delivered`, `failed`; kinds `decisions`, `review`, `blocked-run`. A failed in-process attempt keeps the row's state with `next_attempt_at` set; after the third attempt the row is `failed`. A banner in quiet hours leaves the row `held`.
- **Behavior:** `supervise` raises the banner after `runSupervisor` returns a blocked_on_decision or ready_for_review stop; the exit code does not depend on it; the process stays up for at most three attempts (0, 10, 60 s after the lease is released). Banner text: title `AVARICE`, body `<runId>: N decision(s) waiting. Run: avarice inbox`, `<runId>: ready for review. Run: avarice inbox`, or `<runId>: blocked. Run: avarice status`.
- **For plans 03-18 and 03-23:** call `queueDecisionNotice` when a decision opens during a run and `flushDueNotifications` at item boundaries (03-18); held and failed rows are the digest's input (03-23; the `failed -> delivered` edge noted in the 03-12 summary still needs an owner decision).
- **Test surface:** `AVARICE_TEST_NOTIFIER=local` makes the test CLI use the real adapter; `FAKE_OSASCRIPT_LOG`, `FAKE_OSASCRIPT_EXIT` and `FAKE_OSASCRIPT_SLEEP_MS` steer `test/helpers/fake-osascript.mjs`.

## Known Stubs

None. The RED-phase stubs were replaced in the GREEN commits.

## Threat Flags

None beyond the plan's register. T-03-29 (AppleScript injection) is mitigated by the fixed script and the hostile-body test; T-03-30 (text on the lock screen) by `bannerText` taking counts and IDs only, with a test that issue and option text never reach a banner; T-03-31 (a failed delivery hidden or read as approval) by recording every attempt with a code and the byte-identical decision test; T-03-SC: no package installs.

## Next Phase Readiness

Plans 03-18 (batching calls at item boundaries) and 03-23 (digest) can call `queueDecisionNotice`, `flushDueNotifications` and the held and failed rows; the digest decision on `failed -> delivered` from the 03-12 summary is still open.

## Self-Check: PASSED

- The four source files, the fake osascript helper, both test files and the three RED records exist.
- Commits `149244a`, `637676d`, `d422547`, `01ad5d5`, `5ab104a` and `9ab1eaf` are on the branch; `git rev-list --count` from the plan head gives 6, matching `commits: 6`.
- `node --test` over `notifier.test.ts`, `run-notify.test.ts`, `notify-policy.test.ts` and `footprint.test.ts` passes 120 of 120; `npx tsc -p .` reports no error; `node scripts/check-boundaries.ts` is ok; the grep for `detached: true` or `.unref(` in `local-notifier.ts` prints nothing.
- The full `npm test` run passes 3076 of 3136 tests, 0 failures (60 skipped, the live and sandbox-gated ones).
- Requirements AUT-4 and AUT-6 were not marked complete: `requirements.ready-ids` reports both blocked by sibling plans that declare them and have no SUMMARY yet.
