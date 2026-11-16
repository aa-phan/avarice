# Round 1 dispositions

Author of the drafts: the plan executor. Each finding of the five round 1 reports (`round-1-A.md` to `round-1-E.md`) was checked against the code at `fe577bf` before it was acted on. Decisions: fixed (the document was edited), rejected (evidence that the reviewer was wrong), routed (a `docs/system/findings.md` line was written and the code left alone). No finding was rejected. Fix commits: A `96e0681`; B `16efe25` and `785107e`; C `3b44a3b`; D `a490bbb`; E `a67ad31`.

## Group A: autonomy-and-decisions.md, findings.md, unknowns.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| A | W1 | fixed, routed | Confirmed: `bannerText` lists ids (`src/domain/notify-policy.ts:215`) but no call passes `decisionIds` (`src/app/notify.ts:65`, `:212`, `src/app/digest.ts:48`). The banner bullet no longer says "at most three decision IDs" and says the digest banner has no run ID. A findings line records the unused ID support. |
| A | W2 | fixed | Confirmed: `withdraw` is a listed option and applies (`src/domain/response-validation.ts:77-79` and the `option-not-listed` guard at `src/app/decide.ts:134`). The amendment request text now says "an option key that is not listed, which is any key other than `withdraw`". |
| A | W3 | fixed, routed | Confirmed: `amendCommandFor` returns null for `permission` (`src/domain/decision-policy.ts:279`), and `src/app/amend.ts:60` still accepts such a decision. The authority paragraph now separates budget (answered by an amendment) from permission (no amend command, only `withdraw` from `decide`, an amendment by hand still possible). A findings line records the asymmetry as owner intent unknown. |
| A | W4 | fixed | `composition.ts:145` now at `:175` (the `migrate` call). The author re-checked every one of the 118 "(now at ...)" pairs against the code at HEAD. Eight more were wrong and are corrected: `composition.ts:23` now at `:30`; `launch-preflight.ts:122` now at `:113`; `claude-host.ts:333` now at `:244`; `claude-host.ts:152` now at `:157`; `launch-preflight.ts:58` now at `:68`; `launch-preflight.ts:136` now at `:140`; `launch-preflight.ts:233` now at `:237`; `0001-initial.ts` `(now :27)` now `:29` to `:30`. The re-point of `item.ts:626` to a closing brace was removed (the line already says the code no longer exists). Two unadorned moved citations were corrected too: `LIVE-CASES.md:319` now at `:334`, and the in-text "(line 166)" of the shell finding now "(line 175)". |
| A | W5 | fixed | All six sentences split (opening, Identity, state re-read, amendment preview, digest catch-up, schedule install). A word-count script over the new text finds none above 35 outside the opening. |
| A | W6 | fixed | "Resolved with this change" replaced by "Resolved at f1a4d8c" (checks listed for the unit, `git log -S`) and "Resolved at 9323ed3" (Glob and Grep on the launch line). |
| A | O1 | fixed | "at least two choice lines" added (`src/domain/decision-policy.ts:116`). |
| A | O2 | fixed | Urgency row now says it is always blocking as the run writes it and that the ledger also accepts `digest` (`src/adapters/sqlite/ledger.ts:1358`). |
| A | O3 | fixed | Confirmed that run-wide blocks also carry reason `decision` (`src/app/run-stages/finish.ts:245` and `:285`, and the preparation failures at `src/app/run-stages/prepare.ts:242`, where the reason comes from the failure). The paragraph now says "a block opened for one item's decision while the units run" and names the exceptions. |
| A | O4 | fixed | Blank line added before the amendment request heading. |
| A | O5 | fixed | The two lines with two leading citations now carry one lead citation and the second in the sentence. |
| A | unknowns.md | no finding | Verdict pass. Four sentences over 35 words in the new unknowns text were split anyway. |

## Group B: runs.md, processes.md, three diagrams, data-model.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| B | W1 | fixed | Confirmed: `src/cli/commands/decide.ts` `run()` refuses on `unhonouredHostConfigDir` (exit 3) before `answerWith`. processes.md step 6 lost the clause, step 2 names the refusal before any write, and the diagram has the refusal in "Who may answer" and no self-message in the spawn branch. |
| B | W2 | fixed | Confirmed at `src/app/run-stages/item.ts:1540-1556`: scope and deletion-scope failures call `blockRun`. processes.md step 10 and the diagram now separate item-local gate failures (park) from a run-wide block. |
| B | W3 | fixed | Confirmed in `flushDueNotifications` (`src/app/notify.ts:197-225`): rows are held only when the window has passed and it is quiet. Prose and diagram guards corrected. |
| B | W4 | fixed | Confirmed: `ownsProfile` runs first in `decide` `run()`. Steps and diagram reordered. |
| B | W5 | fixed | Confirmed: `checkDecision` (`src/app/amend.ts:92-104`) refuses a class outside the four amendable classes. processes.md, the diagram, the exit summary and data-model.md say so. |
| B | W6 | fixed | The single universal claim in data-model.md is replaced by one precondition list per operation (withdrawal and re-open, answer, amendment, cancel request). |
| B | W7 | fixed | Every sentence over 35 words that the phase added or changed in runs.md (37), processes.md (4) and data-model.md (6) was split. The opening module list of runs.md is kept (exempt). The "Several items" paragraph reads as a chain of short sentences and was left. |
| B | O1 | fixed | Diagram: stale, withdrawn and different-answer refusals are recorded as `decision.rejected`, and the different-answer branch is drawn. processes.md step 3 says the same. |
| B | O2 | fixed | Diagram order: launch checkpoint, then reserve. |
| B | O3 | fixed | Step 9 names both causes ("another item committed to a parked path or the path is modified now"). |
| B | O4 | fixed | "resolved" used in both the decide and the amend flows. |
| B | O5 | fixed | runs.md Lifecycle: a killed reconcile leaves the run `paused`. |
| B | O6 | fixed | runs.md Lifecycle: `blocked_on_decision` added when an answer made the run continuable. |
| B | O7 | fixed | Identity block is now one alt/else, and a note marks that the pickup follows only a withdraw or an applying answer (`785107e`). |
| B | O8 | fixed | "Kills are tested at 27 points and in separate suites." |
| B | extra | fixed | runs.md "At most ten" for `--add-write` was wrong (found through group D W1): the cap is 128 (`src/domain/amendment.ts:170`, `src/domain/brief.ts:61`). |

## Group C: checks-and-evidence.md, containment.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| C | W1 | fixed | Confirmed: `readText` returns invalid over the limit (`src/adapters/git/staging-base.ts:143`) and `readPlan` returns no plan (`src/app/run-stages/item.ts:1599-1606`). Sentence replaced. |
| C | W2 | fixed | Confirmed at `item.ts:1548-1551`: only `checksOnly \|\| isRepair` is `repeated_failure`. The paragraph now routes checks-only to `repeated_failure` or `budget` and points to the G2 table in runs.md for the rest. |
| C | W3 | fixed | Confirmed at `src/app/checks.ts:381`. Row now says no check `env`, the install adds its own variables. |
| C | W4 | fixed | Confirmed at `item.ts:1536-1551`. The table row and the repair text say the step is also written without a repair. |
| C | W5 | fixed | Sentences split in the sandbox section, the not-run paragraph, the baseline paragraph, G1 and the repair offer. The opening module list is kept (exempt). |
| C | W6 | fixed | Heading renamed "Item start reference", the one reference updated. |
| C | W7 | fixed, routed | The "cannot hide" wording is dropped. The paragraph says the walk follows parent pointers and that a reparented descendant has no supervisor on its chain and no test rules that out. A findings line records it (`src/adapters/proc/ancestry.ts:56`). |
| C | W8 | fixed | Confirmed at `src/adapters/gsd/agents-json.ts:53-57`. The bullet names the shell note on the four run agents, the executor note and the verifier note, and points to checks-and-evidence.md. |
| C | W9 | fixed | The six sentences split. |
| C | OBS repro | fixed | `diff.paths` now reads "the paths the item changed since its base" here and in runs.md. |
| C | OBS repair count | fixed | "never repaired again, unless an answered decision restarts the count" with a pointer to runs.md. |
| C | OBS PATH | fixed | "the gsd-core `bin` directory" (`src/adapters/host-claude/env.ts:42`). |
| C | OBS malformed policy | fixed | A name outside upper-case letters, digits and underscores is listed (`src/domain/conventions.ts:224`). |
| C | OBS owner recording | fixed | Only `decide` and `contract amend` record `owner:<name>`; `cancel` and `schedule` record none. |
| C | OBS question capture | fixed | One sentence added to the outcome classification text with a pointer to runs.md. |

## Group D: cli-reference.md, interactive-shell.md, config-reference.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| D | W1 | fixed | Confirmed: `BRIEF_LIMITS.listItems` is 128 (`src/domain/brief.ts:61`, used at `src/domain/amendment.ts:170`). Fixed in cli-reference.md, config-reference.md and runs.md. |
| D | W2 | fixed | `src/app/run-start.ts:256` writes one row per item. |
| D | W3 | fixed | Confirmed at `src/adapters/host-claude/avarice-run-skill.ts:37`. Quirk now names three owner commands. The same slip in integrations.md was fixed. |
| D | W4 | fixed | `--wait` is boolean for four commands. |
| D | W5 | fixed | Supervise Output gains the stderr line and the stop banner. Side effects and the Network bullet name the `osascript` banner. The Streams bullet already says every warning goes to stderr, so it was left. |
| D | W6 | fixed | Confirmed at `src/cli/render/run-view.ts:91`. Line form added. |
| D | W7 | fixed | Bullets separated. |
| D | W8 | fixed | All 16 sentences in cli-reference.md, the one in interactive-shell.md and the 6 in config-reference.md that the phase added were split. Openings of cli-reference.md and config-reference.md split. |
| D | W9 | fixed | The sentence about earlier output is replaced by the current guarantee. |
| D | O1 | fixed | `decide --wait` exit 70 when the run cannot be read (`src/cli/commands/decide.ts:120`). |
| D | O2 | fixed | The index note forms are listed, with the singular for one. |
| D | O3 | fixed | Pick-up row also covers a decision that names no item. |

## Group E: integrations.md, overview.md, README.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| E | W1 | fixed | Confirmed: the lint prints 99 files. The count is dropped and the line points to coverage.md, which owns it. |
| E | W2 | fixed | Confirmed at `src/cli/commands/decide.ts:96` and `src/cli/spawn-supervisor.ts:52-62`. `decide` named, the recorded `CLAUDE_CONFIG_DIR` added to the environment, the quirk updated, pointer to runs.md. |
| E | W3 | fixed | Confirmed at `src/adapters/gsd/agents-json.ts:53-57`. The section lists the notes by agent. |
| E | W4 | fixed | Confirmed at `src/app/run-stages/item.ts:1092-1094`. Pause routes the item, and the run continues. |
| E | W5 | fixed | Park, unpark and drop-park bullets and the missing git commands added, with a pointer to runs.md for when a park happens. |
| E | W6 | fixed | Notifications, amendments and the cancel request added to the ledger list. |
| E | W7 | fixed | Spawn-site list is a list; lines 90, 342 and 358 and overview line 40 split; README opening split. |
| E | W8 | fixed | The retry schedule and the three places are replaced by pointers to autonomy-and-decisions.md and cli-reference.md. The failure table row is shortened to match. |
| E | O1 | fixed | Sentence about a later push adapter removed (no source). |
| E | O2 | fixed | The notifier descriptor that composition does not record is stated. |
| E | O3 | fixed | Fallback to the default path when the settings cannot be read (`src/cli/composition.ts:290`). |
| E | O4 | fixed | README wording: a new document carries the mark, a changed one is `drafted` in coverage.md. |
| E | O5 | fixed | "As observed on 2.1.316 to 2.1.319". |

## Routed to the owner

- `src/domain/notify-policy.ts:215`: banner ID listing that no caller uses (intent unknown).
- `src/domain/decision-policy.ts:279`: a `permission` decision has no amend command while `contract amend` accepts it (intent unknown).
- `src/adapters/proc/ancestry.ts:56`: a descendant reparented to process 1 has no supervisor on its chain (no test shows a run cannot produce one).

No code was changed.
