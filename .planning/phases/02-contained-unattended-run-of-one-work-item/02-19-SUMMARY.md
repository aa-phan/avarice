---
phase: 02-contained-unattended-run-of-one-work-item
plan: 19
subsystem: cli-shell
tags: [interactive-shell, fr-27, ops-7, adr-013, nfr-1, raw-mode, pty, supervisor-survival, history]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-15 run read models and the shared render functions (stripControl, resultLine, renderTable, runStateWord), 02-17 resume and the detached supervisor spawn of start and resume"
provides:
  - "src/cli/shell/: runShell (the session engine over raw keys or whole lines), renderHome and renderWatch, LineEditor with completeCommand, loadHistory and appendHistory, SHELL_ACTIONS"
  - "main(): the no-argument branch opens the shell only when stdin and stdout are terminals and AVARICE_RUN is unset; MainOverrides.stdin and .stdout; ShellInput and ShellOutput types"
  - "Ledger.listRunEvents(runId, limit): the latest events of a run, read-only, oldest first"
  - "{dataRoot}/shell-history: 0600, one entry per command-line run, capped at 1000 lines"
  - "Tests: test/unit/shell.test.ts (37 cases plus completion and history), test/integration/shell-supervisor.test.ts, test/integration/shell-tty.test.ts; helpers shell-streams.ts, pty-drive.py, FakeRunOptions.delayMs"
affects: [02-20, 02-21, 02-22, phase-3-decide]

actuals:
  tokens: 31000
  tasks: 3
  commits: 3
plan_head_before: a3d388db6fd0a9f4180a16d125055ef56c403ae1
plan_head_after: 36f016ae8b509a45b55ae1e2efb25315641af0a1
commits: 3

tech-stack:
  added: []
  patterns:
    - "One Consumer interface (key, line) behind both input modes: the menu, the prompts and the live views are written once; TERM=dumb feeds whole lines, a terminal feeds key presses"
    - "Type-ahead is queued while an action works and replayed to the next consumer, so no key is dropped between two prompts or during a command"
    - "The shell holds no ledger connection: every view and every poll opens the store read-only, reads and closes it (ADR-013 decision 3)"
    - "Actions run commands through main() with a captured Io; a dispatch seam (ShellOptions.dispatch) lets tests assert what ran without loading command modules"

key-files:
  created:
    - src/cli/shell/shell.ts
    - src/cli/shell/home-view.ts
    - src/cli/shell/line-editor.ts
    - src/cli/shell/history.ts
    - src/cli/shell/actions.ts
    - test/unit/shell.test.ts
    - test/integration/shell-supervisor.test.ts
    - test/integration/shell-tty.test.ts
    - test/helpers/shell-streams.ts
    - test/helpers/pty-drive.py
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-19-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-19-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-19-red-evidence-task3.json
  modified:
    - src/cli/main.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - test/unit/cli-args.test.ts
    - test/helpers/fake-run-host.ts

key-decisions:
  - "The shell is two input modes over one session engine: raw key presses on a terminal with a usable TERM (alternate screen, full redraw from the home position, redraw on resize), whole lines with no ESC character when TERM is dumb"
  - "Watch reads the events through a new read-only Ledger.listRunEvents (the Ledger port had no event read); it is the only port addition of the plan"
  - "A paused run (supervisor gone, lease lapsed) is watched on, not ended: only a stop state ends the watch by itself, because the run may be resumed from another terminal"
  - "Completion cannot turn `sta` into `status ` as the plan text says, since `start` shares the prefix; `stat` completes to `status `, `sta` extends to the common prefix and lists start and status"
  - "Output of every action passes through stripControl once, at the point it enters the output pane, so command output, JSON and recorded strings cannot rewrite the terminal"
  - "`supervise` stays in the command-line grammar (the plan says completion comes from COMMANDS); typed there it runs in the foreground like the one-shot form"

requirements-completed: [FR-27, OPS-7, NFR-1]

coverage:
  - id: D1
    description: "Bare `avarice` opens the interactive shell only when stdin and stdout are both terminals and AVARICE_RUN is unset; every other case (stdin only, stdout only, neither, AVARICE_RUN set) prints usage on stderr and exits 64; `avarice <command>` and `--help` stay one-shot; runShell refuses under AVARICE_RUN itself"
    requirement: "FR-27"
    verification:
      - kind: unit
        ref: "test/unit/shell.test.ts#bare `avarice` opens the shell only in a terminal outside a run (FR-27, ADR-013 decision 1)"
        status: pass
      - kind: unit
        ref: "test/unit/cli-args.test.ts#avarice with no arguments (FR-27, ADR-013 decision 1)"
        status: pass
      - kind: integration
        ref: "test/integration/shell-tty.test.ts#the same entry without a pseudo-terminal"
        status: pass
    human_judgment: false
  - id: D2
    description: "Home view (result line, store health, runs and onboardings with state, last checkpoint and spend against budget, open decision count), the numbered action menu with arrows, the command line in the one-shot grammar running in-process, NO_COLOR, TERM=dumb line mode with no ESC, redraw on resize, a ledger read failure shown as store: unavailable with the shell left open"
    requirement: "FR-27"
    verification:
      - kind: unit
        ref: "test/unit/shell.test.ts#the command line, #TERM=dumb, #NO_COLOR and resize, #a ledger that cannot be opened, #renderHome, #the action menu"
        status: pass
    human_judgment: false
  - id: D3
    description: "Start, watch and resume a run from the shell; the work runs in the detached supervisor, which is alive after the shell exits and takes the run to ready_for_review on both the start and the resume path; no TCPServerWrap or PipeServerWrap at any time; watch polls about once a second, ends at a stop state or q, and leaves no timer"
    requirement: "FR-27"
    verification:
      - kind: integration
        ref: "test/integration/shell-supervisor.test.ts#a run started from the shell keeps going after the shell exits (SC 6, T-02-64)"
        status: pass
      - kind: integration
        ref: "test/integration/shell-supervisor.test.ts#a killed run is resumed from the shell and keeps going after the shell exits (FR-7, SC 6)"
        status: pass
      - kind: unit
        ref: "test/unit/shell.test.ts#watch and resume read the ledger (ADR-013 decisions 3 and 4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tab completion of command names, up and down history recall newest first, and a 0600 history file in the data root capped at 1000 lines with control characters removed"
    requirement: "FR-27"
    verification:
      - kind: unit
        ref: "test/unit/shell.test.ts#completion (ADR-013 decision 2), #history (ADR-013 decision 2; ordering edge)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The shell on a real pseudo-terminal: opens on the alternate screen, takes real key bytes (number, arrows, `:`, Tab, Enter, Ctrl-C, q) and exits 0 with the screen restored"
    requirement: "FR-27"
    verification:
      - kind: integration
        ref: "test/integration/shell-tty.test.ts#the shell under `script`, #the shell on a driven terminal"
        status: pass
    human_judgment: true
    rationale: "Resize of a live terminal, colour in a real emulator and how the screen looks are not asserted by any test (ADR-013: rendering defects in a real terminal surface only in a manual check); the Escape key also waits 500 ms for a possible escape sequence, which only a person can judge"

duration: 100min
completed: 2026-11-06
---

# Phase 2 Plan 19: Interactive shell Summary

**`avarice` with no arguments in a terminal opens a built-in-only shell (home view, numbered menu, command line with Tab completion and a 0600 history) that starts, watches and resumes runs through the one-shot command modules, and the detached supervisor it starts keeps running after the shell exits.**

## Performance

- **Duration:** about 100 min (the start time was not captured at the beginning of the run, and the machine clock jumped during it, so this is an estimate)
- **Completed:** 2026-11-06
- **Tasks:** 3 (one tracer, two auto, all `tdd="true"`, each with red evidence)
- **Files modified:** 20 (15 source and test files, 5 created under src/cli/shell, plus the evidence files)

## Accomplishments

- main() opens the shell only when both streams are terminals and `AVARICE_RUN` is unset; runShell repeats the refusal so that no command is reachable from a run whatever the caller checked (T-02-61). Every other case keeps usage and exit 64.
- The session engine serves a terminal (raw keys, alternate screen, full redraw, resize) and `TERM=dumb` (whole lines, no ESC) through one `Consumer` interface, queues type-ahead while an action works, and leaves the terminal as it found it (raw mode restored, alternate screen left, no signal sent to anyone).
- Home view through the shared OPS-7 functions: `shell: <profile>`, store health, runs and onboardings with state, last checkpoint and spend against budget, open decisions. A ledger that cannot be read shows `store: unavailable (...)` and the shell stays open.
- Menu 1 Start, 2 Watch, 3 Resume, 4 Status, 5 Inbox, 6 Command line (also `:`), q Quit. Start prompts for a brief path and shows the policy `routine`; Watch polls the ledger about once a second (state, latest checkpoints, latest events) until a stop state or `q`; Resume lists interrupted runs and onboardings. Each action calls the same command module as the one-shot CLI, in process, through main().
- Survival proven end to end: after the shell exits the recorded supervisor PID is alive and the run reaches `ready_for_review`, on the start path and on the resume path of a run killed at `launch:run`; no server handle appears at any sampled moment.
- Command line with Tab completion over COMMANDS, up and down history recall, and `{dataRoot}/shell-history` (0600, capped at 1000 lines by an atomic rewrite, control characters removed).
- Real-terminal proof on two harnesses: macOS `script` and a python3 pty driver that sends real key bytes.

## Task Commits

1. **Task 1: Tracer, bare `avarice` with two TTYs opens a home view, runs `status` in-process, quits** - `2e8301a` (feat)
2. **Task 2: Action menu, start, watch and resume; the supervisor outlives the shell** - `1a8aa14` (feat)
3. **Task 3: Completion, history in the data root, real pseudo-terminal checks** - `36f016a` (feat)

**Tracer gate:** after Task 1 the plan-level `<verify>` was re-run (unit tests, tsc, boundaries, footprint, all green), so the log reads "Tracer verified end-to-end, expanding".

## Files Created/Modified

- `src/cli/shell/shell.ts` - the session engine, `runShell`, the `ActionContext` the actions use, live views, ledger reads
- `src/cli/shell/home-view.ts` - `renderHome`, `renderWatch`
- `src/cli/shell/line-editor.ts` - `LineEditor`, `completeCommand`
- `src/cli/shell/history.ts` - `loadHistory`, `appendHistory`, `historyEntry`
- `src/cli/shell/actions.ts` - `SHELL_ACTIONS`, `runCommandLine`, `splitWords`
- `src/cli/main.ts` - the no-argument branch, `ShellInput`, `ShellOutput`, `MainOverrides.stdin` and `.stdout`
- `src/ports/ledger.ts`, `src/adapters/sqlite/ledger.ts` - `listRunEvents`
- `test/unit/shell.test.ts`, `test/unit/cli-args.test.ts`, `test/integration/shell-supervisor.test.ts`, `test/integration/shell-tty.test.ts`
- `test/helpers/shell-streams.ts`, `test/helpers/pty-drive.py`, `test/helpers/fake-run-host.ts` (`delayMs`)

## Decisions Made

See `key-decisions` above. The ones a later plan must know: the shell never keeps a ledger connection (each view opens read-only and closes), the output pane is stripped once on entry, and `ShellOptions.dispatch`, `.actions`, `.pollMs` and `.io` are test seams that production never passes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The Ledger port had no way to read events**
- **Found during:** Task 2 (watch view)
- **Issue:** the plan says the watch view shows "the latest events (type and short data)" from "the events columns", but `Ledger` only appends events; a command module may not open SQLite itself and the shell may not either.
- **Fix:** one read-only method, `Ledger.listRunEvents(runId, limit)`, returning the latest `limit` events oldest first; implemented in `SqliteLedger` and covered by a unit case (order, limit, unknown run).
- **Files modified:** src/ports/ledger.ts, src/adapters/sqlite/ledger.ts, test/unit/shell.test.ts
- **Commit:** 1a8aa14

**2. [Rule 3 - Blocking] The fake run host could not hold a run in `running`**
- **Found during:** Task 2 (integration test "watch until launch:run appears, quit the shell, supervisor still alive")
- **Issue:** the fake unit finishes in about a second, so there was no window in which a shell could watch and leave a live supervisor.
- **Fix:** `FakeRunOptions.delayMs`, an asynchronous wait at the start of the unit (the supervisor's timers keep running). Test helper only.
- **Files modified:** test/helpers/fake-run-host.ts
- **Commit:** 1a8aa14

**3. [Rule 3 - Blocking] macOS `script` cannot type after the screen is up**
- **Found during:** Task 3 (the plan's real pseudo-terminal check)
- **Issue:** `script -q /dev/null node ...` with a pipe, socket or FIFO as its own stdin fails (`tcgetattr/ioctl: Operation not supported on socket`); with a file it works, but it reads the file at once and sends end-of-file, and the terminal discards a completed line (Enter) when the shell switches to raw mode. Keys cannot be sent after the screen is up, so a `script` test can only show that the shell opens and ends cleanly (an exit 0 there might come from end-of-input, not from `q`).
- **Fix:** kept the `script` test as the plan wrote it (open, home view, alternate screen, exit 0, screen restored) and added a python3 `pty` driver (`test/helpers/pty-drive.py`, test tooling only, skipped with a reason when python3 is missing) that relays keys as the test sends them and never sends end-of-file. The driven test presses a number, `:`, types `stat` and Tab, runs the line, cancels a prompt with Ctrl-C, moves with arrows and leaves with `q`; an exit 0 there can only come from the key.
- **Files modified:** test/integration/shell-tty.test.ts, test/helpers/pty-drive.py
- **Commit:** 36f016a

**4. [Plan text error] `sta` does not complete to `status `**
- **Found during:** Task 3 (completion tests)
- **Issue:** the plan's behaviour line says Tab on `sta` completes to `status `, but `start` also begins with `sta`, so `sta` is ambiguous.
- **Fix:** `stat` completes to `status `; `sta` extends to the common prefix and lists the sorted candidates `start`, `status`, as the ambiguous case of the same line requires. Tested both ways.
- **Commit:** 36f016a

**Total deviations:** 4 (3 blocking, 1 plan text correction). **Impact:** one read-only port method, one test-helper option and one test-only python helper; no change to any command, the app layer, the domain or the one-shot output.

## Issues Encountered

- The ledger-unavailable case is shown from the error text the composition or the ledger returns (`describeError`), not from a recorded SQL statement: no adapter returns the failing statement, so "the failing query or error" is the error.
- While a command runs in the shell, input is queued and Ctrl-C cannot interrupt it (raw mode turns off signal keys); a long `start --wait` typed in the command line holds the shell until it ends. This is the one-shot behaviour moved in process.
- The whole suite (`node --test --test-concurrency=4`) ran after the last task commit: 2259 tests, 2234 pass, 0 fail, 25 skipped (the skips are existing ones; none of the plan's tests is skipped on this machine, and the pseudo-terminal tests ran).

## Known Stubs

None.

## Threat Flags

None. The only file the shell writes is the history file in the data root (T-02-63, mode 0600, covered by the plan's threat model). It opens no socket or listening port and signals no process.

## Manual items for verify-work

- Resize a live terminal while the shell is open (the redraw is asserted with an injected `resize` event, and a real window-size change is not).
- Look at the screen in a real emulator with colour, with `NO_COLOR=1`, and with `TERM=dumb`; check a narrow window (the table cuts to the width, other lines wrap).
- Press Escape alone at a prompt: readline waits 500 ms before it reports a lone Escape, Ctrl-C cancels at once.

## Self-Check: PASSED

- Created files exist: src/cli/shell/{shell,home-view,line-editor,history,actions}.ts, test/unit/shell.test.ts, test/integration/shell-supervisor.test.ts, test/integration/shell-tty.test.ts, test/helpers/shell-streams.ts, test/helpers/pty-drive.py, and the three red-evidence files. All found.
- Commits are ancestors of HEAD: 2e8301a, 1a8aa14, 36f016a. All found; `git rev-list --count a3d388d..36f016a` is 3, equal to `commits: 3` above.
- Acceptance criteria: `grep -cE "from '(node:net|node:http|node:https)'" src/cli/shell/*.ts` is 0 for every file; shell.test.ts drives the shell with injected streams only; shell-supervisor.test.ts asserts supervisor liveness after the shell exit and `ready_for_review` for the start and the resume paths; the history mode test asserts `(stat.mode & 0o777) === 0o600`; shell-tty.test.ts ran (not skipped) on this machine.
- Plan verification: `node --test test/unit/shell.test.ts test/integration/shell-supervisor.test.ts test/integration/shell-tty.test.ts test/unit/cli-args.test.ts test/unit/footprint.test.ts` green, `npx tsc -p .` and `node scripts/check-boundaries.ts` green.
- No stubs, no TODO or placeholder text in the created files.
