# Round 2 dispositions

Author of the drafts: the plan executor. Each finding of the five round 2 reports (`round-2-A.md` to `round-2-E.md`) was checked against the code at `3e5e7d6` before it was acted on. Decisions: fixed (the document was edited), rejected (evidence that the reviewer was wrong), routed (a `docs/system/findings.md` line was written and the code left alone), no action (the reviewer accepted the text or the item is outside the rule). No finding was routed and no code was changed. Fix commits: A `b1f3493`; B `6042f14`; C `2819cab`; D `ca79f98`; E `b657196`; coverage marks `38d89eb`.

## Group A: autonomy-and-decisions.md, findings.md, unknowns.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| A | W1 | fixed | Confirmed: `src/app/run-start.ts` refuses at `:177`, `:189`, `:194`, `:212` and `:233`. The inline numbers on the `run-start.ts:175` line now read 177, 189, 194, 212 and 233. |
| A | W2 | fixed | The snapshot-null branch is at `src/app/run-stages/item.ts:594`. The clone HEAD is read at `:608` and the moved-HEAD breach check is `if (head.value !== snapshot.value.head)` at `:634`. Both inline numbers on the `item.ts:314` line are re-pointed. |
| A | W3 | fixed | The host-refusal split is `hostRefused` at `src/app/run-stages/item.ts:1156`. The line that turns an unavailable or denied host error into an enforcement failure is `const enforcement = ...` at `:1191`, used by the `blockRun` at `:1196`. The inline number is now `:1191`. |
| A | W4 | fixed | Confirmed: the `'harden'` check in `upsertWorkItem` is at `src/adapters/sqlite/ledger.ts:1294`. The inline number now reads 1294. |
| A | O1 | fixed | The final-proof revision is measured at `src/app/run-stages/finish.ts:121` to `:126` (`revisionOf` at `:126`). The line now says "lines 121 to 126". |
| A | O2 | rejected | `src/adapters/proc/ancestry.ts:56` is `let current = pid;`, the start of the parent walk that the line describes (`processAncestry` begins at `:52`, the loop at `:57`). The citation points into the walk and the claim holds. |
| A | O3 | fixed | The unadmitted-version refusal is `refuse('host-version-not-admitted:...')` at `src/adapters/host-claude/launch-preflight.ts:143`; `:140` is the probe failure. The annotation now says `:143`. |
| A | O4 | no action | The reviewer accepted the gap wording. |
| A | sweep | fixed | The sweep covered every parenthetical line number, bare `:N` and `lines N to M` in findings.md, and every file-qualified citation whose line content differs between `fc15fea` and HEAD. Five more stale inline numbers of the same class were found and fixed. The four blocked reasons of `run-lifecycle.ts` are at lines 28 to 31, not 27 to 30. The recogniser range of `outcome.ts` ends at `:120`, not `:115`. `COMMANDS` is at `src/cli/main.ts:17`, not `:12`. The shell command line that is recorded in history is at `src/cli/shell/actions.ts:246`, not line 69. The run environment builder is at `src/adapters/host-claude/env.ts:36`, not `:26`. |
| A | autonomy-and-decisions.md, unknowns.md | no finding | Verdict pass. The status mark under the title of autonomy-and-decisions.md was removed. |

## Group B: runs.md, processes.md, three diagrams, data-model.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| B | F1 | fixed | Confirmed: `src/domain/response-validation.ts:111` returns `apply` for a withdraw before the digest comparison at `:113`. In `run-decide-resume.puml` the withdraw branch now stands before the moved-state branch, with the guard "applied whatever the state digest says". Step 4 of the decide flow in processes.md names the exception. |
| B | F2 | fixed | Confirmed: `notifyRunStop` computes `quiet` (`src/app/notify.ts:114`) and `raise` holds the rows when it is true (`:150` to `:160`). The stop in `run-decision-independent-work.puml` now splits into a banner outside quiet hours and a hold for the next digest inside them. Step 6 says the same. |
| B | O1 | fixed | The three data-model.md sentences were split at their semicolons. No claim changed. |
| B | O2 | fixed | "in practice" removed from the runs.md line on a run blocked for a reason other than `decision`. |
| B | O3 | fixed | Confirmed: `src/cli/commands/decide.ts:197` to `:208` checks the owner, then `findDecision`, then the host configuration directory. Step 2 and the first section of the diagram now read the decision to find its run before the directory refusal, and read the latest contract after it. |
| B | O4 | fixed | The note now says that every refusal above, in both sections, ends with its message to the owner. |
| B | O5 | fixed | Confirmed: `pickupOf` (`src/app/decide.ts:77` to `:81`) gives `none` for a blocked run that is not continuable, whatever its lease. The first pickup branch is limited to a run that is not blocked or is continuable, the third names the blocked run with decisions still open, and the closing message reads "exit 0 (answered or withdrawn)". Step 6 carries the same limit. |
| B | extra | fixed | The G2 table of runs.md carried the same defect as group C W1 below: its row "Anything else" gave `acceptance` for a repair unit too. It is split into a unit that is not a repair (`acceptance`) and a repair unit (`repeated_failure`), from `src/app/run-stages/item.ts:1551`. This is a behaviour edit to runs.md after its pass, so runs.md is not marked reviewed. |

## Group C: checks-and-evidence.md, containment.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| C | W1 | fixed | Confirmed: `src/app/run-stages/item.ts:1551` gives a failed repair unit the `repeated-failure` signal, and only scope or deletion failures leave it for a run-wide block (`:1540` to `:1547`). The G2 paragraph says that a scope or deletion failure blocks the run, that the rest open `acceptance` for a unit that is not a repair, and that any other failure of a repair unit opens `repeated_failure`. |
| C | OBS plan-within-spec | fixed | `g1Decision` (`src/app/run-stages/item.ts:1706` to `:1710`) uses the scope signal for `plan-within-spec` too. The G1 text now says "outside the contract or outside the item's spec files". |
| C | OBS openings | no action | The first sentences of both openings are module lists, which the project rule requires in the opening. The reviewer accepted the carve-out. |
| C | OBS containment enumerations | no action | The reviewer found the Allow and Deny lists and the line at 269 pre-existing since `fc15fea` and passed the document. They were not edited, so the pass stands. |
| C | OBS attribution wording | no action | The reviewer found the simplification not wrong and "Any doubt keeps the pause" covers it. |

## Group D: cli-reference.md, interactive-shell.md, config-reference.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| D | W-A | fixed | The ten sentences were split or reworded: cli-reference.md lines 100, 284, 411, 432, 467, 477 and 694, interactive-shell.md line 112 and config-reference.md line 383. The cli-reference.md line 600 sentence is 15 words; the heuristic joined it to the next sentence, which began with the lowercase product name `launchd`, so that sentence now begins "It runs under launchd". A length scan of every changed line finds no new sentence over 35 words. |
| D | O-1 | fixed | Confirmed: `BRIEF_LIMITS.items` is 20 (`src/domain/brief.ts:62`, error at `:234`). The Brief file row of config-reference.md now lists "at most 20 work items". |
| D | O-2 | fixed | "Both gates prevent: the shell never opens." and "does not run in practice" were removed from the interactive-shell.md paragraph on the second refusal. |
| D | O-3 | rejected | The sentence at cli-reference.md:345 is the current guarantee that the round 1 fix put in place of previous-output narrative, and the field table does not say that `items`, `decisions` and `notifications` are always present. It stays. |

## Group E: integrations.md, overview.md, README.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| E | W-A | fixed | Confirmed: `src/adapters/git/run-workspace.ts:232` runs `log -1 --format=%P%n%B`. The run workspace row now lists that argument list with the note "the parents, then the message". |
| E | W-B | fixed | The opening sentence of overview.md was ended after "fail-closed hook", and a second sentence says the clone is a staging clone for onboarding and a run clone for a run. |
| E | OBS-1 | no action | A list item in the macOS sandbox rules; the campaign did not touch it and the reviewer called the change optional. |
| E | OBS-2 | no action | Vendor behaviour that cannot be checked offline; the text already says "as observed on 2.1.316 to 2.1.319". |
| E | README.md | no finding | Verdict pass. |

## Routed to the owner

None. The routed items of round 1 stand: `src/domain/notify-policy.ts:215`, `src/domain/decision-policy.ts:279` and `src/adapters/proc/ancestry.ts:56`.

No code was changed.
