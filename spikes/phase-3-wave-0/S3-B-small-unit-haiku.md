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

Measured 2026-11-09 on Claude Code 2.1.319, plan 03-27's item A (small, no model) alone on a generated scratch repository, `--model haiku` chosen by size. Sources: the two lines of `test/containment/live-small-probe.jsonl` (cited as "probe line 1" and "probe line 2"), the spend ledger `test/containment/live-spend-phase3.jsonl` (plan `03-35`), and the two transcripts under the macOS temporary directory (`avarice-cli-49yPtu` for run 1, `avarice-cli-ngQJYp` for run 2; each `tool_use` is a call, each hook refusal the `tool_result` text `avarice: <rule>`). The judge reads the ledger, the launch-model log, the host's init event, the clone's commits and the transcript's Write calls; no model text is in the lines.

Plan 03-35 ran probe-small-1 twice (the tracer's one permitted re-run) and stopped at its decision checkpoint, because both runs failed fact 3. Probe-small-2 and probe-small-3 were not run, by owner decision (below).

### Results

| Run | Run ID | Verdict | Cost (USD) | Duration | Tool calls | Agent calls by type | Hook denies by rule | Probe line |
|---|---|---|---|---|---|---|---|---|
| 1 | `run_01M70QY9KAA9ABJ2274FDJSY3R` | FAIL, fact 3 (and fact 5, see the note) | 0.1019 | 503.0 s | 76 | planner 2, plan-checker 2, executor 1, verifier 1 | `shell-syntax` 1, `shell-not-allowed` 1 | 1 |
| 2 | `run_01M70RGRVDPC6QNHXN5F5TMVJP` | FAIL, fact 3 | 0.0819 | 643.7 s | 51 | planner 1, plan-checker 1, executor 1, verifier 1 | `shell-syntax` 1 | 2 |

Both runs: state `ready_for_review`, item A `done`, exit 0, no decision row, no `loop.limit` event, G0, G1 (A), G2 (A) and G4 passed, one invocation (kind `denied` only because it met a refusal; status `completed`), launch flag, `launch:run` step and init model all haiku (`claude-haiku-5-5`), cost within the 0.30 USD haiku cap (`withinHaikuCap` true). The review banner failed `osascript-missing` three times, as the quiet profile intends. Cost is far inside the 0.30 USD cap and inside the 0.05 to 0.15 USD the plan expected.

The judge's six facts, per run:

| Fact | Run 1 | Run 2 |
|---|---|---|
| 1 Model: launch flag, `launch:run` step and init event are haiku | pass | pass |
| 2 Run `ready_for_review`, item A `done` | pass | pass |
| 3 Exactly one commit on the pin, files `src/shout.ts` and `test/shout.test.ts` | **fail**: the one commit also holds `test/slug.test.ts` | **fail**: the same extra file |
| 4 G1 and G2 for A passed, A has passed check evidence | pass | pass |
| 5 A PLAN, a SUMMARY and a VERIFICATION with status passed | pass as re-judged (see the note) | pass (`quickRecordsWritten` all true, classify step `passed`, summary present) |
| 6 No decision row, no `loop.limit` event | pass | pass |

Fact 5, run 1 note: probe line 1 records fact 5 as failed (`no PLAN under .planning/quick`). That was the first version of the judge, which looked for the records in the clone; the unit's quick records are archived out of the clone before the commit (D-17), so the clone cannot show them. The judge was corrected (commit `61a9186`: it now reads the host's Write calls and the classify step) with no change to a cap, the spec or any other fact, and run 2 was judged by the corrected judge. Run 1's transcript shows the three Writes (`261109-a01-PLAN.md`, `-SUMMARY.md`, `-VERIFICATION.md`) and the VERIFICATION content carries `status: passed`; line 1 was not rewritten.

### What each run did

- **Run 1.** Its first call, a compound `ls`, was refused (`shell-syntax`); it then used Read twice (the clone's `quick.md`, which does not exist, and the global one). It wrote the quick PLAN, started the planner twice, the plan-checker twice, the executor and the verifier through the Agent tool. One subagent's `grep` was refused (`shell-not-allowed`) and was followed by a Read. Each refusal was followed by a corrected call of the admitted form; there was never a second refusal in a row.
- **Run 2.** It ran six admitted calls, then one compound `grep` refused (`shell-syntax`), then Grep (not available in the session, see below), then a Read. It ran the workflow once through each of the four agents.
- **Observation, not a failure: the host has no Glob or Grep tool.** Run 2's transcript has three `tool_result`s `No such tool available: Glob` / `Grep ... find files with find via the Bash tool instead`. The unit prompt of plan 03-34 tells the unit to use the Read, Grep and Glob tools. The unit recovered each time (the next call was admitted); but each error costs a turn, and the host's advice (use `find` or `grep` through Bash) points at `grep`, which the hook does not admit (`READ_ONLY_COMMANDS` lists `find` and no `grep`; the refusals at run 1 call 39 and run 2 call 7 were `grep` lines). This is a text-versus-host mismatch in the prompt that plan 03-34 wrote; it is a candidate finding for the owner, not a change made here.

### Verdict on plan 03-34's prediction

**Confirmed, with one exception that is not about the prediction.** The prediction was that, with the rules stated and the contradiction removed, a haiku unit runs the quick workflow by starting the planner, plan-checker, executor and verifier, or ends with a question the run can show, and not with a refusal loop. In both runs the haiku unit started all four agents, finished the item with its own commit, passed G1 and G2, hit one or two refusals each and corrected each one, opened no decision and reached no loop limit, for 0.0819 and 0.1019 USD (against the 0.0040 and 0.0152 USD of the two failed 03-27 units, which ended before the work, and the 0.88 to 0.90 USD of a sonnet unit). The exception is fact 3: in both runs the one commit also changed `test/slug.test.ts`.

**Cause of the fact 3 failure (from the clone, the transcripts and the brief).** The probe brief is made with `itemsBriefText` (`test/helpers/run-fixtures.ts`), whose fixed "Behavior" section reads "A slug never contains two dashes in a row, and the slug rules are covered by tests." The probe uses only item A (a `shout` helper), but that sentence stays in the brief. Both units read it as part of the task: run 1 wrote `test/slug.test.ts` with Write, run 2 used Edit on it and named its quick task directory `slug-no-double-dash`. `test/**` is inside the brief's write set, so the edit is contained (no hook or gate refused it); it is outside what the probe judge expects of item A alone. The cause is the shared brief text and not haiku's reliability, and it is not a refusal problem.

### Owner decision at plan 03-35 Task 3 (2026-11-09)

- **Owner:** the project owner, through the orchestrator's `<user_response>` for this continuation.
- **Option:** `proceed-haiku` (keep haiku for small items; D-10 and RC-8's size-to-model map unchanged; run plan 03-36 as planned).
- **Rationale, as given:** the 03-34 fix removed the reliability failure (the whole workflow completed, no refusal loop, about 0.09 USD per unit); the extra `test/slug.test.ts` edit is attributed to the probe brief's fixed text and stayed inside the write set.
- **Scope of the decision:** the owner did not ask for probe-small-2 or probe-small-3 and asked that no other live case run in plan 03-35, so two of the three probes in the plan's reliability bar were not run. The bar of "three runs, none failed" was therefore not met; the owner accepted the two-run measurement. Nothing under `src/` or `docs/system/`, `ROUTINE_PRESET` or any cap changed.

### For plan 03-36 and the documentation plans

Plan 03-36's cases that are built with `itemsBriefText` carry the same "Behavior" sentence, so a small item may again touch `test/slug.test.ts`, and a judge that expects an exact file list for the commit will fail for the same reason. The cases' judges should expect that file or the cases should be given a brief text without the sentence (a test-side choice; plan 03-36's plan is not edited here). The Glob and Grep mismatch above should be on the findings list the documentation plan writes.
