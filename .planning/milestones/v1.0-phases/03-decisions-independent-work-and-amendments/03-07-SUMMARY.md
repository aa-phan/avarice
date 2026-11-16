---
phase: 03-decisions-independent-work-and-amendments
plan: 07
subsystem: domain
status: complete
tags: [notifications, profile-config, quiet-hours, batching, backoff, banner-text, pure-domain]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: Result and the invalid() refusal shape in src/domain/result.ts, the contract notify lists in src/domain/run-contract.ts
provides:
  - src/domain/notify-policy.ts (ProfileNotify, NOTIFY_DEFAULTS, NOTIFY_LIMITS, KNOWN_DESTINATIONS, parseProfileNotify, effectiveDestinations, BannerKind, BannerInput, bannerText, inQuietHours, batchDue, BACKOFF_DELAYS_MS, nextAttemptAt, nextDigestAt)
affects: [03-16, 03-23, the documentation plan 03-31, the documentation plan 03-33]

actuals:
  tokens: 7400
  tasks: 2
  commits: 4
plan_head_before: 9849de5afb68f008d6c4c5af0a86d49e9b478dfe
plan_head_after: e6e10a931e1e9e7d5dd549c8de54cfbd02a3ec76
commits: 4

tech-stack:
  added: []
  patterns:
    - "Notification rules are pure functions over minutes of the local day and integer milliseconds from an injected clock; the notifier and digest callers own the clock and the terminal"
    - "A hand-edited profile config section is parsed key by key: a missing section or key takes its default, an unknown key or an invalid value is refused with its field path"
    - "Banner text takes counts, IDs and fixed words only; the part before the next command is shortened so the command always survives the 200 character cap"
    - "RED stubs export every planned name so tests fail on assertions, not on load"

key-files:
  created:
    - src/domain/notify-policy.ts
    - test/unit/notify-policy.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-07-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-07-red-evidence-task2.json
  modified: []

key-decisions:
  - "An unknown key under notify or notify.local is refused with its field path, so a typo such as quietHour cannot silently leave quiet hours off"
  - "Duplicate destinations and duplicate digest times are dropped at parse; digest times are stored sorted so nextDigestAt and the digest scheduler agree on order"
  - "quietHours accepts null as an explicit off in addition to a missing key"
  - "nextAttemptAt takes the number of attempts already made: 0 gives the first attempt at lastAttemptAt + 0, 3 or more gives null, and a count that is not a whole non-negative number gives null (no invented retry)"
  - "nextDigestAt returns the first digest time strictly after the given minute, and null when no digest time is set"
  - "Banner decision IDs are listed up to three, then +N more; IDs are capped at 64 characters each"

requirements-completed: [AUT-4, AUT-6]

coverage:
  - id: D1
    description: "parseProfileNotify returns the defaults (local, 12:30 and 17:30, quiet hours off, 10 minute window, /usr/bin/osascript) for a profile config without a notify section and for missing keys, and refuses each invalid value with its field path"
    requirement: "AUT-6"
    verification:
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#parseProfileNotify"
        status: pass
    human_judgment: false
  - id: D2
    description: "effectiveDestinations is the intersection of the contract list and the profile list: a contract chooses a subset and never adds a destination (T-03-12)"
    requirement: "AUT-6"
    verification:
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#effectiveDestinations"
        status: pass
    human_judgment: false
  - id: D3
    description: "inQuietHours is a half-open whole-minute range that wraps midnight (22:00 and 07:59 held, 08:00 released); batchDue is true from exactly the window length in integer milliseconds"
    requirement: "AUT-4"
    verification:
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#inQuietHours"
        status: pass
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#batchDue"
        status: pass
    human_judgment: false
  - id: D4
    description: "Backoff delays are 0, 10 and 60 seconds with no fourth in-process attempt; nextDigestAt finds the next digest minute or rolls to the next day"
    requirement: "AUT-6"
    verification:
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#retry backoff"
        status: pass
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#nextDigestAt"
        status: pass
    human_judgment: false
  - id: D5
    description: "bannerText builds title and body from AVARICE-owned words only, strips control characters and escape sequences, takes no issue or model text, and caps the body at 200 characters while keeping the next command; the module exports no function that returns or implies an answer"
    requirement: "AUT-4"
    verification:
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#bannerText"
        status: pass
      - kind: unit
        ref: "test/unit/notify-policy.test.ts#the module cannot answer a decision (AUT-4)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-09
---

# Phase 3 Plan 07: Notification policy Summary

**Pure notification policy: a profile notify section parsed with defaults and field-path refusals, the contract-subset rule, whole-minute quiet hours, an integer-millisecond batch window, 0/10/60 s backoff, next-digest lookup and banner text built from AVARICE words only**

## Performance

- **Duration:** about 12 min (start time was not recorded; estimated from commit times)
- **Completed:** 2026-11-09T01:23:00Z
- **Tasks:** 2
- **Files modified:** 2 source and test files, 2 RED evidence files

## Accomplishments

- `parseProfileNotify` reads the profile config as hand-edited JSON. A missing notify section or key gives the defaults; an unknown destination, a malformed digest time, more than 6 times, malformed or equal-ended quiet hours, a batch window outside 1 to 120 whole minutes, a relative or control-character osascript path, and any unknown key are each refused with their field path (`notify.destinations[0]`, `notify.digestTimes[1]`, `notify.quietHours`, `notify.batchWindowMinutes`, `notify.local.osascriptPath`).
- `effectiveDestinations` keeps only destinations the profile lists, in the contract's order, so a run cannot redirect a notification (T-03-12).
- `inQuietHours`, `batchDue`, `BACKOFF_DELAYS_MS`, `nextAttemptAt` and `nextDigestAt` are exact at every edge: 22:00 and 07:59 held and 08:00 released for 22:00-08:00; 599 999 ms not due and 600 000 ms due for a 10 minute window; no fourth in-process delivery attempt.
- `bannerText` returns title `AVARICE` and a body of counts, run ID, decision IDs and the next command, stripped of escape sequences, control and invisible format characters, and capped at 200 characters with the command kept. A test shows extra fields such as a decision question never reach the banner. A second test pins the module's export list so no function that approves or answers can be added unnoticed (AUT-4).

## Task Commits

1. **Task 1: Tracer, profile notify parse, destination subset, banner text** - `d0cff03` (test, RED with stubs), `8b1843c` (feat)
2. **Task 2: Quiet hours, batching window and backoff at their boundaries** - `b58346f` (test, RED with stubs), `e6e10a9` (feat)

**Tracer gate:** the Task 1 verify (unit tests, boundary check, plus `tsc -p .`) passed end to end before expansion: "Tracer verified end-to-end - expanding".

**Plan metadata:** recorded in the docs commit that follows this summary.

**RED entries:**
- Task 1: target test "words two open decisions with AVARICE-owned words" in `test/unit/notify-policy.test.ts`; classifier verdict `RED_EVIDENCE_OK` (52 of 54 tests failed against the stub). Semantic assessment: it fails on a deepEqual assertion over the stub's empty title and body, not on load, import or syntax; the stub exports every imported name. Evidence: `03-07-red-evidence-task1.json`.
- Task 2: target test "holds a banner at 22:00 and at 07:59 and releases it at 08:00 (overnight range)"; classifier verdict `RED_EVIDENCE_OK`. Semantic assessment: it fails on a strictEqual assertion (expected true at minute 1320, stub gave false); the stub exports every imported name. Evidence: `03-07-red-evidence-task2.json`.

## Files Created/Modified

- `src/domain/notify-policy.ts` - profile notify parser and defaults, destination subset rule, quiet hours, batch window, backoff, next-digest lookup and banner text; no imports beyond `result.ts`
- `test/unit/notify-policy.test.ts` - 70 tests with expected values written out independently of the module
- `.planning/phases/03-decisions-independent-work-and-amendments/03-07-red-evidence-task1.json` and `...task2.json` - RED evidence records

## Decisions Made

See `key-decisions` in the frontmatter. Flagged assumptions held as planned: the profile config stays hand-edited (this module only reads a parsed object, never writes), backoff is 0/10/60 s, D-24 holds every banner during quiet hours, and `notify.local.osascriptPath` is an added profile key.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Unknown notify keys are refused**
- **Found during:** Task 1
- **Issue:** The plan lists the invalid values to refuse but not unknown keys; a hand-edited file with a typo (`quietHour`) would parse as "quiet hours off" and silently send banners at night.
- **Fix:** `parseProfileNotify` refuses any key outside the five documented ones under `notify` and the one under `notify.local`, naming the field path.
- **Files modified:** `src/domain/notify-policy.ts`, `test/unit/notify-policy.test.ts`
- **Committed in:** `8b1843c`

**2. [Rule 2 - Missing Critical] `nextDigestAt` returns null for an empty digest list**
- **Found during:** Task 2
- **Issue:** The planned return type `{ minute, nextDay }` has no answer when no digest time is set (a profile may set `digestTimes: []`).
- **Fix:** The return type is `{ minute; nextDay } | null`; null means no digest is scheduled.
- **Files modified:** `src/domain/notify-policy.ts`, `test/unit/notify-policy.test.ts`
- **Committed in:** `e6e10a9`

**3. [Rule 2 - Missing Critical] Bounded banner and id text**
- **Found during:** Task 1
- **Issue:** The plan caps the body at 200 characters; a plain cut would remove the next command from the banner when a long run ID or ID list is given.
- **Fix:** IDs are capped at 64 characters, at most three decision IDs are listed, and the part before the command is shortened so the command survives. Limits are exported as `NOTIFY_LIMITS`.
- **Committed in:** `8b1843c`

---

**Total deviations:** 3 auto-fixed (3 missing critical)
**Impact on plan:** All three tighten the planned behavior; no scope creep and no change to the plan's listed behaviors.

## Issues Encountered

None. Note for the record: the pre-commit agent-branch allow-list is not applicable here; this sequential executor committed on the phase branch `worktree-phase-03` (not a protected branch), as the dispatch specified.

## User Setup Required

None - no external service configuration required.

## Documentation surfaces

For the documentation plan (03-31), and the findings entry for plan 03-33:

- **Profile config keys** (hand-edited `<configHome>/profiles/<profile>/config.json`, `notify` section, all optional): `notify.destinations` (list, only `local` is known, default `["local"]`), `notify.digestTimes` (up to 6 `HH:MM` times, stored sorted, default `["12:30", "17:30"]`), `notify.quietHours` (`HH:MM-HH:MM` with different ends, or null, default off), `notify.batchWindowMinutes` (whole number 1 to 120, default 10), `notify.local.osascriptPath` (absolute path, no control characters, default `/usr/bin/osascript`). An unknown key under `notify` or `notify.local` is refused.
- **Timing rules:** quiet hours and digest times compare whole minutes of local time; the quiet range is half-open `[start, end)` and wraps midnight; the batch window is measured in integer milliseconds from the injected clock; delivery is attempted at 0 s, 10 s and 60 s inside the raising process and then left `failed` for the next digest.
- **Subset rule (D-21):** the effective destinations are the contract's `notify` list intersected with the profile's destinations.
- **Banner text:** title `AVARICE`; body holds counts, run ID, up to three decision IDs and the next command (`avarice inbox`, or `avarice status` for a blocked run), at most 200 characters; no decision issue or model text.
- **Finding for `docs/system/findings.md` (plan 03-33):** the autonomy document says quiet hours hold everything except blocking notifications; D-24 holds every banner during quiet hours.

## Known Stubs

None. The RED-phase stubs were replaced in the GREEN commits.

## Threat Flags

None. The module has no I/O, network, file or process access; T-03-12 is mitigated by `effectiveDestinations` and the parser's refusal of unknown destinations.

## Next Phase Readiness

- Plan 03-16 (notifier app service and local adapter) and plan 03-23 (digest) can call every function here; the clock, the timezone conversion to minutes of the local day, the osascript call and the profile file read stay with those plans.

## Self-Check: PASSED

- `src/domain/notify-policy.ts`, `test/unit/notify-policy.test.ts` and both RED evidence files exist.
- Commits `d0cff03`, `8b1843c`, `b58346f` and `e6e10a9` are ancestors of HEAD.
- `node --test test/unit/notify-policy.test.ts` passes 70 of 70; the full unit suite passes 1628 of 1628; `npx tsc -p .` reports no error; `node scripts/check-boundaries.ts` is ok; `grep "from '../cli" src/domain/notify-policy.ts` prints nothing.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09*
