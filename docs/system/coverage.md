# Coverage ledger

This ledger tracks how much of the built system the `docs/system/` tree covers, against denominators counted at a pinned commit, and the review status of each document. Counts and dates live here, where drift is expected; the documents stay still. It is the hand-off: anything not listed as reviewed is not to be trusted yet.

## Denominators

Counted at commit `40adc1f` on 2026-11-08. Every command below was re-run at that commit. Since the previous count the code changed in the hook's git rules, the settlement of budgets, the credential locations, the egress proxy, the run supervisor's lease handling and three git adapters. Of the counted surfaces only the source lines and the test files moved.

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
| External systems | 13 (12 used, `gh` proven unused) | spawn sites: `git grep -nE "spawn\|execFile\|execSync" -- src bin`, plus the registry traffic and the Claude configuration directory, classified by reading each site |
| Index steps | 3 | the index step registry |
| Hook rules | 35 distinct rule IDs (6 allow, 30 deny, one on both) | `grep -ohE "(return \|deny\(\|_RULE = \|\?\?= \|null : \|rule: \|rule: seen[.]agentCommand [?] )'[a-z]+([-:_][a-zA-Z]+)*'( : '[a-z-]+')?" src/domain/hook-decision.ts src/hook/pre-tool-use.ts \| grep -oE "'[^']+'" \| sort -u \| wc -l` |
| Source lines | 26,576 | `git ls-files src \| xargs wc -l` |
| Test files | 120 | `git ls-files test \| grep -c '\.test\.ts$'` |
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
| Hook rule IDs | 35 of 35 | containment.md |
| Budgets | 5 of 5 for an onboarding, 5 of 5 for a run | containment.md, onboarding.md, runs.md |
| Index steps, absent reasons | 3 of 3, 16 of 16 distinct | indexes-and-context.md |
| Tables, event kinds, artifact kinds, ID prefixes, migrations | 23 of 23, 28 of 28, 7 of 7, 8 of 8, 2 of 2 | data-model.md |
| Ports, external systems, admitted host versions, run purpose agents, proxy responses | 11 of 11 (plus the descriptor), 13 of 13, 4 of 4, 4 of 4, 6 of 6 | integrations.md |
| Flows traced, diagram sources | 5 of 5, 5 of 5 | processes.md |

## Per-document status

Reviewed means a second reader (a fresh-eyes reviewer) checked claims against the code and every finding was applied or answered. Each reviewer bounced its first draft except one; the fixes were applied from the reviewer's code evidence, and no document was bounced twice.

| Document | Status | Review notes |
|---|---|---|
| overview.md | reviewed | boundary, import map and run ports verified; fixed the lint description, the adapter count claim and one long sentence |
| cli-reference.md | reviewed | ten commands, flags, exit codes and output forms verified; fixed the `inbox` exit codes, placement rules, the stdout exception of the wait line and the project registration claim; the output-style paragraph (stripped character set, onboard and resume lines) was re-reviewed fresh (two rounds, see 02-35-reviews) against the style module and the three commands, and fixed the sentence length and the naming of the marks |
| config-reference.md | reviewed | environment variables, preset values, conventions keys and limits verified; fixed the reserved-name claim and the ignored-entry cap; the credential-location wording and the registry host rules were re-reviewed fresh with integrations.md (three rounds, see 02-35-reviews) against the conventions reader and the proxy, and fixed the sentence length and the repeated private-network limit |
| onboarding.md | reviewed | pause outcome, lease and resume pointers verified; fixed long sentences |
| runs.md | reviewed | claims verified across the start refusals, brief, conventions, contract, lifecycle, stages, resume and status; fixed the default roots, the two reasons at the enforcement check, the pause only for a delegated item, the inbox fields, the run events and sentence length; the paragraphs on a supervisor superseded after the discard checkpoint and on the fenced reconcile record were re-reviewed fresh (two rounds) against the discard stage, the ledger fence checks, the resume command and the stale-fence fault test, and fixed the ordering, the scope of "records nothing" and the removed list; the added sentence on which pause signals the Claude host can produce was re-reviewed fresh (three rounds, see 02-25-reviews) against the pause detection and the host outcome, and fixed the wording of what the host hands over; the lease-loss abort, the unreapable-launch stop, the gated-commit parent check and the SIGTERM quirk were re-reviewed fresh with processes.md and data-model.md (two rounds, see 02-35-reviews) against the supervisor, the item stage, the resume prelude and the host adapter, and fixed the exit code of a lost lease, the host's lack of a wall clock after a SIGTERM and sentence length |
| checks-and-evidence.md | reviewed | install, validation, baseline, inventory, evidence statuses and both gates verified; fixed the inventory status mapping, the duplicated sandbox posture and the revision wording; the redaction of check output and its limit were re-reviewed fresh with runs.md (two rounds, see 02-35-reviews) against the check runner and the secret patterns |
| interactive-shell.md | reviewed | dispatch, views, actions, line editor and history verified; fixed the line-mode menu, the full-screen only statements, the Ctrl-C claim and the watch view ending; the one sentence on stripped characters, now a link to the output-style paragraph, was re-reviewed fresh with cli-reference.md (two rounds, see 02-35-reviews) against the shell's use of the style module |
| containment.md | reviewed | launch checks, hook rules, scopes, executor, proxy and git safety verified, 35 rule IDs; fixed the prevention and detection labels, the gate table row, the safe git row and the validation network claim; the git object and output rules (12 and 13), the check order, the rule count, the Limits bullet on secret files read by contract-command code (against the generated sandbox settings) and the Quirks bullet were re-reviewed fresh (twelve rounds, see 02-26-reviews) against the hook code and real git, and fixed a wrong check order, the abbreviated-option example, the symlink exception, sentence length and the object-store wording; the as-written match of object names (rule 12), the check order, the corrective reasons, the settlement in one transaction with the no-result charge, the credential locations, the proxy address check and host rules, the lease-loss sentence of the host paragraph and the Limits and Quirks bullets were re-reviewed fresh (three rounds, see 02-35-reviews) against the hook code, the ledger settlement, the credential list and its sandboxes, the proxy and the supervisor, and fixed the address ranges and the IPv6 forms the proxy refuses, the reason for the startup charge, what a kill leaves for the next reservation, which invocations are charged their reported cost, the signal a run passes to the host, repeated statements and sentence length |
| indexes-and-context.md | reviewed | 25+ claims verified; fixed rollback files, intel failure reasons, freshness check scope; no index or context file changed since |
| data-model.md | reviewed | passed its fresh review with no findings: tables, columns, indexes, triggers, 28 event kinds and files on disk verified; the added fence exception for the failed reconcile step and the quirks bullet were re-reviewed fresh (two rounds) against the ledger fence checks, and fixed one sentence over the length cap; the added budgets bullet on one-transaction settlement was re-reviewed fresh with runs.md (two rounds, see 02-35-reviews) against the ledger and the budget service |
| integrations.md | reviewed | ports, adapters and external systems verified; fixed the descriptor claim, the `install-host` exit codes, the discard wording, the launch refusal reasons and the duplicated install detail; the proxy table and paragraph, the commit-id and SHA-256 refusal, the slash-only path split, the parents read back with the trailers, the reap difference between an onboarding and a run, the credential-location wording and the private-network quirk were re-reviewed fresh (three rounds, see 02-35-reviews) against the proxy, the git adapters, the register and workspace stages and the resume code, and fixed the direction of the test resolver, the IPv6 forms, the onboarding refusal point, repeated statements and sentence length |
| processes.md | reviewed | five flows traced against the code; the three run diagrams (run-to-ready.puml, run-resume-after-kill.puml, run-discard-retry.puml) and the two earlier ones read but not rendered; fixed the host-error branch, the spent-budget order and the kill-point citation; the settlement steps, the run-resume reap step and the run-resume diagram's reap branch were re-reviewed fresh with runs.md (two rounds, see 02-35-reviews) against the invocation, budget and resume code, and fixed the diagram branch, the scope of the settlement transaction and one term for the reserved cost |
| history.md | reviewed | commits and dates spot-checked; fixed the counts (pinned to the end commit), the quoted commands and the delivery labels |
| README.md | reviewed | both tables checked against the files and the proposals; fixed the sentence length and the scope of the counterpart claim |
| findings.md | reviewed | every line added since the pass began checked at its cited line; fixed the wrong citations and annotated the moved ones; the three lines on the attended sessions and the annotated `docs/extensions.md:215` line were re-reviewed fresh (three rounds) against the code and the session record, and fixed two accuracy claims, the routing citation, sentence length and a delivery-history hash; the three added lines on the git object bypass, the symlink gap and the sandbox read denial, and the moved hook-decision and settings citations, were re-reviewed fresh with the containment.md changes (twelve rounds, see 02-26-reviews) and fixed the overstated proposal line and the anchors; the six new lines, the removed and reworded lines and the `(now at file:line)` annotations of the gap-closure pass were re-reviewed fresh with containment.md (three rounds, see 02-35-reviews) by spot-checking dozens of annotations against the current files, and fixed seven annotations that pointed at the wrong code, the intel and knowledge call sites missing from the abort-signal line and the anchor of the protected-glob line |
| unknowns.md | reviewed | added entries checked against the files they cite; fixed the test paths and the delivery wording |
| coverage.md | ledger | counts re-run at `40adc1f`; later commits change documents only |

## Outstanding

- Rendering the five PlantUML diagrams; no render step exists in the repository.
- The owner's classification of every line in findings.md.
- The owner's decision on the proposal documents this branch edited before the documentation rule reached it, listed in findings.md.
