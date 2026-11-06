---
phase: 02-contained-unattended-run-of-one-work-item
plan: 15
subsystem: cli
tags: [status, inbox, install-host, ops-7, run-views, json-shapes, claude-skill, containment]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-02 OPS-7 render functions and the frozen Phase 1 JSON snapshots, 02-12 supervisor and run leases, 02-13 the run to ready_for_review with evidence, gates and decisions"
provides:
  - "src/app/run-status.ts: getRunStatuses (read-only run read model: state, reason, last checkpoint, branch, handed-off commit, clean flag, final evidence per check with preExisting, latest gates, open decision count, budgets, references, interrupted) and getInbox"
  - "status --json: one optional `runs` array as the last key of a project entry (D-19); a project with no run has no `runs` key"
  - "src/cli/render/run-view.ts: renderRuns, renderRunDetails, renderInbox, runStateWord; renderStatus prints the runs of every project, interrupted first, then blocked"
  - "avarice inbox [--json]: open decisions and runs ready for review"
  - "avarice install-host [--config-dir]: the avarice-run skill written to the Claude configuration directory, with the CS-11 refusals; adapter config host-skill:avarice-run"
  - "src/adapters/host-claude/avarice-run-skill.ts (AVARICE_RUN_SKILL, SKILL_MARKER) and skill-install.ts (installSkill)"
affects: [02-16, 02-17, 02-19, 02-20, 02-21, 02-22]

actuals:
  tokens: 23800
  tasks: 3
  commits: 5
plan_head_before: e5dbd20cacf206ddb376a685e112a1436abb8656
plan_head_after: 58b8b2094e9a1a5e92ba5f95ab73a0df802749e0
commits: 5

tech-stack:
  added: []
  patterns:
    - "A run view is a pure function of a read model that a read-only app function builds from ledger rows; the JSON path serialises the read model and never goes through the renderer"
    - "An optional JSON key is added as the last key of an entry only when it has content, so every existing key, its order and its value are untouched (D-19)"
    - "A file AVARICE writes into a directory it does not own carries a marker line, is replaced only when the marker is present, and is reached through lstat on every component below the directory, O_NOFOLLOW for the read and a temp file with a rename for the write"

key-files:
  created:
    - src/app/run-status.ts
    - src/cli/render/run-view.ts
    - src/cli/commands/inbox.ts
    - src/cli/commands/install-host.ts
    - src/adapters/host-claude/avarice-run-skill.ts
    - src/adapters/host-claude/skill-install.ts
    - test/integration/run-status.test.ts
    - test/integration/install-host.test.ts
    - test/fixtures/json-shapes/status-runs.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-15-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-15-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-15-red-evidence-task3.json
  modified:
    - src/app/status.ts
    - src/cli/render/status-view.ts
    - src/cli/commands/status.ts
    - src/cli/main.ts
    - src/cli/args.ts
    - test/unit/json-shapes.test.ts
    - test/unit/render.test.ts
    - docs/extensions.md

key-decisions:
  - "The run's lastCheckpoint is the latest checkpoint that names an action, so a ready run shows `handoff:fetch` and not the closing `none` that only repeats the state; an interrupted run's own step still comes from the true latest checkpoint"
  - "A run is interrupted when its state is resumable (contract_ready, running, verifying, paused) and no lease is live; the run row keeps its ledger state and is presented as `paused (verification interrupted)` for verifying and `paused (supervisor interrupted)` otherwise, naming the open attempt and the step"
  - "An inbox decision's issue is printed on its own line under the table, cut to the terminal width, because as a table column the width left it a few characters"
  - "install-host takes --config-dir (named in docs/extensions.md) over CLAUDE_CONFIG_DIR over ~/.claude, follows a symlinked configuration directory itself (a dotfiles setup) and refuses a symlink anywhere below it"

requirements-completed: [FR-11]

coverage:
  - id: D1
    description: "status shows, per run, state with reason, last checkpoint with local and relative time, branch with the handed-off commit and clean flag, final evidence per check (pre-existing flagged), gates, open decisions and budget use, offline, read-only, with no lease and no model"
    requirement: "FR-11"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#status shows a finished run: state, checkpoint, evidence and branch, offline (7 tests, one under the no-network wrapper)"
        status: pass
      - kind: unit
        ref: "test/unit/render.test.ts#run details (OPS-7, FR-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An interrupted run is shown as paused (verification interrupted) or paused (supervisor interrupted) with the open attempt ID, the step and `continue with: avarice resume <runId>`; a live lease is not interrupted; a blocked run is listed before a ready one"
    requirement: "FR-11"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#an interrupted run is shown as paused with the attempt, the step and the command that continues it (3 tests); #a blocked run is listed before a ready run"
        status: pass
    human_judgment: false
  - id: D3
    description: "status --json keeps every Phase 1 key and value byte-identical, a project with runs gains one `runs` key last, and the four Phase 1 snapshots are unchanged (D-19, SC 7)"
    requirement: "FR-11"
    verification:
      - kind: unit
        ref: "test/unit/json-shapes.test.ts (the four Phase 1 fixtures and the new status-runs.json)"
        status: pass
      - kind: integration
        ref: "test/integration/run-status.test.ts#status --json: every Phase 1 key and value is as before, and the project gains a `runs` array"
        status: pass
    human_judgment: false
  - id: D4
    description: "avarice inbox lists open decisions (ID, run, class, urgency, opened, issue cut to the width with controls stripped) and runs ready for review, human or --json, read-only; an empty store prints `inbox: 0 open decisions, 0 reviews`"
    requirement: "FR-11"
    verification:
      - kind: integration
        ref: "test/integration/run-status.test.ts#inbox (5 tests); test/unit/render.test.ts#inbox"
        status: pass
    human_judgment: false
  - id: D5
    description: "install-host writes the avarice-run skill (mode 0644, idempotent, digest recorded) and refuses under AVARICE_RUN, through a symlinked skills directory, skill directory or SKILL.md, and over a SKILL.md without the marker line; the real ~/.claude is untouched"
    requirement: "RC-5"
    verification:
      - kind: integration
        ref: "test/integration/install-host.test.ts (16 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The skill text actually changes how a real attended session behaves (calls avarice status first, stops on a denial, phrases a question the supervisor can route)"
    requirement: "RC-5"
    verification:
      - kind: other
        ref: "prompt evaluation of docs/extensions.md entry 3 (10 scripted attended sessions)"
        status: unknown
    human_judgment: true
    rationale: "Offline tests prove the file is written and refused correctly, not that a model follows it; the prompt evaluation is not part of this plan"

duration: 19 min
completed: 2026-11-06
---

# Phase 2 Plan 15: status and inbox for runs, and install-host Summary

**`status` now shows each run's state, checkpoint, branch, evidence, gates, decisions and budget offline with the Phase 1 JSON byte-identical (one optional `runs` key), `avarice inbox` lists open decisions and runs ready for review, and `avarice install-host` writes the `avarice-run` skill only from outside a run, through no symlink and over no file it did not write**

## Performance

- **Duration:** about 19 min (start 2026-11-05T23:45Z, end about 00:07Z)
- **Tasks:** 3 (Task 1 a tracer, Tasks 2 and 3 auto)
- **Files:** 20 changed in the five plan commits (1634 insertions, 7 deletions; about 23 800 tokens by chars/4 over the diff)

## Accomplishments

- **Run read model (FR-11).** `getRunStatuses` reads ledger rows only (no transcript, no write, no lease): final evidence is the latest `final`-phase row per check name (else the latest row), gates are the latest row per gate, references are the contract's requirement refs plus the conventions revision, and a check that already failed at the pin carries `preExisting: true`. Interrupted runs sort first, then blocked ones, then the rest in creation order.
- **status (OPS-7).** A `runs: N` result line, a RUN / STATE / TITLE table, then one block per run: `last checkpoint: handoff:fetch (17:50, 3 min ago)`, `branch avarice/<runId> at <sha7> (clean)`, `evidence: test passed`, `gates: G0 passed, G2 passed, G4 passed`, `decisions: 1 open (see avarice inbox)`, `budget: ...`, `references: ...`. Everything goes through `src/cli/render/` and `stripControl`.
- **D-19.** The project entry gains `runs` as its last key only when the project has runs. A test compares the entry without `runs` with the entry taken before the run existed, as text; the four Phase 1 snapshots are byte-identical (`git diff e5dbd20..HEAD` on them is empty), and `status-runs.json` pins the new shape.
- **Interrupted runs (S-3, AC-3).** A run killed at `mid-verify` shows `paused (verification interrupted)` and `interrupted attempt att_<id> at verify:checks`; one killed at `after-checkpoint:launch:run` shows `paused (supervisor interrupted)` at `launch:run`; both print `continue with: avarice resume <runId>`. The attempt ID equals the open attempt in the ledger. A killed supervisor whose lease has not lapsed is not shown as interrupted.
- **inbox.** `avarice inbox [--json]` (read-only, exit 64 for an argument): `inbox: 1 open decision, 1 review`, a decision table, each issue on its own line cut to the width, and a review table (run, branch, commit, repository). `--json` is `{ decisions, reviews }`. An issue holding `ESC[31m` or an OSC title sequence prints without them.
- **install-host.** Writes `skills/avarice-run/SKILL.md` (mode 0644, temp file and rename) to `--config-dir`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`; `installed`, `unchanged` or `updated`. Exit 64 under `AVARICE_RUN` (set to anything, even empty) before the profile resolves, nothing created; exit 3 for a symlink at `skills`, `skills/avarice-run` or `SKILL.md`, or for a SKILL.md without the marker line as a whole line. The digest is the adapter config `host-skill:avarice-run`.

## Task Commits

1. **Task 1 (tracer): status shows runs, offline, Phase 1 JSON unchanged** - `bab0b9f` (feat)
2. **Task 2: the inbox command, interrupted and blocked runs tested** - `eb6c64a` (feat)
3. **Task 3: install-host and the avarice-run skill** - `670570e` (feat)
4. **Docs: the new views named among the OPS-7 renderers** - `af6612d` (docs)
5. **Test: run-start expects the added `runs` key (deviation 7)** - `58b8b20` (test)

`commits: 5`, measured as `git rev-list --count e5dbd20cacf206ddb376a685e112a1436abb8656..HEAD` before this summary commit.

RED evidence: `02-15-red-evidence-task1.json` (14 tests against the plan base, 5 fail: the run row, the `runs` array, the offline run line, the read-only module and the snapshot; the 9 that pass pin behaviour that must not change). `02-15-red-evidence-task2.json` (against the Task 1 commit: 7 of 60 fail, all inbox; the interrupted and blocked behaviour was already in Task 1's read model, so those tests pin it). `02-15-red-evidence-task3.json` (the test file fails to load against the Task 2 commit: no skill text module).

Tracer gate (config `_auto_chain_active` false, `end-of-phase`, automated-only verify): the Task 1 verify (run-status, json-shapes, offline) re-ran green, so expansion continued.

## Files Created/Modified

See key-files. In one line each: `run-status.ts` the read-only run and inbox read models; `run-view.ts` the human run and inbox text; `inbox.ts` and `install-host.ts` the commands; `avarice-run-skill.ts` the skill text and marker; `skill-install.ts` the symlink-refusing writer; `status-runs.json` the one snapshot with a `runs` key.

## Decisions Made

See key-decisions. Points to know downstream:

- **02-16 and 02-17 (resume):** the interrupted view already prints `continue with: avarice resume <runId>`; `resume` for a run does not exist yet (the command still takes an onboarding ID), so that line names a command 02-16 and 02-17 must make true.
- **02-19 (shell):** the home view can call `getRunStatuses`, `getInbox`, `renderRuns` and `renderInbox` directly; the render functions take time and width as arguments.
- **Phase 3 (`decide`):** the inbox lists the open decisions; answering one is not built, so a blocked run's `decisions: N open (see avarice inbox)` line is the only pointer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan inconsistency] `last checkpoint: handoff:fetch` is not the latest checkpoint**
- **Found during:** Task 1
- **Issue:** the behaviour line says a ready run shows `last checkpoint: handoff:fetch`, but 02-13 ends every ready run with a closing `none` checkpoint, so the true latest is `none`.
- **Fix:** `lastCheckpoint` (JSON and text) is the latest checkpoint that names an action; the closing `none` is skipped, and used only when no checkpoint names one. The interrupted-run step still reads the true latest checkpoint.
- **Files modified:** src/app/run-status.ts
- **Commit:** bab0b9f

**2. [Rule 3 - Blocking] The snapshot cannot hold a measured wall clock**
- **Found during:** Task 1 (`status-runs.json`)
- **Issue:** `wallClockMs` `used` is the measured length of the invocation and differs every execution, so the snapshot could never match.
- **Fix:** the new snapshot test sets that one number to 0 before comparing; it stays a number, so keys, order and types are compared exactly. `toolCalls` (5) and `invocations` (1) are deterministic and are compared as they are.
- **Files modified:** test/unit/json-shapes.test.ts
- **Commit:** bab0b9f

**3. [Rule 1 - Bug, found by my own tests] The decision issue was cut to a few characters**
- **Found during:** Task 2
- **Issue:** with the issue as the cut column of the decision table, the subject columns (two 30-character IDs, class, urgency) left about 8 characters at 100 columns.
- **Fix:** the table keeps ID, run, class, urgency and opened; each issue is printed on its own `issue <decision>: ` line, cut to the width. Control characters are removed, line breaks become spaces.
- **Files modified:** src/cli/render/run-view.ts
- **Commit:** eb6c64a

**4. [Rule 3 - Blocking] `usage()` could not see the environment**
- **Found during:** Task 3
- **Issue:** the refusal under `AVARICE_RUN` must run before the profile resolves, which is `usage(args)`, and that had no environment parameter.
- **Fix:** `usage(args, env)` with `env` passed by the dispatcher (the process environment, or a test's `main()` override). Files outside the plan's list: src/cli/args.ts.
- **Commit:** 670570e

**5. [Plan note] Task 2 interrupted-run detection landed with Task 1**
- The interrupted and blocked ordering shares `run-status.ts` and `run-view.ts` with the tracer's read model, so it is in the Task 1 commit; Task 2's commit adds the inbox and the tests beyond the tracer's, and its RED evidence records the interrupted tests as passing at their base.

**6. [Plan note] `--config-dir`**
- docs/extensions.md says `install-host --config-dir <dir>`; the plan names only `$CLAUDE_CONFIG_DIR`. Both are supported, the flag first. The settings.json hook entries that document also names are not written (the plan scopes `install-host` to the skill).

**7. [Rule 1 - Bug] An 02-10 test asserted `status --json` unchanged after a run exists**
- **Found during:** the full-suite run
- **Issue:** `test/integration/run-start.test.ts` ("prints the summary, stores run, contract ...") compared `status --json` before and after `start` byte for byte. D-19 now adds the `runs` key once a run exists, so the old assertion no longer describes the product.
- **Fix:** the test asserts the one added `runs` entry (the run ID, state `contract_ready`), removes it, and compares the rest as text with the status taken before `start`.
- **Files modified:** test/integration/run-start.test.ts
- **Commit:** 58b8b20

**Total deviations:** 5 auto-fixed (3 plan inconsistency or bug, 2 blocking), 2 notes. **Impact:** none on a plan truth.

## Authentication Gates

None.

## Issues Encountered

- A first draft of the shell commands used a heredoc for a file edit and the harness refused it; the edits were made with Edit and Write instead.
- `AVARICE_SNAPSHOT_WRITE=1` regenerates every fixture in `json-shapes.test.ts`, not only the new one; the four Phase 1 files came out byte-identical (verified with `git status` and `git diff` on `test/fixtures`), but a later plan that regenerates should check the same.
- No live model was called, so nothing was added to the Phase 2 spend ledger; D-15 total unchanged.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-02-49: `stripControl` on every recorded string (title, branch, evidence name, step, decision issue), tested with CSI and OSC sequences in the unit and CLI tests. T-02-50: `usage()` refuses under `AVARICE_RUN` before the profile resolves and nothing is created (tested for set and empty). T-02-51: `lstat` on `skills`, `skills/avarice-run` and `SKILL.md`, `O_NOFOLLOW` for the read, `wx` temp file and rename; a symlinked target is left untouched (tested for all three). T-02-52: `run-status.ts` calls ledger read methods only (a test and the plan's grep check it). T-02-SC: no package was installed.

## User Setup Required

None - `avarice install-host` is run by the owner when they want the skill in an attended session.

## Next Phase Readiness

- Ready for 02-16 and 02-17 (the interrupted view and its `resume` line are in place), 02-19 (the shell can reuse the run views), and 02-20 to 02-22 (live cases can read a run with `status` and `inbox`).
- The prompt evaluation of the skill (10 attended sessions) is not run here; coverage item D6 is marked for a human.

## Self-Check: PASSED

- FOUND: src/app/run-status.ts, src/cli/render/run-view.ts, src/cli/commands/inbox.ts, src/cli/commands/install-host.ts, src/adapters/host-claude/avarice-run-skill.ts, src/adapters/host-claude/skill-install.ts, test/integration/run-status.test.ts, test/integration/install-host.test.ts, test/fixtures/json-shapes/status-runs.json, 02-15-red-evidence-task1.json, 02-15-red-evidence-task2.json, 02-15-red-evidence-task3.json
- FOUND commits: bab0b9f, eb6c64a, 670570e, af6612d, 58b8b20 (ancestors of HEAD, after e5dbd20)
- Acceptance: `git diff e5dbd20..HEAD` on the four Phase 1 fixtures prints nothing; `grep -c "acquireRunLease\|transitionRun\|recordRun" src/app/run-status.ts` is 0; install-host.test.ts has a test per behaviour line and asserts the real `~/.claude` mtime is unchanged
- Plan verification re-run after the last code commit: `npx tsc -p .` clean, `node scripts/check-boundaries.ts` ok (77 files), `node --test` of run-status, install-host, offline, json-shapes, render and skeleton: 113 pass, 0 fail; test/unit: 1146 pass, 0 fail
- Full suite (`node --test`, after the last code commit 58b8b20): 2095 tests, 2070 pass, 0 fail, 25 skipped (live and network cases); `npx tsc -p .` clean and `node scripts/check-boundaries.ts` ok (77 files). A first full run before that commit had 17 failures: 16 in `test/fault/killpoints.test.ts` (project-record map digests differing under full-suite load; the file passes alone, 22 of 22, and in the clean rerun) and 1 real one, described under deviation 7.
