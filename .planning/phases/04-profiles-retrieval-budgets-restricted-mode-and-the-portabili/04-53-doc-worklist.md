# Plan 04-53 documentation worklist

Hand-off to plan 04-54 (README tables, `coverage.md`, `findings.md`, fresh reviews). Written from the code at HEAD `fef1348` (the last commit that touched `src`), after the documents below were changed in commits `b60ff09`, `e55595c` and `1ca6a38`. The gap-plan diff is `git diff --stat 792536d..fef1348 -- src scripts`: 33 files, 1,687 insertions, 337 deletions. No file under `docs/` outside `docs/system/` changed (`git diff --stat 792536d..HEAD -- docs` lists `docs/system/` files only). The AC-8 outcome is not written: plan 04-50 runs after this plan and plan 04-54 owns `findings.md` line 331.

Review groups use plan 04-39's naming: A (policy, profiles, doctor), B (commands and configuration), C (the three documents the owner ruled "close drafted"), D (runs, onboarding, indexes).

## Documents changed

| Document | Sections touched | Review group |
|---|---|---|
| `policy-and-approvals.md` | Approvals (parameters and digest); How an action reaches an approval (new open-start step); Privileged commands in the hook (rewritten: what the classifier reads, three outcomes, what an approval binds, in a run, in an attended session with four outcomes, what the classifier cannot see); No replay after an interruption (open-start refusal, startSeq, re-block of a blocked run); Enforcement map (the `privileged-approval` row and the count of rows with no test); Quirks (three added) | A |
| `diagrams/approve-privileged-action.puml` | refusal section redrawn for a line with several commands, the unparseable and unapprovable denials, all-or-none consumption; retry section | A |
| `processes.md` | Approve a privileged action, steps 1, 3 and 5 (the narrative of the diagram above) | A |
| `doctor.md` | Extensions paragraph; finding table row for `extensions` (new error finding) | A |
| `profiles-and-credentials.md` | Binding registry (lock and its wait, fsync and rename); Moved-root denial (unreadable config stops the command); Credentials (the `cmd` helper size rule); Quirks (the lost-update line replaced) | A |
| `cli-reference.md` | install-host (run refusal by process tree, hook entry script check, exit 3 text, quirk); approve (output, two not-found messages) | B |
| `config-reference.md` | The `retrieval` section (`fullReads`, `fullReadBytes` rows and the link); the routine contract table (read-exclude row) | B |
| `containment.md` | Layers (retrieval row, privileged row); Tool decisions (Read row, privileged paragraph, rule list with the counts 40, 35 and 6, the attended rules); Events the hook records; Restricted mode (scope of the patch and output handling); Retrieval budgets (broad discovery, whole-file reads rewritten); Limits (command classification); Quirks (the whole-file line replaced) | C |
| `data-model.md` | Events (`policy.denied`, `action.finished`); config home row (bindings lock file) | C |
| `integrations.md` | credential helper rows (two); install-host refusals (two rows and the run refusal bullet) | C |
| `runs.md` | Restricted runs (patch scope and cap, outputs read as findings, the two-record step); Resume prelude, step 3 (re-block of a blocked run) | D |
| `onboarding.md` | Mapping modes (scoped-map refusal); Promotion (path rule); Resume (reap refusal for an unreapable launch) | D |
| `indexes-and-context.md` | The cost cap (limit 0 and the stop); The sources (heading parse, 2,000-character cap, exclusion at any depth, refresh confinement); How a pack is assembled (planning skip rule); Untrusted-data fencing (new marking rules) | D |

`processes.md` is not in the plan's `files_modified`. Its approve-flow narrative restated the single-command approval the diagram no longer shows, so it was updated to match (recorded as a deviation in the SUMMARY).

## Documents left unchanged

| Document | Why |
|---|---|
| `overview.md` | No subsystem, command or boundary changed; it routes to the documents above. |
| `autonomy-and-decisions.md` | The decision flow is unchanged; the re-block of a run uses a permission decision already described in `policy-and-approvals.md`. |
| `checks-and-evidence.md` | No gap plan touched checks, evidence or gates. |
| `interactive-shell.md` | No command name, completion or history rule changed. |
| `portability.md` | The portability proof and its descriptors are unchanged by the gap plans. |
| `history.md`, `unknowns.md` | History is dated and pinned; no new unknown surfaced (see the finding lines below for suspicions). |
| `README.md`, `coverage.md`, `findings.md` | Owned by plan 04-54. |

## Surfaces from the gap plan SUMMARY files

| Plan | Surface | Where written |
|---|---|---|
| 04-40 | Attended `privileged:unparseable` rule, reasons and event data; what the scanner reads; limits; here-document bodies; the residual bypasses | `policy-and-approvals.md` (hook section); `containment.md` (rule list, events); `data-model.md` (`policy.denied`) |
| 04-41 | Heading parse and line cap; refresh confinement; exclusion at any depth; untrusted marking; the planning skip rule | `indexes-and-context.md`; `config-reference.md` (read-exclude row) |
| 04-42 | `interrupted-action-open`; `startSeq`; resume re-block; onboarding unreapable launch; scoped-map refusal | `policy-and-approvals.md`; `data-model.md`; `runs.md`; `onboarding.md` |
| 04-43 | Registry refusal; bindings lock and wait; `cmd:` size rule | `profiles-and-credentials.md`; `data-model.md`; `integrations.md` |
| 04-44 | Restricted block text, patch cap and scope rule, outputs and resume, promotion path rule | `runs.md`; `containment.md`; `onboarding.md` |
| 04-45 | install-host refusals (process tree, hook entry script); doctor attended-entry finding; approve messages | `cli-reference.md`; `integrations.md`; `doctor.md` |
| 04-46 | Evaluation harness `--authorize` mode and flag, `--live` refusals, spend recording, `exit-run-phase4.sh` flags | Not written: `docs/system` documents no evaluation harness (`findings.md` line 278 records it as undocumented), and the scripts are test tooling that `coverage.md` counts as "not documented in docs/system". No document to update. |
| 04-47 | None (test strengthening only; the summary has no documentation surfaces) | none needed |
| 04-48 | Per-command approvals, multi-request denial text, request order and events, run mode unchanged, known limits | `policy-and-approvals.md`; `containment.md`; `processes.md`; the diagram |
| 04-49 | Grep broad-discovery rule (glob matching every file, brace groups); knowledge stop without budget | `containment.md` (broad discovery); `indexes-and-context.md` (cost cap) |
| 04-51 | Bound parameters (`gitOptions`, `env`, `line`, `cwd`), fail closed on the directory, `privileged:unapprovable`, forms now classified, residual bypasses, enforcement-map row, run digests | `policy-and-approvals.md`; `containment.md`; `cli-reference.md` (approve summary); `data-model.md` |
| 04-52 | None (a ledger of review findings; no behavior) | none needed |
| 04-55 | Whole-file read counting, the two rules and reasons, no charge for a refused Read, who is not charged, fail closed, the rows now spent | `containment.md`; `config-reference.md` |

## `findings.md`: lines to update or close, lines to add

Update or close:

- Line 35 (`src/adapters/context/gsd-intel.ts:90`, intel handles never set `untrusted`): no longer holds; every intel handle and item sets it (`src/adapters/context/gsd-intel.ts:97` and `:127`). Close with "No longer holds at `614a9ca`".
- Line 283 (`src/app/retrieval-guard.ts:88`, whole-file reads): close the defect, the hook charges a Read to `retrieval.fullReads` and `retrieval.fullReadBytes` (commits `a65c2c7` and `cefb2e2`, `src/hook/pre-tool-use.ts:419` and `:454`). Keep the residual that `beginRead` (now `src/app/retrieval-guard.ts:92`) still has no caller outside tests.
- Line 270 (enforcement-map rows with no proving test): the `privileged-approval` row now names `test/integration/hook-privileged.test.ts` (`src/domain/enforcement-map.ts:98`). Drop it from the list and move the anchors of the other two (`approval-single-use` at `:106`, `restricted-mode` at `:170`). `policy-and-approvals.md` already says two rows.
- Lines 267 and 269 still hold; refresh their anchors: classification without a policy call is `src/hook/pre-tool-use.ts:397` (run) and `:675` (attended); the attended `action.started` with no end is written at `src/hook/pre-tool-use.ts:727`, and `action.interrupted` marking is at `src/app/authorize.ts:323`.
- Line 331 (AC-8): left to plan 04-54, which runs after plan 04-50.

Add (each is a place where the built behavior goes beyond or differs from a proposal, or a suspicion for the owner):

- `docs/decisions/ADR-005-policy-approvals-and-profiles.md:16` against `src/domain/privileged-commands.ts:874` and `src/hook/pre-tool-use.ts:692`: the ADR binds an approval to run, action and parameter digest. Built, the digest also covers git's global options, the assignments before the program, the digest of the exact line and, in an attended session, the working directory, so the same command on another line or in another directory needs its own approval. A line with several privileged commands needs one approval each (`src/hook/pre-tool-use.ts:717`).
- `src/domain/privileged-commands.ts:326`: a here-document body is read as commands even when its delimiter is quoted, so a body line that starts with `git push` asks for an approval (deliberate fail-safe or over-reach is not decided by the code; intent unknown).
- `docs/requirements.md:124` (CON-10, "justified full reads") against `src/hook/pre-tool-use.ts:419`: the hook counts every Read as one whole-file read whatever range it asks for, and no step asks for a justification. Intent unknown.
- `src/app/run-stages/restricted.ts` (`scopeBreaches`): the restricted patch is held to the contract's write, create and delete sets after the host has run, while `docs/containment.md:161` says nothing about a scope rule for the patch. Add only if the owner wants proposal and code compared; the behavior is documented in `containment.md` and `runs.md`.

## `coverage.md`: denominators whose counts changed, and each recount command

Counted at `fef1348` on 2026-11-22 (docs-only commits since).

| Surface | At `9bf839d` | At `fef1348` | Command |
|---|---|---|---|
| Hook rules | 38 (6 allow, 33 deny, one on both) | 40 (6 allow, 35 deny, one on both); the two attended-only rules `privileged:unparseable` and `privileged:unapprovable` and the six `privileged:<action>` rules are not in the count | the command of the row, `grep -ohE "(return \|deny\(\|_RULE = \|\?\?= \|null : \|rule: \|rule: seen[.]agentCommand [?] )'[a-z]+([-:_.][a-zA-Z]+)*'( : '[a-z-]+')?" src/domain/hook-decision.ts src/hook/pre-tool-use.ts \| grep -oE "'[^']+'" \| sort -u \| wc -l`; the new IDs are `budget:retrieval.fullReads` and `budget:retrieval.fullReadBytes` |
| Documented hook rule IDs | 38 of 38 | 40 of 40 | `containment.md` |
| Event data fields | n/a | `action.finished` gains `startSeq` (optional) | `grep -n "startSeq" src/app/authorize.ts` |
| Source lines | 46,639 (240 files) | 47,810 (240 files) | `git ls-files src \| xargs cat \| wc -l`; `git ls-files src \| wc -l` |
| Test files | 239: 90 unit, 116 integration, 17 fault, 11 containment, 3 mutation, 2 contract | 242: 92 unit, 116 integration, 18 fault, 11 containment, 3 mutation, 2 contract | `git ls-files test \| grep -c '\.test\.ts$'`; per directory with `git ls-files test \| grep '\.test\.ts$' \| sed -E 's#^test/([^/]+)/.*#\1#' \| sort \| uniq -c` |

Counts re-run and unchanged: CLI commands 20, `AVARICE_*` names 19, action table 22, enforcement map 18 controls, event kinds 50, migrations 4, diagram sources 9, doctor finding areas 11. The new doctor finding is one more finding in an existing area, so neither the area count nor the section count moves. The `Per-document status` rows for every document in the table above change from `reviewed` to `changed after review` until the reviews below pass; `containment.md`, `data-model.md` and `integrations.md` were already `changed after review`.

## Review groups for plan 04-54

| Group | Documents | Fresh reviewer checks against the code |
|---|---|---|
| A | `policy-and-approvals.md`, `diagrams/approve-privileged-action.puml`, `processes.md` (approve flow), `doctor.md`, `profiles-and-credentials.md` | the classifier, the two hook modes, the approval gate, the enforcement-map row, the bindings lock, the doctor probe |
| B | `cli-reference.md`, `config-reference.md` | install-host and approve, the retrieval rows and the read-exclude row |
| C (own group, the owner's "close drafted" ruling; a pass can close T-04-102) | `containment.md`, `data-model.md`, `integrations.md` | the hook rule list and counts (40, 35, 6), the Read charge, the restricted patch rules, the event rows, the credential and install-host rows |
| D | `runs.md`, `onboarding.md`, `indexes-and-context.md` | the restricted stage, the resume re-block, the reap refusal, the heading parser, the exclusion rule, the untrusted marking, the knowledge stop |

Each reviewer should read every sentence that states a limit (65,536 characters, 8 levels, 16 prefix words, 2 seconds, 1 MiB, 440 characters, 2,000 characters) against the constant in the code.
