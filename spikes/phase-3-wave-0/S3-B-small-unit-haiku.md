# S3-B: why a small work item on haiku did not complete in plan 03-27 (plan 03-34; RC-8, AUT-3)

Written before any fix, from the two live runs of plan 03-27's tracer `s17-s51` (no model call, no spend in this plan).
Sources: the results lines of `test/containment/live-run-phase3.jsonl` (cited as "results line 1" and "results line 2"), the two evidence directories and their `transcript.jsonl`, the spend ledger `test/containment/live-spend-phase3.jsonl`, and the prompt and hook code at the head the gap plans were written at.
Evidence check (2026-11-09): both evidence directories still exist under the macOS temporary directory (`avarice-cli-23lLFx` for run 1 and `avarice-cli-H0Af0r` for run 2). Every fact below was read from the two transcripts (each `system/init` event starts one invocation; each `tool_use` is a call; each hook refusal is the `tool_result` text `avarice: <rule>`), and each agrees with the results lines.

## 1. What failed

| Run | Run ID | Results line | Cost (USD) | State | Item A (small, haiku) |
|---|---|---|---|---|---|
| 1 | `run_01M70E7HYWA93MNGJADABXFCQC` | 1 | 1.4970 | `blocked_on_decision` | `blocked_on_decision`; decision class `repeated_failure`; 3 tool calls, 3 hook refusals; 4 turns, 0.0040 USD |
| 2 | `run_01M70EN23R03Y3VWQB7C02Y8B6` | 2 | 1.9591 | `blocked_on_decision` | `blocked_on_decision`; decision class `permission`; 10 tool calls, 2 hook refusals; 11 turns, 0.0152 USD |

B (sonnet), C (opus) and D behaved as S-17 says in both runs. Only A did not complete, and it did not complete twice.

## 2. Evidence: haiku, item A

### Run 1 (invocation 1 of the transcript, model `claude-haiku-5-5`)

| Call | Tool | Input (the command, shortened) | Hook answer |
|---|---|---|---|
| 1 | Bash | `(test -f .claude/gsd-core/workflows/quick.md && echo PROJECT \|\| (test -f ~/.claude/... && echo GLOBAL \|\| echo NONE)); ls -la; ls .planning 2>/dev/null; cat package.json 2>/dev/null` | `avarice: shell-syntax` |
| 2 | Bash | `pwd; ls -la; ls .planning 2>/dev/null; cat package.json 2>/dev/null` | `avarice: shell-syntax` |
| 3 | Bash | `pwd` | `avarice: shell-not-allowed` |

Three refusals in a row. The third reached the loop limit (`ROUTINE_PRESET.escalation.consecutiveDenials`, 3, CON-14), the invocation stopped with 4 turns and no edit, and the run opened a `repeated_failure` decision. The model was never told what the hook admits: each refusal read only `avarice: <rule>`.

### Run 2 (invocation 1 of the transcript, model `claude-haiku-5-5`)

| Call | Tool | Input (shortened) | Hook answer |
|---|---|---|---|
| 1 | Bash | `ls -la .claude/gsd-core/workflows/quick.md ~/.claude/gsd-core/workflows/quick.md 2>&1; ls -la .planning 2>&1; cat package.json 2>&1 \| head -40; ls src test 2>&1` | `shell-syntax` |
| 2 | Bash | `ls -la .claude/gsd-core/workflows/ ; ls -la .planning ; ls src test` | `shell-syntax` |
| 3 | Read | the clone's `.claude/gsd-core/workflows/quick.md` (no such file) | allowed (resets the denial run) |
| 4 | Bash | `ls -la` of the global gsd-core workflows directory | allowed |
| 5 | Read | the global `quick.md` | allowed |
| 6 | Bash | `npm test` | allowed (the contract command) |
| 7-10 | Read, Bash, Read, Read | `package.json`, `ls -R src test .planning`, `src/slug.ts`, `test/slug.test.ts` | allowed |

Its final message (11 turns) said it had made no edit and stopped before the planner: the workflow's `init.quick` step, "plus its `mkdir`, `git`, and `gsd-tools` calls, are not in your allowed commands, which list only `npm test`", running them "would break your allowlist, and I won't do the change by hand instead". It asked whether to allow them. That became the `permission` decision.

## 3. The same prompt on sonnet and opus

| Unit | Refusals | What it did next |
|---|---|---|
| B, sonnet (run 1) | none (no tool call; it asked the owner the AC2 question) | paused, as designed |
| B, sonnet (run 2) | 1 (`shell-syntax`) | corrected to `ls <one path>`, `ls`, a Read of the global `quick.md`, `ls src`, then asked the AC2 question |
| C, opus (run 1) | 6: `shell-syntax` 5 (two compound `ls` lines, and `npm test 2>&1 \| tail` three times, each followed by the plain `npm test`), `shell-not-allowed` 1 (an attempted `node .../gsd-tools.cjs query init.quick`) | read `quick.md`, said "gsd-tools is blocked by the run's command allowlist (only `npm test` permitted), so I'll derive init values manually and proceed with the agents", chose the quick directory itself, wrote the plan with the Write tool, and started the planner, plan-checker, executor and verifier with the Agent tool; finished with a commit-ready change |
| C, opus (run 2) | 2 (`shell-syntax`) | the same: "Bash is restricted to `npm test` here, so I can't run the gsd-tools helper. I'm working out the workflow values myself and starting the planner" |

Sonnet and opus met the same refusals (1 to 6 per unit) but never three in a row, because an admitted call (a Read, a single `ls`, `npm test`) came between them, and both resolved the prompt's contradiction (below) by working the workflow out themselves. Spike S2-B round 2 (Phase 2, sonnet) did the same. No live unit has ever run a `gsd_run` verb. Haiku did neither: in run 1 the loop limit ended it before it could correct itself, and in run 2 it read the contradiction literally and stopped.

## 4. The prompt and the hook that produced it

- The unit prompt (`contractText` in `src/app/run-gsd-config.ts`) lists the contract's commands under "Commands you may run, exactly as written:" (for this brief only `npm test`), then `RUN_WORKFLOW_SENTENCE` ("Run the whole quick workflow in validate mode ... Do not make the change by hand instead of the workflow."), then `RUN_NO_COMMIT_SENTENCE`. It names no read-only command, no one-command-per-call rule, and nothing about the workflow's own gsd-tools, mkdir and git steps.
- The quick workflow (`~/.claude/gsd-core/workflows/quick.md`) runs `init.quick` through gsd-tools, makes its task directory with `mkdir`, and commits with git. None of that is in the run's command list: `gsd_run` verbs need the fingerprinted preamble, `mkdir` and `pwd` are in no admitted list, and `git add` and `git commit` are denied (`DENIED_COMMAND_PREFIXES`; the supervisor commits, D-03).
- The hook (`decideShell` in `src/domain/hook-decision.ts`) denies with `deny(rule, GIT_RULE_REASONS[rule])`. Only `shell-git-output` and `shell-git-object` carry a reason, so `shell-syntax` and `shell-not-allowed` reach the model as the bare text `avarice: shell-syntax`.
- The loop limit (`trailingDenials` in `src/hook/pre-tool-use.ts`) counts every consecutive denial of the invocation, the subagents' included.
- What the hook does admit, per invocation: the contract commands by exact words, `READ_ONLY_COMMANDS` (`ls`, `cat`, `head`, `tail`, `wc`, `find`, `git ls-files`, `git log`, `git rev-parse`, `git status`, `git show`) with operands that pass the read rules, and `gsd_run` read verbs only after the preamble. It refuses `;`, `&`, `&&`, `||`, `<`, `>`, `$`, backticks, parentheses, backslash, newline, a word starting with `~` or `#`, and an unquoted `*`, `?`, `[` or `{` (docs/system/containment.md, "Command identity (Bash)", rules 5 and 9).

## 5. Diagnosis

Three causes, in the order they bit.

1. **The prompt contradicts itself.** It says to run the whole quick workflow and, in the same text, lists one command the unit may run. The workflow's spec needs gsd-tools, mkdir and repository-changing git steps. Read literally the two cannot both hold. Haiku read them literally and stopped (run 2); sonnet and opus improvised.
2. **The shell rules are never stated.** The unit does not know that one plain command per call is the form that passes, which read-only commands exist, or that the Read, Grep and Glob tools cover reading and searching. It reaches for the compound `ls; cat ... 2>/dev/null` lines that a developer's shell takes without thought.
3. **A refusal names a rule and nothing else.** `avarice: shell-syntax` does not say what is admitted instead, so the model retries a variant of the same shape. Three improvised lines in a row end the unit by the loop limit (run 1), whichever model wrote them.

The result is not a fault of haiku as such and not a flake of one run: the same prompt took two different models to a question and to a commit by their own improvisation, and took the smallest to a refusal loop and to a stop.

## 6. Alternatives considered and not taken

| Alternative | Why not |
|---|---|
| Raise the loop limit, or stop counting improvised compound lines (the S2-B suggestion) | It weakens CON-14. Stating the rules up front and in each refusal removes the trigger without loosening the control. |
| Admit `pwd` or `mkdir`, or the workflow's gsd-tools verbs | It widens the hook. The Write tool creates missing directories, and the unit has nothing to learn from `pwd` (the working directory is the repository root). |
| Change `modelBySize.small` (give the small item sonnet) | It is the owner's decision and D-10 locks it; owner decision 1 of 2026-11-09 asks for the cause to be fixed with the map kept. |
| Give item A an explicit model in the S-17 brief | A test-side quick fix; it hides the cause, and RC-8 would then have no haiku evidence. |
| Judge S-17 on B, C and D only | The same: it records the failure as a finding and fixes nothing. |

## 7. The fix (plan 03-34) and the prediction plan 03-35 tests

Fix, offline: the unit prompt states the run's shell rules as the hook enforces them, the read-only commands it admits, and the Read, Grep and Glob tools; it tells the unit not to run the workflow's gsd-tools, mkdir and repository-changing git steps and not to stop because of them, and to create files with Write and start the four agents with the Agent tool; the hook's `shell-syntax`, `shell-not-allowed` and `shell-denied-prefix` refusals carry a reason that says what is admitted; and the four run agents carry the same shell rules (their refusals count toward the same invocation's loop limit).

Prediction (plan 03-35 tests it live): with the rules stated and the contradiction removed, a haiku unit runs the quick workflow by starting the planner, plan-checker, executor and verifier, as sonnet and opus did, or, if it still declines, it ends with a question the run can show the owner and not with a refusal loop. If it does neither, plan 03-35 owns the decision checkpoint.

## Live probe (plan 03-35)

To be filled in by plan 03-35 with its measurements.
