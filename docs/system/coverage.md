# Coverage ledger

This ledger tracks how much of the built system the `docs/system/` tree covers, against denominators counted at a pinned commit, and the review status of each document. Counts and dates live here, where drift is expected; the documents stay still. It is the hand-off: anything not listed as reviewed is not to be trusted yet.

## Denominators

Counted at commit `5457f85` on 2026-11-05.

| Surface | Count | Command |
|---|---|---|
| CLI commands | 6 (`init`, `repo`, `onboard`, `status`, `resume`, `context`) | `grep -n "COMMANDS =" src/cli/main.ts` |
| Hook entry points | 1 (PreToolUse, also serving post and config-change events) | `git ls-files src/hook` |
| `AVARICE_*` names | 12: 8 environment variables read, 1 set only (`AVARICE_RUN`), 3 constants | `git grep -ohE "AVARICE_[A-Z0-9_]+" -- src bin \| sort -u`, classified by reading each site |
| Other environment variables read | 8 (`HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `GSD_HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`) | `git grep -nE "env\[\|process\.env" -- src bin`, plus the passthrough lists in the GSD, graphify and host adapters |
| Profile config keys | 4 (all dead) | the single write site in the profile paths adapter |
| SQLite tables | 20 (14 with a writer, 6 without) | `git grep "CREATE TABLE" -- src`; writers by searching each table name |
| Event kinds | 12 | `git grep -hoE "type: '(onboarding\|contract\|invocation\|containment\|index\|hook\|tool\|config)[.][a-z.-]+'" -- src \| sort -u` |
| Schema migrations | 1 | `ls src/adapters/sqlite/migrations` |
| Lifecycle states and transitions | 14 and 29 | the lifecycle module's state and transition lists |
| Ports | 8 (plus one shared descriptor type) | `ls src/ports` |
| External systems | 10 (9 used, `gh` proven unused) | spawn sites: `git grep -nE "spawn\|execFile\|execSync" -- src bin` |
| Index steps | 3 | the index step registry |
| Hook rules (allow and deny) | 5 allow, 21 deny | the decision module and the hook entry |
| Source lines | 15,047 | `git ls-files src \| xargs wc -l` |
| Test files | 67 | `git ls-files test \| grep -c '\.test\.ts$'` |
| Import-boundary lint | passes (54 files) | `node scripts/check-boundaries.ts` |

## Documented counts

| Surface | Documented | Where |
|---|---|---|
| CLI commands | 6 of 6, all flags, 4 exit codes | cli-reference.md |
| Environment variables read | 16 of 16, plus 1 set-only and 1 test-only seam | config-reference.md |
| Profile config keys | 4 of 4, marked dead | config-reference.md |
| Lifecycle states and transitions | 14 of 14, 29 of 29 | onboarding.md |
| Validation checks | 7 of 7 | onboarding.md |
| Read-only commands, denied prefixes, denied find actions, GSD verbs | 11 of 11, 16 of 16, 10 of 10, 14 of 14 | containment.md |
| Required settings keys, admitted host versions | 9 of 9, 3 of 3 | containment.md |
| Budgets | 5 of 5 | containment.md, onboarding.md |
| Index steps, absent reasons | 3 of 3, 16 of 16 distinct | indexes-and-context.md |
| Tables, event kinds, artifact kinds | 20 of 20, 12 of 12, 4 of 4 | data-model.md |
| Ports, external systems | 8 of 8, 10 of 10 | integrations.md |

## Per-document status

Reviewed means a second reader (a fresh-eyes reviewer) checked claims against the code and every finding was applied or answered. Each reviewer bounced its first draft; the fixes were applied from the reviewer's code evidence, and no document was bounced twice.

| Document | Status | Review notes |
|---|---|---|
| cli-reference.md | reviewed | 12+ claims verified; fixed `--json` consumption, lease exit codes, `--promote` timing |
| config-reference.md | reviewed | 14 claims verified; fixed graphify on the host `PATH` (it is not) and where an unavailable host stops |
| onboarding.md | reviewed | 15+ claims verified; fixed the compile-refusal quirk, interrupted status, preflight class order |
| containment.md | reviewed | 15+ claims verified; fixed budget limit semantics, root-refusal messages, layer verification wording |
| indexes-and-context.md | reviewed | 25+ claims verified; fixed rollback files, intel failure reasons, freshness check scope |
| data-model.md | reviewed | 15+ claims verified; fixed the hook's separate ledger open, deletion scope, record content |
| integrations.md | reviewed | 20+ claims verified; fixed unavailable-host stage, git config reads, descriptor scope |
| processes.md, diagrams/ | drafted | cross-subsystem trace output; seams it found were applied to the leaf documents; diagrams not rendered |
| overview.md | drafted | written from the import lint and the leaf documents |
| history.md | drafted | from `git log` |
| README.md, findings.md, unknowns.md | assembled | index and campaign notes |

## Outstanding

- A second reader for processes.md, overview.md and history.md.
- Rendering the two PlantUML diagrams; no render step exists in the repository.
- The owner's classification of every line in findings.md.
