---
phase: 03-decisions-independent-work-and-amendments
plan: 64
subsystem: run-contract-and-hook
tags: [check-env, agent-commands, containment, leading-assignment, hook, d-26, d-27, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-63's halt on run 2 attempt 2 (the owner's product-defect ruling), the fake run host and scenario style of 03-61
provides:
  - "checkAgentCommand(check): the command a declared check is listed under for the agent (its environment as sorted NAME=value words, then its argv)"
  - "programWords, LEADING_ASSIGNMENT, PLAIN_ENV_VALUE, SUPERVISOR_CHECK_ENV_NAMES, assignmentRefusal (src/domain/conventions.ts)"
  - "the program word after leading assignments is what the never-granted words, the denied prefixes, the npm and npx exemption and the hook's guard judge"
  - "the fake run host's runListedCommand and shellAttempts options"
  - "scenarios E and N (test/integration/run-check-env.test.ts)"
affects: [03-65, 03-31, 03-32, 03-33]

actuals:
  tokens: 16500
  tasks: 3
  commits: 6
plan_head_before: e1f95cfeee98a9522c32d216c6c66884bda38117
plan_head_after: 58783681fcec35390e136191a1418ad67ff27924

tech-stack:
  added: []
  patterns: ["print, do not inject: a check's environment is words of the listed command, so the hook's exact word comparison covers it", "one rule for the program word: programWords"]

key-files:
  created:
    - test/integration/run-check-env.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-64-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-64-red-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-64-red-task3.json
  modified:
    - src/domain/conventions.ts
    - src/domain/run-contract.ts
    - src/domain/invocation-scope.ts
    - src/domain/hook-decision.ts
    - test/helpers/fake-run-host.ts
    - test/unit/conventions.test.ts
    - test/unit/run-contract.test.ts
    - test/unit/run-scope.test.ts
    - test/unit/hook-decision.test.ts

key-decisions:
  - "Mechanism: print, do not inject. The compiler lists each check as its environment written as leading NAME=value words, sorted by name, then its argv. The assignment words stay inside the entry's words, so the hook's exact word comparison covers the environment and the hook-policy file keeps its shape"
  - "The names the supervisor's check sandbox sets (PATH, HOME, TMPDIR, npm_config_cache, CI, LANG) are left out of the rendered command, so the unit never gets a value the supervisor does not use; a unit test pins the constant to sandboxSetup's environment"
  - "Checker advisory applied: leading assignments in a conventions agent command are held to the same non-secret rule (redactSecrets) as check env values, in readAgentCommand, with a unit case"

requirements-completed: [AUT-16, AUT-1, CON-15]

coverage:
  - id: D1
    description: "A required check that passes only with its declared environment is listed to the unit with it, the real hook admits exactly that command, and the run reaches ready_for_review with no decision"
    requirement: AUT-16
    verification:
      - kind: integration
        ref: "test/integration/run-check-env.test.ts#scenario E exits 0 at ready_for_review"
        status: pass
      - kind: integration
        ref: "test/integration/run-check-env.test.ts#scenario E listed the check to the unit with its environment, and not as the bare command"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every other environment the unit tries (the bare form, another value, an extra or reordered assignment, an assignment before another command) is refused with shell-not-allowed and never runs"
    requirement: CON-15
    verification:
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#the run purpose: a contract command that begins with assignments (plan 03-64) denies every other environment with shell-not-allowed"
        status: pass
      - kind: integration
        ref: "test/integration/run-check-env.test.ts#scenario N shows the three attempts denied with exit code null (they never ran)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A leading NAME=value word no longer hides a never-granted word or a denied prefix at parse, compile, scope or hook; a leading assignment must name a non-reserved upper-case variable with a plain value; a secret-looking check env value is refused at compile"
    requirement: AUT-1
    verification:
      - kind: unit
        ref: "test/unit/conventions.test.ts#leading assignments in agent commands"
        status: pass
      - kind: unit
        ref: "test/unit/run-contract.test.ts#compileRunContract: a check is listed for the agent with its environment (plan 03-64)"
        status: pass
      - kind: unit
        ref: "test/unit/run-scope.test.ts#computeRunScope: reads, subagents and commands judges the program word after leading assignments"
        status: pass
      - kind: unit
        ref: "test/unit/hook-decision.test.ts#the run purpose: a contract command that begins with assignments (plan 03-64) never admits an entry whose program word, after its assignments, the contract may not grant"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 64: Check Environment in the Unit's Listed Commands Summary

**Each declared check is now listed to the unit and its verifier with the environment the supervisor gives it (`VITE_SITE_ORIGIN=https://aa-phan.github.io npm run build`), the hook still matches commands word for word, and a leading NAME=value word can no longer hide a never-granted command.**

## Performance

- **Duration:** about 70 min
- **Tasks:** 3 (a tracer and two auto tasks, all TDD)
- **Commits:** 6 task commits (RED and GREEN for each task), then this SUMMARY

## What was built

- `checkAgentCommand` (src/domain/run-contract.ts) renders a check as its environment sorted by name and written `NAME=value`, then its argv, joined by single spaces, leaving out the names the supervisor's sandbox sets. A check with no other environment is listed as `argv.join(' ')`, so a contract compiled from conventions without check env is byte-identical. The never-granted refusal (field `execution.commands`) still judges each check by its argv, never the rendered string.
- Compile refuses a check env value that is not a plain word (letters, digits and `_@%+=:,./-`) or that `redactSecrets` would change, with field `conventions.checks[<i>].env` and a reason that names the variable. Only the names that are printed are judged.
- `programWords` (src/domain/conventions.ts) is the one rule for the program word. `isRefusedAgentCommand`, `parseAgentCommands`, the npm and npx exemption in `computeRunScope`, and the hook's refused-word guard all judge the first word after the leading assignments. `parseAgentCommands` keeps the assignment words first in `AgentCommand.words`.
- `readAgentCommand` holds leading assignments to the check-env rules (`assignmentRefusal`: non-reserved upper-case name, plain value) and, per the checker advisory, to the non-secret rule, and refuses a command with no program word after its assignments.
- `parseHookPolicy` treats an `agentCommands` entry with a reserved, lower-case or non-plain leading assignment, or with only assignments, as a malformed policy (the hook fails closed).
- The fake run host gained `runListedCommand` (runs the prompt's listed command through the real hook under the environment `buildInvocationEnv` builds) and `shellAttempts` (shell lines tried through the real hook; refused lines never run).

## Red evidence: run 2's attempt 2 reproduced offline

Task 1, on the unchanged source (`03-64-red-task1.json`, `RED_EVIDENCE_OK`, `target_test_failed`): scenario E ended `blocked_on_decision`. The classify step recorded `kind: paused`, `pauseSignal: verification-human-needed`, `verification: human_needed`, with `hookDenies: 0`: the fake unit ran the bare listed command `node scripts/needs-env.mjs` (admitted, exit 1 without SITE_ORIGIN) and reported human_needed, exactly as the 03-63 unit did with `npm run build`. All 4 scenario E tests failed on assertions. After the change all 4 pass: exit 0 at `ready_for_review`, no decision row, G2 passed, item A's G2 `site` row passed.

Tasks 2 and 3 (`03-64-red-task2.json`, `03-64-red-task3.json`, each `RED_EVIDENCE_OK`):

- Task 2: 8 failing tests (rendering of CI and LANG, non-plain and secret values accepted, `X=1 git status` not refused, reserved and malformed assignments admitted, the three new exports missing). The two run-scope cases passed on Task 1's code, which proves the scope already judged the program word.
- Task 3: 2 failing tests (a hostile entry `X=1 git status` admitted, malformed assignment policies accepted). The exact-word negatives and scenario N passed on the Task 2 code, which is the proof that the hook already refused every other environment.

To keep the committed fixture and the RED evidence the same, scenario E's fixture was changed once after the first RED run (the slug is not pre-fixed, so the unit's edit counts as progress), the Task 1 GREEN source was set aside file by file, and RED was captured again against the unchanged source with the committed test. The evidence file is from that second run.

## Scenario E: the recorded prompt around the commands line

The test asserts the bullets under the line as literals (the recorded prompt file is removed when the suite ends, so this excerpt is composed from what the test asserts and from the conventions: `agentCommands: ['npm test']` plus the `test` and `site` checks, de-duplicated):

```
Commands you may run, exactly as written:
- npm test
- SITE_ORIGIN=https://example.test node scripts/needs-env.mjs
```

The test asserts that `- SITE_ORIGIN=https://example.test node scripts/needs-env.mjs` is listed and `- node scripts/needs-env.mjs` is not, that the fake's record shows `{ command: <the listed bullet>, denied: false, exitCode: 0 }`, and that the run's `hook.decision` events hold an allow with rule `agent-command`.

## Scenario N: other environments are refused and never run

The fake unit tries, through the real hook, in order: `node scripts/needs-env.mjs`, `ls src`, `SITE_ORIGIN=https://other.test node scripts/needs-env.mjs`, `ls src`, `SITE_ORIGIN=https://example.test NODE_OPTIONS=--version node scripts/needs-env.mjs`. The record shows the three environment attempts `denied: true` with `exitCode: null` (never ran) and both `ls src` admitted. The ledger holds at least three `hook.decision` denials with rule `shell-not-allowed` and no `loop.limit` event; then the listed command runs to exit 0 and the run reaches `ready_for_review` with no decision. Hook unit cases cover the same refusals, `SITE_ORIGIN=$HOME ...` as `shell-syntax`, an assignment before a read-only command and before another contract command, and that the refusal reason lists the admitted command with its assignments.

## Verification run

- `node --test test/integration/run-check-env.test.ts`: 7 tests (scenarios E and N), 0 failures.
- `node --test` over conventions, run-contract, run-scope, hook-decision, run-gsd-config, fake-run-host and the exit tools (exit-evidence, exit-drafts): all pass.
- `npm run typecheck` clean; `node scripts/check-boundaries.ts` ok (99 files); `npm run test:unit`: 2217 tests, 2217 pass.
- Integration: run-baseline-red-verification, run-prompt-policy, check-validation, hook, run-independent-work, phase3-exit-offline: 113 tests, 0 failures.
- `git diff --exit-code e6cb9db` over src/app, src/adapters, src/hook, src/domain/gates.ts, outcome.ts, quick-record.ts, test/benchmark, test/containment/live-spend-phase3.jsonl, 03-56-exit-authorization.json and 03-55-brief-classification.json: no change. `git diff --exit-code 4525c27 -- test/fixtures/json-shapes`: no change.
- No existing test was edited or weakened: the existing test files only gained cases (run-contract.test.ts also gained imports).

## What the offline proof does and does not show

It proves that the contract lists each check with its environment, that the real hook admits exactly that command and nothing else, and that the real host adapter's environment plus the listed assignments is enough for a check that needs its variable. It does not prove that a live model runs the listed command as written, and it does not prove that the unit's host environment (HOME, PATH, CI, LANG) gives every portfolio check the same result as the supervisor's sandbox. Plan 03-65's offline parity check measures that.

## Deviations from Plan

**1. [Test design] Scenario E's fixture leaves the slug unfixed.** The plan's behavior list did not say whether the pin's slug is fixed. With a fixed slug the unit's edit is a no-op and the classify step reports `no_progress` instead of passing. The fixture follows scenario R of 03-61: the target check `test` is red at the pin and the unit's edit fixes it. RED evidence was re-captured for the committed test (see above).

**2. [Plan advisory applied] Secret rule on agent-command assignments.** `readAgentCommand` applies the same `redactSecrets` test as check env values to the leading assignments of a conventions agent command, with a unit case. `assignmentRefusal` itself stays as the plan specifies (name and plain value), so the hook policy validator is unchanged in that respect.

Otherwise the plan was executed as written. The fake host's environment includes `onboardingId` (a required field of `buildInvocationEnv`) beside the plan's `marker`, `scratchDir` and `extraPath`.

## No live run, no spend, no re-run

No live AVARICE run was started, the Claude host was not called, nothing was spent, `~/aa-phan-portfolio-v2` was not touched, and `avarice cancel`, `contract amend`, `decide` and `resume` were not run. Run 2 has failed twice, so D-29 is exhausted for it: the owner's D-29 re-decision, through `/gsd-discuss-phase 3`, comes before any third attempt. Plans 03-58 to 03-60 stay blocked and unchanged. No brief, the portfolio conventions, the authorization, the D-31 classification or the spend ledger changed.

## Documentation surfaces for plans 03-31 to 03-33

`docs/system/` was not edited by this plan (as plans 03-51 and 03-61 did). The surfaces to draft, review and record:

1. **docs/system/runs.md, "Repository conventions" and "The contract" (drafted by 03-31).** The `execution` row: the agent commands are the conventions' plus each declared check's argument vector, preceded by the check's environment written as NAME=value words sorted by name, without the names the supervisor's check sandbox sets (PATH, HOME, TMPDIR, npm_config_cache, CI, LANG). The compile refusals gain a check environment value that is not a plain word or that looks like a secret (field `conventions.checks[<i>].env`), and a never-granted word after leading assignments.
2. **docs/system/runs.md, "The unit (`running`)", Launch (03-31).** The commands the unit is told include each check with its environment, so the unit and its verifier run a check with the variables the supervisor gives it. The prompt text itself is unchanged.
3. **docs/system/containment.md, "Command identity (Bash)" rule 7, the scope paragraph and the Commands bullet (drafted by 03-32).** A contract command may begin with NAME=value words and is matched exactly as words, assignments included. Any other leading assignment is refused as shell-not-allowed. The never-granted words, the denied prefixes and the npm and npx exemption are judged on the first word after the assignments. A policy entry with a reserved name or a value that is not a plain word is a malformed policy.
4. **docs/system/checks-and-evidence.md, "The sandbox every command runs in" (03-32).** A check's environment also reaches the unit's listed command, except the names the sandbox sets. The rest of the unit's environment is the host's (HOME, PATH, CI unset, LANG passed through), not the check sandbox's.
5. **docs/system/config-reference.md, `checks[].env` and `agentCommands` (03-32).** A value must be a plain word (letters, digits and `_@%+=:,./-`) that matches no secret pattern, or the contract is refused. An agent command may begin with assignments that name non-reserved upper-case variables and hold plain values that match no secret pattern. A never-granted word after them is refused.
6. **docs/system/findings.md (03-33), each line `file:line` first.**
   - (a) docs/contracts-and-state.md:916 and :921 against src/domain/run-contract.ts `checkAgentCommand` and src/domain/conventions.ts `readAgentCommand`: the proposal describes check env as the check's own and agent commands without assignments, while the built compiler gives the check env to the agent as leading assignments and the parser limits leading assignments.
   - (b) Resolved, with this plan's commits: a leading assignment no longer hides a never-granted word or a denied prefix at parse, compile, scope or hook.
   - (c) Residual, at src/adapters/host-claude/env.ts:36 against src/app/checks.ts:135: the unit's host environment still differs from the check sandbox in HOME, PATH, CI and LANG by design. The exit tools' parity check (03-65) measures whether that changes a result.

## Known Stubs

None.

## Threat Flags

None. T-03-172 to T-03-177 are mitigated as written: T-03-172 and T-03-173 by the hook unit cases, the red-first cases at each layer and scenario N; T-03-174 by the compile refusal of a secret-looking value (and the same rule on agent-command assignments); T-03-175 by `SUPERVISOR_CHECK_ENV_NAMES` pinned to `sandboxSetup`; T-03-176 by the compile refusal of a non-plain value; T-03-177 by the empty `git diff --exit-code e6cb9db` over the unit-judging files.

## Self-Check: PASSED

- Created files exist: test/integration/run-check-env.test.ts, 03-64-red-task1.json, 03-64-red-task2.json, 03-64-red-task3.json.
- Task commits are on the branch: b356bd0 (RED 1), 0e2e61f (GREEN 1), 794bd5d (RED 2), 99ca9bc (GREEN 2), 362518f (RED 3), 5878368 (GREEN 3).
