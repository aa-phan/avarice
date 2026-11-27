---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 24
subsystem: onboarding
tags: [restricted-mode, onboarding, claude-code, project-record, status, context, d-12, con-4, onb-7, typescript]

requires:
  - phase: 04
    provides: "plan 04-23: the restricted host (AppDeps.restrictedHost), restrictedLaunchArgs and its judge, checkRestrictedLaunchReady, the restricted status label"
  - phase: 04
    provides: "plan 04-10: the workspace stage's mapping-mode decision and the existing-map classes"
  - phase: 04
    provides: "plans 04-09, 04-20, 04-21: refresh planning, run start refusals, promotion after activation"
provides:
  - "`avarice onboard --restricted <repo>`: one fast map under `claude -p ... --restricted` in the staging copy, activating a record with mapping mode fast, completeness partial and `restricted: true`"
  - "the stored onboarding request carries `restricted`, so every stage and every resume reads the same answer; the mapping:plan step records it"
  - "ProjectRecord.restricted (optional, true only), status `partial (restricted)`, `status --json` project entry `restricted: true` appended last, `context` project line and JSON `restricted`"
  - "a contained `start` on a project whose active record is restricted is refused (exit 3) naming a contained re-onboarding on an enforced host; `start --restricted` still runs"
  - "the unenforced-host onboarding refusal names --restricted"
affects: [04-34, 04-37, 04-38, 04-39]

actuals:
  tokens: 14000
  tasks: 2
  commits: 4
plan_head_before: 107a116f48eb93c266e99b5d67e918b028e078b6
plan_head_after: 856f26edfaaf53c79ee2dda1cbfa6b2ae4429375
commits: 4

tech-stack:
  added: []
  patterns:
    - "The mode of an onboarding is part of its stored request (preflight.request.restricted), copied into the mapping:plan step; the host an onboarding reaches is chosen from it (hostOfOnboarding), never from a flag or from the state of another host"
    - "A contained record carries no `restricted` key, so every digest a contained record had stays the same"
    - "A restricted onboarding reaches no contained invocation: the indexes that need one are recorded absent with reason `restricted`"

key-files:
  created:
    - test/integration/restricted-onboarding.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-24-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-24-red-task2.json
  modified:
    - src/cli/commands/onboard.ts
    - src/app/onboarding-service.ts
    - src/app/stages/register.ts
    - src/app/stages/workspace.ts
    - src/app/stages/map.ts
    - src/app/stages/shared.ts
    - src/app/stages/index-stage.ts
    - src/app/stages/activate.ts
    - src/app/resume.ts
    - src/domain/project-record.ts
    - src/domain/host-admission.ts
    - src/adapters/host-claude/launch-args.ts
    - src/adapters/host-claude/launch-preflight.ts
    - src/adapters/host-claude/claude-host.ts
    - src/app/status.ts
    - src/cli/render/status-view.ts
    - src/app/context.ts
    - src/app/run-start.ts

key-decisions:
  - "The restricted request is stored in the onboarding's preflight request and copied into the mapping:plan step, so a resume in another process maps the same way; no contract field was added, so no onboarding contract digest moved"
  - "The restricted line of an onboarding carries the generated --plugin-dir and --agents pair (the plan's flagged assumption); a restricted run's line still carries neither, and the argv judge refuses them unless told the line is an onboarding's"
  - "The restricted onboarding builds the code graph only; the intel and knowledge indexes each need a contained invocation, so they are recorded absent with reason `restricted` and no host is called for them"
  - "A restricted onboarding maps fast whatever an existing map or a refresh plan would choose; it never adopts or refreshes a map"

patterns-established:
  - "hostOfOnboarding(deps, plan): the one place that chooses a host for an onboarding invocation and for the reap of an interrupted one"

requirements-completed: [CON-4]

coverage:
  - id: D1
    description: "`avarice onboard --restricted <repo>` launches the fast map once with --restricted in the staging copy and activates a record with mapping mode fast, completeness partial and restricted true; the user's checkout is byte-identical afterwards"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#launches the mapper once with --restricted in the staging copy, activates mode fast, completeness partial and restricted true, and leaves the checkout byte-identical"
        status: pass
    human_judgment: true
    rationale: "The test proves AVARICE built the line and a fake host received it. Whether the real host removes its shell, loads the map skill and agents under --restricted and keeps its file tools inside the staging copy needs the live run of plan 04-34"
  - id: D2
    description: "status shows `partial (restricted)`, and the project entry of status --json gains an optional `restricted: true` appended last; existing snapshots are unchanged"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#shows `partial (restricted)` in status, and appends the optional `restricted` key last to the project entry of status --json"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "`--restricted --mode full` exits 64 naming the conflict and registers nothing; without the flag an unenforced host still blocks with enforcement_failure and the message names --restricted"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#exits 64 naming the conflict for `--restricted --mode full`, and registers nothing"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#without the flag, an onboarding on the same host stays blocked with enforcement_failure and the message names --restricted"
        status: pass
    human_judgment: false
  - id: D4
    description: "A restricted record is labelled in `context` (project line `map: partial (restricted)`, JSON project key `restricted`) and a contained start on a project whose active record is restricted is refused with exit 3 naming a contained re-onboarding; `start --restricted` runs; a later contained onboarding replaces the record with a version that is not restricted"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#labels the pack of `context <term>` `partial (restricted)`, in the project line and as a `restricted` key of the JSON project"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#refuses a contained start on a project whose active record is restricted: exit 3, the message names a contained re-onboarding, and no run is stored"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#lets `start --restricted` run on it: the restricted line launches in the run clone and the run ends blocked as any restricted run does"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-onboarding.test.ts#is replaced by a later contained onboarding: the new record version has no restricted key, and the contained start is no longer refused for it"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 24: Restricted onboarding Summary

**`avarice onboard --restricted <repo>` runs GSD's fast map once under `claude -p ... --restricted` in the staging copy and activates a record labelled `partial (restricted)`; that record never stands in for whole-repository coverage, and a contained run on it is refused until a contained onboarding replaces it.**

## Performance

- **Duration:** about 24 min
- **Started:** 2026-11-17T09:08:26Z
- **Completed:** 2026-11-17T09:32:16Z
- **Tasks:** 2 of 2
- **Files:** 21 touched by the plan's commits (3 created, 18 modified, counting the two RED records)

## Accomplishments

- `onboard --restricted` forces mapping mode fast (`--restricted --mode full` exits 64 and registers nothing). The request is stored in the onboarding's preflight, the workspace stage copies it into `mapping:plan`, and the map stage, the index stage, activation and the resume reap all read it from there.
- The workspace stage judges the restricted host on its own descriptor (`enforcement: restricted`: a `claude` that lists `--restricted`, no admitted version, sandbox or hook) and never falls back to the contained host. Without the flag, an unenforced host still blocks with `enforcement_failure`, and the message now says to rerun with `--restricted`.
- The map stage launches through `deps.restrictedHost`. The restricted line of an onboarding adds the generated `--plugin-dir` and `--agents` pair so GSD's map skill and mapper agent are delivered as in the contained map; a restricted run's line still has neither.
- The restricted onboarding builds the code graph (AVARICE's own executor) and records the intel and knowledge indexes absent with reason `restricted`; no host is called for them.
- The record gains an optional `restricted: true` (present only for a restricted map, so contained digests do not move). Completeness stays `partial`. `status` prints `mapping fast (partial (restricted), fresh)`, the project entry of `status --json` gains `restricted: true` appended last, and `context` labels its project line `map: partial (restricted)` with an optional `restricted` key last in the JSON project.
- A contained `start` on a project whose active record is restricted exits 3 and names the contained re-onboarding (`avarice onboard --policy onboarding <repo>` on an enforced host); `start --restricted` runs on it. A later contained onboarding supersedes the restricted record with a version that has no `restricted` key.

## Task Commits

Each task followed RED, GREEN:

1. **Task 1: Tracer, `onboard --restricted`** - RED `d64193b` (test), GREEN `ba92353` (feat)
2. **Task 2: A restricted record is never full coverage** - RED `428c7c5` (test), GREEN `856f26e` (feat)

**Plan metadata:** the docs commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

| Task | RED evidence | Verdict |
|------|--------------|---------|
| 1 | `04-24-red-task1.json`: all four tests failed on their planned assertions (`--restricted` is not a flag, so the repository path was swallowed and the command exited 64 where 0 was planned; `--mode full` exited 3 where 64 was planned; the refusal did not name the flag) | RED_EVIDENCE_OK |
| 2 | `04-24-red-task2.json`: the context label test and the contained-start refusal test failed on their planned assertions (no label; exit 0 where 3 was planned) | RED_EVIDENCE_OK |

Two of task 2's four tests (`start --restricted` runs on the record, and a contained onboarding replaces it) passed before any code of their own task, because task 1 already activates the record and a contained onboarding already supersedes the active one. They stay as behavior cases.

## Files Created/Modified

- `src/cli/commands/onboard.ts` - `--restricted` (boolean), the conflict with `--mode full`
- `src/app/onboarding-service.ts`, `src/app/stages/register.ts` - the request carries `restricted`; a continued `discovered` onboarding whose stored request disagrees with the flag is refused (exit 64)
- `src/app/stages/workspace.ts` - restricted host check, `mapping:plan` records `restricted`, the contained refusal names the flag
- `src/app/stages/map.ts`, `src/app/stages/shared.ts` - `hostOfOnboarding`, the restricted host re-judged before a unit of budget is reserved
- `src/app/stages/index-stage.ts` - intel and knowledge recorded absent as `restricted`
- `src/app/stages/activate.ts`, `src/domain/project-record.ts` - the optional record key
- `src/app/resume.ts` - an interrupted restricted map is reaped through the restricted host
- `src/adapters/host-claude/launch-args.ts`, `launch-preflight.ts`, `claude-host.ts`, `src/domain/host-admission.ts` - the onboarding form of the restricted line and its judge and help-flag check
- `src/app/status.ts`, `src/cli/render/status-view.ts`, `src/app/context.ts` - the label and the optional key
- `src/app/run-start.ts` - the contained-start refusal
- `test/integration/restricted-onboarding.test.ts` - 8 tests

## Decisions Made

See key-decisions. The ones that are owner policy are listed next.

## Decisions needing owner review

1. **A restricted onboarding replaces a contained, complete record.** `onboard --restricted` on a project that already has an active contained record writes a new, lower-trust version (partial, restricted). Afterwards contained runs on the project are refused until a contained onboarding runs again. The plan did not say to forbid this; nothing is lost silently (the refusal says what to do), but the owner may prefer `onboard --restricted` to refuse when a non-restricted active record exists.
2. **The intel and knowledge indexes are never attempted in a restricted onboarding.** They are recorded absent with reason `restricted` (the code graph is still built, in AVARICE's own sandboxed executor, and is recorded absent where that fails). The plan said index steps run in the executor; those two steps run a contained host invocation, which a restricted onboarding does not have, so running them would have meant calling the contained host.
3. **The restricted line of an onboarding adds `--plugin-dir` and `--agents`.** This follows the plan's flagged assumption and loosens the 04-23 argv judge for onboarding lines only (`assertRestrictedLaunchArgsSafe(argv, { extensions: true })`: both flags together, nothing else added). If the live run shows the host refuses them with `--restricted`, the restricted map cannot run its skill and is classified under D-04.
4. **A restricted onboarding never adopts or refreshes an existing map.** Even with a complete stamped map in the checkout or an incremental refresh plan, mode is fast, so the result is always labelled partial.
5. **A `repo add` onboarding left in `discovered` is not silently turned restricted (or contained).** `onboard --restricted` on a project with such an onboarding, or the reverse, exits 64 naming the mismatch, because the continued onboarding keeps the request it was registered with.
6. **Wording the owner will see:** status `mapping fast (partial (restricted), fresh)`, `context` project line `...; map: partial (restricted))`, and the start refusal `the active project record of <repo> was made by a restricted onboarding (partial (restricted)); a contained run needs a contained map: onboard it on an enforced host with avarice onboard --policy onboarding <repo>, or start the run with --restricted`.

## What the live run (plan 04-34) must confirm

- Whether the host accepts `--plugin-dir` and `--agents` together with `--restricted` and `--setting-sources ""`, and then loads `/gsd-map-codebase --fast` and its mapper agent (and whether `--restricted` allows the subagent the fast map starts).
- Whether `--restricted` confines file tools to the staging copy while still letting the skill read GSD's own files outside it, and whether `dontAsk` with the generated settings permits the writes under `.planning/codebase/`.
- Whether hooks run under `--restricted` (the PreToolUse hook's denials count budget and write violations; if it does not run, only the host's own confinement stands), and that the user's checkout stays byte-identical (T-04-66).
- That AVARICE's own stamp and code-graph steps run on a host with no usable sandbox, or are recorded absent as ONB-13 says, without blocking activation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] A continued onboarding must not change what a restricted request meant**
- **Found during:** Task 1 (registration)
- **Issue:** An onboarding left in `discovered` (by `repo add`) is continued and keeps its stored request, so `onboard --restricted` would silently run contained (blocking at the host check) and a plain `onboard` would silently run restricted.
- **Fix:** `startOnboarding` compares the stored `restricted` with the request and refuses a mismatch (exit 64).
- **Files modified:** `src/app/onboarding-service.ts`, `src/app/stages/register.ts`
- **Committed in:** `ba92353`

**2. [Rule 1 - Bug] The resume reap used the contained host**
- **Found during:** Task 1 (resume path)
- **Issue:** `reapInterrupted` called `deps.host.reap`; a restricted onboarding's map was launched by the restricted host.
- **Fix:** it reaps through `hostOfOnboarding`.
- **Files modified:** `src/app/resume.ts`
- **Committed in:** `ba92353`

**3. [Rule 3 - Blocking] The restricted argv judge refused the extension flags**
- **Found during:** Task 1 (the plan's flagged assumption needs `--plugin-dir` and `--agents`)
- **Issue:** 04-23's judge and help-flag check refused both flags and did not require them to be listed.
- **Fix:** the judge takes an `extensions` option (both flags together or neither, onboarding lines only); the launch check adds the two flags to the required help flags for an onboarding.
- **Files modified:** `src/adapters/host-claude/launch-args.ts`, `launch-preflight.ts`, `claude-host.ts`, `src/domain/host-admission.ts`
- **Committed in:** `ba92353`

---

**Total deviations:** 3 auto-fixed (1 missing critical, 1 bug, 1 blocking)
**Impact on plan:** All three were needed for correctness of a restricted onboarding; no scope was added beyond the plan's feature.

## Issues Encountered

- Superseded project records keep `state = 'active'`; the test helper reads the live one with `superseded_at IS NULL`.
- `node --test` over two integration files that both open the ledger once failed with `database is locked`; the same files pass with `--test-concurrency=1`. This is test parallelism, not a code defect.

## Verification

- `node --test test/integration/restricted-onboarding.test.ts test/integration/run-start.test.ts test/integration/context.test.ts test/unit/json-shapes.test.ts`: pass (the run-start and context files with `--test-concurrency=1`)
- `npm run test:unit`: 2687 of 2687 pass
- Related integration and fault suites, serialised: 294 of 294 pass (restricted-mode, claude-host, onboard-adopt, refresh-scoped, ledger-status, status-queries, run-status, completeness, index-stage, intel-step, preflight, exit-parity, transcript-retention, context-handle-first, knowledge-refresh, killpoints, run-killpoints, full-map-resume-stamp)
- `npm run typecheck` and `npm run check:boundaries`: clean; `git diff --quiet -- test/fixtures/json-shapes` exits 0
- The full `npm test` was not run here (about 20 to 25 minutes); the orchestrator runs it at the end of the wave. No value was added to RUN_NEXT_ACTIONS or an onboarding action list, no artifact kind was stored, and no store, brief or sandbox root changed, so the kill-point coverage, redaction source scan and AC-5 and AC-6 suites needed no change.

## Documentation surfaces

For plans 04-37, 04-38 and 04-39 (`docs/system/` was not edited here; the phase documentation plans own it):

- **Flag:** `avarice onboard --restricted` (usage `avarice onboard --policy onboarding [--mode full|fast] [--restricted] [--promote none|copy|commit] [--budget name=value]... <repo>`); forces mode fast; `--restricted --mode full` exits 64 (`--restricted maps fast only and conflicts with --mode full`); a continued `discovered` onboarding registered with the other setting exits 64.
- **Refusal text:** the unenforced-host onboarding stop says `host <adapter> reports enforcement <value>; containment cannot be guaranteed. Rerun with --restricted to map in restricted mode (a fast map the record labels partial (restricted))`; the restricted host not ready says `restricted mode is not available: <cause>; no map was started`; both are `blocked (enforcement_failure)`.
- **Launch line of a restricted onboarding:** `claude -p /gsd-map-codebase --fast ... --restricted --setting-sources "" --settings <file> --plugin-dir <dir> --agents <file> --permission-mode dontAsk --permission-prompts none --strict-mcp-config --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose --session-id <uuid>`, cwd the staging copy. A restricted run's line (plan 04-23) carries neither extension flag. Host readiness lists `--plugin-dir` and `--agents` in addition for an onboarding (`RESTRICTED_ONBOARDING_HELP_FLAGS`).
- **Stored request and plan:** `preflight.request.restricted: true`; the `mapping:plan` step gains `restricted: true`; the contract is unchanged.
- **Record:** optional top-level `restricted: true` (only for a restricted map); mapping mode fast, completeness `partial`; `indexes.absent` lists `intel` and `knowledge` with reason `restricted`.
- **Status:** text `mapping fast (partial (restricted), fresh)`; `status --json` project entry `restricted: true`, optional, appended after `runs`.
- **Context:** project line `...(record v<n> at git:<sha>; map: partial (restricted))`; JSON `project.restricted: true`, optional, last.
- **Start refusal:** code `restricted-record`, exit 3, text above; `start --restricted` is not refused.
- **Findings line for `docs/system/findings.md`:** `src/app/stages/map.ts` builds a restricted fast map where `docs/repository-onboarding.md:262` describes restricted onboarding only in outline; the owner decides which side moves (decisions 1 to 4 above).

## Known Stubs

None.

## Threat Flags

None. The new surfaces (the extension flags on the restricted onboarding line, the host choice for an onboarding) are the plan's own, covered by T-04-65 and T-04-66.

## Next Phase Readiness

- Ready for plan 04-25. The live confirmations above belong to plan 04-34.

## Self-Check: PASSED

- `test/integration/restricted-onboarding.test.ts`, `04-24-red-task1.json`, `04-24-red-task2.json` exist.
- Commits `d64193b`, `ba92353`, `428c7c5`, `856f26e` are ancestors of HEAD.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
