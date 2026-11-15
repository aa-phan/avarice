# Round 3 dispositions

Author of the drafts: the plan executor. Each finding of the five round 3 reports (`round-3-A.md` to `round-3-E.md`) was checked against the code before it was acted on. Decisions: fixed (the document was edited), no action (the reviewer accepted the text, or the item cannot be checked offline), applied (an optional nit the reviewer left open was applied). No finding was routed and no code was changed.

Only group A forces another round: it holds citation WARNINGs, which the round rules treat as findings about code behaviour. Groups B to E have no BLOCKER and no WARNING; their documents passed, and the nits below are wording edits to documents that passed, so they trigger no further round. Commits: reports `06c0288`; findings.md `43d6ab8`; the wording nits `8ff2b56`; the dispositions, the review table and the coverage marks follow in the commit after these.

The full extraction behind the group A rows is `round-3-citation-check.py`, with its output and method in `round-3-citation-check.md`.

## Group A: findings.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| A | W1 | fixed | Confirmed: `src/cli/commands/resume.ts:19` is an import and the argument validation is `usage(io, 'exactly one onboarding or run ID is required')` at `:37`. The line now cites `src/cli/commands/resume.ts:37` with its full path. |
| A | W2 | fixed | Confirmed: the `STAGES` map without `planning` starts at `src/app/onboarding-service.ts:133` (`:145` was blank), the interruption test is `isResumable(latest.state)` at `src/app/status.ts:58` (the short name `status.ts:50` was ambiguous and pointed at a loop), and `planning` is listed at `src/domain/onboarding-lifecycle.ts:68`. All three are cited with full paths. |
| A | W3 | fixed | Confirmed: `untrusted: true` for non-code nodes is `src/adapters/context/gsd-graph.ts:123`; `:120` is `confidence`. |
| A | W4 | fixed | Confirmed: the `extraPath` comment is at `src/adapters/host-claude/env.ts:18` and the option at `:19`. The line cites `:18` to `:19`. |
| A | W5 | fixed | Confirmed: `ledger.ts:1197` is the contract version check of the evidence insert. The decision insert is the `INSERT INTO decisions` statement at `src/adapters/sqlite/ledger.ts:1371` (inside `openDecision`, `:1354`). Both the "now at" and the closing note now say `:1371`, and the duplicate closing note was dropped. |
| A | W6 | fixed | Confirmed: `docs/contracts-and-state.md:832` is a closing code fence; the retention table row "Check output artifacts, 30 days after run close" is `:862`. |
| A | W7 | fixed | `docs/containment.md:81` is `},`; the `registry.npmjs.org` entry is `:82`. |
| A | W8 | fixed | `docs/containment.md:84` is `"hooks": {`; the `avarice hook pre-tool-use --run <run>` command is `:85`. |
| A | W9 | fixed | `docs/containment.md:94` is blank; the paragraph on the four GSD hooks is `:95`. |
| A | W10 | fixed | `docs/containment.md:96` is blank; the environment allowlist paragraph is `:97`. |
| A | W11 | fixed | Confirmed: the `permissionMode` and subagent inheritance text is `docs/containment.md:207`; `:193` is the wall-clock row. |
| A | W12 | fixed | Confirmed: `docs/system/config-reference.md:159` to `:162` and `:169` are agent command and whole-file limit lines. The onboarding reader rows for `paths.read`, `commands` and `verificationByChangeType` are `:178` to `:181` and the sentence on the run reader is `:188`. |
| A | O1 | fixed | `src/cli/main.ts:75` is a closing brace. The line now cites the usage exit as `:76` to `:78` and its lead as `:76`. |
| A | O2 | fixed | `src/adapters/sqlite/db.ts:97` is a `catch`. The verdict check is `const verdict = checkSqliteVersion(version)` at `:100`; the line cites it. |
| A | O3 | fixed | Confirmed by search: no `process.on` or `process.once` exists in `src` or `bin`, and the only SIGTERM handling is the group kill of the host and the executor. The line now says that no handler for SIGTERM is installed in `src` or `bin`. |
| A | O4 | no action | The reviewer did not escalate the repeated reaping fact; the first line says it is repeated under the run slice. |
| A | O5 | fixed | A measure that counts every whitespace token (a citation is one word) and splits at full stops found 48 sentences over 35 words, among them the nine lines the reviewer named. Each was split at a semicolon or a conjunction, no claim changed. The result is 543 sentences, none over 35 words, by `round-3-sentence-check.py`. No list carve-out is kept. |
| A | sweep | fixed | The reviewer's 12 are the ones its sample reached. A full extraction (541 citations: 410 current, 130 superseded leads with a "now at", 1 named as gone) with every cited line read beside its claim found more of the same class, which were fixed. Examples: the `main.ts:35` lead (an import of a port), `repo.ts:12` (blank), `resume.ts:10` and `context.ts:11` (ambiguous short names), `args.ts:39` for unknown flags (a `positionals.push`), `register.ts:42`, `gsd-intel.ts:84`, `invocation.ts:32`, `knowledge-validation.ts:101`, `index-knowledge.ts:200`, `index-code-graph.ts:62`, `events.ts:63`, the migration header and column leads, `claude-host.ts:372` (blank), `launch-preflight.ts:1`, `existing-tooling-assessment.md:76`, `settings.ts:84`, `seatbelt-profile.ts:44`, `containment.md:134` and `:151`, the two hook leads that carried their re-point at the end of the line, `pre-tool-use.ts:24` and `db.ts:160`, the discard-step and stored-text leads, the `outcome.ts` range end, `notify.ts:47` and `decision-policy.ts:279`. After the fixes `verify` exits 0. |

## Group B: processes.md, the two diagrams, runs.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| B | OBS-1 | fixed | Confirmed: `startSupervisor` in `src/cli/commands/decide.ts` (`:95`, called at `:133` for the `spawn` pickup) returns 70 for a refused spawn or an unrecorded step, and under `--wait` the exit is 0 only at `ready_for_review`, otherwise 3 (`docs/system/cli-reference.md`, "Output and pick-up"). processes.md now adds that with `--wait`, or when the command spawns a supervisor, the exit follows the run or the spawn, and links `cli-reference.md#output-and-pick-up`. The closing message of `run-decide-resume.puml` carries the same note. |
| B | processes.md, run-decide-resume.puml | no further finding | pass-with-nits, fixed as above. |
| B | run-decision-independent-work.puml, runs.md | no finding | Verdict pass; the repair-unit row of the G2 table is confirmed. |

## Group C: checks-and-evidence.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| C | OBS-1 | fixed | The 55-word second sentence of the opening is split into three sentences of 32 words or fewer: the document, the topics and the gates. The module naming of the opening stays. |

## Group D: cli-reference.md, interactive-shell.md, config-reference.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| D | O-3 | applied | Round 2 rejected this nit (the field table does not say that `items`, `decisions` and `notifications` are always present). The orchestrator asked for the removal in round 3, and the table already marks the optional keys (`interrupted`, `cancelRequestedAt`, `checksNotRun`) as optional or "present only when", so an unmarked row is present. The sentence at the old line 345 is removed. |
| D | interactive-shell.md, config-reference.md | no finding | Verdict pass. |

## Group E: integrations.md, overview.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| E | OBS-1 | fixed | Rule 7 of the macOS sandbox section was 36 words. It is now two sentences of 23 and 13 words with the same meaning. |
| E | OBS-2 | no action | Vendor behaviour that cannot be checked offline; the text already says "as observed" and names the versions. |
| E | OBS-3 | fixed | Confirmed in `src/adapters/git/safe-git.ts`: `PATH` falls back to `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin` when empty (`:76`) and `LANG` to `C` (`:78`); the filter override also sets `filter.<name>.required` to `false` (`:161`). The git paragraph now says "(with defaults when `PATH` or `LANG` is empty)" and that `filter.<name>.required` is set to false. `HOME` has no default beyond an empty string, so it is not in the parenthesis. |
| E | overview.md | no finding | Verdict pass. |

## Routed to the owner

None. No code was changed.

## Still open for the next round

`docs/system/findings.md` is not marked reviewed. Its round 4 check is a fresh reviewer reading the file against the code, with `round-3-citation-check.md` as the author's evidence.
