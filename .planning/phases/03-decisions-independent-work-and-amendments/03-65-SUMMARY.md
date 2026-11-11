---
phase: 03-decisions-independent-work-and-amendments
plan: 65
subsystem: exit-tools-parity-guard
tags: [parity, unit-vs-supervisor, offline, no-spend, d-26, d-27, d-29, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-64's check environment in the unit's listed commands, 03-63's halt on run 2 attempt 2, 03-57's live base evidence of run 2 attempt 2
provides:
  - "`exit-run-phase3-tools.ts parity`: runs every required and target check the unit is told to run, in fresh clones of the pin, once as the unit would and once as the supervisor does"
  - "scripts/exit-parity.ts: parityReport, parityCommand, nodeModulesDigest"
  - "03-65-parity.json: the recorded parity of the twelve required checks of ~/aa-phan-portfolio-v2 at pin 9f1cd8d"
affects: [03-31, 03-32, 03-33]

actuals:
  tokens: 12400
  tasks: 2
  commits: 3
plan_head_before: 2715dea3c6f2415e403f62bcbe90233d89f934de
plan_head_after: f651746c5f180f46aaae87c06a3e217eecfb06ed

tech-stack:
  added: []
  patterns: ["a pre-spend guard that runs the unit's exact listed command through the real hook and the production executor, beside the supervisor's own command shape"]

key-files:
  created:
    - scripts/exit-parity.ts
    - test/integration/exit-parity.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-65-red-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-65-parity.json
  modified:
    - scripts/exit-run-phase3-tools.ts

key-decisions:
  - "The report's `parity` field is the checks' verdict only (listed, admitted by the hook, equal status). A problem (anchor, checkout, executor) is separate and still makes the exit code 1"
  - "`--config` is the reviewed conventions draft: the tool compares its parsed value with the conventions committed at the pin's descendant and records a difference as a problem"
  - "The node_modules advisory is applied: a digest of the owner's node_modules is recorded before and after and must be equal (what it covers is stated in the report)"

requirements-completed: [AUT-16, AUT-1]

coverage:
  - id: D1
    description: "The parity subcommand runs both forms of every check offline: agreement for a check with its declared environment, a CI-only mismatch (exit 1, mismatches exactly ci), the pre-fix reproduction (preFix.mismatches exactly site), the refusals (exit 2, nothing written) and the anchor"
    requirement: AUT-16
    verification:
      - kind: integration
        ref: "test/integration/exit-parity.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "03-65-parity.json records parity true for the twelve required checks on the pinned portfolio, the supervisor form matching run 2 attempt 2's live base evidence, and the pre-fix pass showing build and check:meta failing for the unit while the supervisor passes them"
    requirement: AUT-1
    verification:
      - kind: other
        ref: "node /Users/aphan/.claude-edu/jobs/5be29488/tmp/verify65.cjs (the plan's Task 2 automated check, written to a file)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 65: Offline Unit/Supervisor Parity Check Summary

**Parity holds: on the pinned portfolio (9f1cd8d), all twelve required checks give the same status when run exactly as the unit would run them as when the supervisor runs them (format:check fails in both, the other eleven pass in both), the supervisor form matches run 2 attempt 2's live base evidence, and the pre-fix pass reproduces attempt 2 offline; nothing was spent, no host was started, nothing was installed and the owner's checkout is unchanged.**

## Verdict

`03-65-parity.json`: `parity: true`, `mismatches: []`, `problems: []`, exit code 0. Run on 2026-11-11, 84 s in total for 36 check runs.

### Per check: unit form versus supervisor form

Every check is listed in the contract for the unit and admitted by the real hook decision with rule `agent-command`.

| Check | Command the unit is told (and runs) | Unit | Supervisor | Parity |
|---|---|---|---|---|
| typecheck | `npm run typecheck` | passed (0) | passed (0) | yes |
| lint | `npm run lint` | passed (0) | passed (0) | yes |
| format:check | `npm run format:check` | failed (1) | failed (1) | yes |
| test | `npm run test` | passed (0) | passed (0) | yes |
| check:case | `npm run check:case` | passed (0) | passed (0) | yes |
| check:colors | `npm run check:colors` | passed (0) | passed (0) | yes |
| check:contrast | `npm run check:contrast` | passed (0) | passed (0) | yes |
| build | `VITE_SITE_ORIGIN=https://aa-phan.github.io npm run build` | passed (0) | passed (0) | yes |
| check:meta | `VITE_SITE_ORIGIN=https://aa-phan.github.io npm run check:meta` | passed (0) | passed (0) | yes |
| check:budget | `npm run check:budget` | passed (0) | passed (0) | yes |
| check:no-phone | `npm run check:no-phone` | passed (0) | passed (0) | yes |
| check:images | `npm run check:images` | passed (0) | passed (0) | yes |

format:check fails in both forms on the same file (`index.html`), the known pre-existing base failure. The unit's host environment (real HOME, no CI, LANG passed through) gave no check a different result from the supervisor's sandbox (scratch HOME, CI=1, LANG=C); the variables only the supervisor sets (CI, LANG) and the one the unit's host passes (HOME) changed nothing on this portfolio.

### Pre-fix comparison: run 2 attempt 2 reproduced offline

The pre-fix pass runs each check by its bare argument vector, the list the unit was given before plan 03-64. It is evidence, not part of the verdict.

| Check | Bare command | Hook (today's policy) | Pre-fix result | Supervisor |
|---|---|---|---|---|
| build | `npm run build` | deny `shell-not-allowed` | failed (1): `VITE_SITE_ORIGIN is empty: set it in .env` | passed |
| check:meta | `npm run check:meta` | deny `shell-not-allowed` | failed (2): `VITE_SITE_ORIGIN is not set in the environment or .env` | passed |
| check:budget | `npm run check:budget` | allow | failed (2): `dist/index.html not found, run the build first` | passed |
| check:no-phone | `npm run check:no-phone` | allow | failed (2): `dist not found, run the build first` | passed |
| check:images | `npm run check:images` | allow | failed (2): `dist not found, run the build first` | passed |

`preFix.mismatches` is `build, check:meta, check:budget, check:no-phone, check:images`. build and check:meta are the two the plan required. The other three fail only because the failed build leaves no `dist`. The other seven checks gave the same status as the supervisor in the pre-fix pass too (format:check failed in both).

### Anchor

The supervisor form's statuses were compared with the base evidence AVARICE measured live for run 2 attempt 2 (`03-57-evidence-exit.json`, run `run_01M75NPTEF7FKDNW8ABQ9Q16WS`, base check rows): all twelve compared, all twelve equal (format:check failed, the other eleven passed). `anchor.matches: true`.

### node_modules gate

The source checkout's `package-lock.json` is byte-identical to the lockfile blob at the pin (`sha256:fafeb7d6d4de89ce2e150e8a6d5b2dc62cd5749a74e37f55379ae8fcc374ba93`), so `nodeModules.matchesPin: true`. The tree was copied out of `~/aa-phan-portfolio-v2/node_modules` into each of the three temporary clones with an APFS clone copy (`cp -c -R -P`, `copy: clone`), preserving symlinks as symlinks. A scan of the source tree found no symlink with an absolute target, so none points back into the owner's tree. Every directory a declared check writes under node_modules was deleted from each copy first, so neither form read a stale cache.

### Owner's checkout, before and after

HEAD `9f63d91` (the conventions commit), 6 refs, 1 status entry (the untracked `.env`), composite digest `sha256:36b38e48...` and node_modules digest `sha256:8d6e08c1...` are equal before and after: `checkout.unchanged: true`. Independently, after the run `git status --short` in the portfolio shows only `?? .env` and HEAD is unchanged. No check run's working directory was inside the owner's checkout (`runCwdInsideSourceCheckout: false`); each ran in `{temporary work root}/{run id}/validate`. The temporary work root was removed (no `avarice-parity-*` directory remains).

What the node_modules digest covers (the plan checker's advisory): git's `status` and the composite do not see writes inside the gitignored node_modules, so the tool also digests, by `lstat` (type, size, mtime; symlinks are not followed), every top-level entry of node_modules, the entries below each `@scope` directory, and every file under `.tmp`, `.vite`, `.vite-temp`, `.vitest`, `.vitest-cache` and `.cache` (the directories the declared checks write). It does not hash package file contents, and reading the tree for the copy changes only access times, which it does not record. The statement is in the report as `checkout.nodeModulesDigestCovers`.

### Spend and ledger

`spentUsd: 0`, `modelHostLaunched: false`, `installs: false`, `network: false`. `test/containment/live-spend-phase3.jsonl` is unchanged (49 lines, none under plan 03-65). `git diff e6cb9db` over it, the briefs and conventions drafts (`test/benchmark`), the exit evidence and the authorization shows no change; `git diff HEAD -- src` is empty, and no commit of this plan touched `src/`.

## What was built

- `scripts/exit-parity.ts` (`parityReport`, `parityCommand`, `nodeModulesDigest`). It compiles each brief against the conventions committed in the source repository at the pin's descendant (and compares them with the `--config` draft), takes the union of the required and target checks (every brief must list the same commands), and refuses with exit 2 and no report when the lockfile of the source differs from the pin's blob, node_modules is missing, the pin or the conventions cannot be read, or the usage is wrong.
- Unit form: the command is `checkAgentCommand(spec)`, the exact string the contract lists. It is judged by `decideToolCall` under the policy `buildHookPolicy` makes from `computeRunScope` on the clone, and an allowed command runs through `/bin/sh -c` in the production `SandboxedExecutor` with `buildInvocationEnv` as the whole environment, the scope's write roots, files and scratch writable, and the scope's read denials and allowances. A refused command gets status `refused`.
- Supervisor form: `runRequiredChecks`' command shape, using `sandboxSetup` and `writePathOf` from `src/app/checks.ts` rather than restating them.
- `--with-pre-fix`, the anchor (`--anchor-evidence`, `--anchor-run-id`), `--keep`, and the checkout record.
- `parity` in the dispatch, the usage line and the header of `scripts/exit-run-phase3-tools.ts` (no import cycle: the new module imports nothing from the tools file).
- `test/integration/exit-parity.test.ts`: 15 tests on scratch repositories. Fixture B (`site` needs `SITE_ORIGIN`): parity true, `site` listed with its environment and allowed as `agent-command`, `test` failed in both, no spend or host, checkout facts unchanged (read by the test itself). With `--with-pre-fix` and a matching anchor: `preFix.mismatches` exactly `['site']`, the bare command denied `shell-not-allowed`. Fixture A (adds `ci`, which needs CI=1): exit 1, `mismatches` exactly `['ci']`, supervisor passed and unit failed. An anchor whose `site` row is `failed`: exit 1 with an anchor problem. Refusals: a changed lockfile, a lockfile changed after the pin, missing node_modules and a usage error all exit 2 and write nothing.

## Red evidence

`03-65-red-task1.json` (`RED_EVIDENCE_OK`, `target_test_failed`): before the module existed, `parity` was an unknown subcommand. The tool printed its usage line (exit 2) and wrote no report, so the report-reading cases failed on the exit code (`2 !== 0`). 14 of 15 tests failed; the one that passed checks that the fixture repository was not changed, which holds when nothing runs. A first RED run had two vacuous passes. The refusal cases for a later lockfile commit now also assert the `package-lock.json` message, and RED was captured again from the committed test.

## Verification run

- `node --test test/integration/exit-parity.test.ts`: 15 tests, 15 pass.
- `npm run typecheck` clean; `node scripts/check-boundaries.ts` ok (99 files); `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts`: 289 tests, 289 pass.
- The plan's Task 2 automated check (`03-65-parity.json`: header, spend, pin, checkout, node_modules, twelve checks listed and allowed, build and check:meta carry `VITE_SITE_ORIGIN`, anchor, pre-fix, parity): passes. It was run from a file (`/Users/aphan/.claude-edu/jobs/5be29488/tmp/verify65.cjs`) because the session refuses a long `node -e` that names git-adjacent text.
- The plan's git checks, run as `git diff --stat` (the session refused `--exit-code` and `--quiet` forms): empty for `e6cb9db` over `test/fixtures/json-shapes`, `test/benchmark`, the authorization, the evidence file and the spend ledger, and for `HEAD -- src`. The only commits touching `src/` since `e6cb9db` are plan 03-64's three.

## What the offline proof does and does not show

It shows that, for each required check, the exact command the contract lists for the unit is admitted by the real hook, and that running it under the environment the real host adapter builds gives the same pass or fail as the supervisor's own run, on the pinned tree and on a copy of the owner's installed node_modules. It does not show that a live model runs the listed command as written, and it does not use the host's own sandbox: the production executor stands in for it (recorded as `unitSandbox` in the report). The executor lets the unit form write only the run scope's write roots, files and scratch, which is stricter than the host's rule (writable under the working directory except denied paths), so a check that wrote elsewhere would show here as a mismatch; none did. `test:e2e` is not a required check and was not run. The installed tree is the owner's existing node_modules, accepted by the lockfile gate; nothing was installed.

## Deviations from Plan

**1. [Rule 3 - Blocking] `buildInvocationEnv` needs `onboardingId`.** The plan names the options `{ gsdCoreBin, marker, scratchDir }`; the function's required `onboardingId` is passed as the run ID beside `marker`, as plan 03-64's fake host does.

**2. [Interpretation] `--config`.** The plan's usage lists `--config F` but no step uses it. The tool treats it as the reviewed conventions draft, requires it to exist, and records a difference from the committed conventions as a problem. For the portfolio the draft and the committed conventions are equal.

**3. [Interpretation] `parity` versus exit code.** `parity` is true when every check is listed, admitted and in agreement; problems (anchor, checkout, executor) do not change it but do make the exit code 1. Task 2's verify checks both.

**4. [Environment] The plan's git guard commands.** The session refused `git diff --exit-code` and `--quiet`; `git diff --stat` (empty output) was used for the same checks.

**5. [Run mode] Foreground.** The plan says to run the portfolio parity in the background; it finished in 84 s, so it ran in the foreground.

Otherwise the plan was executed as written.

## No live run, no spend, no re-run

No live AVARICE run was started, the Claude host was not called, nothing was spent, nothing was installed, and `avarice cancel`, `contract amend`, `decide` and `resume` were not run. `~/aa-phan-portfolio-v2` was only read (git objects, its lockfile and node_modules, as a copy source); temporary clones were used for every check. Run 2 has failed twice, so D-29 is exhausted for it: the owner's D-29 re-decision, through `/gsd-discuss-phase 3`, comes before any third attempt. Plans 03-58 to 03-60 stay blocked and unchanged. `authorize` and the authorization files are unchanged: whether `authorize` should refuse a start without a passing parity record is the owner's decision. STATE.md and ROADMAP.md were not updated by this executor.

## Documentation surfaces for plans 03-31 to 03-33

The parity tool is test tooling under `scripts/` and gets no `docs/system` row, and `docs/system/` was not edited. The plan found no unit-versus-supervisor mismatch on the portfolio, so it adds no `findings.md` line. One residual stays on record from plan 03-64's finding (c): the unit's host environment still differs from the check sandbox in HOME, PATH, CI and LANG by design (src/adapters/host-claude/env.ts:36 against src/app/checks.ts:135), and the parity run measured that this changes no result for the twelve required checks at the pin.

## Known Stubs

None.

## Threat Flags

None. T-03-178 (modifying the owner's checkout) is mitigated: clones come from git objects into a temporary work root, node_modules is copied out and never written in place, and HEAD, status, refs, the composite digest and the node_modules digest are equal before and after. T-03-179 (check code outside containment): both forms ran under the production sandboxed executor with no network allowance, and the unit form was first judged by the real hook decision. T-03-180 (an unrepresentative tree): the lockfile equals the pin's blob byte for byte, check caches were removed from the copy, both forms share the tree, and the supervisor form matches run 2 attempt 2's live base evidence. T-03-181 (spend): the module imports no host launch path, `spentUsd` is 0 and the ledger is unchanged. T-03-SC: nothing was installed.

## Self-Check: PASSED

- Created files exist: scripts/exit-parity.ts, test/integration/exit-parity.test.ts, 03-65-red-task1.json, 03-65-parity.json.
- Task commits are on the branch: 1f146aa (RED), fd6b8bb (GREEN), f651746 (parity record).
