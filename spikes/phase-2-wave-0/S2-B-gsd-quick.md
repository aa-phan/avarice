# S2-B: the real `/gsd-quick --validate --text` unit under the run-purpose hook (plan 02-09, RESEARCH A2)

Harness: `test/helpers/live-harness.ts` (`runLiveRunUnit`), suite `test/containment/spike-gsd-quick.test.ts` (sub-tests `configure`, `round-1`, `round-2`, all skipped unless `AVARICE_LIVE=1`).
Host: Claude Code 2.1.318 (admitted in plan 02-01), model `sonnet` (the contract's medium-size model), real `ClaudeHostAdapter`, purpose `run`, owner kind `run`.
Scratch project: `makeRunRepo()` (a `src/slug.ts` whose `slugify` replaces every non-alphanumeric character with a dash, one failing test in `test/slug.test.ts`, `.planning/PROJECT.md`, `ROADMAP.md`, `STATE.md`), onboarded to `active` with the fake host, conventions committed (`checks: test = npm test`, `paths.write = src/**, test/**`, `agentCommands = ['npm test']`), brief "Collapse repeated dashes in slugs" (AC1 `verifiedBy check:test`), started through the real `startRun`, run clone prepared at the pin by `CloneRunWorkspace.prepare`, every path handed to the model in realpath form (02-01 carried finding).
Spend guard: each round is refused unless `fitsPhase2Ceiling(cap)` (D-15) and plan 02-09's own total stays within 4.00 USD (`spikeRefusal`).

## 1. `gsd:configure` (RUN_GSD_SETTINGS applied with `config-set` before any model spend)

Applied one key at a time through `GsdOnboardingAdapter.configure()` with cwd = the run clone. The step is recorded in the ledger as `gsd:configure` (completed) before the unit is launched (`configureRecordedBeforeLaunch: true`, checked by the round sub-tests; ordering edge).

| Key | Value | Result |
|---|---|---|
| `workflow.text_mode` | `true` | accepted |
| `gates.execute_next_plan` | `false` | accepted |
| `gates.confirm_transition` | `false` | accepted |
| `audit.enabled` | `true` | accepted |
| `workflow.use_worktrees` | `false` | accepted |
| `commit_docs` | `false` | accepted |
| `git.branching_strategy` | `none` | accepted (so the assumption of plan 02-08 holds) |
| `git.quick_branch_template` | `` (empty) | **refused** before GSD ran: `invalid setting git.quick_branch_template: "" is not a plain value` (the adapter admits only `[A-Za-z0-9_.-]+`) |

Disposition of the refused key: **(c) removed by configuration.** With `git.branching_strategy = none` the quick workflow's `branch_name` stays empty and Step 2.5 (quick.md lines 184-186) skips branching, so the empty template is not needed. `RUN_GSD_SETTINGS` now holds the seven accepted pairs (unit pin: `test/unit/run-gsd-config.test.ts`).

RESEARCH A5: `workflow.windows_enforce` was probed (never added): `config-set` **accepts** it (`true`). Nothing in the quick workflow needs it, so it stays out of `RUN_GSD_SETTINGS`.

Idempotency edge: applying `RUN_GSD_SETTINGS` twice gives the same `.planning/config.json` digest and the same accepted set (sub-test `configure`, no spend).

## 2. Round 1 (cap 2.00 USD)

Prompt: `runUnitPrompt(contract, '')` as of plan 02-08 (the task text, the exclusions, the write set, the commands and the no-commit sentence, no workflow sentence). Settings: the eight pairs of plan 02-08 (one refused, above).

Ground truth (clone and ledger, never the model's reply):

| Fact | Value |
|---|---|
| Host outcome kind (classifier, `expectedFiles` empty) | `denied` (one hook denial was enough; see finding 3) |
| Exit code / stream subtype | 0 / `success` |
| Cost | 0.1037 USD (ledger line `"plan":"02-09","case":"round-1"`), 22 s |
| Tool calls | 10 (Bash 3, Read 4, Edit 1, Write 2), 9 allowed, 1 denied |
| Subagents spawned (host's `subagentStats`) / Agent calls | 0 / 0 |
| `AskUserQuestion` | not called |
| Clone HEAD before / after | `4338a36a...` / `4338a36a...` (equal: no commit) |
| Changed paths | `src/slug.ts` (modified), `.planning/quick/20261105-collapse-dashes/SUMMARY.md` (added), `.planning/STATE.md` (modified) |
| Writes outside the write set | none |
| VERIFICATION status line | none (no verifier ran) |
| User's repository (refs digest, tree digest) | unchanged |

Round-1 denial table (every hook denial of the round):

| # | Tool | Rule | Target (clone-relative, paths made symbolic) | GSD step that issued it | What the model did next |
|---|---|---|---|---|---|
| 1 | Bash | `shell-syntax` | `ls .claude/gsd-core/workflows/quick.md ~/.claude/gsd-core/workflows/quick.md; ls; ls src test .planning; cat package.json` | none: the model's own compound exploration line (not a GSD shape) | re-issued `ls src test .planning`, which was admitted, then read the project files with Read |

Whether a commit was attempted: **no**. The model never reached a commit step because it never ran the workflow (finding 1), so the executor's commit protocol was not exercised in this round.

Findings of round 1:

1. **The model did not run the quick workflow.** After the one denial it never read `quick.md`, ran no `gsd_run` verb, created no quick directory through GSD, spawned no subagent and ran no verifier. It made the one-line change in `src/slug.ts` itself, ran `npm test` (admitted as `agent-command`), wrote a `SUMMARY.md` and a table row in `STATE.md` by hand, and said so: "I didn't spawn the planner, plan-checker, executor or verifier agents that `--validate` normally runs. The change was one line". The round meets the letter of the plan's pass bar (SUMMARY present, `src/slug.ts` changed, HEAD at the pin, no write outside the write set, no `AskUserQuestion`) but it does **not** observe the real unit, so it cannot confirm A2. The run contract's `verification.gsdVerifier = required-passed` gate would have had nothing to read.
2. The skill did load (`avarice-run-skills:gsd-quick` is in the host's `slash_commands`, and the model knew `--validate`). The shortcut was the model's choice given only the task text.
3. **The host-level outcome kind is not a usable verdict for a run.** One improvised hook denial turned a finished, correct unit into `denied` (outcome rule 7) because `expectedFiles` was empty. Plan 02-13 must judge a unit from the quick directory, the clone diff and the gate results, not from `kind`, and must tolerate hook denials of improvised shell lines.
4. The `.planning/config.json` written by `config-set` is an untracked file in the clone before the unit starts; the snapshot used for "changed paths" is taken after `gsd:configure`, so it does not count. Plan 02-13 must snapshot after `gsd:configure` for the same reason.

Dispositions for round 1's single row: (d) left denied by design (a compound line of the model's own is `shell-syntax` for every purpose; it is not a GSD shape and no GSD source line issues it).

<!-- gsd:write-continue -->
