---
phase: 03-decisions-independent-work-and-amendments
plan: 69
subsystem: host-launch-search-route
tags: [gap-closure, d-26, d-27, brief-harness-defect, glob, grep, allowedTools, launch-args, aut-1, con-15]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-58's halt on run 3's attempt 1 and the owner's brief-harness-defect, fix-first ruling
provides:
  - "buildLaunchArgs emits `--allowedTools Glob,Grep` on every launch line; assertLaunchArgsSafe admits `--allowedTools` only as that bare pair, once"
  - "A no-spend probe of the real pinned 2.1.319 host: the session and the four run agents keep Glob and Grep under AVARICE's own launch line"
  - "Scenario S: run 3's attempt-1 stop reproduced offline (red) and gone after the change"
affects: [03-70, 03-31, 03-32, 03-33]

tech-stack:
  added: []
  patterns:
    - "The fake run host derives whether a session has Grep from the production launch line (hostKeepsSearchTools), the rule the probe measures on the real binary"

key-files:
  created:
    - test/integration/host-search-tools.test.ts
    - test/integration/run-search-route.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-69-red-task1.json
  modified:
    - src/adapters/host-claude/launch-args.ts
    - test/helpers/fake-run-host.ts
    - test/integration/claude-host.test.ts
    - test/unit/launch-args.test.ts
    - test/mutation/fail-closed.test.ts
    - test/unit/fake-run-host.test.ts
    - docs/system/runs.md
    - docs/system/containment.md
    - docs/system/integrations.md
    - docs/system/findings.md

key-decisions:
  - "The launch line keeps the host's search tools with `--allowedTools Glob,Grep`; shell grep stays refused and no admitted shell command changes, so no checkpoint:decision was needed"

requirements-completed: [AUT-1, CON-15]

actuals:
  tokens: 60000
  tasks: 3
  commits: 4
plan_head_before: 1cb4af1ab0bf27abf3549844540efdcec7674b02
plan_head_after: 76243a90b8bf3985c4266a1e3bef432940ba409a

completed: 2026-11-12
status: complete
---

# Phase 3 Plan 69: The unit and its agents keep Glob and Grep, so a verifier can search the repository Summary

**Every launch line AVARICE builds now carries `--allowedTools Glob,Grep`, so the pinned host stops removing its search tools from the unit's session and from the four run agents. The launch judge admits `--allowedTools` only as that exact pair. Shell grep stays refused. Run 3's attempt-1 stop is reproduced offline before the change and gone after it.**

## RED evidence (03-69-red-task1.json, `RED_EVIDENCE_OK`)

On the unchanged source, with `AVARICE_CLAUDE_BIN` set to the pinned 2.1.319 binary (11 tests, 1 pass, 10 fail, 0 skipped):

- The probe: the real host, started with the exact argument list, working directory and environment the adapter produced, reported init tools `Task,Bash,CronCreate,CronDelete,CronList,Edit,EnterWorktree,ExitWorktree,ListAgents,Monitor,Read,ReportFindings,ScheduleWakeup,SendMessage,Skill,TaskStop,ToolSearch,Workflow,Write`: neither Glob nor Grep. `gsd-executor` resolved to `Read,Write,Edit,Bash,Skill`. The four agent tests failed the same way; the adapter's argument list held no `--allowedTools`.
- Scenario S ended `blocked_on_decision` (decision, class acceptance, open) with classify kind `paused`, pauseSignal `verification-human-needed`, after the hook refused the verifier's shell grep (`grep -rn slugify docs`). The record read `available: false`, `shell: { command: "grep -rn slugify docs", denied: true }`. This is run 3's attempt 1 offline.
- Semantic assessment (in the evidence file): the target executed against the real binary and failed on the planned assertion (init tools lack Glob), not on setup, a load error or a skip.

## GREEN

`launch-args.ts` exports `SEARCH_TOOLS_ALLOWED = 'Glob,Grep'`; `buildLaunchArgs` emits `--allowedTools` and the pair right after the `--mcp-config` pair for every purpose and on a resume; `assertLaunchArgsSafe` admits `--allowedTools` only as the bare flag whose next element is exactly the pair, once. Another value, the `=` form, a second occurrence, a flag with no value and `--allowed-tools` are refused with the widen reason. After the change the same probe passes with no skipped test.

### Probe tool lists after the change (real pinned 2.1.319 host, 127.0.0.1 recorder answering 500, dummy key, fresh HOME and CLAUDE_CONFIG_DIR)

| Launch | init tools | first request tools |
|---|---|---|
| session | Task,Bash,CronCreate,CronDelete,CronList,Edit,EnterWorktree,ExitWorktree,**Glob,Grep**,ListAgents,Monitor,Read,ReportFindings,ScheduleWakeup,SendMessage,Skill,TaskStop,ToolSearch,Workflow,Write | Agent,Bash,Edit,**Glob,Grep**,ListAgents,Read,ReportFindings,ScheduleWakeup,Skill,ToolSearch,Workflow,DeferredToolPlaceholder,Write |
| `--agent gsd-planner` | Read,Write,Edit,Bash,Glob,Grep,Skill | Read,Write,Edit,Bash,Glob,Grep,DeferredToolPlaceholder,Skill |
| `--agent gsd-plan-checker` | Read,Bash,Glob,Grep,Skill | Read,Bash,Glob,Grep,DeferredToolPlaceholder,Skill |
| `--agent gsd-executor` | Read,Write,Edit,Bash,Grep,Glob,Skill | Read,Write,Edit,Bash,Grep,Glob,DeferredToolPlaceholder,Skill |
| `--agent gsd-verifier` | Read,Write,Bash,Grep,Glob,Skill | Read,Write,Bash,Grep,Glob,DeferredToolPlaceholder,Skill |

WebFetch and WebSearch are absent from the session; none of an agent's disallowed tools (verifier: Edit, MultiEdit; plan-checker: Write, Edit, MultiEdit) appears in that agent's tools.

### Scenario S's record after the change

The run exits 0 at `ready_for_review` with no decision row; G2 passed for item A. Record: `search: { available: true, outside: [{ path: <owner checkout>, denied: true }, { path: "/etc", denied: true }], denied: false, matched: ["docs/usage.md"], shell: null }`. The run's `hook.decision` events hold a deny for each outside Grep and an allow for Grep of `docs`, all with the verifier's agent ID, and no Bash call by the verifier.

## Task 2 (pinning the exact admission)

Seven refused `--allowedTools` forms (values `Glob,Grep,Bash`, `Grep`, `Glob Grep Bash`, `Read(//etc/**)`; the `=` form; a second occurrence; no value) plus `--allowed-tools Glob,Grep`; the pair once on fresh, resume and named-agent lines; the mutation list holds `--allowedTools=Glob,Grep`; `hostKeepsSearchTools` pinned to ten cases and to `buildLaunchArgs`' own output. These passed on Task 1's code as written (the proof that the exact admission already refuses every other form); no fix to the judge or the rule was needed. Sweep: `npm run typecheck` clean, `check-boundaries` ok (99 files), `npm run test:unit` 2279 pass 0 fail, the run, hook, check-environment and exit integration files 97 pass, `claude-host` and `launch-args` suites pass. `git diff --exit-code eb1b90f` over every protected src path, `test/fixtures/json-shapes`, the benchmark briefs, the spend ledger, the authorization, the classification and the exit evidence: clean.

## No live run, no spend, no approval needed

No live AVARICE run was started and no model call or spend happened. The probe talked only to a 127.0.0.1 stub with a dummy key and temporary HOME and CLAUDE_CONFIG_DIR; the owner's profile config and credentials were not read. Claude ran no `avarice cancel`, `contract amend`, `decide` or `resume`; `run_01M78966NJ0SW8NB54564MFFZW` stays `blocked_on_decision`. No brief, conventions file, D-31 classification, authorization, evidence or spend line changed, so `03-56-exit-authorization.json` still authorizes run 3's attempt 2 and no new D-04 approval is needed. Run 3 has one failed attempt in its epoch; its attempt 2 of 2 is plan 03-70.

## Note for run 3's attempt 2: the consecutive-searches limit

The limit (25 consecutive Grep or Glob decisions in one invocation with no allowed Read, Edit or Write between them, counted across agents; CON-14) had no live Grep or Glob calls to count until now. A unit that searches 25 times with no allowed Read, Edit or Write between ends its invocation. It is a designed control and is unchanged.

## Live tests not run

`test/containment/live-run.test.ts` and `test/helpers/live-harness.ts` build their launch lines with `buildLaunchArgs`, so live containment cases now carry the pair. They need credit and were not run (offline plan).

## Documentation surfaces for plans 03-31 to 03-33

1. `docs/system/integrations.md`, "Direction and invocation" (changed here): the command line's `--allowedTools Glob,Grep`, why the host needs it, and the refusal list's exact admission. For a fresh review in plan 03-33.
2. `docs/system/containment.md`, the launch-line items, launch argument judgment and the grep paragraph (changed here). For a fresh review in plan 03-33.
3. `docs/system/runs.md`, "The unit (`running`)", Launch (changed here): the session and its agents have the Read, Grep and Glob tools. For a fresh review in plan 03-33.
4. `docs/system/findings.md` (changed here): the host's removal rule, resolved by the launch line, with the probe as the detector. The existing `--verbose` finding's `launch-args.ts` line number was updated to the new line (63).
5. `coverage.md` and `README.md`: no count or document changed; plan 03-33 marks the three documents reviewed after their fresh review.

## TDD Gate Compliance

RED commit 456afbc (`test(03-69)`) precedes the GREEN commit 9323ed3 (`feat(03-69)`); Task 2's tests are commit c2468ea; no refactor commit.

## Commits

- 456afbc test(03-69): add failing probe of the pinned host's search tools and scenario S
- 9323ed3 feat(03-69): keep the host's Glob and Grep tools in the unit and every run agent
- c2468ea test(03-69): pin the launch judge's exact admission and the fake host's search rule
- 76243a9 docs(03-69): describe the launch line's search tools and record the host's removal rule

## Deviations from Plan

None. The plan executed as written. One minor addition: the probe emits each measured tool list as a test diagnostic so the lists above are reproducible from the test output.

## Known Stubs

None.

## Threat Flags

None. The change is the surface T-03-195 to T-03-199 already cover.

## Self-Check: PASSED

- Files exist: launch-args.ts, host-search-tools.test.ts, run-search-route.test.ts, 03-69-red-task1.json, the four docs/system files.
- Commits 456afbc, 9323ed3, c2468ea and 76243a9 are ancestors of HEAD.
