# Coverage ledger

This ledger tracks how much of the built system the `docs/system/` tree covers, against denominators counted at a pinned commit, and the review status of each document. Counts and dates live here, where drift is expected; the documents stay still. It is the hand-off: anything not listed as reviewed is not to be trusted yet.

## Denominators

Counted at commit `0632fd4` on 2026-11-06; recounted in the closing step of the documentation pass.

| Surface | Count | Command |
|---|---|---|
| CLI commands | 10 (`init`, `repo`, `onboard`, `start`, `supervise`, `status`, `inbox`, `resume`, `context`, `install-host`), plus bare `avarice` | `grep -n "COMMANDS =" src/cli/main.ts` |
| Hook entry points | 1 (PreToolUse, also serving post and config-change events) | `git ls-files src/hook` |
| `AVARICE_*` names | 15: 9 environment variables read (`AVARICE_RUN` among them, which is also set), 6 constants | `git grep -ohE "AVARICE_[A-Z0-9_]+" -- src bin \| sort -u`, classified by reading each site |
| Other environment variables read | 10 (`HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `NO_COLOR`, `TERM`) | `git grep -nE "process[.]env\|env[[]" -- src bin`, plus the passthrough lists in the GSD, graphify and host adapters |
| Profile config keys | 4 (all dead) | the single write site in the profile paths adapter |
| SQLite tables | 23 (21 with a writer, 2 without: `task_refs`, `approvals`) | `git grep "CREATE TABLE" -- src`; writers by `git grep -ohE "INSERT( OR [A-Z]+)? INTO [a-z_]+" -- src` |
| Event kinds | 28 | `git grep -h -o -E "type: '[a-z_]+[.][a-z_.-]+'" -- src \| sort -u \| wc -l` |
| Schema migrations | 2 | `ls src/adapters/sqlite/migrations` |
| Onboarding lifecycle states and transitions | 14 and 29 | the lifecycle module's state and transition lists |
| Run lifecycle states and transitions | 11 and 37 | `node --input-type=module -e` importing the run lifecycle module: `RUN_STATES.length`, `RUN_TRANSITIONS.length` |
| Run blocked reasons | 7 | the same import, `RUN_BLOCKED_REASONS.length` |
| Run step statuses | 6 | the same import, `RUN_STEP_STATUSES.length` |
| Work item states | 6 | the same import, `WORK_ITEM_STATES.length` |
| Ports | 11 (plus one shared descriptor) | `ls src/ports` |
| External systems | to be recounted | spawn sites: `git grep -nE "spawn\|execFile\|execSync" -- src bin` |
| Index steps | 3 | the index step registry |
| Hook rules | 33 distinct rule IDs (6 allow, 28 deny, one on both) | `grep -ohE "(return \|deny\(\|_RULE = \|\?\?= \|null : \|rule: \|rule: seen[.]agentCommand [?] )'[a-z]+([-:_][a-zA-Z]+)*'( : '[a-z-]+')?" src/domain/hook-decision.ts src/hook/pre-tool-use.ts \| grep -oE "'[^']+'" \| sort -u \| wc -l` |
| Source lines | 26,150 | `git ls-files src \| xargs wc -l` |
| Test files | 113 | `git ls-files test \| grep -c '\.test\.ts$'` |
| Import-boundary lint | passes (79 files) | `node scripts/check-boundaries.ts` |

## Documented counts

| Surface | Documented | Where |
|---|---|---|
| CLI commands | 10 of 10, all flags, 4 exit codes | cli-reference.md |
| Environment variables read | 15 of 15 `AVARICE_*` names and 10 of 10 other names | config-reference.md |
| Profile config keys | 4 of 4, marked dead | config-reference.md |
| Onboarding lifecycle states and transitions | 14 of 14, 29 of 29 | onboarding.md |
| Validation checks | 7 of 7 | onboarding.md |
| Run lifecycle states and transitions | 11 of 11, 37 of 37 | runs.md |
| Run blocked reasons, step statuses, work item states | 7 of 7, 6 of 6, 6 of 6 | runs.md |
| Run start refusal codes, overridable budget names, run GSD settings | 10 of 10, 7 of 7, 7 of 7 | runs.md |
| Run outcome kinds, decision classes, budget rows | 7 of 7, 4 of 4, 5 of 5 | runs.md |
| Evidence statuses, G2 rules, G4 rules, skip and focus markers, validation verdicts | 6 of 6, 8 of 8, 7 of 7, 12 of 12, 3 of 3 | checks-and-evidence.md |
| Shell actions, command names offered by completion | 7 of 7, 10 of 10 | interactive-shell.md |
| Read-only commands, denied prefixes, denied find actions | 11 of 11, 16 of 16, 10 of 10 | containment.md |
| GSD verbs | map 11, intel 14, run 14 | containment.md |
| Required settings keys, admitted host versions | 9 of 9, 4 of 4 | containment.md |
| Hook rule IDs | 33 of 33 | containment.md |
| Budgets | 5 of 5 for an onboarding, 5 of 5 for a run | containment.md, onboarding.md, runs.md |
| Index steps, absent reasons | 3 of 3, 16 of 16 distinct | indexes-and-context.md |
| Tables, event kinds, artifact kinds, ID prefixes, migrations | 23 of 23, 28 of 28, 7 of 7, 8 of 8, 2 of 2 | data-model.md |
| Ports, admitted host versions, run purpose agents, proxy responses | 11 of 11 (plus the descriptor), 4 of 4, 4 of 4, 5 of 5 | integrations.md |
| Flows traced, diagram sources | 5 of 5, 5 of 5 | processes.md |

## Per-document status

Reviewed means a second reader (a fresh-eyes reviewer) checked claims against the code and every finding was applied or answered. Every document that changed in the documentation pass for the unattended run is drafted until its fresh review has been applied.

| Document | Status | Review notes |
|---|---|---|
| overview.md | drafted | regrounded for the run slice; awaiting fresh review |
| cli-reference.md | drafted | regrounded for ten commands and the shell dispatch; awaiting fresh review |
| config-reference.md | drafted | regrounded for the run environment, the routine preset and the conventions readers; awaiting fresh review |
| onboarding.md | drafted | pointers to the run added, one claim about the pause outcome corrected; awaiting fresh review |
| runs.md | reviewed | claims verified across the start refusals, brief, conventions, contract, lifecycle, stages, resume and status; fixed the default roots, the two reasons at the enforcement check, the pause only for a delegated item, the inbox fields, the run events and sentence length |
| checks-and-evidence.md | drafted | new; awaiting fresh review |
| interactive-shell.md | drafted | new; awaiting fresh review |
| containment.md | drafted | regrounded for the run purpose, the proxy and the hook rules; awaiting fresh review |
| indexes-and-context.md | reviewed | 25+ claims verified; fixed rollback files, intel failure reasons, freshness check scope; no index or context file changed since |
| data-model.md | drafted | regrounded for the second migration, the run tables and the event kinds; awaiting fresh review |
| integrations.md | drafted | regrounded for the run ports, the proxy and the supervisor; awaiting fresh review |
| processes.md | drafted | five flows; the three run diagrams (run-to-ready.puml, run-resume-after-kill.puml, run-discard-retry.puml) and the two earlier ones are not rendered; awaiting fresh review |
| history.md | drafted | extended from `git log`; awaiting fresh review |
| README.md | drafted | opening, documents table and counterparts table updated; awaiting fresh review |
| findings.md | drafted | run slice lines added, annotated lines never deleted; awaiting fresh review |
| unknowns.md | drafted | run slice entries added; awaiting fresh review |
| coverage.md | ledger | counts re-run in the closing step |

## Outstanding

- A fresh review of every document marked drafted above.
- Rendering the five PlantUML diagrams; no render step exists in the repository.
- The owner's classification of every line in findings.md.
